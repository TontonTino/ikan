import React from 'react';
import type { ThemeStatsDetail } from '../../types';
import { GRAVITE_LABELS } from '../../utils/vocabulaire';

/* Informations d'une carte de l'onglet « Thèmes » de la page Avis : agences concernées, ton et urgence, extrait d'un avis. */

const GRAVITE_LIBELLE: Record<string, string> = Object.fromEntries(Object.entries(GRAVITE_LABELS).map(([k, v]) => [k, v.toLowerCase()]));
const TON_LIBELLE: Record<string, string> = { positif: 'positif', neutre: 'neutre', negatif: 'négatif' };

export function ThemeAgences({ theme }: { theme: ThemeStatsDetail }) {
  const n = theme.agences_concernees;
  if (n == null) return null;
  return <p style={{ margin: '0 0 8px', color: 'var(--color-text-2)', fontSize: 'var(--text-xs)' }}>📍 {n} agence{n > 1 ? 's' : ''} concernée{n > 1 ? 's' : ''}</p>;
}

export function ThemeTonGravite({ theme }: { theme: ThemeStatsDetail }) {
  return (
    <p style={{ margin: '0 0 10px', color: 'var(--color-text-2)', fontSize: 'var(--text-xs)' }}>
      Ton dominant : {TON_LIBELLE[theme.sentiment_predominant] ?? 'non évalué'}
      {theme.gravite_frequente ? ` · Urgence la plus fréquente : ${GRAVITE_LIBELLE[theme.gravite_frequente] ?? 'non précisée'}` : ' · Aucune urgence disponible'}
    </p>
  );
}

/** Extrait le plus récent (comme avant) ; les suivants restent disponibles dans la réponse. */
export function ThemeVerbatim({ theme }: { theme: ThemeStatsDetail }) {
  const extrait = theme.verbatims?.[0];
  if (!extrait) return null;
  return <div style={{ background: 'var(--color-bg)', borderRadius: '10px', padding: '10px 12px', fontSize: 'var(--text-xs)', color: 'var(--color-text-2)', fontStyle: 'italic', lineHeight: 1.4 }}>"{extrait}"</div>;
}
