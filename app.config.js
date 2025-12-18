/**
 * APP CONFIGURATION
 *
 * Expo app-konfiguration med miljøvariabler for:
 * - OpenAI API-nøgle, model og proxy-URL
 * - Firebase-konfiguration (API-nøgle, auth domain, projekt-ID osv.)
 *
 * Alle værdier hentes fra .env-filen via process.env
 * med fallback-værdier hvis miljøvariablerne ikke er sat.
 */

import 'dotenv/config';

export default ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    /**
     * OPENAI CONFIGURATION
     * OpenAI API-nøgle, model-navn og proxy-URL for AI-features
     */
    openaiApiKey: process.env.OPENAI_API_KEY ?? '',
    openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
    openaiProxyUrl: process.env.OPENAI_PROXY_URL ?? '',

    /**
     * FIREBASE CONFIGURATION
     * Firebase-indstillinger for autentificering, realtime database og analytics
     */
    firebaseApiKey: process.env.FIREBASE_API_KEY ?? '',
    firebaseAuthDomain: process.env.FIREBASE_AUTH_DOMAIN ?? '',
    firebaseProjectId: process.env.FIREBASE_PROJECT_ID ?? '',
    firebaseStorageBucket: process.env.FIREBASE_STORAGE_BUCKET ?? '',
    firebaseMessagingSenderId:
      process.env.FIREBASE_MESSAGING_SENDER_ID ?? '',
    firebaseAppId: process.env.FIREBASE_APP_ID ?? '',
    firebaseMeasurementId: process.env.FIREBASE_MEASUREMENT_ID ?? '',
  },
});
