import axios from 'axios';

/** Convertit une erreur de transport/API en message d’interface sans exposer sa réponse brute. */
export function userFacingError(
  error: unknown,
  fallback = 'Impossible de charger ces informations. Veuillez réessayer.',
  validationMessage = 'Vérifiez les informations saisies puis réessayez.',
): string {
  if (!axios.isAxiosError(error)) return fallback;

  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    return 'La demande prend trop de temps. Veuillez réessayer.';
  }

  if (!error.response) {
    return 'Impossible de joindre le service. Vérifiez votre connexion puis réessayez.';
  }

  switch (error.response.status) {
    case 401:
      return 'Votre session ou vos identifiants ne permettent pas cette action. Vérifiez-les puis réessayez.';
    case 403:
      return 'Vous n’avez pas accès à cette action.';
    case 422:
      return validationMessage;
    default:
      return fallback;
  }
}
