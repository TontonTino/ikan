import React from 'react';
import { formaterNombre } from '../../utils/formatNombre';

export interface ChiffreCle {
  label: string;
  valeur: number | string | null | undefined;
  note?: string;
}

/**
 * Chiffres clés en UNE carte : cellules égales séparées par un filet, libellés jamais tronqués (ils passent à la ligne).
 * Remplace les rangées de petites cartes (4 + 1 orpheline, libellés coupés par « … »).
 */
export default function ChiffresCles({ items, label }: { items: ChiffreCle[]; label: string }) {
  return (
    <section className="saas-card chiffres-cles" aria-label={label} style={{ ['--chiffres-colonnes' as string]: items.length }}>
      {items.map((c) => (
        <div key={c.label} className="chiffres-cles__cellule">
          <p className="chiffres-cles__label">{c.label}</p>
          <p className="chiffres-cles__valeur">{typeof c.valeur === 'number' ? formaterNombre(c.valeur, 0) : c.valeur ?? '—'}</p>
          {c.note && <p className="chiffres-cles__note">{c.note}</p>}
        </div>
      ))}
    </section>
  );
}
