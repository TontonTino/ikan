import React from 'react';
import { useNavigate } from 'react-router-dom';
import KpiCard from '../ui/KpiCard';
import {
  BuildingIcon,
  UsersIcon,
  TrendingUpIcon,
  MessageSquareIcon,
  CheckCircleIcon,
  AlertTriangleIcon,
} from '../common/Icons';

interface AdminKpiSidebarProps {
  totalOrganisations: number;
  organisationsTrend?: string | null;
  organisationsTrendPositive?: boolean;
  totalCXManagers: number;
  cxManagersTrend?: string | null;
  cxManagersTrendPositive?: boolean;
  satisfactionGlobale: string;
  satisfactionTrend?: string | null;
  satisfactionTrendPositive?: boolean;
  totalFeedbacks: number;
  feedbacksTrend?: string | null;
  feedbacksTrendPositive?: boolean;
  processedFeedbacks: number;
  processedTrend?: string | null;
  processedTrendPositive?: boolean;
  totalAlertes: number;
  alertesTrend?: string | null;
  alertesTrendPositive?: boolean;
}

export default function AdminKpiSidebar({
  totalOrganisations,
  organisationsTrend,
  organisationsTrendPositive = true,
  totalCXManagers,
  cxManagersTrend,
  cxManagersTrendPositive = true,
  satisfactionGlobale,
  satisfactionTrend,
  satisfactionTrendPositive = true,
  totalFeedbacks,
  feedbacksTrend,
  feedbacksTrendPositive = true,
  processedFeedbacks,
  processedTrend,
  processedTrendPositive = true,
  totalAlertes,
  alertesTrend,
  alertesTrendPositive = false,
}: AdminKpiSidebarProps) {
  const navigate = useNavigate();

  const trendValue = (val: string | null | undefined) => val ?? '—';

  return (
    <aside
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '11px',
        width: '100%',
      }}
    >
      {/* Titre de la colonne */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 4px 2px',
        }}
      >
        <h3
          style={{
            fontSize: '0.8rem',
            fontWeight: 800,
            color: '#64748B',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            margin: 0,
          }}
        >
          STATISTIQUES
        </h3>
        <span
          style={{
            background: '#EBF5E9',
            color: '#3C7730',
            fontSize: '0.68rem',
            fontWeight: 800,
            padding: '2px 7px',
            borderRadius: '9999px',
          }}
        >
          Global
        </span>
      </div>

      {/* 1. Organisations */}
      <KpiCard
        icon={<BuildingIcon size={16} />}
        label="Organisations"
        value={totalOrganisations}
        trend={{
          value: trendValue(organisationsTrend),
          isPositive: organisationsTrendPositive,
        }}
        sparklineType="up"
        compact={true}
        onClick={() => navigate('/admin/organisations')}
      />

      {/* 2. CX Managers */}
      <KpiCard
        icon={<UsersIcon size={16} />}
        label="CX Managers"
        value={totalCXManagers}
        trend={{
          value: trendValue(cxManagersTrend),
          isPositive: cxManagersTrendPositive,
        }}
        sparklineType="up"
        compact={true}
        onClick={() => navigate('/admin/utilisateurs')}
      />

      {/* 3. Satisfaction globale */}
      <KpiCard
        icon={<TrendingUpIcon size={16} />}
        label="Satisfaction globale"
        value={satisfactionGlobale || '0%'}
        trend={{
          value: trendValue(satisfactionTrend),
          isPositive: satisfactionTrendPositive,
        }}
        sparklineType="up"
        compact={true}
      />

      {/* 4. Feedbacks collectés */}
      <KpiCard
        icon={<MessageSquareIcon size={16} />}
        label="Feedbacks collectés"
        value={totalFeedbacks.toLocaleString('fr-FR')}
        trend={{
          value: trendValue(feedbacksTrend),
          isPositive: feedbacksTrendPositive,
        }}
        sparklineType="up"
        compact={true}
      />

      {/* 5. Feedbacks traités */}
      <KpiCard
        icon={<CheckCircleIcon size={16} />}
        label="Feedbacks traités"
        value={processedFeedbacks.toLocaleString('fr-FR')}
        trend={{
          value: trendValue(processedTrend),
          isPositive: processedTrendPositive,
        }}
        sparklineType="up"
        compact={true}
      />

      {/* 6. Alertes critiques (Accent Rouge) */}
      <KpiCard
        icon={<AlertTriangleIcon size={16} />}
        label="Alertes critiques"
        value={totalAlertes}
        trend={{
          value: trendValue(alertesTrend),
          isPositive: alertesTrendPositive,
        }}
        badgeColor="red"
        sparklineType="down"
        compact={true}
      />
    </aside>
  );
}
