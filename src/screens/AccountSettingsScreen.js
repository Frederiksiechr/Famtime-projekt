/**
 * AccountSettingsScreen
 *
 * - Samler brugerens kontoindstillinger, familiestatus og eventuelle invitationer.
 * - Giver mulighed for at acceptere familieinvitationer og se teamet.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Button from '../components/Button';
import ErrorMessage from '../components/ErrorMessage';
import { auth, db, firebase } from '../lib/firebase';
import { colors, spacing, fontSizes, radius } from '../styles/theme';
import { DEFAULT_AVATAR_EMOJI } from '../constants/avatarEmojis';

const WEEK_DAY_LABELS = {
  monday: 'Mandag',
  tuesday: 'Tirsdag',
  wednesday: 'Onsdag',
  thursday: 'Torsdag',
  friday: 'Fredag',
  saturday: 'Lørdag',
  sunday: 'Søndag',
};

const extractPrimaryTimeWindow = (timeWindows = {}) => {
  if (!timeWindows || typeof timeWindows !== 'object') {
    return { start: '', end: '' };
  }

  const candidates = [];

  if (Array.isArray(timeWindows.default) && timeWindows.default.length) {
    candidates.push(timeWindows.default[0]);
  }

  Object.keys(timeWindows).forEach((key) => {
    if (key === 'default') {
      return;
    }
    const entry = timeWindows[key];
    if (Array.isArray(entry) && entry.length) {
      candidates.push(entry[0]);
    }
  });

  const firstValid = candidates.find((candidate) => {
    if (!candidate || typeof candidate !== 'object') {
      return false;
    }
    const readStart = typeof candidate.start === 'string'
      ? candidate.start
      : typeof candidate.get === 'function'
        ? candidate.get('start')
        : null;
    const readEnd = typeof candidate.end === 'string'
      ? candidate.end
      : typeof candidate.get === 'function'
        ? candidate.get('end')
        : null;
    return typeof readStart === 'string' && typeof readEnd === 'string';
  });

  if (!firstValid) {
    return { start: '', end: '' };
  }

  const readValue = (key) => {
    if (typeof firstValid[key] === 'string') {
      return firstValid[key];
    }
    if (typeof firstValid.get === 'function') {
      const value = firstValid.get(key);
      return typeof value === 'string' ? value : '';
    }
    return '';
  };

  return {
    start: readValue('start'),
    end: readValue('end'),
  };
};

const formatTimeWindow = (start, end) => {
  if (typeof start === 'string' && start && typeof end === 'string' && end) {
    return `${start} - ${end}`;
  }
  return 'Ikke udfyldt';
};

const formatDurationRange = (min, max) => {
  const minValid = Number.isFinite(min);
  const maxValid = Number.isFinite(max);

  if (minValid && maxValid) {
    return `${min} - ${max} min`;
  }
  if (minValid) {
    return `Min. ${min} min`;
  }
  if (maxValid) {
    return `Op til ${max} min`;
  }
  return 'Ikke udfyldt';
};

const formatPreferredDays = (days) => {
  if (!Array.isArray(days) || !days.length) {
    return 'Ikke udfyldt';
  }

  const labels = days
    .map((dayKey) => WEEK_DAY_LABELS[dayKey])
    .filter((label) => typeof label === 'string' && label.length > 0);

  return labels.length ? labels.join(', ') : 'Ikke udfyldt';
};

const AccountSettingsScreen = ({ navigation }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [userProfile, setUserProfile] = useState(null);
  const [family, setFamily] = useState(null);
  const [invites, setInvites] = useState([]);
  const [actionError, setActionError] = useState('');
  const [acceptingIds, setAcceptingIds] = useState([]);
  const [leavingFamily, setLeavingFamily] = useState(false);
  const [deletingProfile, setDeletingProfile] = useState(false);
  const [removingMemberIds, setRemovingMemberIds] = useState([]);

  const currentUser = auth.currentUser;
  const userEmail = currentUser?.email ?? '';
  const userEmailLower = useMemo(() => userEmail.toLowerCase(), [userEmail]);

  useEffect(() => {
    if (!currentUser) {
      setError('Ingen aktiv bruger fundet. Log ind igen.');
      setLoading(false);
      return;
    }

    let unsubscribeFamily = null;
    let unsubscribeInvites = null;

    const ensureInvitesSubscription = () => {
      if (unsubscribeInvites) {
        return;
      }

      unsubscribeInvites = db
        .collection('families')
        .where('pendingInvites', 'array-contains', userEmailLower)
        .onSnapshot(
          (snapshot) => {
            const nextInvites = snapshot.docs.map((doc) => {
              const data = doc.data() ?? {};
              return {
                id: doc.id,
                name: data.name ?? 'FamTime familie',
                ownerEmail: data.ownerEmail ?? '',
              };
            });
            setInvites(nextInvites);
          },
          () => {
            setInvites([]);
          }
        );
    };

    const loadProfile = async () => {
      try {
        setLoading(true);
        setError('');
        setStatusMessage('');

        const userDoc = await db.collection('users').doc(currentUser.uid).get();
        const userData = userDoc.data() ?? {};

        const primaryTimeWindow = extractPrimaryTimeWindow(
          userData.preferredFamilyTimeWindows
        );
        const minDurationMinutes = Number.isFinite(
          userData.preferredFamilyMinDurationMinutes
        )
          ? userData.preferredFamilyMinDurationMinutes
          : null;
        const maxDurationMinutes = Number.isFinite(
          userData.preferredFamilyMaxDurationMinutes
        )
          ? userData.preferredFamilyMaxDurationMinutes
          : null;

        setUserProfile({
          email: userEmail,
          name: userData.name ?? '',
          age: userData.age ?? '',
          gender: userData.gender ?? '',
          location: userData.location ?? '',
          familyRole: userData.familyRole ?? '',
          familyId: userData.familyId ?? '',
          preferredFamilyFrequency:
            typeof userData.preferredFamilyFrequency === 'number'
              ? userData.preferredFamilyFrequency
              : null,
          preferredFamilyDays: Array.isArray(userData.preferredFamilyDays)
            ? userData.preferredFamilyDays
            : [],
          preferredTimeStart:
            typeof primaryTimeWindow.start === 'string'
              ? primaryTimeWindow.start
              : '',
          preferredTimeEnd:
            typeof primaryTimeWindow.end === 'string' ? primaryTimeWindow.end : '',
          preferredMinDuration: minDurationMinutes,
          preferredMaxDuration: maxDurationMinutes,
          avatarEmoji:
            typeof userData.avatarEmoji === 'string' && userData.avatarEmoji.trim().length
              ? userData.avatarEmoji.trim()
              : DEFAULT_AVATAR_EMOJI,
        });

        if (unsubscribeFamily) {
          unsubscribeFamily();
          unsubscribeFamily = null;
        }

        if (userData.familyId) {
          unsubscribeFamily = db
            .collection('families')
            .doc(userData.familyId)
            .onSnapshot((snapshot) => {
              if (!snapshot.exists) {
                setFamily(null);
                return;
              }

              const data = snapshot.data() ?? {};
              const normalizedMembers = Array.isArray(data.members)
                ? data.members.map((member) => ({
                    ...member,
                    avatarEmoji:
                      typeof member?.avatarEmoji === 'string' && member.avatarEmoji.trim().length
                        ? member.avatarEmoji.trim()
                        : DEFAULT_AVATAR_EMOJI,
                    displayName:
                      typeof member?.displayName === 'string' && member.displayName.trim().length
                        ? member.displayName.trim()
                        : typeof member?.name === 'string' && member.name.trim().length
                          ? member.name.trim()
                          : member?.displayName,
                  }))
                : [];
              setFamily({
                id: snapshot.id,
                name: data.name ?? 'FamTime familie',
                members: normalizedMembers,
                pendingInvites: Array.isArray(data.pendingInvites)
                  ? data.pendingInvites
                  : [],
                ownerEmail: data.ownerEmail ?? '',
                ownerId: data.ownerId ?? '',
              });
            });
        } else {
          setFamily(null);
        }

        ensureInvitesSubscription();
      } catch (_error) {
        setError('Kunne ikke hente kontooplysninger. Prøv igen senere.');
      } finally {
        setLoading(false);
      }
    };

    ensureInvitesSubscription();
    loadProfile();

    const unsubscribeFocus = navigation.addListener('focus', loadProfile);

    return () => {
      if (unsubscribeFamily) {
        unsubscribeFamily();
      }
      if (unsubscribeInvites) {
        unsubscribeInvites();
      }
      unsubscribeFocus();
    };
  }, [currentUser, navigation, userEmail, userEmailLower]);

  const handleAcceptInvite = async (familyId) => {
    if (!currentUser) {
      return;
    }

    try {
      setAcceptingIds((prev) => [...prev, familyId]);
      setActionError('');
      setStatusMessage('');

      const familyRef = db.collection('families').doc(familyId);
      const familyDoc = await familyRef.get();

      if (!familyDoc.exists) {
        setActionError('Familien findes ikke længere.');
        return;
      }

      const familyData = familyDoc.data() ?? {};
      let members = Array.isArray(familyData.members)
        ? [...familyData.members]
        : [];

      const alreadyMember = members.some(
        (member) => member.userId === currentUser.uid
      );

      const currentEmoji =
        typeof userProfile?.avatarEmoji === 'string' && userProfile.avatarEmoji.trim().length
          ? userProfile.avatarEmoji.trim()
          : DEFAULT_AVATAR_EMOJI;
      const currentName =
        typeof userProfile?.name === 'string' && userProfile.name.trim().length
          ? userProfile.name.trim()
          : currentUser.email ?? 'Familiemedlem';

      if (!alreadyMember) {
        members.push({
          userId: currentUser.uid,
          email: userEmailLower,
          role: 'member',
          avatarEmoji: currentEmoji,
          displayName: currentName,
          name: currentName,
        });
      }

      members = members.map((member) => {
        if (!member || typeof member !== 'object') {
          return member;
        }

        if (member.userId === currentUser.uid) {
          return {
            ...member,
            email: userEmailLower,
            role: member.role || 'member',
            avatarEmoji: currentEmoji,
            displayName: currentName,
            name: currentName,
          };
        }

        if (
          typeof member.avatarEmoji !== 'string' ||
          !member.avatarEmoji.trim().length
        ) {
          return {
            ...member,
            avatarEmoji: DEFAULT_AVATAR_EMOJI,
          };
        }

        return member;
      });

      const pendingInvites = Array.isArray(familyData.pendingInvites)
        ? familyData.pendingInvites.filter(
            (email) =>
              typeof email === 'string' && email.toLowerCase() !== userEmailLower
          )
        : [];

      await familyRef.update({
        members,
        pendingInvites,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });

      await db.collection('users').doc(currentUser.uid).set(
        {
          familyId: familyRef.id,
          familyRole: 'member',
          avatarEmoji: currentEmoji,
        },
        { merge: true }
      );

      setStatusMessage('Invitation accepteret. Du er nu medlem af familien.');
    } catch (_error) {
      setActionError('Kunne ikke acceptere invitationen. Prøv igen.');
    } finally {
      setAcceptingIds((prev) => prev.filter((id) => id !== familyId));
    }
  };

  const handleOpenProfile = () => {
    navigation.navigate('Landing', { mode: 'edit' });
  };

  const handleFamilySetup = () => {
    navigation.navigate('FamilySetup');
  };

  const determineRoleLabel = (role) => {
    if (typeof role !== 'string') {
      return 'Medlem';
    }
    const normalized = role.trim().toLowerCase();
    if (normalized === 'owner' || normalized === 'admin') {
      return 'Administrator';
    }
    return 'Medlem';
  };

  const canCurrentUserManageFamily = () => {
    const currentRole = determineRoleLabel(userProfile?.familyRole);
    if (currentRole !== 'Administrator') {
      return false;
    }
    const ownerEmailLower = typeof family?.ownerEmail === 'string' ? family.ownerEmail.toLowerCase() : '';
    if (ownerEmailLower && ownerEmailLower !== userEmailLower) {
      return false;
    }
    return true;
  };

  const prepareOwnerTransfer = (member) => {
    if (!member || !member.userId) {
      return;
    }
    handleLeaveFamily(member);
  };

  const confirmLeaveFamily = () => {
    if (!family?.id || !currentUser) {
      return;
    }

    const isOwner = canCurrentUserManageFamily();
    const memberOptions = (family.members || []).filter(
      (member) => member.userId && member.userId !== currentUser.uid
    );

    if (isOwner && memberOptions.length) {
      const memberChoices = memberOptions
        .map((member) => member.displayName || member.name || member.email || 'Familiemedlem');

      Alert.alert(
        'Overdrag administrator',
        'Vælg hvem der skal være administrator, før du forlader familien.',
        [
          { text: 'Annuller', style: 'cancel' },
          ...memberChoices.map((label, index) => ({
            text: label,
            onPress: () => prepareOwnerTransfer(memberOptions[index]),
          })),
        ]
      );
      return;
    }

    Alert.alert(
      'Forlad familie',
      'Er du sikker på, at du vil forlade familien? Du mister adgangen til familieevents.',
      [
        { text: 'Annuller', style: 'cancel' },
        { text: 'Forlad', style: 'destructive', onPress: () => handleLeaveFamily() },
      ]
    );
  };

  const handleLeaveFamily = async (nextOwnerMember = null) => {
    if (!family?.id || !currentUser) {
      return false;
    }

    try {
      setLeavingFamily(true);
      setActionError('');
      setStatusMessage('');

      const familyRef = db.collection('families').doc(family.id);
      const familyDoc = await familyRef.get();

      if (familyDoc.exists) {
        const data = familyDoc.data() ?? {};
        let members = Array.isArray(data.members) ? [...data.members] : [];
        members = members.filter((member) => member.userId !== currentUser.uid);

        const pendingInvites = Array.isArray(data.pendingInvites)
          ? data.pendingInvites.filter((email) => email !== userEmailLower)
          : [];

        const updates = {
          members,
          pendingInvites,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        };

        if (data.ownerId === currentUser.uid) {
          if (nextOwnerMember && nextOwnerMember.userId) {
            const ownerIndex = members.findIndex((member) => member.userId === nextOwnerMember.userId);
            if (ownerIndex !== -1) {
              members[ownerIndex] = {
                ...members[ownerIndex],
                role: 'admin',
              };
              updates.members = members;
              updates.ownerId = nextOwnerMember.userId;
              updates.ownerEmail =
                typeof members[ownerIndex].email === 'string'
                  ? members[ownerIndex].email
                  : nextOwnerMember.email ?? '';
            }
          } else if (members.length > 0) {
            const nextAdmin = {
              ...members[0],
              role: 'admin',
            };
            members[0] = nextAdmin;
            updates.members = members;
            updates.ownerId = nextAdmin.userId ?? '';
            updates.ownerEmail = nextAdmin.email ?? '';
          } else {
            updates.ownerId = firebase.firestore.FieldValue.delete();
            updates.ownerEmail = firebase.firestore.FieldValue.delete();
          }
        }

        await familyRef.set(updates, { merge: true });
      }

      await db
        .collection('users')
        .doc(currentUser.uid)
        .set(
          {
            familyId: firebase.firestore.FieldValue.delete(),
            familyRole: firebase.firestore.FieldValue.delete(),
          },
          { merge: true }
        );

      await db
        .collection('calendar')
        .doc(currentUser.uid)
        .set(
          {
            familyEventRefs: {},
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

      setFamily(null);
      setUserProfile((prev) =>
        prev ? { ...prev, familyId: '', familyRole: '' } : prev
      );
      setStatusMessage('Du har forladt familien.');
      return true;
    } catch (_leaveError) {
      setActionError('Kunne ikke forlade familien. Prøv igen.');
      return false;
    } finally {
      setLeavingFamily(false);
    }
  };

  const handleRemoveMember = async (member) => {
    if (!family?.id || !member?.userId) {
      return;
    }

    try {
      setRemovingMemberIds((prev) => [...prev, member.userId]);
      setActionError('');
      setStatusMessage('');

      const familyRef = db.collection('families').doc(family.id);
      const familyDoc = await familyRef.get();

      if (!familyDoc.exists) {
        setActionError('Familien blev ikke fundet. Prøv at opdatere siden.');
        return;
      }

      const data = familyDoc.data() ?? {};
      let members = Array.isArray(data.members) ? [...data.members] : [];
      members = members.filter((item) => item.userId !== member.userId);

      const targetEmailLower = typeof member.email === 'string' ? member.email.toLowerCase() : '';
      const pendingInvites = Array.isArray(data.pendingInvites)
        ? data.pendingInvites.filter((email) => email !== targetEmailLower)
        : [];

      const updates = {
        members,
        pendingInvites,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      };

      if (data.ownerId === member.userId) {
        if (members.length > 0) {
          const nextAdmin = {
            ...members[0],
            role: 'admin',
          };
          members[0] = nextAdmin;
          updates.members = members;
          updates.ownerId = nextAdmin.userId ?? '';
          updates.ownerEmail = nextAdmin.email ?? '';
        } else {
          updates.ownerId = firebase.firestore.FieldValue.delete();
          updates.ownerEmail = firebase.firestore.FieldValue.delete();
        }
      }

      await familyRef.set(updates, { merge: true });

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

      setStatusMessage(`${member.email ?? 'Medlemmet'} er fjernet fra familien.`);
    } catch (_error) {
      setActionError('Kunne ikke fjerne medlemmet. Prøv igen.');
    } finally {
      setRemovingMemberIds((prev) => prev.filter((id) => id !== member.userId));
    }
  };

  const confirmDeleteProfile = () => {
    if (!currentUser || deletingProfile) {
      return;
    }

    const promptDeleteApproval = (nextOwnerMember = null) => {
      Alert.alert(
        'Slet profil',
        'Er du sikker på at du vil slette din profil?',
        [
          { text: 'Nej', style: 'cancel' },
          {
            text: 'Ja',
            style: 'destructive',
            onPress: () => handleDeleteProfile(nextOwnerMember),
          },
        ]
      );
    };

    if (family?.id && canCurrentUserManageFamily()) {
      const memberOptions = (family.members || []).filter(
        (member) => member.userId && member.userId !== currentUser.uid
      );

      if (memberOptions.length) {
        const memberChoices = memberOptions.map(
          (member) => member.displayName || member.name || member.email || 'Familiemedlem'
        );

        Alert.alert(
          'Overdrag administrator',
          'Vælg hvem der skal være administrator, før du sletter din profil.',
          [
            { text: 'Annuller', style: 'cancel' },
            ...memberChoices.map((label, index) => ({
              text: label,
              onPress: () => promptDeleteApproval(memberOptions[index]),
            })),
          ]
        );
        return;
      }
    }

    promptDeleteApproval();
  };

  const handleDeleteProfile = async (nextOwnerMember = null) => {
    if (!currentUser) {
      setActionError('Ingen aktiv bruger fundet. Log ind igen.');
      return;
    }

    try {
      setDeletingProfile(true);
      setActionError('');
      setStatusMessage('');

      if (family?.id) {
        const leftSuccessfully = await handleLeaveFamily(nextOwnerMember);
        if (!leftSuccessfully) {
          return;
        }
      }

      const userDocRef = db.collection('users').doc(currentUser.uid);
      const calendarDocRef = db.collection('calendar').doc(currentUser.uid);
      const [userSnapshot, calendarSnapshot] = await Promise.all([
        userDocRef.get(),
        calendarDocRef.get(),
      ]);
      const userBackup = userSnapshot.exists ? userSnapshot.data() : null;
      const calendarBackup = calendarSnapshot.exists ? calendarSnapshot.data() : null;

      if (calendarSnapshot.exists) {
        await calendarDocRef.delete();
      }
      if (userSnapshot.exists) {
        await userDocRef.delete();
      }

      const activeUser = auth.currentUser;
      if (!activeUser) {
        setStatusMessage('Din profil er slettet. Du logges nu ud.');
        await auth.signOut().catch(() => {});
        return;
      }

      try {
        await activeUser.delete();
      } catch (authError) {
        if (userBackup) {
          try {
            await userDocRef.set(userBackup);
          } catch (_restoreUserError) {
            // ignore restore issues
          }
        }
        if (calendarBackup) {
          try {
            await calendarDocRef.set(calendarBackup);
          } catch (_restoreCalendarError) {
            // ignore restore issues
          }
        }

        const message =
          typeof authError?.message === 'string' ? authError.message : '';
        if (
          authError?.code === 'auth/requires-recent-login' ||
          message.includes('requires-recent-login')
        ) {
          setActionError(
            'Af sikkerhedshensyn skal du logge ind igen, før du kan slette din profil.'
          );
          return;
        }
        throw authError;
      }

      setStatusMessage('Din profil er slettet. Du logges nu ud.');
      await auth.signOut().catch(() => {});
    } catch (_deleteError) {
      setActionError('Kunne ikke slette din profil. Prøv igen.');
    } finally {
      setDeletingProfile(false);
    }
  };

  const handleLogout = async () => {
    try {
      await auth.signOut();
    } catch (_error) {
      setActionError('Kunne ikke logge ud. Prøv igen.');
    }
  };

  const resolvedUserEmoji =
    typeof userProfile?.avatarEmoji === 'string' && userProfile.avatarEmoji.trim().length
      ? userProfile.avatarEmoji.trim()
      : DEFAULT_AVATAR_EMOJI;

  const shouldShowStatusCard =
    Boolean(error) || Boolean(actionError) || Boolean(statusMessage);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.container}>
          <View style={styles.heroCard}>
            <Text style={styles.title}>Konto & indstillinger</Text>
            <Text style={styles.subtitle}>
              {'Administrer dine oplysninger og hold styr på din familieopsætning.'}
            </Text>
          </View>

          {shouldShowStatusCard ? (
            <View style={styles.card}>
              <ErrorMessage message={error} />
              <ErrorMessage message={actionError} />
              {statusMessage ? (
                <View style={styles.statusPill}>
                  <Text style={styles.statusText}>{statusMessage}</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          <View style={styles.card}>
          <Text style={styles.sectionTitle}>Dine oplysninger</Text>
          {loading ? (
            <Text style={styles.infoText}>Indlæser oplysninger...</Text>
          ) : (
            <>
              <Text style={styles.fieldText}>Din emoji: {resolvedUserEmoji}</Text>
              <Text style={styles.fieldText}>
                Navn: {userProfile?.name || 'Ikke udfyldt'}
              </Text>
              <Text style={styles.fieldText}>
                E-mail: {userProfile?.email || 'Ukendt'}
              </Text>
              <Text style={styles.fieldText}>
                Alder:{' '}
                {userProfile?.age ? String(userProfile.age) : 'Ikke udfyldt'}
              </Text>
              <Text style={styles.fieldText}>
                Køn: {userProfile?.gender || 'Ikke udfyldt'}
              </Text>
              <Text style={styles.fieldText}>
                Lokation: {userProfile?.location || 'Ikke udfyldt'}
              </Text>
              <Text style={styles.fieldText}>
                Ønskede familietider pr. uge:{' '}
                {typeof userProfile?.preferredFamilyFrequency === 'number'
                  ? userProfile.preferredFamilyFrequency
                  : 'Ikke udfyldt'}
              </Text>
              <Text style={styles.fieldText}>
                Foretrukne dage:{' '}
                {formatPreferredDays(userProfile?.preferredFamilyDays)}
              </Text>
              <Text style={styles.fieldText}>
                Foretrukket tidsrum:{' '}
                {formatTimeWindow(
                  userProfile?.preferredTimeStart,
                  userProfile?.preferredTimeEnd
                )}
              </Text>
              <Text style={styles.fieldText}>
                Varighedsgrænser:{' '}
                {formatDurationRange(
                  typeof userProfile?.preferredMinDuration === 'number'
                    ? userProfile.preferredMinDuration
                    : null,
                  typeof userProfile?.preferredMaxDuration === 'number'
                    ? userProfile.preferredMaxDuration
                    : null
                )}
              </Text>
            </>
          )}

          <Button
            title="Opdater profil"
            onPress={handleOpenProfile}
            style={styles.actionButton}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Familieinvitationer</Text>
          {invites.length === 0 ? (
            <Text style={styles.infoText}>Du har ingen åbne invitationer.</Text>
          ) : (
            invites.map((invite) => (
              <View key={invite.id} style={styles.inviteCard}>
                <Text style={styles.inviteTitle}>{invite.name}</Text>
                {invite.ownerEmail ? (
                  <Text style={styles.inviteMeta}>
                    Administrator: {invite.ownerEmail}
                  </Text>
                ) : null}
                <Button
                  title="Accepter invitation"
                  onPress={() => handleAcceptInvite(invite.id)}
                  loading={acceptingIds.includes(invite.id)}
                  style={styles.inviteButton}
                />
              </View>
            ))
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Din familie</Text>
          {family ? (
            <>
              <Text style={styles.fieldText}>Navn: {family.name}</Text>
              <Text style={styles.fieldText}>
                Rolle:{' '}
                {userProfile?.familyRole ? userProfile.familyRole : 'Medlem'}
              </Text>
              <Text style={styles.fieldText}>Familie ID: {family.id}</Text>

              <Text style={styles.sectionSubtitle}>Medlemmer</Text>
              {family.members.length ? (
                family.members.map((member) => {
                  const docEmoji =
                    typeof member?.avatarEmoji === 'string' && member.avatarEmoji.trim().length
                      ? member.avatarEmoji.trim()
                      : DEFAULT_AVATAR_EMOJI;
                  const memberEmoji =
                    member?.userId && currentUser?.uid && member.userId === currentUser.uid
                      ? resolvedUserEmoji
                      : docEmoji;
                  const memberName =
                    typeof member?.displayName === 'string' && member.displayName.trim().length
                      ? member.displayName.trim()
                      : typeof member?.name === 'string' && member.name.trim().length
                        ? member.name.trim()
                        : typeof member?.email === 'string' && member.email.trim().length
                          ? member.email.trim()
                          : 'Familiemedlem';
                  return (
                    <View
                      key={`${member.userId}-${member.email}`}
                      style={styles.memberRow}
                    >
                      <Text style={styles.memberText}>
                        {memberEmoji} {memberName}{' '}
                        {member.role === 'admin' ? '(Administrator)' : '(Medlem)'}
                      </Text>
                    </View>
                  );
                })
              ) : (
                <Text style={styles.infoText}>
                  Ingen medlemmer registreret.
                </Text>
              )}

              {family.pendingInvites.length ? (
                <>
                  <Text style={styles.sectionSubtitle}>
                    Afventende invitationer
                  </Text>
                  {family.pendingInvites.map((email) => (
                    <Text key={email} style={styles.pendingText}>
                      {email}
                    </Text>
                  ))}
                </>
              ) : null}
            </>
          ) : (
            <Text style={styles.infoText}>
              Du er ikke tilknyttet en familie endnu.
            </Text>
          )}

          <Button
            title={family ? 'Administrer familie' : 'Opret/tilslut familie'}
            onPress={handleFamilySetup}
            style={styles.actionButton}
          />
          {family ? (
            <Button
              title="Forlad familie"
              onPress={confirmLeaveFamily}
              loading={leavingFamily}
              style={styles.leaveButton}
            />
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Generelt</Text>
          <Button
            title="Slet profil"
            onPress={confirmDeleteProfile}
            loading={deletingProfile}
            disabled={deletingProfile || leavingFamily}
            style={styles.deleteProfileButton}
          />
          <Button
            title="Log ud af FamTime"
            onPress={handleLogout}
            disabled={deletingProfile}
            style={styles.logoutButton}
          />
        </View>
      </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    backgroundColor: colors.canvas,
  },
  container: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    gap: spacing.lg,
  },
  heroCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    shadowColor: colors.shadow,
    shadowOpacity: 0.3,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
  },
  title: {
    fontSize: fontSizes.xxl,
    fontWeight: '800',
    color: colors.text,
  },
  subtitle: {
    fontSize: fontSizes.md,
    color: colors.mutedText,
    marginTop: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    shadowColor: colors.shadow,
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
    gap: spacing.md,
  },
  statusPill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(230, 138, 46, 0.16)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 999,
  },
  statusText: {
    color: colors.primaryDark,
    fontSize: fontSizes.sm,
    fontWeight: '600',
  },
  infoText: {
    fontSize: fontSizes.sm,
    color: colors.mutedText,
  },
  sectionTitle: {
    fontSize: fontSizes.lg,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  sectionSubtitle: {
    fontSize: fontSizes.md,
    fontWeight: '600',
    color: colors.text,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  fieldText: {
    fontSize: fontSizes.md,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  memberText: {
    fontSize: fontSizes.md,
    color: colors.text,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  pendingText: {
    fontSize: fontSizes.sm,
    color: colors.mutedText,
    marginBottom: spacing.xs,
  },
  inviteCard: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  inviteTitle: {
    fontSize: fontSizes.md,
    fontWeight: '700',
    color: colors.text,
  },
  inviteMeta: {
    fontSize: fontSizes.sm,
    color: colors.mutedText,
    marginBottom: spacing.xs,
  },
  inviteButton: {
    marginTop: spacing.sm,
  },
  leaveButton: {
    marginTop: spacing.sm,
    backgroundColor: colors.error,
  },
  actionButton: {
    marginTop: spacing.md,
  },
  deleteProfileButton: {
    marginTop: spacing.md,
    backgroundColor: colors.error,
  },
  logoutButton: {
    marginTop: spacing.md,
    backgroundColor: colors.error,
  },
});

export default AccountSettingsScreen;
