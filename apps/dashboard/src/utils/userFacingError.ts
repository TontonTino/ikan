import axios from 'axios';

/**
 * Message de refus écrit EN FRANÇAIS par notre API pour un envoi de formulaire (400 ou 422) : seuil hors plage, mot de passe
 * trop court, e-mail déjà utilisé, agence obligatoire… Seules sont reprises les réponses dont le texte est celui de nos propres
 * validations (`detail` en texte, ou erreur de type `value_error` / `missing`) ; toute autre réponse donne null et l'écran garde
 * son message générique (voir userFacingError). Le mot de passe saisi n'est jamais dans ces réponses (voir erreurs_validation.py).
 */
export function messageRefusServeur(error: unknown): string | null {
  if (!axios.isAxiosError(error) || ![400, 422].includes(error.response?.status ?? 0)) return null;
  const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail;
  let message: string | null = null;
  if (typeof detail === 'string') message = detail;
  else if (Array.isArray(detail)) {
    const erreur = detail.find((e) => e && (e.type === 'value_error' || e.type === 'missing') && typeof e.msg === 'string');
    message = erreur ? erreur.msg : null;
  }
  return message && message.length <= 200 ? message : null;
}

/** Convertit une erreur de transport/API en message d’interface sans exposer sa réponse brute. */
export function userFacingError(
  error: unknown,
  fallback = 'Impossible de charger ces informations. Veuillez réessayer.',
  validationMessage = 'Vérifiez les informations saisies puis réessayez.',
  // Messages propres à l'écran pour un statut HTTP précis (ex. 409 : doublon). Jamais le texte brut de l'API.
  byStatus: Partial<Record<number, string>> = {},
): string {
  if (!axios.isAxiosError(error)) return fallback;

  if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
    return 'La demande prend trop de temps. Veuillez réessayer.';
  }

  if (!error.response) {
    return 'Impossible de joindre le service. Vérifiez votre connexion puis réessayez.';
  }

  const specifique = byStatus[error.response.status];
  if (specifique) return specifique;

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
