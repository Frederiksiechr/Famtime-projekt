/**
 * Utility helpers for finding mutual availability slots across multiple calendars.
 *
 * The algorithm works in five phases:
 * 1. Normalise input – busy ranges, preferences and time windows per user.
 * 2. Derive shared constraints (allowed weekdays, overlapping day windows, slot duration limits).
 * 3. Convert each user's busy list into free intervals within the planning horizon.
 * 4. Intersect all free interval lists to obtain common availability windows.
 * 5. Slice the common windows into concrete suggestion slots that respect min/max duration
 *    and `maxSuggestionDaysPerWeek`.
 *
 * All date math happens in UTC by default. If a `timeZone` is supplied we rely on
 * `Intl.DateTimeFormat` to fetch offsets for the target zone, so the environment must support it.
 */

const MS_PER_MINUTE = 60 * 1000;
const MINUTES_PER_DAY = 24 * 60;
const DEFAULT_LOOKAHEAD_DAYS = 14;
const DEFAULT_SLOT_MINUTES = 60;
const DEFAULT_TIME_ZONE = 'UTC';

const WEEKDAY_ORDER = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_KEY_SET = new Set(WEEKDAY_ORDER);
const NORMALIZED_WEEKDAY_MAP = new Map(
  [
    ['sunday', 'Sun'],
    ['sun', 'Sun'],
    ['mon', 'Mon'],
    ['monday', 'Mon'],
    ['tuesday', 'Tue'],
    ['tue', 'Tue'],
    ['wednesday', 'Wed'],
    ['wed', 'Wed'],
    ['thursday', 'Thu'],
    ['thu', 'Thu'],
    ['friday', 'Fri'],
    ['fri', 'Fri'],
    ['saturday', 'Sat'],
    ['sat', 'Sat'],
  ]
);

const clamp = (value, min, max) => {
  if (Number.isNaN(value) || value == null) {
    return min;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
};

const toDate = (value) => {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isNaN(millis) ? null : new Date(millis);
  }
  if (typeof value.toDate === 'function') {
    try {
      const converted = value.toDate();
      if (converted instanceof Date && !Number.isNaN(converted.getTime())) {
        return converted;
      }
    } catch (_error) {
      return null;
    }
  }
  if (typeof value === 'number' || typeof value === 'string') {
    const converted = new Date(value);
    if (!Number.isNaN(converted.getTime())) {
      return converted;
    }
  }
  return null;
};

const normalizeWeekdayKey = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (WEEKDAY_KEY_SET.has(trimmed)) {
    return trimmed;
  }
  const mapped = NORMALIZED_WEEKDAY_MAP.get(trimmed.toLowerCase());
  return mapped || null;
};

const normalizeWeekdayList = (values) => {
  if (!values) {
    return null;
  }

  const list = Array.isArray(values) ? values : [values];
  const normalized = list
    .map(normalizeWeekdayKey)
    .filter((item) => Boolean(item));

  if (!normalized.length) {
    return null;
  }

  return Array.from(new Set(normalized));
};

const intersectWeekdaySets = (base, next) => {
  if (!base || !base.length) {
    return next ? [...next] : [];
  }
  if (!next || !next.length) {
    return [...base];
  }
  const nextSet = new Set(next);
  return base.filter((day) => nextSet.has(day));
};

const parseTimeStringToMinutes = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parts = trimmed.split(':');
  if (parts.length < 2) {
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? numeric : null;
  }
  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }
  return hours * 60 + minutes;
};

const normalizeWindowEntry = (entry) => {
  if (!entry && entry !== 0) {
    return null;
  }

  if (typeof entry === 'string') {
    const tokens = entry.split('-');
    if (tokens.length !== 2) {
      return null;
    }
    const start = parseTimeStringToMinutes(tokens[0]);
    const end = parseTimeStringToMinutes(tokens[1]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return null;
    }
    return { start, end };
  }

  if (typeof entry === 'object') {
    const startRaw = entry.start ?? entry.begin ?? entry.from;
    const endRaw = entry.end ?? entry.finish ?? entry.to;
    const start = parseTimeStringToMinutes(startRaw);
    const end = parseTimeStringToMinutes(endRaw);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return null;
    }
    return { start, end };
  }

  return null;
};

const mergeMinuteIntervals = (intervals) => {
  if (!Array.isArray(intervals) || intervals.length === 0) {
    return [];
  }

  const sorted = [...intervals]
    .map((item) => ({ start: Math.max(0, item.start), end: Math.min(MINUTES_PER_DAY, item.end) }))
    .filter((item) => item.end > item.start)
    .sort((a, b) => a.start - b.start);

  if (!sorted.length) {
    return [];
  }

  const result = [sorted[0]];
  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i];
    const last = result[result.length - 1];
    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      result.push({ ...current });
    }
  }

  return result;
};

const normalizeTimeWindowDefinition = (definition, allowedDays) => {
  const base = new Map();
  const fullDay = [{ start: 0, end: MINUTES_PER_DAY }];

  allowedDays.forEach((day) => {
    base.set(day, fullDay);
  });

  if (!definition) {
    return base;
  }

  const applyEntries = (rawEntries) => {
    if (!rawEntries) {
      return null;
    }

    const list = Array.isArray(rawEntries) ? rawEntries : [rawEntries];
    const normalized = list
      .map(normalizeWindowEntry)
      .filter((entry) => Boolean(entry));

    if (!normalized.length) {
      return null;
    }

    return mergeMinuteIntervals(normalized);
  };

  const fallback = applyEntries(definition.default ?? null);
  allowedDays.forEach((day) => {
    const dayVariants = [day, day.toLowerCase(), day.slice(0, 3).toLowerCase()];
    let merged = null;
    for (const variant of dayVariants) {
      if (definition[variant]) {
        merged = applyEntries(definition[variant]);
        if (merged) {
          break;
        }
      }
    }

    if (!merged && Array.isArray(definition)) {
      merged = applyEntries(definition);
    }

    base.set(day, merged ?? fallback ?? fullDay);
  });

  return base;
};

const intersectMinuteIntervals = (listA, listB) => {
  if (!listA.length || !listB.length) {
    return [];
  }
  const result = [];
  let i = 0;
  let j = 0;
  while (i < listA.length && j < listB.length) {
    const a = listA[i];
    const b = listB[j];
    const start = Math.max(a.start, b.start);
    const end = Math.min(a.end, b.end);
    if (end > start) {
      result.push({ start, end });
    }
    if (a.end < b.end) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return result;
};

const intersectDayWindows = (baseWindows, nextWindows, allowedDays) => {
  const result = new Map();
  allowedDays.forEach((day) => {
    const base = baseWindows.get(day) ?? [];
    const next = nextWindows.get(day) ?? [];
    const intersection = intersectMinuteIntervals(base, next);
    if (intersection.length) {
      result.set(day, intersection);
    }
  });
  return result;
};

const sortAndMergeDateIntervals = (intervals) => {
  if (!Array.isArray(intervals) || !intervals.length) {
    return [];
  }

  const normalized = intervals
    .map((interval) => {
      const start = toDate(interval.start);
      const end = toDate(interval.end);
      if (!start || !end || end <= start) {
        return null;
      }
      return { start, end };
    })
    .filter((interval) => Boolean(interval))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  if (!normalized.length) {
    return [];
  }

  const merged = [normalized[0]];
  for (let i = 1; i < normalized.length; i += 1) {
    const current = normalized[i];
    const last = merged[merged.length - 1];
    if (current.start <= last.end) {
      if (current.end > last.end) {
        last.end = current.end;
      }
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
};

const clampIntervalToRange = (interval, rangeStart, rangeEnd) => {
  if (rangeStart >= rangeEnd) {
    return null;
  }
  const start = interval.start < rangeStart ? new Date(rangeStart) : interval.start;
  const end = interval.end > rangeEnd ? new Date(rangeEnd) : interval.end;
  return end > start ? { start, end } : null;
};

const expandIntervalWithBuffer = (interval, bufferBefore, bufferAfter) => {
  const beforeMs = Math.max(0, Math.floor(bufferBefore ?? 0)) * MS_PER_MINUTE;
  const afterMs = Math.max(0, Math.floor(bufferAfter ?? 0)) * MS_PER_MINUTE;
  return {
    start: new Date(interval.start.getTime() - beforeMs),
    end: new Date(interval.end.getTime() + afterMs),
  };
};

const invertBusyIntervals = (busyIntervals, rangeStart, rangeEnd) => {
  if (rangeStart >= rangeEnd) {
    return [];
  }

  if (!busyIntervals.length) {
    return [{ start: new Date(rangeStart), end: new Date(rangeEnd) }];
  }

  const free = [];
  let currentStart = new Date(rangeStart);

  for (const interval of busyIntervals) {
    if (interval.start > currentStart) {
      free.push({ start: new Date(currentStart), end: new Date(interval.start) });
    }
    if (interval.end > currentStart) {
      currentStart = new Date(interval.end);
    }
    if (currentStart >= rangeEnd) {
      break;
    }
  }

  if (currentStart < rangeEnd) {
    free.push({ start: new Date(currentStart), end: new Date(rangeEnd) });
  }

  return free;
};

const intersectDateIntervalLists = (listA, listB) => {
  if (!listA.length || !listB.length) {
    return [];
  }
  const result = [];
  let i = 0;
  let j = 0;
  while (i < listA.length && j < listB.length) {
    const a = listA[i];
    const b = listB[j];
    const start = a.start > b.start ? a.start : b.start;
    const end = a.end < b.end ? a.end : b.end;
    if (end > start) {
      result.push({ start, end });
    }
    if (a.end < b.end) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return result;
};

const addMinutes = (date, minutes) => new Date(date.getTime() + minutes * MS_PER_MINUTE);

const getTimeZoneFormatter = (() => {
  const cache = new Map();
  return (timeZone) => {
    if (!timeZone || timeZone === 'UTC') {
      return null;
    }
    if (!cache.has(timeZone)) {
      cache.set(
        timeZone,
        new Intl.DateTimeFormat('en-US', {
          timeZone,
          hour12: false,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          weekday: 'short',
        })
      );
    }
    return cache.get(timeZone);
  };
})();

const getZonedParts = (date, timeZone) => {
  if (!timeZone || timeZone === 'UTC') {
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      second: date.getUTCSeconds(),
      weekday: WEEKDAY_ORDER[date.getUTCDay()],
    };
  }

  const formatter = getTimeZoneFormatter(timeZone);
  const parts = formatter.formatToParts(date);
  const map = {};
  parts.forEach((part) => {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  });
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    weekday: map.weekday,
  };
};

const getTimeZoneOffset = (date, timeZone) => {
  if (!timeZone || timeZone === 'UTC') {
    return 0;
  }

  const formatter = getTimeZoneFormatter(timeZone);
  const parts = formatter.formatToParts(date);
  const map = {};
  parts.forEach((part) => {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  });

  const utcEquivalent = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second)
  );

  return utcEquivalent - date.getTime();
};

const makeZonedDate = ({ year, month, day, hour = 0, minute = 0, second = 0 }, timeZone) => {
  if (!timeZone || timeZone === 'UTC') {
    return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  }
  const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const offset = getTimeZoneOffset(utcDate, timeZone);
  return new Date(utcDate.getTime() - offset);
};

const startOfDayInTimeZone = (date, timeZone) => {
  const parts = getZonedParts(date, timeZone);
  return makeZonedDate({ year: parts.year, month: parts.month, day: parts.day }, timeZone);
};

const getIsoWeekKey = ({ year, month, day }) => {
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  const dayNumber = (utcDate.getUTCDay() || 7) - 1; // 0-6 Monday=0
  utcDate.setUTCDate(utcDate.getUTCDate() + 3 - dayNumber);
  const firstThursday = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 4));
  const weekNumber = Math.floor(1 + (utcDate - firstThursday) / (7 * 24 * 3600 * 1000));
  const isoYear = utcDate.getUTCFullYear();
  return `${isoYear}-W${String(weekNumber).padStart(2, '0')}`;
};

const buildDailyWindows = ({
  planningStart,
  planningEnd,
  allowedWindows,
  timeZone,
}) => {
  const results = [];
  if (planningEnd <= planningStart) {
    return results;
  }

  let cursor = startOfDayInTimeZone(new Date(planningStart), timeZone);

  while (cursor < planningEnd) {
    const parts = getZonedParts(cursor, timeZone);
    const dayKey = parts.weekday;
    const dayWindows = allowedWindows.get(dayKey) ?? [];
    if (dayWindows.length) {
      const dayUtcStart = cursor;
      const dayUtcEnd = addMinutes(dayUtcStart, MINUTES_PER_DAY);
      const windowCeilingStart = planningStart > dayUtcStart ? planningStart : dayUtcStart;
      const windowCeilingEnd = planningEnd < dayUtcEnd ? planningEnd : dayUtcEnd;

      dayWindows.forEach((window) => {
        const rawStart = addMinutes(dayUtcStart, window.start);
        const rawEnd = addMinutes(dayUtcStart, window.end);
        const clippedStart = rawStart < windowCeilingStart ? new Date(windowCeilingStart) : rawStart;
        const clippedEnd = rawEnd > windowCeilingEnd ? new Date(windowCeilingEnd) : rawEnd;
        if (clippedEnd > clippedStart) {
          results.push({
            start: clippedStart,
            end: clippedEnd,
            dayKey,
            weekKey: getIsoWeekKey(parts),
          });
        }
      });
    }
    cursor = addMinutes(cursor, MINUTES_PER_DAY);
  }

  return results.sort((a, b) => a.start.getTime() - b.start.getTime());
};

const intersectFreeWithWindows = (freeIntervals, windows) => {
  if (!freeIntervals.length || !windows.length) {
    return [];
  }
  const result = [];
  let i = 0;
  let j = 0;
  while (i < freeIntervals.length && j < windows.length) {
    const free = freeIntervals[i];
    const window = windows[j];
    const start = free.start > window.start ? free.start : window.start;
    const end = free.end < window.end ? free.end : window.end;
    if (end > start) {
      result.push({ start, end, dayKey: window.dayKey, weekKey: window.weekKey });
    }
    if (free.end < window.end) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return result;
};

const generateSlotsFromInterval = (interval, constraints) => {
  const {
    minDurationMinutes,
    maxDurationMinutes,
    preferredDurationMinutes,
    stepMinutes,
  } = constraints;

  const durationMinutes = Math.floor((interval.end.getTime() - interval.start.getTime()) / MS_PER_MINUTE);
  const minDuration = Math.max(1, Math.floor(minDurationMinutes ?? 1));
  const maxDuration = Math.floor(maxDurationMinutes ?? durationMinutes);

  if (maxDuration < minDuration || durationMinutes < minDuration) {
    return [];
  }

  const preferred = preferredDurationMinutes ?? DEFAULT_SLOT_MINUTES;
  let slotLength = Math.floor(preferred);
  if (!Number.isFinite(slotLength) || slotLength <= 0) {
    slotLength = DEFAULT_SLOT_MINUTES;
  }
  slotLength = clamp(slotLength, minDuration, Math.min(maxDuration, durationMinutes));

  const stride = Math.max(1, Math.floor(stepMinutes ?? slotLength));
  const strideMs = stride * MS_PER_MINUTE;
  const slotMs = slotLength * MS_PER_MINUTE;

  const results = [];
  let cursor = interval.start.getTime();
  const endMs = interval.end.getTime();

  while (cursor < endMs) {
    let next = cursor + slotMs;
    if (next > endMs) {
      const remaining = endMs - cursor;
      if (remaining >= minDuration * MS_PER_MINUTE && remaining <= maxDuration * MS_PER_MINUTE) {
        next = endMs;
      } else {
        break;
      }
    }
    const actualDuration = next - cursor;
    if (actualDuration < minDuration * MS_PER_MINUTE || actualDuration > maxDuration * MS_PER_MINUTE) {
      break;
    }
    results.push({
      start: new Date(cursor),
      end: new Date(next),
      dayKey: interval.dayKey,
      weekKey: interval.weekKey,
    });
    cursor += strideMs;
    if (endMs - cursor < minDuration * MS_PER_MINUTE) {
      break;
    }
  }

  return results;
};

const limitSlotsByWeekdayQuota = (slots, maxDaysPerWeek) => {
  if (!Number.isFinite(maxDaysPerWeek) || maxDaysPerWeek <= 0 || maxDaysPerWeek >= 7) {
    return slots;
  }
  const quota = new Map();
  const result = [];
  slots.forEach((slot) => {
    const weekKey = slot.weekKey;
    const dayKey = slot.dayKey;
    if (!weekKey || !dayKey) {
      result.push(slot);
      return;
    }
    if (!quota.has(weekKey)) {
      quota.set(weekKey, new Set());
    }
    const usedDays = quota.get(weekKey);
    if (usedDays.has(dayKey) || usedDays.size < maxDaysPerWeek) {
      result.push(slot);
      usedDays.add(dayKey);
    }
  });
  return result;
};

const extractPreferencesFromEntry = (entry = {}, fallback = {}) => {
  const source = entry.preferences ?? entry;
  const group = fallback || {};
  const toNumber = (value) => (Number.isFinite(value) ? value : null);

  return {
    allowedWeekdays:
      normalizeWeekdayList(source.allowedWeekdays ?? source.allowedDays ?? group.allowedWeekdays) ??
      null,
    timeWindows: source.timeWindows ?? group.timeWindows ?? null,
    minDurationMinutes: toNumber(source.minDurationMinutes ?? group.minDurationMinutes ?? null),
    maxDurationMinutes: toNumber(source.maxDurationMinutes ?? group.maxDurationMinutes ?? null),
    bufferBeforeMinutes: toNumber(source.bufferBeforeMinutes ?? group.bufferBeforeMinutes ?? null),
    bufferAfterMinutes: toNumber(source.bufferAfterMinutes ?? group.bufferAfterMinutes ?? null),
    timeZone: source.timeZone ?? group.timeZone ?? null,
    maxSuggestionDaysPerWeek: toNumber(
      source.maxSuggestionDaysPerWeek ?? group.maxSuggestionDaysPerWeek ?? null
    ),
    preferredDurationMinutes: toNumber(
      source.preferredDurationMinutes ?? group.preferredDurationMinutes ?? null
    ),
    slotStepMinutes: toNumber(source.slotStepMinutes ?? group.slotStepMinutes ?? null),
  };
};

const normalizeCalendarInput = (calendar, { rangeStart, rangeEnd }) => {
  if (!calendar || !calendar.userId) {
    return null;
  }
  const busyInput = Array.isArray(calendar.busy)
    ? calendar.busy
    : Array.isArray(calendar.busyIntervals)
    ? calendar.busyIntervals
    : [];

  const mergedBusy = sortAndMergeDateIntervals(busyInput)
    .map((interval) => expandIntervalWithBuffer(interval, calendar.bufferBeforeMinutes, calendar.bufferAfterMinutes))
    .map((interval) => clampIntervalToRange(interval, rangeStart, rangeEnd))
    .filter((interval) => Boolean(interval));

  const normalized = sortAndMergeDateIntervals(mergedBusy);

  return {
    userId: calendar.userId,
    busy: normalized,
    preferences: calendar.preferences ?? {},
  };
};

const deriveGroupConstraints = ({
  calendars,
  groupPreferences,
  userPreferences,
  planningStart,
  planningEnd,
}) => {
  let allowedWeekdays =
    normalizeWeekdayList(groupPreferences.allowedWeekdays) ?? [...WEEKDAY_ORDER.slice(1), WEEKDAY_ORDER[0]];

  let mergedWindows = normalizeTimeWindowDefinition(groupPreferences.timeWindows, allowedWeekdays);

  let minDuration = Number.isFinite(groupPreferences.minDurationMinutes)
    ? groupPreferences.minDurationMinutes
    : 0;
  let maxDuration = Number.isFinite(groupPreferences.maxDurationMinutes)
    ? groupPreferences.maxDurationMinutes
    : null;
  let preferredDuration = Number.isFinite(groupPreferences.preferredDurationMinutes)
    ? groupPreferences.preferredDurationMinutes
    : null;
  let slotStepMinutes = Number.isFinite(groupPreferences.slotStepMinutes)
    ? groupPreferences.slotStepMinutes
    : null;
  let maxSuggestionDaysPerWeek = Number.isFinite(groupPreferences.maxSuggestionDaysPerWeek)
    ? groupPreferences.maxSuggestionDaysPerWeek
    : null;

  let resolvedTimeZone = groupPreferences.timeZone ?? DEFAULT_TIME_ZONE;

  calendars.forEach((calendar) => {
    const userPref = extractPreferencesFromEntry(
      userPreferences?.[calendar.userId] ?? calendar.preferences,
      groupPreferences
    );

    const normalizedDays = normalizeWeekdayList(userPref.allowedWeekdays);
    if (normalizedDays && normalizedDays.length) {
      allowedWeekdays = intersectWeekdaySets(allowedWeekdays, normalizedDays);
    }

    const dayWindows = normalizeTimeWindowDefinition(userPref.timeWindows, allowedWeekdays);
    mergedWindows = intersectDayWindows(mergedWindows, dayWindows, allowedWeekdays);

    if (Number.isFinite(userPref.minDurationMinutes)) {
      minDuration = Math.max(minDuration, userPref.minDurationMinutes);
    }
    if (Number.isFinite(userPref.maxDurationMinutes)) {
      maxDuration = Number.isFinite(maxDuration)
        ? Math.min(maxDuration, userPref.maxDurationMinutes)
        : userPref.maxDurationMinutes;
    }
    if (Number.isFinite(userPref.preferredDurationMinutes)) {
      preferredDuration = preferredDuration
        ? Math.min(preferredDuration, userPref.preferredDurationMinutes)
        : userPref.preferredDurationMinutes;
    }
    if (Number.isFinite(userPref.slotStepMinutes)) {
      slotStepMinutes = slotStepMinutes
        ? Math.min(slotStepMinutes, userPref.slotStepMinutes)
        : userPref.slotStepMinutes;
    }
    if (Number.isFinite(userPref.maxSuggestionDaysPerWeek)) {
      maxSuggestionDaysPerWeek = maxSuggestionDaysPerWeek
        ? Math.min(maxSuggestionDaysPerWeek, userPref.maxSuggestionDaysPerWeek)
        : userPref.maxSuggestionDaysPerWeek;
    }
    if (userPref.timeZone && resolvedTimeZone === DEFAULT_TIME_ZONE) {
      resolvedTimeZone = userPref.timeZone;
    }
  });

  if (!allowedWeekdays.length) {
    return null;
  }

  const allowedWindows = new Map();
  allowedWeekdays.forEach((day) => {
    const windows = mergedWindows.get(day) ?? [];
    if (windows.length) {
      allowedWindows.set(day, windows);
    }
  });

  if (!allowedWindows.size) {
    return null;
  }

  const constraints = {
    allowedWeekdays,
    allowedWindows,
    minDurationMinutes: minDuration,
    maxDurationMinutes: maxDuration ?? undefined,
    preferredDurationMinutes: preferredDuration ?? undefined,
    slotStepMinutes,
    maxSuggestionDaysPerWeek,
    timeZone: resolvedTimeZone,
    planningStart,
    planningEnd,
  };

  return constraints;
};

export const findMutualAvailability = ({
  calendars = [],
  periodStart,
  periodEnd,
  groupPreferences = {},
  userPreferences = {},
  globalBusyIntervals = [],
  maxSuggestions = 12,
  defaultSlotDurationMinutes = DEFAULT_SLOT_MINUTES,
} = {}) => {
  const planningStart = periodStart instanceof Date && !Number.isNaN(periodStart.getTime())
    ? new Date(periodStart)
    : new Date();
  const planningEnd = periodEnd instanceof Date && !Number.isNaN(periodEnd.getTime())
    ? new Date(periodEnd)
    : addMinutes(planningStart, DEFAULT_LOOKAHEAD_DAYS * MINUTES_PER_DAY);

  if (planningEnd <= planningStart) {
    return { slots: [], constraints: null };
  }

  const normalizedCalendars = calendars
    .map((calendar) => normalizeCalendarInput(calendar, { rangeStart: planningStart, rangeEnd: planningEnd }))
    .filter((calendar) => Boolean(calendar))
    .map((calendar) => {
      const entryPref = extractPreferencesFromEntry(
        userPreferences?.[calendar.userId] ?? calendar.preferences,
        groupPreferences
      );
      return {
        ...calendar,
        preferences: {
          ...entryPref,
          bufferBeforeMinutes: entryPref.bufferBeforeMinutes ?? groupPreferences.bufferBeforeMinutes ?? 0,
          bufferAfterMinutes: entryPref.bufferAfterMinutes ?? groupPreferences.bufferAfterMinutes ?? 0,
        },
      };
    });

  const injectedCalendars = normalizedCalendars.map((calendar) => {
    const bufferedBusy = calendar.busy.map((interval) =>
      expandIntervalWithBuffer(interval, calendar.preferences.bufferBeforeMinutes, calendar.preferences.bufferAfterMinutes)
    );
    const clampedBusy = sortAndMergeDateIntervals(
      bufferedBusy
        .map((interval) => clampIntervalToRange(interval, planningStart, planningEnd))
        .filter((interval) => Boolean(interval))
    );
    return {
      ...calendar,
      busy: clampedBusy,
    };
  });

  const auxBusy = sortAndMergeDateIntervals(globalBusyIntervals)
    .map((interval) => clampIntervalToRange(interval, planningStart, planningEnd))
    .filter((interval) => Boolean(interval));

  if (auxBusy.length) {
    injectedCalendars.push({
      userId: '__group__',
      busy: auxBusy,
      preferences: {},
    });
  }

  const constraints = deriveGroupConstraints({
    calendars: injectedCalendars,
    groupPreferences: {
      ...groupPreferences,
      preferredDurationMinutes: groupPreferences.preferredDurationMinutes ?? defaultSlotDurationMinutes,
    },
    userPreferences,
    planningStart,
    planningEnd,
  });

  if (!constraints) {
    return { slots: [], constraints: null };
  }

  const freeIntervalSets = injectedCalendars.map((calendar) => {
    if (!calendar.busy.length) {
      return [{ start: new Date(planningStart), end: new Date(planningEnd) }];
    }
    return invertBusyIntervals(calendar.busy, planningStart, planningEnd);
  });

  let commonFree = freeIntervalSets.length ? freeIntervalSets[0] : [{ start: new Date(planningStart), end: new Date(planningEnd) }];
  for (let i = 1; i < freeIntervalSets.length && commonFree.length; i += 1) {
    commonFree = intersectDateIntervalLists(commonFree, freeIntervalSets[i]);
  }

  if (!commonFree.length) {
    return { slots: [], constraints };
  }

  const windows = buildDailyWindows({
    planningStart,
    planningEnd,
    allowedWindows: constraints.allowedWindows,
    timeZone: constraints.timeZone,
  });

  if (!windows.length) {
    return { slots: [], constraints };
  }

  const eligibleIntervals = intersectFreeWithWindows(commonFree, windows);
  if (!eligibleIntervals.length) {
    return { slots: [], constraints };
  }

  const slotConstraints = {
    minDurationMinutes: constraints.minDurationMinutes,
    maxDurationMinutes: constraints.maxDurationMinutes,
    preferredDurationMinutes: constraints.preferredDurationMinutes ?? defaultSlotDurationMinutes,
    stepMinutes: constraints.slotStepMinutes,
  };

  const slots = eligibleIntervals
    .flatMap((interval) => generateSlotsFromInterval(interval, slotConstraints))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  if (!slots.length) {
    return { slots: [], constraints };
  }

  const limitedByWeek = limitSlotsByWeekdayQuota(slots, constraints.maxSuggestionDaysPerWeek);

  const finalSlots = limitedByWeek.slice(0, Math.max(1, Math.floor(maxSuggestions ?? 1)));

  return {
    slots: finalSlots,
    constraints,
  };
};

export const availabilityUtils = {
  toDate,
  normalizeWeekdayKey,
  normalizeWeekdayList,
  parseTimeStringToMinutes,
};

export default findMutualAvailability;
