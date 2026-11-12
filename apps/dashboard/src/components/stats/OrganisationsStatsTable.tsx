import React from 'react';
import type { OrganisationStructure } from '../../types';
import { BuildingIcon } from '../common/Icons';

interface OrganisationsStatsTableProps {
  organisations: OrganisationStructure[];
}

export default function OrganisationsStatsTable({
  organisations,
}: OrganisationsStatsTableProps) {
  if (!organisations || organisations.length === 0) {
    return (
      <div
        style={{
          padding: '32px',
          textAlign: 'center',
          color: 'var(--color-text-2)',
          fontSize: 'var(--text-sm)',
          background: 'var(--color-bg)',
          borderRadius: '16px',
          border: '1px dashed var(--color-trait)',
        }}
      >
        Aucune organisation active sur la plateforme.
      </div>
    );
  }

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      <table
        style={{
          width: '100%',
          borderCollapse: 'separate',
          borderSpacing: '0 6px',
          fontSize: 'var(--text-sm)',
        }}
      >
        <thead>
          <tr style={{ color: 'var(--color-text-2)', fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            <th style={{ textAlign: 'left', padding: '8px 14px', fontWeight: 'var(--weight-semibold)' }}>Organisation</th>
            <th style={{ textAlign: 'left', padding: '8px 14px', fontWeight: 'var(--weight-semibold)' }}>Secteur</th>
            <th style={{ textAlign: 'center', padding: '8px 14px', fontWeight: 'var(--weight-semibold)' }}>Agences</th>
            <th style={{ textAlign: 'center', padding: '8px 14px', fontWeight: 'var(--weight-semibold)' }}>Utilisateurs</th>
            <th style={{ textAlign: 'center', padding: '8px 14px', fontWeight: 'var(--weight-semibold)' }}>Forfait</th>
          </tr>
        </thead>
        <tbody>
          {organisations.map((org, idx) => {
            return (
              <tr
                key={org.organisation_id}
                style={{
                  background: 'var(--color-surface)',
                  borderRadius: '12px',
                  transition: 'background 0.15s ease',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--color-surface)')}
              >
                {/* Organisation Nom & Logo */}
                <td style={{ padding: '12px 14px', borderRadius: '12px 0 0 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '8px',
                        background: 'var(--color-bon-fond)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      {org.logo ? (
                        <img
                          src={org.logo}
                          alt={org.nom}
                          style={{ width: '20px', height: '20px', objectFit: 'contain' }}
                        />
                      ) : (
                        <BuildingIcon size={16} color="var(--color-bon-texte)" />
                      )}
                    </div>
                    <div>
                      <div className="t-semi t-encre">{org.nom}</div>
                    </div>
                  </div>
                </td>

                {/* Secteur */}
                <td style={{ padding: '12px 14px', color: 'var(--color-text-2)', fontSize: 'var(--text-xs)' }}>
                  {org.secteur || 'Général'}
                </td>

                {/* Agences count */}
                <td style={{ padding: '12px 14px', textAlign: 'center', fontWeight: 'var(--weight-semibold)', color: 'var(--color-encre)' }}>
                  {org.agences_count}
                </td>

                {/* Utilisateurs actifs */}
                <td style={{ padding: '12px 14px', textAlign: 'center', fontWeight: 'var(--weight-semibold)', color: 'var(--color-encre)' }}>
                  {org.utilisateurs_count}
                </td>

                {/* Forfait */}
                <td style={{ padding: '12px 14px', textAlign: 'center', borderRadius: '0 12px 12px 0' }}>
                  <span style={{ background: 'var(--color-bon-fond)', color: 'var(--color-bon-texte)', padding: '3px 10px', borderRadius: '9999px', fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-xs)', display: 'inline-block' }}>
                    {org.plan_nom || '—'}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
