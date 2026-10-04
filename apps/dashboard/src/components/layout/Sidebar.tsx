import React, { useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import type { User } from '../../types';
import IkanLogo from '../common/IkanLogo';
import { ChevronRightIcon, XCloseIcon } from '../common/Icons';
import Tooltip from '../ui/Tooltip';
import SidebarWorkspaceCard from './SidebarWorkspaceCard';
import YamAvatar from '../agent/YamAvatar';
import { YAM_PANEL_ID } from '../agent/YamChatPanel';
import type { NavSection } from './navigation';

export const SIDEBAR_ID = 'dashboard-sidebar';

const ROLE_LABEL: Record<User['role'], string> = { admin: 'ADMIN', cx_manager: 'CX MANAGER', agency_manager: 'AGENCE' };

export interface SidebarProps {
  user: User | null;
  sections: NavSection[];
  /** État réduit effectif (desktop uniquement ; toujours false en tiroir mobile). */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Tiroir mobile/tablette ouvert. */
  mobileOpen: boolean;
  onCloseMobile: () => void;
  yam?: { open: boolean; onToggle: () => void };
}

/** Raccourci « [ » : ignoré dans les champs de saisie et avec un modificateur. */
function useToggleShortcut(enabled: boolean, onToggle: () => void) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '[' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      e.preventDefault();
      onToggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, onToggle]);
}

/**
 * Navigation principale.
 *  - Ouverte : logo, rôle, espace de travail, sections titrées, libellés.
 *  - Réduite (desktop) : icônes seules ; chaque entrée garde un nom accessible
 *    et un tooltip au survol ET au focus clavier ; les compteurs deviennent
 *    une pastille (le nombre reste annoncé).
 *  - Mobile/tablette (≤ 1024 px) : tiroir modal piloté par DashboardLayout.
 * Les liens proviennent de ROLE_NAV_SECTIONS (navigation.tsx), alignés sur
 * les gardes de route : un rôle ne voit que ce qu'il peut ouvrir.
 */
export default function Sidebar({ user, sections, collapsed, onToggleCollapsed, mobileOpen, onCloseMobile, yam }: SidebarProps) {
  // Le raccourci ne s'applique qu'à la barre desktop (pas au tiroir).
  useToggleShortcut(!mobileOpen, onToggleCollapsed);

  const withTooltip = (label: string, node: React.ReactElement) =>
    collapsed ? (
      <Tooltip content={label} placement="right" decorative delay={0}>
        {node}
      </Tooltip>
    ) : (
      node
    );

  return (
    <aside
      id={SIDEBAR_ID}
      role={mobileOpen ? 'dialog' : undefined}
      aria-modal={mobileOpen ? true : undefined}
      aria-label={mobileOpen ? 'Menu principal' : undefined}
      tabIndex={mobileOpen ? -1 : undefined}
      className={[
        'dashboard-sidebar',
        mobileOpen && 'dashboard-sidebar--open',
        collapsed && 'dashboard-sidebar--collapsed',
        'ikan-sidebar--dark',
        'on-dark',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="dashboard-sidebar__head">
        <div className="dashboard-sidebar-brand-logo">
          <IkanLogo variant="light" size={28} showText={!collapsed} />
        </div>
        {user && <div className="dashboard-role-label">{ROLE_LABEL[user.role]}</div>}
        {mobileOpen && (
          <button
            type="button"
            className="dashboard-mobile-close yam-icon-btn"
            onClick={onCloseMobile}
            aria-label="Fermer le menu"
            style={{ background: 'rgba(255,255,255,0.08)', borderColor: 'rgba(255,255,255,0.18)', color: 'var(--sidebar-text-strong)' }}
          >
            <XCloseIcon size={18} />
          </button>
        )}
      </div>

      <SidebarWorkspaceCard user={user} collapsed={collapsed} />

      <nav aria-label="Navigation principale" className="dashboard-primary-nav">
        {sections.map((section, idx) => (
          <div key={section.title ?? idx} className="dashboard-nav-section">
            {section.title && <div className="ikan-nav-section-title" id={`nav-section-${idx}`}>{section.title}</div>}
            <ul className="dashboard-nav-list" aria-labelledby={section.title ? `nav-section-${idx}` : undefined}>
              {section.items.map((item) => {
                const accessibleName = item.badge ? `${item.label} (${item.badge})` : item.label;
                return (
                  <li key={item.path}>
                    {withTooltip(
                      accessibleName,
                      <NavLink
                        to={item.path}
                        aria-label={collapsed ? accessibleName : undefined}
                        className={({ isActive }) => `ikan-nav-link${isActive ? ' ikan-nav-link--active' : ''}`}
                      >
                        <span className="ikan-nav-link-content">
                          <span className="ikan-nav-icon" aria-hidden="true">
                            {item.icon}
                            {collapsed && !!item.badge && <span className={`ikan-nav-dot${item.badgeUrgent ? ' ikan-nav-dot--urgent' : ''}`} />}
                          </span>
                          <span className="ikan-nav-link-label">{item.label}</span>
                        </span>
                        {!!item.badge && (
                          <span className={`ikan-nav-badge${item.badgeUrgent ? ' ikan-nav-badge--urgent' : ''}`}>{item.badge}</span>
                        )}
                      </NavLink>,
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* Assistant YAM : ouvre le panneau, ne change pas de page */}
      {yam &&
        withTooltip(
          'Demander à YAM',
          <button
            type="button"
            onClick={yam.onToggle}
            aria-expanded={yam.open}
            aria-controls={YAM_PANEL_ID}
            aria-label={collapsed ? 'Demander à YAM, assistant IA' : undefined}
            className="ikan-yam-button"
          >
            <YamAvatar size={34} />
            <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25, minWidth: 0 }}>
              <span className="ikan-yam-button-label" style={{ fontWeight: 800, fontSize: 'var(--text-md)', color: 'var(--sidebar-text-strong)' }}>
                Demander à YAM
              </span>
              <span className="ikan-yam-subtitle" style={{ fontWeight: 600, fontSize: 'var(--text-xs)' }}>Assistant IA</span>
            </span>
            <span className="ikan-yam-chevron" aria-hidden="true">
              <ChevronRightIcon size={14} />
            </span>
          </button>,
        )}

      {withTooltip(
        'Agrandir le menu ( [ )',
        <button
          type="button"
          className="dashboard-sidebar-toggle"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? 'Agrandir la barre latérale' : 'Réduire la barre latérale'}
          aria-expanded={!collapsed}
          aria-controls={SIDEBAR_ID}
          aria-keyshortcuts="["
        >
          <span className="dashboard-sidebar-toggle__icon" aria-hidden="true">
            <ChevronRightIcon size={17} />
          </span>
          <span className="dashboard-sidebar-toggle__label">Réduire</span>
          <kbd className="dashboard-sidebar-toggle__kbd" aria-hidden="true">[</kbd>
        </button>,
      )}
    </aside>
  );
}
