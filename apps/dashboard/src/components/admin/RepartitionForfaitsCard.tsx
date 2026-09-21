import React from 'react';
import type { RepartitionForfaitItem } from '../../types';

const COULEURS: Record<string, string> = {
  gratuit: '#94A3B8',
  starter: '#75B72A',
  pro: '#3C7730',
  entreprise: '#02302D',
};

/** Répartition des organisations par forfait — donnée purement structurelle. */
export default function RepartitionForfaitsCard({ repartition }: { repartition: RepartitionForfaitItem[] }) {
  const total = repartition.reduce((somme, r) => somme + r.nombre, 0);

  return (
    <div style={{ background: '#FFFFFF', borderRadius: '24px', padding: '24px 28px', border: '1px solid #E8ECE6' }}>
      <h3 style={{ fontSize: '1.02rem', fontWeight: 800, color: '#02302D', margin: '0 0 4px' }}>
        Répartition par forfait
      </h3>
      <p style={{ fontSize: '0.78rem', color: '#64748B', margin: '0 0 18px' }}>
        Nombre d'organisations actives par forfait
      </p>

      {total > 0 && (
        <div style={{ display: 'flex', height: '10px', borderRadius: '9999px', overflow: 'hidden', background: '#F1F5F9', marginBottom: '18px' }}>
          {repartition.filter((r) => r.nombre > 0).map((r) => (
            <div key={r.code} title={`${r.nom} : ${r.nombre}`} style={{ width: `${(r.nombre / total) * 100}%`, background: COULEURS[r.code] || '#CBD5E1' }} />
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
        {repartition.map((r) => (
          <div key={r.code} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: '#F8FAFC', borderRadius: '12px' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', color: '#64748B' }}>
              <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: COULEURS[r.code] || '#CBD5E1' }} />
              {r.nom}
            </span>
            <strong style={{ fontSize: '0.9rem', color: '#02302D' }}>{r.nombre}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
