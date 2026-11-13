import React from 'react';
import type { AgenceRankDetail } from '../../types';
import Tooltip from '../ui/Tooltip';
import { DEFINITION_NEGATIF, PartNegatifsTexte, comparaisonInsuffisante, phraseComparaisonInsuffisante } from '../../utils/partNegatifs';
import { AIDE_SCORE_FIABILISE, LIBELLE_SCORE_FIABILISE } from '../../utils/scoreFiabilise';
import { formaterPourcentage } from '../../utils/formatNombre';

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
          color: 'var(--color-text-2)',
          fontSize: 'var(--text-sm)',
          background: 'var(--color-bg)',
          borderRadius: '16px',
          border: '1px dashed var(--color-trait)',
        }}
      >
        Aucune agence trouvée pour ce périmètre.
      </div>
    );
  }

  // « Données insuffisantes pour comparer » : une seule phrase au-dessus du tableau, pas une mention par cellule.
  const insuffisantes = phraseComparaisonInsuffisante(
    agences.filter((ag) => ag.total_feedbacks > 0 && ag.satisfaction_rate !== null && comparaisonInsuffisante(ag.part_negatifs)).length,
  );

  return (
    <div style={{ width: '100%', overflowX: 'auto' }}>
      {insuffisantes && <p className="siege-note" style={{ margin: '0 4px 8px' }}>{insuffisantes}</p>}
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
            <th style={{ textAlign: 'left', padding: '8px 14px', fontWeight: 'var(--weight-semibold)' }}>Rang & Agence</th>
            <th style={{ textAlign: 'center', padding: '8px 14px', fontWeight: 'var(--weight-semibold)' }}>
              {LIBELLE_SCORE_FIABILISE}{' '}
              <Tooltip content={AIDE_SCORE_FIABILISE} placement="bottom">
                <button type="button" className="ui-info-btn" aria-label={`À propos du ${LIBELLE_SCORE_FIABILISE.toLowerCase()}`}>?</button>
              </Tooltip>
            </th>
            <th style={{ textAlign: 'left', padding: '8px 14px', fontWeight: 'var(--weight-semibold)' }}>Ville</th>
            <th style={{ textAlign: 'center', padding: '8px 14px', fontWeight: 'var(--weight-semibold)' }}>Satisfaction</th>
            <th style={{ textAlign: 'center', padding: '8px 14px', fontWeight: 'var(--weight-semibold)' }}>Avis collectés</th>
            <th style={{ textAlign: 'center', padding: '8px 14px', fontWeight: 'var(--weight-semibold)' }}>Pris en charge</th>
            <th style={{ textAlign: 'center', padding: '8px 14px', fontWeight: 'var(--weight-semibold)' }}>Avis critiques</th>
            <th style={{ textAlign: 'center', padding: '8px 14px', fontWeight: 'var(--weight-semibold)' }} title={DEFINITION_NEGATIF}>Avis négatifs</th>
            {onSelectAgence && (
              <th style={{ textAlign: 'right', padding: '8px 14px', fontWeight: 'var(--weight-semibold)' }}>Action</th>
            )}
          </tr>
        </thead>
        <tbody>
          {agences.map((ag, idx) => {
            const isSelected = selectedAgenceId === ag.agence_id;
            // 0 avis = « Pas d'avis », jamais « 0 % » ni une mauvaise performance (règle data-first).
            const sat = ag.satisfaction_rate;
            const sansAvis = ag.total_feedbacks === 0 || sat === null;
            const satColor =
              sat === null || sansAvis ? 'var(--color-neutre-texte)' : sat >= 80 ? 'var(--color-bon-texte)' : sat >= 60 ? 'var(--color-surveiller-texte)' : 'var(--color-critique-texte)';
            const satBg =
              sat === null || sansAvis ? 'var(--color-neutre-fond)' : sat >= 80 ? 'var(--color-bon-fond)' : sat >= 60 ? 'var(--color-surveiller-fond)' : 'var(--color-critique-fond)';

            return (
              <tr
                key={ag.agence_id}
                style={{
                  background: isSelected ? 'var(--color-bon-fond)' : 'var(--color-surface)',
                  borderRadius: '12px',
                  transition: 'background 0.15s ease, transform 0.15s ease',
                  cursor: onSelectAgence ? 'pointer' : 'default',
                }}
                onClick={() => onSelectAgence && onSelectAgence(isSelected ? null : ag.agence_id)}
                onMouseEnter={(e) => {
                  if (!isSelected) e.currentTarget.style.background = 'var(--color-bg)';
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) e.currentTarget.style.background = 'var(--color-surface)';
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
                        background: 'var(--color-neutre-fond)',
                        color: 'var(--color-text-2)',
                        fontSize: 'var(--text-xs)',
                        fontWeight: 'var(--weight-semibold)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      #{idx + 1}
                    </span>
                    <div>
                      <div className="t-semi t-encre">{ag.agence_nom}</div>
                    </div>
                  </div>
                </td>

                {/* Score Wilson */}
                <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                  <span className="t-semi t-encre">
                    {sansAvis ? '—' : formaterPourcentage(Math.round(ag.wilson_score * 100), 0)}
                  </span>
                </td>

                {/* Ville */}
                <td style={{ padding: '12px 14px', color: 'var(--color-text-2)' }}>
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
                      fontWeight: 'var(--weight-semibold)',
                      fontSize: 'var(--text-xs)',
                      display: 'inline-block',
                    }}
                  >
                    {sansAvis ? "Pas d'avis" : formaterPourcentage(ag.satisfaction_rate)}
                  </span>
                </td>

                {/* Feedbacks collectés */}
                <td style={{ padding: '12px 14px', textAlign: 'center', fontWeight: 'var(--weight-semibold)', color: 'var(--color-encre)' }}>
                  {ag.total_feedbacks}
                </td>

                {/* Taux de traitement */}
                <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                  <span className="t-semi t-encre">{sansAvis || ag.taux_traitement === null ? '—' : formaterPourcentage(ag.taux_traitement)}</span>
                  <span style={{ color: 'var(--color-text-2)', fontSize: 'var(--text-xs)', marginLeft: '4px' }}>
                    ({ag.feedbacks_traites})
                  </span>
                </td>

                {/* Alertes critiques */}
                <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                  {ag.alertes_critiques > 0 ? (
                    <span
                      style={{
                        background: 'var(--color-critique-fond)',
                        color: 'var(--color-critique-texte)',
                        padding: '2px 8px',
                        borderRadius: '9999px',
                        fontWeight: 'var(--weight-semibold)',
                        fontSize: 'var(--text-xs)',
                      }}
                    >
                      {ag.alertes_critiques}
                    </span>
                  ) : (
                    <span className="t-2 t-xs">0</span>
                  )}
                </td>

                {/* Part d'avis négatifs et son évolution */}
                <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                  {sansAvis ? <span className="t-2">—</span> : <PartNegatifsTexte pn={ag.part_negatifs} court sansMentionInsuffisante />}
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
                        fontSize: 'var(--text-xs)',
                        fontWeight: 'var(--weight-semibold)',
                        color: isSelected ? 'var(--color-text-inverse)' : 'var(--color-encre)',
                        background: isSelected ? 'var(--color-encre)' : 'var(--color-surface)',
                        border: isSelected ? '1px solid var(--color-encre)' : '1px solid var(--color-border)',
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
      <p style={{ margin: '10px 4px 0', fontSize: 'var(--text-xs)', color: 'var(--color-text-2)' }}>
        <strong>{LIBELLE_SCORE_FIABILISE}</strong> : {AIDE_SCORE_FIABILISE}
      </p>
    </div>
  );
}
