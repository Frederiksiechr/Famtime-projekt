/**
 * FamTime Cloud Functions
 *
 * - `openaiSuggestion`: proxy til OpenAI der skjuler API-nøglen.
 * - Verificerer Firebase ID token og bruger env config til OpenAI.
 */
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const axios = require('axios');

admin.initializeApp();

const REGION = 'europe-west1';

const sanitizeString = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
};

const toLabel = (dayKey) => {
  const mapping = {
    monday: 'Mandag',
    tuesday: 'Tirsdag',
    wednesday: 'Onsdag',
    thursday: 'Torsdag',
    friday: 'Fredag',
    saturday: 'Lørdag',
    sunday: 'Søndag',
  };

  const normalized = sanitizeString(dayKey).toLowerCase();
  return mapping[normalized] || normalized || 'ukendt dag';
};

const MOOD_PROMPTS = {
  balanced:
    'familien er i et balanceret humør og er åben for flere slags aktiviteter',
  relaxed: 'familien er i afslappet humør og ønsker lave tempo og hygge',
  energetic: 'familien er fuld af energi og søger en aktiv oplevelse',
  adventurous: 'familien er eventyrlysten og vil gerne prøve noget nyt',
  creative: 'familien er i kreativt humør og ønsker en aktivitet med fordybelse',
};

exports.openaiSuggestion = functions
  .region(REGION)
  .https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Allow-Methods', 'POST,OPTIONS');

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const authHeader = req.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing Firebase ID token' });
      return;
    }

    const idToken = authHeader.slice('Bearer '.length);

    try {
      await admin.auth().verifyIdToken(idToken);
    } catch (verifyError) {
      functions.logger.warn('Invalid Firebase token', verifyError);
      res.status(401).json({ error: 'Invalid Firebase ID token' });
      return;
    }

    const openAiKey = functions.config().openai?.key;
    if (!openAiKey) {
      res.status(500).json({ error: 'OpenAI key not configured' });
      return;
    }

    const model = functions.config().openai?.model || 'gpt-4o-mini';

    const { profile = {}, fallbackSuggestion, mood } = req.body || {};

    if (typeof fallbackSuggestion !== 'string') {
      res.status(400).json({ error: 'Missing fallbackSuggestion' });
      return;
    }

    const name = sanitizeString(profile.name);
    const gender = sanitizeString(profile.gender);
    const city = sanitizeString(profile.city);
    const preferredDays = Array.isArray(profile.preferredDays)
      ? profile.preferredDays.map((day) => sanitizeString(day))
      : [];
    const age =
      typeof profile.age === 'number'
        ? profile.age
        : Number.isFinite(Number(profile.age))
        ? Number(profile.age)
        : null;
    const seedHash =
      typeof profile.seedHash === 'number'
        ? profile.seedHash
        : Number.isFinite(Number(profile.seedHash))
        ? Number(profile.seedHash)
        : null;

    const preferredDayLabels = preferredDays.length
      ? preferredDays.map(toLabel).join(', ')
      : 'Ingen registrerede';

    const weekdayDays = preferredDays.filter((day) => {
      const normalized = sanitizeString(day).toLowerCase();
      return !['friday', 'saturday', 'sunday'].includes(normalized);
    });

    const weekendDays = preferredDays.filter((day) => {
      const normalized = sanitizeString(day).toLowerCase();
      return ['friday', 'saturday', 'sunday'].includes(normalized);
    });

    const moodKey = sanitizeString(mood).toLowerCase();
    const moodDetail =
      MOOD_PROMPTS[moodKey] || MOOD_PROMPTS.balanced || '';

    const systemPrompt = [
      'Du er FamTime-assistenten og skriver på dansk i én kort linje.',
      'Max 18 ord, ingen emoji, slogans eller bindestreger.',
      'Brug basisforslaget til fakta og lever præcis ét forslag, hvor dag/aktivitet/by bevares og tonen matcher humøret.',
      'Format: "[Dag: ]<kort lead> <aktivitet> [i <by>] (<kort nuance>)".',
    ].join(' ');

    const userPrompt = [
      'Brugerdata (kun til tone, nævn dem ikke direkte):',
      `Navn: ${name || 'FamTime-vennen'}`,
      `Alder: ${age ?? 'ukendt'}`,
      `Køn: ${gender || 'ukendt'}`,
      `By: ${city || 'ukendt'}`,
      `Humør: ${moodDetail}`,
      `Foretrukne dage: ${preferredDayLabels}`,
      '',
      `Basisforslag: "${fallbackSuggestion}"`,
      '',
      'Instruktioner:',
      '1) Bevar dag, aktivitet og evt. lokation fra basisforslaget.',
      '2) Svar med én kort linje (sætning eller fragment), max 18 ord.',
      `3) Tonespecifik note: ${moodDetail}. Nævn ikke navn, alder eller køn, og skriv aldrig "Velkommen til FamTime".`,
    ].join('\n');

    const lowerModel = typeof model === 'string' ? model.toLowerCase() : '';
    const requestBody = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    };
    if (!lowerModel.includes('gpt-5')) {
      requestBody.temperature = 0;
    }

    try {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        requestBody,
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${openAiKey}`,
          },
          timeout: 15000,
        }
      );

      const suggestion =
        response.data?.choices?.[0]?.message?.content?.trim() || null;

      if (!suggestion) {
        throw new Error('Empty response from OpenAI');
      }

      res.status(200).json({ suggestion });
    } catch (error) {
      functions.logger.error('OpenAI request failed', error);
      res.status(502).json({
        error: 'OpenAI proxy error',
        detail: error?.message?.slice?.(0, 200) || 'Ukendt fejl',
      });
    }
  });
