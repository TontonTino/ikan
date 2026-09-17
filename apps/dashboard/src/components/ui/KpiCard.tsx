import React from 'react';
import { ArrowUpRightIcon, ArrowDownRightIcon, SparklineWave } from '../common/Icons';

export interface KpiCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  trend?: {
    value: string;
    isPositive?: boolean;
    period?: string;
  };
  sparklineType?: 'up' | 'down' | 'neutral';
  badgeColor?: 'green' | 'red' | 'neutral';
  subtitle?: string;
  onClick?: () => void;
  compact?: boolean;
}

export default function KpiCard({
  icon,
  label,
  value,
  trend,
  sparklineType = 'up',
  badgeColor = 'green',
  subtitle,
  onClick,
  compact = false,
}: KpiCardProps) {
  const isNegative = badgeColor === 'red' || (trend && trend.isPositive === false);
  
  const iconBg = isNegative ? '#FEE2E2' : '#EDF7E8';
  const iconColor = isNegative ? '#DC2626' : '#3C7730';
  const badgeBg = isNegative ? '#FEE2E2' : '#EBF5E9';
  const badgeTextColor = isNegative ? '#DC2626' : '#3C7730';
  const sparkColor = isNegative ? '#DC2626' : '#3C7730';

  if (compact) {
    return (
      <div
        onClick={onClick}
        style={{
          background: '#FFFFFF',
          borderRadius: '16px',
          padding: '11px 16px',
          border: isNegative && badgeColor === 'red' ? '1px solid #FECACA' : '1px solid #E8ECE6',
          boxShadow: '0 3px 16px rgba(20, 60, 40, 0.05)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          minHeight: '82px',
          maxHeight: '90px',
          position: 'relative',
          cursor: onClick ? 'pointer' : 'default',
          transition: 'transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translateY(-1px)';
          e.currentTarget.style.boxShadow = '0 6px 22px rgba(20, 60, 40, 0.09)';
          if (onClick) {
            e.currentTarget.style.borderColor = '#DDE4DB';
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = '0 3px 16px rgba(20, 60, 40, 0.05)';
          e.currentTarget.style.borderColor =
            isNegative && badgeColor === 'red' ? '#FECACA' : '#E8ECE6';
        }}
      >
        {/* Ligne 1 : [Icône] Nom du KPI ... [Sparkline] */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
            <div
              style={{
                width: '26px',
                height: '26px',
                borderRadius: '8px',
                background: iconBg,
                color: iconColor,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {React.isValidElement(icon)
                ? React.cloneElement(icon as React.ReactElement<any>, { size: 14 })
                : icon}
            </div>

            <span
              style={{
                fontSize: '0.78rem',
                color: '#64748B',
                fontWeight: 700,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {label}
            </span>
          </div>

          <div style={{ flexShrink: 0, opacity: 0.85, display: 'flex', alignItems: 'center' }}>
            <SparklineWave type={sparklineType} color={sparkColor} width={46} height={16} />
          </div>
        </div>

        {/* Ligne 2 : Valeur principale + [Variation] vs. mois dernier */}
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            marginTop: '2px',
          }}
        >
          <div
            style={{
              fontSize: '1.38rem',
              fontWeight: 800,
              color: isNegative && badgeColor === 'red' ? '#DC2626' : '#02302D',
              letterSpacing: '-0.02em',
              lineHeight: 1,
            }}
          >
            {value}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {trend && (
              <div
                style={{
                  background: badgeBg,
                  color: badgeTextColor,
                  borderRadius: '9999px',
                  padding: '2px 6px',
                  fontSize: '0.68rem',
                  fontWeight: 800,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '2px',
                  lineHeight: 1,
                }}
              >
                {isNegative ? (
                  <ArrowDownRightIcon size={10} color={badgeTextColor} />
                ) : (
                  <ArrowUpRightIcon size={10} color={badgeTextColor} />
                )}
                <span>{trend.value}</span>
              </div>
            )}

            <span
              style={{
                fontSize: '0.68rem',
                color: '#94A3B8',
                fontWeight: 500,
                whiteSpace: 'nowrap',
              }}
            >
              {trend?.period || subtitle || 'vs. mois dernier'}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      style={{
        background: '#FFFFFF',
        borderRadius: '24px',
        padding: '24px',
        border: '1px solid #E8ECE6',
        boxShadow: '0 2px 10px rgba(0, 0, 0, 0.02)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        minHeight: '190px',
        position: 'relative',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease',
      }}
      onMouseEnter={(e) => {
        if (onClick) {
          e.currentTarget.style.transform = 'translateY(-2px)';
          e.currentTarget.style.boxShadow = '0 8px 24px rgba(2, 48, 45, 0.06)';
          e.currentTarget.style.borderColor = '#DDE4DB';
        }
      }}
      onMouseLeave={(e) => {
        if (onClick) {
          e.currentTarget.style.transform = 'translateY(0)';
          e.currentTarget.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.02)';
          e.currentTarget.style.borderColor = '#E8ECE6';
        }
      }}
    >
      {/* 1. Top Row: Icon Container + Sparkline */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div
          style={{
            width: '44px',
            height: '44px',
            borderRadius: '14px',
            background: iconBg,
            color: iconColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {icon}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', opacity: 0.85 }}>
          <SparklineWave type={sparklineType} color={sparkColor} width={64} height={22} />
        </div>
      </div>

      {/* 2. Middle Row: Label + Large Value */}
      <div style={{ marginTop: '14px' }}>
        <div
          style={{
            fontSize: '0.84rem',
            color: '#64748B',
            fontWeight: 600,
            lineHeight: 1.3,
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontSize: '2.35rem',
            fontWeight: 800,
            color: '#02302D',
            lineHeight: 1.1,
            marginTop: '4px',
            letterSpacing: '-0.02em',
          }}
        >
          {value}
        </div>
      </div>

      {/* 3. Bottom Row: Trend Capsule + Period or Subtitle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '14px' }}>
        {trend && (
          <div
            style={{
              background: badgeBg,
              color: badgeTextColor,
              borderRadius: '9999px',
              padding: '3px 9px',
              fontSize: '0.74rem',
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '3px',
              flexShrink: 0,
            }}
          >
            {isNegative ? (
              <ArrowDownRightIcon size={12} color={badgeTextColor} />
            ) : (
              <ArrowUpRightIcon size={12} color={badgeTextColor} />
            )}
            <span>{trend.value}</span>
          </div>
        )}

        <div
          style={{
            fontSize: '0.74rem',
            color: '#94A3B8',
            fontWeight: 500,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {trend?.period || subtitle || 'vs. mois dernier'}
        </div>
      </div>
    </div>
  );
}

