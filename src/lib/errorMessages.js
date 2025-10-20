/**
 * Mapper Firebase Auth fejlkoder til brugerforståelige beskeder.
 *
 * @param {import('firebase/auth').AuthError | Error} error
 * @returns {string}
 */
export const getFriendlyAuthError = (error) => {
  if (!error || !error.code) {
    return 'Noget gik galt. Prøv igen.';
  }

  switch (error.code) {
    case 'auth/invalid-email':
      return 'E-mailen er ikke gyldig.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return 'E-mail eller adgangskode er forkert.';
    case 'auth/weak-password':
      return 'Adgangskoden skal mindst være 6 tegn.';
    case 'auth/email-already-in-use':
      return 'Der findes allerede en bruger med denne e-mail.';
    case 'auth/too-many-requests':
      return 'For mange forsøg. Vent lidt og prøv igen.';
    default:
      return 'Noget gik galt. Prøv igen.';
  }
};
