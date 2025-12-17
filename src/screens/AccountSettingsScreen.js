/**
 * AccountSettingsScreen
 *
 * Hvad gør filen for appen:
 * - Viser konto/familie-status, invitationer og medlemshandlinger ét sted.
 * - Giver knapper til at acceptere invites, forlade/overdrage familie og administrere medlemmer.
 * - Synker live mod Firestore (users/families) for at holde kort/sektioner opdateret.
 * Overblik (hvordan filen er bygget op):
 * - Formatterings-helpers: viser tid/ugedage og opsummerer praef erencer (tidsvinduer/duration) for familien.
 * - State: profil/familie/invites, praef erencevisning, samt UI-tilstande for fejl/status/handlinger (overdragelse/fjern medlem).
 * - Dataflow: lytter live paa `users/{uid}` (familyId/rolle) og `families/{id}` (medlemmer/invites), og mapper medlemmers praef erencer.
 * - Handlinger: accepter invitation, forlad/overdrag familie, fjern medlem eller slet profil; skriver opdateringer til Firestore.
 * - UI: scroll-view med kontokort, familiesektion (medlemmer/praef erencer), invitationer og knapper til handlingerne.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Button from '../components/Button';
import ErrorMessage from '../components/ErrorMessage';
import { auth, db, firebase } from '../lib/firebase';
import { DEFAULT_AVATAR_EMOJI } from '../constants/avatarEmojis';
import {
  FAMILY_PREFERENCE_MODES,
  normalizeFamilyPreferenceMode,
} from '../constants/familyPreferenceModes';
import styles from '../styles/screens/AccountSettingsScreenStyles';

const WEEK_DAY_LABELS = {
  monday: 'Mandag',
  tuesday: 'Tirsdag',
  wednesday: 'Onsdag',
  thursday: 'Torsdag',
  friday: 'Fredag',
  saturday: 'Lørdag',
  sunday: 'Søndag',
};

/**
 * OMREGN TIDSSTRENG TIL MINUTTER
 * Tager en streng som "14:30" og returnerer 870 minutter (siden midnat).
 * Hvis formatet er forkert, returneres null.
 */
const timeStringToMinutes = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  const match = trimmed.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours * 60 + minutes;
};

/**
 * OMREGN MINUTTER TIL TIDSSTRENG
 * 
 * Tager 870 minutter og returnerer "14:30".
 * Sikrer at værdien er mellem 0 og 1439 minutter (midnat til 23:59).
 */
const minutesToTimeString = (minutes) => {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, minutes));
  const hours = String(Math.floor(clamped / 60)).padStart(2, '0');
  const mins = String(clamped % 60).padStart(2, '0');
  return `${hours}:${mins}`;
};

/**
 * SAMLE OVERLAPPENDE TIDSINTERVALLER
 * 
 * Hvis man har to intervaller 14:00-15:30 og 15:00-16:00,
 * bliver de smeltet sammen til 14:00-16:00.
 * 
 * Dette bruges til at rydde op i tidsvinduerne så man ikke har
 * overlappende eller redundante intervaller.
 */
const mergeTimeRanges = (entries = []) => {
  const parsed = entries
    .map((entry) => {
      const start = typeof entry?.start === 'string' ? entry.start.trim() : '';
      const end = typeof entry?.end === 'string' ? entry.end.trim() : '';
      const startMinutes = timeStringToMinutes(start);
      const endMinutes = timeStringToMinutes(end);
      if (
        startMinutes === null ||
        endMinutes === null ||
        endMinutes <= startMinutes
      ) {
        return null;
      }
      return { start: startMinutes, end: endMinutes };
    })
    .filter(Boolean)
    .sort((rangeA, rangeB) => {
      if (rangeA.start !== rangeB.start) {
        return rangeA.start - rangeB.start;
      }
      return rangeA.end - rangeB.end;
    });

  if (!parsed.length) {
    return [];
  }

  const merged = [parsed[0]];
  for (let index = 1; index < parsed.length; index += 1) {
    const current = parsed[index];
    const previous = merged[merged.length - 1];
    if (current.start <= previous.end) {
      previous.end = Math.max(previous.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }

  return merged.map(
    ({ start, end }) =>
      `${minutesToTimeString(start)}-${minutesToTimeString(end)}`
  );
};

/**
 * FORMATERING AF TIDSVINDUEER
 * 
 * Tager tidsvinduerne fra profilen (f.eks. mandag: ["14:00-15:30", "18:00-20:00"])
 * og laver det til en læsbar tekst som:
 * "Mandag: 14:00-15:30 & 18:00-20:00"
 * 
 * Hvis nogle dage ikke er i "foretrukne dage", vises de ikke.
 */
const formatTimeWindows = (timeWindows = {}, preferredDays = []) => {
  if (!timeWindows || typeof timeWindows !== 'object') {
    return 'Ikke udfyldt';
  }

  const preferredDaySet =
    Array.isArray(preferredDays) && preferredDays.length
      ? new Set(preferredDays)
      : null;
  const summaries = [];
  Object.entries(WEEK_DAY_LABELS).forEach(([dayKey, label]) => {
    if (preferredDaySet && !preferredDaySet.has(dayKey)) {
      return;
    }
    const entryList = Array.isArray(timeWindows[dayKey])
      ? timeWindows[dayKey]
      : [];
    const ranges = mergeTimeRanges(entryList);
    if (ranges.length) {
      summaries.push(`${label}: ${ranges.join(' & ')}`);
    }
  });

  if (summaries.length) {
    return summaries.join('\n');
  }
  return 'Ikke udfyldt';
};

/**
 * FORMATERING AF VARIGHED
 * 
 * Viser hvor lang tid en aktivitet skal tage.
 * 
 * Eksempler:
 * - Min: 30, Max: 120 → "30 - 120 min"
 * - Min: 30, Max: null → "Min. 30 min"
 * - Min: null, Max: 120 → "Op til 120 min"
 */
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

/**
 * FORMATERING AF FORETRUKNE DAGE
 * 
 * Tager en liste som ["monday", "friday", "saturday"]
 * og laver den til "Mandag, Fredag, Lørdag"
 */
const formatPreferredDays = (days) => {
  if (!Array.isArray(days) || !days.length) {
    return 'Ikke udfyldt';
  }

  const labels = days
    .map((dayKey) => WEEK_DAY_LABELS[dayKey])
    .filter((label) => typeof label === 'string' && label.length > 0);

  return labels.length ? labels.join(', ') : 'Ikke udfyldt';
};

/**
 * FIND FØRSTE GYLDIG TEKST
 * 
 * Tager flere værdier og returnerer den første der er en ikke-tom streng.
 * 
 * Eksempel: pickFirstString(null, "", "Hej", "Verden") returnerer "Hej"
 * 
 * Bruges til at finde fallback-værdier hvis nogle felter mangler.
 */
const pickFirstString = (...values) => {
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (typeof value !== 'string') {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length) {
      return trimmed;
    }
  }
  return '';
};

/**
 * FORMATERING AF PRÆFERENCE-KILDE
 * 
 * Viser hvor medlemmets tid-præferencer kommer fra:
 * - "Ingen præferencer" = medlemmet har ikke udfyldt sin kalender
 * - "Følger Jens" = medlemmet bruger Jens' kalender automatisk
 * - "Tilpasset" = medlemmet har selv udfyldt deres egen kalender
 * 
 * Dette bruges til at vise andre medlemmer hvad der styrer denne persons tilgængelighed.
 * 
 * Eksempel:
 * - Mor bruger automatisk Dads kalender → "Følger Dad"
 * - Datter har sin egen kalender → "Tilpasset"
 */
const formatPreferenceSource = (profile, familyMembers = []) => {
  if (!profile) {
    return 'Ukendt';
  }
  const normalizedMode = normalizeFamilyPreferenceMode(
    profile.familyPreferenceMode
  );
  if (normalizedMode === FAMILY_PREFERENCE_MODES.NONE) {
    return 'Ingen præferencer';
  }
  if (normalizedMode === FAMILY_PREFERENCE_MODES.FOLLOW) {
    const target = Array.isArray(familyMembers)
      ? familyMembers.find(
          (member) =>
            typeof member?.userId === 'string' &&
            member.userId === profile.familyPreferenceFollowUserId
        )
      : null;
    if (target?.displayName) {
      return `Følger ${target.displayName}`;
    }
    return 'Følger familiemedlem';
  }
  return 'Tilpasset';
};

/**
 * KONTO-INDSTILLINGER SKÆRM KOMPONENT
 * 
 * Denne skærm viser brugeren deres konto-oplysninger og familie-status.
 * 
 * Den viser:
 * - Brugerens profil (navn, by, alder)
 * - Hvilken familie de tilhører (hvis nogen)
 * - Familie-medlemmer og deres præferencer
 * - Invitationer til andre familier
 * 
 * Handlinger:
 * - Acceptere invitation til en ny familie
 * - Forlade eller overdrage en familie
 * - Slette en bruger
 */
const AccountSettingsScreen = ({ navigation }) => {
  /**
   * TILSTANDSVARIABLE (STATE)
   * 
   * Disse variabler holder styr på data og status for denne skærm:
   */

  // Er siden ved at hente data?
  const [loading, setLoading] = useState(true);

  // Hvis noget gik galt (forbindelsesfejl, ingen bruger etc.)
  const [error, setError] = useState('');

  // Besked når noget lykkedes (fx "Du har forladt familjen!")
  const [statusMessage, setStatusMessage] = useState('');

  // Denne brugers oplysninger (navn, by, fødselsdag etc.)
  const [userProfile, setUserProfile] = useState(null);

  // Den familie brugeren tilhører (navn, medlemmer, præferencer)
  const [family, setFamily] = useState(null);

  // Liste over invitationer fra andre familier som denne bruger kan acceptere
  const [invites, setInvites] = useState([]);

  // Fejler når man accepterer/forslår en invitation?
  const [actionError, setActionError] = useState('');

  // Hvilke invitations-ID'er er ved at blive accepteret? (bruges til at vise loading på knappen)
  const [acceptingIds, setAcceptingIds] = useState([]);

  // Er brugeren ved at forlade deres familie?
  const [leavingFamily, setLeavingFamily] = useState(false);

  // Er brugeren ved at slette sin konto?
  const [deletingProfile, setDeletingProfile] = useState(false);

  // Hvilke medlem-ID'er er ved at blive slettet fra familien?
  const [removingMemberIds, setRemovingMemberIds] = useState([]);

  // Gem profilinformation for hvert familie-medlem (navn, by, fødselsdag)
  const [memberProfiles, setMemberProfiles] = useState({});

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
          preferredFamilyDays: Array.isArray(userData.preferredFamilyDays)
            ? userData.preferredFamilyDays
            : [],
          preferredFamilyTimeWindows:
            userData.preferredFamilyTimeWindows && typeof userData.preferredFamilyTimeWindows === 'object'
              ? userData.preferredFamilyTimeWindows
              : null,
          preferredMinDuration: minDurationMinutes,
          preferredMaxDuration: maxDurationMinutes,
          avatarEmoji:
            typeof userData.avatarEmoji === 'string' && userData.avatarEmoji.trim().length
              ? userData.avatarEmoji.trim()
              : DEFAULT_AVATAR_EMOJI,
          familyPreferenceMode: normalizeFamilyPreferenceMode(
            userData.familyPreferenceMode
          ),
          familyPreferenceFollowUserId:
            typeof userData.familyPreferenceFollowUserId === 'string'
              ? userData.familyPreferenceFollowUserId.trim()
              : '',
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

  useEffect(() => {
    let isActive = true;

    const fetchMemberProfiles = async () => {
      const members = Array.isArray(family?.members) ? family.members : [];
      const memberIds = Array.from(
        new Set(
          members
            .map((member) =>
              typeof member?.userId === 'string' ? member.userId.trim() : ''
            )
            .filter((id) => id.length > 0)
        )
      );

      if (!memberIds.length) {
        if (isActive) {
          setMemberProfiles({});
        }
        return;
      }

      try {
        const snapshots = await Promise.all(
          memberIds.map((memberId) =>
            db
              .collection('users')
              .doc(memberId)
              .get()
              .catch(() => null)
          )
        );

        if (!isActive) {
          return;
        }

        const nextProfiles = {};
        snapshots.forEach((docSnap) => {
          if (!docSnap || !docSnap.exists) {
            return;
          }
          const data = docSnap.data() ?? {};
          nextProfiles[docSnap.id] = {
            avatarEmoji:
              typeof data.avatarEmoji === 'string' && data.avatarEmoji.trim().length
                ? data.avatarEmoji.trim()
                : '',
            name:
              typeof data.name === 'string' && data.name.trim().length
                ? data.name.trim()
                : '',
            displayName:
              typeof data.displayName === 'string' && data.displayName.trim().length
                ? data.displayName.trim()
                : '',
            email:
              typeof data.email === 'string' && data.email.trim().length
                ? data.email.trim()
                : '',
          };
        });
        setMemberProfiles(nextProfiles);
      } catch (_fetchError) {
        if (isActive) {
          setMemberProfiles({});
        }
      }
    };

    fetchMemberProfiles();

    return () => {
      isActive = false;
    };
  }, [family?.members]);

  /**
   * ACCEPT INVITATION TIL FAMILIE
   * 
   * Når brugeren accepterer en invitation til en anden familie:
   * - Vi tilføjer brugeren som medlem af familien
   * - Vi fjerner brugerens email fra listen over ventende invitationer
   * - Vi gemmer familie-ID på brugerens profil
   * 
   * Eksempel:
   * - Bruger får invitation fra "Andersens Familie"
   * - Bruger trykker "Accepter"
   * - Bruger kommer nu til at høre til "Andersens Familie" og ser deres medlemmer
   */
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

  /**
   * BESTEM ROLLE-ETIKET
   * 
   * Konverterer en rolle fra databasen til et læseligt navn:
   * - "owner" eller "admin" → "Administrator"
   * - Alt andet → "Medlem"
   * 
   * Dette bruges til at vise medlemmernes roller på skærmen.
   */
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

  /**
   * KAN NUVÆRENDE BRUGER ADMINISTRERE FAMILIEN?
   * 
   * Tjekker om den nuværende bruger har tilladelse til at:
   * - Tilføje/fjerne medlemmer
   * - Ændre familie-indstillinger
   * 
   * Dette kræver at brugeren er administrator og også familie-ejeren.
   */
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

  /**
   * BEKRÆFT FORLAD FAMILIE
   * 
   * Viser en dialog hvor brugeren kan bekræfte at de vil forlade familien.
   * 
   * Hvis brugeren er administrator, skal de først vælge hvem der skal blive
   * den nye administrator før de kan forlade.
   */
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

  /**
   * FORLAD FAMILIE
   * 
   * Når brugeren vil forlade sin nuværende familie:
   * - Vi fjerner brugeren fra familie-medlemslist
   * - Hvis brugeren er ejeren, skal de først overdrage familien til en anden
   * - Vi fjerner familie-ID fra brugerens profil
   * 
   * Eksempel:
   * - Bruger vælger "Forlad familie"
   * - Hvis de er administrator, må de først vælge hvem der skal blive administrator
   * - Brugeren er nu ikke længere medlem af familien
   */
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

  /**
   * FJERN FAMILIEMEDLEM
   * 
   * Når en administrator fjerner et medlem fra familien:
   * - Vi fjerner medlemmet fra familie-medlemslisten
   * - Hvis medlemmet var administrator, gives rollen til det næste medlem
   * - Vi fjerner deres email fra invitations-list
   * 
   * Eksempel:
   * - Familie-administrator trykker "Fjern" på et medlem
   * - Medlemmet forsvinder fra familien
   * - De får deres medlemskab annulleret fra deres side
   */
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

  /**
   * SLET BRUGERPROFIL
   * 
   * Dette sletter brugerens hele konto fra systemet:
   * - Først forlade sin familie (eller overdrage ejerskab)
   * - Slet alle bruger-data fra databasen
   * - Slet brugerens kalenderdata
   * - Slet brugerkontoen fra Firebase Auth
   * 
   * Denne operation er permanent og kan ikke fortrydes!
   * 
   * Eksempel:
   * - Bruger trykker "Slet konto"
   * - Alle deres data fjernes fra appens database
   * - De kan ikke længere logge ind
   */
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

  /**
   * LOG UD
   * 
   * Logger brugeren ud fra Firebase Authentication.
   * Efter dette vil brugeren blive sendt tilbage til login-skærmen.
   */
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
  const normalizedPreferenceMode = normalizeFamilyPreferenceMode(
    userProfile?.familyPreferenceMode
  );
  const followedMember = useMemo(() => {
    if (normalizedPreferenceMode !== FAMILY_PREFERENCE_MODES.FOLLOW) {
      return null;
    }
    const familyMembers = Array.isArray(family?.members) ? family.members : [];
    return (
      familyMembers.find(
        (member) =>
          typeof member?.userId === 'string' &&
          member.userId === userProfile?.familyPreferenceFollowUserId
      ) || null
    );
  }, [
    family?.members,
    normalizedPreferenceMode,
    userProfile?.familyPreferenceFollowUserId,
  ]);
  const preferenceOverrideLabel =
    normalizedPreferenceMode === FAMILY_PREFERENCE_MODES.FOLLOW
      ? `Følger ${followedMember?.displayName || 'familiemedlem'}`
      : 'Ingen præferencer';
  const shouldShowCustomPreferences =
    normalizedPreferenceMode === FAMILY_PREFERENCE_MODES.CUSTOM;
  const preferredDaysLabel = shouldShowCustomPreferences
    ? formatPreferredDays(userProfile?.preferredFamilyDays)
    : preferenceOverrideLabel;
  const preferredTimeWindowsLabel = shouldShowCustomPreferences
    ? formatTimeWindows(
        userProfile?.preferredFamilyTimeWindows,
        userProfile?.preferredFamilyDays
      )
    : preferenceOverrideLabel;
  const preferredDurationLabel = shouldShowCustomPreferences
    ? formatDurationRange(
        typeof userProfile?.preferredMinDuration === 'number'
          ? userProfile.preferredMinDuration
          : null,
        typeof userProfile?.preferredMaxDuration === 'number'
          ? userProfile.preferredMaxDuration
          : null
      )
    : preferenceOverrideLabel;
  const preferenceSourceLabel = formatPreferenceSource(
    userProfile,
    family?.members || []
  );
  const profileNameLabel =
    userProfile?.name && userProfile.name.trim().length
      ? userProfile.name.trim()
      : 'Ikke udfyldt';
  const profileEmailLabel = userProfile?.email || userEmail || 'Ukendt';
  const profileMeta = [
    {
      key: 'gender',
      label: 'Køn',
      value: userProfile?.gender || 'Ikke udfyldt',
    },
    {
      key: 'age',
      label: 'Alder',
      value: userProfile?.age ? String(userProfile.age) : 'Ikke udfyldt',
    },
    {
      key: 'location',
      label: 'By',
      value: userProfile?.location || 'Ikke udfyldt',
    },
    {
      key: 'role',
      label: 'Familiestatus',
      value: userProfile?.familyRole ? userProfile.familyRole : 'Medlem',
    },
  ];
  const preferenceHighlights = [
    {
      key: 'days',
      label: 'Foretrukne dage',
      value: preferredDaysLabel,
    },
    {
      key: 'times',
      label: 'Foretrukket tidsrum',
      value: preferredTimeWindowsLabel,
    },
    {
      key: 'duration',
      label: 'Varighed',
      value: preferredDurationLabel,
    },
    {
      key: 'source',
      label: 'Præference',
      value: preferenceSourceLabel,
    },
  ];
  const fullWidthHighlights = preferenceHighlights.slice(0, 2);
  const halfWidthHighlights = preferenceHighlights.slice(2);

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
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Dine oplysninger</Text>
              <Text style={styles.sectionHint}>
                Opdateres automatisk, når du redigerer din profil.
              </Text>
            </View>
            {loading ? (
              <Text style={styles.infoText}>Indlæser oplysninger...</Text>
            ) : (
              <>
                <View style={styles.profileSummary}>
                  <View style={styles.profileEmojiBubble}>
                    <Text style={styles.profileEmojiText}>{resolvedUserEmoji}</Text>
                  </View>
                  <View style={styles.profileSummaryText}>
                    <Text style={styles.profileName}>{profileNameLabel}</Text>
                    <Text style={styles.profileEmail}>{profileEmailLabel}</Text>
                  </View>
                </View>
                <View style={styles.profileMetaGrid}>
                  {profileMeta.map((item) => (
                    <View key={item.key} style={styles.profileMetaCard}>
                      <Text style={styles.infoLabel}>{item.label}</Text>
                      <Text style={styles.infoValue}>{item.value}</Text>
                    </View>
                  ))}
                </View>
                <View style={styles.preferenceHighlightGrid}>
                  {fullWidthHighlights.map((item) => (
                    <View
                      key={item.key}
                      style={styles.preferenceHighlightCardFull}
                    >
                      <Text style={styles.preferenceHighlightLabel}>{item.label}</Text>
                      <Text
                        style={[
                          styles.preferenceHighlightValue,
                          item.key === 'times'
                            ? styles.preferenceHighlightValueMultiline
                            : null,
                        ]}
                      >
                        {item.value}
                      </Text>
                    </View>
                  ))}
                  {halfWidthHighlights.length ? (
                    <View style={styles.preferenceHighlightRow}>
                      {halfWidthHighlights.map((item) => (
                        <View
                          key={item.key}
                          style={styles.preferenceHighlightCardHalf}
                        >
                          <Text style={styles.preferenceHighlightLabel}>{item.label}</Text>
                          <Text
                            style={[
                              styles.preferenceHighlightValue,
                              item.key === 'times'
                                ? styles.preferenceHighlightValueMultiline
                                : null,
                            ]}
                          >
                            {item.value}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
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
                  const profileData =
                    member?.userId && memberProfiles?.[member.userId]
                      ? memberProfiles[member.userId]
                      : null;
                  const profileEmoji =
                    typeof profileData?.avatarEmoji === 'string' &&
                    profileData.avatarEmoji.trim().length
                      ? profileData.avatarEmoji.trim()
                      : '';
                  const docEmoji =
                    typeof member?.avatarEmoji === 'string' && member.avatarEmoji.trim().length
                      ? member.avatarEmoji.trim()
                      : DEFAULT_AVATAR_EMOJI;
                  const memberEmoji =
                    member?.userId && currentUser?.uid && member.userId === currentUser.uid
                      ? resolvedUserEmoji
                      : profileEmoji || docEmoji;
                  const memberName =
                    pickFirstString(
                      profileData?.displayName,
                      profileData?.name,
                      member?.displayName,
                      member?.name,
                      profileData?.email,
                      member?.email
                    ) || 'Familiemedlem';
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

export default AccountSettingsScreen;
