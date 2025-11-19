/**
 * FamilySetupScreen
 *
 * - Vises efter kalendersynkronisering og giver brugeren mulighed for at oprette eller tilslutte en familie.
 * - Opretter `families`-collection i Firestore og tilføjer medlemmer via e-mailopslag i `users`.
 */
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';

import Button from '../components/Button';
import FormInput from '../components/FormInput';
import ErrorMessage from '../components/ErrorMessage';
import { auth, db, firebase } from '../lib/firebase';
import { colors, spacing, fontSizes, radius } from '../styles/theme';

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const adjectives = [
  'glad',
  'stolt',
  'rolig',
  'hurtig',
  'kreativ',
  'modig',
  'varm',
  'hyggelig',
  'smart',
  'energisk',
];

const nouns = [
  'ugle',
  'los',
  'delfin',
  'panda',
  'løve',
  'hjort',
  'pingvin',
  'ræv',
  'svale',
  'havørn',
];

const stripDiacritics = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  if (typeof value.normalize === 'function') {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  return value;
};

const normalizeFamilyCode = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return '';
  }
  const noDiacritics = stripDiacritics(trimmed);
  const sanitized = noDiacritics.replace(/[^a-z0-9-]/g, '-');
  return sanitized.replace(/-+/g, '-').replace(/^-|-$/g, '');
};

const buildFamilyCodeCandidates = (value) => {
  if (typeof value !== 'string') {
    return [];
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  const lower = trimmed.toLowerCase();
  const noDiacritics = stripDiacritics(lower);
  const sanitized = noDiacritics.replace(/[^a-z0-9-]/g, '-');
  const collapsed = sanitized.replace(/-+/g, '-').replace(/^-|-$/g, '');

  const candidates = [trimmed, lower, noDiacritics, sanitized, collapsed];
  const unique = [];

  candidates.forEach((candidate) => {
    if (typeof candidate !== 'string') {
      return;
    }
    const normalized = candidate.trim();
    if (normalized && !unique.includes(normalized)) {
      unique.push(normalized);
    }
  });

  return unique;
};

const generateFamilyCode = async () => {
  // Finder et menneskeligt læsbart familie-ID og sikrer, at det er unikt i Firestore.
  const attempts = 40;
  for (let i = 0; i < attempts; i += 1) {
    const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const candidate = normalizeFamilyCode(`${adjective}-${noun}`);
    if (!candidate) {
      continue;
    }
    const existingDoc = await db.collection('families').doc(candidate).get();
    if (!existingDoc.exists) {
      return candidate;
    }
  }

  const fallbackRef = db.collection('families').doc();
  return fallbackRef.id;
};

const FamilySetupScreen = ({ navigation }) => {
  const [mode, setMode] = useState('create');
  const [familyName, setFamilyName] = useState('');
  const [familyCode, setFamilyCode] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitedEmails, setInvitedEmails] = useState([]);
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [existingFamily, setExistingFamily] = useState(null);
  const [copyFeedback, setCopyFeedback] = useState('');

  const userId = auth.currentUser?.uid ?? null;
  const userEmail = auth.currentUser?.email ?? '';

  useEffect(() => {
    const loadFamily = async () => {
      // Slår op i `users` for at se om brugeren allerede er tilknyttet en familie.
      if (!userId) {
        setInitializing(false);
        return;
      }

      try {
        const userDoc = await db.collection('users').doc(userId).get();
        const familyId = userDoc.data()?.familyId ?? null;

        if (familyId) {
          const familyDoc = await db.collection('families').doc(familyId).get();
          if (familyDoc.exists) {
            setExistingFamily({
              id: familyDoc.id,
              ...familyDoc.data(),
            });
          }
        }
      } catch (_error) {
        setError('Kunne ikke hente familieoplysninger.');
      } finally {
        setInitializing(false);
      }
    };

    loadFamily();
  }, [userId]);

  useEffect(() => {
    setError('');
    setStatusMessage('');
  }, [mode]);

  const handleAddInviteEmail = () => {
    // Tilføjer en e-mail til invitationer efter normalisering og validering.
    const normalized = inviteEmail.trim().toLowerCase();

    if (!normalized) {
      setError('Indtast en e-mail, før du tilføjer den.');
      return;
    }

    if (!emailRegex.test(normalized)) {
      setError('E-mailen skal være gyldig.');
      return;
    }

    if (normalized === userEmail.toLowerCase()) {
      setError('Du er automatisk med i familien og behøver ikke tilføjes.');
      return;
    }

    if (invitedEmails.includes(normalized)) {
      setError('E-mailen er allerede tilføjet.');
      return;
    }

    setInvitedEmails((prev) => [...prev, normalized]);
    setInviteEmail('');
    setError('');
  };

  const handleRemoveInvite = (email) => {
    // Fjerner en planlagt invitation fra listen uden mutation.
    setInvitedEmails((prev) => prev.filter((item) => item !== email));
  };

  const resolveInvitees = async (familyId) => {
    // Finder eksisterende brugere med matchende e-mail og opdeler dem i medlems- og pending-lister.
    const resolvedMembers = [];
    const pendingInvites = [];
    const conflicts = [];
    const lookups = invitedEmails.map(async (email) => {
      const snapshot = await db
        .collection('users')
        .where('email', '==', email)
        .limit(1)
        .get();

      if (snapshot.empty) {
        pendingInvites.push(email);
        return;
      }

      const memberDoc = snapshot.docs[0];
      const memberData = memberDoc.data() ?? {};

      if (memberData.familyId && memberData.familyId !== familyId) {
        conflicts.push(email);
        pendingInvites.push(email);
        return;
      }

      resolvedMembers.push({
        userId: memberDoc.id,
        email,
        role: 'member',
      });
    });

    await Promise.all(lookups);

    return { resolvedMembers, pendingInvites, conflicts };
  };

  const handleCreateFamily = async () => {
    // Opretter en ny familie i Firestore og knytter inviterede medlemmer.
    if (!userId) {
      setError('Ingen aktiv bruger fundet. Log ind igen.');
      return;
    }

    const trimmedName = familyName.trim();
    if (!trimmedName) {
      setError('Familienavn skal udfyldes.');
      return;
    }

    try {
      setLoading(true);
      setError('');
      setStatusMessage('');

      const generatedFamilyCode = await generateFamilyCode();
      const familyRef = db.collection('families').doc(generatedFamilyCode);
      const codeVariants = buildFamilyCodeCandidates(familyRef.id);
      const { resolvedMembers, pendingInvites, conflicts } =
        await resolveInvitees(familyRef.id);

      const members = [
        { userId, email: userEmail.toLowerCase(), role: 'admin' },
        ...resolvedMembers,
      ];

      await familyRef.set({
        name: trimmedName,
        ownerId: userId,
        ownerEmail: userEmail.toLowerCase(),
        members,
        pendingInvites,
        codeVariants: codeVariants.length ? codeVariants : [familyRef.id],
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });

      await db.collection('users').doc(userId).set(
        {
          familyId: familyRef.id,
          familyRole: 'admin',
        },
        { merge: true }
      );

      await Promise.all(
        resolvedMembers.map((member) =>
          db.collection('users').doc(member.userId).set(
            {
              familyId: familyRef.id,
              familyRole: 'member',
            },
            { merge: true }
          )
        )
      );

      setExistingFamily({
        id: generatedFamilyCode,
        name: trimmedName,
        ownerId: userId,
        ownerEmail: userEmail.toLowerCase(),
        members,
        pendingInvites,
      });

      setStatusMessage(
        conflicts.length
          ? `Familien er oprettet med ID ${generatedFamilyCode}. Følgende e-mails kunne ikke knyttes automatisk: ${conflicts.join(
              ', '
            )}.`
          : `Familien er oprettet og dine medlemmer er tilføjet. Del familie ID'et ${generatedFamilyCode} med dine familiemedlemmer.`
      );
      setInvitedEmails([]);
      setFamilyName('');
      setInviteEmail('');
    } catch (_error) {
      setError('Kunne ikke oprette familien. Prøv igen.');
    } finally {
      setLoading(false);
    }
  };

  const handleJoinFamily = async () => {
    // Tilslutter den indtastede familie, hvis koden findes og brugeren ikke allerede er medlem.
    if (!userId) {
      setError('Ingen aktiv bruger fundet. Log ind igen.');
      return;
    }

    const trimmedCode = familyCode.trim();
    if (!trimmedCode) {
      setError('Indtast en familiekode for at tilslutte.');
      return;
    }

    try {
      setLoading(true);
      setError('');
      setStatusMessage('');

      const codeCandidates = buildFamilyCodeCandidates(trimmedCode);
      if (!codeCandidates.length) {
        setError('Der findes ingen familie med den kode.');
        return;
      }

      let familyRef = null;
      let familyDoc = null;

      for (let i = 0; i < codeCandidates.length; i += 1) {
        const candidateRef = db.collection('families').doc(codeCandidates[i]);
        const candidateDoc = await candidateRef.get();
        if (candidateDoc.exists) {
          familyRef = candidateRef;
          familyDoc = candidateDoc;
          break;
        }
      }

      if (!familyDoc || !familyRef) {
        setError('Der findes ingen familie med den kode.');
        return;
      }

      const familyData = familyDoc.data() ?? {};
      const members = Array.isArray(familyData.members)
        ? [...familyData.members]
        : [];

      const normalizedUserEmail =
        typeof userEmail === 'string' ? userEmail.trim().toLowerCase() : '';

      const alreadyMemberIndex = members.findIndex(
        (member) => member?.userId === userId
      );
      const alreadyMember = alreadyMemberIndex !== -1;

      if (alreadyMember) {
        const existingMember = members[alreadyMemberIndex] ?? {};
        await db
          .collection('users')
          .doc(userId)
          .set(
            {
              familyId: familyDoc.id,
              familyRole:
                typeof existingMember?.role === 'string'
                  ? existingMember.role
                  : 'member',
            },
            { merge: true }
          );

        setExistingFamily({
          id: familyDoc.id,
          ...familyData,
          members,
        });
        setStatusMessage('Du er allerede tilknyttet denne familie.');
        setFamilyCode('');
        return;
      }

      members.push({
        userId,
        email: normalizedUserEmail,
        role: 'member',
      });

      const pendingInvitesSource = Array.isArray(familyData.pendingInvites)
        ? familyData.pendingInvites
        : [];
      const pendingInvites = normalizedUserEmail
        ? pendingInvitesSource.filter(
            (email) =>
              typeof email === 'string' &&
              email.toLowerCase() !== normalizedUserEmail
          )
        : pendingInvitesSource;

      await familyRef.update({
        members,
        pendingInvites,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });

      await db.collection('users').doc(userId).set(
        {
          familyId: familyRef.id,
          familyRole: 'member',
        },
        { merge: true }
      );

      setExistingFamily({
        id: familyRef.id,
        ...familyData,
        members,
        pendingInvites,
      });
      setStatusMessage('Du er nu en del af familien.');
      setFamilyCode('');
    } catch (joinError) {
      const rawMessage =
        typeof joinError?.message === 'string' ? joinError.message.trim() : '';
      const baseMessage = rawMessage.length
        ? rawMessage
        : 'Kunne ikke tilslutte familien. Prøv igen.';

      if (baseMessage.includes('Missing or insufficient permissions')) {
        setError(
          'Manglende tilladelser i Firestore. Kontakt administratoren eller prøv igen senere.'
        );
      } else {
        setError(baseMessage);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleContinueToApp = () => {
    navigation.replace('MainTabs');
  };

  if (initializing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Henter familieoplysninger…</Text>
      </View>
    );
  }

  if (existingFamily) {
    const members = Array.isArray(existingFamily.members)
      ? existingFamily.members
      : [];

    return (
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.container}>
          <Text style={styles.title}>Familien er klar</Text>
          <Text style={styles.subtitle}>
            Du er tilknyttet familien{' '}
            <Text style={styles.highlight}>{existingFamily.name}</Text>.
          </Text>
          <Text style={styles.familyIdText}>
            Familie ID: {existingFamily.id}
          </Text>
          <Pressable
            onPress={async () => {
              await Clipboard.setStringAsync(existingFamily.id);
              setCopyFeedback('Familie ID kopieret.');
              setTimeout(() => setCopyFeedback(''), 2500);
            }}
            style={styles.copyButton}
          >
            <Text style={styles.copyButtonText}>Kopier familie ID</Text>
          </Pressable>
          {copyFeedback ? (
            <Text style={styles.copyFeedback}>{copyFeedback}</Text>
          ) : null}

          <ErrorMessage message={error} />
          {statusMessage ? (
            <Text style={styles.successText}>{statusMessage}</Text>
          ) : null}

          <View style={styles.familyCard}>
            <Text style={styles.familyCardTitle}>Medlemmer</Text>
            {members.length === 0 ? (
              <Text style={styles.familyCardText}>
                Ingen medlemmer registreret endnu.
              </Text>
            ) : (
              members.map((member) => (
                <Text key={member.userId} style={styles.familyCardText}>
                  {member.email}{' '}
                  {member.role === 'admin' ? '(Administrator)' : '(Medlem)'}
                </Text>
              ))
            )}
            {Array.isArray(existingFamily.pendingInvites) &&
            existingFamily.pendingInvites.length ? (
              <>
                <Text style={[styles.familyCardTitle, styles.pendingTitle]}>
                  Afventer accept
                </Text>
                {existingFamily.pendingInvites.map((email) => (
                  <Text key={email} style={styles.pendingText}>
                    {email}
                  </Text>
                ))}
              </>
            ) : null}
          </View>

          <Button
            title="Gå til FamTime"
            onPress={handleContinueToApp}
            style={styles.primaryAction}
          />
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <View style={styles.container}>
        <Text style={styles.title}>Opret eller tilslut familie</Text>
        <Text style={styles.subtitle}>
          Del FamTime med din familie ved at oprette en familie eller tilslutte
          dig en eksisterende.
        </Text>

        <View style={styles.modeSwitch}>
          <Pressable
            onPress={() => setMode('create')}
            style={[
              styles.modeButton,
              mode === 'create' ? styles.modeButtonActive : null,
            ]}
          >
            <Text
              style={[
                styles.modeButtonText,
                mode === 'create' ? styles.modeButtonTextActive : null,
              ]}
            >
              Opret familie
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setMode('join')}
            style={[
              styles.modeButton,
              mode === 'join' ? styles.modeButtonActive : null,
            ]}
          >
            <Text
              style={[
                styles.modeButtonText,
                mode === 'join' ? styles.modeButtonTextActive : null,
              ]}
            >
              Tilslut familie
            </Text>
          </Pressable>
        </View>

        <ErrorMessage message={error} />
        {statusMessage ? (
          <Text style={styles.successText}>{statusMessage}</Text>
        ) : null}

        {mode === 'create' ? (
          <>
            <FormInput
              label="Familienavn"
              value={familyName}
              onChangeText={setFamilyName}
              placeholder="Fx Team Jensen"
              style={styles.field}
            />

            <FormInput
              label="Tilføj familiemedlemmer (e-mail)"
              value={inviteEmail}
              onChangeText={setInviteEmail}
              placeholder="familiemedlem@email.dk"
              style={styles.field}
            />
            <Button
              title="Tilføj e-mail"
              onPress={handleAddInviteEmail}
              disabled={loading}
              style={styles.addEmailButton}
            />

            {invitedEmails.length ? (
              <View style={styles.inviteList}>
                {invitedEmails.map((email) => (
                  <Pressable
                    key={email}
                    onPress={() => handleRemoveInvite(email)}
                    style={styles.inviteChip}
                  >
                    <Text style={styles.inviteChipText}>{email}</Text>
                    <Text style={styles.inviteChipRemove}>x</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            <Button
              title="Opret familie"
              onPress={handleCreateFamily}
              loading={loading}
              style={styles.primaryAction}
            />
          </>
        ) : (
          <>
            <FormInput
              label="Familiekode"
              value={familyCode}
              onChangeText={setFamilyCode}
              placeholder="Indtast familie-ID"
              style={styles.field}
            />

            <Button
              title="Tilslut familie"
              onPress={handleJoinFamily}
              loading={loading}
              style={styles.primaryAction}
            />
          </>
        )}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  loadingText: {
    marginTop: spacing.md,
    color: colors.mutedText,
    fontSize: fontSizes.md,
  },
  scrollContent: {
    flexGrow: 1,
  },
  container: {
    flex: 1,
    padding: spacing.lg,
    backgroundColor: colors.background,
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
  familyIdText: {
    fontSize: fontSizes.sm,
    color: colors.mutedText,
    marginBottom: spacing.lg,
  },
  copyButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
  copyButtonText: {
    color: colors.primaryText,
    fontSize: fontSizes.sm,
    fontWeight: '600',
  },
  copyFeedback: {
    fontSize: fontSizes.sm,
    color: colors.primary,
    marginBottom: spacing.md,
  },
  modeSwitch: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.xs,
    marginBottom: spacing.lg,
  },
  modeButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: radius.sm,
  },
  modeButtonActive: {
    backgroundColor: colors.primary,
  },
  modeButtonText: {
    fontSize: fontSizes.md,
    color: colors.mutedText,
    fontWeight: '600',
  },
  modeButtonTextActive: {
    color: colors.primaryText,
  },
  successText: {
    color: colors.primary,
    fontSize: fontSizes.md,
    marginBottom: spacing.md,
  },
  field: {
    marginBottom: spacing.md,
  },
  addEmailButton: {
    marginBottom: spacing.md,
  },
  inviteList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: spacing.lg,
  },
  inviteChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(230, 138, 46, 0.18)',
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
  },
  inviteChipText: {
    color: colors.text,
    fontSize: fontSizes.sm,
    marginRight: spacing.xs,
  },
  inviteChipRemove: {
    color: colors.mutedText,
    fontSize: fontSizes.sm,
  },
  primaryAction: {
    marginTop: spacing.md,
  },
  familyCard: {
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  familyCardTitle: {
    fontSize: fontSizes.md,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  familyCardText: {
    fontSize: fontSizes.md,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  pendingTitle: {
    marginTop: spacing.lg,
  },
  pendingText: {
    fontSize: fontSizes.md,
    color: colors.mutedText,
    marginBottom: spacing.xs,
  },
  highlight: {
    color: colors.primary,
    fontWeight: '700',
  },
});

export default FamilySetupScreen;
