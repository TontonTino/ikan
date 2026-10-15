/** Brouillon de réponse au client (AM-09) : logique pure, testable sans DOM. */

/** Canaux acceptés par l'API (liste fermée, voir CANAUX_REPONSE côté API). « autre » = réponse sans contact. */
export const CANAUX_REPONSE = ['telephone', 'whatsapp', 'email', 'sms', 'autre'] as const;
export type CanalReponse = (typeof CANAUX_REPONSE)[number];

export const CANAL_LABELS: Record<CanalReponse, string> = {
  telephone: 'Téléphone',
  whatsapp: 'WhatsApp',
  email: 'E-mail',
  sms: 'SMS',
  autre: 'Autre / sans contact',
};

export const LONGUEUR_MAX_REPONSE = 2000;

export interface BrouillonReponse {
  disponible: boolean;
  /** 'aucun_suivi' | 'reponse_existante' quand aucun brouillon n'est proposé. */
  raison?: string | null;
  registre?: string | null;
  texte?: string | null;
  canal_suggere?: string | null;
}

/** État de chargement du brouillon : une erreur ne bloque jamais la saisie. */
export type EtatBrouillon =
  | { statut: 'chargement' }
  | { statut: 'erreur' }
  | { statut: 'ok'; brouillon: BrouillonReponse };

export const LIBELLES_REGISTRE: Record<string, string> = {
  critique: 'Avis critique',
  discordance: 'Bonne note, commentaire négatif',
  negatif: 'Avis négatif',
  rappel_simple: 'Demande de rappel',
};

export function estCanalConnu(valeur: unknown): valeur is CanalReponse {
  return typeof valeur === 'string' && (CANAUX_REPONSE as readonly string[]).includes(valeur);
}

/** Texte du brouillon à afficher, ou null s'il n'y a rien à proposer (chargement, erreur, aucun suivi, réponse déjà enregistrée). */
export function texteDuBrouillon(etat: EtatBrouillon): string | null {
  if (etat.statut !== 'ok') return null;
  const { disponible, texte } = etat.brouillon;
  return disponible && texte && texte.trim() ? texte : null;
}

export type DecisionUtilisation = 'appliquer' | 'confirmer' | 'deja_en_place';

/**
 * Que faire quand le gestionnaire clique sur « Utiliser ce brouillon » ?
 * - zone vide : on applique ;
 * - déjà identique au brouillon : rien à remplacer ;
 * - texte déjà saisi et différent : on demande confirmation (jamais d'écrasement silencieux).
 */
export function decisionUtilisation(saisie: string, brouillon: string): DecisionUtilisation {
  if (!saisie.trim()) return 'appliquer';
  if (saisie === brouillon) return 'deja_en_place';
  return 'confirmer';
}

/** Canal à présélectionner avec le brouillon : celui que l'API suggère s'il est connu, sinon le canal courant. */
export function canalApresBrouillon(canalCourant: CanalReponse, suggere: string | null | undefined): CanalReponse {
  return estCanalConnu(suggere) ? suggere : canalCourant;
}

/** L'avertissement « enregistrer traite la demande » ne s'applique que s'il existe une demande de rappel pas encore traitée. */
export function enregistrerTraiteLaDemande(demande: { traitee: boolean } | null | undefined): boolean {
  return !!demande && !demande.traitee;
}
