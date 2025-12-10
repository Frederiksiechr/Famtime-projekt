import { availabilityUtils } from '../lib/availability';

/**
 * Shared helpers for availability/busy calculations across screens.
 */

export const mergeBusyIntervals = (primary = [], secondary = []) => {
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

export const applyIntervalTravelBuffer = (intervals = [], bufferMinutes = 0) => {
  const normalized = Array.isArray(intervals) ? intervals : [];
  const bufferMs = Math.max(0, Math.floor(bufferMinutes ?? 0)) * 60 * 1000;

  return normalized.map((interval) => ({
    start: new Date(interval.start.getTime() - bufferMs),
    end: new Date(interval.end.getTime() + bufferMs),
  }));
};

export const buildEventBusyIntervals = (events = []) => {
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

export const normalizeBusyPayload = (input) => {
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

export const extractPreferencesFromCalendarDoc = (data) => {
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

export const areBusyListsEqual = (first = [], second = []) => {
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

export const shallowEqualObjects = (a = {}, b = {}) => {
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
