/**
 * Firebase bootstrapper (compat for React Native)
 *
 * - Bruger Firebase compat-API for maksimal kompatibilitet i Expo/RN.
 * - Eksporterer `firebase`, `auth` og `db` så resten af appen kan genbruge instanserne.
 */
import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/firestore';

import { firebaseConfig } from '../config/firebaseConfig';

if (!firebase.apps.length) {
  // Sikrer at Firebase kun initialiseres én gang i Expo-miljøet.
  firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const db = firebase.firestore();

auth
  .setPersistence(firebase.auth.Auth.Persistence.NONE)
  .catch((error) => {
    console.warn('[Firebase] Kunne ikke sætte persistence', error);
  });

export { firebase, auth, db };
