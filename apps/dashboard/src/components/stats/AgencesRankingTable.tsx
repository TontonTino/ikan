import React from 'react';
import type { AgenceRankDetail } from '../../types';
import { ArrowUpRightIcon, ArrowDownRightIcon, StoreIcon } from '../common/Icons';
import { tendancePts } from '../../pages/cx/siege/siegeData';

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
            <th
              style={{ textAlign: 'center', padding: '8px 14px', fontWeight: 700, cursor: 'help' }}
              title="Satisfaction corrigée selon le nombre d’avis (méthode de Wilson, 95 %) : une agence avec peu d’avis ne passe pas en tête grâce à quelques notes parfaites."
            >
              Score fiabilisé
            </th>
            <th style={{ textAlign: 'left', padding: '8px 14px', fontWeight: 700 }}>Ville</th>
            <th style={{ textAlign: 'center', padding: '8px 14px', fontWeight: 700 }}>Satisfaction</th>
            <th style={{ textAlign: 'center', padding: '8px 14px', fontWeight: 700 }}>Avis collectés</th>
            <th style={{ textAlign: 'center', padding: '8px 14px', fontWeight: 700 }}>Pris en charge</th>
            <th style={{ textAlign: 'center', padding: '8px 14px', fontWeight: 700 }}>Avis critiques</th>
            <th style={{ textAlign: 'center', padding: '8px 14px', fontWeight: 700 }}>Tendance</th>
            {onSelectAgence && (
              <th style={{ textAlign: 'right', padding: '8px 14px', fontWeight: 700 }}>Action</th>
            )}
          </tr>
        </thead>
        <tbody>
          {agences.map((ag, idx) => {
            const isSelected = selectedAgenceId === ag.agence_id;
            // 0 avis = « Pas d'avis », jamais « 0 % » ni une mauvaise performance (règle data-first).
            const sat = ag.satisfaction_rate;
            const sansAvis = ag.total_feedbacks === 0 || sat === null;
            // tendance_val est une différence en POINTS ; null = l'une des deux périodes sans avis (pas de comparaison).
            const tendance = tendancePts(ag.tendance_val);
            const satColor =
              sat === null || sansAvis ? '#475569' : sat >= 80 ? '#3C7730' : sat >= 60 ? '#D97706' : '#DC2626';
            const satBg =
              sat === null || sansAvis ? '#F1F5F9' : sat >= 80 ? '#EBF6ED' : sat >= 60 ? '#FEF3C7' : '#FEE2E2';

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

                {/* Score Wilson */}
                <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                  <span
                    style={{ fontWeight: 700, color: '#0F172A', cursor: 'help' }}
                    title="Satisfaction corrigée selon le nombre d’avis (méthode de Wilson, 95 %) : une agence avec peu d’avis ne passe pas en tête grâce à quelques notes parfaites."
                  >
                    {sansAvis ? '—' : `${Math.round(ag.wilson_score * 100)}%`}
                  </span>
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
                    {sansAvis ? "Pas d'avis" : `${ag.satisfaction_rate}%`}
                  </span>
                </td>

                {/* Feedbacks collectés */}
                <td style={{ padding: '12px 14px', textAlign: 'center', fontWeight: 700, color: '#0F172A' }}>
                  {ag.total_feedbacks}
                </td>

                {/* Taux de traitement */}
                <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                  <span style={{ fontWeight: 700, color: '#02302D' }}>{sansAvis || ag.taux_traitement === null ? '—' : `${ag.taux_traitement}%`}</span>
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
                  {tendance != null ? (
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '2px',
                        color: tendance >= 0 ? '#3C7730' : '#DC2626',
                        fontWeight: 700,
                        fontSize: '0.76rem',
                      }}
                    >
                      {tendance >= 0 ? (
                        <ArrowUpRightIcon size={12} color="#3C7730" />
                      ) : (
                        <ArrowDownRightIcon size={12} color="#DC2626" />
                      )}
                      <span>{`${tendance > 0 ? '+' : tendance < 0 ? '−' : ''}${Math.abs(tendance).toLocaleString('fr-FR')} pts`}</span>
                    </div>
                  ) : (
                    <span style={{ color: '#5B6B7F' }} title="Pas de comparaison possible : aucun avis sur l'une des deux périodes">—</span>
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
