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
import { View, Text, StyleSheet, Pressable, Modal } from 'react-native';
import Constants from 'expo-constants';

import Button from './Button';
import { colors, spacing, fontSizes, radius } from '../styles/theme';
import { auth } from '../lib/firebase';

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
  },
  {
    key: 'boardgames_tea',
    label: 'Brætspil & te',
    detail: '(hyggeligt og afslappet)',
    tone: 'neutral',
  },
  {
    key: 'museum_short',
    label: 'Museumsbesøg (kort)',
    detail: '(kulturpause på 1–2 timer)',
    tone: 'adult',
  },
  {
    key: 'weekday_cinema',
    label: 'Bio – hverdagsvisning',
    detail: '(rolig sal og gode billetter)',
    tone: 'youth',
  },
];

const WEEKEND_ACTIVITIES = [
  {
    key: 'brunch_walk',
    label: 'Brunch & gåtur',
    detail: '(1–2 timer, lavt budget)',
    tone: 'adult',
  },
  {
    key: 'streetfood_market',
    label: 'Streetfood-marked',
    detail: '(god energi og masser at smage)',
    tone: 'youth',
  },
  {
    key: 'picnic_park',
    label: 'Picnic i park',
    detail: '(afslappet og familievenligt)',
    tone: 'neutral',
  },
  {
    key: 'climbing_gym',
    label: 'Klatrehal/aktivitetscenter',
    detail: '(energi og grin for alle)',
    tone: 'youth',
  },
  {
    key: 'evening_cinema',
    label: 'Aftenbio & dessert',
    detail: '(klassiker med forkælelse)',
    tone: 'adult',
  },
];

export const MOOD_OPTIONS = [
  {
    key: 'balanced',
    label: 'Balanceret',
    description: 'Et åbent sind for både rolige og aktive forslag.',
    activityLead: 'et godt bud er',
    closing: 'Et balanceret valg, der passer til stemningen.',
    prompt:
      'familien er i et balanceret humør og er åben for flere slags aktiviteter',
    helper: 'Standardvalg – giver alsidige forslag.',
  },
  {
    key: 'relaxed',
    label: 'Afslappet',
    description: 'Roligt tempo og plads til hygge.',
    activityLead: 'noget afslappende som',
    closing: 'Rolige rammer til den afslappede energi.',
    prompt: 'familien er i afslappet humør og ønsker lave tempo og hygge',
    helper: 'Foreslår rolige aktiviteter.',
  },
  {
    key: 'energetic',
    label: 'Energisk',
    description: 'Høj puls og grin på programmet.',
    activityLead: 'noget energisk som',
    closing: 'Giver plads til al den ekstra energi.',
    prompt: 'familien er fuld af energi og søger en aktiv oplevelse',
    helper: 'Gode til bevægelse og aktivitet.',
  },
  {
    key: 'adventurous',
    label: 'Eventyrlysten',
    description: 'Klar på at prøve noget nyt.',
    activityLead: 'et lille eventyr som',
    closing: 'Perfekt til at udforske noget nyt sammen.',
    prompt: 'familien er eventyrlysten og vil gerne prøve noget nyt',
    helper: 'Til jer der vil opleve nye steder.',
  },
  {
    key: 'creative',
    label: 'Kreativ',
    description: 'Tid til projekter og fordybelse.',
    activityLead: 'et kreativt indslag som',
    closing: 'Skaber plads til idéer og fælles projekter.',
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

const TEMPLATE_VARIANTS = [
  '{intro} {dayClause}, så prøv {activityPhrase} – velkommen til FamTime!',
  '{intro} {dayClause}; et bud er {activityPhrase} – velkommen til FamTime!',
  '{intro} {dayClause}, og {activityPhrase} kan blive jeres næste plan – velkommen til FamTime!',
];

const DAY_SENTENCES = {
  withDay: [
    (day) => `ønsker at mødes på ${day}`,
    (day) => `satser på tid sammen ${day}`,
  ],
  withoutDay: [
    () => 'er klar til at finde tid sammen',
    () => 'er åben for at finde den næste familietid',
  ],
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
  const str = String(input ?? '');
  let hash = 0;
  for (let index = 0; index < str.length; index += 1) {
    // eslint-disable-next-line no-bitwise
    hash = (hash * 31 + str.charCodeAt(index)) >>> 0;
  }
  return hash;
};

const selectTemplate = (hashSeed) => {
  const hash = simpleHash(`${hashSeed}|template`);
  return TEMPLATE_VARIANTS[hash % TEMPLATE_VARIANTS.length];
};

const selectDayClause = (hashSeed, dayKey) => {
  const clauseOptions = dayKey
    ? DAY_SENTENCES.withDay
    : DAY_SENTENCES.withoutDay;
  const hash = simpleHash(`${hashSeed}|dayClause`);
  const resolver = clauseOptions[hash % clauseOptions.length];
  const label = dayKey ? DAY_LABELS[dayKey]?.toLowerCase?.() ?? dayKey : null;
  return resolver(label);
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

  const toneBucket =
    tonePreference === null
      ? []
      : catalog.filter((item) => item.tone === tonePreference);

  const moodTones = MOOD_TONE_MAP[moodKey] ?? [];
  const moodBucket = moodTones.length
    ? catalog.filter((item) => moodTones.includes(item.tone))
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

  const priorityPool = dedupeByKey([...moodBucket, ...toneBucket]);
  const priorityPick = pickFromBucket(priorityPool, 'priority');
  if (priorityPick) {
    return priorityPick;
  }

  const catalogPick = pickFromBucket(catalog, 'all');
  return catalogPick ?? catalog[0];
};

const buildIntro = (name, age, city, gender) => {
  const parts = [];
  parts.push(name || DEFAULT_NAME);

  if (typeof age === 'number') {
    parts.push(`${age} år`);
  }

  if (city) {
    parts.push(`fra ${city}`);
  }

  const base = parts.join(', ');
  if (gender) {
    return `${base} (${gender})`;
  }

  return base;
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
  const template = selectTemplate(hashSeed);
  const dayClause = selectDayClause(hashSeed, selectedDay);
  const intro = buildIntro(name, age, city, gender);

  const citySegment = city ? ` i ${city}` : '';
  const detailSegment = activity.detail ? ` ${activity.detail}` : '';
  const activityLead = moodConfig?.activityLead ?? 'et godt bud er';
  const activityPhrase =
    `${activityLead} ${activity.label}${citySegment}${detailSegment}`.trim();
  const closingRemark = moodConfig?.closing ? moodConfig.closing : '';

  const baseSuggestion = template
    .replace('{intro}', intro)
    .replace('{dayClause}', dayClause)
    .replace('{activityPhrase}', activityPhrase);

  return closingRemark ? `${baseSuggestion} ${closingRemark}` : baseSuggestion;
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
      'Du er FamTime-assistenten. Du skriver på dansk og svarer med præcis én sætning.',
      'Du får både rå brugerdata og et deterministisk basisforslag. Din opgave er at polere teksten uden at ændre dag, aktivitet eller by fra basisforslaget.',
      'Tilføj gerne en kort nuance (fx stemning, varighed eller budget), men alt skal være i én sætning med venlig tone.',
      'Tag højde for brugerens humør og sørg for, at tonen matcher.',
      'Hvis nogle informationer mangler, nævn dem ikke. Afslut altid med "Velkommen til FamTime!"',
    ].join(' ');

    const userPrompt = [
      'Brugerdata:',
      `- Navn: ${profile.name || DEFAULT_NAME}`,
      `- Alder: ${profile.age ?? 'ukendt'}`,
      `- Køn: ${profile.gender || 'ukendt'}`,
      `- By: ${profile.city || 'ukendt'}`,
      `- Foretrukne dage: ${preferredDayLabels}`,
      `- Seed (stabilitet): ${profile.seedHash}`,
      `- Humør: ${moodDetail}`,
      `- Foretrukne hverdage: ${
        weekdayDays.length ? weekdayDays.map(toLabel).join(', ') : 'ingen'
      }`,
      `- Foretrukne weekenddage: ${
        weekendDays.length ? weekendDays.map(toLabel).join(', ') : 'ingen'
      }`,
      '',
      `Deterministisk basisforslag: "${fallbackSuggestion}"`,
      '',
      `Forfin sætningen uden at ændre informationerne. Bevar stemningen fra humøret: ${selectedMood.prompt}.`,
      'Forfin sætningen, men bevar dag, aktivitet og eventuel lokation uændret.',
      'Svar med præcis én sætning på dansk.',
    ].join('\n');

    return {
      model: directModel,
      temperature: 0,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    };
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

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: colors.shadow,
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
    gap: spacing.sm,
  },
  heading: {
    fontSize: fontSizes.lg,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
  },
  caption: {
    fontSize: fontSizes.sm,
    color: colors.mutedText,
    marginBottom: spacing.xs,
  },
  moodHelper: {
    fontSize: fontSizes.xs,
    color: colors.mutedText,
    marginBottom: spacing.md,
  },
  moodSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    shadowColor: colors.shadow,
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  moodSelectorPressed: {
    transform: [{ scale: 0.97 }],
    opacity: 0.9,
  },
  moodSelectorDisabled: {
    opacity: 0.6,
  },
  moodSelectorLabel: {
    fontSize: fontSizes.sm,
    fontWeight: '600',
    color: colors.text,
    marginRight: spacing.xs,
  },
  moodSelectorIcon: {
    fontSize: fontSizes.sm,
    color: colors.mutedText,
  },
  button: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  suggestionBox: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.md,
  },
  suggestionText: {
    fontSize: fontSizes.md,
    color: colors.text,
    lineHeight: 22,
  },
  errorText: {
    marginTop: spacing.sm,
    color: colors.error,
    fontSize: fontSizes.sm,
  },
  inlineContainer: {
    marginTop: spacing.md,
    marginBottom: spacing.md,
    alignItems: 'flex-start',
    gap: spacing.xs,
  },
  inlineControls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  inlineMoodSelector: {
    shadowOpacity: 0,
    elevation: 0,
  },
  inlineButton: {
    alignSelf: 'flex-start',
    marginTop: 0,
    marginBottom: 0,
    paddingHorizontal: spacing.md,
  },
  inlineCaption: {
    fontSize: fontSizes.xs,
    color: colors.mutedText,
  },
  inlineHint: {
    fontSize: fontSizes.xs,
    color: colors.mutedText,
  },
  inlineError: {
    fontSize: fontSizes.xs,
    color: colors.error,
  },
  moodModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(75, 46, 18, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  moodModalScrim: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'transparent',
  },
  moodModalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    shadowColor: colors.shadow,
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 14 },
    elevation: 6,
  },
  moodModalTitle: {
    fontSize: fontSizes.lg,
    fontWeight: '700',
    color: colors.text,
  },
  moodModalCaption: {
    fontSize: fontSizes.sm,
    color: colors.mutedText,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  moodOption: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    marginBottom: spacing.sm,
  },
  moodOptionActive: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(230, 138, 46, 0.18)',
  },
  moodOptionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
    gap: spacing.xs,
  },
  moodOptionLabel: {
    fontSize: fontSizes.md,
    fontWeight: '600',
    color: colors.text,
  },
  moodOptionBadge: {
    backgroundColor: colors.primary,
    color: colors.primaryText,
    fontSize: fontSizes.xs,
    fontWeight: '700',
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: 999,
  },
  moodOptionHint: {
    fontSize: fontSizes.xs,
    color: colors.mutedText,
  },
});

export default AISuggestion;
