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

const WEEKDAY_ACTIVITIES = [
  {
    key: 'coffee_walk',
    label: 'Kaffemøde & gåtur',
    detail: '(45–60 minutter, uformelt)',
    tone: 'adult',
    moods: ['balanced', 'relaxed'],
  },
  {
    key: 'boardgames_tea',
    label: 'Brætspil & te',
    detail: '(hyggeligt og afslappet)',
    tone: 'neutral',
    moods: ['balanced', 'relaxed', 'creative'],
  },
  {
    key: 'museum_short',
    label: 'Museumsbesøg (kort)',
    detail: '(kulturpause på 1–2 timer)',
    tone: 'adult',
    moods: ['balanced', 'creative'],
  },
  {
    key: 'weekday_cinema',
    label: 'Bio – hverdagsvisning',
    detail: '(rolig sal og gode billetter)',
    tone: 'youth',
    moods: ['balanced', 'energetic', 'adventurous'],
  },
  {
    key: 'ceramic_paint_studio',
    label: 'Keramikmaling hos værksted',
    detail: '(mal kopper eller skåle i 2 timer)',
    tone: 'neutral',
    moods: ['creative'],
  },
  {
    key: 'plant_pot_lab',
    label: 'Potteplanter & maling',
    detail: '(hjemmeprojekt med pensler og planter)',
    tone: 'neutral',
    moods: ['creative', 'relaxed'],
  },
  {
    key: 'makerspace_dropin',
    label: 'Makerspace drop-in',
    detail: '(3D-print, laserskæring eller tekstil)',
    tone: 'adult',
    moods: ['creative', 'adventurous'],
  },
  {
    key: 'lyric_cafe',
    label: 'Lyrik & latte',
    detail: '(åben mic og notesbøger)',
    tone: 'neutral',
    moods: ['creative', 'balanced'],
  },
];

const WEEKEND_ACTIVITIES = [
  {
    key: 'brunch_walk',
    label: 'Brunch & gåtur',
    detail: '(1–2 timer, lavt budget)',
    tone: 'adult',
    moods: ['balanced', 'relaxed'],
  },
  {
    key: 'streetfood_market',
    label: 'Streetfood-marked',
    detail: '(god energi og masser at smage)',
    tone: 'youth',
    moods: ['balanced', 'energetic', 'adventurous'],
  },
  {
    key: 'picnic_park',
    label: 'Picnic i park',
    detail: '(afslappet og familievenligt)',
    tone: 'neutral',
    moods: ['balanced', 'relaxed', 'creative'],
  },
  {
    key: 'climbing_gym',
    label: 'Klatrehal/aktivitetscenter',
    detail: '(energi og grin for alle)',
    tone: 'youth',
    moods: ['energetic', 'adventurous'],
  },
  {
    key: 'evening_cinema',
    label: 'Aftenbio & dessert',
    detail: '(klassiker med forkælelse)',
    tone: 'adult',
    moods: ['balanced', 'relaxed'],
  },
  {
    key: 'pottery_weekend',
    label: 'Keramikworkshop',
    detail: '(drej, mal og glasér sammen)',
    tone: 'neutral',
    moods: ['creative'],
  },
  {
    key: 'art_lab_pop_up',
    label: 'Pop-up kunstværksted',
    detail: '(mal lærreder eller totebags)',
    tone: 'youth',
    moods: ['creative', 'adventurous'],
  },
  {
    key: 'gallery_crawl',
    label: 'Galleri-hop',
    detail: '(små udstillinger med kaffe undervejs)',
    tone: 'adult',
    moods: ['creative', 'balanced'],
  },
  {
    key: 'forest_photo_walk',
    label: 'Foto- og skovtur',
    detail: '(kamera, picnic og natur)',
    tone: 'neutral',
    moods: ['creative', 'relaxed'],
  },
];

export const MOOD_OPTIONS = [
  {
    key: 'balanced',
    label: 'Balanceret',
    description: 'Et åbent sind for både rolige og aktive forslag.',
    activityLead: 'Evt.',
    leads: ['Evt.', 'Prøv', 'Et bud:'],
    nuancePool: ['både ro og energi', 'passer alle aldre', 'fleksibel stemning'],
    prompt:
      'familien er i et balanceret humør og er åben for flere slags aktiviteter',
    helper: 'Standardvalg – giver alsidige forslag.',
  },
  {
    key: 'relaxed',
    label: 'Afslappet',
    description: 'Roligt tempo og plads til hygge.',
    activityLead: 'Roligt bud:',
    leads: ['Roligt bud:', 'Hygge-tip:', 'Langsomt tempo:'],
    nuancePool: ['lavt tempo', 'tid til hygge', 'rolig stemning'],
    prompt: 'familien er i afslappet humør og ønsker lave tempo og hygge',
    helper: 'Foreslår rolige aktiviteter.',
  },
  {
    key: 'energetic',
    label: 'Energisk',
    description: 'Høj puls og grin på programmet.',
    activityLead: 'Full energi:',
    leads: ['Full energi:', 'Højt gear:', 'Turbo-tip:'],
    nuancePool: ['giver høj puls', 'masser af energi', 'klar til grin'],
    prompt: 'familien er fuld af energi og søger en aktiv oplevelse',
    helper: 'Gode til bevægelse og aktivitet.',
  },
  {
    key: 'adventurous',
    label: 'Eventyrlysten',
    description: 'Klar på at prøve noget nyt.',
    activityLead: 'Lille eventyr:',
    leads: ['Lille eventyr:', 'Ny oplevelse:', 'Modigt bud:'],
    nuancePool: ['nyt at opdage', 'småt eventyr', 'overrask jer selv'],
    prompt: 'familien er eventyrlysten og vil gerne prøve noget nyt',
    helper: 'Til jer der vil opleve nye steder.',
  },
  {
    key: 'creative',
    label: 'Kreativ',
    description: 'Tid til projekter og fordybelse.',
    activityLead: 'Kreativt bud:',
    leads: ['Kreativt bud:', 'Skab-selv:', 'Idéværksted:'],
    nuancePool: ['plads til idéer', 'rolig fordybelse', 'fælles projekt'],
    prompt:
      'familien er i kreativt humør og ønsker en aktivitet med fordybelse',
    helper: 'Forslag med plads til kreativitet.',
  },
];

const DEFAULT_MOOD_KEY = MOOD_OPTIONS[0].key;

const MOOD_TONE_MAP = {
  balanced: [],
  relaxed: ['neutral', 'adult'],
  energetic: ['youth'],
  adventurous: ['youth', 'neutral'],
  creative: ['neutral', 'adult'],
};

const DAY_PREFIX_VARIANTS = {
  withDay: [
    (label) => `${label}: `,
    (label) => `${label} plan: `,
    (label) => `${label}, bud: `,
  ],
  withoutDay: [() => '', () => 'Snart: ', () => 'Når tiden passer: '],
};

const DEFAULT_NAME = 'FamTime-vennen';

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

const sanitizeString = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
};

const toTitleCase = (value) => {
  const clean = sanitizeString(value);
  if (!clean) {
    return '';
  }
  return clean
    .toLowerCase()
    .replace(/(^|\s|-)(\S)/g, (_match, boundary, char) => `${boundary}${char.toUpperCase()}`);
};

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

const simpleHash = (input) => {
  // Genererer et stabilt tal der bruges til deterministiske fallback-forslag.
  const str = String(input ?? '');
  let hash = 0;
  for (let index = 0; index < str.length; index += 1) {
    // eslint-disable-next-line no-bitwise
    hash = (hash * 31 + str.charCodeAt(index)) >>> 0;
  }
  return hash;
};

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

const pickVariant = (items, hashSeed, salt) => {
  if (!Array.isArray(items) || !items.length) {
    return null;
  }
  const index = simpleHash(`${hashSeed}|${salt}`) % items.length;
  return items[index];
};

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

export const generateProfileSuggestion = (
  user = {},
  moodKey = DEFAULT_MOOD_KEY
) => {
  const name = sanitizeString(user.name);
  const city = sanitizeString(user.city);
  const gender = sanitizeString(user.gender);
  const preferredDays = Array.isArray(user.preferredDays)
    ? user.preferredDays
    : [];
  const age = parseAge(user.age);
  const moodConfig =
    MOOD_OPTIONS.find((option) => option.key === moodKey) ?? MOOD_OPTIONS[0];

  const hashSeed = [
    name || DEFAULT_NAME,
    Number.isFinite(age) ? age : 'na',
    city || 'nocity',
    preferredDays.join('-') || 'nodays',
    moodConfig.key,
  ].join('|');

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

const AISuggestion = ({ user, onSuggestion, variant = 'card' }) => {
  const isInline = variant === 'inline';
  const [mood, setMood] = useState(DEFAULT_MOOD_KEY);
  const [moodPickerVisible, setMoodPickerVisible] = useState(false);
  const [suggestion, setSuggestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasGenerated, setHasGenerated] = useState(false);
  const currentMoodRef = useRef(DEFAULT_MOOD_KEY);

  const selectedMood = useMemo(() => {
    return (
      MOOD_OPTIONS.find((option) => option.key === mood) ?? MOOD_OPTIONS[0]
    );
  }, [mood]);
  const moodHelperText = selectedMood.helper ?? 'Humør påvirker næste forslag.';

  const handleOpenMoodPicker = useCallback(() => {
    setMoodPickerVisible(true);
  }, []);

  const handleCloseMoodPicker = useCallback(() => {
    setMoodPickerVisible(false);
  }, []);

  const handleSelectMood = useCallback((nextMoodKey) => {
    setMood(nextMoodKey);
    setMoodPickerVisible(false);
  }, []);

  const extra = useMemo(() => getExpoExtra(), []);
  const directApiKey = sanitizeString(extra.openaiApiKey);
  const directModel = sanitizeString(extra.openaiModel) || 'gpt-4o-mini';
  const proxyUrl = sanitizeString(extra.openaiProxyUrl);

  useEffect(() => {
    setHasGenerated(false);
    setSuggestion('');
    setError('');
  }, [mood]);

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
        selectedMood.key
      ),
    [profile, selectedMood.key]
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

  const preferredDayLabels = useMemo(() => {
    if (!profile.preferredDays.length) {
      return 'Ingen registrerede';
    }
    return profile.preferredDays.map(toLabel).join(', ');
  }, [profile.preferredDays]);

  const buildRequestBody = useCallback(() => {
    const weekdayDays = profile.preferredDays.filter(
      (day) => !WEEKEND_KEYS.includes(day)
    );
    const weekendDays = profile.preferredDays.filter((day) =>
      WEEKEND_KEYS.includes(day)
    );
    const moodDetail = `${selectedMood.label} – ${selectedMood.description}`;

    const systemPrompt = [
      'Du er FamTime-assistenten og skriver på dansk i én kort linje.',
      'Max 18 ord, ingen emoji, slogans eller bindestreger.',
      'Brug basisforslaget som fakta og lever præcis ét forslag, hvor dag/aktivitet/by bevares og tonen matcher humøret.',
      'Format: "[Dag: ]<kort lead> <aktivitet> [i <by>] (<kort nuance>)".',
    ].join(' ');

    const userPrompt = [
      'Brugerdata (kun til tone, nævn dem ikke direkte):',
      `Navn: ${profile.name || DEFAULT_NAME}`,
      `Alder: ${profile.age ?? 'ukendt'}`,
      `Køn: ${profile.gender || 'ukendt'}`,
      `By: ${profile.city || 'ukendt'}`,
      `Humør: ${moodDetail}`,
      `Foretrukne dage: ${preferredDayLabels}`,
      '',
      `Basisforslag: "${fallbackSuggestion}"`,
      '',
      'Instruktioner:',
      `1) Bevar dag, aktivitet og evt. lokation fra basisforslaget. Tonespecifik note: ${selectedMood.prompt}.`,
      '2) Svar med én kort linje (sætning eller fragment), max 18 ord.',
      '3) Nævn ikke navn, alder eller køn, og skriv aldrig "Velkommen til FamTime".',
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
      payload.temperature = 0;
    }
    return payload;
  }, [
    fallbackSuggestion,
    directModel,
    preferredDayLabels,
    profile,
    selectedMood.description,
    selectedMood.label,
    selectedMood.prompt,
  ]);

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
      ? 'Genereres live via OpenAI – brugerdata sendes kun i denne forespørgsel.'
      : 'Lokalt forslag. Opsæt backend-proxy for ægte AI-tekst.';

  const moodPicker = (
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
              <Text style={styles.moodSelectorLabel}>{selectedMood.label}</Text>
              <Text style={styles.moodSelectorIcon}>v</Text>
            </Pressable>
            <Button
              title={loading ? 'Henter forslag…' : 'Generer AI-forslag'}
              onPress={handleGenerate}
              loading={loading}
              style={styles.inlineButton}
            />
          </View>
          <Text style={styles.inlineCaption}>{captionText}</Text>
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
          <Text style={styles.moodSelectorLabel}>{selectedMood.label}</Text>
          <Text style={styles.moodSelectorIcon}>v</Text>
        </Pressable>
      </View>

      <Text style={styles.caption}>{captionText}</Text>
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
