import axios from 'axios';

/**
 * Paramètres système (AD-05) : bornes lues dans la réponse de GET /system/settings (champ `bornes`, source unique côté serveur —
 * rien n'est dupliqué à la main ici), contrôles de saisie avant envoi, et lecture du refus 422 du serveur par champ.
 */
export interface BornesParametres {
  retention_mois?: { min: number; max: number };
  nom_application?: { max_caracteres: number };
}

export type ChampParametre = 'nom_application' | 'retention_mois';

/** Message d'erreur (français) ou null si la saisie est valide. Sans bornes connues, le contrôle est laissé au serveur. */
export function erreurRetention(texte: string, bornes?: BornesParametres): string | null {
  const b = bornes?.retention_mois;
  const saisie = texte.trim();
  if (!/^\d+$/.test(saisie)) return b ? `Saisissez un nombre entier de mois, de ${b.min} à ${b.max}.` : 'Saisissez un nombre entier de mois.';
  const mois = Number(saisie);
  if (b && (mois < b.min || mois > b.max)) return `La durée doit être comprise entre ${b.min} et ${b.max} mois.`;
  return null;
}

export function erreurNom(texte: string, bornes?: BornesParametres): string | null {
  const max = bornes?.nom_application?.max_caracteres;
  if (texte.trim().length === 0) return 'Saisissez le nom de l’application.';
  if (max && texte.trim().length > max) return `Le nom ne peut pas dépasser ${max} caractères.`;
  return null;
}

export interface RefusParametres {
  champ: ChampParametre | null;
  message: string;
}

/** Refus 422 du serveur : message français tel quel (jamais la valeur saisie) et champ fautif s'il est connu ; null pour toute autre erreur. */
export function refusParametres(error: unknown): RefusParametres | null {
  if (!axios.isAxiosError(error) || error.response?.status !== 422) return null;
  const detail = (error.response.data as { detail?: unknown } | undefined)?.detail;
  if (!Array.isArray(detail)) return null;
  const erreur = detail.find((e) => e && e.type === 'value_error' && typeof e.msg === 'string' && e.msg.length <= 300);
  if (!erreur) return null;
  const loc: unknown[] = Array.isArray(erreur.loc) ? erreur.loc : [];
  const dernier = loc[loc.length - 1];
  const champ = dernier === 'nom_application' || dernier === 'retention_mois' ? dernier : null;
  return { champ, message: erreur.msg };
}
