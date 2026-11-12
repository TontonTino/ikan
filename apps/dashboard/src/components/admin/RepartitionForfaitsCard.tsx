import React from 'react';
import type { RepartitionForfaitItem } from '../../types';

const COULEURS: Record<string, string> = {
  // Échelle ordinale de la palette, du plus clair au plus foncé (la légende porte toujours le nom et le nombre).
  gratuit: 'var(--color-border)',
  starter: 'var(--color-text-2)',
  pro: 'var(--color-marque)',
  entreprise: 'var(--color-encre)',
};

/** Répartition des organisations par forfait — donnée purement structurelle. */
export default function RepartitionForfaitsCard({ repartition }: { repartition: RepartitionForfaitItem[] }) {
  const total = repartition.reduce((somme, r) => somme + r.nombre, 0);

  return (
    <div style={{ background: 'var(--color-surface)', borderRadius: '24px', padding: '24px 28px', border: '1px solid var(--color-trait)' }}>
      <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-encre)', margin: '0 0 4px' }}>
        Répartition par forfait
      </h3>
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-2)', margin: '0 0 18px' }}>
        Nombre d'organisations actives par forfait
      </p>

      {total > 0 && (
        <div style={{ display: 'flex', height: '10px', borderRadius: '9999px', overflow: 'hidden', background: 'var(--color-neutre-fond)', marginBottom: '18px' }}>
          {repartition.filter((r) => r.nombre > 0).map((r) => (
            <div key={r.code} title={`${r.nom} : ${r.nombre}`} style={{ width: `${(r.nombre / total) * 100}%`, background: COULEURS[r.code] || 'var(--color-trait)' }} />
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
        {repartition.map((r) => (
          <div key={r.code} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--color-bg)', borderRadius: '12px' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--text-sm)', color: 'var(--color-text-2)' }}>
              <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: COULEURS[r.code] || 'var(--color-trait)' }} />
              {r.nom}
            </span>
            <strong className="t-sm t-encre">{r.nombre}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
