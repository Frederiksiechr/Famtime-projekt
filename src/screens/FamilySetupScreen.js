/**
 * FamilySetupScreen
 *
 * - Vises efter kalendersynkronisering og giver brugeren mulighed for at oprette eller tilslutte en familie.
 * - Opretter `families`-collection i Firestore og tilføjer medlemmer via e-mailopslag i `users`.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  Pressable,
  Alert,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';

import Button from '../components/Button';
import FormInput from '../components/FormInput';
import ErrorMessage from '../components/ErrorMessage';
import { auth, db, firebase } from '../lib/firebase';
import { colors } from '../styles/theme';
import styles from '../styles/screens/FamilySetupScreenStyles';

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
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [existingFamily, setExistingFamily] = useState(null);
  const [copyFeedback, setCopyFeedback] = useState('');
  const [deletingFamily, setDeletingFamily] = useState(false);
  const [transferringAdminId, setTransferringAdminId] = useState('');
  const [removingMemberId, setRemovingMemberId] = useState('');
  const [approvingRequestIds, setApprovingRequestIds] = useState([]);
  const [rejectingRequestIds, setRejectingRequestIds] = useState([]);
  const familyUnsubscribeRef = useRef(null);

  const userId = auth.currentUser?.uid ?? null;
  const userEmail = auth.currentUser?.email ?? '';

  useEffect(() => {
    if (!userId) {
      setExistingFamily(null);
      setInitializing(false);
      if (familyUnsubscribeRef.current) {
        familyUnsubscribeRef.current();
        familyUnsubscribeRef.current = null;
      }
      return;
    }

    const unsubscribeUserDoc = db
      .collection('users')
      .doc(userId)
      .onSnapshot(
        (snapshot) => {
          const userData = snapshot.data() ?? {};
          const nextFamilyId = userData.familyId ?? null;

          if (familyUnsubscribeRef.current) {
            familyUnsubscribeRef.current();
            familyUnsubscribeRef.current = null;
          }

          if (nextFamilyId) {
            familyUnsubscribeRef.current = db
              .collection('families')
              .doc(nextFamilyId)
              .onSnapshot(
                (familySnapshot) => {
                  if (familySnapshot.exists) {
                    setExistingFamily({
                      id: familySnapshot.id,
                      ...familySnapshot.data(),
                    });
                  } else {
                    setExistingFamily(null);
                  }
                  setInitializing(false);
                },
                () => {
                  setExistingFamily(null);
                  setInitializing(false);
                }
              );
          } else {
            setExistingFamily(null);
            setInitializing(false);
          }
        },
        () => {
          setExistingFamily(null);
          setInitializing(false);
        }
      );

    return () => {
      if (unsubscribeUserDoc) {
        unsubscribeUserDoc();
      }
      if (familyUnsubscribeRef.current) {
        familyUnsubscribeRef.current();
        familyUnsubscribeRef.current = null;
      }
    };
  }, [userId]);

  useEffect(() => {
    setError('');
    setStatusMessage('');
  }, [mode]);

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

      const members = [
        { userId, email: userEmail.toLowerCase(), role: 'admin' },
      ];

      await familyRef.set({
        name: trimmedName,
        ownerId: userId,
        ownerEmail: userEmail.toLowerCase(),
        members,
        pendingInvites: [],
        joinRequests: [],
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

      setExistingFamily({
        id: generatedFamilyCode,
        name: trimmedName,
        ownerId: userId,
        ownerEmail: userEmail.toLowerCase(),
        members,
        pendingInvites: [],
        joinRequests: [],
      });

      setStatusMessage(
        `Familien er oprettet. Del familie ID'et ${generatedFamilyCode} med dine familiemedlemmer.`
      );
      setFamilyName('');
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
      const joinRequests = Array.isArray(familyData.joinRequests)
        ? [...familyData.joinRequests]
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

      const alreadyRequested = joinRequests.some(
        (request) => request?.userId === userId
      );

      if (alreadyRequested) {
        setStatusMessage('Din anmodning afventer allerede godkendelse.');
        setFamilyCode('');
        return;
      }

      const userDoc = await db.collection('users').doc(userId).get();
      const userData = userDoc.data() ?? {};
      const userDisplayName =
        typeof userData.name === 'string' && userData.name.trim().length
          ? userData.name.trim()
          : '';

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

      joinRequests.push({
        userId,
        email: normalizedUserEmail,
        displayName: userDisplayName,
        requestedAt: firebase.firestore.Timestamp.now(),
      });

      await familyRef.update({
        joinRequests,
        pendingInvites,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });

      setStatusMessage(
        'Din anmodning er sendt til familieejeren. Du får besked, når den bliver godkendt.'
      );
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

  const getMemberDisplayLabel = (member) => {
    if (!member || typeof member !== 'object') {
      return 'familiemedlemmet';
    }
    const fromDisplay =
      typeof member.displayName === 'string' && member.displayName.trim().length
        ? member.displayName.trim()
        : null;
    if (fromDisplay) {
      return fromDisplay;
    }
    const fromName =
      typeof member.name === 'string' && member.name.trim().length ? member.name.trim() : null;
    if (fromName) {
      return fromName;
    }
    const fromEmail =
      typeof member.email === 'string' && member.email.trim().length ? member.email.trim() : null;
    if (fromEmail) {
      return fromEmail;
    }
    return 'familiemedlemmet';
  };

  const confirmDeleteFamily = () => {
    if (!existingFamily?.id || existingFamily.ownerId !== userId) {
      return;
    }

    Alert.alert(
      'Slet familie',
      'Er du sikker på at du vil slette din familie?',
      [
        { text: 'Nej', style: 'cancel' },
        {
          text: 'Ja',
          style: 'destructive',
          onPress: handleDeleteFamily,
        },
      ]
    );
  };

  const confirmRemoveMember = (member) => {
    if (
      !existingFamily?.id ||
      existingFamily.ownerId !== userId ||
      !member?.userId ||
      member.userId === userId
    ) {
      return;
    }

    const label = getMemberDisplayLabel(member);

    Alert.alert(
      'Fjern medlem',
      `Vil du fjerne ${label} fra familien?`,
      [
        { text: 'Annuller', style: 'cancel' },
        {
          text: 'Fjern medlem',
          style: 'destructive',
          onPress: () => handleRemoveMember(member),
        },
      ]
    );
  };

  const handleManageMemberPress = (member) => {
    if (
      !existingFamily?.id ||
      existingFamily.ownerId !== userId ||
      !member?.userId ||
      member.userId === userId
    ) {
      return;
    }

    if (transferringAdminId === member.userId || removingMemberId === member.userId) {
      return;
    }

    const label = getMemberDisplayLabel(member);
    const isTargetOwner = existingFamily.ownerId === member.userId;
    const actions = [];

    if (!isTargetOwner) {
      actions.push({
        text: 'Gør til administrator',
        onPress: () => confirmTransferOwnership(member),
      });
    }

    actions.push({
      text: 'Fjern medlem',
      style: 'destructive',
      onPress: () => confirmRemoveMember(member),
    });

    actions.push({ text: 'Luk', style: 'cancel' });

    Alert.alert(label, 'Vælg handling', actions);
  };

  const confirmTransferOwnership = (member) => {
    if (
      !existingFamily?.id ||
      existingFamily.ownerId !== userId ||
      !member?.userId ||
      member.userId === userId
    ) {
      return;
    }

    const label = getMemberDisplayLabel(member);

    Alert.alert(
      'Overdrag administrator',
      `Er du sikker på, at du vil gøre ${label} til administrator? Du mister dine administratorrettigheder.`,
      [
        { text: 'Annuller', style: 'cancel' },
        {
          text: 'Ja',
          style: 'destructive',
          onPress: () => handleTransferOwnership(member),
        },
      ]
    );
  };

  const handleTransferOwnership = async (member) => {
    if (
      !existingFamily?.id ||
      existingFamily.ownerId !== userId ||
      !member?.userId ||
      member.userId === userId
    ) {
      setError('Kun familiens ejer kan overdrage administratorrettigheder.');
      return;
    }

    try {
      setTransferringAdminId(member.userId);
      setError('');
      setStatusMessage('');

      const familyRef = db.collection('families').doc(existingFamily.id);
      const familyDoc = await familyRef.get();

      if (!familyDoc.exists) {
        setError('Familien blev ikke fundet. Opdater siden og prøv igen.');
        return;
      }

      const data = familyDoc.data() ?? {};
      if (data.ownerId && data.ownerId !== userId) {
        setError('Administratorrollen er allerede overdraget. Opdater siden og prøv igen.');
        return;
      }

      const members = Array.isArray(data.members) ? [...data.members] : [];
      const targetIndex = members.findIndex((item) => item.userId === member.userId);
      const currentIndex = members.findIndex((item) => item.userId === userId);

      if (targetIndex === -1 || currentIndex === -1) {
        setError('Kunne ikke finde alle familiemedlemmer. Opdater siden og prøv igen.');
        return;
      }

      const normalizedTargetEmail =
        typeof members[targetIndex].email === 'string' && members[targetIndex].email.trim().length
          ? members[targetIndex].email.trim().toLowerCase()
          : typeof member.email === 'string' && member.email.trim().length
            ? member.email.trim().toLowerCase()
            : '';

      members[targetIndex] = {
        ...members[targetIndex],
        role: 'admin',
      };

      members[currentIndex] = {
        ...members[currentIndex],
        role: 'member',
      };

      await familyRef.update({
        members,
        ownerId: member.userId,
        ownerEmail: normalizedTargetEmail || firebase.firestore.FieldValue.delete(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });

      await Promise.all([
        db
          .collection('users')
          .doc(member.userId)
          .set(
            {
              familyRole: 'admin',
            },
            { merge: true }
          ),
        db
          .collection('users')
          .doc(userId)
          .set(
            {
              familyRole: 'member',
            },
            { merge: true }
          ),
      ]);

      setExistingFamily((prev) =>
        prev
          ? {
              ...prev,
              ownerId: member.userId,
              ownerEmail: normalizedTargetEmail || '',
              members,
            }
          : prev
      );

      const label = getMemberDisplayLabel(member);
      setStatusMessage(`${label} er nu administrator af familien.`);
    } catch (_transferError) {
      setError('Kunne ikke overdrage administratorrollen. Prøv igen.');
    } finally {
      setTransferringAdminId('');
    }
  };

  const handleRemoveMember = async (member) => {
    if (
      !existingFamily?.id ||
      existingFamily.ownerId !== userId ||
      !member?.userId ||
      member.userId === userId
    ) {
      setError('Kun familiens ejer kan fjerne medlemmer.');
      return;
    }

    try {
      setRemovingMemberId(member.userId);
      setError('');
      setStatusMessage('');

      const familyRef = db.collection('families').doc(existingFamily.id);
      const familyDoc = await familyRef.get();

      if (!familyDoc.exists) {
        setError('Familien blev ikke fundet. Opdater siden og prøv igen.');
        return;
      }

      const data = familyDoc.data() ?? {};
      let members = Array.isArray(data.members) ? [...data.members] : [];
      members = members.filter((item) => item.userId !== member.userId);

      const targetEmailLower =
        typeof member.email === 'string' && member.email.trim().length
          ? member.email.trim().toLowerCase()
          : '';

      const pendingInvites = Array.isArray(data.pendingInvites)
        ? data.pendingInvites.filter(
            (email) => typeof email === 'string' && email.toLowerCase() !== targetEmailLower
          )
        : [];

      await familyRef.update({
        members,
        pendingInvites,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });

      await db
        .collection('users')
        .doc(member.userId)
        .set(
          {
            familyId: firebase.firestore.FieldValue.delete(),
            familyRole: firebase.firestore.FieldValue.delete(),
          },
          { merge: true }
        );

      await db
        .collection('calendar')
        .doc(member.userId)
        .set(
          {
            familyEventRefs: {},
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

      setExistingFamily((prev) =>
        prev
          ? {
              ...prev,
              members,
              pendingInvites,
            }
          : prev
      );

      const label = getMemberDisplayLabel(member);
      setStatusMessage(`${label} er fjernet fra familien.`);
    } catch (_removeError) {
      setError('Kunne ikke fjerne medlemmet. Prøv igen.');
    } finally {
      setRemovingMemberId('');
    }
  };

  const handleApproveRequest = async (request) => {
    if (
      !existingFamily?.id ||
      existingFamily.ownerId !== userId ||
      !request?.userId
    ) {
      setError('Kun familiens ejer kan godkende anmodninger.');
      return;
    }

    try {
      setApprovingRequestIds((prev) => [...prev, request.userId]);
      setError('');
      setStatusMessage('');

      const familyRef = db.collection('families').doc(existingFamily.id);
      const familyDoc = await familyRef.get();

      if (!familyDoc.exists) {
        setError('Familien blev ikke fundet. Opdater siden og prøv igen.');
        return;
      }

      const data = familyDoc.data() ?? {};
      let joinRequests = Array.isArray(data.joinRequests) ? [...data.joinRequests] : [];
      const targetRequest = joinRequests.find((item) => item.userId === request.userId);

      if (!targetRequest) {
        setStatusMessage('Anmodningen er allerede håndteret.');
        return;
      }

      joinRequests = joinRequests.filter((item) => item.userId !== request.userId);

      let members = Array.isArray(data.members) ? [...data.members] : [];
      const alreadyMember = members.some((member) => member.userId === request.userId);

      if (!alreadyMember) {
        const normalizedEmail =
          typeof targetRequest.email === 'string' && targetRequest.email.trim().length
            ? targetRequest.email.trim().toLowerCase()
            : '';
        members.push({
          userId: request.userId,
          email: normalizedEmail,
          role: 'member',
          displayName:
            typeof targetRequest.displayName === 'string'
              ? targetRequest.displayName
              : '',
          name:
            typeof targetRequest.name === 'string' ? targetRequest.name : '',
        });
      }

      const normalizedEmail =
        typeof targetRequest?.email === 'string' && targetRequest.email.trim().length
          ? targetRequest.email.trim().toLowerCase()
          : '';
      const pendingInvites = Array.isArray(data.pendingInvites)
        ? data.pendingInvites.filter(
            (email) => typeof email === 'string' && email.toLowerCase() !== normalizedEmail
          )
        : [];

      await familyRef.update({
        members,
        joinRequests,
        pendingInvites,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });

      await db
        .collection('users')
        .doc(request.userId)
        .set(
          {
            familyId: familyRef.id,
            familyRole: 'member',
          },
          { merge: true }
        );

      setExistingFamily((prev) =>
        prev
          ? {
              ...prev,
              members,
              joinRequests,
              pendingInvites,
            }
          : prev
      );

      const label = getMemberDisplayLabel(targetRequest);
      setStatusMessage(`${label} er nu medlem af familien.`);
    } catch (_approveError) {
      setError('Kunne ikke godkende anmodningen. Prøv igen.');
    } finally {
      setApprovingRequestIds((prev) => prev.filter((id) => id !== request.userId));
    }
  };

  const handleRejectRequest = async (request) => {
    if (
      !existingFamily?.id ||
      existingFamily.ownerId !== userId ||
      !request?.userId
    ) {
      setError('Kun familiens ejer kan afvise anmodninger.');
      return;
    }

    try {
      setRejectingRequestIds((prev) => [...prev, request.userId]);
      setError('');
      setStatusMessage('');

      const familyRef = db.collection('families').doc(existingFamily.id);
      const familyDoc = await familyRef.get();

      if (!familyDoc.exists) {
        setError('Familien blev ikke fundet. Opdater siden og prøv igen.');
        return;
      }

      const data = familyDoc.data() ?? {};
      let joinRequests = Array.isArray(data.joinRequests) ? [...data.joinRequests] : [];
      const beforeLength = joinRequests.length;
      joinRequests = joinRequests.filter((item) => item.userId !== request.userId);

      if (beforeLength === joinRequests.length) {
        setStatusMessage('Anmodningen er allerede håndteret.');
        return;
      }

      await familyRef.update({
        joinRequests,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });

      setExistingFamily((prev) =>
        prev
          ? {
              ...prev,
              joinRequests,
            }
          : prev
      );

      const label = getMemberDisplayLabel(request);
      setStatusMessage(`${label} er afvist.`);
    } catch (_rejectError) {
      setError('Kunne ikke afvise anmodningen. Prøv igen.');
    } finally {
      setRejectingRequestIds((prev) => prev.filter((id) => id !== request.userId));
    }
  };

  const handleRequestPress = (request) => {
    if (
      !existingFamily?.id ||
      existingFamily.ownerId !== userId ||
      !request?.userId
    ) {
      return;
    }

    if (
      approvingRequestIds.includes(request.userId) ||
      rejectingRequestIds.includes(request.userId)
    ) {
      return;
    }

    const label = getMemberDisplayLabel(request);

    Alert.alert(label, 'Hvordan vil du håndtere anmodningen?', [
      {
        text: 'Afvis',
        style: 'destructive',
        onPress: () => handleRejectRequest(request),
      },
      {
        text: 'Accepter',
        onPress: () => handleApproveRequest(request),
      },
      { text: 'Luk', style: 'cancel' },
    ]);
  };


  const handleDeleteFamily = async () => {
    if (!existingFamily?.id || existingFamily.ownerId !== userId) {
      setError('Kun familiens ejer kan slette familien.');
      return;
    }

    try {
      setDeletingFamily(true);
      setError('');
      setStatusMessage('');

      const familyRef = db.collection('families').doc(existingFamily.id);
      const familyDoc = await familyRef.get();
      const docData = familyDoc.exists ? familyDoc.data() ?? {} : {};
      const membersFromDoc = Array.isArray(docData.members)
        ? docData.members
        : Array.isArray(existingFamily.members)
          ? existingFamily.members
          : [];

      const memberIds = Array.from(
        new Set(
          membersFromDoc
            .map((member) =>
              typeof member?.userId === 'string' ? member.userId : ''
            )
            .filter((id) => id.length > 0)
        )
      );

      if (memberIds.length) {
        await Promise.all(
          memberIds.map((memberId) =>
            db
              .collection('users')
              .doc(memberId)
              .set(
                {
                  familyId: firebase.firestore.FieldValue.delete(),
                  familyRole: firebase.firestore.FieldValue.delete(),
                },
                { merge: true }
              )
          )
        );

        await Promise.all(
          memberIds.map((memberId) =>
            db
              .collection('calendar')
              .doc(memberId)
              .set(
                {
                  familyEventRefs: {},
                  updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                },
                { merge: true }
              )
          )
        );
      }

      await familyRef.delete();

      setExistingFamily(null);
      setMode('create');
      setFamilyName('');
      setFamilyCode('');
      setCopyFeedback('');
      setStatusMessage(
        'Familien er slettet. Du kan nu oprette eller tilslutte en ny familie.'
      );
    } catch (_deleteError) {
      setError('Kunne ikke slette familien. Prøv igen.');
    } finally {
      setDeletingFamily(false);
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
    const isCurrentOwner = existingFamily.ownerId === userId;
    const joinRequests = Array.isArray(existingFamily.joinRequests)
      ? existingFamily.joinRequests
      : [];

    return (
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.container}>
        <View style={styles.heroCard}>
          <Text style={styles.heroTitle}>
            {`Familien "${existingFamily.name || 'FamTime'}" er oprettet.`}
          </Text>
          <Text style={styles.heroSubtitle}>
            {existingFamily.name
              ? `Del familie-ID'et med ${existingFamily.name}, så alle kan komme med i FamTime.`
              : "Del familie-ID'et med dine familiemedlemmer, så de kan tilslutte sig."}
          </Text>
          <View style={styles.familyCodeRow}>
            <View style={styles.familyCodePill}>
              <Text style={styles.familyCodeLabel}>Familie ID</Text>
              <Text style={styles.familyCodeValue}>{existingFamily.id}</Text>
            </View>
            <Pressable
              onPress={async () => {
                await Clipboard.setStringAsync(existingFamily.id);
                setCopyFeedback('Familie ID kopieret.');
                setTimeout(() => setCopyFeedback(''), 2500);
              }}
              style={styles.copyIdButton}
            >
              <Text style={styles.copyIdButtonText}>Kopier ID</Text>
            </Pressable>
          </View>
          {copyFeedback ? (
            <Text style={styles.copyFeedback}>{copyFeedback}</Text>
          ) : null}
        </View>

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
              members.map((member) => {
                const label = getMemberDisplayLabel(member);
                const memberIsOwner = existingFamily.ownerId === member.userId;
                const roleLabel = memberIsOwner
                  ? '(Administrator)'
                  : member.role === 'admin'
                    ? '(Administrator)'
                    : '(Medlem)';
                const canManageMember =
                  isCurrentOwner && member.userId && member.userId !== userId;
                const isMemberBusy =
                  transferringAdminId === member.userId || removingMemberId === member.userId;
                const isInteractive = canManageMember && !isMemberBusy;
                const key = member.userId || label;

                return (
                  <Pressable
                    key={key}
                    onPress={() => handleManageMemberPress(member)}
                    disabled={!isInteractive}
                    style={[
                      styles.familyMemberRow,
                      isInteractive ? styles.familyMemberButton : null,
                    ]}
                  >
                    <Text
                      style={[
                        styles.familyCardText,
                        isInteractive ? styles.familyMemberActionText : null,
                      ]}
                    >
                      {label} {roleLabel}
                    </Text>
                  </Pressable>
                );
              })
            )}
            {isCurrentOwner ? (
              <>
                <Text style={[styles.familyCardTitle, styles.requestsTitle]}>
                  Anmodninger
                </Text>
                {joinRequests.length ? (
                  joinRequests.map((request) => {
                    const label = getMemberDisplayLabel(request);
                    const isBusy =
                      approvingRequestIds.includes(request.userId) ||
                      rejectingRequestIds.includes(request.userId);
                    return (
                      <Pressable
                        key={request.userId || label}
                        onPress={() => handleRequestPress(request)}
                        disabled={isBusy}
                        style={[
                          styles.familyMemberRow,
                          styles.familyMemberButton,
                        ]}
                      >
                        <Text
                          style={[
                            styles.familyCardText,
                            styles.familyMemberActionText,
                          ]}
                        >
                          {label} (Afventer godkendelse)
                        </Text>
                      </Pressable>
                    );
                  })
                ) : (
                  <Text style={styles.familyCardText}>
                    Ingen anmodninger lige nu.
                  </Text>
                )}
              </>
            ) : null}
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

          {existingFamily.ownerId === userId ? (
            <Button
              title="Slet familie"
              onPress={confirmDeleteFamily}
              loading={deletingFamily}
              style={styles.deleteButton}
            />
          ) : null}

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



export default FamilySetupScreen;
