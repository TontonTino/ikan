import React from 'react';
import { MapPin } from '@phosphor-icons/react';
import { STATUT_SEUIL_LABEL, satisfactionTexte, type StatutSeuil } from '../../pages/cx/siege/siegeData';

/*
 * Légende de la carte du réseau. Les couleurs sont celles du STATUT de chaque agence vis-à-vis de SON seuil (pas d'un seuil unique) ;
 * la couleur n'est jamais le seul signal : libellé, explication et symbole accompagnent chaque couleur, et la liste sous la carte
 * donne le statut de chaque agence en toutes lettres.
 */

/** Couleurs des marqueurs (Leaflet a besoin de valeurs littérales : tokens --color-success-solid / critical-solid / neutral-solid). */
export const STATUT_COULEUR: Record<StatutSeuil, string> = {
  au_dessus: '#3C7730',
  sous: '#DC2626',
  pas_assez_avis: '#64748B',
  sans_avis: '#94A3B8',
};

/** Symbole dessiné dans le marqueur et répété dans la légende : distingue les statuts sans la couleur. */
export const STATUT_SYMBOLE: Record<StatutSeuil, string> = { au_dessus: '✓', sous: '!', pas_assez_avis: '?', sans_avis: '–' };

export const STATUT_EXPLICATION: Record<StatutSeuil, string> = {
  au_dessus: 'Satisfaction au moins égale au seuil de l’agence.',
  sous: 'Satisfaction inférieure au seuil de l’agence.',
  pas_assez_avis: 'Pas assez d’avis pour comparer au seuil.',
  sans_avis: 'Aucun avis sur la période.',
};

export const PHRASE_SEUIL_PAR_AGENCE = 'Les couleurs tiennent compte du seuil de chaque agence.';

export const ORDRE_LEGENDE: StatutSeuil[] = ['au_dessus', 'sous', 'pas_assez_avis', 'sans_avis'];

export function LegendeCarte() {
  return (
    <div>
      <p style={{ margin: 'var(--space-3) 0 0', textAlign: 'center', fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>{PHRASE_SEUIL_PAR_AGENCE}</p>
      <ul aria-label="Légende de la carte" style={{ display: 'flex', gap: 'var(--space-4)', justifyContent: 'center', margin: 'var(--space-2) 0 0', padding: 0, listStyle: 'none', flexWrap: 'wrap' }}>
        {ORDRE_LEGENDE.map((statut) => (
          <li key={statut} style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)', fontSize: 'var(--text-sm)', maxWidth: 240 }}>
            <MapPin size={18} weight="fill" color={STATUT_COULEUR[statut]} aria-hidden="true" />
            <span>
              <strong>
                <span aria-hidden="true">{STATUT_SYMBOLE[statut]} </span>
                {STATUT_SEUIL_LABEL[statut]}
              </strong>
              <br />
              <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>{STATUT_EXPLICATION[statut]}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface LigneCarte {
  id: string;
  nom: string;
  ville?: string | null;
  satisfaction: number | null;
  avis: number;
  seuil: number | null;
  statut: StatutSeuil;
}

/** Liste texte des agences de la carte : leur statut en toutes lettres, sans dépendre de la couleur des marqueurs. */
export function ListeAgencesCarte({ agences }: { agences: LigneCarte[] }) {
  return (
    <details style={{ marginTop: 'var(--space-3)' }}>
      <summary style={{ cursor: 'pointer', fontSize: 'var(--text-sm)', fontWeight: 600 }}>Voir la liste des agences de la carte et leur statut</summary>
      <ul style={{ margin: 'var(--space-2) 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', fontSize: 'var(--text-sm)' }}>
        {agences.map((a) => (
          <li key={a.id}>
            <strong>{a.nom}</strong>
            {a.ville ? ` (${a.ville})` : ''} — {STATUT_SEUIL_LABEL[a.statut]}
            {a.statut === 'au_dessus' || a.statut === 'sous' ? ` : ${satisfactionTexte(a.satisfaction, a.avis)}${a.seuil != null ? `, seuil ${a.seuil} %` : ''}` : ''}
          </li>
        ))}
      </ul>
    </details>
  );
}
