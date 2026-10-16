import React from 'react';
import type { ThemeStatsDetail } from '../../types';

/* Informations d'une carte de l'onglet « Thèmes » de la page Avis : agences concernées, ton et gravité, extrait d'un avis. */

const GRAVITE_LIBELLE: Record<string, string> = { critique: 'critique', elevee: 'élevée', moyenne: 'moyenne', faible: 'faible' };
const TON_LIBELLE: Record<string, string> = { positif: 'positif', neutre: 'neutre', negatif: 'négatif' };

export function ThemeAgences({ theme }: { theme: ThemeStatsDetail }) {
  const n = theme.agences_concernees;
  if (n == null) return null;
  return <p style={{ margin: '0 0 8px', color: '#64748B', fontSize: '0.74rem' }}>📍 {n} agence{n > 1 ? 's' : ''} concernée{n > 1 ? 's' : ''}</p>;
}

export function ThemeTonGravite({ theme }: { theme: ThemeStatsDetail }) {
  return (
    <p style={{ margin: '0 0 10px', color: '#475569', fontSize: '0.76rem' }}>
      Ton dominant : {TON_LIBELLE[theme.sentiment_predominant] ?? 'non évalué'}
      {theme.gravite_frequente ? ` · Gravité la plus fréquente : ${GRAVITE_LIBELLE[theme.gravite_frequente] ?? theme.gravite_frequente}` : ' · Aucune gravité disponible'}
    </p>
  );
}

/** Extrait le plus récent (comme avant) ; les suivants restent disponibles dans la réponse. */
export function ThemeVerbatim({ theme }: { theme: ThemeStatsDetail }) {
  const extrait = theme.verbatims?.[0];
  if (!extrait) return null;
  return <div style={{ background: '#F8FAFC', borderRadius: '10px', padding: '10px 12px', fontSize: '0.78rem', color: '#475569', fontStyle: 'italic', lineHeight: 1.4 }}>"{extrait}"</div>;
}
