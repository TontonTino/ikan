import React from 'react';
import { Link } from 'react-router-dom';
import type { DashboardAgence } from '../../types';
import Card from '../ui/Card';
import EmptyState from '../ui/EmptyState';
import { themeLabel } from '../../utils/themeLabels';
import { lienAvisReseau } from '../../utils/liensAgence';

const TONS = [
  { key: 'positif', label: 'Positif', fill: 'positive' },
  { key: 'neutre', label: 'Neutre', fill: 'attention' },
  { key: 'negatif', label: 'Négatif', fill: 'critical' },
] as const;

const bornePct = (v: number) => Math.max(0, Math.min(100, v));

/** Ton des avis : le texte (libellé, nombre, pourcentage) porte l'information, la barre ne fait que l'illustrer. */
export function TonDesAvis({ sentiments }: { sentiments: DashboardAgence['sentiments'] }) {
  return (
    <Card title="Ton des avis" subtitle="Ton détecté automatiquement à partir du commentaire ou de la note.">
      {sentiments.length === 0 ? (
        <EmptyState compact illustration={null} title="Aucun avis analysé" message="Les avis de cette période n’ont pas encore été analysés." />
      ) : (
        <ul className="agence-meters">
          {TONS.map((ton) => {
            const s = sentiments.find((x) => x.sentiment === ton.key);
            return (
              <li key={ton.key} className="agence-meter">
                <div className="agence-meter__row">
                  <span className="agence-meter__label">{ton.label}</span>
                  <span className="agence-meter__value">{s ? `${s.pourcentage} %` : 'Aucune donnée'}</span>
                </div>
                <div className="agence-meter__track" aria-hidden="true">
                  {s && <div className={`agence-meter__fill agence-meter__fill--${ton.fill}`} style={{ width: `${bornePct(s.pourcentage)}%` }} />}
                </div>
                <span className="agence-meter__sub">{s ? `${s.count} avis analysés` : 'Aucun avis analysé'}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

const THEMES_VISIBLES = 6;

/** Thèmes les plus cités (catégorie choisie par le client) : chaque ligne ouvre les avis de ce thème. */
export function ThemesDesAvis({ themes, jours }: { themes: DashboardAgence['themes']; jours?: number }) {
  const affiches = themes.slice(0, THEMES_VISIBLES);
  return (
    <Card title="Thèmes les plus cités" subtitle="Selon la catégorie choisie par le client dans le formulaire. Sélectionnez un thème pour voir ses avis.">
      {themes.length === 0 ? (
        <EmptyState compact illustration={null} title="Aucune donnée sur les thèmes" message="Aucun avis analysé sur cette période." />
      ) : (
        <>
          <ul className="agence-meters">
            {affiches.map((t) => (
              <li key={t.theme}>
                <Link
                  to={lienAvisReseau({ theme: t.theme, jours })}
                  className="agence-meter"
                  aria-label={`${themeLabel(t.theme)} : ${t.count} avis, ${t.pourcentage} %. Voir les avis de ce thème.`}
                >
                  <span className="agence-meter__row">
                    <span className="agence-meter__label">{themeLabel(t.theme)}</span>
                    <span className="agence-meter__value">{t.pourcentage} %</span>
                  </span>
                  <span className="agence-meter__track" aria-hidden="true">
                    <span className="agence-meter__fill agence-meter__fill--info" style={{ display: 'block', width: `${bornePct(t.pourcentage)}%` }} />
                  </span>
                  <span className="agence-meter__sub">{t.count} avis</span>
                </Link>
              </li>
            ))}
          </ul>
          {themes.length > affiches.length && (
            <p className="siege-note">+{themes.length - affiches.length} autre{themes.length - affiches.length > 1 ? 's' : ''} thème{themes.length - affiches.length > 1 ? 's' : ''} moins cité{themes.length - affiches.length > 1 ? 's' : ''}.</p>
          )}
        </>
      )}
    </Card>
  );
}
