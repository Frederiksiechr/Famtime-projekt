/**
 * Mapper Firebase Auth fejlkoder til brugerforståelige beskeder.
 *
 * @param {import('firebase/auth').AuthError | Error} error
 * @returns {string}
 */
export const getFriendlyAuthError = (error) => {
  const errorCode = typeof error?.code === 'string' ? error.code : '';

  if (!errorCode) {
    return 'Noget gik galt. Prøv igen.';
  }

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
