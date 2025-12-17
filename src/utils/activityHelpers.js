/**
 * Helpers til aktivitetsforslag (deterministisk hash og udvælgelse af eksempler pr. humør).
 * Bruges af AISuggestion og autoslot-generering til at vælge stabile forslag.
 */
import {
  WEEKDAY_ACTIVITIES,
  WEEKEND_ACTIVITIES,
  MOOD_OPTIONS,
  MOOD_TONE_MAP,
} from '../data/activityCatalog';

const DEFAULT_MOOD_KEY = MOOD_OPTIONS[0]?.key ?? 'balanced';

export const simpleHash = (input) => {
  const str = String(input ?? '');
  let hash = 0;
  for (let index = 0; index < str.length; index += 1) {
    hash = (hash * 31 + str.charCodeAt(index)) >>> 0;
  }
  return hash;
};

const dedupeByKey = (items = []) => {
  const seen = new Set();
  const result = [];
  items.forEach((item) => {
    if (!item || seen.has(item.key)) {
      return;
    }
    seen.add(item.key);
    result.push(item);
  });
  return result;
};

export const pickMoodExamples = (
  moodKey = DEFAULT_MOOD_KEY,
  { isWeekend = false, count = 3, seed = '' } = {}
) => {
  // Finder deterministiske katalogeksempler til et givent humør (bruges som AI-fallback).
  const catalog = isWeekend ? WEEKEND_ACTIVITIES : WEEKDAY_ACTIVITIES;
  if (!Array.isArray(catalog) || !catalog.length) {
    return [];
  }

  const normalizedMood = MOOD_OPTIONS.some((option) => option.key === moodKey)
    ? moodKey
    : DEFAULT_MOOD_KEY;

  const moodPool = catalog.filter(
    (item) => Array.isArray(item.moods) && item.moods.includes(normalizedMood)
  );
  const toneMatches = MOOD_TONE_MAP[normalizedMood] || [];
  const tonePool = toneMatches.length
    ? catalog.filter((item) => toneMatches.includes(item.tone))
    : [];

  const basePool = moodPool.length ? moodPool : catalog;
  const combinedPool = dedupeByKey([...moodPool, ...tonePool, ...basePool]);

  const ranked = combinedPool
    .map((item) => ({
      item,
      score: simpleHash(`${seed}|${normalizedMood}|${item.key}`),
    }))
    .sort((a, b) => a.score - b.score);

  const result = [];
  ranked.forEach(({ item }) => {
    if (!item || result.length >= count) {
      return;
    }
    result.push(item);
  });

  if (!result.length && catalog.length) {
    result.push(catalog[0]);
  }

  return result;
};
