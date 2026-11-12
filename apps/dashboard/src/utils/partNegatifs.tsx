import React from 'react';
import type { PartNegatifs } from '../types';
import { formaterPourcentage } from './formatNombre';

/*
 * Affichage de la part d'avis négatifs et de son évolution (CX-05). « Négatif » = note de 2 ou moins, ou ton négatif (une seule
 * définition, côté serveur). L'évolution est un écart en POINTS par rapport à la période précédente de même durée ; le serveur ne
 * la fournit que si cette période compte au moins 5 avis. Plus d'avis négatifs = défavorable : la hausse est en rouge, la baisse en
 * vert, et la flèche ET le texte disent le sens (la couleur n'est jamais le seul signal).
 */

export const DEFINITION_NEGATIF = 'Avis négatif : note de 2 ou moins, ou ton négatif détecté dans le commentaire (chaque avis compté une fois).';

const pourcent = (valeur: number) => formaterPourcentage(valeur, 3);

export function libellePartNegatifs(pn: PartNegatifs | null | undefined): string {
  if (!pn || pn.part == null) return 'Aucun avis';
  return pourcent(pn.part);
}

export interface EvolutionAffichee {
  texte: string;
  /** défavorable = hausse de la part négative ; favorable = baisse ; neutre = stable ou indisponible. */
  sens: 'defavorable' | 'favorable' | 'neutre';
  fleche: '↑' | '↓' | '→' | '';
}

/** Vrai quand la part d'avis négatifs existe mais ne peut pas être comparée (période précédente de moins de 5 avis). */
export function comparaisonInsuffisante(pn: PartNegatifs | null | undefined): boolean {
  return !!pn && pn.statut_evolution !== 'sans_avis' && (pn.statut_evolution === 'insuffisant' || pn.evolution_pts == null);
}

/** Phrase unique placée au-dessus d'un tableau, au lieu de répéter « Données insuffisantes pour comparer » dans chaque cellule. */
export function phraseComparaisonInsuffisante(nombre: number): string | null {
  if (nombre <= 0) return null;
  return nombre === 1
    ? 'Pour 1 agence, la période précédente compte moins de 5 avis : l’évolution des avis négatifs n’est pas comparée.'
    : `Pour ${nombre} agences, la période précédente compte moins de 5 avis : l’évolution des avis négatifs n’est pas comparée.`;
}

export function evolutionPartNegatifs(pn: PartNegatifs | null | undefined): EvolutionAffichee {
  if (!pn || pn.statut_evolution === 'sans_avis') return { texte: '', sens: 'neutre', fleche: '' };
  if (pn.statut_evolution === 'insuffisant' || pn.evolution_pts == null) {
    return { texte: 'Données insuffisantes pour comparer', sens: 'neutre', fleche: '' };
  }
  const pts = pn.evolution_pts;
  if (pts === 0) return { texte: 'Stable par rapport à la période précédente', sens: 'neutre', fleche: '→' };
  const absolu = Math.abs(pts).toLocaleString('fr-FR');
  return pts > 0
    ? { texte: `+${absolu} pts par rapport à la période précédente (en hausse)`, sens: 'defavorable', fleche: '↑' }
    : { texte: `−${absolu} pts par rapport à la période précédente (en baisse)`, sens: 'favorable', fleche: '↓' };
}

const COULEUR: Record<EvolutionAffichee['sens'], string> = { defavorable: 'var(--color-critique-texte)', favorable: 'var(--color-bon-texte)', neutre: 'var(--color-text-2)' };

/**
 * « 23,5 % d'avis négatifs » suivi de l'évolution (flèche + texte). `court` : sans le texte de comparaison détaillé.
 * `sansMentionInsuffisante` : n'écrit pas « Données insuffisantes pour comparer » (le tableau le dit une fois, au-dessus).
 */
export function PartNegatifsTexte({ pn, court = false, sansMentionInsuffisante = false }: { pn: PartNegatifs | null | undefined; court?: boolean; sansMentionInsuffisante?: boolean }) {
  const evolution = sansMentionInsuffisante && comparaisonInsuffisante(pn) ? { texte: '', sens: 'neutre' as const, fleche: '' as const } : evolutionPartNegatifs(pn);
  return (
    <span>
      <strong>{libellePartNegatifs(pn)}</strong>
      {pn && pn.part != null && !court && <span style={{ color: 'var(--color-text-2)' }}> d’avis négatifs ({pn.negatifs} sur {pn.total})</span>}
      {evolution.texte && (
        <span style={{ display: 'block', color: COULEUR[evolution.sens], fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)' }}>
          {evolution.fleche && <span aria-hidden="true">{evolution.fleche} </span>}
          {court && evolution.fleche ? evolution.texte.replace(' par rapport à la période précédente', '') : evolution.texte}
        </span>
      )}
    </span>
  );
}
