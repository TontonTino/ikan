/**
 * Libellés français du journal d'audit (AD-08). Un code d'action technique (« compte.cree ») n'est jamais affiché tel quel :
 * chaque code de l'API a son libellé ici ; un code inconnu (version plus récente de l'API) s'affiche « Action non répertoriée ».
 */
export const LIBELLES_ACTION: Record<string, string> = {
  'organisation.creee': 'Organisation créée',
  'organisation.modifiee': 'Organisation modifiée',
  'organisation.desactivee': 'Organisation désactivée',
  'organisation.reactivee': 'Organisation réactivée',
  'forfait.modifie': 'Forfait modifié',
  'compte.cree': 'Compte créé',
  'compte.modifie': 'Compte modifié',
  'compte.suspendu': 'Compte suspendu',
  'compte.admin_cree': 'Compte administrateur créé',
  'compte.mot_de_passe_reinitialise': 'Mot de passe d’un compte réinitialisé',
  'compte.mot_de_passe_modifie': 'Mot de passe modifié par son titulaire',
  'agence.creee': 'Agence créée',
  'agence.modifiee': 'Agence modifiée',
  'agence.supprimee': 'Agence supprimée',
  'qr_code.supprime': 'QR code supprimé',
  'parametres.modifies': 'Paramètres modifiés',
  'protection.dernier_admin_refuse': 'Action refusée : dernier administrateur protégé',
  'auth.connexion_echouee': 'Connexion échouée',
  'auth.connexion_limitee': 'Connexion bloquée (trop de tentatives)',
};

export const LIBELLES_RESULTAT: Record<string, string> = { succes: 'Réussie', refus: 'Refusée' };

export const LIBELLES_ROLE_JOURNAL: Record<string, string> = {
  admin: 'Administrateur',
  cx_manager: 'CX Manager',
  agency_manager: 'Responsable d’agence',
  anonyme: 'Visiteur non connecté',
  systeme: 'Système',
};

export const LIBELLES_CIBLE: Record<string, string> = {
  organisation: 'Organisation',
  utilisateur: 'Compte',
  agence: 'Agence',
  qr_code: 'QR code',
  parametres: 'Paramètres',
};

export const libelleAction = (code: string): string => LIBELLES_ACTION[code] ?? 'Action non répertoriée';
export const libelleResultat = (code: string): string => LIBELLES_RESULTAT[code] ?? 'Résultat inconnu';
export const libelleRoleJournal = (code: string): string => LIBELLES_ROLE_JOURNAL[code] ?? 'Rôle inconnu';
export const libelleCible = (code: string | null | undefined): string => (code ? LIBELLES_CIBLE[code] ?? 'Élément' : '');

/** Résumé lisible des champs modifiés (details.champs) ; jamais le JSON brut. */
export function resumeDetails(details: Record<string, unknown> | null | undefined): string {
  const champs = details && Array.isArray(details.champs) ? details.champs.filter((c): c is string => typeof c === 'string') : [];
  return champs.length ? `Champs : ${champs.join(', ')}` : '';
}
