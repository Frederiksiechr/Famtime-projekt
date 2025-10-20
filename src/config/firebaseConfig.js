import Constants from 'expo-constants';

const getExpoExtra = () => {
  const extra =
    Constants?.expoConfig?.extra ??
    Constants?.manifest2?.extra ??
    Constants?.manifest?.extra;

  return typeof extra === 'object' && extra !== null ? extra : {};
};

const readEnv = (key) => {
  if (
    typeof process !== 'undefined' &&
    process.env &&
    typeof process.env[key] === 'string'
  ) {
    const value = process.env[key];
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return undefined;
};

const extra = getExpoExtra();

const config = {
  apiKey: extra.firebaseApiKey ?? readEnv('FIREBASE_API_KEY') ?? '',
  authDomain:
    extra.firebaseAuthDomain ?? readEnv('FIREBASE_AUTH_DOMAIN') ?? '',
  projectId: extra.firebaseProjectId ?? readEnv('FIREBASE_PROJECT_ID') ?? '',
  storageBucket:
    extra.firebaseStorageBucket ?? readEnv('FIREBASE_STORAGE_BUCKET') ?? '',
  messagingSenderId:
    extra.firebaseMessagingSenderId ??
    readEnv('FIREBASE_MESSAGING_SENDER_ID') ??
    '',
  appId: extra.firebaseAppId ?? readEnv('FIREBASE_APP_ID') ?? '',
};

const measurementId =
  extra.firebaseMeasurementId ?? readEnv('FIREBASE_MEASUREMENT_ID');

if (typeof measurementId === 'string' && measurementId.trim().length > 0) {
  config.measurementId = measurementId;
}

const requiredKeys = [
  'apiKey',
  'authDomain',
  'projectId',
  'storageBucket',
  'messagingSenderId',
  'appId',
];

const missingKeys = requiredKeys.filter((key) => {
  const value = config[key];
  return typeof value !== 'string' || value.trim() === '';
});

if (missingKeys.length > 0) {
  console.warn(
    '[Firebase] Missing required Firebase config keys:',
    missingKeys.join(', ')
  );
}

export const firebaseConfig = config;
