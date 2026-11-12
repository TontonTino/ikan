import React from 'react';

export interface TabItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  badge?: number | string;
  badgeColor?: 'default' | 'red' | 'green';
}

interface TabsNavigationProps {
  tabs: TabItem[];
  activeTab: string;
  onChange: (tabId: string) => void;
  style?: React.CSSProperties;
}

export default function TabsNavigation({
  tabs,
  activeTab,
  onChange,
  style,
}: TabsNavigationProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px',
        background: 'var(--color-surface)',
        borderRadius: '16px',
        border: '1px solid var(--color-trait)',
        width: 'fit-content',
        maxWidth: '100%',
        overflowX: 'auto',
        marginBottom: '24px',
        scrollbarWidth: 'none',
        ...style,
      }}
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(tab.id)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 16px',
              borderRadius: '12px',
              fontSize: 'var(--text-sm)',
              fontWeight: isActive ? 'var(--weight-semibold)' : 'var(--weight-semibold)',
              color: isActive ? 'var(--color-text-inverse)' : 'var(--color-text-2)',
              background: isActive ? 'var(--color-encre)' : 'transparent',
              border: 'none',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap',
              fontFamily: 'inherit',
              lineHeight: 1.2,
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                e.currentTarget.style.color = 'var(--color-encre)';
                e.currentTarget.style.background = 'var(--color-bg)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                e.currentTarget.style.color = 'var(--color-text-2)';
                e.currentTarget.style.background = 'transparent';
              }
            }}
          >
            {tab.icon && (
              <span style={{ display: 'flex', alignItems: 'center', opacity: isActive ? 1 : 0.85 }}>
                {tab.icon}
              </span>
            )}
            <span>{tab.label}</span>
            {tab.badge !== undefined && (
              <span
                style={{
                  fontSize: 'var(--text-xs)',
                  fontWeight: 'var(--weight-semibold)',
                  padding: '2px 7px',
                  borderRadius: '9999px',
                  lineHeight: 1,
                  background: isActive
                    ? 'rgba(255, 255, 255, 0.22)'
                    : tab.badgeColor === 'red'
                      ? 'var(--color-critique-fond)'
                      : tab.badgeColor === 'green'
                        ? 'var(--color-bon-fond)'
                        : 'var(--color-neutre-fond)',
                  color: isActive
                    ? 'var(--color-text-inverse)'
                    : tab.badgeColor === 'red'
                      ? 'var(--color-critique-texte)'
                      : tab.badgeColor === 'green'
                        ? 'var(--color-bon-texte)'
                        : 'var(--color-neutre-texte)',
                }}
              >
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
