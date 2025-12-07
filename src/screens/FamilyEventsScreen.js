/**
 * FamilyEventsScreen
 *
 * - Viser familiens kommende begivenheder opdelt i godkendte og afventende.
 * - Administratorer kan godkende afventende begivenheder direkte fra listen.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Modal,
  Pressable,
  TextInput,
  Alert,
  Platform,
  KeyboardAvoidingView,
  AppState,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import * as Calendar from 'expo-calendar';

import Button from '../components/Button';
import ErrorMessage from '../components/ErrorMessage';
import AISuggestion, {
  MOOD_OPTIONS,
  generateProfileSuggestion,
} from '../components/AISuggestion';
import { auth, db, firebase } from '../lib/firebase';
import findMutualAvailability, { availabilityUtils } from '../lib/availability';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import styles from '../styles/screens/FamilyEventsScreenStyles';
import {
  FAMILY_PREFERENCE_MODES,
  normalizeFamilyPreferenceMode,
} from '../constants/familyPreferenceModes';

const DEFAULT_EVENT_DURATION_MINUTES = 60;
const MIN_EVENT_DURATION_MINUTES = 15;
const SUGGESTION_LIMIT = 6;
const AVAILABILITY_LOOKAHEAD_DAYS = 21;
const DEVICE_BUSY_POLL_INTERVAL_MS = 10 * 1000;
const CALENDAR_DEVICE_LOOKAHEAD_DAYS = 21;
const PRIVATE_EVENT_TRAVEL_BUFFER_MINUTES = 30;
const isIOS = Platform.OS === 'ios';

const isSameDay = (a, b) => {
  if (!(a instanceof Date) || !(b instanceof Date)) {
    return false;
  }

  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
};

const formatDateBadge = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return 'Ukendt dato';
  }

  return date
    .toLocaleDateString('da-DK', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    })
    .replace('.', '');
};

const formatTimeRange = (start, end) => {
  if (!(start instanceof Date) || Number.isNaN(start.getTime())) {
    return 'Ukendt tidspunkt';
  }

  const startLabel = start.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  if (!(end instanceof Date) || Number.isNaN(end.getTime())) {
    return startLabel;
  }

  const endLabel = end.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  if (isSameDay(start, end)) {
    return `${startLabel} - ${endLabel}`;
  }

  const endDateLabel = end.toLocaleDateString('da-DK', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

  return `${startLabel} -> ${endDateLabel.replace('.', '')} ${endLabel}`;
};

const mergeBusyIntervals = (primary = [], secondary = []) => {
  const source = [
    ...(Array.isArray(primary) ? primary : []),
    ...(Array.isArray(secondary) ? secondary : []),
  ]
    .map((interval) => {
      const start = availabilityUtils.toDate(interval?.start);
      const end = availabilityUtils.toDate(interval?.end);
      if (!start || !end || end <= start) {
        return null;
      }
      return {
        start: new Date(start.getTime()),
        end: new Date(end.getTime()),
      };
    })
    .filter((interval) => Boolean(interval))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  if (!source.length) {
    return [];
  }

  const merged = [source[0]];
  for (let i = 1; i < source.length; i += 1) {
    const current = source[i];
    const last = merged[merged.length - 1];
    if (current.start <= last.end) {
      if (current.end > last.end) {
        last.end = current.end;
      }
    } else {
      merged.push({ start: current.start, end: current.end });
    }
  }

  return merged;
};

const applyIntervalTravelBuffer = (intervals = [], bufferMinutes = 0) => {
  const normalized = Array.isArray(intervals) ? intervals : [];
  const bufferMs = Math.max(0, Math.floor(bufferMinutes ?? 0)) * 60 * 1000;

  return normalized.map((interval) => ({
    start: new Date(interval.start.getTime() - bufferMs),
    end: new Date(interval.end.getTime() + bufferMs),
  }));
};

const buildEventBusyIntervals = (events = []) => {
  if (!Array.isArray(events)) {
    return [];
  }

  const intervals = [];
  const appendInterval = (startValue, endValue) => {
    const start = availabilityUtils.toDate(startValue);
    const end = availabilityUtils.toDate(endValue);
    if (!start || !end || end <= start) {
      return;
    }
    intervals.push({
      start: new Date(start.getTime()),
      end: new Date(end.getTime()),
    });
  };

  events.forEach((event) => {
    appendInterval(event?.start, event?.end);
    if (event?.pendingChange) {
      appendInterval(event.pendingChange.start, event.pendingChange.end);
    }
  });

  return intervals;
};

const normalizeBusyPayload = (input) => {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((item) => {
      const start = availabilityUtils.toDate(item?.start ?? item?.from ?? item?.begin);
      const end = availabilityUtils.toDate(item?.end ?? item?.to ?? item?.finish);
      if (!start || !end || end <= start) {
        return null;
      }
      return {
        start: new Date(start.getTime()),
        end: new Date(end.getTime()),
      };
    })
    .filter((interval) => Boolean(interval));
};

const isFirestoreFieldValue = (value) =>
  Boolean(
    value &&
      typeof value === 'object' &&
      typeof value.isEqual === 'function' &&
      typeof value._methodName === 'string'
  );

const safeReadPreferenceField = (target, key) => {
  if (!target || (typeof target !== 'object' && typeof target !== 'function')) {
    return undefined;
  }

  try {
    const value = target[key];
    if (isFirestoreFieldValue(value)) {
      return undefined;
    }
    return value;
  } catch (_error) {
    return undefined;
  }
};

const extractPreferencesFromCalendarDoc = (data) => {
  if (!data || typeof data !== 'object') {
    return {};
  }

  const sources = [data.preferences, data.sharedPreferences, data.constraints];

  const resolvePreference = (key) => {
    for (const source of sources) {
      const value = safeReadPreferenceField(source, key);
      if (value !== undefined) {
        return value;
      }
    }
    return safeReadPreferenceField(data, key);
  };

  const preferenceKeys = [
    'allowedWeekdays',
    'timeWindows',
    'minDurationMinutes',
    'maxDurationMinutes',
    'bufferBeforeMinutes',
    'bufferAfterMinutes',
    'timeZone',
    'maxSuggestionDaysPerWeek',
    'preferredDurationMinutes',
    'slotStepMinutes',
  ];

  const preferences = {};
  preferenceKeys.forEach((key) => {
    const value = resolvePreference(key);
    if (value !== undefined) {
      preferences[key] = value;
    }
  });

  return preferences;
};

const areBusyListsEqual = (first = [], second = []) => {
  if (!Array.isArray(first) || !Array.isArray(second)) {
    return false;
  }
  if (first.length !== second.length) {
    return false;
  }

  for (let i = 0; i < first.length; i += 1) {
    const a = first[i];
    const b = second[i];
    if (!a || !b) {
      return false;
    }
    if (a.start.getTime() !== b.start.getTime() || a.end.getTime() !== b.end.getTime()) {
      return false;
    }
  }

  return true;
};

const shallowEqualObjects = (a = {}, b = {}) => {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  for (let i = 0; i < aKeys.length; i += 1) {
    const key = aKeys[i];
    if (!Object.is(a[key], b[key])) {
      return false;
    }
  }
  return true;
};

const getDurationLabel = (start, end) => {
  if (!(start instanceof Date) || !(end instanceof Date)) {
    return '';
  }

  const diffMinutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  if (!diffMinutes) {
    return '';
  }

  if (diffMinutes % 60 === 0) {
    const hours = diffMinutes / 60;
    return hours === 1 ? '1 time' : `${hours} timer`;
  }

  if (diffMinutes > 90) {
    const hours = diffMinutes / 60;
    return `${hours.toFixed(1)} timer`;
  }

  return `${diffMinutes} min`;
};

const createDefaultEventState = () => {
  // Initialiserer formularfelter med et start- og sluttidspunkt i nær fremtid.
  const start = new Date();
  start.setSeconds(0, 0);
  const end = new Date(start.getTime() + DEFAULT_EVENT_DURATION_MINUTES * 60000);

  return {
    title: '',
    description: '',
    start,
    end,
  };
};

const formatDateTime = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return 'Ukendt tidspunkt';
  }

  return `${date.toLocaleDateString()} kl. ${date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
};

const FamilyEventsScreen = () => {
  // Samler alt state omkring familiens events, forslag og kalenderintegration.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [familyId, setFamilyId] = useState(null);
  const [familyName, setFamilyName] = useState('');
  const [confirmedEvents, setConfirmedEvents] = useState([]);
  const [pendingEvents, setPendingEvents] = useState([]);
  const [actionStatus, setActionStatus] = useState('');
  const [formVisible, setFormVisible] = useState(false);
  const [formData, setFormData] = useState(createDefaultEventState);
  const [formError, setFormError] = useState('');
  const [formSaving, setFormSaving] = useState(false);
  const [showStartPicker, setShowStartPicker] = useState(isIOS);
  const [showEndPicker, setShowEndPicker] = useState(isIOS);
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionNotice, setSuggestionNotice] = useState('');
  const [selectedSuggestionId, setSelectedSuggestionId] = useState(null);
  const [activeSlotId, setActiveSlotId] = useState(null);
  const [builderVisible, setBuilderVisible] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setBuilderVisible(false);
    }, [])
  );
  const [calendarContext, setCalendarContext] = useState({
    ready: false,
    docRef: null,
    primaryCalendarId: null,
    calendarIds: [],
  });
  const [familyMembers, setFamilyMembers] = useState([]);
  const [familyPreferences, setFamilyPreferences] = useState({});
  const [calendarAvailability, setCalendarAvailability] = useState({});
  const [eventsLoaded, setEventsLoaded] = useState(false);
  const familyCalendarRefsRef = useRef({});
  const familySyncLockRef = useRef(false);
  const currentUserId = auth.currentUser?.uid ?? null;
  const currentUserEmail = auth.currentUser?.email?.toLowerCase() ?? '';
  const [currentUserProfile, setCurrentUserProfile] = useState(null);
  const [activeMoodKey, setActiveMoodKey] = useState(null);
  const [moodDraftTitle, setMoodDraftTitle] = useState('');
  const [moodDraftDescription, setMoodDraftDescription] = useState('');
  const [moodPreview, setMoodPreview] = useState(null);
  const [deviceBusyRefreshToken, setDeviceBusyRefreshToken] = useState(0);
  const deviceBusyLoadedRef = useRef('');
  const requestDeviceBusyRefresh = useCallback(() => {
    setDeviceBusyRefreshToken((token) => token + 1);
  }, []);
  const appStateRef = useRef(AppState.currentState);
  const shouldShowStatusCard =
    Boolean(error) || Boolean(actionStatus) || Boolean(infoMessage) || loading;

  const sortedSuggestions = useMemo(() => {
    if (!Array.isArray(suggestions) || !suggestions.length) {
      return [];
    }

    const toTime = (date) => {
      if (date instanceof Date && !Number.isNaN(date.getTime())) {
        return date.getTime();
      }
      return Number.MAX_SAFE_INTEGER;
    };

    return [...suggestions].sort(
      (a, b) => toTime(a?.start) - toTime(b?.start)
    );
  }, [suggestions]);

  useEffect(() => {
    // Når forslagene ændrer sig, vælger vi automatisk et aktivt tidsrum.
    if (!sortedSuggestions.length) {
      setActiveSlotId(null);
      return;
    }

    setActiveSlotId((prev) => {
      if (prev && sortedSuggestions.some((item) => item.id === prev)) {
        return prev;
      }
      return sortedSuggestions[0].id;
    });
  }, [sortedSuggestions]);

  const activeSuggestion = useMemo(() => {
    // Finder den suggestion der skal præsenteres i panelet.
    if (!sortedSuggestions.length) {
      return null;
    }

    if (activeSlotId) {
      return sortedSuggestions.find((item) => item.id === activeSlotId) ?? sortedSuggestions[0];
    }

    return sortedSuggestions[0];
  }, [sortedSuggestions, activeSlotId]);

  const activeDurationLabel = useMemo(() => {
    if (!activeSuggestion) {
      return '';
    }
    return getDurationLabel(activeSuggestion.start, activeSuggestion.end);
  }, [activeSuggestion]);

  const activeTimeText = useMemo(() => {
    if (!activeSuggestion) {
      return '';
    }
    return formatTimeRange(activeSuggestion.start, activeSuggestion.end);
  }, [activeSuggestion]);

  const suggestionMetaText = useMemo(() => {
    if (!sortedSuggestions.length) {
      return '';
    }
    if (!activeSuggestion) {
      return 'Vælg en dato for at se detaljer.';
    }
    const index = sortedSuggestions.findIndex((item) => item.id === activeSuggestion.id);
    return `Forslag ${index + 1} af ${sortedSuggestions.length}`;
  }, [sortedSuggestions, activeSuggestion]);

  const handleRevealBuilder = useCallback(() => {
    setBuilderVisible(true);
  }, []);

  useEffect(() => {
    const handleAppStateChange = (nextState) => {
      if (appStateRef.current !== 'active' && nextState === 'active') {
        requestDeviceBusyRefresh();
      }
      appStateRef.current = nextState;
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      if (subscription && typeof subscription.remove === 'function') {
        subscription.remove();
      } else {
        AppState.removeEventListener('change', handleAppStateChange);
      }
    };
  }, [requestDeviceBusyRefresh]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      requestDeviceBusyRefresh();
    }, DEVICE_BUSY_POLL_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [requestDeviceBusyRefresh]);

  const moodCards = useMemo(() => {
    const baseCards = MOOD_OPTIONS.map((option) => {
      const summary =
        currentUserProfile && Object.keys(currentUserProfile).length
          ? generateProfileSuggestion(currentUserProfile, option.key)
          : option.helper;

      return {
        ...option,
        summary,
      };
    });

    return [
      ...baseCards,
      {
        key: 'custom',
        label: 'Vælg selv',
        helper: 'Tilpas titel og beskrivelse selv.',
        description: 'Start fra bunden og skriv jeres egen ide.',
        summary: '',
      },
    ];
  }, [currentUserProfile]);

  const ensureValidEnd = (start, end) => {
    if (!end || end <= start) {
      return new Date(start.getTime() + MIN_EVENT_DURATION_MINUTES * 60000);
    }
    return end;
  };

  const resetFormState = (overrides = {}) => {
    const defaults = createDefaultEventState();
    setFormData({ ...defaults, ...overrides });
    setFormError('');
    setFormSaving(false);
    setShowStartPicker(isIOS);
    setShowEndPicker(isIOS);
    setSelectedSuggestionId(null);
  };

  useEffect(() => {
    let isActive = true;

    const fetchPreferences = async () => {
      const memberIds = familyMembers
        .map((member) => member?.userId)
        .filter((id) => typeof id === 'string' && id.trim().length > 0);

      if (!memberIds.length) {
        if (isActive) {
          setFamilyPreferences({});
        }
        return;
      }

      try {
        const snapshots = await Promise.all(
          memberIds.map((id) =>
            db
              .collection('users')
              .doc(id)
              .get()
              .catch(() => null)
          )
        );

        const rawPreferenceMap = {};
        snapshots.forEach((docSnapshot, index) => {
          if (!docSnapshot || !docSnapshot.exists) {
            return;
          }
          const memberId = memberIds[index];
          const data = docSnapshot.data() ?? {};
          const timeWindows =
            data?.preferredFamilyTimeWindows && typeof data.preferredFamilyTimeWindows === 'object'
              ? data.preferredFamilyTimeWindows
              : null;
          const minDurationMinutes =
            typeof data?.preferredFamilyMinDurationMinutes === 'number'
              ? data.preferredFamilyMinDurationMinutes
              : null;
          const maxDurationMinutes =
            typeof data?.preferredFamilyMaxDurationMinutes === 'number'
              ? data.preferredFamilyMaxDurationMinutes
              : null;
          const preferredDurationMinutes =
            typeof data?.preferredFamilyPreferredDurationMinutes === 'number'
              ? data.preferredFamilyPreferredDurationMinutes
              : null;
          const slotStepMinutes =
            typeof data?.preferredFamilySlotStepMinutes === 'number'
              ? data.preferredFamilySlotStepMinutes
              : null;
          const maxSuggestionDaysPerWeek =
            typeof data?.preferredFamilyMaxSuggestionDaysPerWeek === 'number'
              ? data.preferredFamilyMaxSuggestionDaysPerWeek
              : null;
          const bufferBeforeMinutes =
            typeof data?.preferredFamilyBufferBeforeMinutes === 'number'
              ? data.preferredFamilyBufferBeforeMinutes
              : null;
          const bufferAfterMinutes =
            typeof data?.preferredFamilyBufferAfterMinutes === 'number'
              ? data.preferredFamilyBufferAfterMinutes
              : null;
          const timeZone =
            typeof data?.preferredFamilyTimeZone === 'string' && data.preferredFamilyTimeZone.trim().length
              ? data.preferredFamilyTimeZone.trim()
              : null;
          rawPreferenceMap[memberId] = {
            mode: normalizeFamilyPreferenceMode(data.familyPreferenceMode),
            followUserId:
              typeof data?.familyPreferenceFollowUserId === 'string'
                ? data.familyPreferenceFollowUserId.trim()
                : '',
            own: {
              days: Array.isArray(data.preferredFamilyDays)
                ? data.preferredFamilyDays
                : [],
              timeWindows,
              minDurationMinutes,
              maxDurationMinutes,
              preferredDurationMinutes,
              slotStepMinutes,
              maxSuggestionDaysPerWeek,
              bufferBeforeMinutes,
              bufferAfterMinutes,
              timeZone,
            },
          };
        });

        const createEmptyPreferences = () => ({
          days: [],
          timeWindows: null,
          minDurationMinutes: null,
          maxDurationMinutes: null,
          preferredDurationMinutes: null,
          slotStepMinutes: null,
          maxSuggestionDaysPerWeek: null,
          bufferBeforeMinutes: null,
          bufferAfterMinutes: null,
          timeZone: null,
        });

        const resolvedPreferences = {};
        const resolvePreferenceEntry = (memberId, chain = new Set()) => {
          if (resolvedPreferences[memberId]) {
            return resolvedPreferences[memberId];
          }
          const entry = rawPreferenceMap[memberId];
          if (!entry) {
            const empty = createEmptyPreferences();
            resolvedPreferences[memberId] = empty;
            return empty;
          }
          if (entry.mode === FAMILY_PREFERENCE_MODES.NONE) {
            const empty = createEmptyPreferences();
            resolvedPreferences[memberId] = empty;
            return empty;
          }
          if (entry.mode === FAMILY_PREFERENCE_MODES.FOLLOW) {
            const targetId = entry.followUserId;
            if (
              targetId &&
              targetId !== memberId &&
              rawPreferenceMap[targetId] &&
              !chain.has(targetId)
            ) {
              chain.add(memberId);
              const resolvedTarget = resolvePreferenceEntry(targetId, chain);
              chain.delete(memberId);
              const clone = {
                ...resolvedTarget,
                days: Array.isArray(resolvedTarget?.days)
                  ? [...resolvedTarget.days]
                  : [],
              };
              resolvedPreferences[memberId] = clone;
              return clone;
            }
            const empty = createEmptyPreferences();
            resolvedPreferences[memberId] = empty;
            return empty;
          }
          const normalized = {
            ...createEmptyPreferences(),
            ...entry.own,
            days: Array.isArray(entry.own?.days) ? entry.own.days : [],
          };
          resolvedPreferences[memberId] = normalized;
          return normalized;
        };

        memberIds.forEach((memberId) => {
          resolvePreferenceEntry(memberId);
        });

        if (isActive) {
          setFamilyPreferences(resolvedPreferences);
        }
      } catch (_error) {
        if (isActive) {
          setFamilyPreferences({});
        }
      }
    };

    fetchPreferences();

    return () => {
      isActive = false;
    };
  }, [familyMembers]);

  useEffect(() => {
    const memberIds = Array.isArray(familyMembers)
      ? familyMembers
          .map((member) => member?.userId)
          .filter((id) => typeof id === 'string' && id.trim().length > 0)
      : [];

    const uniqueIds = new Set(memberIds);
    if (currentUserId) {
      uniqueIds.add(currentUserId);
    }

    if (!uniqueIds.size) {
      setCalendarAvailability({});
      return () => {};
    }

    const activeIds = Array.from(uniqueIds);
    let isMounted = true;
    const unsubscribes = [];

    setCalendarAvailability((prev) => {
      const next = {};
      activeIds.forEach((id) => {
        if (prev[id]) {
          next[id] = prev[id];
        } else {
          next[id] = { busy: { shared: [], device: [] }, preferences: {} };
        }
      });
      return next;
    });

    activeIds.forEach((userId) => {
      const unsubscribe = db
        .collection('calendar')
        .doc(userId)
        .onSnapshot(
          (snapshot) => {
            if (!isMounted) {
              return;
            }

            const data = snapshot.exists ? snapshot.data() ?? {} : {};
            const sharedBusy = [data.sharedBusy, data.busyIntervals, data.busy]
              .filter((payload) => Array.isArray(payload))
              .reduce((acc, payload) => mergeBusyIntervals(acc, normalizeBusyPayload(payload)), []);
            const preferences = extractPreferencesFromCalendarDoc(data);

            setCalendarAvailability((prev) => {
              const prevEntry = prev[userId] ?? { busy: { shared: [], device: [] }, preferences: {} };
              const nextBusyShared = sharedBusy.length
                ? sharedBusy
                : [];
              const isBusySame = areBusyListsEqual(prevEntry.busy?.shared ?? [], nextBusyShared);
              const nextPreferences = Object.keys(preferences).length
                ? { ...prevEntry.preferences, ...preferences }
                : prevEntry.preferences;
              const preferencesChanged = !shallowEqualObjects(prevEntry.preferences ?? {}, nextPreferences ?? {});

              if (isBusySame && !preferencesChanged) {
                return prev;
              }

              const nextEntry = {
                busy: {
                  shared: nextBusyShared,
                  device: prevEntry.busy?.device ?? [],
                },
                preferences: nextPreferences,
              };
              return {
                ...prev,
                [userId]: nextEntry,
              };
            });
          },
          (error) => {
            console.warn('[FamilyEvents] calendar availability snapshot', error);
          }
        );

      unsubscribes.push(unsubscribe);
    });

    return () => {
      isMounted = false;
      unsubscribes.forEach((unsubscribe) => {
        if (typeof unsubscribe === 'function') {
          unsubscribe();
        }
      });
    };
  }, [familyMembers, currentUserId]);

  useEffect(() => {
    if (
      !currentUserId ||
      !calendarContext.ready ||
      !Array.isArray(calendarContext.calendarIds) ||
      !calendarContext.calendarIds.length
    ) {
      return undefined;
    }

    const idsKey = calendarContext.calendarIds.slice().sort().join('|');
    const loadKey = `${currentUserId}:${idsKey}:${deviceBusyRefreshToken}`;

    if (deviceBusyLoadedRef.current === loadKey) {
      return undefined;
    }

    let cancelled = false;

    const loadDeviceBusy = async () => {
      try {
        const permissions = await Calendar.getCalendarPermissionsAsync();
        if (permissions.status !== 'granted') {
          return;
        }

        const now = new Date();
        now.setSeconds(0, 0);
        const start = new Date(now.getTime());
        const end = new Date(
          start.getTime() + CALENDAR_DEVICE_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000
        );

        const events = await Calendar.getEventsAsync(calendarContext.calendarIds, start, end);
        if (cancelled) {
          return;
        }

        const deviceBusy = Array.isArray(events)
          ? events
              .map((event) => {
                const startDate = availabilityUtils.toDate(
                  event.startDate ?? event.start ?? event.startTime ?? null
                );
                const endDate = availabilityUtils.toDate(
                  event.endDate ?? event.end ?? event.endTime ?? null
                );
                if (!startDate || !endDate || endDate <= startDate) {
                  return null;
                }
                return {
                  start: new Date(startDate.getTime()),
                  end: new Date(endDate.getTime()),
                };
              })
              .filter((interval) => Boolean(interval))
          : [];

        const bufferedDeviceBusy = applyIntervalTravelBuffer(
          deviceBusy,
          PRIVATE_EVENT_TRAVEL_BUFFER_MINUTES
        );

        setCalendarAvailability((prev) => {
          const prevEntry = prev[currentUserId] ?? { busy: { shared: [], device: [] }, preferences: {} };
          const mergedDeviceBusy = mergeBusyIntervals(bufferedDeviceBusy, []);
          const deviceChanged = !areBusyListsEqual(prevEntry.busy?.device ?? [], mergedDeviceBusy);

          if (!deviceChanged) {
            return prev;
          }

          return {
            ...prev,
            [currentUserId]: {
              busy: {
                shared: prevEntry.busy?.shared ?? [],
                device: mergedDeviceBusy,
              },
              preferences: prevEntry.preferences ?? {},
            },
          };
        });
        deviceBusyLoadedRef.current = loadKey;
      } catch (error) {
        console.warn('[FamilyEvents] loadDeviceCalendarBusy', error);
      }
    };

    loadDeviceBusy();

    return () => {
      cancelled = true;
    };
  }, [calendarContext.ready, calendarContext.calendarIds, currentUserId, deviceBusyRefreshToken]);

  const calendarEntries = useMemo(() => {
    const memberIds = Array.isArray(familyMembers)
      ? familyMembers
          .map((member) => member?.userId)
          .filter((id) => typeof id === 'string' && id.trim().length > 0)
      : [];

    const uniqueIds = new Set(memberIds);
    if (currentUserId) {
      uniqueIds.add(currentUserId);
    }

    return Array.from(uniqueIds).map((userId) => {
      const entry = calendarAvailability[userId] ?? { busy: { shared: [], device: [] }, preferences: {} };
      const sharedBusy = entry.busy?.shared ?? [];
      const deviceBusy = entry.busy?.device ?? [];
      const busy = mergeBusyIntervals(sharedBusy, deviceBusy);

      return {
        userId,
        busy,
        preferences: entry.preferences ?? {},
      };
    });
  }, [familyMembers, currentUserId, calendarAvailability]);

  const availabilityUserPreferences = useMemo(() => {
    if (!familyPreferences || typeof familyPreferences !== 'object') {
      return {};
    }

    const normalized = {};
    Object.entries(familyPreferences).forEach(([userId, prefs]) => {
      if (!prefs || typeof prefs !== 'object') {
        return;
      }

      const entry = {};
      if (Array.isArray(prefs.days) && prefs.days.length) {
        entry.allowedWeekdays = prefs.days;
      }
      if (prefs.timeWindows) {
        entry.timeWindows = prefs.timeWindows;
      }

      const numericFields = [
        'minDurationMinutes',
        'maxDurationMinutes',
        'preferredDurationMinutes',
        'slotStepMinutes',
        'maxSuggestionDaysPerWeek',
        'bufferBeforeMinutes',
        'bufferAfterMinutes',
      ];

      numericFields.forEach((key) => {
        const value = prefs[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
          entry[key] = value;
        }
      });

      if (typeof prefs.timeZone === 'string' && prefs.timeZone.trim().length) {
        entry.timeZone = prefs.timeZone.trim();
      }

      if (Object.keys(entry).length) {
        normalized[userId] = entry;
      }
    });

    return normalized;
  }, [familyPreferences]);

  const globalBusyIntervals = useMemo(() => {
    const confirmedBusy = buildEventBusyIntervals(confirmedEvents);
    const pendingBusy = buildEventBusyIntervals(pendingEvents);
    return mergeBusyIntervals([...confirmedBusy, ...pendingBusy], []);
  }, [confirmedEvents, pendingEvents]);

  const handleOpenCreateForm = (suggestion = null, overrides = {}) => {
  if (!familyId) {
    Alert.alert(
      'Ingen familie',
      'Du skal vaere tilknyttet en familie for at oprette begivenheder.'
    );
    return;
  }

  const suggestionOverrides = suggestion
    ? {
        start:
          suggestion.start instanceof Date
            ? new Date(suggestion.start)
            : suggestion.start,
        end:
          suggestion.end instanceof Date
            ? new Date(suggestion.end)
            : suggestion.end,
      }
    : {};

  resetFormState({ ...suggestionOverrides, ...overrides });
  if (suggestion) {
    setSelectedSuggestionId(suggestion.id);
    setActiveSlotId(suggestion.id);
  }
  setFormVisible(true);
};

  const handleCloseForm = () => {
    setFormVisible(false);
    resetFormState();
  };

  const handleChangeFormField = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleStartDateChange = (_event, selectedDate) => {
    if (selectedDate) {
      const rounded = new Date(selectedDate);
      rounded.setSeconds(0, 0);
      setFormData((prev) => ({
        ...prev,
        start: rounded,
        end: ensureValidEnd(rounded, prev.end),
      }));
      setSelectedSuggestionId(null);
    }

    if (!isIOS) {
      setShowStartPicker(false);
    }
  };

  const handleEndDateChange = (_event, selectedDate) => {
    if (selectedDate) {
      const rounded = new Date(selectedDate);
      rounded.setSeconds(0, 0);
      setFormData((prev) => ({
        ...prev,
        end: ensureValidEnd(prev.start, rounded),
      }));
      setSelectedSuggestionId(null);
    }

    if (!isIOS) {
      setShowEndPicker(false);
    }
  };

  const handleBackdropPress = () => {
    if (!formSaving) {
      handleCloseForm();
    }
  };

  const handleModalCardPress = (event) => {
    event?.stopPropagation?.();
  };

  const buildSuggestions = useCallback(() => {
    const periodStart = new Date();
    periodStart.setSeconds(0, 0);
    const periodEnd = new Date(
      periodStart.getTime() + AVAILABILITY_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000
    );

    const availabilityResult = findMutualAvailability({
      calendars: calendarEntries,
      periodStart,
      periodEnd,
      groupPreferences: {},
      userPreferences: availabilityUserPreferences,
      globalBusyIntervals,
      maxSuggestions: SUGGESTION_LIMIT,
      defaultSlotDurationMinutes: DEFAULT_EVENT_DURATION_MINUTES,
      seedKey: familyId || currentUserId || 'famtime',
    });

    const slots = Array.isArray(availabilityResult.slots)
      ? availabilityResult.slots
      : [];

    if (!slots.length) {
      setSuggestions([]);
      setSelectedSuggestionId(null);
      setActiveSlotId(null);
      setSuggestionNotice(
        availabilityResult.constraints
          ? 'Ingen ledige tidsrum inden for præferencerne. Juster dagene eller tidsvinduerne.'
          : 'Kunne ikke finde fælles tilgængelighed. Tilføj eller opdater familiepræferencer.'
      );
      return;
    }

    const nextSuggestions = slots.map((slot, index) => ({
      id: `${slot.start.getTime()}-${slot.end.getTime()}-${index}`,
      start: slot.start,
      end: slot.end,
    }));

    setSuggestionNotice('');
    setSuggestions(nextSuggestions);
    setSelectedSuggestionId(null);
    setActiveSlotId(nextSuggestions[0]?.id ?? null);
  }, [
    calendarEntries,
    availabilityUserPreferences,
    globalBusyIntervals,
  ]);

  useEffect(() => {
    buildSuggestions();
  }, [buildSuggestions]);

  const handleSelectSuggestion = (suggestion) => {
    setSelectedSuggestionId(suggestion.id);
    setActiveSlotId(suggestion.id);
    setFormData((prev) => ({
      ...prev,
      start: suggestion.start,
      end: suggestion.end,
    }));
    setShowStartPicker(isIOS);
    setShowEndPicker(isIOS);
  };


  const handleSelectMoodCard = useCallback(
    (mood) => {
      if (!mood) {
        return;
      }

      if (activeMoodKey === mood.key) {
        return;
      }

      const defaultTitle =
        mood.key === 'custom' ? '' : `Familietid - ${mood.label}`;
      const defaultDescription =
        mood.key === 'custom'
          ? ''
          : mood.summary || mood.description || '';

      setActiveMoodKey(mood.key);
      setMoodDraftTitle(defaultTitle);
      setMoodDraftDescription(defaultDescription);
    },
    [activeMoodKey]
  );

  const handleChangeMoodTitle = useCallback((text) => {
    setMoodDraftTitle(text);
  }, []);

  const handleChangeMoodDescription = useCallback((text) => {
    setMoodDraftDescription(text);
  }, []);

  const handleApplyAISuggestion = useCallback((text) => {
    const nextText = typeof text === 'string' ? text : '';
    setMoodDraftDescription(nextText);
  }, []);

  const handlePlanFromMood = useCallback(async () => {
    if (!activeSuggestion) {
      Alert.alert('Vælg dato', 'Vælg først en af de ledige datoer.');
      return;
    }

    const trimmedTitle = moodDraftTitle.trim();
    if (!trimmedTitle) {
      Alert.alert('Manglende titel', 'Tilføj en titel til begivenheden.');
      return;
    }

    const baseStart =
      activeSuggestion.start instanceof Date
        ? new Date(activeSuggestion.start)
        : new Date(activeSuggestion.start ?? Date.now());
    const baseEnd =
      activeSuggestion.end instanceof Date
        ? new Date(activeSuggestion.end)
        : new Date(baseStart.getTime() + DEFAULT_EVENT_DURATION_MINUTES * 60000);

    const eventState = {
      title: trimmedTitle,
      description: moodDraftDescription.trim(),
      start: baseStart,
      end: baseEnd,
    };

    setFormData(eventState);
    setSelectedSuggestionId(activeSuggestion.id);

    const success = await handleSubmitEvent(eventState);

    if (success) {
      setActiveMoodKey(null);
      setMoodDraftTitle('');
      setMoodDraftDescription('');
    }
  }, [
    activeSuggestion,
    moodDraftTitle,
    moodDraftDescription,
    handleSubmitEvent,
  ]);

  const handleCloseMoodPreview = useCallback(() => {
    setMoodPreview(null);
  }, []);
const initializeCalendarContext = useCallback(
    async (userId) => {
      if (!userId) {
        setCalendarContext({
          ready: false,
          docRef: null,
          primaryCalendarId: null,
          calendarIds: [],
        });
        familyCalendarRefsRef.current = {};
        return;
      }

      try {
        const permissions = await Calendar.getCalendarPermissionsAsync();
        if (permissions.status !== 'granted') {
          setCalendarContext({
            ready: false,
            docRef: null,
            primaryCalendarId: null,
            calendarIds: [],
          });
          familyCalendarRefsRef.current = {};
          return;
        }

        const calendarRef = db.collection('calendar').doc(userId);
        const calendarDoc = await calendarRef.get();
        const calendarData = calendarDoc.data() ?? {};

        const calendarIdsSet = new Set();
        const appendIds = (values) => {
          (values ?? []).forEach((value) => {
            if (typeof value === 'string' && value.trim().length > 0) {
              calendarIdsSet.add(value);
            }
          });
        };

        if (Array.isArray(calendarData.calendarIds)) {
          appendIds(calendarData.calendarIds);
        }

        if (calendarData.calendarId) {
          appendIds([calendarData.calendarId]);
        }

        let fetchedDeviceCalendars = false;
        if (calendarIdsSet.size === 0) {
          const deviceCalendars = await Calendar.getCalendarsAsync(
            Calendar.EntityTypes.EVENT
          );
          appendIds(deviceCalendars.map((calendar) => calendar?.id).filter(Boolean));
          fetchedDeviceCalendars = true;
        }

        const calendarIds = Array.from(calendarIdsSet);
        const primaryCalendarId = calendarIds.includes(calendarData.calendarId)
          ? calendarData.calendarId
          : calendarIds[0] ?? null;

        familyCalendarRefsRef.current =
          calendarData.familyEventRefs && typeof calendarData.familyEventRefs === 'object'
            ? calendarData.familyEventRefs
            : {};

        setCalendarContext({
          ready: Boolean(primaryCalendarId),
          docRef: calendarRef,
          primaryCalendarId,
          calendarIds,
        });

        const shouldPersistCalendarMeta =
          calendarIds.length &&
          (fetchedDeviceCalendars ||
            !Array.isArray(calendarData.calendarIds) ||
            calendarData.calendarIds.length !== calendarIds.length ||
            calendarData.calendarIds.some((id) => !calendarIdsSet.has(id)) ||
            calendarData.calendarId !== primaryCalendarId ||
            calendarData.synced !== true);

        if (shouldPersistCalendarMeta) {
          await calendarRef.set(
            {
              synced: Boolean(primaryCalendarId),
              calendarIds,
              calendarId: primaryCalendarId ?? null,
              updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }

        if (!primaryCalendarId) {
          setCalendarContext({
            ready: false,
            docRef: calendarRef,
            primaryCalendarId: null,
            calendarIds: [],
          });
          return;
        }
      } catch (calendarError) {
        console.warn('[FamilyEvents] initializeCalendarContext', calendarError);
        setCalendarContext({
          ready: false,
          docRef: null,
          primaryCalendarId: null,
          calendarIds: [],
        });
        familyCalendarRefsRef.current = {};
      }
    },
    []
  );

  const handleSubmitEvent = async (eventState = null) => {
    const data = eventState ?? formData ?? {};

    if (!familyId) {
      setFormError('Ingen familie valgt. Tilslut dig en familie og prøv igen.');
      return false;
    }

    const trimmedTitle = (data.title ?? '').trim();
    if (!trimmedTitle.length) {
      setFormError('Tilføj en titel til begivenheden.');
      return false;
    }

    const startDate =
      data.start instanceof Date
        ? new Date(data.start)
        : new Date(data.start ?? Date.now());
    const endDateInput =
      data.end instanceof Date
        ? new Date(data.end)
        : new Date(data.end ?? data.start ?? Date.now());
    const safeEndDate = ensureValidEnd(startDate, endDateInput);

    setFormSaving(true);
    setFormError('');
    setActionStatus('');

    const normalizedDescription = (data.description ?? '').trim();

    const memberIdsFromFamily = Array.isArray(familyMembers)
      ? familyMembers
          .map((member) => member?.userId)
          .filter((id) => typeof id === 'string' && id.trim().length > 0)
      : [];

    let effectiveMemberIds = Array.from(new Set(memberIdsFromFamily));

    if (effectiveMemberIds.length <= 1) {
      try {
        const familyDoc = await db.collection('families').doc(familyId).get();
        const docMembers = familyDoc.data()?.members ?? [];
        if (Array.isArray(docMembers)) {
          const extraIds = docMembers
            .map((member) => member?.userId)
            .filter((id) => typeof id === 'string' && id.trim().length > 0);
          effectiveMemberIds = Array.from(new Set([...effectiveMemberIds, ...extraIds]));
        }
      } catch (_familyFetchError) {
        // Ignorer fejl i fallback-opslaget; vi bruger de data vi har.
      }
    }

    if (currentUserId && !effectiveMemberIds.includes(currentUserId)) {
      effectiveMemberIds.push(currentUserId);
    }

    const pendingApprovals = effectiveMemberIds.filter((id) => id !== currentUserId);
    const initialApprovedBy = currentUserId ? [currentUserId] : [];

    const payload = {
      title: trimmedTitle,
      description: normalizedDescription ? normalizedDescription : '',
      start: firebase.firestore.Timestamp.fromDate(startDate),
      end: firebase.firestore.Timestamp.fromDate(safeEndDate),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      pendingApprovals,
      approvedBy:
        pendingApprovals.length === 0
          ? Array.from(new Set([...initialApprovedBy, ...effectiveMemberIds]))
          : initialApprovedBy,
      status: pendingApprovals.length === 0 ? 'confirmed' : 'pending',
      lastModifiedBy: currentUserId ?? null,
      lastModifiedEmail: currentUserEmail ?? '',
    };

    try {
      const createPayload = {
        ...payload,
        createdBy: currentUserEmail,
        createdByUid: currentUserId ?? '',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      };

      if (pendingApprovals.length === 0) {
        createPayload.approvedAt = firebase.firestore.FieldValue.serverTimestamp();
      }

      await db
        .collection('families')
        .doc(familyId)
        .collection('events')
        .add(createPayload);

      setActionStatus(
        pendingApprovals.length === 0
          ? 'Begivenhed oprettet og automatisk godkendt.'
          : 'Begivenhed oprettet og afventer godkendelser.'
      );

      handleCloseForm();
      requestDeviceBusyRefresh();
      return true;
    } catch (_submitError) {
      setFormError(
        'Kunne ikke oprette begivenheden. Prøv igen.'
      );
      return false;
    } finally {
      setFormSaving(false);
    }
  };

  useEffect(() => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      setError('Ingen aktiv bruger fundet. Log ind igen.');
      setLoading(false);
      setCurrentUserProfile(null);
      return;
    }

    let unsubscribeFamily = null;

    const loadFamilyMetadata = async () => {
      try {
        setLoading(true);
        setError('');
        setInfoMessage('');

        const userDoc = await db.collection('users').doc(currentUser.uid).get();
        const userData = userDoc.data() ?? {};

        setCurrentUserProfile({
          name: userData.name ?? '',
          age: userData.age ?? '',
          gender: userData.gender ?? '',
          city: userData.location ?? '',
          preferredDays: Array.isArray(userData.preferredFamilyDays)
            ? userData.preferredFamilyDays
            : [],
          avatarEmoji:
            typeof userData.avatarEmoji === 'string' && userData.avatarEmoji.trim().length
              ? userData.avatarEmoji.trim()
              : DEFAULT_AVATAR_EMOJI,
        });

        await initializeCalendarContext(currentUser.uid);

        const nextFamilyId = userData.familyId ?? null;

        if (!nextFamilyId) {
          setInfoMessage(
            'Du er endnu ikke tilknyttet en familie. Opret eller tilslut dig en familie for at se familiens begivenheder.'
          );
          setFamilyId(null);
          setConfirmedEvents([]);
          setPendingEvents([]);
          setFamilyMembers([]);
          setEventsLoaded(false);
          return;
        }

        setFamilyId(nextFamilyId);

        unsubscribeFamily = db
          .collection('families')
          .doc(nextFamilyId)
          .onSnapshot((snapshot) => {
            if (!snapshot.exists) {
              setInfoMessage(
                'Familien blev ikke fundet. Måske er den blevet slettet.'
              );
              setConfirmedEvents([]);
              setPendingEvents([]);
              setFamilyMembers([]);
              setEventsLoaded(false);
              return;
            }

            const familyData = snapshot.data() ?? {};
            setFamilyName(familyData.name ?? 'FamTime familie');
            setFamilyMembers(
              Array.isArray(familyData.members) ? familyData.members : []
            );
            setEventsLoaded(false);
          });
      } catch (_error) {
        setError('Kunne ikke hente familieoplysninger. Prøv igen senere.');
        setFamilyId(null);
        setFamilyMembers([]);
        setEventsLoaded(false);
        setCurrentUserProfile(null);
      } finally {
        setLoading(false);
      }
    };

    loadFamilyMetadata();

    return () => {
      if (unsubscribeFamily) {
        unsubscribeFamily();
      }
    };
  }, []);

  useEffect(() => {
    if (!familyId) {
      setEventsLoaded(false);
      setConfirmedEvents([]);
      setPendingEvents([]);
      return;
    }

    setEventsLoaded(false);

    const unsubscribe = db
      .collection('families')
      .doc(familyId)
      .collection('events')
      .orderBy('start', 'asc')
      .onSnapshot(
        (snapshot) => {
          const nextConfirmed = [];
          const nextPending = [];

          snapshot.forEach((doc) => {
            const data = doc.data() ?? {};
            const start = data.start?.toDate ? data.start.toDate() : null;
            const end = data.end?.toDate ? data.end.toDate() : null;
            const pendingChangeData = data.pendingChange ?? null;
            const pendingChange = pendingChangeData
              ? {
                  title: pendingChangeData.title ?? '',
                  description: pendingChangeData.description ?? '',
                  start: pendingChangeData.start?.toDate
                    ? pendingChangeData.start.toDate()
                    : null,
                  end: pendingChangeData.end?.toDate
                    ? pendingChangeData.end.toDate()
                    : null,
                }
              : null;
            const event = {
              id: doc.id,
              title: data.title ?? 'Ingen titel',
              description: data.description ?? '',
              start,
              end,
              status: data.status ?? 'pending',
              createdBy: data.createdBy ?? '',
              createdByUid: data.createdByUid ?? '',
              pendingApprovals: Array.isArray(data.pendingApprovals)
                ? data.pendingApprovals
                : [],
              approvedBy: Array.isArray(data.approvedBy)
                ? data.approvedBy
                : [],
              pendingChange,
            };

            if (event.status === 'pending') {
              nextPending.push(event);
            } else {
              nextConfirmed.push(event);
            }
          });

          setConfirmedEvents(nextConfirmed);
          setPendingEvents(nextPending);
          setEventsLoaded(true);
        },
        () => {
          setError('Kunne ikke hente familieevents. Prøv igen senere.');
          setConfirmedEvents([]);
          setPendingEvents([]);
          setEventsLoaded(true);
        }
      );

    return unsubscribe;
  }, [familyId]);

  useEffect(() => {
    const syncConfirmedEventsWithCalendar = async () => {
      if (
        !familyId ||
        !calendarContext.ready ||
        !calendarContext.primaryCalendarId ||
        familySyncLockRef.current ||
        !eventsLoaded
      ) {
        return;
      }

      familySyncLockRef.current = true;

      try {
        const permissions = await Calendar.getCalendarPermissionsAsync();
        if (permissions.status !== 'granted') {
          return;
        }

        let deviceCalendarChanged = false;
        const confirmed = confirmedEvents.filter(
          (event) => event.status === 'confirmed'
        );
        const confirmedIds = new Set(confirmed.map((event) => event.id));

        const refs = { ...familyCalendarRefsRef.current };

        for (const event of confirmed) {
          const start =
            event.start instanceof Date && !Number.isNaN(event.start.getTime())
              ? event.start
              : new Date();
          const proposedEnd =
            event.end instanceof Date && !Number.isNaN(event.end.getTime())
              ? event.end
              : new Date(start.getTime() + DEFAULT_EVENT_DURATION_MINUTES * 60000);
          const end = ensureValidEnd(start, proposedEnd);

          const notesSections = [];
          if (familyName) {
            notesSections.push(`Familie: ${familyName}`);
          }
          if (event.description) {
            notesSections.push(event.description);
          }
          notesSections.push('Synkroniseret fra FamTime familiebegivenheder.');

          const eventDetails = {
            title: event.title === 'Ingen titel' ? 'FamTime begivenhed' : event.title,
            startDate: start,
            endDate: end,
            notes: notesSections.join('\n\n'),
          };

          const signature = `${eventDetails.title}::${eventDetails.startDate.getTime()}::${eventDetails.endDate.getTime()}::${eventDetails.notes}`;

          const existingEntry = refs[event.id];
          if (existingEntry?.calendarEventId) {
            if (existingEntry.signature === signature) {
              continue;
            }
            let updatedEntry = null;

            try {
              await Calendar.updateEventAsync(existingEntry.calendarEventId, eventDetails);
              deviceCalendarChanged = true;
              updatedEntry = {
                calendarEventId: existingEntry.calendarEventId,
                signature,
                updatedAt: new Date().toISOString(),
              };
            } catch (updateError) {
              let recreatedId = null;
              try {
                recreatedId = await Calendar.createEventAsync(
                  calendarContext.primaryCalendarId,
                  eventDetails
                );
              } catch (createAfterUpdateError) {
                console.warn(
                  '[FamilyEvents] recreate after update failed',
                  createAfterUpdateError
                );
              }

              if (recreatedId) {
                deviceCalendarChanged = true;
                updatedEntry = {
                  calendarEventId: recreatedId,
                  signature,
                  updatedAt: new Date().toISOString(),
                };

                if (
                  existingEntry.calendarEventId &&
                  recreatedId !== existingEntry.calendarEventId
                ) {
                  try {
                    await Calendar.deleteEventAsync(existingEntry.calendarEventId);
                  } catch (_deleteError) {
                    // Kan være slettet manuelt; ignorer fejlen og behold den nye reference.
                  }
                }
              } else {
                // Hvis vi hverken kan opdatere eller genskabe, behold den gamle reference
                // så vi kan prøve igen ved næste synkronisering uden at miste kalenderposten.
                updatedEntry = existingEntry;
              }
            }

            refs[event.id] = updatedEntry;
          } else {
            try {
              const calendarEventId = await Calendar.createEventAsync(
                calendarContext.primaryCalendarId,
                eventDetails
              );
              deviceCalendarChanged = true;
              refs[event.id] = {
                calendarEventId,
                signature,
                updatedAt: new Date().toISOString(),
              };
            } catch (createError) {
              console.warn('[FamilyEvents] createEventAsync failed', createError);
            }
          }
        }

        for (const [eventId, entry] of Object.entries(refs)) {
          if (!confirmedIds.has(eventId)) {
            if (entry?.calendarEventId) {
              try {
                await Calendar.deleteEventAsync(entry.calendarEventId);
                deviceCalendarChanged = true;
              } catch (deleteError) {
                console.warn('[FamilyEvents] deleteEventAsync failed', deleteError);
              }
            }
            delete refs[eventId];
          }
        }

        if (calendarContext.docRef) {
          await calendarContext.docRef.set(
            {
              familyEventRefs: refs,
              updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }

        familyCalendarRefsRef.current = refs;

        if (deviceCalendarChanged) {
          requestDeviceBusyRefresh();
        }
      } catch (syncError) {
        console.warn('[FamilyEvents] syncConfirmedEventsWithCalendar', syncError);
      } finally {
        familySyncLockRef.current = false;
      }
    };

    syncConfirmedEventsWithCalendar();
  }, [
    confirmedEvents,
    calendarContext.docRef,
    calendarContext.primaryCalendarId,
    calendarContext.ready,
    familyId,
    eventsLoaded,
    requestDeviceBusyRefresh,
  ]);

  const renderEventFormModal = () => (
    <Modal visible={formVisible} transparent animationType="slide">
      <Pressable
        style={styles.modalBackdrop}
        onPress={handleBackdropPress}
        accessibilityRole="button"
        accessibilityLabel="Luk begivenhedsformular"
      >
        <KeyboardAvoidingView
          behavior={isIOS ? 'padding' : undefined}
          style={styles.modalAvoiding}
        >
          <Pressable
            onPress={handleModalCardPress}
            style={styles.modalCard}
            accessibilityRole="none"
          >
            <ScrollView
              contentContainerStyle={styles.modalScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Ny familiebegivenhed</Text>
                <Pressable
                  onPress={handleCloseForm}
                  style={styles.modalCloseButton}
                  accessibilityRole="button"
                  accessibilityLabel="Luk formular"
                >
                  <Text style={styles.modalCloseText}>Luk</Text>
                </Pressable>
              </View>

              <Text style={styles.modalLabel}>Titel</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="Titel"
                value={formData.title}
                onChangeText={(text) => handleChangeFormField('title', text)}
              />

              <Text style={styles.modalLabel}>Beskrivelse</Text>
              <TextInput
                style={[styles.modalInput, styles.modalNotesInput]}
                placeholder="Beskrivelse (valgfrit)"
                value={formData.description}
                onChangeText={(text) =>
                  handleChangeFormField('description', text)
                }
                multiline
              />

              <Text style={styles.modalLabel}>Starttidspunkt</Text>
              <Pressable
                style={styles.modalDateButton}
                onPress={() => setShowStartPicker(true)}
                accessibilityRole="button"
                accessibilityLabel="Vælg starttidspunkt"
              >
                <Text style={styles.modalDateText}>
                  {formatDateTime(formData.start)}
                </Text>
              </Pressable>
              {(isIOS || showStartPicker) && (
                <DateTimePicker
                  value={formData.start}
                  mode="datetime"
                  display={isIOS ? 'inline' : 'default'}
                  onChange={handleStartDateChange}
                />
              )}

              <Text style={styles.modalLabel}>Sluttidspunkt</Text>
              <Pressable
                style={styles.modalDateButton}
                onPress={() => setShowEndPicker(true)}
                accessibilityRole="button"
                accessibilityLabel="Vælg sluttidspunkt"
              >
                <Text style={styles.modalDateText}>
                  {formatDateTime(formData.end)}
                </Text>
              </Pressable>
            {(isIOS || showEndPicker) && (
              <DateTimePicker
                value={formData.end}
                mode="datetime"
                display={isIOS ? 'inline' : 'default'}
                onChange={handleEndDateChange}
              />
            )}

            <Text style={styles.modalLabel}>Hurtige forslag</Text>
            {suggestions.length ? (
              <View style={styles.suggestionsWrap}>
                {suggestions.map((suggestion) => (
                  <Pressable
                    key={suggestion.id}
                    onPress={() => handleSelectSuggestion(suggestion)}
                    style={[
                      styles.suggestionChip,
                      selectedSuggestionId === suggestion.id
                        ? styles.suggestionChipSelected
                        : null,
                    ]}
                  >
                    <Text style={styles.suggestionText}>
                      {formatDateTime(suggestion.start)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <Text
                style={[
                  styles.modalHint,
                  suggestionNotice ? styles.modalHintWarning : null,
                ]}
              >
                {suggestionNotice ||
                  'Ingen oplagte tider i de næste dage. Du kan vælge tidspunkt manuelt.'}
              </Text>
            )}

            <ErrorMessage message={formError} />

            <Button
              title="Opret begivenhed"
              onPress={handleSubmitEvent}
              loading={formSaving}
              style={styles.modalPrimaryButton}
            />
            <Button
              title="Annuller"
              onPress={handleCloseForm}
              disabled={formSaving}
              style={styles.modalSecondaryButton}
            />
            </ScrollView>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );

  const renderMoodDetailsModal = () => {
    if (!moodPreview) {
      return null;
    }

    const summaryText = moodPreview.summary || moodPreview.description || '';
    const descriptionText =
      moodPreview.description && summaryText !== moodPreview.description
        ? moodPreview.description
        : '';

    return (
      <Modal visible transparent animationType="fade">
        <View style={styles.detailsModalBackdrop}>
          <Pressable
            style={styles.detailsModalScrim}
            onPress={handleCloseMoodPreview}
            accessibilityRole="button"
            accessibilityLabel="Luk humørkortdetaljer"
          />
          <View style={styles.detailsModalCard}>
            <Text style={styles.detailsModalTitle}>{moodPreview.label}</Text>
            {summaryText ? (
              <Text style={styles.detailsModalSummary}>{summaryText}</Text>
            ) : null}
            {descriptionText ? (
              <Text style={styles.detailsModalDescription}>{descriptionText}</Text>
            ) : null}
            <Button
              title="Luk"
              onPress={handleCloseMoodPreview}
              style={styles.detailsModalButton}
            />
          </View>
        </View>
      </Modal>
    );
  };

  return (
    <>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.container}>
            <View style={styles.heroCard}>
              <Text style={styles.title}>Design selv familieaktiviteter</Text>
              <Text style={styles.subtitle}>
                Hvis FamTimes autogenererede aftaler ikke passer til jer, kan du her designe dine egne aktiviteter.
              </Text>
              {!builderVisible ? (
                <Pressable
                  style={styles.heroButton}
                  onPress={handleRevealBuilder}
                  accessibilityRole="button"
                >
                  <Text style={styles.heroButtonText}>Lav familieaktivitet</Text>
                </Pressable>
              ) : null}
            </View>

            {builderVisible ? (
            <View style={styles.card}>
              {shouldShowStatusCard ? (
                <View style={styles.sectionCard}>
                  <ErrorMessage message={error} />

                  {actionStatus ? (
                    <View style={styles.statusPill}>
                      <Text style={styles.statusText}>{actionStatus}</Text>
                    </View>
                  ) : null}

                  {infoMessage ? (
                    <View style={styles.infoPill}>
                      <Text style={styles.infoText}>{infoMessage}</Text>
                    </View>
                  ) : null}

                  {loading ? (
                    <Text style={styles.infoText}>Indlæser familiens kalender.</Text>
                  ) : null}
                </View>
              ) : null}

              {!infoMessage ? (
                <>
                  <View style={styles.miniSectionHeading}>
                    <Text style={styles.miniSectionTitle}>Foreslået tidspunkter</Text>
                    <Text style={styles.miniSectionHint}>
                      Vælg tidspunkt for familieaftalen
                    </Text>
                    {suggestionMetaText ? (
                      <Text style={styles.miniSectionMeta}>{suggestionMetaText}</Text>
                    ) : null}
                  </View>

                  {sortedSuggestions.length ? (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      style={styles.slotScrollWrapper}
                      contentContainerStyle={styles.slotScrollContent}
                    >
                      {sortedSuggestions.map((suggestion) => {
                        const isActive =
                          activeSuggestion && suggestion.id === activeSuggestion.id;
                        return (
                          <Pressable
                            key={suggestion.id}
                            onPress={() => handleSelectSuggestion(suggestion)}
                            style={[
                              styles.slotCard,
                              isActive ? styles.slotCardActive : null,
                            ]}
                            accessibilityRole="button"
                            accessibilityState={{ selected: isActive }}
                            accessibilityLabel={`Ledig dato ${formatDateBadge(
                              suggestion.start
                            )}`}
                          >
                            <Text style={styles.slotDate}>
                              {formatDateBadge(suggestion.start)}
                            </Text>
                            <Text style={styles.slotTime}>
                              {formatTimeRange(suggestion.start, suggestion.end)}
                            </Text>
                            {isActive && activeDurationLabel ? (
                              <Text style={styles.slotDuration}>{activeDurationLabel}</Text>
                            ) : null}
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  ) : (
                    <Text style={styles.suggestionEmptyText}>
                      Ingen ledige datoer fundet endnu. Opdater familiepræferencer
                      under Konto → Opdater profil.
                    </Text>
                  )}

                  <View style={styles.miniSectionHeading}>
                    <Text style={styles.miniSectionTitle}>humørkort</Text>
                    <Text style={styles.miniSectionHint}>
                      Vælg stemningen for aftalen. Tryk på øjet for at læse mere.
                    </Text>
                  </View>

                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.moodScrollWrapper}
                    contentContainerStyle={styles.moodCardsWrap}
                  >
                    {moodCards.map((mood) => {
                      const isActiveMood = activeMoodKey === mood.key;
                      return (
                        <Pressable
                          key={mood.key}
                          onPress={() => handleSelectMoodCard(mood)}
                          style={[
                            styles.moodCard,
                            isActiveMood ? styles.moodCardActive : null,
                          ]}
                          accessibilityRole="button"
                          accessibilityState={{ selected: isActiveMood }}
                          accessibilityLabel={`humørkort ${mood.label}`}
                        >
                          <View style={styles.moodCardHeader}>
                            <Text style={styles.moodCardLabel}>{mood.label}</Text>
                            <Pressable
                              onPress={() => setMoodPreview(mood)}
                              hitSlop={12}
                              accessibilityRole="button"
                              accessibilityLabel={`Vis detaljer for ${mood.label}`}
                              style={styles.moodCardEyeButton}
                            >
                              <Ionicons
                                name="eye-outline"
                                style={[
                                  styles.moodCardIcon,
                                  isActiveMood ? styles.moodCardIconActive : null,
                                ]}
                              />
                            </Pressable>
                          </View>
                          {mood.helper ? (
                            <Text style={styles.moodCardCategory}>{mood.helper}</Text>
                          ) : null}
                        </Pressable>
                      );
                    })}
                  </ScrollView>

                  {activeMoodKey ? (
                    <View style={[styles.sectionCard, styles.moodEditorCard]}>
                      <Text style={styles.moodEditorTitle}>Tilpas humørkortet</Text>
                      <Text style={styles.moodEditorHint}>
                        Rediger titel og beskrivelse, eller generér en ny tekst baseret på humøret.
                      </Text>
                      <View style={styles.selectedTimeCard}>
                        <Text style={styles.selectedTimeLabel}>Tidspunkt</Text>
                        {activeSuggestion ? (
                          <>
                            <Text style={styles.selectedTimeValue}>
                              {formatDateBadge(activeSuggestion.start)}
                            </Text>
                            <Text style={styles.selectedTimeSubValue}>{activeTimeText}</Text>
                            {activeDurationLabel ? (
                              <Text style={styles.selectedTimeDuration}>{activeDurationLabel}</Text>
                            ) : null}
                          </>
                        ) : (
                          <Text style={styles.selectedTimePlaceholder}>
                            Vælg tidspunkt for familieaftalen.
                          </Text>
                        )}
                      </View>

                      <Text style={styles.moodEditorLabel}>Titel</Text>
                      <TextInput
                        style={styles.moodEditorInput}
                        placeholder="Titel"
                        value={moodDraftTitle}
                        onChangeText={handleChangeMoodTitle}
                      />

                      <Text style={styles.moodEditorLabel}>Beskrivelse</Text>
                      <TextInput
                        style={[styles.moodEditorInput, styles.moodEditorMultiline]}
                        placeholder="Beskrivelse (valgfri)"
                        value={moodDraftDescription}
                        onChangeText={handleChangeMoodDescription}
                        multiline
                      />

                      <ErrorMessage message={formError} />

                      {activeSuggestion && currentUserProfile ? (
                        <View style={styles.aiBlock}>
                          <AISuggestion
                            user={currentUserProfile}
                            variant="inline"
                            onSuggestion={handleApplyAISuggestion}
                          />
                        </View>
                      ) : null}

                      <Button
                        title="Planlæg familieaftalen"
                        onPress={handlePlanFromMood}
                        loading={formSaving}
                        style={styles.moodPrimaryButton}
                      />
                    </View>
                  ) : (
                    <View style={styles.sectionCard}>
                      <Text style={styles.moodHelper}>
                        Vælg et humørkort for at fortsætte.
                      </Text>
                    </View>
                  )}
                </>
              ) : null}
              <Text style={styles.helperText}>
                Når begivenheden er oprettet, vises den under &quot;Min kalender&quot;,
                hvor alle familiemedlemmer kan godkende eller foreslå ændringer.
              </Text>
            </View>
            ) : null}
          </View>
        </ScrollView>
      </SafeAreaView>
      {renderMoodDetailsModal()}
      {renderEventFormModal()}
    </>
  );
};



export default FamilyEventsScreen;







