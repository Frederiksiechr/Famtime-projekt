/**
 * LandingScreen
 *
 * - Beskyttet skærm der vises efter login og samler brugerinformation.
 * - Formularen gemmer profiloplysninger i Firestore og giver mulighed for at logge ud.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  ScrollView,
  Pressable,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Button from '../components/Button';
import FormInput from '../components/FormInput';
import ErrorMessage from '../components/ErrorMessage';
import { auth, db, firebase } from '../lib/firebase';
import { getFriendlyAuthError } from '../lib/errorMessages';
import { colors } from '../styles/theme';
import styles from '../styles/screens/LandingScreenStyles';
import * as Clipboard from 'expo-clipboard';
import {
  AVATAR_EMOJIS,
  DEFAULT_AVATAR_EMOJI,
} from '../constants/avatarEmojis';
import DateTimePicker from '@react-native-community/datetimepicker';

const WEEK_DAYS = [
  { key: 'monday', label: 'Mandag' },
  { key: 'tuesday', label: 'Tirsdag' },
  { key: 'wednesday', label: 'Onsdag' },
  { key: 'thursday', label: 'Torsdag' },
  { key: 'friday', label: 'Fredag' },
  { key: 'saturday', label: 'Lørdag' },
  { key: 'sunday', label: 'Søndag' },
];

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

const TIME_WINDOW_PRESETS = [
  {
    key: 'none',
    label: 'Ingen',
    start: '',
    end: '',
    display: 'Ingen tidsrum',
  },
  {
    key: 'earlybird',
    label: 'Morgen',
    start: '06:30',
    end: '09:00',
    display: '06:30-09:00',
  },
  {
    key: 'midday',
    label: 'Formiddag',
    start: '09:00',
    end: '12:00',
    display: '09:00-12:00',
  },
  {
    key: 'afternoon',
    label: 'Eftermiddag',
    start: '13:00',
    end: '16:00',
    display: '13:00-16:00',
  },
  {
    key: 'evening',
    label: 'Aften',
    start: '17:00',
    end: '20:00',
    display: '17:00-20:00',
  },
  {
    key: 'late',
    label: 'Sen aften',
    start: '20:00',
    end: '23:59',
    display: '20:00-23:59',
  },
];

const CUSTOM_TIME_PRESET = 'custom';
const isIOS = Platform.OS === 'ios';
const DURATION_PRESETS = [30, 45, 60, 90, 120, 180];
const GENDER_OPTIONS = ['Kvinde', 'Mand', 'Andet'];
const MIN_AGE = 5;
const MAX_AGE = 100;

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

const isValidTimeValue = (value) =>
  typeof value === 'string' && TIME_PATTERN.test(value.trim());

const isValidTimeRange = (start, end) =>
  isValidTimeValue(start) && isValidTimeValue(end) && toMinutes(end) > toMinutes(start);

const buildTimePickerDate = (value) => {
  const fallback = new Date();
  fallback.setSeconds(0, 0);
  if (isValidTimeValue(value)) {
    const [hours, minutes] = value.split(':').map(Number);
    fallback.setHours(hours, minutes, 0, 0);
    return fallback;
  }
  fallback.setHours(17, 0, 0, 0);
  return fallback;
};

const timeStringFromDate = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '';
  }
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
};

const formatTimeSelectionDisplay = (value) => {
  if (isValidTimeValue(value)) {
    return value;
  }
  return 'Vælg tidspunkt';
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

const createInitialDayTimeSelections = () => {
  const map = {};
  WEEK_DAYS.forEach((day) => {
    map[day.key] = { presetKey: 'none', start: '', end: '' };
  });
  return map;
};

const readWindowEntry = (raw) => {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const readValue = (key) => {
    if (typeof raw[key] === 'string') {
      return raw[key];
    }
    if (typeof raw.get === 'function') {
      const value = raw.get(key);
      return typeof value === 'string' ? value : '';
    }
    return '';
  };
  const start = readValue('start');
  const end = readValue('end');
  if (isValidTimeRange(start, end)) {
    return { start, end };
  }
  return null;
};

const hydrateDayTimeSelections = (
  timeWindows = {},
  fallbackStart = '',
  fallbackEnd = ''
) => {
  const selections = createInitialDayTimeSelections();
  const fallbackWindow = isValidTimeRange(fallbackStart, fallbackEnd)
    ? { start: fallbackStart, end: fallbackEnd }
    : null;

  const readListWindow = (list) => {
    if (Array.isArray(list) && list.length) {
      return readWindowEntry(list[0]);
    }
    if (list && typeof list === 'object') {
      return readWindowEntry(list);
    }
    return null;
  };

  const defaultWindow =
    readListWindow(timeWindows?.default) || fallbackWindow;

  WEEK_DAYS.forEach(({ key }) => {
    const windowEntry =
      readListWindow(timeWindows?.[key]) || defaultWindow;
    if (windowEntry) {
      const presetMatch = TIME_WINDOW_PRESETS.find(
        (preset) =>
          preset.start === windowEntry.start &&
          preset.end === windowEntry.end &&
          preset.start &&
          preset.end
      );
      selections[key] = {
        presetKey: presetMatch ? presetMatch.key : CUSTOM_TIME_PRESET,
        start: windowEntry.start,
        end: windowEntry.end,
      };
    }
  });

  return selections;
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
    preferredDays: [],
    preferredMinDuration: '',
    preferredMaxDuration: '',
    avatarEmoji: DEFAULT_AVATAR_EMOJI,
  });
  const [dayTimeSelections, setDayTimeSelections] = useState(
    createInitialDayTimeSelections
  );
  const [timePickerState, setTimePickerState] = useState({
    dayKey: null,
    field: null,
    visible: false,
    date: buildTimePickerDate('17:00'),
  });

  const userEmail = auth.currentUser?.email ?? 'Ukendt bruger';
  const userId = auth.currentUser?.uid ?? null;
  const [copyFeedback, setCopyFeedback] = useState('');
  const hasFamily = useMemo(() => Boolean(profile.familyId), [profile.familyId]);
  const selectedDayKeys = useMemo(() => {
    if (!Array.isArray(profile.preferredDays)) {
      return [];
    }
    return profile.preferredDays.filter((dayKey) =>
      WEEK_DAYS.some((day) => day.key === dayKey)
    );
  }, [profile.preferredDays]);
  const selectedDayObjects = useMemo(
    () => WEEK_DAYS.filter((day) => selectedDayKeys.includes(day.key)),
    [selectedDayKeys]
  );
  const ageHoldTimeoutRef = useRef(null);
  const ageHoldIntervalRef = useRef(null);

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
            preferredDays: Array.isArray(data.preferredFamilyDays)
              ? data.preferredFamilyDays
              : [],
            preferredMinDuration: minDurationMinutes,
            preferredMaxDuration: maxDurationMinutes,
            avatarEmoji:
              typeof data.avatarEmoji === 'string' && data.avatarEmoji.trim().length
                ? data.avatarEmoji.trim()
                : DEFAULT_AVATAR_EMOJI,
          });
          setDayTimeSelections(
            hydrateDayTimeSelections(
              data.preferredFamilyTimeWindows,
              primaryTimeWindow.start,
              primaryTimeWindow.end
            )
          );
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

  const getDaySelectionSummary = useCallback(
    (dayKey) => {
      const selection = dayTimeSelections[dayKey];
      if (!selection) {
        return 'Ingen tidsrum';
      }
      if (
        selection.presetKey &&
        selection.presetKey !== CUSTOM_TIME_PRESET &&
        selection.presetKey !== 'none'
      ) {
        const preset = TIME_WINDOW_PRESETS.find(
          (preset) => preset.key === selection.presetKey
        );
        if (preset?.display) {
          return preset.display;
        }
      }
      if (isValidTimeRange(selection.start, selection.end)) {
        return `${selection.start}-${selection.end}`;
      }
      return 'Ingen tidsrum';
    },
    [dayTimeSelections]
  );

  const clearTimeWindowError = useCallback(() => {
    setFieldErrors((prev) => {
      if (!prev.timeWindows) {
        return prev;
      }
      const next = { ...prev };
      delete next.timeWindows;
      return next;
    });
  }, []);

  const clearDurationError = useCallback((field) => {
    setFieldErrors((prev) => {
      if (!prev[field]) {
        return prev;
      }
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  const handleDayPresetSelect = useCallback(
    (dayKey, presetKey) => {
      const preset = TIME_WINDOW_PRESETS.find((item) => item.key === presetKey);
      if (!preset) {
        return;
      }
      clearTimeWindowError();
      setDayTimeSelections((prev) => ({
        ...prev,
        [dayKey]: {
          presetKey: preset.key,
          start: preset.start,
          end: preset.end,
        },
      }));
      if (timePickerState.dayKey === dayKey && preset.key !== CUSTOM_TIME_PRESET) {
        setTimePickerState((prev) => ({
          ...prev,
          visible: false,
          dayKey: null,
          field: null,
        }));
      }
    },
    [clearTimeWindowError, timePickerState.dayKey]
  );

  const handleCustomTimeMode = useCallback(
    (dayKey) => {
      clearTimeWindowError();
      setDayTimeSelections((prev) => {
        const current = prev[dayKey] ?? { start: '', end: '', presetKey: 'none' };
        if (current.presetKey === CUSTOM_TIME_PRESET) {
          return prev;
        }
        return {
          ...prev,
          [dayKey]: {
            ...current,
            presetKey: CUSTOM_TIME_PRESET,
          },
        };
      });
    },
    [clearTimeWindowError]
  );

  const openDayTimePicker = useCallback(
    (dayKey, field) => {
      handleCustomTimeMode(dayKey);
      clearTimeWindowError();
      setTimePickerState({
        dayKey,
        field,
        visible: true,
        date: buildTimePickerDate(dayTimeSelections[dayKey]?.[field] ?? ''),
      });
    },
    [clearTimeWindowError, dayTimeSelections, handleCustomTimeMode]
  );

  const handleTimePickerChange = useCallback(
    (event, selectedDate) => {
      const { dayKey, field } = timePickerState;
      if (!dayKey || !field) {
        return;
      }

      if (event?.type === 'dismissed' || !selectedDate) {
        if (!isIOS) {
          setTimePickerState((prev) => ({
            ...prev,
            visible: false,
            dayKey: null,
            field: null,
          }));
        }
        return;
      }

      clearTimeWindowError();
      const formatted = timeStringFromDate(selectedDate);
      setDayTimeSelections((prev) => ({
        ...prev,
        [dayKey]: {
          ...(prev[dayKey] ?? { presetKey: CUSTOM_TIME_PRESET, start: '', end: '' }),
          presetKey: CUSTOM_TIME_PRESET,
          [field]: formatted,
        },
      }));

      if (isIOS) {
        setTimePickerState((prev) => ({ ...prev, date: selectedDate }));
      } else {
        setTimePickerState({
          dayKey: null,
          field: null,
          visible: false,
          date: buildTimePickerDate('17:00'),
        });
      }
    },
    [clearTimeWindowError, timePickerState]
  );

  const handleCloseTimePicker = useCallback(() => {
    setTimePickerState({
      dayKey: null,
      field: null,
      visible: false,
      date: buildTimePickerDate('17:00'),
    });
  }, []);

  const handleClearDayTime = useCallback(
    (dayKey) => {
      clearTimeWindowError();
      setDayTimeSelections((prev) => ({
        ...prev,
        [dayKey]: { presetKey: 'none', start: '', end: '' },
      }));
      if (timePickerState.dayKey === dayKey) {
        handleCloseTimePicker();
      }
    },
    [clearTimeWindowError, handleCloseTimePicker, timePickerState.dayKey]
  );

  const handleSelectDuration = useCallback(
    (field, minutes) => {
      if (!Number.isFinite(minutes)) {
        return;
      }
      clearDurationError(field);
      setProfile((prev) => ({
        ...prev,
        [field]: String(minutes),
      }));
    },
    [clearDurationError]
  );

  const handleClearDuration = useCallback(
    (field) => {
      clearDurationError(field);
      setProfile((prev) => ({
        ...prev,
        [field]: '',
      }));
    },
    [clearDurationError]
  );

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

  const handleSelectGender = useCallback((value) => {
    if (typeof value !== 'string') {
      return;
    }
    setProfile((prev) => ({
      ...prev,
      gender: value,
    }));
    setFieldErrors((prev) => {
      if (!prev.gender) {
        return prev;
      }
      const next = { ...prev };
      delete next.gender;
      return next;
    });
  }, []);

  const adjustAge = useCallback((delta) => {
    setProfile((prev) => {
      const numeric = Number(prev.age);
      const base = Number.isFinite(numeric) ? numeric : MIN_AGE;
      const nextValue = Math.min(MAX_AGE, Math.max(MIN_AGE, base + delta));
      return { ...prev, age: String(nextValue) };
    });
    setFieldErrors((prev) => {
      if (!prev.age) {
        return prev;
      }
      const next = { ...prev };
      delete next.age;
      return next;
    });
  }, []);

  const clearAgeHoldTimers = useCallback(() => {
    if (ageHoldTimeoutRef.current) {
      clearTimeout(ageHoldTimeoutRef.current);
      ageHoldTimeoutRef.current = null;
    }
    if (ageHoldIntervalRef.current) {
      clearInterval(ageHoldIntervalRef.current);
      ageHoldIntervalRef.current = null;
    }
  }, []);

  const handleAgePressIn = useCallback(
    (delta) => {
      adjustAge(delta);
      clearAgeHoldTimers();
      ageHoldTimeoutRef.current = setTimeout(() => {
        ageHoldIntervalRef.current = setInterval(() => {
          adjustAge(delta);
        }, 120);
      }, 350);
    },
    [adjustAge, clearAgeHoldTimers]
  );

  const handleAgePressOut = useCallback(() => {
    clearAgeHoldTimers();
  }, [clearAgeHoldTimers]);

  useEffect(() => {
    return () => {
      clearAgeHoldTimers();
    };
  }, [clearAgeHoldTimers]);

  const validateProfile = () => {
    const nextErrors = {};
    if (!profile.name.trim()) {
      nextErrors.name = 'Navn skal udfyldes.';
    }

    if (!profile.age.trim()) {
      nextErrors.age = 'Alder skal udfyldes.';
    } else if (!/^\d+$/.test(profile.age.trim())) {
      nextErrors.age = 'Alder skal være et tal.';
    }

    if (!profile.gender.trim()) {
      nextErrors.gender = 'Køn skal udfyldes.';
    }

    if (!nextErrors.timeWindows) {
      for (const day of selectedDayObjects) {
        const selection = dayTimeSelections[day.key];
        if (!selection) {
          continue;
        }
        const startValue = selection.start?.trim?.() ?? '';
        const endValue = selection.end?.trim?.() ?? '';
        if (!startValue && !endValue) {
          continue;
        }
        if (!startValue || !endValue) {
          nextErrors.timeWindows = `Angiv både start og slut for ${day.label}.`;
          break;
        }
        if (!isValidTimeValue(startValue) || !isValidTimeValue(endValue)) {
          nextErrors.timeWindows = `Tidsformatet er ugyldigt for ${day.label}.`;
          break;
        }
        if (!isValidTimeRange(startValue, endValue)) {
          nextErrors.timeWindows = `Sluttid skal være efter starttid for ${day.label}.`;
          break;
        }
      }
    }

    const minDurationRaw = typeof profile.preferredMinDuration === 'string' ? profile.preferredMinDuration.trim() : '';
    const maxDurationRaw = typeof profile.preferredMaxDuration === 'string' ? profile.preferredMaxDuration.trim() : '';
    const minDurationValue = minDurationRaw ? Number(minDurationRaw) : null;
    const maxDurationValue = maxDurationRaw ? Number(maxDurationRaw) : null;

    if (minDurationRaw && (!Number.isFinite(minDurationValue) || minDurationValue <= 0)) {
      nextErrors.preferredMinDuration = 'Min. varighed skal vre et positivt tal (minutter).';
    }

    if (maxDurationRaw && (!Number.isFinite(maxDurationValue) || maxDurationValue <= 0)) {
      nextErrors.preferredMaxDuration = 'Max. varighed skal vre et positivt tal (minutter).';
    }

    if (Number.isFinite(minDurationValue) && Number.isFinite(maxDurationValue) && maxDurationValue < minDurationValue) {
      nextErrors.preferredMaxDuration = 'Max. varighed skal vre strre end min. varighed.';
    }

    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSaveProfile = async () => {
    if (!userId) {
      setGeneralError('Ingen bruger fundet. Prøv at logge ind igen.');
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

        if (Array.isArray(profile.preferredDays) && profile.preferredDays.length) {
          payload.preferredFamilyDays = profile.preferredDays;
        } else {
          payload.preferredFamilyDays = firebase.firestore.FieldValue.delete();
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
              'Profilen er gemt, men emoji kunne ikke opdateres for familien. Prøv igen.'
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
      setGeneralError('Kunne ikke gemme dine oplysninger. Prøv igen.');
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
                ? 'Redigér dine profiloplysninger og familiepræferencer.'
                : 'Fortæl os lidt om dig selv, så familien kan lære dig bedre at kende.'}
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
                    <Text style={styles.emojiLabel}>Vælg din emoji</Text>
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
                            accessibilityLabel={`Vælg emoji ${emoji}`}
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
                  <View style={styles.ageGroup}>
                    <Text style={styles.preferenceSubtitle}>Alder</Text>
                    <View style={styles.ageStepper}>
                      <Pressable
                        onPressIn={() => handleAgePressIn(-1)}
                        onPressOut={handleAgePressOut}
                        style={styles.ageButton}
                        accessibilityRole="button"
                        accessibilityLabel="Mindsk alder"
                      >
                        <Text style={styles.ageButtonText}>-</Text>
                      </Pressable>
                      <Text style={styles.ageValue}>
                        {profile.age && /^\d+$/.test(profile.age)
                          ? profile.age
                          : '—'}
                      </Text>
                      <Pressable
                        onPressIn={() => handleAgePressIn(1)}
                        onPressOut={handleAgePressOut}
                        style={styles.ageButton}
                        accessibilityRole="button"
                        accessibilityLabel="Øg alder"
                      >
                        <Text style={styles.ageButtonText}>+</Text>
                      </Pressable>
                    </View>
                    {fieldErrors.age ? (
                      <Text style={styles.validationMessage}>
                        {fieldErrors.age}
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.genderGroup}>
                    <Text style={styles.preferenceSubtitle}>Køn</Text>
                    <View style={styles.genderChipsWrap}>
                      {GENDER_OPTIONS.map((option) => {
                        const selected = profile.gender === option;
                        return (
                          <Pressable
                            key={option}
                            onPress={() => handleSelectGender(option)}
                            style={[
                              styles.genderChip,
                              selected ? styles.genderChipSelected : null,
                            ]}
                            accessibilityRole="button"
                            accessibilityState={{ selected }}
                            accessibilityLabel={`Vælg ${option}`}
                          >
                            <Text
                              style={[
                                styles.genderChipText,
                                selected ? styles.genderChipTextSelected : null,
                              ]}
                            >
                              {option}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    {fieldErrors.gender ? (
                      <Text style={styles.validationMessage}>
                        {fieldErrors.gender}
                      </Text>
                    ) : null}
                  </View>
                <FormInput
                  label="Lokation (valgfrit)"
                  value={profile.location}
                  onChangeText={updateField('location')}
                  placeholder="Byen du bor i"
                  error={fieldErrors.location}
                  style={styles.field}
                />

                <View style={styles.sectionDivider} />

                <Text style={styles.preferenceTitle}>Familietidspræferencer</Text>
                <Text style={styles.preferenceHint}>
                  Hjælp FamTime med at foreslå tidspunkter, der passer hele familien.
                </Text>
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
                  Vælg tidsrum pr. dag, så FamTime ved hvornår familien typisk kan mødes.
                </Text>
                <View style={styles.dayTimeList}>
                  {selectedDayObjects.length === 0 ? (
                    <Text style={styles.preferenceFootnote}>
                      Vælg mindst én foretrukken dag for at indstille tidsrum.
                    </Text>
                  ) : (
                    selectedDayObjects.map((day) => {
                      const selection = dayTimeSelections[day.key] ?? {
                        presetKey: 'none',
                        start: '',
                        end: '',
                      };
                      const activePresetKey = selection.presetKey ?? 'none';
                      const summary = getDaySelectionSummary(day.key);
                      const showCustom =
                        activePresetKey === CUSTOM_TIME_PRESET;

                      return (
                        <View key={day.key} style={styles.dayTimeCard}>
                          <View style={styles.dayTimeHeader}>
                            <Text style={styles.dayTimeLabel}>
                              {day.label}
                            </Text>
                            <Text style={styles.dayTimeSummary}>{summary}</Text>
                          </View>
                          <View style={styles.dayTimeActions}>
                            <Pressable
                              onPress={() => handleClearDayTime(day.key)}
                              disabled={!selection.start && !selection.end}
                            >
                              <Text
                                style={[
                                  styles.timeSelectionClear,
                                  selection.start || selection.end
                                    ? null
                                    : styles.timeSelectionClearDisabled,
                                ]}
                              >
                                Nulstil
                              </Text>
                            </Pressable>
                          </View>
                          <View style={styles.timePresetWrap}>
                            {TIME_WINDOW_PRESETS.map((preset) => {
                              const selected = activePresetKey === preset.key;
                              return (
                                <Pressable
                                  key={`${day.key}-${preset.key}`}
                                  onPress={() =>
                                    handleDayPresetSelect(day.key, preset.key)
                                  }
                                  style={[
                                    styles.timePresetChip,
                                    selected
                                      ? styles.timePresetChipSelected
                                      : null,
                                  ]}
                                  accessibilityRole="button"
                                  accessibilityLabel={`Vælg ${preset.label} for ${day.label}`}
                                >
                                  <Text
                                    style={[
                                      styles.timePresetLabel,
                                      selected
                                        ? styles.timePresetLabelSelected
                                        : null,
                                    ]}
                                  >
                                    {preset.label}
                                  </Text>
                                  {preset.display ? (
                                    <Text
                                      style={[
                                        styles.timePresetRange,
                                        selected
                                          ? styles.timePresetRangeSelected
                                          : null,
                                      ]}
                                    >
                                      {preset.display}
                                    </Text>
                                  ) : null}
                                </Pressable>
                              );
                            })}
                            <Pressable
                              key={`${day.key}-custom`}
                              onPress={() => handleCustomTimeMode(day.key)}
                              style={[
                                styles.timePresetChip,
                                activePresetKey === CUSTOM_TIME_PRESET
                                  ? styles.timePresetChipSelected
                                  : null,
                              ]}
                              accessibilityRole="button"
                              accessibilityLabel={`Tilpas tidsrum for ${day.label}`}
                            >
                              <Text
                                style={[
                                  styles.timePresetLabel,
                                  activePresetKey === CUSTOM_TIME_PRESET
                                    ? styles.timePresetLabelSelected
                                    : null,
                                ]}
                              >
                                Tilpas
                              </Text>
                              <Text
                                style={[
                                  styles.timePresetRange,
                                  activePresetKey === CUSTOM_TIME_PRESET
                                    ? styles.timePresetRangeSelected
                                    : null,
                                ]}
                              >
                                {isValidTimeRange(selection.start, selection.end)
                                  ? `${selection.start}-${selection.end}`
                                  : 'Vælg tider'}
                              </Text>
                            </Pressable>
                          </View>
                          {showCustom ? (
                            <>
                              <View style={styles.timeSelectionRow}>
                                <Pressable
                                  style={styles.timeSelectionButton}
                                  onPress={() =>
                                    openDayTimePicker(day.key, 'start')
                                  }
                                >
                                  <Text style={styles.timeSelectionLabel}>
                                    Start
                                  </Text>
                                  <Text style={styles.timeSelectionValue}>
                                    {formatTimeSelectionDisplay(
                                      selection.start
                                    )}
                                  </Text>
                                </Pressable>
                                <Pressable
                                  style={[
                                    styles.timeSelectionButton,
                                    styles.timeSelectionButtonRight,
                                  ]}
                                  onPress={() =>
                                    openDayTimePicker(day.key, 'end')
                                  }
                                >
                                  <Text style={styles.timeSelectionLabel}>
                                    Slut
                                  </Text>
                                  <Text style={styles.timeSelectionValue}>
                                    {formatTimeSelectionDisplay(
                                      selection.end
                                    )}
                                  </Text>
                                </Pressable>
                              </View>
                              {timePickerState.visible &&
                              timePickerState.dayKey === day.key ? (
                                <View style={styles.inlineTimePicker}>
                                  <DateTimePicker
                                    value={timePickerState.date}
                                    mode="time"
                                    display={
                                      isIOS ? 'spinner' : 'default'
                                    }
                                    onChange={handleTimePickerChange}
                                  />
                                  {isIOS ? (
                                    <Pressable
                                      onPress={handleCloseTimePicker}
                                      style={styles.timePickerCloseButton}
                                    >
                                      <Text
                                        style={styles.timePickerCloseText}
                                      >
                                        Færdig
                                      </Text>
                                    </Pressable>
                                  ) : null}
                                </View>
                              ) : null}
                            </>
                          ) : null}
                        </View>
                      );
                    })
                  )}
                  {fieldErrors.timeWindows ? (
                    <Text style={styles.validationMessage}>
                      {fieldErrors.timeWindows}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.durationGroup}>
                  <View style={styles.durationHeader}>
                    <Text style={styles.durationTitle}>Min. varighed</Text>
                    <Pressable
                      onPress={() => handleClearDuration('preferredMinDuration')}
                    >
                      <Text
                        style={[
                          styles.timeSelectionClear,
                          profile.preferredMinDuration
                            ? null
                            : styles.timeSelectionClearDisabled,
                        ]}
                      >
                        Ryd
                      </Text>
                    </Pressable>
                  </View>
                  <View style={styles.durationChipWrap}>
                    {DURATION_PRESETS.map((minutes) => {
                      const isSelected =
                        Number(profile.preferredMinDuration) === minutes;
                      return (
                        <Pressable
                          key={`min-${minutes}`}
                          onPress={() =>
                            handleSelectDuration('preferredMinDuration', minutes)
                          }
                          style={[
                            styles.durationChip,
                            isSelected ? styles.durationChipSelected : null,
                          ]}
                        >
                          <Text
                            style={[
                              styles.durationChipText,
                              isSelected ? styles.durationChipTextSelected : null,
                            ]}
                          >
                            {minutes} min
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
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
                </View>
                <View style={styles.durationGroup}>
                  <View style={styles.durationHeader}>
                    <Text style={styles.durationTitle}>Max. varighed</Text>
                    <Pressable
                      onPress={() => handleClearDuration('preferredMaxDuration')}
                    >
                      <Text
                        style={[
                          styles.timeSelectionClear,
                          profile.preferredMaxDuration
                            ? null
                            : styles.timeSelectionClearDisabled,
                        ]}
                      >
                        Ryd
                      </Text>
                    </Pressable>
                  </View>
                  <View style={styles.durationChipWrap}>
                    {DURATION_PRESETS.map((minutes) => {
                      const isSelected =
                        Number(profile.preferredMaxDuration) === minutes;
                      return (
                        <Pressable
                          key={`max-${minutes}`}
                          onPress={() =>
                            handleSelectDuration('preferredMaxDuration', minutes)
                          }
                          style={[
                            styles.durationChip,
                            isSelected ? styles.durationChipSelected : null,
                          ]}
                        >
                          <Text
                            style={[
                              styles.durationChipText,
                              isSelected ? styles.durationChipTextSelected : null,
                            ]}
                          >
                            {minutes} min
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <FormInput
                    label="Max. varighed (minutter, valgfrit)"
                    value={profile.preferredMaxDuration}
                    onChangeText={updateField('preferredMaxDuration')}
                    keyboardType="number-pad"
                    placeholder="Fx 120"
                    autoCapitalize="none"
                    error={fieldErrors.preferredMaxDuration}
                    style={styles.field}
                  />
                </View>
                <Text style={styles.preferenceFootnote}>
                  Lad felterne st tomme, hvis I er fleksible med bde tidsrum og varighed.
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
                F hurtig adgang til delte oplysninger og del familie ID med andre.
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
              Log ud, hvis du ønsker at skifte bruger eller sikre din konto.
            </Text>
            <ErrorMessage message={logoutError} />
            <Button title="Log ud" onPress={handleLogout} style={styles.logout} />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};



export default LandingScreen;
