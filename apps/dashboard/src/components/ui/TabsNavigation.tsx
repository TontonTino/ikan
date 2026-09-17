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
        background: '#FFFFFF',
        borderRadius: '16px',
        border: '1px solid #E2E8F0',
        width: 'fit-content',
        maxWidth: '100%',
        overflowX: 'auto',
        boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
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
            onClick={() => onChange(tab.id)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 16px',
              borderRadius: '12px',
              fontSize: '0.84rem',
              fontWeight: isActive ? 700 : 600,
              color: isActive ? '#FFFFFF' : '#64748B',
              background: isActive ? '#02302D' : 'transparent',
              border: 'none',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              whiteSpace: 'nowrap',
              fontFamily: 'inherit',
              lineHeight: 1.2,
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                e.currentTarget.style.color = '#02302D';
                e.currentTarget.style.background = '#F8FAFC';
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                e.currentTarget.style.color = '#64748B';
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
                  fontSize: '0.70rem',
                  fontWeight: 800,
                  padding: '2px 7px',
                  borderRadius: '9999px',
                  lineHeight: 1,
                  background: isActive
                    ? 'rgba(255, 255, 255, 0.22)'
                    : tab.badgeColor === 'red'
                      ? '#FEE2E2'
                      : tab.badgeColor === 'green'
                        ? '#EBF6ED'
                        : '#F1F5F9',
                  color: isActive
                    ? '#FFFFFF'
                    : tab.badgeColor === 'red'
                      ? '#DC2626'
                      : tab.badgeColor === 'green'
                        ? '#3C7730'
                        : '#64748B',
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
