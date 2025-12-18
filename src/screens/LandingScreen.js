/**
 * LandingScreen
 *
 * Hvad goer filen for appen:
 * - Er brugerens "profil-setup" efter login: her udfylder man profil (navn, alder, koen, by, avatar) og familie-præferencer.
 * - Gemmer oplysningerne i Firestore og viser/udleverer familie-id, så man kan invitere andre til samme familie.
 * - Danner grundlag for resten af appen: præferencerne bruges senere til at beregne ledige tider og foreslaa aktiviteter.
 *
 * Overblik (hvordan filen er bygget op):
 * - Konfiguration/konstanter: ugedage, tidsvindue-presets, default tider og helpers til slot-ids.
* - Helpers: bygger/normaliserer tids-slots, validerer tid (HH:MM), og formaterer UI-tekst.
* - OPDATER FELT-VÆRDI: Returnerer en onChange-handler til FormInput, der opdaterer profil-state for et givent felt uden ekstra logik.
 * - State: profilfelter + fejl/loader, dag->tidsvinduer (slots), valg af by/avatar, og UI-state for timepicker.
 * - Dataflow: henter eksisterende profil fra Firestore (edit-mode), og gemmer opdateret profil tilbage ved "Gem".
 * - Handlinger: ændring af dage/slots, åbne/lukke timepicker, kopiere familie-id, og `handleSaveProfile` der validerer og skriver til Firestore.
* - UI: scroll-view med sektioner for profilfelter, avatar/by, familieinfo, og en editor for daglige tidsvinduer.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  ScrollView,
  Pressable,
  Platform,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Button from '../components/Button';
import FormInput from '../components/FormInput';
import ErrorMessage from '../components/ErrorMessage';
import { auth, db, firebase } from '../lib/firebase';
import { colors } from '../styles/theme';
import styles from '../styles/screens/LandingScreenStyles';
import { copyStringToClipboard } from '../utils/clipboard';
import {
  AVATAR_EMOJIS,
  DEFAULT_AVATAR_EMOJI,
} from '../constants/avatarEmojis';
import DurationRangeSlider from '../components/DurationRangeSlider';
import {
  /**
   * OPSUMMER DAGENS VALG
   * 
   * Bygger en kort tekst til UI baseret på presets eller konkrete slots
   * (fx "Morgen, Aften" eller "2 tidsrum valgt").
   */
  FAMILY_PREFERENCE_MODE_OPTIONS,
  FAMILY_PREFERENCE_MODES,
  normalizeFamilyPreferenceMode,
} from '../constants/familyPreferenceModes';
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

/**
 * TIDSVINDUE PRESETS
 * 
 * Nogle brugere kan have svært ved selv at sætte tider.
 * Her er nogle faste forslag: Morgen (06:00-09:00), Formiddag osv.
 * 
 * Brugeren kan enten vælge et preset eller selv skrive tider.
 */
const TIME_WINDOW_PRESETS = [
  {
    key: 'none',
    label: 'Ingen',
    start: '',
    end: '',
  /**
   * RYD FEJL FOR TIDSVINDUER
   * 
   * Fjerner `timeWindows`-fejlen når brugeren retter i slots, så UI
   * afspejler den nye, potentielt valide tilstand.
   */
    display: 'Ingen tidsrum',
  },
  {
    key: 'morning',
    label: 'Morgen',
    start: '06:00',
    end: '09:00',
    display: '06:00-09:00',
  },
  {
    key: 'forenoon',
  /**
   * UDFOLD/DEN UDFOLD DAG
   * 
   * Toggler accordion-tilstand for en given dag.
   */
    label: 'Formiddag',
    start: '09:00',
    end: '12:00',
    display: '09:00-12:00',
  /**
   * TIL/FRAKOBL PRESET SLOT
   * 
   * Tilføjer eller fjerner et foruddefineret tidsrum for en dag. Resetter
   * "allday" når andet preset vælges og sikrer timepicker lukkes ved fjernelse.
   */
  },
  {
    key: 'afternoon',
    label: 'Eftermiddag',
    start: '12:00',
    end: '16:00',
    display: '12:00-16:00',
  },
  {
    key: 'evening',
    label: 'Aften',
    start: '16:00',
    end: '20:00',
    display: '16:00-20:00',
  },
  {
    key: 'late',
    label: 'Sen aften',
    start: '20:00',
    end: '23:59',
    display: '20:00-23:59',
  },
  {
    key: 'allday',
    label: 'Alle tider',
    start: '06:00',
    end: '23:59',
    display: '06:00-23:59',
  },
];

const CUSTOM_TIME_PRESET = 'custom';
const isIOS = Platform.OS === 'ios';
const DEFAULT_CUSTOM_START = '17:00';
const DEFAULT_CUSTOM_END = '19:00';
const QUICK_TIME_PRESETS = TIME_WINDOW_PRESETS.filter(
  (preset) => preset.key !== 'none'
);
const PRESET_LABEL_MAP = TIME_WINDOW_PRESETS.reduce((acc, preset) => {
  if (preset.key !== 'none') {
    acc[preset.key] = preset.label;
  }
  return acc;
}, {});
const PRESET_ORDER = TIME_WINDOW_PRESETS.reduce((acc, preset, index) => {
  if (preset.key !== 'none') {
    acc[preset.key] = index;
  }
  return acc;
}, {});
const DEFAULT_DAY_PRESET_KEY = 'allday';

let slotIdCounter = 0;
const createSlotId = () => {
  slotIdCounter += 1;
  /**
   * AKTIVER/DEAKTIVER DAG
   * 
   * Når en dag aktiveres tilføjes et standard-slot; når den deaktiveres
   * ryddes slots og eventuel timepicker lukkes.
   */
  return `slot-${slotIdCounter}`;
};

const findPresetForWindow = (start, end) => {
  const match = TIME_WINDOW_PRESETS.find(
    (preset) =>
      preset.start &&
      preset.end &&
      preset.start === start &&
      preset.end === end
  );
  return match ? match.key : CUSTOM_TIME_PRESET;
};

const createSlot = ({ presetKey, start, end } = {}) => {
  const normalizedPreset =
    presetKey && presetKey !== 'none' ? presetKey : CUSTOM_TIME_PRESET;
  if (
    normalizedPreset !== CUSTOM_TIME_PRESET &&
    typeof start !== 'string' &&
    typeof end !== 'string'
  ) {
    const preset = TIME_WINDOW_PRESETS.find(
      (item) => item.key === normalizedPreset
    );
    if (preset?.start && preset?.end) {
      return {
        id: createSlotId(),
        presetKey: preset.key,
        start: preset.start,
        end: preset.end,
      };
    }
  }
  return {
    id: createSlotId(),
    presetKey: normalizedPreset,
    originalPresetKey:
      normalizedPreset !== CUSTOM_TIME_PRESET ? normalizedPreset : null,
    start: typeof start === 'string' && start.length ? start : DEFAULT_CUSTOM_START,
    end: typeof end === 'string' && end.length ? end : DEFAULT_CUSTOM_END,
  };
};

const createEmptyDaySelection = () => ({
  slots: [],
});

const getPresetOrder = (presetKey) => {
  if (!presetKey) {
    return Infinity;
  }
  /**
   * TRYK PÅ DAG-HOVED
   * 
   * Åbner dagen hvis den er inaktiv (og aktiverer den), ellers toggler
   * blot accordion-state.
   */
  return PRESET_ORDER[presetKey] ?? Infinity;
};

const sortSlotsByPreset = (slots = []) => {
  return [...slots].sort((slotA, slotB) => {
    const orderA = getPresetOrder(slotA.originalPresetKey ?? slotA.presetKey);
    const orderB = getPresetOrder(slotB.originalPresetKey ?? slotB.presetKey);
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    const startA = typeof slotA.start === 'string' ? slotA.start : '';
  /**
   * HÅNDTER VALG I TIDSPICKER
   * 
   * Gemmer valgt tid på slottet, skifter til custom-mode og lukker picker
   * (på Android) eller opdaterer tiden live (iOS).
   */
    const startB = typeof slotB.start === 'string' ? slotB.start : '';
    return startA.localeCompare(startB);
  });
};

const arraysEqual = (a = [], b = []) => {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }
  return true;
};
const CUSTOM_DURATION_MAX = 5 * 60;
const DEFAULT_MIN_DURATION_MINUTES = 60;
const DEFAULT_MAX_DURATION_MINUTES = 4 * 60;

const buildTimeWindowPayload = (selections) => {
  const payload = {};
  WEEK_DAYS.forEach(({ key }) => {
    const slots = selections[key]?.slots ?? [];
    const normalizedSlots = slots
      .map((slot) => {
        const start =
          typeof slot.start === 'string' ? slot.start.trim() : '';
        const end =
          typeof slot.end === 'string' ? slot.end.trim() : '';
        if (!isValidTimeRange(start, end)) {
          return null;
        }
        return { start, end };
      })
      .filter(Boolean);
    if (normalizedSlots.length) {
      payload[key] = normalizedSlots;
    }
  });
  return Object.keys(payload).length ? payload : null;
};

const GENDER_OPTIONS = ['Kvinde', 'Mand', 'Andet'];
const CHILDREN_COUNT_MIN = 0;
const CHILDREN_COUNT_MAX = 10;
const MIN_AGE = 5;
const MAX_AGE = 100;
const DANISH_CITY_OPTIONS = ['København', 'Odense', 'Aalborg'];

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
    map[day.key] = createEmptyDaySelection();
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
  fallbackEnd = '',
  preferredDayKeys = null
) => {
  const selections = createInitialDayTimeSelections();
  const fallbackWindow = isValidTimeRange(fallbackStart, fallbackEnd)
    ? { start: fallbackStart, end: fallbackEnd }
    : null;
  const hasPreferredDayConstraint = Array.isArray(preferredDayKeys);
  const preferredDaySet = hasPreferredDayConstraint
    ? new Set(preferredDayKeys)
    : null;

  const readWindowEntries = (list) => {
    const entries = [];
    if (Array.isArray(list)) {
      list.forEach((item) => {
        const entry = readWindowEntry(item);
        if (entry) {
          entries.push(entry);
        }
      });
    } else if (list && typeof list === 'object') {
      const entry = readWindowEntry(list);
      if (entry) {
        entries.push(entry);
      }
    }
    return entries;
  };

  const defaultEntries =
    readWindowEntries(timeWindows?.default) ||
    (fallbackWindow ? [fallbackWindow] : []);

  WEEK_DAYS.forEach(({ key }) => {
    const entries = readWindowEntries(timeWindows?.[key]);
    if (entries.length) {
      const allowExplicit =
        !hasPreferredDayConstraint || preferredDaySet?.has(key);
      if (!allowExplicit) {
        return;
      }
      selections[key] = {
        slots: entries.map((entry) => {
          const presetKey = findPresetForWindow(entry.start, entry.end);
          return {
            id: createSlotId(),
            presetKey,
            originalPresetKey:
              presetKey !== CUSTOM_TIME_PRESET ? presetKey : null,
            start: entry.start,
            end: entry.end,
          };
        }),
      };
      return;
    }
    if (!defaultEntries.length) {
      return;
    }
    const allowDefault =
      !hasPreferredDayConstraint || preferredDaySet.has(key);
    if (!allowDefault) {
      return;
    }
    selections[key] = {
      slots: defaultEntries.map((entry) => {
        const presetKey = findPresetForWindow(entry.start, entry.end);
        return {
          id: createSlotId(),
          presetKey,
          originalPresetKey:
            presetKey !== CUSTOM_TIME_PRESET ? presetKey : null,
          start: entry.start,
          end: entry.end,
        };
      }),
    };
  });

  return selections;
};

const LandingScreen = ({ navigation, route }) => {
  const isEditMode = route?.params?.mode === 'edit';
  // Overblik: indlaeser/gemmer profiloplysninger og viser familieinvitation til brugeren.
  // State-grupper: profilfelter (navn/age/gender/emoji), tidspræferencer (dage/vinduer),
  // familie-id/kopi-feedback, samt UI-tilstande for loaders/validering/pickers.
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
    childrenCount: '',
    preferredMinDuration: String(DEFAULT_MIN_DURATION_MINUTES),
    preferredMaxDuration: String(DEFAULT_MAX_DURATION_MINUTES),
    avatarEmoji: '',
    familyPreferenceMode: FAMILY_PREFERENCE_MODES.CUSTOM,
    familyPreferenceFollowUserId: '',
  });
  const [dayTimeSelections, setDayTimeSelections] = useState(
    createInitialDayTimeSelections
  );
  const [expandedDayKey, setExpandedDayKey] = useState(WEEK_DAYS[0].key);
  const [timePickerState, setTimePickerState] = useState({
    dayKey: null,
    slotId: null,
    field: null,
    visible: false,
    date: buildTimePickerDate('17:00'),
  });

  const userEmail = auth.currentUser?.email ?? 'Ukendt bruger';
  const userId = auth.currentUser?.uid ?? null;
  const [copyFeedback, setCopyFeedback] = useState('');
  const [formReminder, setFormReminder] = useState('');
  const [familyMembers, setFamilyMembers] = useState([]);
  const [hasCustomDaySelected, setHasCustomDaySelected] = useState(false);
  const hasFamily = useMemo(() => Boolean(profile.familyId), [profile.familyId]);
  const normalizedPreferenceMode = useMemo(
    () => normalizeFamilyPreferenceMode(profile.familyPreferenceMode),
    [profile.familyPreferenceMode]
  );
  const isCustomPreferenceMode =
    normalizedPreferenceMode === FAMILY_PREFERENCE_MODES.CUSTOM;
  const isFollowPreferenceMode =
    normalizedPreferenceMode === FAMILY_PREFERENCE_MODES.FOLLOW;
  const isNoPreferenceMode =
    normalizedPreferenceMode === FAMILY_PREFERENCE_MODES.NONE;
  const followableMembers = useMemo(
    () =>
      familyMembers.filter(
        (member) =>
          typeof member?.userId === 'string' &&
          member.userId.length > 0 &&
          member.userId !== userId
      ),
    [familyMembers, userId]
  );
  const selectedFollowMember = useMemo(
    () =>
      followableMembers.find(
        (member) => member.userId === profile.familyPreferenceFollowUserId
      ) ?? null,
    [followableMembers, profile.familyPreferenceFollowUserId]
  );
  const canFollowPreference = followableMembers.length > 0;

  useEffect(() => {
    if (!isFollowPreferenceMode) {
      return;
    }
    const currentFollowId =
      typeof profile.familyPreferenceFollowUserId === 'string'
        ? profile.familyPreferenceFollowUserId
        : '';
    const hasCurrent = followableMembers.some(
      (member) => member.userId === currentFollowId
    );
    if (hasCurrent) {
      return;
    }
    const fallbackId = followableMembers[0]?.userId ?? '';
    if (currentFollowId === fallbackId) {
      return;
    }
    setProfile((prev) => ({
      ...prev,
      familyPreferenceFollowUserId: fallbackId,
    }));
  }, [
    followableMembers,
    isFollowPreferenceMode,
    profile.familyPreferenceFollowUserId,
  ]);
  const normalizedLocation =
    typeof profile.location === 'string' ? profile.location.trim() : '';
  const hasLegacyLocation =
    normalizedLocation.length > 0 &&
    !DANISH_CITY_OPTIONS.includes(normalizedLocation);
  const selectedLocation = hasLegacyLocation ? '' : normalizedLocation;
  const minDurationMinutes = useMemo(() => {
    const value = Number(profile.preferredMinDuration);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }, [profile.preferredMinDuration]);
  const maxDurationMinutes = useMemo(() => {
    const value = Number(profile.preferredMaxDuration);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }, [profile.preferredMaxDuration]);
  const [durationSliderMin, durationSliderMax] = useMemo(() => {
    const fallbackMin = DEFAULT_MIN_DURATION_MINUTES;
    const fallbackMax = DEFAULT_MAX_DURATION_MINUTES;
    let normalizedMin =
      minDurationMinutes > 0 ? minDurationMinutes : fallbackMin;
    let normalizedMax =
      maxDurationMinutes > 0 ? maxDurationMinutes : fallbackMax;
    normalizedMin = Math.max(15, Math.min(normalizedMin, CUSTOM_DURATION_MAX - 15));
    normalizedMax = Math.max(normalizedMin + 15, Math.min(normalizedMax, CUSTOM_DURATION_MAX));
    return [normalizedMin, normalizedMax];
  }, [minDurationMinutes, maxDurationMinutes]);

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

          const hasPreferredDaysField = Object.prototype.hasOwnProperty.call(
            data,
            'preferredFamilyDays'
          );
          const preferredDayCandidatesFromWindows = Object.keys(
            data.preferredFamilyTimeWindows ?? {}
          )
            .filter((key) => key !== 'default')
            .filter((dayKey) =>
              WEEK_DAYS.some((day) => day.key === dayKey)
            );
          const normalizedPreferredDays = hasPreferredDaysField
            ? Array.isArray(data.preferredFamilyDays)
              ? data.preferredFamilyDays.filter((dayKey) =>
                  WEEK_DAYS.some((day) => day.key === dayKey)
                )
              : []
            : preferredDayCandidatesFromWindows.length
              ? preferredDayCandidatesFromWindows
              : [];
          const normalizedChildrenCount = (() => {
            const isAllowedRange = (value) =>
              Number.isFinite(value) &&
              value >= CHILDREN_COUNT_MIN &&
              value <= CHILDREN_COUNT_MAX;
            if (typeof data.childrenCount === 'number') {
              const numericValue = Number(data.childrenCount);
              return isAllowedRange(numericValue) ? String(numericValue) : '';
            }
            if (typeof data.childrenCount === 'string') {
              const trimmed = data.childrenCount.trim();
              if (trimmed === '+4') {
                return '4';
              }
              if (/^\d+$/.test(trimmed)) {
                const numericValue = Number(trimmed);
                return isAllowedRange(numericValue) ? String(numericValue) : '';
              }
            }
            return '';
          })();

          setProfile({
            name: data.name ?? '',
            age:
              typeof data.age === 'number' && !Number.isNaN(data.age)
                ? String(data.age)
                : data.age ?? '',
            gender: data.gender ?? '',
            location:
              typeof data.location === 'string' ? data.location.trim() : '',
            familyId: data.familyId ?? '',
            familyRole: data.familyRole ?? '',
            preferredDays: normalizedPreferredDays,
            childrenCount: normalizedChildrenCount,
            preferredMinDuration:
              minDurationMinutes || String(DEFAULT_MIN_DURATION_MINUTES),
            preferredMaxDuration:
              maxDurationMinutes || String(DEFAULT_MAX_DURATION_MINUTES),
            avatarEmoji:
              typeof data.avatarEmoji === 'string' && data.avatarEmoji.trim().length
                ? data.avatarEmoji.trim()
                : DEFAULT_AVATAR_EMOJI,
            familyPreferenceMode: normalizeFamilyPreferenceMode(
              data.familyPreferenceMode
            ),
            familyPreferenceFollowUserId:
              typeof data.familyPreferenceFollowUserId === 'string'
                ? data.familyPreferenceFollowUserId.trim()
                : '',
          });
          setDayTimeSelections(
            hydrateDayTimeSelections(
              data.preferredFamilyTimeWindows,
              primaryTimeWindow.start,
              primaryTimeWindow.end,
              hasPreferredDaysField
                ? normalizedPreferredDays
                : preferredDayCandidatesFromWindows.length
                  ? preferredDayCandidatesFromWindows
                  : null
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

  useEffect(() => {
    if (!isCustomPreferenceMode) {
      return;
    }
    const activeKeys = WEEK_DAYS.filter(
      ({ key }) =>
        Array.isArray(dayTimeSelections[key]?.slots) &&
        dayTimeSelections[key].slots.length > 0
    ).map(({ key }) => key);
    const hasAnyDaySelected = activeKeys.length > 0;
    setHasCustomDaySelected(hasAnyDaySelected);
    setProfile((prev) => {
      const currentDays = Array.isArray(prev.preferredDays)
        ? prev.preferredDays
        : [];
      if (arraysEqual(currentDays, activeKeys)) {
        return prev;
      }
      return {
        ...prev,
        preferredDays: activeKeys,
      };
    });
  }, [dayTimeSelections, isCustomPreferenceMode]);

  useEffect(() => {
    const familyId =
      typeof profile.familyId === 'string' ? profile.familyId.trim() : '';
    if (!familyId) {
      setFamilyMembers([]);
      return () => {};
    }

    let isActive = true;
    const unsubscribe = db
      .collection('families')
      .doc(familyId)
      .onSnapshot(
        (snapshot) => {
          if (!snapshot.exists) {
            if (isActive) {
              setFamilyMembers([]);
            }
            return;
          }
          const data = snapshot.data() ?? {};
          const members = Array.isArray(data.members)
            ? data.members
                .map((member) => {
                  const userIdValue =
                    typeof member?.userId === 'string' ? member.userId.trim() : '';
                  if (!userIdValue) {
                    return null;
                  }
                  const displayName =
                    typeof member?.displayName === 'string' && member.displayName.trim().length
                      ? member.displayName.trim()
                      : typeof member?.name === 'string' && member.name.trim().length
                        ? member.name.trim()
                        : typeof member?.email === 'string' && member.email.trim().length
                          ? member.email.trim()
                          : 'Familiemedlem';
                  const avatarEmojiValue =
                    typeof member?.avatarEmoji === 'string' && member.avatarEmoji.trim().length
                      ? member.avatarEmoji.trim()
                      : DEFAULT_AVATAR_EMOJI;
                  return {
                    userId: userIdValue,
                    displayName,
                    avatarEmoji: avatarEmojiValue,
                  };
                })
                .filter(Boolean)
            : [];
          if (isActive) {
            setFamilyMembers(members);
          }
        },
        () => {
          if (isActive) {
            setFamilyMembers([]);
          }
        }
      );

    return () => {
      isActive = false;
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [profile.familyId]);

  const updateField = (field) => (value) => {
    setProfile((prev) => ({ ...prev, [field]: value }));
  };

  const handleRemoveTimeSlot = useCallback(
    (dayKey, slotId) => {
      clearTimeWindowError();
      setDayTimeSelections((prev) => {
        const current = prev[dayKey] ?? createEmptyDaySelection();
        const nextSlots = current.slots.filter((slot) => slot.id !== slotId);
        if (nextSlots.length === current.slots.length) {
          return prev;
        }
        if (
          timePickerState.dayKey === dayKey &&
          timePickerState.slotId === slotId
        ) {
          handleCloseTimePicker();
        }
        return {
          ...prev,
          [dayKey]: {
            slots: nextSlots,
          },
        };
      });
    },
    [clearTimeWindowError, handleCloseTimePicker, timePickerState.dayKey, timePickerState.slotId]
  );

  const getDaySelectionSummary = useCallback(
    (dayKey) => {
      const slots = sortSlotsByPreset(dayTimeSelections[dayKey]?.slots ?? []);
      if (!slots.length) {
        return 'Ingen tidsrum';
      }
      const presetSummaries = slots
        .map((slot) => PRESET_LABEL_MAP[slot.originalPresetKey] ?? null)
        .filter(Boolean);
      if (presetSummaries.length === 1) {
        return presetSummaries[0];
      }
      if (presetSummaries.length > 1) {
        const preview = presetSummaries.slice(0, 2).join(', ');
        const remaining = presetSummaries.length - 2;
        return remaining > 0 ? `${preview} +${remaining}` : preview;
      }
      const validSlots = slots.filter((slot) =>
        isValidTimeRange(slot.start, slot.end)
      );
      if (validSlots.length === 1) {
        const slot = validSlots[0];
        return `${slot.start}-${slot.end}`;
      }
      if (validSlots.length > 1) {
        return `${validSlots.length} tidsrum valgt`;
      }
      return `${slots.length} tidsrum valgt`;
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

  const toggleDayExpansion = useCallback((dayKey) => {
    setExpandedDayKey((prev) => (prev === dayKey ? null : dayKey));
  }, []);

  const handleTogglePresetSlot = useCallback(
    (dayKey, presetKey) => {
      const preset = TIME_WINDOW_PRESETS.find((item) => item.key === presetKey);
      if (!preset || !preset.start || !preset.end) {
        return;
      }
      clearTimeWindowError();
      setDayTimeSelections((prev) => {
        const current = prev[dayKey] ?? createEmptyDaySelection();
        const existingSlot = current.slots.find(
          (slot) => slot.originalPresetKey === presetKey
        );
        if (existingSlot) {
          if (
            timePickerState.dayKey === dayKey &&
            timePickerState.slotId === existingSlot.id
          ) {
            handleCloseTimePicker();
          }
          const nextSlots = current.slots.filter(
            (slot) => slot.id !== existingSlot.id
          );
          return {
            ...prev,
            [dayKey]: {
              slots: nextSlots,
            },
          };
        }
        const filteredSlots =
          presetKey === 'allday'
            ? []
            : current.slots.filter((slot) => slot.originalPresetKey !== 'allday');
        const nextSlot = createSlot({
          presetKey: preset.key,
          start: preset.start,
          end: preset.end,
        });
        return {
          ...prev,
          [dayKey]: {
            slots: [...filteredSlots, nextSlot],
          },
        };
      });
      setExpandedDayKey(dayKey);
    },
    [
      clearTimeWindowError,
      handleCloseTimePicker,
      timePickerState.dayKey,
      timePickerState.slotId,
    ]
  );

  const handleToggleDayActive = useCallback(
    (dayKey, nextActive) => {
      clearTimeWindowError();
      if (nextActive) {
        const defaultPreset =
          TIME_WINDOW_PRESETS.find(
            (preset) => preset.key === DEFAULT_DAY_PRESET_KEY
          ) ??
          TIME_WINDOW_PRESETS.find(
            (preset) => preset.key !== 'none' && preset.start && preset.end
          );
        if (defaultPreset) {
          setDayTimeSelections((prev) => {
            const current = prev[dayKey] ?? createEmptyDaySelection();
            if (current.slots.length) {
              return prev;
            }
            return {
              ...prev,
              [dayKey]: {
                slots: [
                  createSlot({
                    presetKey: defaultPreset.key,
                    start: defaultPreset.start,
                    end: defaultPreset.end,
                  }),
                ],
              },
            };
          });
        }
        setExpandedDayKey(dayKey);
        return;
      }
      if (timePickerState.dayKey === dayKey) {
        handleCloseTimePicker();
      }
      setDayTimeSelections((prev) => {
        const current = prev[dayKey] ?? createEmptyDaySelection();
        if (!current.slots.length) {
          return prev;
        }
        return {
          ...prev,
          [dayKey]: createEmptyDaySelection(),
        };
      });
      setExpandedDayKey((prev) => (prev === dayKey ? null : prev));
    },
    [clearTimeWindowError, handleCloseTimePicker, timePickerState.dayKey]
  );

  const handleDayHeaderPress = useCallback(
    (dayKey, isActive) => {
      if (!isActive) {
        handleToggleDayActive(dayKey, true);
        return;
      }
      toggleDayExpansion(dayKey);
    },
    [handleToggleDayActive, toggleDayExpansion]
  );

  /**
   * SKIFT TIL CUSTOM TID
   * 
   * Når et slot skal redigeres manuelt, tvinges det i custom-mode med
   * fornuftige defaultværdier, så timepicker altid har gyldige tider.
   */
  const handleCustomTimeMode = useCallback(
    (dayKey, slotId) => {
      clearTimeWindowError();
      setDayTimeSelections((prev) => {
        const current = prev[dayKey] ?? createEmptyDaySelection();
        const nextSlots = current.slots.map((slot) => {
          if (slot.id !== slotId) {
            return slot;
          }
          const hasValidStart = isValidTimeValue(slot.start);
          const hasValidEnd = isValidTimeValue(slot.end);
          const nextStart = hasValidStart ? slot.start : DEFAULT_CUSTOM_START;
          const tentativeEnd = hasValidEnd ? slot.end : DEFAULT_CUSTOM_END;
          const nextEnd = isValidTimeRange(nextStart, tentativeEnd)
            ? tentativeEnd
            : DEFAULT_CUSTOM_END;
          return {
            ...slot,
            presetKey: CUSTOM_TIME_PRESET,
            start: nextStart,
            end: nextEnd,
          };
        });
        return {
          ...prev,
          [dayKey]: {
            slots: nextSlots,
          },
        };
      });
    },
    [clearTimeWindowError]
  );

  /**
   * ÅBN TIDSPICKER
   * 
   * Aktiverer custom-mode for et slot, rydder fejl og viser picker for
   * start/slut-feltet, med eksisterende tid som udgangspunkt.
   */
  const openDayTimePicker = useCallback(
    (dayKey, slotId, field) => {
      if (!dayKey || !slotId || !field) {
        return;
      }
      handleCustomTimeMode(dayKey, slotId);
      clearTimeWindowError();
      const slot =
        dayTimeSelections[dayKey]?.slots?.find(
          (item) => item.id === slotId
        ) ?? null;
      setTimePickerState({
        dayKey,
        slotId,
        field,
        visible: true,
        date: buildTimePickerDate(slot?.[field] ?? ''),
      });
    },
    [clearTimeWindowError, dayTimeSelections, handleCustomTimeMode]
  );

  const handleTimePickerChange = useCallback(
    (event, selectedDate) => {
      const { dayKey, slotId, field } = timePickerState;
      if (!dayKey || !slotId || !field) {
        return;
      }

      if (event?.type === 'dismissed' || !selectedDate) {
        if (!isIOS) {
          setTimePickerState((prev) => ({
            ...prev,
            visible: false,
            dayKey: null,
            slotId: null,
            field: null,
          }));
        }
        return;
      }

      clearTimeWindowError();
      const formatted = timeStringFromDate(selectedDate);
      setDayTimeSelections((prev) => {
        const current = prev[dayKey] ?? createEmptyDaySelection();
        const nextSlots = current.slots.map((slot) => {
          if (slot.id !== slotId) {
            return slot;
          }
          return {
            ...slot,
            presetKey: CUSTOM_TIME_PRESET,
            [field]: formatted,
          };
        });
        return {
          ...prev,
          [dayKey]: {
            slots: nextSlots,
          },
        };
      });

      if (isIOS) {
        setTimePickerState((prev) => ({ ...prev, date: selectedDate }));
      } else {
        setTimePickerState({
          dayKey: null,
          slotId: null,
          field: null,
          visible: false,
          date: buildTimePickerDate('17:00'),
        });
      }
    },
    [clearTimeWindowError, timePickerState]
  );

  /**
   * LUK TIDSPICKER
   * 
   * Nulstiller picker-state og skjuler UI'et (bruges på iOS-knap og når
   * dagen deaktiveres).
   */
  const handleCloseTimePicker = useCallback(() => {
    setTimePickerState({
      dayKey: null,
      slotId: null,
      field: null,
      visible: false,
      date: buildTimePickerDate('17:00'),
    });
  }, []);

  /**
   * VÆLG AVATAR
   * 
   * Gemmer valgt emoji i profilstate og rydder fejlen for avatarfeltet.
   */
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
    setFieldErrors((prev) => {
      if (!prev.avatarEmoji) {
        return prev;
      }
      const next = { ...prev };
      delete next.avatarEmoji;
      return next;
    });
  };

  /**
   * KOPIER FAMILIE-ID
   * 
   * Forsøger at kopiere brugerens familie-id og viser kort feedback om
   * handlingen lykkedes.
   */
  const handleCopyFamilyId = async () => {
    if (!profile.familyId) {
      return;
    }
    const copied = await copyStringToClipboard(profile.familyId);
    setCopyFeedback(
      copied
        ? 'Familie ID kopieret.'
        : 'Kunne ikke kopiere. Opdater eller geninstaller din Expo app.'
    );
    setTimeout(() => setCopyFeedback(''), 2500);
  };

  /**
   * VÆLG KØN
   * 
   * Opdaterer køn fra chip-valg og fjerner relateret valideringsfejl.
   */
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

  /**
   * OPDATER ANTAL BØRN
   * 
   * Tillader kun tal (0-10), begrænser længde og rydder feltfejl.
   */
  const handleChildrenCountChange = useCallback((value) => {
    if (typeof value !== 'string') {
      return;
    }
    const digitsOnly = value.replace(/\D/g, '');
    let normalized = digitsOnly.slice(0, 2);
    if (normalized.length) {
      const numericValue = Number(normalized);
      if (Number.isNaN(numericValue)) {
        normalized = '';
      } else if (numericValue > CHILDREN_COUNT_MAX) {
        normalized = String(CHILDREN_COUNT_MAX);
      } else {
        normalized = String(numericValue);
      }
    }
    setProfile((prev) => ({
      ...prev,
      childrenCount: normalized,
    }));
    setFieldErrors((prev) => {
      if (!prev.childrenCount) {
        return prev;
      }
      const next = { ...prev };
      delete next.childrenCount;
      return next;
    });
  }, []);

  /**
   * OPDATER ALDER
   * 
   * Fjerner ikke-cifre, begrænser til 3 tegn og rydder feltfejl.
   */
  const handleAgeChange = useCallback((value) => {
    if (typeof value !== 'string') {
      return;
    }
    const digitsOnly = value.replace(/\D/g, '');
    const limited = digitsOnly.slice(0, 3);
    setProfile((prev) => ({
      ...prev,
      age: limited,
    }));
    setFieldErrors((prev) => {
      if (!prev.age) {
        return prev;
      }
      const next = { ...prev };
      delete next.age;
      return next;
    });
  }, []);

  /**
   * VÆLG BY
   * 
   * Toggler valgt by (tryk igen for at fravælge) og rydder feltfejl.
   */
  const handleSelectCity = useCallback((city) => {
    if (typeof city !== 'string') {
      return;
    }
    setProfile((prev) => ({
      ...prev,
      location: prev.location === city ? '' : city,
    }));
    setFieldErrors((prev) => {
      if (!prev.location) {
        return prev;
      }
      const next = { ...prev };
      delete next.location;
      return next;
    });
  }, []);

  /**
   * VÆLG PRÆFERENCE-TILSTAND
   * 
   * Skifter mellem Custom/Follow/None, håndterer cases uden followable
   * medlemmer og rydder relaterede feltfejl.
   */
  const handleSelectPreferenceMode = useCallback(
    (mode) => {
      const normalizedMode = normalizeFamilyPreferenceMode(mode);
      if (
        normalizedMode === FAMILY_PREFERENCE_MODES.FOLLOW &&
        !canFollowPreference
      ) {
        return;
      }
      setProfile((prev) => {
        if (prev.familyPreferenceMode === normalizedMode) {
          return prev;
        }
        const next = {
          ...prev,
          familyPreferenceMode: normalizedMode,
        };
        if (normalizedMode === FAMILY_PREFERENCE_MODES.FOLLOW) {
          const currentIsValid = followableMembers.some(
            (member) => member.userId === prev.familyPreferenceFollowUserId
          );
          next.familyPreferenceFollowUserId = currentIsValid
            ? prev.familyPreferenceFollowUserId
            : followableMembers[0]?.userId ?? '';
        } else {
          next.familyPreferenceFollowUserId = '';
        }
        return next;
      });
      setFieldErrors((prev) => {
        if (!prev.preferenceMode && normalizedMode === FAMILY_PREFERENCE_MODES.CUSTOM) {
          return prev;
        }
        const next = { ...prev };
        if (next.preferenceMode) {
          delete next.preferenceMode;
        }
        if (normalizedMode !== FAMILY_PREFERENCE_MODES.CUSTOM) {
          if (next.timeWindows) {
            delete next.timeWindows;
          }
        }
        return next;
      });
    },
    [canFollowPreference, followableMembers]
  );

  /**
   * VÆLG HVEM DER FØLGES
   * 
   * Sætter hvilket medlem der følges i FOLLOW-mode og rydder preference-fejl.
   */
  const handleSelectFollowUser = useCallback((memberId) => {
    if (typeof memberId !== 'string' || !memberId.trim().length) {
      return;
    }
    setProfile((prev) => ({
      ...prev,
      familyPreferenceFollowUserId: memberId.trim(),
    }));
    setFieldErrors((prev) => {
      if (!prev.preferenceMode) {
        return prev;
      }
      const next = { ...prev };
      delete next.preferenceMode;
      return next;
    });
  }, []);

  /**
   * OPDATER VARIGHEDS-SLIDER
   * 
   * Gemmer min/max varighed og fjerner varighedsfejlen når brugeren justerer.
   */
  const handleDurationSliderChange = useCallback((minMinutesValue, maxMinutesValue) => {
    setProfile((prev) => ({
      ...prev,
      preferredMinDuration: String(minMinutesValue),
      preferredMaxDuration: String(maxMinutesValue),
    }));
    setFieldErrors((prev) => {
      if (!prev.durationRange) {
        return prev;
      }
      const next = { ...prev };
      delete next.durationRange;
      return next;
    });
  }, []);

  /**
   * VALIDÉR PROFIL
   * 
   * Tjekker alle felter inkl. tidsvinduer/dage. Returnerer true/false og
   * fylder `fieldErrors` med brugervenlige beskeder.
   */
  const validateProfile = () => {
    const nextErrors = {};
    const trimmedName = profile.name.trim();
    if (isCustomPreferenceMode && !hasCustomDaySelected) {
      nextErrors.timeWindows = 'Vælg mindst én dag med tidsrum.';
    }

    const trimmedGender = profile.gender.trim();
    const trimmedAvatar =
      typeof profile.avatarEmoji === 'string' ? profile.avatarEmoji.trim() : '';

    if (!trimmedAvatar.length) {
      nextErrors.avatarEmoji = 'Vælg en emoji.';
    }

    if (!selectedLocation) {
      nextErrors.location = 'Vælg en by.';
    }


    if (!trimmedName) {
      nextErrors.name = 'Navn skal udfyldes.';
    }

    const trimmedAge = profile.age.trim();
    if (!trimmedAge) {
      nextErrors.age = 'Alder skal udfyldes.';
    } else if (!/^\d+$/.test(trimmedAge)) {
      nextErrors.age = 'Alder skal være et tal.';
    } else {
      const numericAge = Number(trimmedAge);
      if (numericAge < MIN_AGE || numericAge > MAX_AGE) {
        nextErrors.age = `Alder skal være mellem ${MIN_AGE} og ${MAX_AGE}.`;
      }
    }

    if (!trimmedGender) {
      nextErrors.gender = 'Køn skal udfyldes.';
    }
    const trimmedChildrenCount =
      typeof profile.childrenCount === 'string'
        ? profile.childrenCount.trim()
        : '';
    if (!trimmedChildrenCount) {
      nextErrors.childrenCount = 'Angiv antal børn.';
    } else if (!/^\d+$/.test(trimmedChildrenCount)) {
      nextErrors.childrenCount = 'Antal børn skal være et tal.';
    } else {
      const numericChildrenCount = Number(trimmedChildrenCount);
      if (
        Number.isNaN(numericChildrenCount) ||
        numericChildrenCount < CHILDREN_COUNT_MIN ||
        numericChildrenCount > CHILDREN_COUNT_MAX
      ) {
        nextErrors.childrenCount = `Antal børn skal være mellem ${CHILDREN_COUNT_MIN} og ${CHILDREN_COUNT_MAX}.`;
      }
    }

    const minDurationRaw =
      typeof profile.preferredMinDuration === 'string'
        ? profile.preferredMinDuration.trim()
        : '';
    const maxDurationRaw =
      typeof profile.preferredMaxDuration === 'string'
        ? profile.preferredMaxDuration.trim()
        : '';
    const minDurationValue = Number(minDurationRaw);
    const maxDurationValue = Number(maxDurationRaw);
    const minDurationValid =
      minDurationRaw.length > 0 && Number.isFinite(minDurationValue) && minDurationValue > 0;
    const maxDurationValid =
      maxDurationRaw.length > 0 && Number.isFinite(maxDurationValue) && maxDurationValue > 0;

    if (!minDurationValid || !maxDurationValid) {
      nextErrors.durationRange = 'Vælg både minimum og maksimum varighed.';
    } else if (maxDurationValue <= minDurationValue) {
      nextErrors.durationRange = 'Maksimum skal være større end minimum.';
    }

    if (isFollowPreferenceMode) {
      const followUserId =
        typeof profile.familyPreferenceFollowUserId === 'string'
          ? profile.familyPreferenceFollowUserId.trim()
          : '';
      if (!followUserId) {
        nextErrors.preferenceMode = 'Vælg hvem du vil følge.';
      }
    }

    if (isCustomPreferenceMode && !nextErrors.timeWindows) {
      outer: for (const day of WEEK_DAYS) {
        const slots = dayTimeSelections[day.key]?.slots ?? [];
        for (let index = 0; index < slots.length; index += 1) {
          const slot = slots[index];
          const startValue =
            typeof slot.start === 'string' ? slot.start.trim() : '';
          const endValue =
            typeof slot.end === 'string' ? slot.end.trim() : '';
          if (!startValue || !endValue) {
            nextErrors.timeWindows = `Angiv både start og slut for ${day.label}${
              slots.length > 1 ? ` (tidsrum ${index + 1})` : ''
            }.`;
            break outer;
          }
          if (!isValidTimeValue(startValue) || !isValidTimeValue(endValue)) {
            nextErrors.timeWindows = `Tidsformatet er ugyldigt for ${day.label}${
              slots.length > 1 ? ` (tidsrum ${index + 1})` : ''
            }.`;
            break outer;
          }
          if (!isValidTimeRange(startValue, endValue)) {
            nextErrors.timeWindows = `Sluttid skal være efter starttid for ${day.label}${
              slots.length > 1 ? ` (tidsrum ${index + 1})` : ''
            }.`;
            break outer;
          }
        }
      }
    }

    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  /**
   * GEM PROFIL
   * 
   * Validerer formularen, normaliserer payload og skriver profil/familie-
   * felter til Firestore. Opdaterer familie-medlemslisten med avatar/navn,
   * håndterer follow-mode, tidsvinduer og navigerer videre efter succes.
   */
  const handleSaveProfile = async () => {
    if (!userId) {
      setGeneralError('Ingen bruger fundet. Prøv at logge ind igen.');
      return;
    }

    const isValidProfile = validateProfile();
    if (!isValidProfile) {
      setFormReminder('Udfyld alle felter med fejl, før du gemmer.');
      return;
    }

    setFormReminder('');

    try {
      setGeneralError('');
      setSavingProfile(true);

        const sanitizedAge = Number(profile.age.trim());
        const sanitizedLocation = selectedLocation;
        const sanitizedEmoji =
          typeof profile.avatarEmoji === 'string' && profile.avatarEmoji.trim().length
            ? profile.avatarEmoji.trim()
            : DEFAULT_AVATAR_EMOJI;
        const trimmedName = profile.name.trim();
        const normalizedName = trimmedName.length ? trimmedName : userEmail;
        const trimmedGender = profile.gender.trim();
        const trimmedChildrenCount =
          typeof profile.childrenCount === 'string'
            ? profile.childrenCount.trim()
            : '';
        const numericChildrenCount =
          /^\d+$/.test(trimmedChildrenCount) && trimmedChildrenCount.length
            ? Number(trimmedChildrenCount)
            : null;
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

        if (
          Number.isFinite(numericChildrenCount) &&
          numericChildrenCount >= CHILDREN_COUNT_MIN &&
          numericChildrenCount <= CHILDREN_COUNT_MAX
        ) {
          payload.childrenCount = numericChildrenCount;
        } else {
          payload.childrenCount = firebase.firestore.FieldValue.delete();
        }

        if (sanitizedLocation) {
          payload.location = sanitizedLocation;
        } else {
          payload.location = firebase.firestore.FieldValue.delete();
        }

        if (Array.isArray(profile.preferredDays)) {
          payload.preferredFamilyDays = profile.preferredDays;
        } else {
          payload.preferredFamilyDays = [];
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

        const timeWindowPayload = buildTimeWindowPayload(dayTimeSelections);
        if (timeWindowPayload) {
          payload.preferredFamilyTimeWindows = timeWindowPayload;
        } else {
          payload.preferredFamilyTimeWindows = firebase.firestore.FieldValue.delete();
        }

        const preferenceMode = normalizeFamilyPreferenceMode(
          profile.familyPreferenceMode
        );
        const followUserIdRaw =
          typeof profile.familyPreferenceFollowUserId === 'string'
            ? profile.familyPreferenceFollowUserId.trim()
            : '';
        payload.familyPreferenceMode = preferenceMode;
        if (
          preferenceMode === FAMILY_PREFERENCE_MODES.FOLLOW &&
          followUserIdRaw.length
        ) {
          payload.familyPreferenceFollowUserId = followUserIdRaw;
        } else {
          payload.familyPreferenceFollowUserId =
            firebase.firestore.FieldValue.delete();
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

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.container}>
          <View style={styles.heroCard}>
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
                ? 'Rediger dine profiloplysninger og familiepræferencer.'
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
                    placeholder="Dit navn"
                    error={fieldErrors.name}
                    style={styles.field}
                  />
                  <FormInput
                    label="Alder"
                    value={profile.age}
                    onChangeText={handleAgeChange}
                    placeholder="Fx 12"
                    keyboardType="number-pad"
                    inputMode="numeric"
                    maxLength={3}
                    error={fieldErrors.age}
                    style={styles.field}
                  />
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
                <View style={styles.locationGroup}>
                  <Text style={styles.preferenceSubtitle}>Lokation</Text>
                  <Text style={styles.locationHint}>Vælg den storby du bor tættest på</Text>
                  <View style={styles.locationChipsWrap}>
                    {DANISH_CITY_OPTIONS.map((city) => {
                      const selected = selectedLocation === city;
                      return (
                        <Pressable
                          key={city}
                          onPress={() => handleSelectCity(city)}
                          style={[
                            styles.locationChip,
                            selected ? styles.locationChipSelected : null,
                          ]}
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                          accessibilityLabel={`Vælg ${city}`}
                        >
                          <Text
                            numberOfLines={1}
                            ellipsizeMode="tail"
                            style={[
                              styles.locationChipText,
                              selected ? styles.locationChipTextSelected : null,
                            ]}
                          >
                            {city}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {fieldErrors.location ? (
                    <Text style={styles.validationMessage}>
                      {fieldErrors.location}
                    </Text>
                  ) : null}
                  {hasLegacyLocation ? (
                    <Text style={styles.validationMessage}>
                      {`Din tidligere lokation "${normalizedLocation}" understøttes ikke længere. Vælg en by fra listen.`}
                    </Text>
                  ) : null}
                </View>

                <View style={styles.sectionDivider} />

                <Text style={styles.preferenceTitle}>Dine præferencer</Text>
                <Text style={styles.preferenceHint}>
                  Vælg om du tilpasser selv eller følger familien
                </Text>
                <View style={styles.preferenceModeWrap}>
                  <View style={styles.preferenceModeRow}>
                    {FAMILY_PREFERENCE_MODE_OPTIONS.slice(0, 2).map((option) => {
                      const selected = normalizedPreferenceMode === option.key;
                      const disabled =
                        option.key === FAMILY_PREFERENCE_MODES.FOLLOW &&
                        !canFollowPreference;
                      return (
                        <Pressable
                          key={option.key}
                          onPress={() => handleSelectPreferenceMode(option.key)}
                          disabled={disabled}
                          style={[
                            styles.preferenceModeChip,
                            selected ? styles.preferenceModeChipSelected : null,
                            disabled ? styles.preferenceModeChipDisabled : null,
                          ]}
                          accessibilityRole="button"
                          accessibilityState={{ selected, disabled }}
                        >
                          <Text
                            numberOfLines={1}
                            ellipsizeMode="tail"
                            style={[
                              styles.preferenceModeChipText,
                              selected ? styles.preferenceModeChipTextSelected : null,
                              disabled ? styles.preferenceModeChipTextDisabled : null,
                            ]}
                          >
                            {option.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {FAMILY_PREFERENCE_MODE_OPTIONS.slice(2).map((option) => {
                    const selected = normalizedPreferenceMode === option.key;
                    const disabled =
                      option.key === FAMILY_PREFERENCE_MODES.FOLLOW &&
                      !canFollowPreference;
                    return (
                      <Pressable
                        key={option.key}
                        onPress={() => handleSelectPreferenceMode(option.key)}
                        disabled={disabled}
                        style={[
                          styles.preferenceModeChip,
                          styles.preferenceModeChipFull,
                          selected ? styles.preferenceModeChipSelected : null,
                          disabled ? styles.preferenceModeChipDisabled : null,
                        ]}
                        accessibilityRole="button"
                        accessibilityState={{ selected, disabled }}
                      >
                        <Text
                          numberOfLines={1}
                          ellipsizeMode="tail"
                          style={[
                            styles.preferenceModeChipText,
                            selected ? styles.preferenceModeChipTextSelected : null,
                            disabled ? styles.preferenceModeChipTextDisabled : null,
                          ]}
                        >
                          {option.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {!canFollowPreference ? (
                  <Text style={styles.preferenceFootnote}>
                    Inviter mindst ét familiemedlem for at kunne følge deres præferencer.
                  </Text>
                ) : null}
                {fieldErrors.preferenceMode ? (
                  <Text style={styles.validationMessage}>
                    {fieldErrors.preferenceMode}
                  </Text>
                ) : null}
                {isFollowPreferenceMode ? (
                  <View style={styles.preferenceInfoCard}>
                    <Text style={styles.preferenceInfoTitle}>
                      Følg et familiemedlem
                    </Text>
                    <Text style={styles.preferenceInfoText}>
                      {selectedFollowMember
                        ? `Dine forslag matcher ${selectedFollowMember.displayName}.`
                        : 'Vælg hvem du vil følge herunder.'}
                    </Text>
                    {followableMembers.length ? (
                      <View style={styles.followList}>
                        {followableMembers.map((member) => {
                          const selected =
                            profile.familyPreferenceFollowUserId === member.userId;
                          return (
                            <Pressable
                              key={member.userId}
                              onPress={() => handleSelectFollowUser(member.userId)}
                              style={[
                                styles.followOption,
                                selected ? styles.followOptionSelected : null,
                              ]}
                              accessibilityRole="button"
                              accessibilityState={{ selected }}
                            >
                              <Text style={styles.followOptionEmoji}>
                                {member.avatarEmoji}
                              </Text>
                              <View style={styles.followOptionBody}>
                                <Text style={styles.followOptionName}>
                                  {member.displayName}
                                </Text>
                                <Text style={styles.followOptionHint}>
                                  Brug deres dage og tidsrum
                                </Text>
                              </View>
                            </Pressable>
                          );
                        })}
                      </View>
                    ) : (
                      <Text style={styles.preferenceFootnote}>
                        Tilføj familiemedlemmer under Konto > Din familie for at kunne følge dem.
                      </Text>
                    )}
                  </View>
                ) : null}
                {isNoPreferenceMode ? (
                  <View style={styles.preferenceInfoCard}>
                    <Text style={styles.preferenceInfoTitle}>Ingen præferencer</Text>
                    <Text style={styles.preferenceInfoText}>
                      FamTime foreslår tidspunkter på baggrund af resten af familien, mens dine egne felter kan stå tomme.
                    </Text>
                  </View>
                ) : null}
                {isCustomPreferenceMode && (
                  <View style={styles.customPreferenceSection}>
                    <Text style={styles.preferenceFootnote}>
                      Tryk på en dag for og vælg de tidsrum der passer dig
                    </Text>
                    <View style={styles.dayTimeList}>
                      {WEEK_DAYS.map((day) => {
                        const daySelection = dayTimeSelections[day.key] ?? createEmptyDaySelection();
                        const slots = sortSlotsByPreset(daySelection.slots ?? []);
                        const hasSlots = slots.length > 0;
                        const summary = getDaySelectionSummary(day.key);
                        const isExpanded = expandedDayKey === day.key;

                        return (
                          <View key={day.key} style={styles.dayAccordion}>
                            <View
                              style={[
                                styles.dayAccordionHeader,
                                isExpanded ? styles.dayAccordionHeaderExpanded : null,
                              ]}
                            >
                              <Pressable
                                onPress={() => handleDayHeaderPress(day.key, hasSlots)}
                                accessibilityRole="button"
                                accessibilityState={{ expanded: isExpanded }}
                                style={styles.dayAccordionHeaderMain}
                              >
                                <View style={styles.dayTimeHeaderTextWrap}>
                                  <Text style={styles.dayTimeLabel}>{day.label}</Text>
                                  <Text style={styles.dayTimeSummary}>{summary}</Text>
                                </View>
                              </Pressable>
                              <Switch
                                value={hasSlots}
                                onValueChange={(value) =>
                                  handleToggleDayActive(day.key, value)
                                }
                                style={styles.dayAccordionSwitch}
                                trackColor={{
                                  false: 'rgba(0, 0, 0, 0.1)',
                                  true: 'rgba(230, 138, 46, 0.25)',
                                }}
                                thumbColor={
                                  hasSlots ? colors.primary : colors.surface
                                }
                                ios_backgroundColor={colors.border}
                              />
                            </View>
                            {isExpanded ? (
                              <View style={styles.dayAccordionBody}>
                                <View style={styles.dayAccordionBodyHeader}>
                                  <Text style={styles.dayToggleHint}>
                                    Vælg et eller flere
                                  </Text>
                                </View>
                                <View style={styles.timePresetWrap}>
                                  {QUICK_TIME_PRESETS.map((preset) => {
                                    const presetSelected = slots.some(
                                      (slot) => slot.originalPresetKey === preset.key
                                    );
                                    return (
                                      <Pressable
                                        key={`${day.key}-${preset.key}`}
                                        onPress={() =>
                                          handleTogglePresetSlot(day.key, preset.key)
                                        }
                                        style={[
                                          styles.timePresetChip,
                                          presetSelected ? styles.timePresetChipSelected : null,
                                        ]}
                                        accessibilityRole="switch"
                                        accessibilityState={{ checked: presetSelected }}
                                      >
                                        <View style={styles.timePresetChipInner}>
                                          <View style={styles.timePresetChipHeader}>
                                            <Text
                                              style={[
                                                styles.timePresetLabel,
                                                presetSelected
                                                  ? styles.timePresetLabelSelected
                                                  : null,
                                              ]}
                                            >
                                              {preset.label}
                                            </Text>
                                                                                      </View>
                                          <Text
                                            style={[
                                              styles.timePresetRange,
                                              presetSelected
                                                ? styles.timePresetRangeSelected
                                                : null,
                                            ]}
                                          >
                                            {preset.display}
                                          </Text>
                                        </View>
                                      </Pressable>
                                    );
                                  })}
                                </View>
                                {hasSlots ? (
                                  slots.map((slot, index) => (
                                    <View key={slot.id} style={styles.timeSlotCard}>
                                      <View style={styles.timeSlotHeader}>
                                        <Text style={styles.timeSlotLabel}>
                                          {slot.originalPresetKey &&
                                          PRESET_LABEL_MAP[slot.originalPresetKey]
                                            ? PRESET_LABEL_MAP[slot.originalPresetKey]
                                            : `Tidsrum ${index + 1}`}
                                        </Text>
                                        <Pressable
                                          onPress={() => handleRemoveTimeSlot(day.key, slot.id)}
                                        >
                                          <Text style={styles.timeSlotRemove}>Fjern</Text>
                                        </Pressable>
                                      </View>
                                      <View style={styles.timeSelectionRow}>
                                        <Pressable
                                          style={styles.timeSelectionButton}
                                          onPress={() =>
                                            openDayTimePicker(day.key, slot.id, 'start')
                                          }
                                        >
                                          <Text style={styles.timeSelectionLabel}>Start</Text>
                                          <Text style={styles.timeSelectionValue}>
                                            {formatTimeSelectionDisplay(slot.start)}
                                          </Text>
                                        </Pressable>
                                        <Pressable
                                          style={[
                                            styles.timeSelectionButton,
                                            styles.timeSelectionButtonRight,
                                          ]}
                                          onPress={() =>
                                            openDayTimePicker(day.key, slot.id, 'end')
                                          }
                                        >
                                          <Text style={styles.timeSelectionLabel}>Slut</Text>
                                          <Text style={styles.timeSelectionValue}>
                                            {formatTimeSelectionDisplay(slot.end)}
                                          </Text>
                                        </Pressable>
                                      </View>
                                      {timePickerState.visible &&
                                      timePickerState.dayKey === day.key &&
                                      timePickerState.slotId === slot.id ? (
                                        <View style={styles.inlineTimePicker}>
                                          <DateTimePicker
                                            value={timePickerState.date}
                                            mode="time"
                                            display={isIOS ? 'spinner' : 'default'}
                                            onChange={handleTimePickerChange}
                                          />
                                          {isIOS ? (
                                            <Pressable
                                              onPress={handleCloseTimePicker}
                                              style={styles.timePickerCloseButton}
                                            >
                                              <Text style={styles.timePickerCloseText}>
                                                Færdig
                                              </Text>
                                            </Pressable>
                                          ) : null}
                                        </View>
                                      ) : null}
                                    </View>
                                  ))
                                ) : (
                                  <Text style={styles.dayEmptyHint}>
                                    Ingen tidsrum for {day.label.toLocaleLowerCase('da-DK')} endnu. Vælg et interval ovenfor for at komme i gang.
                                  </Text>
                                )}
                              </View>
                            ) : null}
                          </View>
                        );
                      })}
                    </View>
                    {fieldErrors.timeWindows ? (
                      <Text style={styles.validationMessage}>
                        {fieldErrors.timeWindows}
                      </Text>
                    ) : null}
                    <View style={styles.durationHeader}>
                      <Text style={styles.durationTitle}>Bestem længde på familietid</Text>
                    </View>
                    <View style={styles.durationSliderBlock}>
                      <DurationRangeSlider
                        minValue={durationSliderMin}
                        maxValue={durationSliderMax}
                        onChange={handleDurationSliderChange}
                      />
                    </View>
                    <FormInput
                      label="Hvor mange børn har du?"
                      value={profile.childrenCount}
                      onChangeText={handleChildrenCountChange}
                      placeholder="0-10"
                      keyboardType="number-pad"
                      inputMode="numeric"
                      maxLength={2}
                      error={fieldErrors.childrenCount}
                      style={styles.field}
                    />

                  </View>
                )}
                {formReminder ? (
                  <Text style={styles.validationMessage}>{formReminder}</Text>
                ) : null}
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
                Få hurtig adgang til delte oplysninger og del familie ID med andre.
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

        </View>
      </ScrollView>
    </SafeAreaView>
  );
};



export default LandingScreen;
