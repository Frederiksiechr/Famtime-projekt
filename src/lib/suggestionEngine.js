import { availabilityUtils } from './availability';

const MS_PER_MINUTE = 60 * 1000;
const SLOT_ALIGN_MINUTES = 15;
const DEFAULT_LOOKAHEAD_DAYS = 21;
const MIN_OFFSET_MINUTES = 60;
const QUIET_START_HOUR = 6;
const DEFAULT_MIN_DURATION = 60;
const DEFAULT_MAX_DURATION = 240;
const DEFAULT_BUFFER_MINUTES = 15;
const DANISH_TIME_ZONE = 'Europe/Copenhagen';
const DAY_KEY_BY_INDEX = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];
const WORK_DAY_SET = new Set(['monday', 'tuesday', 'wednesday', 'thursday']);
const WEEKEND_DAY_SET = new Set(['friday', 'saturday', 'sunday']);
const DEFAULT_WEEKDAY_WINDOW = [
  { start: 16 * 60, end: 23 * 60 + 59 },
];
const DEFAULT_WEEKEND_WINDOW = [
  { start: 10 * 60, end: 23 * 60 + 59 },
];

const normalizeDayKey = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const lowered = value.toLowerCase().trim();
  if (DAY_KEY_BY_INDEX.includes(lowered)) {
    return lowered;
  }
  switch (lowered) {
    case 'mandag':
    case 'mon':
      return 'monday';
    case 'tirsdag':
    case 'tue':
    case 'tues':
      return 'tuesday';
    case 'onsdag':
    case 'wed':
      return 'wednesday';
    case 'torsdag':
    case 'thu':
    case 'thur':
    case 'thurs':
      return 'thursday';
    case 'fredag':
    case 'fri':
      return 'friday';
    case 'lørdag':
    case 'lordag':
    case 'sat':
      return 'saturday';
    case 'søndag':
    case 'sondag':
    case 'sun':
      return 'sunday';
    default:
      return null;
  }
};

const normalizeDayList = (input) => {
  if (!input) {
    return [];
  }
  const list = Array.isArray(input) ? input : [input];
  const normalized = list
    .map(normalizeDayKey)
    .filter(Boolean);
  return Array.from(new Set(normalized));
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
  const [hoursPart, minutesPart] = trimmed.split(':');
  const hours = Number(hoursPart);
  const minutes = Number(minutesPart);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }
  return hours * 60 + minutes;
};

const normalizeWindowEntry = (entry) => {
  if (!entry) {
    return null;
  }
  if (typeof entry === 'string') {
    const parts = entry.split('-');
    if (parts.length !== 2) {
      return null;
    }
    const start = parseTimeStringToMinutes(parts[0]);
    const end = parseTimeStringToMinutes(parts[1]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return null;
    }
    return { start, end };
  }
  const startRaw = entry.start ?? entry.begin ?? entry.from;
  const endRaw = entry.end ?? entry.finish ?? entry.to;
  const start = parseTimeStringToMinutes(startRaw);
  const end = parseTimeStringToMinutes(endRaw);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return null;
  }
  return { start, end };
};

const mergeMinuteIntervals = (intervals) => {
  if (!Array.isArray(intervals) || !intervals.length) {
    return [];
  }
  const sorted = intervals
    .map((interval) => ({
      start: Math.max(0, Math.floor(interval.start)),
      end: Math.min(24 * 60, Math.ceil(interval.end)),
    }))
    .filter((interval) => interval.end > interval.start)
    .sort((a, b) => a.start - b.start);

  if (!sorted.length) {
    return [];
  }

  const merged = [sorted[0]];
  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i];
    const last = merged[merged.length - 1];
    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
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

const getDefaultWindowsForDay = (dayKey) => {
  if (WEEKEND_DAY_SET.has(dayKey)) {
    return DEFAULT_WEEKEND_WINDOW;
  }
  return DEFAULT_WEEKDAY_WINDOW;
};

const DANISH_DAY_MAP = {
  monday: 'mandag',
  tuesday: 'tirsdag',
  wednesday: 'onsdag',
  thursday: 'torsdag',
  friday: 'fredag',
  saturday: 'lørdag',
  sunday: 'søndag',
};

const normalizeTimeWindows = (definition, allowedDays) => {
  const map = new Map();
  if (!definition || typeof definition !== 'object') {
    allowedDays.forEach((day) => {
      map.set(day, getDefaultWindowsForDay(day));
    });
    return map;
  }

  allowedDays.forEach((day) => {
    const variants = [
      day,
      day.slice(0, 3),
      DANISH_DAY_MAP[day],
      DANISH_DAY_MAP[day]?.slice(0, 3),
    ].filter(Boolean);
    let dayEntry = null;
    for (const key of variants) {
      if (definition[key]) {
        dayEntry = definition[key];
        break;
      }
    }
    if (!dayEntry) {
      dayEntry = definition.default;
    }
    if (Array.isArray(dayEntry) && dayEntry.length) {
      const normalized = mergeMinuteIntervals(
        dayEntry
          .map(normalizeWindowEntry)
          .filter(Boolean)
      );
      if (normalized.length) {
        map.set(day, normalized);
        return;
      }
    }
    map.set(day, getDefaultWindowsForDay(day));
  });

  return map;
};

const intersectTimeWindowMaps = (base, next, allowedDays) => {
  const result = new Map();
  allowedDays.forEach((day) => {
    const first = base.get(day) ?? getDefaultWindowsForDay(day);
    const second = next.get(day) ?? getDefaultWindowsForDay(day);
    const intersection = intersectMinuteIntervals(first, second);
    if (intersection.length) {
      result.set(day, intersection);
    }
  });
  return result;
};

const toDate = (value) => {
  if (availabilityUtils?.toDate) {
    return availabilityUtils.toDate(value);
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }
  if (typeof value === 'number' || typeof value === 'string') {
    const converted = new Date(value);
    return Number.isNaN(converted.getTime()) ? null : converted;
  }
  return null;
};

const expandIntervalWithBuffer = (start, end, bufferMinutes) => {
  const bufferMs = Math.max(0, bufferMinutes ?? 0) * MS_PER_MINUTE;
  return {
    start: new Date(start.getTime() - bufferMs),
    end: new Date(end.getTime() + bufferMs),
  };
};

const collectBusyRanges = ({
  confirmedEvents = [],
  pendingEvents = [],
  calendarEntries = [],
  bufferMinutes = DEFAULT_BUFFER_MINUTES,
  now,
}) => {
  const ranges = [];

  const append = (rawStart, rawEnd) => {
    const start = toDate(rawStart);
    const end = toDate(rawEnd);
    if (!start || !end || end <= start) {
      return;
    }
    if (end <= now) {
      return;
    }
    const expanded = expandIntervalWithBuffer(start, end, bufferMinutes);
    ranges.push(expanded);
  };

  const appendFromList = (list = []) => {
    list.forEach((interval) => append(interval?.start, interval?.end));
  };

  confirmedEvents.forEach((event) => {
    append(event?.start, event?.end);
    if (event?.pendingChange) {
      append(event.pendingChange.start, event.pendingChange.end);
    }
  });

  pendingEvents.forEach((event) => {
    append(event?.start, event?.end);
    if (event?.pendingChange) {
      append(event.pendingChange.start, event.pendingChange.end);
    }
  });

  calendarEntries.forEach((entry) => {
    appendFromList(entry?.busy);
  });

  if (!ranges.length) {
    return [];
  }

  const sorted = ranges
    .map((interval) => ({
      start: new Date(interval.start.getTime()),
      end: new Date(interval.end.getTime()),
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const merged = [sorted[0]];
  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i];
    const last = merged[merged.length - 1];
    if (current.start <= last.end) {
      if (current.end > last.end) {
        last.end = current.end;
      }
    } else {
      merged.push(current);
    }
  }

  return merged;
};

const derivePreferenceProfile = (familyPreferences = {}) => {
  const entries = Object.values(familyPreferences ?? {});
  const defaultDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  if (!entries.length) {
    return {
      allowedDays: defaultDays,
      dayWindows: new Map(defaultDays.map((day) => [day, getDefaultWindowsForDay(day)])),
      minDuration: DEFAULT_MIN_DURATION,
      maxDuration: DEFAULT_MAX_DURATION,
      bufferMinutes: DEFAULT_BUFFER_MINUTES,
    };
  }

  const dayCandidates = entries
    .map((entry) => normalizeDayList(entry?.days))
    .filter((list) => list.length);

  let allowedDays = dayCandidates.length
    ? dayCandidates.reduce((acc, list) => acc.filter((day) => list.includes(day)), [...dayCandidates[0]])
    : defaultDays;

  if (!allowedDays.length) {
    return null;
  }

  let minDuration = DEFAULT_MIN_DURATION;
  let maxDuration = DEFAULT_MAX_DURATION;
  let bufferMinutes = DEFAULT_BUFFER_MINUTES;

  entries.forEach((entry) => {
    if (Number.isFinite(entry?.minDurationMinutes)) {
      minDuration = Math.max(minDuration, entry.minDurationMinutes);
    }
    if (Number.isFinite(entry?.maxDurationMinutes)) {
      maxDuration = Math.min(maxDuration, entry.maxDurationMinutes);
    }
    if (Number.isFinite(entry?.bufferBeforeMinutes) || Number.isFinite(entry?.bufferAfterMinutes)) {
      const before = Number.isFinite(entry.bufferBeforeMinutes) ? entry.bufferBeforeMinutes : 0;
      const after = Number.isFinite(entry.bufferAfterMinutes) ? entry.bufferAfterMinutes : 0;
      bufferMinutes = Math.max(bufferMinutes, before, after);
    }
  });

  if (minDuration > maxDuration) {
    minDuration = Math.min(minDuration, maxDuration);
  }

  let combinedWindows = null;
  entries.forEach((entry, index) => {
    const entryWindows = normalizeTimeWindows(entry?.timeWindows, allowedDays);
    if (index === 0) {
      combinedWindows = entryWindows;
    } else {
      combinedWindows = intersectTimeWindowMaps(combinedWindows, entryWindows, allowedDays);
    }
  });

  if (!combinedWindows) {
    combinedWindows = new Map(allowedDays.map((day) => [day, getDefaultWindowsForDay(day)]));
  }

  allowedDays = allowedDays.filter((day) => combinedWindows.has(day));
  if (!allowedDays.length) {
    return null;
  }

  return {
    allowedDays,
    dayWindows: combinedWindows,
    minDuration,
    maxDuration,
    bufferMinutes,
  };
};

const subtractBusyFromInterval = (interval, busyList) => {
  if (!busyList.length) {
    return [interval];
  }
  const result = [];
  let cursor = interval.start.getTime();
  const intervalEnd = interval.end.getTime();

  for (let i = 0; i < busyList.length && cursor < intervalEnd; i += 1) {
    const busy = busyList[i];
    const busyStart = busy.start.getTime();
    const busyEnd = busy.end.getTime();
    if (busyEnd <= cursor || busyStart >= intervalEnd) {
      continue;
    }
    if (busyStart > cursor) {
      result.push({
        start: new Date(cursor),
        end: new Date(Math.min(busyStart, intervalEnd)),
      });
    }
    cursor = Math.max(cursor, busyEnd);
  }

  if (cursor < intervalEnd) {
    result.push({
      start: new Date(cursor),
      end: new Date(intervalEnd),
    });
  }

  return result.filter((slot) => slot.end > slot.start);
};

const alignForward = (ms) => {
  const step = SLOT_ALIGN_MINUTES * MS_PER_MINUTE;
  return Math.ceil(ms / step) * step;
};

const alignBackward = (ms) => {
  const step = SLOT_ALIGN_MINUTES * MS_PER_MINUTE;
  return Math.floor(ms / step) * step;
};

const alignNearest = (ms) => {
  const step = SLOT_ALIGN_MINUTES * MS_PER_MINUTE;
  return Math.round(ms / step) * step;
};

const placeSlotInIntervals = (intervals, durationMinutes, bias) => {
  if (!intervals.length) {
    return null;
  }
  const durationMs = durationMinutes * MS_PER_MINUTE;
  if (bias === 'middle') {
    const sorted = [...intervals].sort(
      (a, b) => b.end.getTime() - b.start.getTime() - (a.end.getTime() - a.start.getTime())
    );
    for (const interval of sorted) {
      const length = interval.end.getTime() - interval.start.getTime();
      if (length < durationMs) {
        continue;
      }
      const offset = (length - durationMs) / 2;
      const candidateStart = alignNearest(interval.start.getTime() + offset);
      const start = Math.max(candidateStart, interval.start.getTime());
      const end = start + durationMs;
      if (end <= interval.end.getTime()) {
        return { start: new Date(start), end: new Date(end) };
      }
    }
    return null;
  }

  if (bias === 'end') {
    for (let index = intervals.length - 1; index >= 0; index -= 1) {
      const interval = intervals[index];
      if (interval.end.getTime() - interval.start.getTime() < durationMs) {
        continue;
      }
      const candidateStart = alignBackward(interval.end.getTime() - durationMs);
      if (candidateStart < interval.start.getTime()) {
        continue;
      }
      return { start: new Date(candidateStart), end: new Date(candidateStart + durationMs) };
    }
    return null;
  }

  for (const interval of intervals) {
    if (interval.end.getTime() - interval.start.getTime() < durationMs) {
      continue;
    }
    const candidateStart = alignForward(interval.start.getTime());
    if (candidateStart + durationMs <= interval.end.getTime()) {
      return { start: new Date(candidateStart), end: new Date(candidateStart + durationMs) };
    }
  }
  return null;
};

const buildDayDurations = (dayKey, minDuration, maxDuration) => {
  let dayMin = minDuration;
  let dayMax = maxDuration;

  if (WORK_DAY_SET.has(dayKey)) {
    dayMax = Math.min(dayMax, Math.max(dayMin, 180));
  } else if (WEEKEND_DAY_SET.has(dayKey)) {
    dayMin = Math.max(dayMin, Math.min(dayMax, 120));
  }

  if (dayMin > dayMax) {
    dayMin = dayMax;
  }

  const mid = Math.max(
    dayMin,
    Math.min(dayMax, Math.round((dayMin + dayMax) / 2 / SLOT_ALIGN_MINUTES) * SLOT_ALIGN_MINUTES)
  );

  return Array.from(
    new Set([dayMin, mid, dayMax].filter((value) => Number.isFinite(value) && value > 0))
  );
};

const generateCandidates = ({
  allowedDays,
  dayWindows,
  busyRanges,
  now,
  preferences,
  lookaheadDays,
}) => {
  const candidates = [];
  const earliest = new Date(now.getTime() + MIN_OFFSET_MINUTES * MS_PER_MINUTE);
  earliest.setSeconds(0, 0);

  const startDay = new Date(earliest);
  startDay.setHours(0, 0, 0, 0);

  for (let dayOffset = 0; dayOffset < lookaheadDays; dayOffset += 1) {
    const dayStart = new Date(startDay);
    dayStart.setDate(dayStart.getDate() + dayOffset);
    const dayKey = DAY_KEY_BY_INDEX[dayStart.getDay()];

    if (!allowedDays.includes(dayKey)) {
      continue;
    }

    const windows = dayWindows.get(dayKey) ?? getDefaultWindowsForDay(dayKey);
    if (!windows.length) {
      continue;
    }

    const dayIntervals = windows
      .map((window) => ({
        start: new Date(dayStart.getTime() + Math.max(window.start, QUIET_START_HOUR * 60) * MS_PER_MINUTE),
        end: new Date(dayStart.getTime() + window.end * MS_PER_MINUTE),
      }))
      .filter((interval) => interval.end > interval.start)
      .map((interval) => {
        if (interval.end <= earliest) {
          return null;
        }
        if (interval.start < earliest) {
          return { start: new Date(earliest), end: interval.end };
        }
        return interval;
      })
      .filter(Boolean);

    if (!dayIntervals.length) {
      continue;
    }

    const freeIntervals = dayIntervals
      .flatMap((interval) => subtractBusyFromInterval(interval, busyRanges))
      .filter((interval) => interval.end.getTime() - interval.start.getTime() >= preferences.minDuration * MS_PER_MINUTE);

    if (!freeIntervals.length) {
      continue;
    }

    const durations = buildDayDurations(dayKey, preferences.minDuration, preferences.maxDuration);
    const biases = ['start', 'middle', 'end'];

    durations.forEach((duration, index) => {
      const slot = placeSlotInIntervals(freeIntervals, duration, biases[index] ?? 'start');
      if (slot) {
        candidates.push({
          ...slot,
          dayKey,
          durationMinutes: duration,
        });
      }
    });
  }

  return candidates.sort((a, b) => a.start.getTime() - b.start.getTime());
};

const selectFinalSuggestions = (candidates, limit) => {
  if (!candidates.length) {
    return [];
  }

  const selections = [];
  const perDayCounts = new Map();

  for (const candidate of candidates) {
    const count = perDayCounts.get(candidate.dayKey) ?? 0;
    if (count >= 2) {
      continue;
    }
    selections.push(candidate);
    perDayCounts.set(candidate.dayKey, count + 1);
    if (selections.length >= limit) {
      break;
    }
  }

  if (selections.length < limit) {
    for (const candidate of candidates) {
      if (selections.find((item) => item.start.getTime() === candidate.start.getTime())) {
        continue;
      }
      selections.push(candidate);
      if (selections.length >= limit) {
        break;
      }
    }
  }

  return selections.slice(0, limit).map((slot, index) => ({
    id: `${slot.start.getTime()}-${slot.end.getTime()}-${index}`,
    start: slot.start,
    end: slot.end,
  }));
};

export const buildFamilySuggestions = ({
  confirmedEvents = [],
  pendingEvents = [],
  calendarEntries = [],
  familyPreferences = {},
  now = new Date(),
  limit = 6,
  lookaheadDays = DEFAULT_LOOKAHEAD_DAYS,
} = {}) => {
  const preferenceProfile = derivePreferenceProfile(familyPreferences);
  if (!preferenceProfile) {
    return {
      suggestions: [],
      reason: 'Ingen fælles præferencer fundet. Opdater profilernes foretrukne dage og tidsrum.',
    };
  }

  const busyRanges = collectBusyRanges({
    confirmedEvents,
    pendingEvents,
    calendarEntries,
    bufferMinutes: preferenceProfile.bufferMinutes,
    now,
  });

  const candidates = generateCandidates({
    allowedDays: preferenceProfile.allowedDays,
    dayWindows: preferenceProfile.dayWindows,
    busyRanges,
    now,
    preferences: preferenceProfile,
    lookaheadDays,
  });

  if (!candidates.length) {
    return {
      suggestions: [],
      reason: 'Ingen ledige tidsrum inden for præferencerne. Juster dagene eller tidsvinduerne.',
    };
  }

  const finalSuggestions = selectFinalSuggestions(candidates, limit);
  if (!finalSuggestions.length) {
    return {
      suggestions: [],
      reason: 'Kunne ikke finde forslag efter filtrering. Vælg bredere tidsrum.',
    };
  }

  return {
    suggestions: finalSuggestions,
    reason: '',
  };
};

export const suggestionEngineConstants = {
  DANISH_TIME_ZONE,
  QUIET_START_HOUR,
  MIN_OFFSET_MINUTES,
  DEFAULT_LOOKAHEAD_DAYS,
};

export default buildFamilySuggestions;

