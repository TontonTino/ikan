import React from 'react';
import { NavLink } from 'react-router-dom';
import type { User } from '../../types';
import IkanLogo from '../common/IkanLogo';
import { XCloseIcon } from '../common/Icons';
import Tooltip from '../ui/Tooltip';
import SidebarWorkspaceCard from './SidebarWorkspaceCard';
import UserMenu from './UserMenu';
import CubeIkan from '../common/CubeIkan';
import type { NavSection } from './navigation';

export const SIDEBAR_ID = 'dashboard-sidebar';

const ROLE_LABEL: Record<User['role'], string> = { admin: 'ADMINISTRATION', cx_manager: 'CX MANAGER', agency_manager: 'AGENCE' };

export interface SidebarProps {
  user: User | null;
  sections: NavSection[];
  /** État réduit effectif (desktop uniquement ; toujours false en tiroir mobile). */
  collapsed: boolean;
  /** Tiroir mobile/tablette ouvert. */
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onLogout: () => void | Promise<void>;
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
export default function Sidebar({ user, sections, collapsed, mobileOpen, onCloseMobile, onLogout }: SidebarProps) {
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
      {/* Filigrane : le cube du logo, ton sur ton, comme dans l'en-tête du formulaire client. Responsables seulement. */}
      {(user?.role === 'cx_manager' || user?.role === 'agency_manager') && <CubeIkan className="dashboard-sidebar__filigrane" />}
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
            style={{ background: 'var(--sidebar-hover-bg)', borderColor: 'var(--sidebar-active-border)', color: 'var(--sidebar-text-strong)' }}
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

      {/* Compte : profil, utilisation du forfait, aide, déconnexion. YAM est en haut à droite de l'en-tête. */}
      <div className="dashboard-sidebar__compte">
        <UserMenu user={user} onLogout={onLogout} placement="menu" collapsed={collapsed} />
      </div>

    </aside>
  );
}
