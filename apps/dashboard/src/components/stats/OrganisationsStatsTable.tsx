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
          color: '#94A3B8',
          fontSize: '0.84rem',
          background: '#FAFCFA',
          borderRadius: '16px',
          border: '1px dashed #D6E8D9',
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
          fontSize: '0.84rem',
        }}
      >
        <thead>
          <tr style={{ color: '#64748B', fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            <th style={{ textAlign: 'left', padding: '8px 14px', fontWeight: 700 }}>Organisation</th>
            <th style={{ textAlign: 'left', padding: '8px 14px', fontWeight: 700 }}>Secteur</th>
            <th style={{ textAlign: 'center', padding: '8px 14px', fontWeight: 700 }}>Agences</th>
            <th style={{ textAlign: 'center', padding: '8px 14px', fontWeight: 700 }}>Utilisateurs</th>
            <th style={{ textAlign: 'center', padding: '8px 14px', fontWeight: 700 }}>Forfait</th>
          </tr>
        </thead>
        <tbody>
          {organisations.map((org, idx) => {
            return (
              <tr
                key={org.organisation_id}
                style={{
                  background: '#FFFFFF',
                  borderRadius: '12px',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.02)',
                  transition: 'background 0.15s ease',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#F8FAFC')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '#FFFFFF')}
              >
                {/* Organisation Nom & Logo */}
                <td style={{ padding: '12px 14px', borderRadius: '12px 0 0 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '8px',
                        background: '#EAF5EC',
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
                        <BuildingIcon size={16} color="#3C7730" />
                      )}
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, color: '#0F172A' }}>{org.nom}</div>
                    </div>
                  </div>
                </td>

                {/* Secteur */}
                <td style={{ padding: '12px 14px', color: '#64748B', fontSize: '0.80rem' }}>
                  {org.secteur || 'Général'}
                </td>

                {/* Agences count */}
                <td style={{ padding: '12px 14px', textAlign: 'center', fontWeight: 600, color: '#0F172A' }}>
                  {org.agences_count}
                </td>

                {/* Utilisateurs actifs */}
                <td style={{ padding: '12px 14px', textAlign: 'center', fontWeight: 600, color: '#0F172A' }}>
                  {org.utilisateurs_count}
                </td>

                {/* Forfait */}
                <td style={{ padding: '12px 14px', textAlign: 'center', borderRadius: '0 12px 12px 0' }}>
                  <span style={{ background: '#EBF6ED', color: '#3C7730', padding: '3px 10px', borderRadius: '9999px', fontWeight: 800, fontSize: '0.78rem', display: 'inline-block' }}>
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
