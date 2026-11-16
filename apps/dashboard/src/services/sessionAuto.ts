/**
 * Prolongation automatique de la session.
 *
 * Le jeton d'accès vit 30 minutes ; le jeton de rafraîchissement, 7 jours (cookies HttpOnly posés à la connexion).
 * Quand une requête répond 401, on demande UNE fois un nouveau jeton d'accès (/auth/refresh), puis on rejoue la requête :
 * l'utilisateur ne voit rien. Les requêtes qui échouent en même temps attendent ce même rafraîchissement (un seul appel).
 * Si le rafraîchissement échoue (7 jours dépassés, compte désactivé), on renvoie vers la page de connexion.
 */

/** Routes d'authentification : un 401 y est une réponse normale (mauvais mot de passe…), jamais un signal pour rafraîchir. */
const SANS_RAFRAICHISSEMENT = ['/auth/login', '/auth/refresh', '/auth/logout'];
/** Au chargement de l'app, /auth/me teste la session : on tente le rafraîchissement, mais sans redirection (le store décide). */
const SANS_REDIRECTION = ['/auth/me', '/auth/login'];

interface ConfigRequete {
  url?: string;
  _sessionRejouee?: boolean;
  [cle: string]: unknown;
}
interface ErreurHttp {
  config?: ConfigRequete;
  response?: { status?: number };
}

export interface OptionsSession {
  /** Demande un nouveau jeton d'accès au serveur. */
  rafraichir: () => Promise<unknown>;
  /** Rejoue une requête avec sa configuration d'origine. */
  rejouer: (config: ConfigRequete) => Promise<unknown>;
  /** Envoie vers la page de connexion. */
  versConnexion: () => void;
}

const concerne = (url: string, liste: string[]) => liste.some((chemin) => url.includes(chemin));

export function creerGestionnaireSession({ rafraichir, rejouer, versConnexion }: OptionsSession) {
  let enCours: Promise<unknown> | null = null;

  const rafraichirUneFois = () => {
    if (!enCours) {
      enCours = rafraichir().finally(() => {
        enCours = null;
      });
    }
    return enCours;
  };

  return async function surErreur(erreur: ErreurHttp): Promise<unknown> {
    const config = erreur.config;
    const url = config?.url ?? '';
    if (erreur.response?.status !== 401 || !config || config._sessionRejouee || concerne(url, SANS_RAFRAICHISSEMENT)) {
      throw erreur;
    }
    try {
      await rafraichirUneFois();
    } catch {
      if (!concerne(url, SANS_REDIRECTION)) versConnexion();
      throw erreur;
    }
    return rejouer({ ...config, _sessionRejouee: true });
  };
}
