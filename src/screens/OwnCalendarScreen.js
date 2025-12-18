/**
 * OwnCalendarScreen
 *
 * Hvad goer filen for appen:
 * - Viser brugerens overblik over familie-begivenheder og deres status (afventer, godkendt, ideer).
 * - Samler alles busy tider + familiens praef erencer for at finde ledige tidspunkter og foreslaa aktiviteter.
 * - Lader brugeren godkende/afvise, foreslaa aendringer og oprette nye forslag til familien.
 *
 * Overblik (hvordan filen er bygget op):
 * - Konstanter/sektion-varianter: UI-farver og tidskonstanter for forslag og varigheder.
 * - Helpers: formattering af tid/dato og små konverteringer (fx Firestore timestamp -> Date).
 * - State: familie/events, proposal-modal, auto-suggestions, praef erencer/busy-data og UI-tilstande.
 * - Dataflow: live-lytning på Firestore (familie, events, praef erencer) + device-kalender busy tider (polling/appstate).
 * - Logik: bruger `findMutualAvailability` til at bygge ledige slots og en suggestions-kø, inkl. sponsor-indslag.
 * - UI: statuskort, autosuggestions, sektioner pr. status og modaler til forslag/detaljer.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  Modal,
  TextInput,
  Pressable,
  Platform,
  KeyboardAvoidingView,
  AppState,
  Alert,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Calendar from 'expo-calendar';

import Button from '../components/Button';
import ErrorMessage from '../components/ErrorMessage';
import { auth, db, firebase } from '../lib/firebase';
import { Ionicons } from '@expo/vector-icons';
import { DEFAULT_AVATAR_EMOJI } from '../constants/avatarEmojis';
import styles from '../styles/screens/OwnCalendarScreenStyles';
import { colors } from '../styles/theme';
import findMutualAvailability, { availabilityUtils } from '../lib/availability';
import useActivityPool from '../hooks/useActivityPool';
import {
  applyIntervalTravelBuffer,
  areBusyListsEqual,
  buildEventBusyIntervals,
  extractPreferencesFromCalendarDoc,
  mergeBusyIntervals,
  normalizeBusyPayload,
  shallowEqualObjects,
} from '../utils/calendarAvailability';
import { simpleHash } from '../utils/activityHelpers';
import {
  FAMILY_PREFERENCE_MODES,
  normalizeFamilyPreferenceMode,
} from '../constants/familyPreferenceModes';
import rajissimoLogo from '../assets/rajissimo logo.png';

const isIOS = Platform.OS === 'ios';
const DEFAULT_EVENT_DURATION_MINUTES = 60;
const AVAILABILITY_LOOKAHEAD_DAYS = 21;
const AUTO_SUGGESTION_VISIBLE = 3;
const AUTO_SUGGESTION_QUEUE_LIMIT = 12;
const PRIVATE_EVENT_TRAVEL_BUFFER_MINUTES = 30;
const DEVICE_BUSY_POLL_INTERVAL_MS = 10 * 1000;
const REMOTE_ACTIVITY_WEIGHT = 0.6;
const SPONSOR_INSERT_INTERVAL = 5;
const RAJISSIMO_SPONSOR_TITLE = 'Familietid med Rajissimo';
const RAJISSIMO_SPONSOR_COPY =
  'Besøg Rajissimo is, og få noget til den søde tand.';
const RAJISSIMO_SPONSOR_SOURCE_LABEL = 'Rajissimo sponsoraktivitet';
const RAJISSIMO_SPONSOR_START = new Date(2025, 11, 20, 13, 15);
const RAJISSIMO_SPONSOR_END = new Date(2025, 11, 20, 14, 30);

const SECTION_VARIANTS = {
  default: {
    cardBg: colors.surface,
    borderColor: colors.border,
    badgeBg: colors.surfaceMuted,
    badgeBorderColor: colors.border,
    badgeText: colors.text,
    dividerColor: colors.border,
    hintText: colors.mutedText,
  },
  review: {
    cardBg: '#FFF0E8',
    borderColor: '#F5C1A1',
    badgeBg: 'rgba(209, 67, 36, 0.15)',
    badgeBorderColor: 'rgba(209, 67, 36, 0.35)',
    badgeText: colors.error,
    dividerColor: 'rgba(209, 67, 36, 0.4)',
    hintText: colors.error,
  },
  ideas: {
    cardBg: '#FFF9ED',
    borderColor: '#F1D49C',
    badgeBg: 'rgba(230, 138, 46, 0.18)',
    badgeBorderColor: 'rgba(182, 100, 20, 0.4)',
    badgeText: colors.primaryDark,
    dividerColor: 'rgba(182, 100, 20, 0.45)',
    hintText: colors.primaryDark,
  },
  waiting: {
    cardBg: '#F9F4EE',
    borderColor: '#E1CCB1',
    badgeBg: 'rgba(140, 111, 85, 0.15)',
    badgeBorderColor: 'rgba(140, 111, 85, 0.35)',
    badgeText: colors.mutedText,
    dividerColor: 'rgba(140, 111, 85, 0.35)',
    hintText: colors.mutedText,
  },
  confirmed: {
    cardBg: '#EEF7F0',
    borderColor: '#A6D7BA',
    badgeBg: 'rgba(31, 122, 82, 0.15)',
    badgeBorderColor: 'rgba(31, 122, 82, 0.35)',
    badgeText: colors.success,
    dividerColor: 'rgba(31, 122, 82, 0.4)',
    hintText: colors.success,
  },
};

const formatClockLabel = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '';
  }
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
};

const capitalizeWord = (value) => {
  if (typeof value !== 'string' || !value.length) {
    return '';
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
};

const toDate = (value) => {
  if (!value) {
    return null;
  }

  if (value.toDate) {
    try {
      return value.toDate();
    } catch (_error) {
      return null;
    }
  }

  if (value instanceof Date) {
    return value;
  }

  return null;
};

const formatWeekdayDateLabel = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return 'Ukendt dag';
  }

  const weekday = capitalizeWord(
    date.toLocaleDateString('da-DK', { weekday: 'long' })
  );
  const dateLabel = date.toLocaleDateString('da-DK');
  return `${weekday} d. ${dateLabel}`;
};

const formatDateRange = (start, end) => {
  const startDate =
    start instanceof Date && !Number.isNaN(start.getTime()) ? start : toDate(start);
  if (!(startDate instanceof Date) || Number.isNaN(startDate.getTime())) {
    return 'Ukendt tidspunkt';
  }

  const startDateLabel = formatWeekdayDateLabel(startDate);
  const startTimeLabel = formatClockLabel(startDate);
  const endDate =
    end instanceof Date && !Number.isNaN(end?.getTime()) ? end : toDate(end);

  if (!(endDate instanceof Date) || Number.isNaN(endDate.getTime())) {
    return `${startDateLabel} kl. ${startTimeLabel}`;
  }

  const endTimeLabel = formatClockLabel(endDate);
  const isSameDay =
    startDate.getFullYear() === endDate.getFullYear() &&
    startDate.getMonth() === endDate.getMonth() &&
    startDate.getDate() === endDate.getDate();

  if (isSameDay) {
    return `${startDateLabel} kl. ${startTimeLabel}-${endTimeLabel}`;
  }

  const endDateLabel = formatWeekdayDateLabel(endDate);
  return `${startDateLabel} kl. ${startTimeLabel} - ${endDateLabel} kl. ${endTimeLabel}`;
};

const OwnCalendarScreen = () => {
  // --- Grunddata: hvem er brugeren, og basisstatus for skærmen ---
  const currentUser = auth.currentUser;
  const currentUserId = currentUser?.uid ?? null;
  const currentUserEmail = currentUser?.email?.toLowerCase() ?? '';

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [infoMessage, setInfoMessage] = useState('');

  // --- Familie- og medlemsdata + præferencer der driver forslag/visning ---
  const [familyId, setFamilyId] = useState(null);
  const [familyName, setFamilyName] = useState('');
  const [familyMembers, setFamilyMembers] = useState([]);
  const [memberProfiles, setMemberProfiles] = useState({});
  const [familyPreferences, setFamilyPreferences] = useState({});
  const [calendarAvailability, setCalendarAvailability] = useState({});
  const [currentUserEmoji, setCurrentUserEmoji] = useState(DEFAULT_AVATAR_EMOJI);
  const memberById = useMemo(() => {
    const map = new Map();
    const mergeMemberData = (userId, source = {}) => {
      const profile = memberProfiles?.[userId];
      if (!profile) {
        return source;
      }
      const merged = { ...source };
      if (typeof profile.avatarEmoji === 'string' && profile.avatarEmoji.trim().length) {
        merged.avatarEmoji = profile.avatarEmoji.trim();
      }
      if (typeof profile.displayName === 'string' && profile.displayName.trim().length) {
        merged.displayName = profile.displayName.trim();
      }
      if (typeof profile.name === 'string' && profile.name.trim().length) {
        merged.name = profile.name.trim();
      }
      if (typeof profile.email === 'string' && profile.email.trim().length) {
        merged.email = profile.email.trim();
      }
      return merged;
    };

    familyMembers.forEach((member) => {
      if (member?.userId) {
        map.set(member.userId, mergeMemberData(member.userId, member));
      }
    });

    if (memberProfiles && typeof memberProfiles === 'object') {
      Object.keys(memberProfiles).forEach((userId) => {
        if (!map.has(userId)) {
          map.set(userId, mergeMemberData(userId, { userId }));
        }
      });
    }

    return map;
  }, [familyMembers, memberProfiles]);
  const [userRole, setUserRole] = useState('');
  const normalizedUserRole = useMemo(() => {
    if (typeof userRole !== 'string') {
      return '';
    }
    return userRole.trim().toLowerCase();
  }, [userRole]);
  const isAdminUser = normalizedUserRole === 'admin' || normalizedUserRole === 'owner';
  const [events, setEvents] = useState([]);

  // --- Forslagsmodal og UI-tilstande til oprettelse/visning af events ---
  const [proposalVisible, setProposalVisible] = useState(false);
  const [proposalEvent, setProposalEvent] = useState(null);
  const [proposalData, setProposalData] = useState({
    title: '',
    description: '',
    start: new Date(),
    end: new Date(new Date().getTime() + 60 * 60 * 1000),
  });
  const [proposalError, setProposalError] = useState('');
  const [proposalSaving, setProposalSaving] = useState(false);

  const [showProposalDatePicker, setShowProposalDatePicker] = useState(isIOS);
  const [showProposalStartTimePicker, setShowProposalStartTimePicker] = useState(false);
  const [showProposalEndTimePicker, setShowProposalEndTimePicker] = useState(false);
  const [expandedEventIds, setExpandedEventIds] = useState(() => new Set());
  const [collapsedSections, setCollapsedSections] = useState({});
  const [deviceCalendarSource, setDeviceCalendarSource] = useState({
    ready: false,
    calendarIds: [],
  });
  const [deviceBusyRefreshToken, setDeviceBusyRefreshToken] = useState(0);
  const deviceBusyLoadedRef = useRef('');
  const appStateRef = useRef(AppState.currentState);
  const [autoSuggestions, setAutoSuggestions] = useState([]);
  const autoSlotQueueRef = useRef([]);
  const autoSlotCursorRef = useRef(0);
  const suggestionSequenceRef = useRef(0);
  const sponsorInstanceRef = useRef(0);
  const [autoSuggestionError, setAutoSuggestionError] = useState('');
  const [autoSuggestionNotice, setAutoSuggestionNotice] = useState('');
  const [autoActionId, setAutoActionId] = useState(null);
  const [suggestionLoading, setSuggestionLoading] = useState(true);
  const { remoteActivities, manualActivities } = useActivityPool();
  const [previewSuggestion, setPreviewSuggestion] = useState(null);

  // --- UI helpers ---

  /**
   * TOGGLE SEKTIONS-KOLLAPS
   * 
   * Slår en sektion til/fra i UI (bruges til forslag/ventende/godkendte lister).
   */
  const toggleSectionCollapse = useCallback((key) => {
    if (!key) {
      return;
    }
    setCollapsedSections((prev) => ({
      ...prev,
      [key]: !prev?.[key],
    }));
  }, []);

  // Når appen vender tilbage til forgrunden, opdateres device-busy tider, så forslag er friske.
  useEffect(() => {
    const handleAppStateChange = (nextState) => {
      if (appStateRef.current !== 'active' && nextState === 'active') {
        setDeviceBusyRefreshToken((token) => token + 1);
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
  }, []);

  // Simpel polling for at fange nye device-kalenderændringer uden brugerinteraktion.
  useEffect(() => {
    const intervalId = setInterval(() => {
      setDeviceBusyRefreshToken((token) => token + 1);
    }, DEVICE_BUSY_POLL_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, []);

  const toggleEventDetails = useCallback((eventId) => {
    setExpandedEventIds((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  }, []);

  /**
   * NULSTIL FORSLAGSFORMULAR
   * 
   * Rydder modal-data (titel/beskrivelse/tider), resetter pickers og
   * sikrer at nye forslag starter med aktuelle default-værdier.
   */
  const resetProposalState = useCallback(() => {
    const now = new Date();
    now.setSeconds(0, 0);
    const defaultEnd = new Date(now.getTime() + 60 * 60 * 1000);
    setProposalData({
      title: '',
      description: '',
      start: now,
      end: defaultEnd,
    });
    setProposalError('');
    setProposalSaving(false);
    setShowProposalDatePicker(isIOS);
    setShowProposalStartTimePicker(false);
    setShowProposalEndTimePicker(false);
  }, []);

  /**
   * ÅBN FORSLAGSMODAL
   * 
   * Forudfylder modal med eksisterende event/ændring, resetter fejl/loading
   * og viser modal klar til redigering.
   */
  const openProposalModal = useCallback(
    (event) => {
      setProposalEvent(event);

      const base = event?.pendingChange ?? {
        title: event?.title ?? '',
        description: event?.description ?? '',
        start: event?.start ? new Date(event.start) : new Date(),
        end:
          event?.end && event?.start
            ? new Date(event.end)
            : new Date(new Date().getTime() + 60 * 60 * 1000),
      };

      setProposalData({
        title: base.title ?? '',
        description: base.description ?? '',
        start: base.start instanceof Date ? base.start : new Date(),
        end:
          base.end instanceof Date
            ? base.end
            : new Date(new Date().getTime() + 60 * 60 * 1000),
      });
      setProposalError('');
      setProposalSaving(false);
      setShowProposalDatePicker(isIOS);
      setShowProposalStartTimePicker(false);
      setShowProposalEndTimePicker(false);
      setProposalVisible(true);
    },
    [setProposalVisible]
  );

  /**
   * LUK FORSLAGSMODAL
   * 
   * Skjuler modal og nulstiller formularen.
   */
  const closeProposalModal = useCallback(() => {
    setProposalVisible(false);
    setProposalEvent(null);
    resetProposalState();
  }, [resetProposalState]);

  const proposalMinDate = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (proposalEvent?.start instanceof Date && !Number.isNaN(proposalEvent.start.getTime())) {
      const eventStart = new Date(proposalEvent.start);
      eventStart.setHours(0, 0, 0, 0);
      return eventStart > today ? eventStart : today;
    }

    return today;
  }, [proposalEvent]);

  /**
   * KRÆVER NY GODKENDELSE
   * 
   * Returnerer true hvis en begivenhed er pending eller har pendingChange,
   * bruges til at gruppere events i UI.
   */
  const requiresRenewedApproval = useCallback(
    (event) => event?.status === 'pending' || Boolean(event?.pendingChange),
    []
  );

  const eventsPendingUser = useMemo(() => {
    if (!currentUserId) {
      return [];
    }

    return events.filter(
      (event) =>
        requiresRenewedApproval(event) &&
        Array.isArray(event.pendingApprovals) &&
        event.pendingApprovals.includes(currentUserId)
    );
  }, [events, currentUserId, requiresRenewedApproval]);

  const eventsPendingOthers = useMemo(
    () =>
      events.filter(
        (event) =>
          requiresRenewedApproval(event) &&
          (!Array.isArray(event.pendingApprovals) ||
            !event.pendingApprovals.includes(currentUserId))
      ),
    [events, currentUserId, requiresRenewedApproval]
  );

  const eventsConfirmed = useMemo(
    () =>
      events
        .filter(
          (event) =>
            event.status === 'confirmed' && !requiresRenewedApproval(event)
        )
        .sort((a, b) => {
          const timeA = a.start ? a.start.getTime() : 0;
          const timeB = b.start ? b.start.getTime() : 0;
          return timeA - timeB;
        }),
    [events, requiresRenewedApproval]
  );

  const confirmedEventsAll = useMemo(
    () => events.filter((event) => event.status === 'confirmed'),
    [events]
  );
  const pendingEventsAll = useMemo(
    () => events.filter((event) => event.status === 'pending'),
    [events]
  );

  // Samler alle medlemmer + brugerens kalenderoplysninger til availability-beregninger.
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

    // Transformer rå familiepræferencer til det format availability-beregneren forventer.
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
    const confirmedBusy = buildEventBusyIntervals(confirmedEventsAll);
    const pendingBusy = buildEventBusyIntervals(pendingEventsAll);
    return mergeBusyIntervals(confirmedBusy, pendingBusy);
  }, [confirmedEventsAll, pendingEventsAll]);

  // Bygger et visningsvenligt forslag ud fra et ledigt tidsrum (kombinerer seed + aktivitetspool).
  const buildSuggestionFromSlot = useCallback(
    (slot) => {
      if (
        !slot ||
        !(slot.start instanceof Date) ||
        !(slot.end instanceof Date) ||
        Number.isNaN(slot.start.getTime()) ||
        Number.isNaN(slot.end.getTime())
      ) {
        return null;
      }

      const seedKey = familyId || currentUserId || 'famtime';
      const baseSeed = `${seedKey}|${slot.start.getTime()}|${slot.end.getTime()}`;
      const remoteAvailable = remoteActivities.length > 0;
      const manualAvailable = manualActivities.length > 0;

      if (!remoteAvailable && !manualAvailable) {
        return null;
      }

      const shouldUseRemote = (() => {
        if (!remoteAvailable) {
          return false;
        }
        if (!manualAvailable) {
          return true;
        }
        const roll = simpleHash(`${baseSeed}|pool`) % 100;
        return roll < REMOTE_ACTIVITY_WEIGHT * 100;
      })();

      const pool = shouldUseRemote ? remoteActivities : manualActivities;
      if (!pool.length) {
        return null;
      }

      const poolType = shouldUseRemote ? 'remote' : 'manual';
      const index = simpleHash(`${baseSeed}|${poolType}`) % pool.length;
      const activity = pool[index];
      const sourceLabel =
        activity.source === 'remote'
          ? 'Fra aktivitetsbanken'
          : activity.source === 'weekend'
            ? 'Weekendkatalog'
            : 'Hverdagskatalog';

      const description = activity.description ?? '';
      const priceLabel =
        typeof activity.price === 'number' && Number.isFinite(activity.price)
          ? `${activity.price} kr.`
          : '';
      const previewText = (() => {
        if (!description) {
          return '';
        }
        const firstLine =
          description
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length)[0] ?? '';
        if (firstLine.length > 140) {
          return `${firstLine.slice(0, 137)}...`;
        }
        return firstLine;
      })();

      return {
        id: `${slot.id}::${activity.id}`,
        slotId: slot.id,
        start: slot.start,
        end: slot.end,
        title: activity.title ?? 'FamTime forslag',
        description,
        priceLabel,
        preview: previewText,
        activitySource: sourceLabel,
        activity,
        sourceType: activity.source,
      };
    },
    [familyId, currentUserId, manualActivities, remoteActivities]
  );

  const buildRajissimoSponsorSuggestion = useCallback(() => {
    sponsorInstanceRef.current += 1;
    return {
      id: `rajissimo-sponsor-${sponsorInstanceRef.current}`,
      slotId: `rajissimo-sponsor-slot-${sponsorInstanceRef.current}`,
      start: new Date(RAJISSIMO_SPONSOR_START),
      end: new Date(RAJISSIMO_SPONSOR_END),
      title: RAJISSIMO_SPONSOR_TITLE,
      description: RAJISSIMO_SPONSOR_COPY,
      priceLabel: '',
      preview: RAJISSIMO_SPONSOR_COPY,
      activitySource: RAJISSIMO_SPONSOR_SOURCE_LABEL,
      sourceType: 'sponsor',
      isSponsor: true,
    };
  }, []);

  /**
   * FYLD SYNLIGE FORSLAG
   * 
   * Trækker fra køen af ledige slots (med sponsor-indsprøjtning) og fylder
   * listen op til det ønskede antal uden duplikater.
   */
  const fillVisibleSuggestions = useCallback(
    (baseList = []) => {
      const base = Array.isArray(baseList) ? baseList.filter(Boolean) : [];
      const usedIds = new Set(base.map((item) => item.id));
      const next = [...base];

      while (next.length < AUTO_SUGGESTION_VISIBLE) {
        const nextSequenceIndex = suggestionSequenceRef.current + 1;
        if (nextSequenceIndex % SPONSOR_INSERT_INTERVAL === 0) {
          const sponsorSuggestion = buildRajissimoSponsorSuggestion();
          if (!usedIds.has(sponsorSuggestion.id)) {
            next.push(sponsorSuggestion);
            usedIds.add(sponsorSuggestion.id);
          }
          suggestionSequenceRef.current += 1;
          continue;
        }

        if (autoSlotCursorRef.current >= autoSlotQueueRef.current.length) {
          break;
        }

        const slot = autoSlotQueueRef.current[autoSlotCursorRef.current];
        autoSlotCursorRef.current += 1;
        const suggestion = buildSuggestionFromSlot(slot);
        if (suggestion && !usedIds.has(suggestion.id)) {
          next.push(suggestion);
          usedIds.add(suggestion.id);
          suggestionSequenceRef.current += 1;
        }
      }

      return next;
    },
    [buildRajissimoSponsorSuggestion, buildSuggestionFromSlot]
  );

  // Bygger en kø af ledige tidsrum (inkl. sponsor-indsprøjtninger) og viser de første forslag.
  useEffect(() => {
    if (!calendarEntries.length) {
      autoSlotQueueRef.current = [];
      autoSlotCursorRef.current = 0;
      suggestionSequenceRef.current = 0;
      sponsorInstanceRef.current = 0;
      setAutoSuggestions([]);
      setSuggestionLoading(false);
      setAutoSuggestionNotice('Ingen ledige tidsrum - juster præferencer.');
      return;
    }

    setSuggestionLoading(true);
    setAutoSuggestionError('');

    try {
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
        maxSuggestions: AUTO_SUGGESTION_QUEUE_LIMIT,
        defaultSlotDurationMinutes: DEFAULT_EVENT_DURATION_MINUTES,
        seedKey: familyId || currentUserId || 'famtime',
      });

      const slots = Array.isArray(availabilityResult.slots)
        ? availabilityResult.slots.map((slot, index) => ({
            id: `${slot.start.getTime()}-${slot.end.getTime()}-${index}`,
            start: slot.start,
            end: slot.end,
          }))
        : [];

      autoSlotQueueRef.current = slots;
      autoSlotCursorRef.current = 0;
      suggestionSequenceRef.current = 0;
      sponsorInstanceRef.current = 0;
      setSuggestionLoading(false);
      setAutoSuggestionNotice(slots.length ? '' : 'Ingen ledige tidsrum - juster præferencer.');
      setAutoSuggestions(fillVisibleSuggestions([]));
    } catch (error) {
      console.warn('[OwnCalendar] build auto suggestions', error);
      setAutoSuggestionError('Kunne ikke hente forslag lige nu.');
      setSuggestionLoading(false);
      autoSlotQueueRef.current = [];
      autoSlotCursorRef.current = 0;
      suggestionSequenceRef.current = 0;
      sponsorInstanceRef.current = 0;
      setAutoSuggestions([]);
    }
  }, [
    availabilityUserPreferences,
    calendarEntries,
    currentUserId,
    familyId,
    fillVisibleSuggestions,
    globalBusyIntervals,
  ]);

  useEffect(() => {
    setAutoSuggestions((prev) => fillVisibleSuggestions(prev.slice(0, AUTO_SUGGESTION_VISIBLE)));
  }, [fillVisibleSuggestions, manualActivities, remoteActivities]);

  /**
   * AUTO SUGGESTION NOTICE
   *
   * Viser besked når autoslot-køen er tom og der ikke længere indlæses forslag.
   */
  useEffect(() => {
    if (!autoSuggestions.length && !suggestionLoading) {
      if (autoSlotCursorRef.current >= autoSlotQueueRef.current.length) {
        setAutoSuggestionNotice('Ingen ledige tidsrum - juster præferencer.');
      }
    }
  }, [autoSuggestions.length, suggestionLoading]);

  /**
   * AFVIS AUTO-SUGGESTION
   *
   * Fjerner et autoslot fra visningen og trækker næste forslag fra køen hvis muligt.
   */
  const handleDismissAutoSuggestion = useCallback(
    (suggestionId) => {
      setAutoSuggestions((prev) =>
        fillVisibleSuggestions(prev.filter((item) => item.id !== suggestionId))
      );
    },
    [fillVisibleSuggestions]
  );

  /**
   * ACCEPTER AUTO-SUGGESTION
   *
   * Omdanner autoslot til event-forslag med korrekt godkendelsesliste og metadata.
   */
  const handleAcceptAutoSuggestion = useCallback(
    async (suggestion) => {
      if (!suggestion || !familyId || !currentUserId) {
        return;
      }

      // Opretter et event-forslag ud fra auto-slot og sætter korrekt godkendelsesliste.
      setAutoActionId(suggestion.id);

      try {
        const memberIds = await computeMemberIds();
        if (!memberIds.length) {
          setError('Ingen familie tilknyttet. Tilslut dig en familie først.');
          return;
        }

        const pendingApprovals = memberIds.filter((id) => id !== currentUserId);
        const initialApprovedBy = currentUserId ? [currentUserId] : [];
        const start =
          suggestion.start instanceof Date && !Number.isNaN(suggestion.start.getTime())
            ? suggestion.start
            : new Date();
        const proposedEnd =
          suggestion.end instanceof Date && !Number.isNaN(suggestion.end.getTime())
            ? suggestion.end
            : new Date(start.getTime() + DEFAULT_EVENT_DURATION_MINUTES * 60000);
        const end =
          proposedEnd > start
            ? proposedEnd
            : new Date(start.getTime() + DEFAULT_EVENT_DURATION_MINUTES * 60000);
        const description = [
          suggestion.description,
          suggestion.priceLabel ? `Pris: ${suggestion.priceLabel}` : '',
          suggestion.activitySource,
        ]
          .filter((text) => typeof text === 'string' && text.trim().length)
          .join('\n\n');

        const payload = {
          title: suggestion.title,
          description,
          start: firebase.firestore.Timestamp.fromDate(start),
          end: firebase.firestore.Timestamp.fromDate(end),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          pendingApprovals,
          approvedBy:
            pendingApprovals.length === 0
              ? Array.from(new Set([...initialApprovedBy, ...memberIds]))
              : initialApprovedBy,
          status: pendingApprovals.length === 0 ? 'confirmed' : 'pending',
          lastModifiedBy: currentUserId ?? null,
          lastModifiedEmail: currentUserEmail ?? '',
          autoSuggestionSource: suggestion.sourceType,
        };

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

        setStatusMessage('Forslaget er sendt til familien.');
        setAutoSuggestions((prev) =>
          fillVisibleSuggestions(prev.filter((item) => item.id !== suggestion.id))
        );
      } catch (error) {
        console.warn('[OwnCalendar] accept auto suggestion', error);
        setError('Kunne ikke sende forslaget. Prøv igen.');
      } finally {
        setAutoActionId(null);
      }
    },
    [
      computeMemberIds,
      currentUserEmail,
      currentUserId,
      familyId,
      fillVisibleSuggestions,
      setStatusMessage,
    ]
  );

  /**
   * ÅBEN SUGGESTION PREVIEW
   *
   * Åbner modal til at vise detaljer for et autoslot inden accept.
   */
  const handleOpenSuggestionPreview = useCallback((suggestion) => {

    if (!suggestion) {
      return;
    }
    setPreviewSuggestion(suggestion);
  }, []);

  /**
   * LUSK SUGGESTION PREVIEW
   *
   * Lukker preview-modal for autoslot.
   */
  const handleCloseSuggestionPreview = useCallback(() => {

    setPreviewSuggestion(null);
  }, []);

  /**
   * EXPANDED EVENT IDS SYNC
   *
   * Holder udvidede kort i sync: hvis events ændres, fjernes IDs der ikke findes længere.
   */
  useEffect(() => {

    setExpandedEventIds((prev) => {
      if (!prev.size) {
        return prev;
      }
      const validIds = new Set(events.map((event) => event.id));
      const next = new Set();
      prev.forEach((id) => {
        if (validIds.has(id)) {
          next.add(id);
        }
      });
      if (next.size === prev.size) {
        return prev;
      }
      return next;
    });
  }, [events]);

  // Henter familiemedlemmers profiler/præferencer fra Firestore og samler dem i lokale maps.
  useEffect(() => {
    let isActive = true;

    const fetchPreferences = async () => {
      const memberIds = familyMembers
        .map((member) => member?.userId)
        .filter((id) => typeof id === 'string' && id.trim().length > 0);

      if (!memberIds.length) {
        if (isActive) {
          setFamilyPreferences({});
          setMemberProfiles({});
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
        const profileMap = {};
        snapshots.forEach((docSnapshot, index) => {
          if (!docSnapshot || !docSnapshot.exists) {
            return;
          }
          const memberId = memberIds[index];
          const data = docSnapshot.data() ?? {};
          const normalizedName =
            typeof data.name === 'string' && data.name.trim().length ? data.name.trim() : '';
          const normalizedDisplayName =
            typeof data.displayName === 'string' && data.displayName.trim().length
              ? data.displayName.trim()
              : normalizedName;
          const normalizedEmail =
            typeof data.email === 'string' && data.email.trim().length ? data.email.trim() : '';
          const avatarEmojiValue =
            typeof data.avatarEmoji === 'string' && data.avatarEmoji.trim().length
              ? data.avatarEmoji.trim()
              : DEFAULT_AVATAR_EMOJI;
          profileMap[memberId] = {
            avatarEmoji: avatarEmojiValue,
            displayName: normalizedDisplayName,
            name: normalizedName,
            email: normalizedEmail,
          };
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
              days: Array.isArray(data.preferredFamilyDays) ? data.preferredFamilyDays : [],
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
                days: Array.isArray(resolvedTarget?.days) ? [...resolvedTarget.days] : [],
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
          setMemberProfiles(profileMap);
        }
      } catch (_error) {
        if (isActive) {
          setFamilyPreferences({});
          setMemberProfiles({});
        }
      }
    };

    fetchPreferences();

    return () => {
      isActive = false;
    };
  }, [familyMembers]);

  // Live-lytning på kalenderdata pr. medlem (busy intervaller + præferencer) for opdaterede forslag.
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
              const nextBusyShared = sharedBusy.length ? sharedBusy : [];
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
            console.warn('[OwnCalendar] calendar availability snapshot', error);
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
    let cancelled = false;

    // Sikrer adgang til enhedens kalendere og gemmer deres IDs til senere busy-opslag.
    const ensureCalendarSource = async () => {
      if (!currentUserId) {
        if (!cancelled) {
          setDeviceCalendarSource({ ready: false, calendarIds: [] });
        }
        return;
      }

      try {
        let permissions = await Calendar.getCalendarPermissionsAsync();
        if (permissions.status !== 'granted') {
          permissions = await Calendar.requestCalendarPermissionsAsync();
        }

        if (permissions.status !== 'granted') {
          if (!cancelled) {
            setDeviceCalendarSource({ ready: false, calendarIds: [] });
          }
          return;
        }

        const calendarIdsSet = new Set();
        const appendIds = (values) => {
          (values ?? []).forEach((value) => {
            if (typeof value === 'string' && value.trim().length > 0) {
              calendarIdsSet.add(value);
            }
          });
        };

        try {
          const calendarDoc = await db.collection('calendar').doc(currentUserId).get();
          const calendarData = calendarDoc.data() ?? {};
          if (Array.isArray(calendarData.calendarIds)) {
            appendIds(calendarData.calendarIds);
          }
          if (typeof calendarData.calendarId === 'string') {
            appendIds([calendarData.calendarId]);
          }
        } catch (_error) {
          // ignore doc errors, fallback to device calendars
        }

        if (!calendarIdsSet.size) {
          const deviceCalendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
          appendIds(deviceCalendars.map((calendar) => calendar?.id).filter(Boolean));
        }

        const calendarIds = Array.from(calendarIdsSet);
        if (!cancelled) {
          setDeviceCalendarSource({
            ready: Boolean(calendarIds.length),
            calendarIds,
          });
        }
      } catch (error) {
        console.warn('[OwnCalendar] ensureCalendarSource', error);
        if (!cancelled) {
          setDeviceCalendarSource({ ready: false, calendarIds: [] });
        }
      }
    };

    ensureCalendarSource();

    return () => {
      cancelled = true;
    };
  }, [currentUserId]);

  // Henter busy tider fra device-kalendere når kilde/refresh-token ændres; danner grundlag for forslag.
  useEffect(() => {
    if (
      !currentUserId ||
      !deviceCalendarSource.ready ||
      !Array.isArray(deviceCalendarSource.calendarIds) ||
      !deviceCalendarSource.calendarIds.length
    ) {
      return undefined;
    }

    const idsKey = deviceCalendarSource.calendarIds.slice().sort().join('|');
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
          start.getTime() + AVAILABILITY_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000
        );

        const events = await Calendar.getEventsAsync(deviceCalendarSource.calendarIds, start, end);
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
        console.warn('[OwnCalendar] loadDeviceBusy', error);
      }
    };

    loadDeviceBusy();

    return () => {
      cancelled = true;
    };
  }, [
    currentUserId,
    deviceBusyRefreshToken,
    deviceCalendarSource.calendarIds,
    deviceCalendarSource.ready,
  ]);

  // Lytter på bruger- og familie-docs: finder familie-id, navn, medlemmer og holder events opdateret.
  const loadProfileAndFamily = useCallback(() => {
    if (!currentUserId) {
      setLoading(false);
      setInfoMessage('Ingen aktiv bruger. Log venligst ind igen.');
      return () => {};
    }

    let unsubscribeUser = null;
    let unsubscribeFamilyDoc = null;

    unsubscribeUser = db
      .collection('users')
      .doc(currentUserId)
      .onSnapshot(
        (snapshot) => {
          const data = snapshot.data() ?? {};
          const nextEmoji =
            typeof data.avatarEmoji === 'string' && data.avatarEmoji.trim().length
              ? data.avatarEmoji.trim()
              : DEFAULT_AVATAR_EMOJI;
          setCurrentUserEmoji(nextEmoji);
          const nextFamilyId = data.familyId ?? null;
          setFamilyId(nextFamilyId);
          setUserRole(data.familyRole ?? '');

          if (!nextFamilyId) {
            setFamilyName('');
            setFamilyMembers([]);
            setEvents([]);
            setInfoMessage(
              'Du er endnu ikke tilknyttet en familie. Tilslut eller opret en familie for at se begivenheder.'
            );
            setLoading(false);
            if (unsubscribeFamilyDoc) {
              unsubscribeFamilyDoc();
              unsubscribeFamilyDoc = null;
            }
            return;
          }

          setInfoMessage('');

          if (unsubscribeFamilyDoc) {
            unsubscribeFamilyDoc();
          }

          unsubscribeFamilyDoc = db
            .collection('families')
            .doc(nextFamilyId)
            .onSnapshot(
              (familySnapshot) => {
                if (!familySnapshot.exists) {
                  setFamilyName('');
                  setFamilyMembers([]);
                  setEvents([]);
                  setInfoMessage(
                    'Familien blev ikke fundet. Måske er den blevet slettet.'
                  );
                  return;
                }

                const familyData = familySnapshot.data() ?? {};
                setFamilyName(familyData.name ?? 'FamTime familie');
                setFamilyMembers(
                  Array.isArray(familyData.members) ? familyData.members : []
                );
                setInfoMessage('');
              },
              () => {
                setFamilyName('');
                setFamilyMembers([]);
                setInfoMessage(
                  'Kunne ikke hente familieoplysninger. Prøv igen senere.'
                );
              }
            );
        },
        () => {
          setInfoMessage(
            'Kunne ikke hente brugeroplysninger. Prøv at logge ind igen.'
          );
          setLoading(false);
        }
      );

    return () => {
      if (unsubscribeUser) {
        unsubscribeUser();
      }
      if (unsubscribeFamilyDoc) {
        unsubscribeFamilyDoc();
      }
    };
  }, [currentUserId]);

  useEffect(() => {
    const unsubscribe = loadProfileAndFamily();
    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [loadProfileAndFamily]);

  // Live-lytning på familie-events (Firestore) for at holde skærmen opdateret.
  useEffect(() => {
    if (!familyId) {
      setEvents([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const unsubscribe = db
      .collection('families')
      .doc(familyId)
      .collection('events')
      .orderBy('start', 'asc')
      .onSnapshot(
        (snapshot) => {
          const nextEvents = [];
          snapshot.forEach((doc) => {
            const data = doc.data() ?? {};
            const pendingChangeData = data.pendingChange ?? null;

            const pendingChange = pendingChangeData
              ? {
                  title: pendingChangeData.title ?? '',
                  description: pendingChangeData.description ?? '',
                  start: toDate(pendingChangeData.start),
                  end: toDate(pendingChangeData.end),
                }
              : null;

            nextEvents.push({
              id: doc.id,
              title: data.title ?? 'Ingen titel',
              description: data.description ?? '',
              start: toDate(data.start),
              end: toDate(data.end),
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
              lastModifiedBy: data.lastModifiedBy ?? null,
              lastModifiedEmail: data.lastModifiedEmail ?? '',
            });
          });

          setEvents(nextEvents);
          setLoading(false);
        },
        () => {
          setError('Kunne ikke hente familieevents. Prøv igen senere.');
          setEvents([]);
          setLoading(false);
        }
      );

    return () => unsubscribe();
  }, [familyId]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 600);
  }, []);

  // Bruges når vi skal vide, hvem der hører til familien (fra state og evt. frisk doc-læsning).
  const computeMemberIds = useCallback(async () => {
    const idsFromState = familyMembers
      .map((member) => member?.userId)
      .filter((id) => typeof id === 'string' && id.trim().length > 0);

    if (idsFromState.length > 1 || !familyId) {
      return Array.from(new Set(idsFromState));
    }

    try {
      const familyDoc = await db.collection('families').doc(familyId).get();
      if (!familyDoc.exists) {
        return idsFromState;
      }
      const docMembers = familyDoc.data()?.members ?? [];
      const ids = docMembers
        .map((member) => member?.userId)
        .filter((id) => typeof id === 'string' && id.trim().length > 0);
      return Array.from(new Set([...idsFromState, ...ids]));
    } catch (_error) {
      return idsFromState;
    }
  }, [familyId, familyMembers]);

  const handleApproveEvent = useCallback(
    async (event) => {
      if (!familyId || !event?.id || !currentUserId) {
        return;
      }

      // Markerer event som godkendt af den aktuelle bruger og afslutter hvis alle har godkendt.
      const pendingList = Array.isArray(event.pendingApprovals)
        ? event.pendingApprovals
        : [];

      if (!pendingList.includes(currentUserId)) {
        return;
      }

      const remaining = pendingList.filter((id) => id !== currentUserId);
      const approvedBy = Array.isArray(event.approvedBy)
        ? Array.from(new Set([...event.approvedBy, currentUserId]))
        : [currentUserId];

      if (remaining.length === 0) {
        if (event.pendingChange?.cancel) {
          try {
            await db
              .collection('families')
              .doc(familyId)
              .collection('events')
              .doc(event.id)
              .delete();
            setStatusMessage('Begivenheden er aflyst for hele familien.');
          } catch (_deleteError) {
            setError('Kunne ikke aflyse begivenheden. Prøv igen.');
          }
          return;
        }
      }

      const updatePayload = {
        pendingApprovals: remaining,
        approvedBy,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      };

      if (remaining.length === 0) {
        updatePayload.status = 'confirmed';
        updatePayload.approvedAt = firebase.firestore.FieldValue.serverTimestamp();

        if (event.pendingChange) {
          if (event.pendingChange.start) {
            updatePayload.start = firebase.firestore.Timestamp.fromDate(
              event.pendingChange.start
            );
          }
          if (event.pendingChange.end) {
            updatePayload.end = firebase.firestore.Timestamp.fromDate(
              event.pendingChange.end
            );
          }
          if (typeof event.pendingChange.title === 'string') {
            updatePayload.title = event.pendingChange.title;
          }
          if (typeof event.pendingChange.description === 'string') {
            updatePayload.description = event.pendingChange.description;
          }

          updatePayload.pendingChange =
            firebase.firestore.FieldValue.delete();
        }
      }

      try {
        await db
          .collection('families')
          .doc(familyId)
          .collection('events')
          .doc(event.id)
          .set(updatePayload, { merge: true });

        setStatusMessage(
          remaining.length === 0
            ? 'Begivenheden er godkendt af familien.'
            : 'Din godkendelse er registreret.'
        );
      } catch (_error) {
        setError('Kunne ikke godkende begivenheden. Prøv igen.');
      }
    },
    [currentUserId, familyId]
  );

  const handleRejectChange = useCallback(
    async (event) => {
      if (!familyId || !event?.id) {
        return;
      }

      // Afviser en foreslået ændring og nulstiller pending/approval felter.
      try {
        await db
          .collection('families')
          .doc(familyId)
          .collection('events')
          .doc(event.id)
          .set(
            {
              pendingApprovals: [],
              approvedBy: [],
              pendingChange: firebase.firestore.FieldValue.delete(),
              status: 'confirmed',
              updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        setStatusMessage('Forslaget er afvist.');
      } catch (_error) {
        setError('Kunne ikke afvise forslaget. Prøv igen.');
      }
    },
    [familyId]
  );

  const handleAdminCancelEvent = useCallback(
    async (event) => {
      if (!familyId || !event?.id) {
        return;
      }

      // Kun for admin/owner: sletter hele begivenheden for alle.
      try {
        await db
          .collection('families')
          .doc(familyId)
          .collection('events')
          .doc(event.id)
          .delete();
        setStatusMessage('Begivenheden er aflyst for hele familien.');
      } catch (_error) {
        setError('Kunne ikke aflyse begivenheden. Prøv igen.');
      }
    },
    [familyId]
  );

  const confirmAdminCancelEvent = useCallback(
    (event) => {
      if (!event) {
        return;
      }
      Alert.alert(
        'Aflys begivenhed',
        'Er du sikker på, at du vil aflyse denne begivenhed for hele familien?',
        [
          { text: 'Behold', style: 'cancel' },
          {
            text: 'Aflys begivenhed',
            style: 'destructive',
            onPress: () => handleAdminCancelEvent(event),
          },
        ]
      );
    },
    [handleAdminCancelEvent]
  );

  // Opdaterer datoen i forslagsformularen og justerer sluttid, så den ikke ender før start.
  const handleProposalDateChange = useCallback(
    (event, selectedDate) => {
      if (event?.type === 'dismissed') {
        if (!isIOS) {
          setShowProposalDatePicker(false);
        }
        return;
      }

      if (selectedDate) {
        const cleaned = new Date(selectedDate);
        cleaned.setHours(0, 0, 0, 0);
        setProposalData((prev) => {
          const prevStart =
            prev.start instanceof Date && !Number.isNaN(prev.start.getTime())
              ? new Date(prev.start)
              : new Date();
          const prevEnd =
            prev.end instanceof Date && !Number.isNaN(prev.end.getTime())
              ? new Date(prev.end)
              : new Date(prevStart.getTime() + 60 * 60 * 1000);
          prevStart.setSeconds(0, 0);
          prevEnd.setSeconds(0, 0);

          const nextStart = new Date(cleaned);
          nextStart.setHours(prevStart.getHours(), prevStart.getMinutes(), 0, 0);

          let nextEnd = new Date(cleaned);
          nextEnd.setHours(prevEnd.getHours(), prevEnd.getMinutes(), 0, 0);
          if (nextEnd <= nextStart) {
            nextEnd = new Date(nextStart.getTime() + 30 * 60 * 1000);
          }

          return {
            ...prev,
            start: nextStart,
            end: nextEnd,
          };
        });
      }

      if (!isIOS) {
        setShowProposalDatePicker(false);
      }
    },
    []
  );

  // Sætter starttid i formularen og flytter evt. sluttid, så den ligger efter start.
  const handleProposalStartTimeChange = useCallback(
    (event, selectedDate) => {
      if (event?.type === 'dismissed') {
        setShowProposalStartTimePicker(false);
        return;
      }

      if (selectedDate) {
        setProposalData((prev) => {
          const nextStart =
            prev.start instanceof Date && !Number.isNaN(prev.start.getTime())
              ? new Date(prev.start)
              : new Date();
          nextStart.setHours(selectedDate.getHours(), selectedDate.getMinutes(), 0, 0);

          let nextEnd =
            prev.end instanceof Date && !Number.isNaN(prev.end.getTime())
              ? new Date(prev.end)
              : new Date(nextStart.getTime() + 60 * 60 * 1000);
          if (nextEnd <= nextStart) {
            nextEnd = new Date(nextStart.getTime() + 30 * 60 * 1000);
          }

          return {
            ...prev,
            start: nextStart,
            end: nextEnd,
          };
        });
      }

      if (!isIOS) {
        setShowProposalStartTimePicker(false);
      }
    },
    []
  );

  // Sætter sluttid i formularen; hvis valgt tid er før start, rykker den til 30 min efter start.
  const handleProposalEndTimeChange = useCallback(
    (event, selectedDate) => {
      if (event?.type === 'dismissed') {
        setShowProposalEndTimePicker(false);
        return;
      }

      if (selectedDate) {
        setProposalData((prev) => {
          const nextEnd =
            prev.end instanceof Date && !Number.isNaN(prev.end.getTime())
              ? new Date(prev.end)
              : new Date();
          nextEnd.setHours(selectedDate.getHours(), selectedDate.getMinutes(), 0, 0);
          const nextStart =
            prev.start instanceof Date && !Number.isNaN(prev.start.getTime())
              ? new Date(prev.start)
              : new Date();

          if (nextEnd <= nextStart) {
            return {
              ...prev,
              end: new Date(nextStart.getTime() + 30 * 60 * 1000),
            };
          }

          return {
            ...prev,
            end: nextEnd,
          };
        });
      }

      if (!isIOS) {
        setShowProposalEndTimePicker(false);
      }
    },
    []
  );

  const handleOpenDatePicker = useCallback(() => {
    if (!isIOS) {
      setShowProposalDatePicker(true);
    }
  }, []);

  // Viser den relevante tid-picker (start eller slut) i modalens UI.
  const handleOpenTimePicker = useCallback((type) => {
    if (type === 'start') {
      setShowProposalEndTimePicker(false);
      setShowProposalStartTimePicker(true);
    } else if (type === 'end') {
      setShowProposalStartTimePicker(false);
      setShowProposalEndTimePicker(true);
    }
  }, []);

  // Sender et forslag til ændring af eksisterende begivenhed (kræver familie + bruger).
  const handleSubmitProposal = useCallback(async () => {
    if (!proposalEvent || !familyId || !currentUserId) {
      return;
    }

    const trimmedTitle = proposalData.title.trim();

    if (!trimmedTitle.length) {
      setProposalError('Tilføj en titel til begivenheden.');
      return;
    }

    if (!(proposalData.start instanceof Date) || !(proposalData.end instanceof Date)) {
      setProposalError('Start og slut skal være gyldige tidspunkter.');
      return;
    }

    if (proposalData.end <= proposalData.start) {
      setProposalError('Sluttidspunkt skal være efter starttidspunkt.');
      return;
    }

    if (proposalData.start < proposalMinDate) {
      setProposalError('Vælg en dato fra begivenhedens dag og frem.');
      return;
    }

    setProposalSaving(true);
    setProposalError('');
    setStatusMessage('');

    const memberIds = await computeMemberIds();
    const pendingApprovals = memberIds.filter((id) => id !== currentUserId);

    const changePayload = {
      title: trimmedTitle,
      description: proposalData.description.trim(),
      start: firebase.firestore.Timestamp.fromDate(proposalData.start),
      end: firebase.firestore.Timestamp.fromDate(proposalData.end),
    };

    try {
      await db
        .collection('families')
        .doc(familyId)
        .collection('events')
        .doc(proposalEvent.id)
        .set(
          {
            pendingChange: changePayload,
            pendingApprovals,
            approvedBy: [currentUserId],
            status: 'pending',
            lastModifiedBy: currentUserId,
            lastModifiedEmail: currentUserEmail,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

      setStatusMessage('Forslaget er sendt til familien.');
      closeProposalModal();
    } catch (_error) {
      setProposalError('Kunne ikke sende forslaget. Prøv igen.');
    } finally {
      setProposalSaving(false);
    }
  }, [
    closeProposalModal,
    computeMemberIds,
    currentUserEmail,
    currentUserId,
    familyId,
    proposalData.description,
    proposalData.end,
    proposalData.start,
    proposalData.title,
    proposalEvent,
    proposalMinDate,
  ]);

  const renderEventSection = (
    title,
    items = [],
    hint,
    emptyLabel = 'Ingen begivenheder endnu',
    emptyDescription,
    appearance = {}
  ) => {
    const { badgeLabel = '', variant = 'default', collapsibleKey } = appearance ?? {};
    const variantTheme = SECTION_VARIANTS[variant] ?? SECTION_VARIANTS.default;
    const isCollapsed = collapsibleKey ? Boolean(collapsedSections[collapsibleKey]) : false;

    return (
      <View style={styles.sectionGroup}>
        <View
          style={[
            styles.sectionCard,
            {
              backgroundColor: variantTheme.cardBg,
              borderColor: variantTheme.borderColor,
            },
          ]}
        >
          <View style={styles.sectionHeaderRow}>
            {badgeLabel ? (
              <View
                style={[
                  styles.sectionBadge,
                  {
                    backgroundColor: variantTheme.badgeBg,
                    borderColor: variantTheme.badgeBorderColor,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.sectionBadgeText,
                    { color: variantTheme.badgeText },
                  ]}
                >
                  {badgeLabel}
                </Text>
              </View>
            ) : null}
            <View style={styles.sectionHeaderTextWrapper}>
              <View style={styles.sectionHeaderText}>
                <Text style={styles.sectionTitle}>{title}</Text>
                {hint ? (
                  <Text
                    style={[
                      styles.sectionHint,
                      { color: variantTheme.hintText ?? colors.mutedText },
                    ]}
                  >
                    {hint}
                  </Text>
                ) : null}
              </View>
              {collapsibleKey ? (
                <Pressable
                  onPress={() => toggleSectionCollapse(collapsibleKey)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: !isCollapsed }}
                  accessibilityLabel={
                    isCollapsed
                      ? `Vis ${title.toLowerCase()}`
                      : `Skjul ${title.toLowerCase()}`
                  }
                  style={styles.sectionCollapseButton}
                  hitSlop={12}
                >
                  <Ionicons
                    name={isCollapsed ? 'add-outline' : 'remove-outline'}
                    style={styles.sectionCollapseIcon}
                  />
                </Pressable>
              ) : null}
            </View>
          </View>

          {isCollapsed ? null : (
            <>
              <View
                style={[
                  styles.sectionDivider,
                  { backgroundColor: variantTheme.dividerColor },
                ]}
              />

              <View style={styles.eventList}>
                {items.length
                  ? items.map((event) => {
              const pendingList = Array.isArray(event.pendingApprovals)
                ? event.pendingApprovals.filter(
                    (id) => typeof id === 'string' && id.length > 0
                  )
                : [];
              const approvedList = Array.isArray(event.approvedBy)
                ? event.approvedBy.filter(
                    (id) => typeof id === 'string' && id.length > 0
                  )
                : [];

              const seenParticipantIds = new Set();

              const makeBadge = (memberId, status) => {
                const safeId =
                  typeof memberId === 'string' && memberId.length
                    ? memberId
                    : `unknown-${status}`;
                const member = memberById.get(memberId);
                const rawEmoji =
                  memberId === currentUserId && typeof currentUserEmoji === 'string' && currentUserEmoji.trim().length
                    ? currentUserEmoji
                    : member?.avatarEmoji;
                const emoji =
                  typeof rawEmoji === 'string' && rawEmoji.trim().length
                    ? rawEmoji.trim()
                    : DEFAULT_AVATAR_EMOJI;
                const label =
                  member?.name ||
                  member?.displayName ||
                  member?.email ||
                  (memberId === currentUserId ? 'Dig' : 'Familiemedlem');

                return {
                  key: `${safeId}-${status}`,
                  memberId: safeId,
                  emoji,
                  label,
                  status,
                };
              };

              const approvalBadges = [];

              pendingList.forEach((id) => {
                if (seenParticipantIds.has(id)) {
                  return;
                }
                seenParticipantIds.add(id);
                approvalBadges.push(makeBadge(id, 'pending'));
              });

              approvedList.forEach((id) => {
                if (seenParticipantIds.has(id)) {
                  return;
                }
                seenParticipantIds.add(id);
                approvalBadges.push(makeBadge(id, 'approved'));
              });

              if (!approvalBadges.length && familyMembers.length) {
                familyMembers.forEach((member) => {
                  const memberId =
                    typeof member?.userId === 'string' && member.userId.length
                      ? member.userId
                      : null;
                  if (!memberId || seenParticipantIds.has(memberId)) {
                    return;
                  }
                  seenParticipantIds.add(memberId);
                  const memberEmoji =
                    memberId === currentUserId && typeof currentUserEmoji === 'string' && currentUserEmoji.trim().length
                      ? currentUserEmoji
                      : member?.avatarEmoji;
                  approvalBadges.push({
                    key: `${memberId}-unknown`,
                    memberId,
                    emoji:
                      typeof memberEmoji === 'string' && memberEmoji.trim().length
                        ? memberEmoji.trim()
                        : DEFAULT_AVATAR_EMOJI,
                    label:
                      member?.name ||
                      member?.displayName ||
                      member?.email ||
                      'Familiemedlem',
                    status: 'unknown',
                  });
                });
              }

              if (currentUserId && !seenParticipantIds.has(currentUserId)) {
                seenParticipantIds.add(currentUserId);
                approvalBadges.push(
                  makeBadge(
                    currentUserId,
                    pendingList.includes(currentUserId) ? 'pending' : 'approved'
                  )
                );
              }

              const pendingCount = approvalBadges.filter(
                (badge) => badge.status === 'pending'
              ).length;

              const statusText =
                pendingCount > 0
                  ? pendingCount === 1
                    ? 'Afventer 1 familiemedlem'
                    : `Afventer ${pendingCount} familiemedlemmer`
                  : 'Alle medlemmer har godkendt.';
              const isEventFullyConfirmed =
                event.status === 'confirmed' && !requiresRenewedApproval(event);
              const hasExpandableDetails =
                Boolean(event.description) || Boolean(event.pendingChange);
              const isExpanded = expandedEventIds.has(event.id);
              const hasPendingChange = Boolean(event.pendingChange);
              const pendingIsCancel = Boolean(event.pendingChange?.cancel);
              const pendingTitle =
                hasPendingChange &&
                typeof event.pendingChange?.title === 'string' &&
                event.pendingChange.title.trim().length
                  ? event.pendingChange.title.trim()
                  : null;
              const pendingStart =
                hasPendingChange && event.pendingChange?.start instanceof Date
                  ? event.pendingChange.start
                  : null;
              const pendingEnd =
                hasPendingChange && event.pendingChange?.end instanceof Date
                  ? event.pendingChange.end
                  : null;
              const showNewSchedule = hasPendingChange && !pendingIsCancel;
              const headerTitle = showNewSchedule ? pendingTitle || event.title : event.title;
              const headerStart = showNewSchedule ? pendingStart || event.start : event.start;
              const headerEnd = showNewSchedule ? pendingEnd || event.end : event.end;
              const showAdminCancel =
                isAdminUser && !(event.status === 'pending' && pendingList.includes(currentUserId));

              return (
                <View key={event.id} style={styles.eventCard}>
                  <View style={styles.eventHeader}>
                    <View style={styles.eventHeaderText}>
                      <Text style={styles.eventTitle}>{headerTitle}</Text>
                      <Text style={styles.eventTime}>
                        {formatDateRange(headerStart, headerEnd)}
                      </Text>
                    </View>
                    {hasExpandableDetails ? (
                      <Pressable
                        onPress={() => toggleEventDetails(event.id)}
                        accessibilityRole="button"
                        accessibilityState={{ expanded: isExpanded }}
                        accessibilityLabel={
                          isExpanded
                            ? 'Skjul detaljer for begivenhed'
                            : 'Vis detaljer for begivenhed'
                        }
                        style={styles.eventToggle}
                        hitSlop={12}
                      >
                        <Ionicons
                          name={isExpanded ? 'eye-off-outline' : 'eye-outline'}
                          style={[
                            styles.eventToggleIcon,
                            isExpanded ? styles.eventToggleIconActive : null,
                          ]}
                        />
                      </Pressable>
                    ) : null}
                  </View>

                  <View style={styles.approvalRow}>
                    <Text style={styles.eventMeta}>{statusText}</Text>
                    <View style={styles.approvalBadges}>
                      {approvalBadges.map((badge) => {
                        const badgeStyle = [
                          styles.approvalBadge,
                          badge.status === 'approved'
                            ? styles.approvalBadgeApproved
                            : styles.approvalBadgePending,
                        ];
                        if (badge.status === 'unknown') {
                          badgeStyle.push(styles.approvalBadgeUnknown);
                        }

                        return (
                          <View
                            key={badge.key}
                            style={badgeStyle}
                            accessibilityLabel={`${badge.label}: ${
                              badge.status === 'approved'
                                ? 'har godkendt'
                                : badge.status === 'pending'
                                ? 'afventer svar'
                                : 'status ukendt'
                            }`}
                          >
                            <Text style={styles.approvalEmojiText}>{badge.emoji}</Text>
                          </View>
                        );
                      })}
                    </View>
                  </View>

                {isExpanded ? (
                  <View style={styles.eventDetails}>
                    {event.description ? (
                      <Text style={styles.eventDescription}>{event.description}</Text>
                    ) : null}
                    {event.pendingChange ? (
                      <View style={styles.pendingChangeBox}>
                        <Text style={styles.pendingChangeTitle}>Foreslået ændring</Text>
                        {event.pendingChange.cancel ? (
                          <Text style={styles.pendingChangeText}>
                            Forslag: Aflys begivenheden
                            {event.pendingChange.description
                              ? ` - ${event.pendingChange.description}`
                              : ''}
                          </Text>
                        ) : (
                          <>
                            {event.pendingChange.title &&
                            event.pendingChange.title !== event.title ? (
                              <Text style={styles.pendingChangeText}>
                                Ny titel: {event.pendingChange.title}
                              </Text>
                            ) : null}
                            {event.pendingChange.description &&
                            event.pendingChange.description !== event.description ? (
                              <Text style={styles.pendingChangeText}>
                                Ny beskrivelse: {event.pendingChange.description}
                              </Text>
                            ) : null}
                            {event.pendingChange.start ? (
                              <Text style={styles.pendingChangeText}>
                                Nyt tidspunkt:{' '}
                                {formatDateRange(
                                  event.pendingChange.start,
                                  event.pendingChange.end
                                )}
                              </Text>
                            ) : null}
                          </>
                        )}
                      </View>
                    ) : null}
                  </View>
                ) : null}

                <View style={styles.eventActions}>
                  {event.status === 'pending' && pendingList.includes(currentUserId) ? (
                    <>
                      <Button
                        title="Godkend"
                        onPress={() => handleApproveEvent(event)}
                        style={[styles.eventActionButton, styles.eventApproveButton]}
                      />
                      {event.pendingChange ? (
                        <Button
                          title="Afvis forslag"
                          onPress={() => handleRejectChange(event)}
                          style={[styles.eventActionButton, styles.eventRejectButton]}
                        />
                      ) : null}
                    </>
                  ) : null}
                  {showAdminCancel ? (
                    <Button
                      title="Aflys begivenhed"
                      onPress={() => confirmAdminCancelEvent(event)}
                      style={[styles.eventActionButton, styles.eventRejectButton]}
                    />
                  ) : null}
                  <Button
                    title="Foreslå ændring"
                    onPress={() => openProposalModal(event)}
                    style={[styles.eventActionButton, styles.eventActionButtonPrimary]}
                  />
                </View>
              </View>
            );
          })
              : (
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyTitle}>{emptyLabel}</Text>
                  {emptyDescription ? (
                    <Text style={styles.emptySubtitle}>{emptyDescription}</Text>
                  ) : null}
                </View>
              )}
              </View>
            </>
          )}
        </View>
      </View>
    );
  };

  const renderAutoSuggestionSection = () => {
    const variantTheme = SECTION_VARIANTS.ideas;
    const showEmptyState = !suggestionLoading && !autoSuggestions.length;
    const emptyLabel = autoSuggestionNotice || 'Ingen ledige tidsrum - juster præferencer.';
    const collapsibleKey = 'autoSuggestions';
    const isCollapsed = Boolean(collapsedSections[collapsibleKey]);

    return (
      <View style={styles.sectionGroup}>
        <View
          style={[
            styles.sectionCard,
            {
              backgroundColor: variantTheme.cardBg,
              borderColor: variantTheme.borderColor,
            },
          ]}
        >
          <View style={styles.sectionHeaderRow}>
            <View
              style={[
                styles.sectionBadge,
                {
                  backgroundColor: variantTheme.badgeBg,
                  borderColor: variantTheme.badgeBorderColor,
                },
              ]}
            >
              <Text
                style={[
                  styles.sectionBadgeText,
                  { color: variantTheme.badgeText },
                ]}
              >
                02
              </Text>
            </View>
            <View style={styles.sectionHeaderTextWrapper}>
              <View style={styles.sectionHeaderText}>
                <Text style={styles.sectionTitle}>Nye forslag</Text>
                <Text
                  style={[
                    styles.sectionHint,
                    { color: variantTheme.hintText ?? colors.mutedText },
                  ]}
                >
                  FamTime foreslår tider hvor alle kan. Godkend for at sende til familien.
                </Text>
              </View>
              <Pressable
                onPress={() => toggleSectionCollapse(collapsibleKey)}
                accessibilityRole="button"
                accessibilityState={{ expanded: !isCollapsed }}
                accessibilityLabel={
                  isCollapsed ? 'Vis nye forslag' : 'Skjul nye forslag'
                }
                style={styles.sectionCollapseButton}
                hitSlop={12}
              >
                <Ionicons
                  name={isCollapsed ? 'add-outline' : 'remove-outline'}
                  style={styles.sectionCollapseIcon}
                />
              </Pressable>
            </View>
          </View>

          {isCollapsed ? null : (
            <>
              <View
                style={[
                  styles.sectionDivider,
                  { backgroundColor: variantTheme.dividerColor },
                ]}
              />

              <ErrorMessage message={autoSuggestionError} />
              {suggestionLoading ? (
                <Text style={styles.infoText}>Finder ledige tider...</Text>
              ) : null}

              {autoSuggestions.length ? (
                <View style={styles.autoSuggestionList}>
                  {autoSuggestions.map((suggestion) => {
                    const isSponsorSuggestion = Boolean(suggestion?.isSponsor);
                    return (
                      <View
                        key={suggestion.id}
                        style={[
                          styles.autoSuggestionCard,
                          isSponsorSuggestion ? styles.autoSuggestionSponsorCard : null,
                        ]}
                      >
                        {isSponsorSuggestion ? (
                          <View style={styles.sponsorTagPill}>
                            <Text style={styles.sponsorTagText}>Sponsoreret</Text>
                          </View>
                        ) : null}
                        <View style={styles.autoSuggestionHeader}>
                          <Text style={styles.autoSuggestionTitle}>{suggestion.title}</Text>
                          <View style={styles.autoSuggestionHeaderExtras}>
                            {isSponsorSuggestion ? (
                              <View style={styles.sponsorLogoBadge}>
                                <Image
                                  source={rajissimoLogo}
                                  style={styles.sponsorLogoImage}
                                  resizeMode="contain"
                                />
                              </View>
                            ) : null}
                            <Pressable
                              onPress={() => handleOpenSuggestionPreview(suggestion)}
                              accessibilityRole="button"
                              accessibilityLabel={`Læs mere om ${suggestion.title}`}
                              style={styles.autoSuggestionEyeButton}
                            >
                              <Ionicons
                                name="eye-outline"
                                style={styles.autoSuggestionEyeIcon}
                              />
                            </Pressable>
                          </View>
                        </View>
                        <Text style={styles.autoSuggestionTime}>
                          {formatDateRange(suggestion.start, suggestion.end)}
                        </Text>
                        {suggestion.preview ? (
                          <Text
                            style={
                              isSponsorSuggestion
                                ? styles.autoSuggestionSponsorPreview
                                : styles.autoSuggestionPreview
                            }
                          >
                            {suggestion.preview}
                          </Text>
                        ) : null}
                        {isSponsorSuggestion ? (
                          <Text style={styles.autoSuggestionSponsorFootnote}>
                            Rajissimo giver 15% på is, når du godkender aktiviteten.
                          </Text>
                        ) : null}
                        <View style={styles.autoSuggestionActions}>
                          <Button
                            title="Godkend"
                            onPress={() => handleAcceptAutoSuggestion(suggestion)}
                            loading={autoActionId === suggestion.id}
                            style={[styles.eventActionButton, styles.eventApproveButton]}
                          />
                          <Button
                            title="Afvis"
                            onPress={() => handleDismissAutoSuggestion(suggestion.id)}
                            disabled={autoActionId === suggestion.id}
                            style={[styles.eventActionButton, styles.eventRejectButton]}
                          />
                        </View>
                      </View>
                    );
                  })}
                </View>
              ) : null}

              {showEmptyState ? (
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyTitle}>Ingen forslag endnu</Text>
                  <Text style={styles.emptySubtitle}>{emptyLabel}</Text>
                </View>
              ) : null}
            </>
          )}
        </View>
      </View>
    );
  };
  const renderAutoSuggestionPreviewModal = () => {
    if (!previewSuggestion) {
      return null;
    }

    const previewText =
      previewSuggestion.description && previewSuggestion.description.trim().length
        ? previewSuggestion.description
        : 'Ingen beskrivelse tilgængelig.';
    const priceLine =
      previewSuggestion.priceLabel && previewSuggestion.priceLabel.trim().length
        ? previewSuggestion.priceLabel
        : '';

    return (
      <Modal
        visible
        transparent
        animationType="fade"
        onRequestClose={handleCloseSuggestionPreview}
      >
        <View style={styles.previewModalBackdrop}>
          <Pressable
            style={styles.previewModalScrim}
            onPress={handleCloseSuggestionPreview}
            accessibilityRole="button"
            accessibilityLabel="Luk begivenhedsbeskrivelse"
          />
          <View style={styles.previewModalCard}>
            <Text style={styles.previewModalTitle}>{previewSuggestion.title}</Text>
            <Text style={styles.previewModalDescription}>{previewText}</Text>
            {priceLine ? (
              <Text style={styles.previewModalPrice}>Pris: {priceLine}</Text>
            ) : null}
            <Button
              title="Luk"
              onPress={handleCloseSuggestionPreview}
              style={styles.previewModalButton}
            />
          </View>
        </View>
      </Modal>
    );
  };

  const shouldShowStatusCard = Boolean(error);

  // UI-oversigt: viser overblik, auto-forslag, statuskort og sektioner for afventende/godkendte/idéer
  // samt modaler til forslag og detaljer.
  return (
    <>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
          }
        >
          <View style={styles.container}>
            <View style={styles.heroCard}>
              <Text style={styles.title}>Familiens kalender</Text>
              <Text style={styles.subtitle}>
                Godkend forslag, hold styr på afventende begivenheder, og foreslå ændringer for
                din familie.
              </Text>
            </View>

            {shouldShowStatusCard ? (
              <View style={styles.messagesCard}>
                <ErrorMessage message={error} />
              </View>
            ) : null}

            {renderEventSection(
              'Kræver din godkendelse',
              eventsPendingUser,
              'Disse begivenheder venter på din accept eller afvisning.',
              'Alt er godkendt for nu.',
              'Når et familiemedlem sender dig en begivenhed, dukker den op her.',
              { badgeLabel: '01', variant: 'review' }
            )}

            {renderAutoSuggestionSection()}

            {renderEventSection(
              'Afventer andre familiemedlemmer',
              eventsPendingOthers,
              'Forslag sendt af dig eller andre familiemedlemmer, som stadig er i proces.',
              'Ingen åbne forespørgsler hos familien.',
              'Vi giver besked, så snart de andre har svaret.',
              { badgeLabel: '03', variant: 'waiting', collapsibleKey: 'pendingOthers' }
            )}

            {renderEventSection(
              'Bekræftede begivenheder',
              eventsConfirmed,
              null,
              'Ingen bekræftede aftaler i kalenderen endnu.',
              'Når I har godkendt en begivenhed, lander den her.',
              { badgeLabel: '04', variant: 'confirmed' }
            )}
          </View>
        </ScrollView>
      </SafeAreaView>

      {renderAutoSuggestionPreviewModal()}

      <Modal
        visible={proposalVisible}
        animationType="slide"
        transparent
        onRequestClose={closeProposalModal}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={closeProposalModal}
          accessibilityRole="button"
          accessibilityLabel="Luk forslag"
        >
          <KeyboardAvoidingView
            behavior={isIOS ? 'padding' : undefined}
            style={styles.modalAvoiding}
          >
            <View style={styles.modalWrapper}>
              <ScrollView
                contentContainerStyle={styles.modalScrollContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <Pressable
                  onPress={(event) => event.stopPropagation()}
                  style={styles.modalCard}
                >
                  <Text style={styles.modalTitle}>Foreslå ændring</Text>
                  <Text style={styles.modalLabel}>Titel</Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="Titel"
                    value={proposalData.title}
                    onChangeText={(text) =>
                      setProposalData((prev) => ({ ...prev, title: text }))
                    }
                  />
                  <Text style={styles.modalLabel}>Beskrivelse</Text>
                  <TextInput
                    style={[styles.modalInput, styles.modalNotesInput]}
                    placeholder="Beskrivelse (valgfrit)"
                    value={proposalData.description}
                    onChangeText={(text) =>
                      setProposalData((prev) => ({ ...prev, description: text }))
                    }
                    multiline
                  />
                  <Text style={styles.modalLabel}>Dato</Text>
                  <Pressable
                    style={styles.modalDateButton}
                    onPress={handleOpenDatePicker}
                  >
                    <Text style={styles.modalDateText}>
                      {formatWeekdayDateLabel(proposalData.start)}
                    </Text>
                  </Pressable>
                  {isIOS ? (
                    <View style={styles.calendarPickerWrapper}>
                      <DateTimePicker
                        value={proposalData.start}
                        mode="date"
                        display="inline"
                        minimumDate={proposalMinDate}
                        onChange={handleProposalDateChange}
                        style={styles.calendarPicker}
                      />
                    </View>
                  ) : showProposalDatePicker ? (
                    <DateTimePicker
                      value={proposalData.start}
                      mode="date"
                      display="calendar"
                      minimumDate={proposalMinDate}
                      onChange={handleProposalDateChange}
                    />
                  ) : null}

                  <Text style={styles.modalLabel}>Starttidspunkt</Text>
                  <Pressable
                    style={styles.modalDateButton}
                    onPress={() => handleOpenTimePicker('start')}
                  >
                    <Text style={styles.modalDateText}>
                      {formatClockLabel(proposalData.start)}
                    </Text>
                  </Pressable>
                  {!isIOS && showProposalStartTimePicker && (
                    <DateTimePicker
                      value={proposalData.start}
                      mode="time"
                      display={isIOS ? 'spinner' : 'clock'}
                      onChange={handleProposalStartTimeChange}
                    />
                  )}
                  {isIOS && showProposalStartTimePicker ? (
                    <View style={styles.inlineTimePicker}>
                      <DateTimePicker
                        value={proposalData.start}
                        mode="time"
                        display="spinner"
                        onChange={handleProposalStartTimeChange}
                        style={styles.inlineTimeSpinner}
                      />
                      <Pressable
                        onPress={() => setShowProposalStartTimePicker(false)}
                        style={styles.inlineTimePickerAction}
                        accessibilityRole="button"
                      >
                        <Text style={styles.inlineTimePickerClose}>Færdig</Text>
                      </Pressable>
                    </View>
                  ) : null}

                  <Text style={styles.modalLabel}>Sluttidspunkt</Text>
                  <Pressable
                    style={styles.modalDateButton}
                    onPress={() => handleOpenTimePicker('end')}
                  >
                    <Text style={styles.modalDateText}>
                      {formatClockLabel(proposalData.end)}
                    </Text>
                  </Pressable>
                  {!isIOS && showProposalEndTimePicker && (
                    <DateTimePicker
                      value={proposalData.end}
                      mode="time"
                      display={isIOS ? 'spinner' : 'clock'}
                      onChange={handleProposalEndTimeChange}
                    />
                  )}
                  {isIOS && showProposalEndTimePicker ? (
                    <View style={styles.inlineTimePicker}>
                      <DateTimePicker
                        value={proposalData.end}
                        mode="time"
                        display="spinner"
                        onChange={handleProposalEndTimeChange}
                        style={styles.inlineTimeSpinner}
                      />
                      <Pressable
                        onPress={() => setShowProposalEndTimePicker(false)}
                        style={styles.inlineTimePickerAction}
                        accessibilityRole="button"
                      >
                        <Text style={styles.inlineTimePickerClose}>Færdig</Text>
                      </Pressable>
                    </View>
                  ) : null}

                  <ErrorMessage message={proposalError} />

                  <Button
                    title="Send forslag"
                    onPress={handleSubmitProposal}
                    loading={proposalSaving}
                    style={styles.modalPrimaryButton}
                  />
                  <Button
                    title="Annuller"
                    onPress={closeProposalModal}
                    disabled={proposalSaving}
                    style={styles.modalSecondaryButton}
                  />
                </Pressable>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>
    </>
  );
};



export default OwnCalendarScreen;
