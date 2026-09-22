import React, { useEffect, useState } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { alertesApi } from '../../services/api';
import type { UserRole } from '../../types';
import IkanLogo from '../common/IkanLogo';
import SidebarWorkspaceCard from './SidebarWorkspaceCard';
import UserMenu from './UserMenu';
import YamChatPanel, { YAM_PANEL_ID } from '../agent/YamChatPanel';
import YamAvatar from '../agent/YamAvatar';
import {
  LayoutGridIcon,
  BuildingIcon,
  UsersIcon,
  ShieldCheckIcon,
  SettingsIcon,
  BarChartIcon,
  MessageSquareIcon,
  StoreIcon,
  BellIcon,
  TrendingUpIcon,
  ChevronDownIcon,
  LandmarkIcon,
} from '../common/Icons';

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
  badge?: number | string;
  badgeUrgent?: boolean;
}

interface NavSection {
  title?: string;
  items: NavItem[];
}

const ROLE_NAV_SECTIONS: Record<UserRole, NavSection[]> = {
  admin: [
    {
      title: 'WORKSPACE',
      items: [
        { path: '/admin/dashboard', label: 'Dashboard', icon: <LayoutGridIcon size={18} /> },
        { path: '/admin/statistiques', label: 'Statistiques Plateforme', icon: <BarChartIcon size={18} /> },
        { path: '/admin/organisations', label: 'Organisations', icon: <BuildingIcon size={18} /> },
        { path: '/admin/facturation', label: 'Facturation', icon: <LandmarkIcon size={18} /> },
        { path: '/admin/gestion-agences', label: 'Gestion des agences', icon: <UsersIcon size={18} /> },
        { path: '/admin/settings', label: 'Paramètres', icon: <SettingsIcon size={18} /> },
      ],
    },
  ],
  cx_manager: [
    {
      title: 'WORKSPACE',
      items: [
        { path: '/siege', label: 'Dashboard', icon: <LayoutGridIcon size={18} /> },
        { path: '/statistiques', label: 'Statistiques & Analyses', icon: <BarChartIcon size={18} /> },
        { path: '/feedbacks', label: 'Feedbacks Réseau', icon: <MessageSquareIcon size={18} /> },
        { path: '/pilotage', label: 'Pilotage', icon: <BellIcon size={18} /> },
        { path: '/admin/gestion-agences', label: 'Gestion des agences', icon: <StoreIcon size={18} /> },
      ],
    },
  ],
  agency_manager: [
    {
      title: 'WORKSPACE',
      items: [
        { path: '/agence', label: 'Dashboard Agence', icon: <LayoutGridIcon size={18} /> },
        { path: '/statistiques', label: 'Statistiques & Analyses', icon: <BarChartIcon size={18} /> },
        { path: '/feedbacks', label: 'Feedbacks Clients', icon: <MessageSquareIcon size={18} /> },
        { path: '/pilotage', label: 'Pilotage', icon: <BellIcon size={18} /> },
        { path: '/mon-agence', label: 'Mon agence', icon: <StoreIcon size={18} /> },
      ],
    },
  ],
};

// Un bug d'affichage du chat ne doit jamais casser le reste du dashboard :
// en cas d'erreur de rendu, le panneau disparaît et le reste de l'application continue.
class YamErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error('[YAM] panneau de chat désactivé suite à une erreur :', error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export default function DashboardLayout() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [alertCount, setAlertCount] = useState<number>(0);
  const [yamOpen, setYamOpen] = useState(false);
  // YAM : CX Manager et Agency Manager uniquement (l'Admin n'est jamais proposé, même si l'API le refuse aussi).
  const canUseYam = user?.role === 'cx_manager' || user?.role === 'agency_manager';

  useEffect(() => {
    if (user?.role === 'cx_manager' || user?.role === 'agency_manager') {
      alertesApi
        .list()
        .then((r) => {
          if (Array.isArray(r.data)) {
            setAlertCount(r.data.length);
          }
        })
        .catch(() => setAlertCount(0));
    }
  }, [user?.role, location.pathname]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const navSections = user ? ROLE_NAV_SECTIONS[user.role] || [] : [];
  const isAlertesActive = location.pathname === '/alertes' || location.pathname === '/pilotage';

  // Fil d'Ariane dynamique
  const getBreadcrumb = () => {
    if (location.pathname.includes('/statistiques')) return user?.role === 'admin' ? 'Statistiques de la plateforme' : 'Statistiques & Analyses';
    if (location.pathname.includes('/admin/organisations')) return 'Organisations';
    if (location.pathname.includes('/admin/facturation')) return 'Facturation';
    if (location.pathname.includes('/admin/gestion-agences')) return 'Gestion des agences';
    if (location.pathname.includes('/admin/permissions')) return 'Permissions';
    if (location.pathname.includes('/admin/settings')) return 'Paramètres';
    if (location.pathname.includes('/parametres')) return 'Paramètres';
    if (location.pathname.includes('/mon-agence')) return 'Mon agence';
    if (location.pathname.includes('/admin/dashboard')) return 'Dashboard';
    if (location.pathname.includes('/siege')) return 'Vue Siège';
    if (location.pathname.includes('/agence')) return 'Dashboard Agence';
    if (location.pathname.includes('/feedbacks')) return 'Feedbacks';
    if (location.pathname.includes('/pilotage')) return 'Pilotage';
    if (location.pathname.includes('/suggestions')) return 'Boîte à idées';
    if (location.pathname.includes('/alertes')) return 'Alertes';
    return 'Dashboard';
  };

  // Pages dont la bannière d'en-tête (et donc le fil d'Ariane) a été retirée :
  // Feedbacks, Pilotage et Gestion des agences (tous rôles), Statistiques
  // uniquement pour le CX Manager (les vues Admin/Agence gardent leur bannière),
  // et l'ensemble des pages de l'Agency Manager (fil d'Ariane jugé superflu pour ce rôle).
  const hideBreadcrumb =
    location.pathname.includes('/feedbacks') ||
    location.pathname.includes('/pilotage') ||
    location.pathname.includes('/admin/gestion-agences') ||
    (location.pathname.includes('/statistiques') && user?.role === 'cx_manager') ||
    user?.role === 'agency_manager';


  const roleLabel =
    user?.role === 'admin'
      ? 'ADMIN'
      : user?.role === 'cx_manager'
        ? 'CX MANAGER'
        : 'AGENCE';

  return (

    <div
      style={{
        display: 'flex',
        minHeight: '100vh',
        background: 'var(--color-bg)',
        width: '100%',
        maxWidth: '100%',
        boxSizing: 'border-box',
        position: 'relative',
      }}
    >
      {/* ── Sidebar Latérale (Style SaaS Épuré Bolt.new) ── */}
      <aside
        style={{
          width: '270px',
          background: '#F3F8F4',
          display: 'flex',
          flexDirection: 'column',
          position: 'fixed',
          top: '16px',
          left: '16px',
          height: 'calc(100vh - 32px)',
          zIndex: 30,
          borderRadius: '20px',
          border: '1px solid #DCE8DF',
          boxShadow: '0 4px 20px rgba(2, 45, 42, 0.06)',
          padding: '24px 18px',
          overflow: 'hidden',
          boxSizing: 'border-box',
        }}
      >
        {/* 1. Header Logo + Badge de Rôle */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 6px 22px',
          }}
        >
          <IkanLogo size={28} showText={false} />
          <div
            style={{
              background: '#EBF5E9',
              color: '#3C7730',
              fontSize: '0.68rem',
              fontWeight: 800,
              letterSpacing: '0.05em',
              padding: '3px 8px',
              borderRadius: '9999px',
              border: '1px solid #D5E8D3',
            }}
          >
            {roleLabel}
          </div>
        </div>

        {/* 2. Card Sélecteur d'Espace / Organisation Dynamique */}
        <SidebarWorkspaceCard user={user} />


        {/* 3. Navigation Links */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
          }}
        >
          {navSections.map((section, idx) => (
            <div key={idx}>
              {section.title && (
                <div
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 800,
                    color: '#94A3B8',
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    padding: '0 12px 8px',
                  }}
                >
                  {section.title}
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {section.items.map((item) => {
                  // Le badge de "Pilotage" reflète le nombre d'alertes actives en temps réel
                  const badgeValue = item.path === '/pilotage' ? alertCount : item.badge;
                  const badgeUrgent = item.path === '/pilotage' ? alertCount > 0 : item.badgeUrgent;
                  return (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      style={({ isActive }) => ({
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '11px 14px',
                        color: isActive ? '#022D2A' : '#64748B',
                        textDecoration: 'none',
                        background: isActive ? '#E2F2E5' : 'transparent',
                        fontWeight: isActive ? 700 : 600,
                        fontSize: '0.88rem',
                        borderRadius: '12px',
                        transition: 'all 0.15s ease',
                      })}
                    >
                      {({ isActive }) => (
                        <>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <span
                              style={{
                                color: isActive ? '#3C7730' : '#94A3B8',
                                display: 'flex',
                                alignItems: 'center',
                              }}
                            >
                              {item.icon}
                            </span>
                            <span>{item.label}</span>
                          </div>
                          {!!badgeValue && (
                            <span
                              style={{
                                background: badgeUrgent ? '#FEE2E2' : (isActive ? '#D3EAD7' : '#EAF2EC'),
                                color: badgeUrgent ? '#DC2626' : (isActive ? '#022D2A' : '#64748B'),
                                fontSize: '0.72rem',
                                fontWeight: 700,
                                padding: '2px 8px',
                                borderRadius: '9999px',
                              }}
                            >
                              {badgeValue}
                            </span>
                          )}
                        </>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* 4. Assistant IA YAM (ouvre le panneau de chat, ne change pas de page) */}
        {canUseYam && (
          <button
            type="button"
            onClick={() => setYamOpen((o) => !o)}
            aria-expanded={yamOpen}
            aria-controls={YAM_PANEL_ID}
            title="Discuter avec YAM, l'assistant IA"
            style={{
              marginTop: '14px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              width: '100%',
              padding: '11px 12px',
              borderRadius: '14px',
              border: `1px solid ${yamOpen ? '#3C7730' : '#CFE3D2'}`,
              background: yamOpen ? '#E2F2E5' : '#FFFFFF',
              cursor: 'pointer',
              textAlign: 'left',
              fontFamily: 'inherit',
              boxShadow: '0 1px 3px rgba(2, 45, 42, 0.05)',
              transition: 'all 0.15s ease',
            }}
          >
            <YamAvatar size={34} />
            <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25, minWidth: 0 }}>
              <span style={{ fontWeight: 800, fontSize: '0.88rem', color: '#022D2A' }}>Demander à YAM</span>
              <span style={{ fontWeight: 600, fontSize: '0.72rem', color: '#64748B' }}>Assistant IA</span>
            </span>
          </button>
        )}
      </aside>

      {/* ── Zone Contenu Principal ── */}
      <div
        style={{
          flex: 1,
          marginLeft: '302px',
          width: 'calc(100% - 302px)',
          maxWidth: 'calc(100% - 302px)',
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          minHeight: '100vh',
          boxSizing: 'border-box',
        }}
      >
        {/* ── Top Bar Header (Breadcrumb + Search + Quick Actions) ── */}
        <header
          style={{
            height: '70px',
            padding: '0 36px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'transparent',
            width: '100%',
            maxWidth: '100%',
            boxSizing: 'border-box',
          }}
        >
          {/* Fil d'Ariane */}
          {hideBreadcrumb ? (
            <div />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.86rem' }}>
              <span style={{ color: '#94A3B8', fontWeight: 600 }}>IKAN AI</span>
              <span style={{ color: '#CBD5E1' }}>/</span>
              <span style={{ color: '#02302D', fontWeight: 700 }}>{getBreadcrumb()}</span>
            </div>
          )}

          {/* Actions Droite Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>

            {/* Cloche Notifications / Alertes */}
            <button
              onClick={() => {
                if (user?.role === 'cx_manager' || user?.role === 'agency_manager') {
                  navigate('/alertes');
                }
              }}
              title={
                user?.role === 'admin'
                  ? 'Notifications'
                  : alertCount > 0
                    ? `${alertCount} alerte${alertCount > 1 ? 's' : ''} critique${alertCount > 1 ? 's' : ''}`
                    : 'Alertes de satisfaction'
              }
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '50%',
                background: isAlertesActive ? '#EAF5EC' : '#FFFFFF',
                border: `1px solid ${isAlertesActive ? '#3C7730' : '#E2E8F0'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: user?.role === 'admin' ? 'default' : 'pointer',
                color: isAlertesActive ? '#3C7730' : '#64748B',
                boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                position: 'relative',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (user?.role !== 'admin' && !isAlertesActive) {
                  e.currentTarget.style.borderColor = '#3C7730';
                  e.currentTarget.style.color = '#3C7730';
                }
              }}
              onMouseLeave={(e) => {
                if (user?.role !== 'admin' && !isAlertesActive) {
                  e.currentTarget.style.borderColor = '#E2E8F0';
                  e.currentTarget.style.color = '#64748B';
                }
              }}
            >
              <BellIcon size={16} color={isAlertesActive ? '#3C7730' : 'currentColor'} />
              {alertCount > 0 ? (
                <span
                  style={{
                    position: 'absolute',
                    top: '-3px',
                    right: '-3px',
                    minWidth: '17px',
                    height: '17px',
                    borderRadius: '9999px',
                    background: '#DC2626',
                    color: '#FFFFFF',
                    fontSize: '0.62rem',
                    fontWeight: 800,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '0 4px',
                    border: '2px solid #FFFFFF',
                    boxShadow: '0 1px 3px rgba(220, 38, 38, 0.3)',
                    lineHeight: 1,
                  }}
                >
                  {alertCount}
                </span>
              ) : (
                <span
                  style={{
                    position: 'absolute',
                    top: '9px',
                    right: '10px',
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: '#75B72A',
                  }}
                />
              )}
            </button>

            {/* Menu utilisateur : profil, utilisation du forfait, aide, déconnexion */}
            <UserMenu user={user} onLogout={handleLogout} />
          </div>
        </header>

        {/* Contenu de la Page */}
        <main
          style={{
            flex: 1,
            padding: '12px 36px 40px',
            width: '100%',
            maxWidth: '100%',
            minWidth: 0,
            boxSizing: 'border-box',
          }}
        >
          <Outlet />
        </main>
      </div>

      {/* Panneau de chat YAM : fixé par-dessus la page (hors flux), une conversation par utilisateur */}
      {canUseYam && user && (
        <YamErrorBoundary>
          <YamChatPanel key={user.id} open={yamOpen} onClose={() => setYamOpen(false)} />
        </YamErrorBoundary>
      )}
    </div>
  );
}
