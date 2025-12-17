/**
 * AISuggestion
 *
 * - Viser et AI-genereret forslag (OpenAI) med lokal fallback.
 * - Bygger videre på den deterministiske helper, så output er stabilt selv ved fejl.
 * - Når API-nøglen mangler, vises det lokale forslag sammen med en forklaring.
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { View, Text, Pressable, Modal } from 'react-native';
import Constants from 'expo-constants';

import Button from './Button';
import { auth } from '../lib/firebase';
import styles from '../styles/components/AISuggestionStyles';
import {
  WEEKDAY_ACTIVITIES,
  WEEKEND_ACTIVITIES,
  MOOD_OPTIONS,
  MOOD_TONE_MAP,
} from '../data/activityCatalog';
import {
  simpleHash,
  pickMoodExamples,
} from '../utils/activityHelpers';
export { MOOD_OPTIONS };

const DAY_LABELS = {
  monday: 'Mandag',
  tuesday: 'Tirsdag',
  wednesday: 'Onsdag',
  thursday: 'Torsdag',
  friday: 'Fredag',
  saturday: 'Lørdag',
  sunday: 'Søndag',
};

const DAY_ORDER = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

const WEEKEND_KEYS = ['friday', 'saturday', 'sunday'];
const WEEKEND_DAY_INDEX = new Set([0, 5, 6]);

const DEFAULT_MOOD_KEY = MOOD_OPTIONS[0].key;

const DAY_PREFIX_VARIANTS = {
  withDay: [
    (label) => `${label}: `,
    (label) => `${label} plan: `,
    (label) => `${label}, bud: `,
  ],
  withoutDay: [() => '', () => 'Snart: ', () => 'Når tiden passer: '],
};

const DEFAULT_NAME = 'FamTime-vennen';

/**
 * LÆSNING AF APP-INDSTILLINGER
 * 
 * Denne hjælper læser konfigurationsindstillinger for appen (som hvor OpenAI-nøglen
 * er gemt). Den er sikker og vil ikke ødelægge noget hvis nogle indstillinger mangler.
 * 
 * Dette bruges til at finde ud af om appen skal bruge OpenAI direkte eller gennem
 * en proxy-server.
 */
// Safely reads Expo extra config so missing manifest fields don't crash suggestion flow.
const getExpoExtra = () => {
  const configExtra =
    Constants?.expoConfig?.extra ??
    Constants?.manifest2?.extra ??
    Constants?.manifest?.extra;

  if (configExtra && typeof configExtra === 'object') {
    return configExtra;
  }
  return {};
};

/**
 * RENSNING AF TEKSTVÆRDIER
 * 
 * En hjælper som sikrer at alle tekstværdier er "rene" - fjerner uønskede
 * mellemrum fra start og slut. Hvis der kommer noget der ikke er tekst,
 * returnerer den bare tomt.
 * 
 * Dette beskytter hele systemet mod ødelagte eller uforventede data.
 */
const sanitizeString = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
};

/**
 * OMFORMNING TIL STOR BEGYNDELSESBOGSTAV
 * 
 * Denne hjælper tager en tekst (som "hELLO wORLD") og formaterer den pænt
 * med stor begyndelsesbogstav (som "Hello World").
 * 
 * Det bruges til at gøre brugernavne, byer osv. pæne når de vises til brugerne.
 */
const toTitleCase = (value) => {
  const clean = sanitizeString(value);
  if (!clean) {
    return '';
  }
  return clean
    .toLowerCase()
    .replace(/(^|\s|-)(\S)/g, (_match, boundary, char) => `${boundary}${char.toUpperCase()}`);
};

/**
 * LÆSNING AF BRUGERENS ALDER
 * 
 * En hjælper som læser en aldersværdi på en sikker måde. Alderen kunne være
 * et tal, en tekst med tal i, eller helt forkert data - denne funktion håndterer
 * alle situationerne og returnerer enten det rigtige tal eller ingenting.
 * 
 * Dette bruges til at bestemme hvilke aktiviteter der passer til familien.
 */
const parseAge = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const numeric = Number.parseInt(trimmed, 10);
    if (!Number.isNaN(numeric)) {
      return numeric;
    }
  }
  return null;
};

/**
 * FORMATERING AF AKTIVITET FOR AI
 * 
 * Denne hjælper præsenterer en aktivitet på en kort, præcis måde som AI'en
 * nemt kan læse og arbejde med. Den fjerner unødige tegn og præsenterer
 * kun den vigtigste information.
 * 
 * Eksempel: "Byferie — tone: family-friendly, humør: relaxed, note: shopping"
 */
// Short, prompt-friendly description of a catalog activity (removes brackets/extra whitespace).
const describeActivityForPrompt = (activity) => {
  if (!activity) {
    return '';
  }
  const detail = sanitizeString(activity.detail)
    .replace(/[()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const moodList = Array.isArray(activity.moods) ? activity.moods.join(', ') : '';
  const tone = sanitizeString(activity.tone) || 'ukendt';
  const moodLabel = moodList || 'blandet';
  return `${activity.label} — tone: ${tone}, humør: ${moodLabel}${
    detail ? `, note: ${detail}` : ''
  }`;
};

/**
 * VALG AF DAG
 * 
 * Denne funktion vælger en dag fra brugerens liste af foretrukne dage.
 * Den bruger en "hash" (et tal baseret på brugerens data) for at sikre at
 * den samme bruger altid får samme dag valgt - så forslagene er stabile.
 * 
 * Hvis brugeren ikke har nogen foretrukne dage, returnerer den intet.
 */
// Deterministic day pick based on hash + preferred days.
const pickDay = (hashSeed, days) => {
  if (!Array.isArray(days) || !days.length) {
    return null;
  }

  const normalized = days
    .map((day) => sanitizeString(day).toLowerCase())
    .filter((day) => DAY_ORDER.includes(day));

  if (!normalized.length) {
    return null;
  }

  const ordered = DAY_ORDER.filter((day) => normalized.includes(day));
  if (!ordered.length) {
    return null;
  }

  const hash = simpleHash(`${hashSeed}|day`);
  return ordered[hash % ordered.length];
};

/**
 * VALG AF VARIANT BLANDT MULIGHEDER
 * 
 * En hjælper som vælger en "variant" fra en liste - eksempelvis vælger den en
 * måde at formulere en sætning på (som "Mandag: " eller "Mandag plan: ").
 * 
 * Den bruger en hash for at sikre at samme bruger altid får samme variant valgt,
 * så forslagene virker konsistente.
 */
// Deterministic list pick to keep suggestions stable across sessions.
const pickVariant = (items, hashSeed, salt) => {
  if (!Array.isArray(items) || !items.length) {
    return null;
  }
  const index = simpleHash(`${hashSeed}|${salt}`) % items.length;
  return items[index];
};

/**
 * VALG AF AKTIVITET
 * 
 * Denne funktion vælger en activity fra aktivitets-kataloget baseret på:
 * - Om det er weekend eller hverdag
 * - Familiens alder (barn, yngre voksen, voksen)
 * - Familiens nuværende humør (afslappet, energisk, osv.)
 * 
 * Den bruger en hash for at sikre at samme bruger altid får samme aktivitet,
 * selv hvis appen bruges offline eller uden internet. Det sikrer at forslagene
 * er stabile og ikke ændrer sig hele tiden.
 */
// Picks a single activity matching mood/weekend/age, deterministic for offline fallback.
const pickActivity = (hashSeed, isWeekend, age, moodKey = DEFAULT_MOOD_KEY) => {
  const catalog = isWeekend ? WEEKEND_ACTIVITIES : WEEKDAY_ACTIVITIES;
  const tonePreference =
    typeof age === 'number'
      ? age < 23
        ? 'youth'
        : age > 30
          ? 'adult'
          : null
      : null;

  const matchesMood = (item) =>
    Array.isArray(item.moods) && item.moods.includes(moodKey);
  const moodPool =
    moodKey === 'balanced'
      ? catalog
      : catalog.filter((item) => matchesMood(item));
  const basePool = moodPool.length ? moodPool : catalog;

  const toneBucket =
    tonePreference === null
      ? []
      : basePool.filter((item) => item.tone === tonePreference);

  const moodTones = MOOD_TONE_MAP[moodKey] ?? [];
  const moodToneBucket = moodTones.length
    ? basePool.filter((item) => moodTones.includes(item.tone))
    : [];

  const dedupeByKey = (items) => {
    const seen = new Set();
    const unique = [];
    items.forEach((item) => {
      if (!item || seen.has(item.key)) {
        return;
      }
      unique.push(item);
      seen.add(item.key);
    });
    return unique;
  };

  const pickFromBucket = (bucket, salt) => {
    if (!bucket.length) {
      return null;
    }
    const index = simpleHash(`${hashSeed}|activity|${salt}`) % bucket.length;
    return bucket[index];
  };

  const priorityPool = dedupeByKey([
    ...toneBucket,
    ...moodToneBucket,
    ...moodPool,
  ]);
  const priorityPick = pickFromBucket(
    priorityPool.length ? priorityPool : basePool,
    'priority'
  );
  if (priorityPick) {
    return priorityPick;
  }

  const primaryPick = pickFromBucket(basePool, 'primary');
  if (primaryPick) {
    return primaryPick;
  }

  const catalogPick = pickFromBucket(catalog, 'all');
  return catalogPick ?? catalog[0];
};

/**
 * GENERERING AF FORSLAG BASERET PÅ PROFIL
 * 
 * Denne funktion er hjertet i "smart forslag" - den tager en families profil
 * (navn, alder, by, foretrukne dage) og deres nuværende humør, og laver et
 * personaliseret aktivitetsforslag.
 * 
 * Funktionen virker UDEN internet - den bruger kun data der allerede er i appen.
 * Det betyder at selv hvis OpenAI-APIen ikke svarer, eller brugeren er offline,
 * får familien stadig et brugbart forslag.
 * 
 * Eksempel resultat: "Lørdag: Besøg lokalt museum i København (sjovt for hele familien)"
 */
// Builds a consistent suggestion string from profile + mood (used for offline fallback and seeding).
export const generateProfileSuggestion = (
  user = {},
  moodKey = DEFAULT_MOOD_KEY,
  options = {}
) => {
  const variantSeed =
    options && typeof options === 'object' ? options.variantSeed : null;
  const name = sanitizeString(user.name);
  const city = sanitizeString(user.city);
  const gender = sanitizeString(user.gender);
  const preferredDays = Array.isArray(user.preferredDays)
    ? user.preferredDays
    : [];
  const age = parseAge(user.age);
  const moodConfig =
    MOOD_OPTIONS.find((option) => option.key === moodKey) ?? MOOD_OPTIONS[0];

  const baseHashSeed = [
    name || DEFAULT_NAME,
    Number.isFinite(age) ? age : 'na',
    city || 'nocity',
    preferredDays.join('-') || 'nodays',
    moodConfig.key,
  ].join('|');
  const hashSeed = variantSeed
    ? `${baseHashSeed}|variant:${variantSeed}`
    : baseHashSeed;

  const selectedDay = pickDay(hashSeed, preferredDays);
  const isWeekend =
    selectedDay === null
      ? preferredDays.some((day) =>
          WEEKEND_KEYS.includes(sanitizeString(day).toLowerCase())
        )
      : WEEKEND_KEYS.includes(selectedDay);

  const activity = pickActivity(hashSeed, isWeekend, age, moodConfig.key);
  const formattedCity = toTitleCase(city);
  const citySegment = formattedCity ? ` i ${formattedCity}` : '';
  const detailRaw = sanitizeString(activity.detail)
    .replace(/[()]/g, '')
    .replace(/[–—]/g, ' til ')
    .replace(/\s+/g, ' ')
    .trim();
  const activityLead =
    pickVariant(moodConfig?.leads, hashSeed, 'lead') ??
    moodConfig?.activityLead ??
    'Evt.';
  const nuanceText = pickVariant(moodConfig?.nuancePool, hashSeed, 'nuance');
  const detailPrimary = detailRaw || nuanceText || '';
  const detailSegment = detailPrimary ? ` (${detailPrimary})` : '';
  const activityPhrase = `${activityLead} ${activity.label}${citySegment}`.trim();
  const dayPrefix = (() => {
    const pool = selectedDay
      ? DAY_PREFIX_VARIANTS.withDay
      : DAY_PREFIX_VARIANTS.withoutDay;
    const variant = pickVariant(pool, hashSeed, 'dayPrefix');
    if (!variant) {
      return selectedDay ? `${toLabel(selectedDay)}: ` : '';
    }
    const label = selectedDay ? toLabel(selectedDay) : null;
    const resolved =
      typeof variant === 'function' ? variant(label) : String(variant || '');
    if (resolved && !resolved.endsWith(' ')) {
      return `${resolved} `;
    }
    return resolved || '';
  })();

  return `${dayPrefix}${activityPhrase}${detailSegment}`.replace(/\s+/g, ' ').trim();
};

const toLabel = (dayKey) => {
  const key = sanitizeString(dayKey).toLowerCase();
  return DAY_LABELS[key] ?? key;
};

const normalizeMoodKey = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  return MOOD_OPTIONS.some((option) => option.key === trimmed)
    ? trimmed
    : null;
};

/**
 * AI-FORSLAG KOMPONENT
 * 
 * Dette er den vigtigste React-komponent som viser et AI-personaliseret forslag
 * til familien. Den viser:
 * - Et aktivitetsforslag (enten fra AI eller lokalt backup)
 * - Mulighed for at vælge familiens nuværende humør
 * - En knap til at få nyt forslag
 * 
 * Komponenten håndterer alle fejlsituationer på elegant vis:
 * - Hvis AI'en ikke svarer, vises det lokale forslag i stedet
 * - Hvis brugeren ikke er logget ind, vises en besked
 * - Hvis der ikke er forbindelse, bruges offline-forslagene
 * 
 * Brugeren kan også vælge forskellige humør, som påvirker næste forslag.
 */
const AISuggestion = ({
  user,
  onSuggestion,
  variant = 'card',
  moodKey: externalMoodKeyProp = null,
  variantSeed: externalVariantSeed = null,
  eventDate = null,
}) => {
  const isInline = variant === 'inline';
  const externalMoodKey = normalizeMoodKey(externalMoodKeyProp);
  const isMoodControlled = Boolean(externalMoodKey);
  const [internalMood, setInternalMood] = useState(
    externalMoodKey ?? DEFAULT_MOOD_KEY
  );
  const resolvedMoodKey = isMoodControlled ? externalMoodKey : internalMood;
  const fallbackVariantSeed = externalVariantSeed ?? '';
  const [moodPickerVisible, setMoodPickerVisible] = useState(false);
  const [suggestion, setSuggestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasGenerated, setHasGenerated] = useState(false);
  const currentMoodRef = useRef(resolvedMoodKey);

  const selectedMood = useMemo(() => {
    return (
      MOOD_OPTIONS.find((option) => option.key === resolvedMoodKey) ??
      MOOD_OPTIONS[0]
    );
  }, [resolvedMoodKey]);
  const moodHelperText = selectedMood.helper ?? 'Humør påvirker næste forslag.';
  const allowMoodSelection = !isMoodControlled;

  const handleOpenMoodPicker = useCallback(() => {
    if (!allowMoodSelection) {
      return;
    }
    setMoodPickerVisible(true);
  }, [allowMoodSelection]);

  const handleCloseMoodPicker = useCallback(() => {
    setMoodPickerVisible(false);
  }, []);

  const handleSelectMood = useCallback((nextMoodKey) => {
    if (!allowMoodSelection) {
      return;
    }
    setInternalMood(nextMoodKey);
    setMoodPickerVisible(false);
  }, [allowMoodSelection]);

  const extra = useMemo(() => getExpoExtra(), []);
  const directApiKey = sanitizeString(extra.openaiApiKey);
  const directModel = sanitizeString(extra.openaiModel) || 'gpt-4o-mini';
  const proxyUrl = sanitizeString(extra.openaiProxyUrl);

  useEffect(() => {
    setHasGenerated(false);
    setSuggestion('');
    setError('');
  }, [resolvedMoodKey]);

  useEffect(() => {
    currentMoodRef.current = selectedMood.key;
  }, [selectedMood.key]);

  const profile = useMemo(() => {
    const name = sanitizeString(user?.name);
    const ageValue = user?.age;
    const ageParsed = parseAge(ageValue);
    const gender = sanitizeString(user?.gender);
    const city = sanitizeString(user?.city ?? user?.location);
    const rawPreferredDays = Array.isArray(user?.preferredDays)
      ? user.preferredDays
      : [];
    const preferredDays = rawPreferredDays
      .map((day) => sanitizeString(day).toLowerCase())
      .filter((day) => DAY_ORDER.includes(day));

    const seedSource = [
      name || DEFAULT_NAME,
      Number.isFinite(ageParsed) ? ageParsed : 'na',
      city || 'nocity',
      preferredDays.join('-') || 'nodays',
    ].join('|');

    return {
      name,
      age: ageParsed,
      ageRaw: ageValue,
      gender,
      city,
      preferredDays,
      seedHash: simpleHash(seedSource),
      seedSource,
    };
  }, [
    user?.age,
    user?.city,
    user?.gender,
    user?.location,
    user?.name,
    user?.preferredDays,
  ]);

  const scheduleIsWeekend = useMemo(() => {
    if (eventDate instanceof Date && !Number.isNaN(eventDate.getTime())) {
      return WEEKEND_DAY_INDEX.has(eventDate.getDay());
    }
    return profile.preferredDays.some((day) =>
      WEEKEND_KEYS.includes(sanitizeString(day).toLowerCase())
    );
  }, [eventDate, profile.preferredDays]);

  const fallbackSuggestion = useMemo(
    () =>
      generateProfileSuggestion(
        {
          name: profile.name,
          age:
            profile.age ??
            (typeof profile.ageRaw === 'number' ||
            typeof profile.ageRaw === 'string'
              ? profile.ageRaw
              : ''),
          city: profile.city,
          gender: profile.gender,
          preferredDays: profile.preferredDays,
        },
        selectedMood.key,
        { variantSeed: fallbackVariantSeed }
      ),
    [profile, selectedMood.key, fallbackVariantSeed]
  );

  const inspirationExamples = useMemo(
    () =>
      pickMoodExamples(selectedMood.key, {
        isWeekend: scheduleIsWeekend,
        count: 3,
        seed: fallbackVariantSeed || profile.seedHash || 'seed',
      }),
    [
      selectedMood.key,
      scheduleIsWeekend,
      fallbackVariantSeed,
      profile.seedHash,
    ]
  );

  const applySuggestion = useCallback(
    (value) => {
      const cleaned = sanitizeString(value);
      const next = cleaned && cleaned.length ? cleaned : fallbackSuggestion;
      setSuggestion(next);
      if (typeof onSuggestion === 'function') {
        onSuggestion(next);
      }
    },
    [fallbackSuggestion, onSuggestion]
  );

  const buildRequestBody = useCallback(() => {
    const moodDetail = `${selectedMood.label} – ${selectedMood.description}`;
    const plannedDayLabel = (() => {
      if (eventDate instanceof Date && !Number.isNaN(eventDate.getTime())) {
        return toTitleCase(
          eventDate.toLocaleDateString('da-DK', { weekday: 'long' })
        );
      }
      const firstPreferred = profile.preferredDays[0];
      return firstPreferred ? toLabel(firstPreferred) : '';
    })();
    const inspirationText = inspirationExamples.length
      ? inspirationExamples
          .map(
            (activity, index) =>
              `${index + 1}) ${describeActivityForPrompt(activity)}`
          )
          .join('\n')
      : 'Ingen katalogeksempler tilgængelige.';

    const systemPrompt = [
      'Du er FamTime-assistenten og skriver på dansk i én kort linje.',
      'Skab et nyt forslag inspireret af katalogets eksempler, men gentag ikke deres navne ordret.',
      'Max 18 ord, ingen emoji, slogans eller bindestreger.',
      'Format: "[Dag: ]<kort lead> <aktivitet> [i <by>] (<kort nuance>)".',
    ].join(' ');

    const userPrompt = [
      'Brugerdata (kun til tone, nævn dem ikke direkte):',
      `Navn: ${profile.name || DEFAULT_NAME}`,
      `Alder: ${profile.age ?? 'ukendt'}`,
      `Køn: ${profile.gender || 'ukendt'}`,
      `By: ${profile.city || 'ukendt'}`,
      `Humør: ${moodDetail}`,
      `Planlagt dag: ${plannedDayLabel || 'ikke fastsat'}`,
      '',
      'Inspiration fra kataloget:',
      inspirationText,
      '',
      'Instruktioner:',
      `1) Find på én ny aktivitet der matcher stemningen. Brug ${selectedMood.prompt}.`,
      '2) Svar med én kort linje (sætning eller fragment), max 18 ord.',
      '3) Brug planlagt dag/by hvis de findes, ellers spring dem over.',
      '4) Nævn ikke navn, alder eller køn, og skriv aldrig "Velkommen til FamTime".',
    ].join('\n');

    const lowerModel = typeof directModel === 'string' ? directModel.toLowerCase() : '';
    const payload = {
      model: directModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    };
    if (!lowerModel.includes('gpt-5')) {
      payload.temperature = 0.2;
    }
    return payload;
  }, [
    fallbackSuggestion,
    directModel,
    eventDate,
    inspirationExamples,
    profile,
    selectedMood.description,
    selectedMood.label,
    selectedMood.prompt,
  ]);

  // Henter forslag: bruger proxy hvis logget ind, ellers falder tilbage til lokalt seed.
  const handleGenerate = useCallback(async () => {
    setHasGenerated(true);
    setError('');
    setSuggestion('');
    const requestMoodKey = selectedMood.key;
    if (proxyUrl) {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        applySuggestion(fallbackSuggestion);
        setError('Log ind for at hente AI-forslag. Viser lokalt bud.');
        return;
      }

      setLoading(true);
      try {
        const idToken = await currentUser.getIdToken();
        const response = await fetch(proxyUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            profile: {
              name: profile.name,
              gender: profile.gender,
              city: profile.city,
              preferredDays: profile.preferredDays,
              age: profile.age ?? profile.ageRaw ?? null,
              seedHash: profile.seedHash,
            },
            fallbackSuggestion,
            mood: selectedMood.key,
          }),
        });

        if (!response.ok) {
          const errorPayload = await response.json().catch(() => ({}));
          const detail =
            typeof errorPayload.detail === 'string'
              ? ` (${errorPayload.detail})`
              : '';
          throw new Error(
            `Proxy-svar ${response.status}${detail || ''}`.trim()
          );
        }

        const data = await response.json();
        const text = sanitizeString(data?.suggestion);
        if (!text) {
          throw new Error('Tomt svar fra proxy.');
        }

        if (requestMoodKey === currentMoodRef.current) {
          applySuggestion(text);
        }
      } catch (requestError) {
        // eslint-disable-next-line no-console
        console.warn('[AISuggestion] Proxy request failed', requestError);
        if (requestMoodKey === currentMoodRef.current) {
          applySuggestion(fallbackSuggestion);
          setError(
            'Kunne ikke hente AI-forslag fra skyen. Viser lokalt bud i stedet.'
          );
        }
      } finally {
        setLoading(false);
      }

      return;
    }

    if (!directApiKey) {
      applySuggestion(fallbackSuggestion);
      setError(
        'Opsæt OPENAI_PROXY_URL eller backend-proxy for ægte AI-forslag. Viser lokalt bud.'
      );
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${directApiKey}`,
          },
          body: JSON.stringify(buildRequestBody()),
        }
      );

      if (!response.ok) {
        const errorPayload = await response.text();
        throw new Error(
          `OpenAI-svar ${response.status}: ${errorPayload.slice(0, 120)}`
        );
      }

      const data = await response.json();
      const text =
        data?.choices?.[0]?.message?.content?.trim() ||
        data?.choices?.[0]?.text?.trim();

      if (!text) {
        throw new Error('Tomt svar fra OpenAI.');
      }

      if (requestMoodKey === currentMoodRef.current) {
        applySuggestion(text);
      }
    } catch (requestError) {
      // eslint-disable-next-line no-console
      console.warn('[AISuggestion] OpenAI request failed', requestError);
      if (requestMoodKey === currentMoodRef.current) {
        applySuggestion(fallbackSuggestion);
        setError(
          'Kunne ikke hente AI-forslag lige nu. Viser lokalt bud i stedet.'
        );
      }
    } finally {
      setLoading(false);
    }
  }, [
    buildRequestBody,
    directApiKey,
    applySuggestion,
    fallbackSuggestion,
    profile.age,
    profile.ageRaw,
    profile.city,
    profile.gender,
    profile.name,
    profile.preferredDays,
    profile.seedHash,
    proxyUrl,
    selectedMood.key,
  ]);

  const captionText = proxyUrl
    ? 'Genereres via FamTime Cloud Function (OpenAI).'
    : directApiKey
      ? ''
      : 'Lokalt forslag. Opsæt backend-proxy for ægte AI-tekst.';

  const moodPicker = !allowMoodSelection ? null : (
    <Modal
      transparent
      animationType="fade"
      visible={moodPickerVisible}
      onRequestClose={handleCloseMoodPicker}
    >
      <View style={styles.moodModalBackdrop}>
        <Pressable
          style={styles.moodModalScrim}
          onPress={handleCloseMoodPicker}
        />
        <View style={styles.moodModalCard}>
          <Text style={styles.moodModalTitle}>Vælg humør</Text>
          <Text style={styles.moodModalCaption}>
            Dit humør hjælper os med at ramme stemningen for næste aktivitet.
          </Text>
          {MOOD_OPTIONS.map((option) => {
            const isActive = option.key === selectedMood.key;
            return (
              <Pressable
                key={option.key}
                style={[
                  styles.moodOption,
                  isActive ? styles.moodOptionActive : null,
                ]}
                onPress={() => handleSelectMood(option.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
              >
                <View style={styles.moodOptionHeader}>
                  <Text style={styles.moodOptionLabel}>{option.label}</Text>
                  {isActive ? (
                    <Text style={styles.moodOptionBadge}>Valgt</Text>
                  ) : null}
                </View>
                <Text style={styles.moodOptionHint}>
                  {option.description}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </Modal>
  );

  if (isInline) {
    return (
      <>
        <View style={styles.inlineContainer}>
          <View style={styles.inlineControls}>
            {allowMoodSelection ? (
              <Pressable
                onPress={handleOpenMoodPicker}
                disabled={loading}
                accessibilityRole="button"
                accessibilityLabel="Vælg humør til forslaget"
                style={({ pressed }) => [
                  styles.moodSelector,
                  styles.inlineMoodSelector,
                  pressed && !loading ? styles.moodSelectorPressed : null,
                  loading ? styles.moodSelectorDisabled : null,
                ]}
              >
                <Text style={styles.moodSelectorLabel}>
                  {selectedMood.label}
                </Text>
                <Text style={styles.moodSelectorIcon}>v</Text>
              </Pressable>
            ) : null}
            <Button
              title={loading ? 'Henter forslag…' : 'Generer AI-forslag'}
              onPress={handleGenerate}
              loading={loading}
              style={styles.inlineButton}
            />
          </View>
        {captionText ? (
          <Text style={styles.inlineCaption}>{captionText}</Text>
        ) : null}
          <Text style={styles.inlineHint}>{moodHelperText}</Text>
          {error ? <Text style={styles.inlineError}>{error}</Text> : null}
        </View>
        {moodPicker}
      </>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.heading}>FamTime forslag (AI)</Text>
        {allowMoodSelection ? (
          <Pressable
            onPress={handleOpenMoodPicker}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel="Vælg humør til forslaget"
            style={({ pressed }) => [
              styles.moodSelector,
              pressed && !loading ? styles.moodSelectorPressed : null,
              loading ? styles.moodSelectorDisabled : null,
            ]}
          >
            <Text style={styles.moodSelectorLabel}>
              {selectedMood.label}
            </Text>
            <Text style={styles.moodSelectorIcon}>v</Text>
          </Pressable>
        ) : (
          <View style={[styles.moodSelector, styles.moodSelectorDisabled]}>
            <Text style={styles.moodSelectorLabel}>{selectedMood.label}</Text>
          </View>
        )}
      </View>

      {captionText ? <Text style={styles.caption}>{captionText}</Text> : null}
      <Text style={styles.moodHelper}>{moodHelperText}</Text>

      <Button
        title={loading ? 'Henter forslag…' : 'Generer AI-forslag'}
        onPress={handleGenerate}
        loading={loading}
        style={styles.button}
      />

      {hasGenerated ? (
        <View style={styles.suggestionBox}>
          <Text style={styles.suggestionText}>
            {suggestion || fallbackSuggestion}
          </Text>
        </View>
      ) : null}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {moodPicker}
    </View>
  );
};



export default AISuggestion;
