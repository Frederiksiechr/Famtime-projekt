/**
 * CalendarSyncScreen
 *
 * - Viser prompt efter profiloplysninger er gemt for at aktivere Apple-kalendersynkronisering.
 * - Håndterer rettigheder via expo-calendar og gemmer synk-status i Firestore under `calendar/{uid}`.
 */
import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  Platform,
} from 'react-native';
import * as Calendar from 'expo-calendar';

import Button from '../components/Button';
import ErrorMessage from '../components/ErrorMessage';
import { auth, db, firebase } from '../lib/firebase';
import { colors, spacing, fontSizes, radius } from '../styles/theme';

const CalendarSyncScreen = ({ navigation }) => {
  const [promptVisible, setPromptVisible] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [processing, setProcessing] = useState(false);
  const [syncCompleted, setSyncCompleted] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);

  const userId = auth.currentUser?.uid ?? null;
  const subtitle = useMemo(() => {
    return Platform.select({
      ios: 'Forbind FamTime med din Apple-kalender for at dele aftaler med familien.',
      android:
        'Forbind FamTime med din kalender for at dele aftaler med familien.',
      default:
        'Forbind FamTime med din kalender for at dele aftaler med familien.',
    });
  }, []);

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

      setSyncStatus(
        writableCalendar?.title
          ? `Synkronisering aktiveret med kalenderen "${writableCalendar.title}".`
          : 'Synkronisering aktiveret.'
      );
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

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Kalendersynkronisering</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>

      <ErrorMessage message={errorMessage} />

      {syncStatus ? <Text style={styles.statusText}>{syncStatus}</Text> : null}

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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.lg,
    backgroundColor: colors.background,
    justifyContent: 'center',
  },
  title: {
    fontSize: fontSizes.xl,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: fontSizes.md,
    color: colors.mutedText,
    marginBottom: spacing.lg,
  },
  statusText: {
    color: colors.primary,
    fontSize: fontSizes.md,
    marginTop: spacing.md,
  },
  continueButton: {
    marginTop: spacing.lg,
  },
  retryLink: {
    marginTop: spacing.sm,
    color: colors.primary,
    textAlign: 'center',
    fontSize: fontSizes.md,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(75, 46, 18, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    width: '100%',
    backgroundColor: colors.background,
    borderRadius: radius.md,
    padding: spacing.lg,
    shadowColor: colors.shadow,
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 4,
  },
  modalTitle: {
    fontSize: fontSizes.lg,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  modalDescription: {
    fontSize: fontSizes.md,
    color: colors.mutedText,
    marginBottom: spacing.lg,
  },
  modalPrimary: {
    marginBottom: spacing.sm,
  },
  modalSecondary: {
    backgroundColor: '#BFA386',
  },
});

export default CalendarSyncScreen;
