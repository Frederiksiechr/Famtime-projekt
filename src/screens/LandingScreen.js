/**
 * LandingScreen
 *
 * - Beskyttet sk√¶rm der vises efter login og samler brugerinformation.
 * - Formularen gemmer profiloplysninger i Firestore og giver mulighed for at logge ud.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Pressable,
  SafeAreaView,
} from 'react-native';

import Button from '../components/Button';
import FormInput from '../components/FormInput';
import ErrorMessage from '../components/ErrorMessage';
import { auth, db, firebase } from '../lib/firebase';
import { getFriendlyAuthError } from '../lib/errorMessages';
import { colors, spacing, fontSizes, radius } from '../styles/theme';
import * as Clipboard from 'expo-clipboard';
import {
  AVATAR_EMOJIS,
  DEFAULT_AVATAR_EMOJI,
} from '../constants/avatarEmojis';

const WEEK_DAYS = [
  { key: 'monday', label: 'Mandag' },
  { key: 'tuesday', label: 'Tirsdag' },
  { key: 'wednesday', label: 'Onsdag' },
  { key: 'thursday', label: 'Torsdag' },
  { key: 'friday', label: 'Fredag' },
  { key: 'saturday', label: 'L√∏rdag' },
  { key: 'sunday', label: 'S√∏ndag' },
];

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const toMinutes = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!TIME_PATTERN.test(trimmed)) {
    return null;
  }
  const [hours, minutes] = trimmed.split(':').map((item) => Number(item));
  return hours * 60 + minutes;
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

const hasCompletedProfile = (data) => {
  const nameFilled = typeof data.name === 'string' && data.name.trim().length > 0;
  const genderFilled = typeof data.gender === 'string' && data.gender.trim().length > 0;
  const ageValue = data.age;

  let ageFilled = false;
  if (typeof ageValue === 'string') {
    ageFilled = /^\d+$/.test(ageValue.trim());
  } else if (typeof ageValue === 'number') {
    ageFilled = !Number.isNaN(ageValue);
  }

  return nameFilled && genderFilled && ageFilled;
};

const LandingScreen = ({ navigation, route }) => {
  const isEditMode = route?.params?.mode === 'edit';
  const [logoutError, setLogoutError] = useState('');
  const [generalError, setGeneralError] = useState('');
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [profile, setProfile] = useState({
    name: '',
    age: '',
    gender: '',
    location: '',
    familyId: '',
    familyRole: '',
    familyFrequency: '',
    preferredDays: [],
    preferredTimeStart: '',
    preferredTimeEnd: '',
    preferredMinDuration: '',
    preferredMaxDuration: '',
    avatarEmoji: DEFAULT_AVATAR_EMOJI,
  });

  const userEmail = auth.currentUser?.email ?? 'Ukendt bruger';
  const userId = auth.currentUser?.uid ?? null;
  const [copyFeedback, setCopyFeedback] = useState('');
  const hasFamily = useMemo(() => Boolean(profile.familyId), [profile.familyId]);

  useEffect(() => {
    const fetchProfile = async () => {
      if (!userId) {
        setLoadingProfile(false);
        return;
      }

      try {
        const doc = await db.collection('users').doc(userId).get();
        if (doc.exists) {
          const data = doc.data() ?? {};

          const primaryTimeWindow = extractPrimaryTimeWindow(data.preferredFamilyTimeWindows);
          const minDurationMinutes =
            typeof data.preferredFamilyMinDurationMinutes === 'number' &&
            !Number.isNaN(data.preferredFamilyMinDurationMinutes)
              ? String(data.preferredFamilyMinDurationMinutes)
              : '';
          const maxDurationMinutes =
            typeof data.preferredFamilyMaxDurationMinutes === 'number' &&
            !Number.isNaN(data.preferredFamilyMaxDurationMinutes)
              ? String(data.preferredFamilyMaxDurationMinutes)
              : '';

          const hasName = typeof data.name === 'string' && data.name.trim().length > 0;
          const hasGender =
            typeof data.gender === 'string' && data.gender.trim().length > 0;
          const hasAge = typeof data.age === 'number' && !Number.isNaN(data.age);
          const hasFamilyId =
            typeof data.familyId === 'string' && data.familyId.trim().length > 0;

          if (hasName && hasGender && hasAge && hasFamilyId && !isEditMode) {
            setLoadingProfile(false);
            navigation.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
            return;
          }

          setProfile({
            name: data.name ?? '',
            age:
              typeof data.age === 'number' && !Number.isNaN(data.age)
                ? String(data.age)
                : data.age ?? '',
            gender: data.gender ?? '',
            location: data.location ?? '',
            familyId: data.familyId ?? '',
            familyRole: data.familyRole ?? '',
            familyFrequency:
              typeof data.preferredFamilyFrequency === 'number'
                ? String(data.preferredFamilyFrequency)
                : '',
            preferredDays: Array.isArray(data.preferredFamilyDays)
              ? data.preferredFamilyDays
              : [],
            preferredTimeStart:
              typeof primaryTimeWindow.start === 'string'
                ? primaryTimeWindow.start
                : '',
            preferredTimeEnd:
              typeof primaryTimeWindow.end === 'string'
                ? primaryTimeWindow.end
                : '',
            preferredMinDuration: minDurationMinutes,
            preferredMaxDuration: maxDurationMinutes,
            avatarEmoji:
              typeof data.avatarEmoji === 'string' && data.avatarEmoji.trim().length
                ? data.avatarEmoji.trim()
                : DEFAULT_AVATAR_EMOJI,
          });
        }
      } catch (_error) {
        setGeneralError('Kunne ikke hente dine profiloplysninger.');
      } finally {
        setLoadingProfile(false);
      }
    };

    fetchProfile();
  }, [navigation, userId, isEditMode]);

  const updateField = (field) => (value) => {
    setProfile((prev) => ({ ...prev, [field]: value }));
  };

  const togglePreferredDay = (dayKey) => {
    setProfile((prev) => {
      const current = Array.isArray(prev.preferredDays)
        ? prev.preferredDays
        : [];
      if (current.includes(dayKey)) {
        return {
          ...prev,
          preferredDays: current.filter((item) => item !== dayKey),
        };
      }
      return {
        ...prev,
        preferredDays: [...current, dayKey],
      };
    });
  };

  const handleSelectAvatar = (emoji) => {
    if (typeof emoji !== 'string') {
      return;
    }
    const trimmed = emoji.trim();
    if (!trimmed.length) {
      return;
    }
    setProfile((prev) => ({
      ...prev,
      avatarEmoji: trimmed,
    }));
  };

  const handleCopyFamilyId = async () => {
    if (!profile.familyId) {
      return;
    }
    await Clipboard.setStringAsync(profile.familyId);
    setCopyFeedback('Familie ID kopieret.');
    setTimeout(() => setCopyFeedback(''), 2500);
  };

  const validateProfile = () => {
    const nextErrors = {};
    if (!profile.name.trim()) {
      nextErrors.name = 'Navn skal udfyldes.';
    }

    if (!profile.age.trim()) {
      nextErrors.age = 'Alder skal udfyldes.';
    } else if (!/^\d+$/.test(profile.age.trim())) {
      nextErrors.age = 'Alder skal v√¶re et tal.';
    }

    if (!profile.gender.trim()) {
      nextErrors.gender = 'K√∏n skal udfyldes.';
    }

    const startTime = typeof profile.preferredTimeStart === 'string' ? profile.preferredTimeStart.trim() : '';
    const endTime = typeof profile.preferredTimeEnd === 'string' ? profile.preferredTimeEnd.trim() : '';

    if ((startTime && !endTime) || (!startTime && endTime)) {
      nextErrors.preferredTimeStart = 'Angiv bÂde start- og sluttidspunkt.';
      nextErrors.preferredTimeEnd = 'Angiv bÂde start- og sluttidspunkt.';
    } else if (startTime && endTime) {
      if (!TIME_PATTERN.test(startTime)) {
        nextErrors.preferredTimeStart = 'Starttid skal vÊre i format HH:MM.';
      }
      if (!TIME_PATTERN.test(endTime)) {
        nextErrors.preferredTimeEnd = 'Sluttid skal vÊre i format HH:MM.';
      }
      const startMinutes = toMinutes(startTime);
      const endMinutes = toMinutes(endTime);
      if (startMinutes !== null && endMinutes !== null && endMinutes <= startMinutes) {
        nextErrors.preferredTimeStart = 'Sluttid skal ligge efter starttid.';
        nextErrors.preferredTimeEnd = 'Sluttid skal ligge efter starttid.';
      }
    }

    const minDurationRaw = typeof profile.preferredMinDuration === 'string' ? profile.preferredMinDuration.trim() : '';
    const maxDurationRaw = typeof profile.preferredMaxDuration === 'string' ? profile.preferredMaxDuration.trim() : '';
    const minDurationValue = minDurationRaw ? Number(minDurationRaw) : null;
    const maxDurationValue = maxDurationRaw ? Number(maxDurationRaw) : null;

    if (minDurationRaw && (!Number.isFinite(minDurationValue) || minDurationValue <= 0)) {
      nextErrors.preferredMinDuration = 'Min. varighed skal vÊre et positivt tal (minutter).';
    }

    if (maxDurationRaw && (!Number.isFinite(maxDurationValue) || maxDurationValue <= 0)) {
      nextErrors.preferredMaxDuration = 'Max. varighed skal vÊre et positivt tal (minutter).';
    }

    if (Number.isFinite(minDurationValue) && Number.isFinite(maxDurationValue) && maxDurationValue < minDurationValue) {
      nextErrors.preferredMaxDuration = 'Max. varighed skal vÊre st¯rre end min. varighed.';
    }

    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSaveProfile = async () => {
    if (!userId) {
      setGeneralError('Ingen bruger fundet. Pr√∏v at logge ind igen.');
      return;
    }

    if (!validateProfile()) {
      return;
    }

    try {
      setGeneralError('');
      setSavingProfile(true);

        const sanitizedAge = Number(profile.age.trim());
        const sanitizedLocation =
          typeof profile.location === 'string' ? profile.location.trim() : '';
        const sanitizedEmoji =
          typeof profile.avatarEmoji === 'string' && profile.avatarEmoji.trim().length
            ? profile.avatarEmoji.trim()
            : DEFAULT_AVATAR_EMOJI;
        const trimmedName = profile.name.trim();
        const normalizedName = trimmedName.length ? trimmedName : userEmail;
        const trimmedGender = profile.gender.trim();
        const frequencyValue = Number(profile.familyFrequency);
        const normalizedEmail =
          typeof userEmail === 'string' ? userEmail.toLowerCase() : '';
        let emojiSyncFailed = false;

        const payload = {
          name: trimmedName,
          age: sanitizedAge,
          gender: trimmedGender,
          avatarEmoji: sanitizedEmoji,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        };

        if (sanitizedLocation) {
          payload.location = sanitizedLocation;
        } else {
          payload.location = firebase.firestore.FieldValue.delete();
        }

        if (
          Number.isFinite(frequencyValue) &&
          frequencyValue > 0 &&
          frequencyValue <= 7
        ) {
          payload.preferredFamilyFrequency = frequencyValue;
        } else {
          payload.preferredFamilyFrequency = firebase.firestore.FieldValue.delete();
        }

        if (Array.isArray(profile.preferredDays) && profile.preferredDays.length) {
          payload.preferredFamilyDays = profile.preferredDays;
        } else {
          payload.preferredFamilyDays = firebase.firestore.FieldValue.delete();
        }

        const trimmedStart = typeof profile.preferredTimeStart === 'string' ? profile.preferredTimeStart.trim() : '';
        const trimmedEnd = typeof profile.preferredTimeEnd === 'string' ? profile.preferredTimeEnd.trim() : '';

        if (trimmedStart && trimmedEnd && TIME_PATTERN.test(trimmedStart) && TIME_PATTERN.test(trimmedEnd)) {
          const createWindowEntry = () => ({ start: trimmedStart, end: trimmedEnd });
          const sharedWindows = { default: [createWindowEntry()] };
          if (Array.isArray(profile.preferredDays) && profile.preferredDays.length) {
            profile.preferredDays.forEach((dayKey) => {
              sharedWindows[dayKey] = [createWindowEntry()];
            });
          }
          payload.preferredFamilyTimeWindows = sharedWindows;
        } else {
          payload.preferredFamilyTimeWindows = firebase.firestore.FieldValue.delete();
        }

        const minDurationRaw = typeof profile.preferredMinDuration === 'string' ? profile.preferredMinDuration.trim() : '';
        const maxDurationRaw = typeof profile.preferredMaxDuration === 'string' ? profile.preferredMaxDuration.trim() : '';
        const minDurationValue = minDurationRaw ? Number(minDurationRaw) : null;
        const maxDurationValue = maxDurationRaw ? Number(maxDurationRaw) : null;

        if (Number.isFinite(minDurationValue) && minDurationValue > 0) {
          payload.preferredFamilyMinDurationMinutes = minDurationValue;
        } else {
          payload.preferredFamilyMinDurationMinutes = firebase.firestore.FieldValue.delete();
        }

        if (Number.isFinite(maxDurationValue) && maxDurationValue > 0) {
          payload.preferredFamilyMaxDurationMinutes = maxDurationValue;
        } else {
          payload.preferredFamilyMaxDurationMinutes = firebase.firestore.FieldValue.delete();
        }

        await db.collection('users').doc(userId).set(payload, { merge: true });

        const userFamilyId =
          typeof profile.familyId === 'string' ? profile.familyId.trim() : '';
        if (userFamilyId) {
          try {
            const familyRef = db.collection('families').doc(userFamilyId);
            const familyDoc = await familyRef.get();
            if (familyDoc.exists) {
              const familyData = familyDoc.data() ?? {};
              const memberRole =
                typeof profile.familyRole === 'string' &&
                profile.familyRole.trim().length
                  ? profile.familyRole.trim()
                  : 'member';
              let members = Array.isArray(familyData.members)
                ? [...familyData.members]
                : [];
              let hasUpdatedMember = false;

              members = members.map((member) => {
                if (member?.userId === userId) {
                  hasUpdatedMember = true;
                  return {
                    ...member,
                    email: normalizedEmail,
                    avatarEmoji: sanitizedEmoji,
                    displayName: normalizedName,
                    name: normalizedName,
                    role: member?.role ?? memberRole,
                  };
                }
                return member;
              });

              if (!hasUpdatedMember) {
                members.push({
                  userId,
                  email: normalizedEmail,
                  avatarEmoji: sanitizedEmoji,
                  displayName: normalizedName,
                  name: normalizedName,
                  role: memberRole,
                });
              }

              await familyRef.update({
                members,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
              });
            }
          } catch (_emojiError) {
            emojiSyncFailed = true;
            setGeneralError(
              'Profilen er gemt, men emoji kunne ikke opdateres for familien. Pr√∏v igen.'
            );
          }
        }

        if (emojiSyncFailed) {
          return;
        }

      if (isEditMode) {
        if (navigation.canGoBack()) {
          navigation.goBack();
        } else {
          navigation.navigate('MainTabs', { screen: 'AccountSettings' });
        }
      } else {
        navigation.navigate('CalendarSync');
      }
    } catch (_error) {
      setGeneralError('Kunne ikke gemme dine oplysninger. Pr√∏v igen.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleLogout = async () => {
    try {
      setLogoutError('');
      await auth.signOut();
    } catch (logoutErr) {
      setLogoutError(getFriendlyAuthError(logoutErr));
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.container}>
          <View style={styles.heroCard}>
            <Text style={styles.heroBadge}>
              {isEditMode ? 'Din profil' : 'Klar til familietid'}
            </Text>
            <Text style={styles.title}>
              {isEditMode ? 'Opdater din profil' : 'Velkommen til FamTime'}
            </Text>
            <Text style={styles.subtitle}>
              {isEditMode
                ? `Opdater dine oplysninger som ${userEmail}`
                : `Du er logget ind som ${userEmail}`}
            </Text>
            <Text style={styles.sectionIntro}>
              {isEditMode
                ? 'Redig√©r dine profiloplysninger og familiepr√¶ferencer.'
                : 'Fort√¶l os lidt om dig selv, s√• familien kan l√¶re dig bedre at kende.'}
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Personlige oplysninger</Text>
            <Text style={styles.cardSubtitle}>
              Brug detaljerne til at give familien bedre overblik over, hvem du er.
            </Text>

            <ErrorMessage message={generalError} />
            {copyFeedback ? (
              <View style={styles.successPill}>
                <Text style={styles.successText}>{copyFeedback}</Text>
              </View>
            ) : null}

            {loadingProfile ? (
              <View style={styles.loadingWrapper}>
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
              ) : (
                <>
                  <View style={styles.emojiSection}>
                    <Text style={styles.emojiLabel}>V√¶lg din emoji</Text>
                    <Text style={styles.emojiHint}>
                      Din emoji bruges i familiens kalender og lister.
                    </Text>
                    <View style={styles.emojiGrid}>
                      {AVATAR_EMOJIS.map((emoji) => {
                        const isSelected = profile.avatarEmoji === emoji;
                        return (
                          <Pressable
                            key={emoji}
                            onPress={() => handleSelectAvatar(emoji)}
                            style={[
                              styles.emojiOption,
                              isSelected ? styles.emojiOptionSelected : null,
                            ]}
                            accessibilityRole="button"
                            accessibilityState={{ selected: isSelected }}
                            accessibilityLabel={`V√¶lg emoji ${emoji}`}
                          >
                            <Text
                              style={[
                                styles.emojiOptionText,
                                isSelected ? styles.emojiOptionTextSelected : null,
                              ]}
                            >
                              {emoji}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>

                  <FormInput
                    label="Navn"
                    value={profile.name}
                    onChangeText={updateField('name')}
                    placeholder="Dit fulde navn"
                  error={fieldErrors.name}
                  style={styles.field}
                />
                <FormInput
                  label="Alder"
                  value={profile.age}
                  onChangeText={updateField('age')}
                  keyboardType="number-pad"
                  placeholder="Fx 32"
                  error={fieldErrors.age}
                  style={styles.field}
                />
                <FormInput
                  label="K√∏n"
                  value={profile.gender}
                  onChangeText={updateField('gender')}
                  placeholder="Fx Kvinde, Mand, Ikke-bin√¶r‚Ä¶"
                  error={fieldErrors.gender}
                  style={styles.field}
                />
                <FormInput
                  label="Lokation (valgfrit)"
                  value={profile.location}
                  onChangeText={updateField('location')}
                  placeholder="Byen du bor i"
                  error={fieldErrors.location}
                  style={styles.field}
                />

                <View style={styles.sectionDivider} />

                <Text style={styles.preferenceTitle}>Familietidspr√¶ferencer</Text>
                <Text style={styles.preferenceHint}>
                  Hj√¶lp FamTime med at foresl√• tidspunkter, der passer hele familien.
                </Text>
                <FormInput
                  label="√ònskede familietider pr. uge"
                  value={profile.familyFrequency}
                  onChangeText={updateField('familyFrequency')}
                  keyboardType="number-pad"
                  placeholder="Fx 3"
                  style={styles.field}
                />
                <Text style={styles.preferenceSubtitle}>Foretrukne dage</Text>
                <View style={styles.dayChipsWrap}>
                  {WEEK_DAYS.map((day) => {
                    const selected = profile.preferredDays.includes(day.key);
                    return (
                      <Pressable
                        key={day.key}
                        onPress={() => togglePreferredDay(day.key)}
                        style={[
                          styles.dayChip,
                          selected ? styles.dayChipSelected : null,
                        ]}
                      >
                        <Text
                          style={[
                            styles.dayChipText,
                            selected ? styles.dayChipTextSelected : null,
                          ]}
                        >
                          {day.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={styles.preferenceFootnote}>
                  Valgte dage bruges til forslag i &quot;Familiebegivenheder&quot;.
                </Text>

                <Text style={styles.preferenceSubtitle}>Foretrukket tidsrum</Text>
                <Text style={styles.preferenceFootnote}>
                  Udfyld start og slut for at begrÊnse forslag til et bestemt tidsrum.
                </Text>
                <FormInput
                  label="Starttid (HH:MM)"
                  value={profile.preferredTimeStart}
                  onChangeText={updateField('preferredTimeStart')}
                  placeholder="Fx 09:00"
                  keyboardType="numbers-and-punctuation"
                  autoCapitalize="none"
                  error={fieldErrors.preferredTimeStart}
                  style={styles.field}
                />
                <FormInput
                  label="Sluttid (HH:MM)"
                  value={profile.preferredTimeEnd}
                  onChangeText={updateField('preferredTimeEnd')}
                  placeholder="Fx 16:30"
                  keyboardType="numbers-and-punctuation"
                  autoCapitalize="none"
                  error={fieldErrors.preferredTimeEnd}
                  style={styles.field}
                />
                <FormInput
                  label="Min. varighed (minutter, valgfrit)"
                  value={profile.preferredMinDuration}
                  onChangeText={updateField('preferredMinDuration')}
                  keyboardType="number-pad"
                  placeholder="Fx 45"
                  autoCapitalize="none"
                  error={fieldErrors.preferredMinDuration}
                  style={styles.field}
                />
                <FormInput
                  label="Max. varighed (minutter, valgfrit)"
                  value={profile.preferredMaxDuration}
                  onChangeText={updateField('preferredMaxDuration')}
                  keyboardType="number-pad"
                  placeholder="Fx 90"
                  autoCapitalize="none"
                  error={fieldErrors.preferredMaxDuration}
                  style={styles.field}
                />
                <Text style={styles.preferenceFootnote}>
                  Lad felterne stÂ tomme, hvis I er fleksible med bÂde tidsrum og varighed.
                </Text>

                <Button
                  title="Gem profil"
                  onPress={handleSaveProfile}
                  loading={savingProfile}
                  style={styles.saveButton}
                />
              </>
            )}
          </View>

          {hasFamily ? (
            <View style={[styles.card, styles.familyCard]}>
              <Text style={styles.cardTitle}>Din familie</Text>
              <Text style={styles.cardSubtitle}>
                FÂ hurtig adgang til delte oplysninger og del familie ID med andre.
              </Text>

              <Text style={styles.familyInfoText}>
                Familie ID: <Text style={styles.familyInfoValue}>{profile.familyId}</Text>
              </Text>
              {profile.familyRole ? (
                <Text style={styles.familyInfoText}>
                  Din rolle:{' '}
                  <Text style={styles.familyInfoValue}>
                    {profile.familyRole === 'admin' ? 'Administrator' : 'Medlem'}
                  </Text>
                </Text>
              ) : null}
              <Button
                title="Kopier familie ID"
                onPress={handleCopyFamilyId}
                style={styles.copyButton}
              />
            </View>
          ) : null}

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Konto</Text>
            <Text style={styles.cardSubtitle}>
              Log ud, hvis du √∏nsker at skifte bruger eller sikre din konto.
            </Text>
            <ErrorMessage message={logoutError} />
            <Button title="Log ud" onPress={handleLogout} style={styles.logout} />
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
  },
  container: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  heroCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    marginBottom: spacing.lg,
    shadowColor: colors.shadow,
    shadowOpacity: 0.3,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 14 },
    elevation: 4,
  },
  heroBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceMuted,
    color: colors.primaryDark,
    fontSize: fontSizes.xs,
    fontWeight: '700',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xxs,
    borderRadius: 999,
    letterSpacing: 0.6,
    marginBottom: spacing.sm,
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
  sectionIntro: {
    marginTop: spacing.sm,
    fontSize: fontSizes.sm,
    color: colors.mutedText,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    marginBottom: spacing.lg,
    shadowColor: colors.shadow,
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
  },
  cardTitle: {
    fontSize: fontSizes.lg,
    fontWeight: '700',
    color: colors.text,
  },
  cardSubtitle: {
    fontSize: fontSizes.sm,
    color: colors.mutedText,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  emojiSection: {
    marginBottom: spacing.lg,
  },
  emojiLabel: {
    fontSize: fontSizes.md,
    fontWeight: '700',
    color: colors.text,
  },
  emojiHint: {
    marginTop: spacing.xs,
    fontSize: fontSizes.sm,
    color: colors.mutedText,
  },
  emojiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  emojiOption: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  emojiOptionSelected: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(230, 138, 46, 0.18)',
  },
  emojiOptionText: {
    fontSize: 28,
    fontWeight: '600',
  },
  emojiOptionTextSelected: {
    fontWeight: '800',
  },
  successPill: {
    backgroundColor: 'rgba(230, 138, 46, 0.16)',
    borderRadius: 999,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    alignSelf: 'flex-start',
    marginBottom: spacing.sm,
  },
  successText: {
    fontSize: fontSizes.sm,
    color: colors.primaryDark,
    fontWeight: '600',
  },
  loadingWrapper: {
    paddingVertical: spacing.lg,
  },
  field: {
    marginBottom: spacing.md,
  },
  sectionDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.lg,
  },
  preferenceTitle: {
    fontSize: fontSizes.md,
    fontWeight: '700',
    color: colors.text,
  },
  preferenceHint: {
    fontSize: fontSizes.sm,
    color: colors.mutedText,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  preferenceSubtitle: {
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    fontSize: fontSizes.sm,
    color: colors.mutedText,
    fontWeight: '600',
  },
  dayChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginVertical: spacing.xs,
  },
  dayChip: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    marginRight: spacing.xs,
    marginBottom: spacing.xs,
  },
  dayChipSelected: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(230, 138, 46, 0.18)',
  },
  dayChipText: {
    fontSize: fontSizes.sm,
    color: colors.text,
  },
  dayChipTextSelected: {
    fontWeight: '700',
    color: colors.primaryDark,
  },
  preferenceFootnote: {
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
    fontSize: fontSizes.xs,
    color: colors.mutedText,
  },
  saveButton: {
    marginTop: spacing.md,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.lg,
  },
  familyCard: {
    backgroundColor: colors.surface,
  },
  familyInfoText: {
    fontSize: fontSizes.sm,
    color: colors.mutedText,
    marginBottom: spacing.xs,
  },
  familyInfoValue: {
    fontWeight: '700',
    color: colors.text,
  },
  copyButton: {
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.lg,
  },
  logout: {
    marginTop: spacing.md,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.lg,
  },
});

export default LandingScreen;

