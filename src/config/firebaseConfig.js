/**
 * FIREBASE KONFIGURATION
 * 
 * Denne fil sætter op hvordan appen skal forbinde til Firebase
 * (Googles databasetjeneste hvor vi gemmer brugerdata, aktiviteter osv.).
 * 
 * Den læser hemmeligheder fra forskellige kilder og sikrer at alt er
 * konfigureret korrekt før appen starter.
 */
import Constants from 'expo-constants';

/**
 * LÆSNING AF APP-INDSTILLINGER
 * 
 * Denne funktion forsøger at finde app-konfigurationen på tre forskellige steder:
 * 1. expoConfig.extra - Den nyeste måde
 * 2. manifest2.extra - En ældre måde
 * 3. manifest.extra - Endnu ældre måde
 * 
 * Det er fordi verschiedene versioner af Expo gemmer dette på forskellige steder.
 * Vi prøver alle tre for at være sikre på vi finder det.
 * 
 * Hvis ingenting findes, returnerer vi en tom objekt.
 */
const getExpoExtra = () => {
  const extra =
    Constants?.expoConfig?.extra ??
    Constants?.manifest2?.extra ??
    Constants?.manifest?.extra;

  return typeof extra === 'object' && extra !== null ? extra : {};
};

/**
 * LÆSNING AF MILJØVARIABLER
 * 
 * Miljøvariabler er "hemmeligheder" der gemmes på serveren eller i
 * opsætningsfiler - de må ALDRIG være i koden direkte.
 * 
 * Denne funktion:
 * 1. Tjekker om der er en miljøvariabel med det navn
 * 2. Hvis ja, fjerner mellemrum fra start og slut
 * 3. Hvis der er noget tilbage, returnerer det
 * 4. Hvis nej, returnerer undefined
 * 
 * Eksempel: readEnv('FIREBASE_API_KEY') finder værdien af FIREBASE_API_KEY
 * miljøvariablen.
 */
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

/**
 * LES APP-INDSTILLINGER OG MILJØVARIABLER
 * 
 * Vi loader de eksterne indstillinger (fra Expo og miljøvariabler).
 */
const extra = getExpoExtra();

/**
 * FIREBASE KONFIGURATIONEN
 * 
 * Denne objekt indeholder alle de væsentlige data som Firebase har brug for
 * for at kende til vores app. Det er som en "nøgle" der giver os adgang til
 * vores Firebase database.
 * 
 * For hver egenskab:
 * - Først prøver vi at få den fra Expo indstillingerne (extra)
 * - Hvis den ikke findes der, prøver vi miljøvariablerne via readEnv
 * - Hvis den ikke findes nogen steder, bruges et tomt string
 * 
 * ?? betyder "hvis det til venstre er undefined eller null, brug det til højre i stedet"
 */
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

/**
 * TILFØJ MEASUREMENT ID HVIS DEN FINDES
 * 
 * Measurement ID bruges til Google Analytics (til at spore hvordan brugerne
 * bruger appen). Den er valgfri - hvis den ikke findes, virker appen stadig.
 * 
 * Vi tjekker at den er en tekst og ikke tom før vi tilføjer den.
 */
const measurementId =
  extra.firebaseMeasurementId ?? readEnv('FIREBASE_MEASUREMENT_ID');

if (typeof measurementId === 'string' && measurementId.trim().length > 0) {
  config.measurementId = measurementId;
}

/**
 * TJEK FOR MANGLENDE KONFIGURATION
 * 
 * Disse 6 værdier er absolut påkrævet for at Firebase kan virke.
 * Hvis nogen af dem mangler, kan appen ikke forbinde til databasen.
 * 
 * requiredKeys: Listen over værdier der SKAL være der
 * missingKeys: Listen over værdier der IKKE fandtes
 * 
 * Hvis der mangler noget, viser vi en advarsel i konsollen så
 * udvikler kan se at noget er galt.
 */
const requiredKeys = [
  'apiKey',
  'authDomain',
  'projectId',
  'storageBucket',
  'messagingSenderId',
  'appId',
];

/**
 * FIND MANGLENDE VÆRDIER
 * 
 * Vi går gennem hver påkrævet nøgle og tjekker om:
 * 1. Den eksisterer i config
 * 2. Den er en tekst
 * 3. Den er ikke blot mellemrum
 * 
 * Hvis nogen af de tre ikke passer, føjes den til missingKeys listen.
 */
const missingKeys = requiredKeys.filter((key) => {
  const value = config[key];
  return typeof value !== 'string' || value.trim() === '';
});

/**
 * VIS ADVARSEL HVIS DER ER FEJL
 * 
 * Hvis der mangler en eller flere værdier, viser vi en advarsel i konsollen.
 * Dette hjælper udvikler med at opdage hvis opsætningen er forkert.
 * 
 * console.warn betyder "vis denne besked som en advarsel" (gul tekst i konsollen).
 */
if (missingKeys.length > 0) {
  console.warn(
    '[Firebase] Missing required Firebase config keys:',
    missingKeys.join(', ')
  );
}

/**
 * EKSPORTÉR KONFIGURATIONEN
 * 
 * "export" betyder at andre filer kan importere firebaseConfig og bruge den.
 * 
 * Når andre filer (som lib/firebase.js) importerer denne config,
 * får de alle de Firebase indstillinger de har brug for.
 * 
 * Eksempel: import { firebaseConfig } from './config/firebaseConfig'
 */
export const firebaseConfig = config;
