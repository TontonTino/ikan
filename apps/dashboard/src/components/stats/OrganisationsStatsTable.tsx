import React from 'react';
import type { OrganisationRankDetail } from '../../types';
import { ArrowUpRightIcon, ArrowDownRightIcon, BuildingIcon } from '../common/Icons';

interface OrganisationsStatsTableProps {
  organisations: OrganisationRankDetail[];
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
            <th style={{ textAlign: 'center', padding: '8px 14px', fontWeight: 700 }}>Feedbacks collectés</th>
            <th style={{ textAlign: 'center', padding: '8px 14px', fontWeight: 700 }}>Feedbacks traités</th>
            <th style={{ textAlign: 'center', padding: '8px 14px', fontWeight: 700 }}>Taux traitement</th>
            <th style={{ textAlign: 'center', padding: '8px 14px', fontWeight: 700 }}>Satisfaction</th>
            <th style={{ textAlign: 'center', padding: '8px 14px', fontWeight: 700 }}>Tendance</th>
          </tr>
        </thead>
        <tbody>
          {organisations.map((org, idx) => {
            const satColor =
              org.satisfaction_globale >= 80 ? '#3C7730' : org.satisfaction_globale >= 60 ? '#D97706' : '#DC2626';
            const satBg =
              org.satisfaction_globale >= 80 ? '#EBF6ED' : org.satisfaction_globale >= 60 ? '#FEF3C7' : '#FEE2E2';

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

                {/* Feedbacks collectés */}
                <td style={{ padding: '12px 14px', textAlign: 'center', fontWeight: 700, color: '#02302D' }}>
                  {org.feedbacks_collectes}
                </td>

                {/* Feedbacks traités */}
                <td style={{ padding: '12px 14px', textAlign: 'center', fontWeight: 600, color: '#64748B' }}>
                  {org.feedbacks_traites}
                </td>

                {/* Taux de traitement */}
                <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                  <span style={{ fontWeight: 800, color: '#02302D' }}>{org.taux_traitement}%</span>
                </td>

                {/* Satisfaction */}
                <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                  <span
                    style={{
                      background: satBg,
                      color: satColor,
                      padding: '3px 10px',
                      borderRadius: '9999px',
                      fontWeight: 800,
                      fontSize: '0.80rem',
                      display: 'inline-block',
                    }}
                  >
                    {org.satisfaction_globale}%
                  </span>
                </td>

                {/* Tendance */}
                <td style={{ padding: '12px 14px', textAlign: 'center', borderRadius: '0 12px 12px 0' }}>
                  {org.tendance_val ? (
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '2px',
                        color: org.tendance_positive ? '#3C7730' : '#DC2626',
                        fontWeight: 700,
                        fontSize: '0.76rem',
                      }}
                    >
                      {org.tendance_positive ? (
                        <ArrowUpRightIcon size={12} color="#3C7730" />
                      ) : (
                        <ArrowDownRightIcon size={12} color="#DC2626" />
                      )}
                      <span>{org.tendance_val}</span>
                    </div>
                  ) : (
                    <span style={{ color: '#CBD5E1' }}>—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
