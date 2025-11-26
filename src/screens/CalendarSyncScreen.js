/**
 * CalendarSyncScreen
 *
 * - Viser prompt efter profiloplysninger er gemt for at aktivere Apple-kalendersynkronisering.
 * - Håndterer rettigheder via expo-calendar og gemmer synk-status i Firestore under `calendar/{uid}`.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, Modal, Pressable, Platform } from 'react-native';
import * as Calendar from 'expo-calendar';

import Button from '../components/Button';
import ErrorMessage from '../components/ErrorMessage';
import { auth, db, firebase } from '../lib/firebase';
import styles from '../styles/screens/CalendarSyncScreenStyles';

const formatCalendarLabel = (calendarTitle) => {
  const trimmedTitle =
    typeof calendarTitle === 'string' ? calendarTitle.trim() : '';
  return trimmedTitle.length ? `"${trimmedTitle}"` : 'din kalender';
};

const CalendarSyncScreen = ({ navigation }) => {
  const [promptVisible, setPromptVisible] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [processing, setProcessing] = useState(false);
  const [syncCompleted, setSyncCompleted] = useState(false);
  const [calendarLabel, setCalendarLabel] = useState('din kalender');

  const userId = auth.currentUser?.uid ?? null;
  const persistCalendarStatus = async (payload) => {
    // Gemmer den seneste synkroniseringsstatus i Firestore til senere opslag.
    if (!userId) {
      return;
    }

    await db
      .collection('calendar')
      .doc(userId)
      .set(
        {
          ...payload,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
  };

  const handleAccept = async () => {
    // Anmoder om kalenderadgang og udpeger en skrivbar kalender til synk.
    if (!userId) {
      setErrorMessage(
        'Kunne ikke finde en aktiv bruger. Log venligst ind igen.'
      );
      return;
    }

    try {
      setProcessing(true);
      setErrorMessage('');

      const { status } = await Calendar.requestCalendarPermissionsAsync();

      if (status !== 'granted') {
        try {
          await persistCalendarStatus({ permission: status, synced: false });
        } catch (_persistError) {
          // Firestore kan være utilgængeligt; brugeren får stadig feedback.
        }
        setErrorMessage(
          'Du skal acceptere kalenderadgang for at aktivere synkronisering.'
        );
        return;
      }

      let writableCalendar = null;
      const calendars = await Calendar.getCalendarsAsync(
        Calendar.EntityTypes.EVENT
      );

      const eventCalendars = calendars.filter((calendar) => calendar?.id);

      const allCalendarIds = Array.from(
        new Set(eventCalendars.map((calendar) => calendar.id).filter(Boolean))
      );

      writableCalendar =
        eventCalendars.find((calendar) => calendar.allowsModifications) ??
        eventCalendars.find((calendar) => calendar.isPrimary) ??
        eventCalendars[0] ??
        null;

      if (!writableCalendar && Calendar.getDefaultCalendarAsync) {
        try {
          writableCalendar = await Calendar.getDefaultCalendarAsync();
          if (writableCalendar?.id && !allCalendarIds.includes(writableCalendar.id)) {
            allCalendarIds.push(writableCalendar.id);
          }
        } catch (_error) {
          writableCalendar = null;
        }
      }

      try {
        await persistCalendarStatus({
          permission: status,
          synced: true,
          calendarId: writableCalendar?.id ?? null,
          calendarIds: allCalendarIds,
          calendarTitle: writableCalendar?.title ?? null,
          platform: Platform.OS,
        });
      } catch (_persistError) {
        // Hvis vi ikke kan gemme, fortsætter vi med visuel feedback til brugeren.
      }

      setCalendarLabel(formatCalendarLabel(writableCalendar?.title));
      setSyncCompleted(true);
      setPromptVisible(false);
    } catch (_error) {
      try {
        await persistCalendarStatus({
          permission: 'error',
          synced: false,
          platform: Platform.OS,
        });
      } catch (_persistError) {
        // Fejl er allerede håndteret i UI.
      }
      setErrorMessage(
        'Kunne ikke aktivere synkronisering. Prøv igen eller kontakt support.'
      );
    } finally {
      setProcessing(false);
    }
  };

  const handleDecline = async () => {
    // Registrerer, at brugeren har valgt kalender-synkronisering fra.
    if (userId) {
      try {
        await persistCalendarStatus({ permission: 'declined', synced: false });
      } catch (_persistError) {
        // Ignorer; brugeren kan prøve igen senere.
      }
    }
    setPromptVisible(false);
    setSyncCompleted(false);
  };

  const handleContinue = () => {
    // Hopper videre til familieopsætningen efter kalendersynk-flowet.
    navigation.replace('FamilySetup');
  };

  const heroContent = useMemo(() => {
    if (syncCompleted) {
      return {
        title: 'Velkommen til FamTime',
        subtitle: `Din kalender ${calendarLabel} er nu synkroniseret`,
        paragraphs: [
          `FamTime foreslår automatisk aktiviteter og tidspunkter, hvor hele familien kan deltage, baseret på de ledige huller i ${calendarLabel}.`,
          'Vi holder øje med alles aftaler, giver besked når nye muligheder opstår og deler bekræftede events direkte i jeres kalendere, så alle er opdaterede.',
          'Du er klar til at bruge FamTime – fortsæt til familien og lad appen gøre planlægningen lettere.',
        ],
      };
    }
    return {
      title: 'Synkroniser FamTime med din kalender',
      subtitle: 'Velkommen til FamTime',
      paragraphs: [
        'Giv FamTime adgang til din kalender for at få automatiske forslag til familietidspunkter og aktiviteter.',
        'Når synkroniseringen er slået til, sørger vi for at holde familien opdateret helt automatisk.',
      ],
    };
  }, [calendarLabel, syncCompleted]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{heroContent.title}</Text>
      <Text style={styles.subtitle}>{heroContent.subtitle}</Text>
      {heroContent.paragraphs.map((copy) => (
        <Text key={copy} style={styles.description}>
          {copy}
        </Text>
      ))}
      <ErrorMessage message={errorMessage} />

      {!promptVisible ? (
        <>
          <Button
            title="Fortsæt til familie"
            onPress={handleContinue}
            style={styles.continueButton}
          />
          {!syncCompleted ? (
            <Pressable onPress={() => setPromptVisible(true)}>
              <Text style={styles.retryLink}>Prøv igen</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}

      <Modal transparent visible={promptVisible} animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Synkronisér med kalender</Text>
            <Text style={styles.modalDescription}>
              FamTime kan læse og skabe aftaler i din Apple-kalender. Accepter
              for at dele kalenderhuller med din familie.
            </Text>

            <Button
              title="Accepter"
              onPress={handleAccept}
              loading={processing}
              style={styles.modalPrimary}
            />
            <Button
              title="Afslå"
              onPress={handleDecline}
              disabled={processing}
              style={styles.modalSecondary}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
};

export default CalendarSyncScreen;
