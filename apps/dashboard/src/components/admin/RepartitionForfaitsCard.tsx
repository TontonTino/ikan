import React from 'react';
import type { RepartitionForfaitItem } from '../../types';
import { formaterNombre } from '../../utils/formatNombre';

const COULEURS: Record<string, string> = {
  // Échelle ordinale de la palette, du plus clair au plus foncé (la légende porte toujours le nom et le nombre).
  gratuit: 'var(--color-border)',
  starter: 'var(--color-text-2)',
  pro: 'var(--color-marque)',
  entreprise: 'var(--color-encre)',
};

/**
 * Répartition des organisations par forfait — donnée purement structurelle.
 * Barre empilée + légende chiffrée sur une ligne ; un forfait à zéro reste listé, en retrait.
 */
export default function RepartitionForfaitsCard({ repartition }: { repartition: RepartitionForfaitItem[] }) {
  const total = repartition.reduce((somme, r) => somme + r.nombre, 0);

  return (
    <section className="saas-card repartition-forfaits" aria-labelledby="repartition-forfaits-titre">
      <div className="repartition-forfaits__entete">
        <h3 id="repartition-forfaits-titre" className="repartition-forfaits__titre">Répartition par forfait</h3>
        <span className="repartition-forfaits__total">{formaterNombre(total, 0)} organisation{total > 1 ? 's' : ''} active{total > 1 ? 's' : ''}</span>
      </div>
      <div className="repartition-forfaits__barre" aria-hidden="true">
        {total > 0 && repartition.filter((r) => r.nombre > 0).map((r) => (
          <span key={r.code} style={{ flexGrow: r.nombre, background: COULEURS[r.code] || 'var(--color-trait)' }} />
        ))}
      </div>
      <ul className="repartition-forfaits__legende">
        {repartition.map((r) => (
          <li key={r.code} className={r.nombre === 0 ? 'repartition-forfaits__vide' : undefined}>
            <span className="repartition-forfaits__pastille" style={{ background: COULEURS[r.code] || 'var(--color-trait)' }} aria-hidden="true" />
            {r.nom}
            <strong>{formaterNombre(r.nombre, 0)}</strong>
          </li>
        ))}
      </ul>
    </section>
  );
}
