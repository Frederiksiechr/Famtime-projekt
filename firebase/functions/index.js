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

    const { profile = {}, fallbackSuggestion } = req.body || {};

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

    const systemPrompt = [
      'Du er FamTime-assistenten. Du skriver på dansk og svarer med præcis én sætning.',
      'Du modtager rå brugerdata samt et basisforslag. Du finpudser sproget uden at ændre dag, aktivitet eller by fra basisforslaget.',
      'Tilføj gerne en kort nuance (stemning, varighed eller budget). Afslut altid med "Velkommen til FamTime!"',
      'Undgå at nævne manglende data.',
    ].join(' ');

    const userPrompt = [
      'Brugerdata:',
      `- Navn: ${name || 'FamTime-vennen'}`,
      `- Alder: ${age ?? 'ukendt'}`,
      `- Køn: ${gender || 'ukendt'}`,
      `- By: ${city || 'ukendt'}`,
      `- Foretrukne dage: ${preferredDayLabels}`,
      `- Seed: ${seedHash ?? 'ukendt'}`,
      `- Foretrukne hverdage: ${
        weekdayDays.length ? weekdayDays.map(toLabel).join(', ') : 'ingen'
      }`,
      `- Foretrukne weekenddage: ${
        weekendDays.length ? weekendDays.map(toLabel).join(', ') : 'ingen'
      }`,
      '',
      `Basisforslag: "${fallbackSuggestion}"`,
      '',
      'Forfin sætningen, men bevar dag, aktivitet og eventuel lokation uændret.',
      'Svar med præcis én dansk sætning.',
    ].join('\n');

    try {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model,
          temperature: 0,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        },
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
