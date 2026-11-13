import React from 'react';
import type { Alerte } from '../../types';
import { AlertTriangleIcon } from '../common/Icons';
import { formaterPourcentage } from '../../utils/formatNombre';

/** Ligne d'une alerte de seuil (champs réels de GET /alertes → alertes_seuil). */
export default function AlerteRow({ alerte }: { alerte: Alerte }) {
  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-critique-fond)',
        borderLeft: '6px solid var(--color-error)',
        borderRadius: '16px',
        padding: '16px 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '16px',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: '240px', flex: 1 }}>
        <div
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '10px',
            background: 'var(--color-error-bg)',
            color: 'var(--color-error)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <AlertTriangleIcon size={18} />
        </div>
        <div>
          <h3 style={{ margin: 0, fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-sm)', color: 'var(--color-text-body)' }}>
            {alerte.agence_nom}
          </h3>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: '2px' }}>{alerte.message}</div>
        </div>
      </div>
      <span
        style={{
          fontSize: 'var(--text-xs)',
          fontWeight: 'var(--weight-semibold)',
          padding: '4px 12px',
          borderRadius: 'var(--radius-pill)',
          background: 'var(--color-error-bg)',
          color: 'var(--color-error)',
          whiteSpace: 'nowrap',
        }}
      >
        Taux actuel : {formaterPourcentage(alerte.taux_actuel)} / Seuil {formaterPourcentage(alerte.seuil)}
      </span>
    </div>
  );
}
