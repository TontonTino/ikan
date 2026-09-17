import React from 'react';
import type { AgenceRankDetail } from '../../types';
import { ArrowUpRightIcon, ArrowDownRightIcon, StoreIcon } from '../common/Icons';

interface AgencesRankingTableProps {
  agences: AgenceRankDetail[];
  selectedAgenceId?: string | null;
  onSelectAgence?: (agenceId: string | null) => void;
}

export default function AgencesRankingTable({
  agences,
  selectedAgenceId,
  onSelectAgence,
}: AgencesRankingTableProps) {
  if (!agences || agences.length === 0) {
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
        Aucune agence trouvée pour ce périmètre.
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
            <th style={{ textAlign: 'left', padding: '8px 14px', fontWeight: 700 }}>Rang & Agence</th>
            <th style={{ textAlign: 'left', padding: '8px 14px', fontWeight: 700 }}>Ville</th>
            <th style={{ textAlign: 'center', padding: '8px 14px', fontWeight: 700 }}>Satisfaction</th>
            <th style={{ textAlign: 'center', padding: '8px 14px', fontWeight: 700 }}>Avis collectés</th>
            <th style={{ textAlign: 'center', padding: '8px 14px', fontWeight: 700 }}>Traitement</th>
            <th style={{ textAlign: 'center', padding: '8px 14px', fontWeight: 700 }}>Alertes</th>
            <th style={{ textAlign: 'center', padding: '8px 14px', fontWeight: 700 }}>Tendance</th>
            {onSelectAgence && (
              <th style={{ textAlign: 'right', padding: '8px 14px', fontWeight: 700 }}>Action</th>
            )}
          </tr>
        </thead>
        <tbody>
          {agences.map((ag, idx) => {
            const isSelected = selectedAgenceId === ag.agence_id;
            const satColor =
              ag.satisfaction_rate >= 80 ? '#3C7730' : ag.satisfaction_rate >= 60 ? '#D97706' : '#DC2626';
            const satBg =
              ag.satisfaction_rate >= 80 ? '#EBF6ED' : ag.satisfaction_rate >= 60 ? '#FEF3C7' : '#FEE2E2';

            return (
              <tr
                key={ag.agence_id}
                style={{
                  background: isSelected ? '#EBF5E9' : '#FFFFFF',
                  borderRadius: '12px',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.02)',
                  transition: 'background 0.15s ease, transform 0.15s ease',
                  cursor: onSelectAgence ? 'pointer' : 'default',
                }}
                onClick={() => onSelectAgence && onSelectAgence(isSelected ? null : ag.agence_id)}
                onMouseEnter={(e) => {
                  if (!isSelected) e.currentTarget.style.background = '#F8FAFC';
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) e.currentTarget.style.background = '#FFFFFF';
                }}
              >
                {/* Rang & Agence */}
                <td style={{ padding: '12px 14px', borderRadius: '12px 0 0 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span
                      style={{
                        width: '24px',
                        height: '24px',
                        borderRadius: '8px',
                        background: idx === 0 ? '#FEF3C7' : '#F1F5F9',
                        color: idx === 0 ? '#B45309' : '#64748B',
                        fontSize: '0.74rem',
                        fontWeight: 800,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      #{idx + 1}
                    </span>
                    <div>
                      <div style={{ fontWeight: 700, color: '#0F172A' }}>{ag.agence_nom}</div>
                    </div>
                  </div>
                </td>

                {/* Ville */}
                <td style={{ padding: '12px 14px', color: '#64748B' }}>
                  {ag.ville || '—'}
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
                    {ag.satisfaction_rate}%
                  </span>
                </td>

                {/* Feedbacks collectés */}
                <td style={{ padding: '12px 14px', textAlign: 'center', fontWeight: 700, color: '#0F172A' }}>
                  {ag.total_feedbacks}
                </td>

                {/* Taux de traitement */}
                <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                  <span style={{ fontWeight: 700, color: '#02302D' }}>{ag.taux_traitement}%</span>
                  <span style={{ color: '#94A3B8', fontSize: '0.72rem', marginLeft: '4px' }}>
                    ({ag.feedbacks_traites})
                  </span>
                </td>

                {/* Alertes critiques */}
                <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                  {ag.alertes_critiques > 0 ? (
                    <span
                      style={{
                        background: '#FEE2E2',
                        color: '#DC2626',
                        padding: '2px 8px',
                        borderRadius: '9999px',
                        fontWeight: 800,
                        fontSize: '0.74rem',
                      }}
                    >
                      {ag.alertes_critiques}
                    </span>
                  ) : (
                    <span style={{ color: '#94A3B8', fontSize: '0.78rem' }}>0</span>
                  )}
                </td>

                {/* Tendance */}
                <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                  {ag.tendance_val ? (
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '2px',
                        color: ag.tendance_positive ? '#3C7730' : '#DC2626',
                        fontWeight: 700,
                        fontSize: '0.76rem',
                      }}
                    >
                      {ag.tendance_positive ? (
                        <ArrowUpRightIcon size={12} color="#3C7730" />
                      ) : (
                        <ArrowDownRightIcon size={12} color="#DC2626" />
                      )}
                      <span>{ag.tendance_val}</span>
                    </div>
                  ) : (
                    <span style={{ color: '#CBD5E1' }}>—</span>
                  )}
                </td>

                {/* Action */}
                {onSelectAgence && (
                  <td style={{ padding: '12px 14px', textAlign: 'right', borderRadius: '0 12px 12px 0' }}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectAgence(isSelected ? null : ag.agence_id);
                      }}
                      style={{
                        padding: '4px 10px',
                        fontSize: '0.76rem',
                        fontWeight: 700,
                        color: isSelected ? '#FFFFFF' : '#3C7730',
                        background: isSelected ? '#3C7730' : '#EBF6ED',
                        border: 'none',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                      }}
                    >
                      {isSelected ? 'Désélectionner' : 'Filtrer'}
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
