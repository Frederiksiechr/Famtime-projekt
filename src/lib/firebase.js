/**
 * FIREBASE BOOTSTRAP
 * 
 * Denne fil initialiserer Firebase forbindelsen så hele appen kan bruge den.
 * 
 * Den bruges "compat" API som betyder at vi bruger den gamle Firebase-stil
 * (i stedet for den nye modulær stil). Det giver bedre kompatibilitet med
 * React Native og Expo.
 * 
 * Eksporterer:
 * - firebase: Hele Firebase-biblioteket
 * - auth: Firebase authentication (til login/logout)
 * - db: Firebase Firestore database (til at gemme data)
 */
import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import 'firebase/compat/firestore';

import { firebaseConfig } from '../config/firebaseConfig';

/**
 * INITIALISERING AF FIREBASE
 * 
 * firebase.apps.length tjekker om Firebase er allerede initialiseret.
 * 
 * Hvis det ikke er, kører vi firebase.initializeApp(firebaseConfig).
 * Dette sætter op forbindelsen til vores Firebase-projekt ved at bruge
 * konfigurationen (API-nøgler osv.) vi læste fra firebaseConfig.
 * 
 * Vi tjekker dette fordi Expo kan køre kode flere gange, og vi vil ikke
 * initialisere Firebase mere end én gang - det ville forårsage fejl.
 */
if (!firebase.apps.length) {
  // Sikrer at Firebase kun initialiseres én gang i Expo-miljøet.
  firebase.initializeApp(firebaseConfig);
}

/**
 * UDPAK VIGTIGE DELE
 * 
 * auth: Bruges til login, logout, create user osv. (alle bruger-relaterede ting)
 * db: Bruges til at læse og skrive data i databasen
 * 
 * Vi eksporterer dem så alle andre filer kan importere dem i stedet for
 * at skulle initialisere Firebase selv.
 */
const auth = firebase.auth();
const db = firebase.firestore();

/**
 * PERSISTENCE INDSTILLING
 * 
 * setPersistence(Auth.Persistence.NONE) betyder at vi IKKE skal huske brugeren
 * hvis appen bliver lukket.
 * 
 * Hver gang appen åbnes, skal brugeren logge ind igen.
 * Dette er en sikkerhedsforanstaltning på mobil - hvis telefonen bliver stjålet,
 * skal tyven ikke have adgang til brugeren's konto.
 * 
 * .catch() håndterer hvis denne indstilling fejler (det er sjældent men kan ske).
 */
auth
  .setPersistence(firebase.auth.Auth.Persistence.NONE)
  .catch((error) => {
    console.warn('[Firebase] Kunne ikke sætte persistence', error);
  });

/**
 * EKSPORTER ALT
 * 
 * Nu kan alle filer i projektet importere disse:
 * 
 * import { auth, db, firebase } from '../lib/firebase';
 * 
 * Og så kan de bruge:
 * - auth.signIn() til login
 * - auth.signOut() til logout
 * - db.collection('users').add() til at gemme data
 * - osv.
 */
export { firebase, auth, db };
