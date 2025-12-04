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
const DANISH_TIME_ZONE = 'Europe/Copenhagen';
const SLOT_ALIGN_MINUTES = 15;
const QUIET_START_MINUTES = 6 * 60; // 06:00
const DEFAULT_WEEKDAY_WINDOW = [{ start: 16 * 60, end: 23 * 60 + 59 }];
const DEFAULT_WEEKEND_WINDOW = [{ start: 10 * 60, end: 23 * 60 + 59 }];
const WORK_DAY_SET = new Set(['Mon', 'Tue', 'Wed', 'Thu']);
const WEEKEND_DAY_SET = new Set(['Fri', 'Sat', 'Sun']);
const MAX_WEEKDAY_DURATION_MINUTES = 180;
const MIN_WEEKEND_DURATION_MINUTES = 120;

const WEEKDAY_ORDER = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_KEY_SET = new Set(WEEKDAY_ORDER);
const NORMALIZED_WEEKDAY_MAP = new Map(
  [
    ['sunday', 'Sun'],
    ['sun', 'Sun'],
    ['mon', 'Mon'],
    ['monday', 'Mon'],
    ['mandag', 'Mon'],
    ['tuesday', 'Tue'],
    ['tue', 'Tue'],
    ['tirsdag', 'Tue'],
    ['wednesday', 'Wed'],
    ['wed', 'Wed'],
    ['onsdag', 'Wed'],
    ['thursday', 'Thu'],
    ['thu', 'Thu'],
    ['torsdag', 'Thu'],
    ['friday', 'Fri'],
    ['fri', 'Fri'],
    ['fredag', 'Fri'],
    ['saturday', 'Sat'],
    ['sat', 'Sat'],
    ['l\u00f8rdag', 'Sat'],
    ['lordag', 'Sat'],
    ['s\u00f8ndag', 'Sun'],
    ['sondag', 'Sun'],
  ]
);

const cloneWindows = (windows = []) =>
  windows.map((window) => ({ start: window.start, end: window.end }));

const getDefaultWindowsForDayKey = (dayKey) => {
  const template = WEEKEND_DAY_SET.has(dayKey) ? DEFAULT_WEEKEND_WINDOW : DEFAULT_WEEKDAY_WINDOW;
  return cloneWindows(template);
};

const clampWindowsToQuietHours = (windows = []) =>
  windows
    .map((window) => {
      const start = Math.max(QUIET_START_MINUTES, window.start);
      const end = Math.min(MINUTES_PER_DAY, window.end);
      if (end <= start) {
        return null;
      }
      return { start, end };
    })
    .filter((window) => Boolean(window));

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

const normalizeWindowListEntries = (entries) => {
  if (!entries && entries !== 0) {
    return [];
  }

  const list = Array.isArray(entries) ? entries : [entries];
  const normalized = list
    .map((entry) => {
      if (entry && typeof entry.start === 'number' && typeof entry.end === 'number') {
        return { start: entry.start, end: entry.end };
      }
      return normalizeWindowEntry(entry);
    })
    .filter((entry) => Boolean(entry));

  if (!normalized.length) {
    return [];
  }

  return clampWindowsToQuietHours(mergeMinuteIntervals(normalized));
};

const collectExplicitTimeWindows = (definition, allowedDays) => {
  const map = new Map();
  if (!definition) {
    return map;
  }

  const allowedSet = Array.isArray(allowedDays) && allowedDays.length ? new Set(allowedDays) : null;
  const allowedDayList = allowedSet ? Array.from(allowedSet) : WEEKDAY_ORDER;

  const storeNormalizedEntries = (dayKey, windows) => {
    if (!dayKey || (allowedSet && !allowedSet.has(dayKey)) || !windows || !windows.length) {
      return;
    }
    const existing = map.get(dayKey) ?? [];
    map.set(dayKey, mergeMinuteIntervals(existing.concat(windows)));
  };

  if (Array.isArray(definition)) {
    const normalized = normalizeWindowListEntries(definition);
    if (normalized.length) {
      allowedDayList.forEach((dayKey) => {
        storeNormalizedEntries(dayKey, normalized);
      });
    }
    return map;
  }

  if (typeof definition !== 'object') {
    return map;
  }

  if (definition.default) {
    const normalizedDefault = normalizeWindowListEntries(definition.default);
    if (normalizedDefault.length) {
      allowedDayList.forEach((dayKey) => {
        if (!map.has(dayKey)) {
          map.set(dayKey, normalizedDefault);
        }
      });
    }
  }

  Object.keys(definition).forEach((key) => {
    if (key === 'default') {
      return;
    }
    const dayKey = normalizeWeekdayKey(key);
    if (!dayKey) {
      return;
    }
    const windows = normalizeWindowListEntries(definition[key]);
    storeNormalizedEntries(dayKey, windows);
  });

  return map;
};

const normalizeTimeWindowDefinition = (definition, allowedDays) => {
  const base = new Map();

  allowedDays.forEach((day) => {
    base.set(day, clampWindowsToQuietHours(getDefaultWindowsForDayKey(day)));
  });

  if (!definition) {
    return base;
  }

  const normalizedKeyEntries = new Map();
  if (typeof definition === 'object') {
    Object.keys(definition).forEach((key) => {
      if (key === 'default') {
        return;
      }
      const normalizedKey = normalizeWeekdayKey(key);
      if (!normalizedKey) {
        return;
      }
      const existing = normalizedKeyEntries.get(normalizedKey) ?? [];
      const value = definition[key];
      if (Array.isArray(value)) {
        normalizedKeyEntries.set(normalizedKey, existing.concat(value));
      } else {
        existing.push(value);
        normalizedKeyEntries.set(normalizedKey, existing);
      }
    });
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

    const merged = mergeMinuteIntervals(normalized);
    const clamped = clampWindowsToQuietHours(merged);
    return clamped.length ? clamped : null;
  };

  const fallback = applyEntries(definition.default ?? null);
  allowedDays.forEach((day) => {
    let merged = null;
    if (normalizedKeyEntries.has(day)) {
      merged = applyEntries(normalizedKeyEntries.get(day));
    }
    const dayVariants = [day, day.toLowerCase(), day.slice(0, 3).toLowerCase()];
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

    const resolved =
      (merged && merged.length && merged) ||
      (fallback && fallback.length && fallback) ||
      clampWindowsToQuietHours(getDefaultWindowsForDayKey(day));
    base.set(day, resolved.length ? resolved : clampWindowsToQuietHours(getDefaultWindowsForDayKey(day)));
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

const getDayIdFromParts = (parts) =>
  `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}-${parts.weekday}`;

const isSameDayParts = (a, b) =>
  a.year === b.year && a.month === b.month && a.day === b.day;

const makeDeterministicSeed = (...parts) => {
  const input = parts
    .filter((part) => part !== undefined && part !== null)
    .map((part) => String(part))
    .join('|');
  if (!input.length) {
    return 1;
  }
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0; // 32bit
  }
  return hash >>> 0;
};

const createSeededRng = (...seedParts) => {
  let seed = makeDeterministicSeed(...seedParts);
  return () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const shuffleArray = (array, rng) => {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
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
    const dayId = getDayIdFromParts(parts);
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
            dayId,
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
      result.push({ start, end, dayKey: window.dayKey, weekKey: window.weekKey, dayId: window.dayId });
    }
    if (free.end < window.end) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return result;
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

const buildDayDurationOptions = (dayKey, minDuration, maxDuration) => {
  const baseMin = Math.max(15, Math.floor(minDuration ?? DEFAULT_SLOT_MINUTES));
  const baseMax = Math.max(baseMin, Math.floor(maxDuration ?? baseMin));
  let dayMin = baseMin;
  let dayMax = baseMax;

  if (WORK_DAY_SET.has(dayKey)) {
    dayMax = Math.min(dayMax, Math.max(dayMin, MAX_WEEKDAY_DURATION_MINUTES));
  } else if (WEEKEND_DAY_SET.has(dayKey)) {
    dayMin = Math.max(dayMin, Math.min(dayMax, MIN_WEEKEND_DURATION_MINUTES));
  }

  if (dayMin > dayMax) {
    dayMin = dayMax;
  }

  const alignDuration = (value) => {
    if (!Number.isFinite(value)) {
      return null;
    }
    const aligned = Math.round(value / SLOT_ALIGN_MINUTES) * SLOT_ALIGN_MINUTES;
    const clamped = clamp(aligned, dayMin, dayMax);
    return clamped >= dayMin && clamped <= dayMax ? clamped : null;
  };

  const mid = alignDuration((dayMin + dayMax) / 2);
  const nearMin = alignDuration((dayMin + (mid ?? dayMin)) / 2);
  const nearMax = alignDuration(((mid ?? dayMax) + dayMax) / 2);

  const options = [dayMin, mid, dayMax, nearMin, nearMax]
    .filter((value) => Number.isFinite(value) && value > 0);

  return Array.from(new Set(options)).sort((a, b) => a - b);
};

const STEP_MS = SLOT_ALIGN_MINUTES * MS_PER_MINUTE;

const alignForward = (ms) => Math.ceil(ms / STEP_MS) * STEP_MS;

const alignBackward = (ms) => Math.floor(ms / STEP_MS) * STEP_MS;

const alignNearest = (ms) => Math.round(ms / STEP_MS) * STEP_MS;

const placeSlotInIntervals = (intervals, durationMinutes, bias) => {
  if (!intervals.length || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return null;
  }

  const durationMs = durationMinutes * MS_PER_MINUTE;
  const eligible = intervals.filter(
    (interval) => interval.end.getTime() - interval.start.getTime() >= durationMs
  );

  if (!eligible.length) {
    return null;
  }

  if (bias === 'middle') {
    const sorted = [...eligible].sort(
      (a, b) => b.end.getTime() - b.start.getTime() - (a.end.getTime() - a.start.getTime())
    );
    for (const interval of sorted) {
      const length = interval.end.getTime() - interval.start.getTime();
      const offset = (length - durationMs) / 2;
      const candidateStart = alignNearest(interval.start.getTime() + offset);
      const start = Math.max(candidateStart, interval.start.getTime());
      const end = start + durationMs;
      if (end <= interval.end.getTime()) {
        return { start: new Date(start), end: new Date(end), sourceInterval: interval };
      }
    }
    return null;
  }

  if (bias === 'end') {
    for (let index = eligible.length - 1; index >= 0; index -= 1) {
      const interval = eligible[index];
      const candidateStart = alignBackward(interval.end.getTime() - durationMs);
      if (candidateStart < interval.start.getTime()) {
        continue;
      }
      const end = candidateStart + durationMs;
      if (end <= interval.end.getTime()) {
        return {
          start: new Date(candidateStart),
          end: new Date(end),
          sourceInterval: interval,
        };
      }
    }
    return null;
  }

  for (const interval of eligible) {
    const candidateStart = alignForward(interval.start.getTime());
    const end = candidateStart + durationMs;
    if (end <= interval.end.getTime()) {
      return { start: new Date(candidateStart), end: new Date(end), sourceInterval: interval };
    }
  }

  return null;
};

const groupIntervalsByDay = (intervals = []) => {
  const map = new Map();
  intervals.forEach((interval) => {
    const dayId =
      interval.dayId ??
      `${interval.dayKey}-${new Date(interval.start).toISOString().slice(0, 10)}`;
    if (!map.has(dayId)) {
      map.set(dayId, {
        dayId,
        dayKey: interval.dayKey,
        weekKey: interval.weekKey,
        intervals: [],
      });
    }
    map.get(dayId).intervals.push(interval);
  });

  map.forEach((entry) => {
    entry.intervals.sort((a, b) => a.start.getTime() - b.start.getTime());
  });

  return Array.from(map.values()).sort(
    (a, b) => a.intervals[0].start.getTime() - b.intervals[0].start.getTime()
  );
};

const generateDaySlots = (groupEntry, constraints, seedKey) => {
  const durationOptions = buildDayDurationOptions(
    groupEntry.dayKey,
    constraints.minDurationMinutes,
    constraints.maxDurationMinutes
  );
  if (!durationOptions.length) {
    return [];
  }

  const rng = createSeededRng(seedKey, groupEntry.dayId, groupEntry.weekKey);
  const isWeekend = WEEKEND_DAY_SET.has(groupEntry.dayKey);

  let slotsForDay = isWeekend ? 2 : 1;
  slotsForDay = Math.min(slotsForDay, durationOptions.length);

  const shuffledDurations = shuffleArray([...durationOptions], rng);
  const biasPool = shuffleArray(['start', 'middle', 'end'], rng);
  const slots = [];
  const used = new Set();

  while (shuffledDurations.length && slots.length < slotsForDay) {
    const duration = shuffledDurations.shift();
    const bias = biasPool[slots.length % biasPool.length] ?? 'start';
    const slot = placeSlotInIntervals(groupEntry.intervals, duration, bias);
    if (!slot) {
      continue;
    }
    const key = `${slot.start.getTime()}-${slot.end.getTime()}`;
    if (used.has(key)) {
      continue;
    }
    used.add(key);
    slots.push({
      start: slot.start,
      end: slot.end,
      dayKey: groupEntry.dayKey,
      weekKey: groupEntry.weekKey,
      dayId: groupEntry.dayId,
      durationMinutes: duration,
    });
  }

  return slots;
};

const generateCandidateSlots = (intervals, constraints, targetTotal, seedKey, planningStart) => {
  const groups = groupIntervalsByDay(intervals);

  const bundles = groups
    .map((group) => ({
      group,
      slots: generateDaySlots(group, constraints, seedKey),
    }))
    .filter((bundle) => bundle.slots.length)
    .sort((a, b) => a.slots[0].start.getTime() - b.slots[0].start.getTime());

  let totalSlots = bundles.reduce((sum, bundle) => sum + bundle.slots.length, 0);

  if (!totalSlots) {
    return [];
  }

  const removedBundles = [];

  if (totalSlots > targetTotal && bundles.length > 1) {
    const rng = createSeededRng(seedKey, planningStart?.toISOString?.() ?? '', targetTotal);
    while (totalSlots > targetTotal && bundles.length > 1) {
      const weekendIndexes = bundles
        .map((bundle, index) => ({ index, bundle }))
        .filter(({ bundle }) => WEEKEND_DAY_SET.has(bundle.group.dayKey));
      const weekdayIndexes = bundles
        .map((bundle, index) => ({ index, bundle }))
        .filter(({ bundle }) => WORK_DAY_SET.has(bundle.group.dayKey));

      let dropIndex = -1;
      if (weekendIndexes.length) {
        const pick = weekendIndexes[Math.floor(rng() * weekendIndexes.length)];
        dropIndex = pick.index;
      } else if (weekdayIndexes.length > 1) {
        const pick = weekdayIndexes[weekdayIndexes.length - 1];
        dropIndex = pick.index;
      } else {
        dropIndex = Math.floor(rng() * bundles.length);
      }

      const [removed] = bundles.splice(dropIndex, 1);
      removedBundles.push(removed);
      totalSlots -= removed.slots.length;
    }
  }

  const hasWeekdayInBundles = bundles.some((bundle) => WORK_DAY_SET.has(bundle.group.dayKey));
  const removedWeekday = removedBundles
    .filter((bundle) => WORK_DAY_SET.has(bundle.group.dayKey))
    .sort((a, b) => a.slots[0].start.getTime() - b.slots[0].start.getTime())[0];

  if (!hasWeekdayInBundles && removedWeekday) {
    const weekendIndex = bundles.findIndex((bundle) => WEEKEND_DAY_SET.has(bundle.group.dayKey));
    if (weekendIndex >= 0) {
      removedBundles.push(bundles[weekendIndex]);
      bundles.splice(weekendIndex, 1, removedWeekday);
    } else if (bundles.length < targetTotal) {
      bundles.push(removedWeekday);
    }
  }

  const flattened = bundles
    .flatMap((bundle) => bundle.slots)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  return flattened.slice(0, targetTotal);
};

const filterSlotsBySameDayRules = (slots, referenceParts, timeZone) => {
  if (!referenceParts || !slots.length) {
    return slots;
  }
  const referenceHour = referenceParts.hour ?? 0;

  return slots.filter((slot) => {
    const slotParts = getZonedParts(slot.start, timeZone);
    if (!isSameDayParts(slotParts, referenceParts)) {
      return true;
    }
    if (referenceHour >= 12) {
      return false;
    }
    return (slotParts.hour ?? 0) >= 17;
  });
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
  defaultSlotDurationMinutes = DEFAULT_SLOT_MINUTES,
  seedKey = '',
}) => {
  let allowedWeekdays =
    normalizeWeekdayList(groupPreferences.allowedWeekdays) ?? [...WEEKDAY_ORDER.slice(1), WEEKDAY_ORDER[0]];

  let mergedWindows = normalizeTimeWindowDefinition(groupPreferences.timeWindows, allowedWeekdays);
  const weekdayFallbackWindows = new Map();

  let minDuration = Number.isFinite(groupPreferences.minDurationMinutes)
    ? groupPreferences.minDurationMinutes
    : defaultSlotDurationMinutes;
  let maxDuration = Number.isFinite(groupPreferences.maxDurationMinutes)
    ? Math.max(groupPreferences.maxDurationMinutes, minDuration)
    : Math.max(minDuration, defaultSlotDurationMinutes * 4);
  let preferredDuration = Number.isFinite(groupPreferences.preferredDurationMinutes)
    ? groupPreferences.preferredDurationMinutes
    : defaultSlotDurationMinutes;
  let slotStepMinutes = Number.isFinite(groupPreferences.slotStepMinutes)
    ? Math.max(SLOT_ALIGN_MINUTES, groupPreferences.slotStepMinutes)
    : SLOT_ALIGN_MINUTES;
  let maxSuggestionDaysPerWeek = Number.isFinite(groupPreferences.maxSuggestionDaysPerWeek)
    ? groupPreferences.maxSuggestionDaysPerWeek
    : null;

  let resolvedTimeZone = groupPreferences.timeZone ?? DANISH_TIME_ZONE;
  const hasExplicitGroupTimeZone = Boolean(groupPreferences.timeZone);

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

    if (userPref.timeWindows) {
      const explicitDayScope = normalizedDays && normalizedDays.length ? normalizedDays : allowedWeekdays;
      const explicitMap = collectExplicitTimeWindows(userPref.timeWindows, explicitDayScope);
      explicitMap.forEach((windows, dayKey) => {
        if (!WORK_DAY_SET.has(dayKey) || !windows.length) {
          return;
        }
        const existing = weekdayFallbackWindows.get(dayKey) ?? [];
        weekdayFallbackWindows.set(dayKey, mergeMinuteIntervals(existing.concat(windows)));
      });
    }

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
      const normalizedStep = Math.max(SLOT_ALIGN_MINUTES, userPref.slotStepMinutes);
      slotStepMinutes = slotStepMinutes
        ? Math.min(slotStepMinutes, normalizedStep)
        : normalizedStep;
    }
    if (Number.isFinite(userPref.maxSuggestionDaysPerWeek)) {
      maxSuggestionDaysPerWeek = maxSuggestionDaysPerWeek
        ? Math.min(maxSuggestionDaysPerWeek, userPref.maxSuggestionDaysPerWeek)
        : userPref.maxSuggestionDaysPerWeek;
    }
    if (userPref.timeZone && !hasExplicitGroupTimeZone && resolvedTimeZone === DANISH_TIME_ZONE) {
      resolvedTimeZone = userPref.timeZone;
    }
  });

  if (!allowedWeekdays.length) {
    return null;
  }

  const allowedWeekdaySet = new Set(allowedWeekdays);
  Array.from(weekdayFallbackWindows.keys()).forEach((dayKey) => {
    if (!allowedWeekdaySet.has(dayKey)) {
      weekdayFallbackWindows.delete(dayKey);
    }
  });

  minDuration = Math.max(15, Math.floor(minDuration));
  maxDuration = Math.max(minDuration, Math.floor(maxDuration ?? minDuration));
  preferredDuration = clamp(
    Math.floor(preferredDuration ?? minDuration),
    minDuration,
    maxDuration
  );

  const allowedWindows = new Map();
  allowedWeekdays.forEach((day) => {
    const windows = mergedWindows.get(day) ?? [];
    if (windows.length) {
      allowedWindows.set(day, windows);
    }
  });

  let injectedWeekdayDays = [];
  const hasWeekendOnlyWindows = !Array.from(allowedWindows.entries()).some(
    ([dayKey, windows]) => WORK_DAY_SET.has(dayKey) && windows && windows.length
  );

  if (hasWeekendOnlyWindows && weekdayFallbackWindows.size) {
    const weekdayCandidates = Array.from(weekdayFallbackWindows.entries())
      .filter(([dayKey, windows]) => WORK_DAY_SET.has(dayKey) && windows && windows.length)
      .sort((a, b) => a[1][0].start - b[1][0].start);

    if (weekdayCandidates.length) {
      const [dayKey, windows] = weekdayCandidates[0];
      allowedWindows.set(dayKey, cloneWindows(windows));
      injectedWeekdayDays = [dayKey];
    }
  }

  if (!allowedWindows.size) {
    return null;
  }

  const hasWeekdayPreference =
    allowedWeekdays.some((day) => WORK_DAY_SET.has(day)) &&
    Array.from(allowedWindows.entries()).some(([dayKey, windows]) => {
      return WORK_DAY_SET.has(dayKey) && windows && windows.length;
    });

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
    seedKey,
    hasWeekdayPreference,
    injectedWeekdayFallbackDays: injectedWeekdayDays,
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
  seedKey = '',
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
    defaultSlotDurationMinutes,
    seedKey,
  });

  if (!constraints) {
    return { slots: [], constraints: null };
  }

  const referenceParts = getZonedParts(planningStart, constraints.timeZone);

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

  const targetSuggestions = Math.max(1, Math.floor(maxSuggestions ?? 1));
  let candidateSlots = generateCandidateSlots(
    eligibleIntervals,
    {
      minDurationMinutes: constraints.minDurationMinutes,
      maxDurationMinutes: constraints.maxDurationMinutes,
    },
    targetSuggestions * 2,
    seedKey,
    planningStart
  );

  candidateSlots = filterSlotsBySameDayRules(candidateSlots, referenceParts, constraints.timeZone);

  if (!candidateSlots.length) {
    return { slots: [], constraints };
  }

  const limitedByWeek = limitSlotsByWeekdayQuota(
    candidateSlots,
    constraints.maxSuggestionDaysPerWeek
  );

  let finalSlots = limitedByWeek.slice(0, targetSuggestions);

  if (
    constraints.hasWeekdayPreference &&
    !finalSlots.some((slot) => WORK_DAY_SET.has(slot.dayKey))
  ) {
    const weekdayPool = candidateSlots.filter((slot) => WORK_DAY_SET.has(slot.dayKey));
    if (weekdayPool.length) {
      const replacement = weekdayPool[0];
      const weekendIndex = finalSlots.findIndex((slot) => WEEKEND_DAY_SET.has(slot.dayKey));
      if (weekendIndex >= 0) {
        finalSlots = [
          ...finalSlots.slice(0, weekendIndex),
          replacement,
          ...finalSlots.slice(weekendIndex + 1),
        ].sort((a, b) => a.start.getTime() - b.start.getTime());
      } else if (finalSlots.length < targetSuggestions) {
        finalSlots = [...finalSlots, replacement].sort(
          (a, b) => a.start.getTime() - b.start.getTime()
        );
      }
    }
  }

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
