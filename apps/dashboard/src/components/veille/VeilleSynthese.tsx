import React from 'react';
import type { SentimentType, VeilleSyntheseResponse } from '../../types';
import { themeLabel } from '../../utils/themeLabels';
import { formaterNombre, formaterPourcentage } from '../../utils/formatNombre';

/** Ordre et libellés du ton, partagés par la barre de synthèse, le graphique journalier et les filtres. */
export const TONS: { cle: SentimentType; libelle: string }[] = [
  { cle: 'positif', libelle: 'Positif' },
  { cle: 'neutre', libelle: 'Neutre' },
  { cle: 'negatif', libelle: 'Négatif' },
];

/** Seuil sous lequel les proportions sont signalées comme fragiles (même esprit que FAIBLE_VOLUME_POINT pour les avis). */
export const ECHANTILLON_REDUIT = 20;

export const mentions = (n: number) => `${formaterNombre(n, 0)} mention${n > 1 ? 's' : ''}`;

/** Le thème le plus cité, en ignorant les mentions « non classées » (un thème absent n'est pas une tendance). */
export function themeDominant(synthese: VeilleSyntheseResponse) {
  return [...synthese.par_theme].filter((t) => t.theme_principal).sort((a, b) => b.count - a.count)[0] ?? null;
}

/**
 * Synthèse de la période en une seule carte, trois cellules séparées par un filet :
 * combien on parle de nous, sur quel ton, et de quoi. Le ton est une barre empilée lisible sans couleur
 * (chaque segment a sa légende chiffrée en clair à côté).
 */
export default function VeilleSynthese({ synthese, periode }: { synthese: VeilleSyntheseResponse; periode: string }) {
  const dominant = themeDominant(synthese);
  const reduit = synthese.total < ECHANTILLON_REDUIT;

  return (
    <section className="saas-card veille-synthese" aria-label="Synthèse de la période">
      <div className="veille-synthese__cellule">
        <p className="veille-synthese__label">Mentions</p>
        <p className="veille-synthese__valeur">{formaterNombre(synthese.total, 0)}</p>
        <p className="veille-synthese__note">{periode}</p>
      </div>

      <div className="veille-synthese__cellule veille-synthese__cellule--ton">
        <p className="veille-synthese__label">Ton des mentions</p>
        <div className="veille-ton__barre" aria-hidden="true">
          {TONS.map(({ cle }) => {
            const p = synthese.par_sentiment[cle]?.pourcentage ?? 0;
            return p > 0 ? <span key={cle} className={`veille-ton__segment veille-ton__segment--${cle}`} style={{ flexGrow: p }} /> : null;
          })}
        </div>
        <ul className="veille-ton__legende">
          {TONS.map(({ cle, libelle }) => {
            const b = synthese.par_sentiment[cle];
            return (
              <li key={cle}>
                <span className={`veille-ton__pastille veille-ton__pastille--${cle}`} aria-hidden="true" />
                <span className="veille-ton__libelle">{libelle}</span>
                <strong>{formaterPourcentage(b?.pourcentage ?? 0, 0)}</strong>
                <span className="veille-ton__compte">{formaterNombre(b?.count ?? 0, 0)}</span>
              </li>
            );
          })}
        </ul>
        {reduit && <p className="veille-synthese__note">Peu de mentions : proportions à lire avec prudence.</p>}
      </div>

      <div className="veille-synthese__cellule">
        <p className="veille-synthese__label">Thème le plus cité</p>
        <p className="veille-synthese__theme">{dominant ? themeLabel(dominant.theme_principal) : 'Aucun thème identifié'}</p>
        {dominant && (
          <p className="veille-synthese__note">
            {mentions(dominant.count)} · {formaterPourcentage(dominant.pourcentage, 0)}
          </p>
        )}
      </div>
    </section>
  );
}
