/**
 * FEJLBESKED MAPPER
 * 
 * Denne fil omdanner tekniske fejlkoder fra Firebase til pæne beskeder
 * på dansk som almindelige brugere kan forstå.
 * 
 * Firebase returnerer fejlkoder som "auth/invalid-email" eller "auth/wrong-password",
 * men brugerne skal se: "E-mailen er ikke gyldig" eller "Adgangskode er forkert".
 * 
 * @param {import('firebase/auth').AuthError | Error} error
 * @returns {string}
 */

/**
 * VENLIG FEJLBESKED FRA FIREBASE AUTH-FEJLER
 * 
 * Denne funktion tager en fejl-objekt fra Firebase og konverterer
 * fejlkoden til en human-venlig tekst.
 * 
 * Hvis der ikke er en kendt fejlkode, vises en generisk "noget gik galt" besked.
 * 
 * Eksempler:
 * - "auth/user-not-found" → "E-mail eller adgangskode er forkert."
 * - "auth/weak-password" → "Adgangskoden skal mindst være 6 tegn."
 * - "auth/network-request-failed" → "Ingen forbindelse til nettet..."
 */
export const getFriendlyAuthError = (error) => {
  const errorCode = typeof error?.code === 'string' ? error.code : '';

  if (!errorCode) {
    return 'Noget gik galt. Prøv igen.';
  }

  /**
   * SWITCH-STATEMENT - OMDANN FEJLKODE TIL BESKED
   * 
   * Vi tjekker hver kendt fejlkode og returnerer en pæn besked.
   * 
   * Nogle fejler har flere koder som skal give samme besked
   * (f.eks. "user-not-found" og "wrong-password" begge betyder
   * "bruger eller adgangskode er forkert").
   */
  switch (errorCode) {
    case 'auth/invalid-email':
      return 'E-mailen er ikke gyldig.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
      return 'E-mail eller adgangskode er forkert.';
    case 'auth/weak-password':
      return 'Adgangskoden skal mindst være 6 tegn.';
    case 'auth/email-already-in-use':
      return 'Der findes allerede en bruger med denne e-mail.';
    case 'auth/too-many-requests':
      return 'For mange forsøg. Vent lidt og prøv igen.';
    case 'auth/user-disabled':
      return 'Denne konto er deaktiveret. Kontakt FamTime for hjælp.';
    case 'auth/network-request-failed':
      return 'Ingen forbindelse til nettet. Tjek din internetforbindelse og prøv igen.';
    case 'auth/internal-error':
      return 'Firebase kunne ikke logge dig ind. Prøv igen om et øjeblik.';
    default:
      return `Noget gik galt. Prøv igen. (${errorCode})`;
  }
};
