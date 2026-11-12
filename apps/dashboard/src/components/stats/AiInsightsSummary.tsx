import React from 'react';
import type { InsightIADetail } from '../../types';
import { FileTextIcon, CheckCircleIcon, AlertTriangleIcon, LightbulbIcon } from '../common/Icons';
import { contientIA } from '../../utils/sourceAnalyse';
import { texteRecommandationAffiche } from '../../utils/texteRecommandation';

interface AiInsightsSummaryProps {
  insights: InsightIADetail[];
}

export default function AiInsightsSummary({ insights }: AiInsightsSummaryProps) {
  if (!insights || insights.length === 0) {
    return null;
  }

  // Libellé selon l'origine réelle (source) : « IA » uniquement si un LLM a produit un contenu.
  const ia = contientIA(insights);

  const getIcon = (type: string) => {
    switch (type) {
      case 'point_fort':
        return <CheckCircleIcon size={16} color="var(--color-bon-texte)" />;
      case 'point_vigilance':
        return <AlertTriangleIcon size={16} color="var(--color-surveiller-texte)" />;
      case 'recommandation':
      default:
        return <LightbulbIcon size={16} color="var(--color-neutre-texte)" />;
    }
  };

  const getBg = (type: string) => {
    switch (type) {
      case 'point_fort':
        return 'var(--color-bon-fond)';
      case 'point_vigilance':
        return 'var(--color-surveiller-fond)';
      case 'recommandation':
      default:
        return 'var(--color-bg)';
    }
  };

  const getBorder = (type: string) => {
    switch (type) {
      case 'point_fort':
        return 'var(--color-bon-fond)';
      case 'point_vigilance':
        return 'var(--color-surveiller-fond)';
      case 'recommandation':
      default:
        return 'var(--color-trait)';
    }
  };

  return (
    <div
      style={{
        background: 'var(--color-surface)',
        borderRadius: '24px',
        padding: '24px 28px',
        border: '1px solid var(--color-trait)',
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '18px' }}>
        <FileTextIcon size={20} color="var(--color-text-2)" />
        <div>
          <div className="t-base t-semi t-encre">
            {ia ? 'Ce que suggère l’analyse (IA)' : 'Ce que suggère l’analyse'}
          </div>
          <div className="t-xs t-2">
            {ia
              ? 'Constats et actions suggérés par l’IA à partir des avis — à vérifier avant de les appliquer'
              : 'Constats calculés automatiquement par règles à partir des avis de la période — à vérifier avant d’agir'}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '14px' }}>
        {insights.map((item) => (
          <div
            key={item.id}
            style={{
              background: getBg(item.type),
              border: `1px solid ${getBorder(item.type)}`,
              borderRadius: '16px',
              padding: '16px 18px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: '10px',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                {getIcon(item.type)}
                <span className="t-sm t-semi t-encre">
                  {item.titre}
                </span>
              </div>
              <p
                style={{
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-text-2)',
                  lineHeight: 1.45,
                  margin: 0,
                }}
              >
                {/* Recommandation : le préfixe « URGENT — » n'est pas affiché (la priorité est dite ailleurs) ; la donnée reste intacte. */}
                {item.type === 'recommandation' ? texteRecommandationAffiche(item.description) : item.description}
              </p>
            </div>

            {item.agence_nom && (
              <div className="t-xs t-semi t-bon">
                📍 {item.agence_nom}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
