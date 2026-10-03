import React, { useEffect, useRef, useState } from 'react';
import { Outlet, NavLink, useNavigate, useLocation, matchPath } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { alertesApi } from '../../services/api';
import type { UserRole } from '../../types';
import IkanLogo from '../common/IkanLogo';
import SidebarWorkspaceCard from './SidebarWorkspaceCard';
import UserMenu from './UserMenu';
import BackButton from './BackButton';
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
  ChevronRightIcon,
  LandmarkIcon,
  XCloseIcon,
  MegaphoneIcon,
  LightbulbIcon,
  PhoneIcon,
  TargetIcon,
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
        { path: '/admin/permissions', label: 'Rôles & permissions', icon: <ShieldCheckIcon size={18} /> },
        { path: '/admin/settings', label: 'Paramètres', icon: <SettingsIcon size={18} /> },
      ],
    },
  ],
  cx_manager: [
    {
      title: 'RÉSEAU',
      items: [
        { path: '/siege', label: 'Vue d\'ensemble', icon: <LayoutGridIcon size={18} /> },
        { path: '/statistiques', label: 'Performance CX', icon: <BarChartIcon size={18} /> },
        { path: '/feedbacks', label: 'Feedbacks', icon: <MessageSquareIcon size={18} /> },
        { path: '/veille', label: 'Veille', icon: <MegaphoneIcon size={18} /> },
        { path: '/pilotage', label: 'Pilotage réseau', icon: <TargetIcon size={18} /> },
        { path: '/admin/gestion-agences', label: 'Gestion des agences', icon: <StoreIcon size={18} /> },
      ],
    },
    {
      title: 'CLIENTS',
      items: [
        { path: '/suggestions', label: 'Suggestions', icon: <LightbulbIcon size={18} /> },
        { path: '/demandes-rappel', label: 'Demandes de rappel', icon: <PhoneIcon size={18} /> },
      ],
    },
  ],
  agency_manager: [
    {
      title: 'MON AGENCE',
      items: [
        { path: '/agence', label: 'Vue d\'ensemble', icon: <LayoutGridIcon size={18} /> },
        { path: '/statistiques', label: 'Performance CX', icon: <BarChartIcon size={18} /> },
        { path: '/feedbacks', label: 'Feedbacks', icon: <MessageSquareIcon size={18} /> },
        { path: '/pilotage?tab=actions', label: 'Actions & alertes', icon: <TargetIcon size={18} /> },
      ],
    },
    {
      title: 'CLIENTS',
      items: [
        { path: '/suggestions', label: 'Suggestions', icon: <LightbulbIcon size={18} /> },
        { path: '/demandes-rappel', label: 'Demandes de rappel', icon: <PhoneIcon size={18} /> },
      ],
    },
  ],
};

// ── Table centrale du bouton « Retour » ───────────────────────────────────────
// Pages profondes (non présentes dans le menu) qui affichent un BackButton en haut du contenu. Pour en ajouter
// une : une ligne ici. `fallback` = route de repli (arrivée directe par URL, sans historique interne) et son
// complément de libellé (« Retour au Répertoire »), selon le rôle. Les pages du menu n'ont pas de bouton retour.
interface BackFallback {
  to: string;
  label: string;
}
interface BackRoute {
  pattern: string;
  roles: UserRole[];
  fallback: (role: UserRole) => BackFallback;
}

const dashboardDuRole = (role: UserRole): BackFallback =>
  role === 'agency_manager' ? { to: '/agence', label: 'au Dashboard Agence' } : { to: '/siege', label: 'au Dashboard' };

const BACK_ROUTES: BackRoute[] = [
  {
    pattern: '/agences/:agenceId/apercu',
    roles: ['cx_manager', 'agency_manager'],
    fallback: (role) => (role === 'cx_manager' ? { to: '/admin/gestion-agences', label: 'au Répertoire' } : dashboardDuRole(role)),
  },
  { pattern: '/pilotage', roles: ['cx_manager', 'agency_manager'], fallback: dashboardDuRole },
  { pattern: '/parametres', roles: ['cx_manager', 'agency_manager'], fallback: dashboardDuRole },
];

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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(() => {
    try {
      return typeof window !== 'undefined' && window.localStorage.getItem('ikan-sidebar-collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  // YAM : CX Manager et Agency Manager uniquement (l'Admin n'est jamais proposé, même si l'API le refuse aussi).
  const canUseYam = user?.role === 'cx_manager' || user?.role === 'agency_manager';

  useEffect(() => {
    try {
      window.localStorage.setItem('ikan-sidebar-collapsed', String(desktopSidebarCollapsed));
    } catch {
      // La préférence reste utilisable en mémoire si le stockage est bloqué.
    }
  }, [desktopSidebarCollapsed]);

  // La sidebar mobile (tiroir) se ferme dès qu'on change de page — couvre le
  // clic sur un lien de nav sans avoir besoin d'un handler par lien.
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  // Sur mobile, le menu est un tiroir modal : focus contenu, tabulation contenue,
  // fermeture Échap et restitution du focus au bouton qui l'a ouvert.
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const sidebar = document.getElementById('dashboard-sidebar');
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const getFocusable = () =>
      Array.from(
        sidebar?.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      ).filter((element) => element.getAttribute('aria-hidden') !== 'true');

    (sidebar?.querySelector<HTMLElement>('.dashboard-mobile-close') ?? getFocusable()[0])?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMobileMenuOpen(false);
        hamburgerRef.current?.focus();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = getFocusable();
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        event.preventDefault();
        sidebar?.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const onResize = () => {
      if (window.innerWidth > 1024) setMobileMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      document.body.style.overflow = previousOverflow;
      hamburgerRef.current?.focus();
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (user?.role === 'cx_manager' || user?.role === 'agency_manager') {
      alertesApi
        .list()
        .then((r) => {
          const seuil = r.data?.alertes_seuil?.length || 0;
          const feedback = r.data?.alertes_feedback?.length || 0;
          setAlertCount(seuil + feedback);
        })
        .catch(() => setAlertCount(0));
    }
  }, [user?.role, location.pathname]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const navSections = user ? ROLE_NAV_SECTIONS[user.role] || [] : [];
  // La cloche du header navigue toujours vers /pilotage (onglet Alertes, sans paramètre) :
  // elle ne doit s'allumer que sur cet onglet précis, pas sur Actions/Boîte à idées/Issues
  // (même pathname /pilotage, distingués uniquement par le paramètre ?tab=).
  const pilotageTab = new URLSearchParams(location.search).get('tab');
  const isAlertesActive = location.pathname === '/pilotage' && pilotageTab !== 'actions';
  const backRoute = user
    ? BACK_ROUTES.find((r) => r.roles.includes(user.role) && matchPath({ path: r.pattern, end: true }, location.pathname))
    : undefined;
  const backFallback = backRoute && user ? backRoute.fallback(user.role) : undefined;

  // Fil d'Ariane dynamique
  const getBreadcrumb = () => {
    if (location.pathname.includes('/statistiques')) return user?.role === 'admin' ? 'Statistiques de la plateforme' : 'Performance CX';
    if (location.pathname.includes('/admin/organisations')) return 'Organisations';
    if (location.pathname.includes('/admin/facturation')) return 'Facturation';
    if (location.pathname.includes('/admin/gestion-agences')) return 'Gestion des agences';
    if (location.pathname.includes('/admin/permissions')) return 'Permissions';
    if (location.pathname.includes('/admin/settings')) return 'Paramètres';
    if (location.pathname.includes('/parametres')) return 'Paramètres';
    if (location.pathname.includes('/mon-agence')) return 'Mon agence';
    if (location.pathname.includes('/apercu')) return 'Agence';
    if (location.pathname.includes('/admin/dashboard')) return 'Dashboard';
    if (location.pathname.includes('/siege')) return 'Vue d\'ensemble';
    if (location.pathname.includes('/agence')) return 'Vue d\'ensemble';
    if (location.pathname.includes('/feedbacks')) return 'Feedbacks';
    if (location.pathname.includes('/pilotage')) return 'Pilotage';
    if (location.pathname.includes('/veille')) return 'Veille';
    if (location.pathname.includes('/suggestions')) return 'Boîte à idées';
    if (location.pathname.includes('/demandes-rappel')) return 'Demandes de rappel';
    return 'Dashboard';
  };

  // Pages dont la bannière d'en-tête (et donc le fil d'Ariane) a été retirée :
  // Feedbacks, Pilotage et Gestion des agences (tous rôles), Statistiques
  // uniquement pour le CX Manager (les vues Admin/Agence gardent leur bannière),
  // et l'ensemble des pages de l'Agency Manager (fil d'Ariane jugé superflu pour ce rôle).
  const hideBreadcrumb =
    location.pathname.includes('/feedbacks') ||
    location.pathname.includes('/pilotage') ||
    location.pathname.includes('/apercu') ||
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
      {/* Voile derrière le tiroir mobile : ferme la sidebar au clic extérieur (mobile/tablette uniquement). */}
      <div
        className={`dashboard-sidebar-overlay${mobileMenuOpen ? ' is-open' : ''}`}
        onClick={() => setMobileMenuOpen(false)}
        aria-hidden="true"
      />

      {/* ── Sidebar Latérale (Style SaaS Épuré Bolt.new) ── */}
      <aside
        id="dashboard-sidebar"
        role={mobileMenuOpen ? 'dialog' : undefined}
        aria-modal={mobileMenuOpen ? true : undefined}
        aria-label={mobileMenuOpen ? 'Menu principal' : undefined}
        tabIndex={mobileMenuOpen ? -1 : undefined}
        className={`dashboard-sidebar${mobileMenuOpen ? ' dashboard-sidebar--open' : ''}${desktopSidebarCollapsed ? ' dashboard-sidebar--collapsed' : ''} ikan-sidebar--dark on-dark`}
        style={{
          width: '270px',
          display: 'flex',
          flexDirection: 'column',
          position: 'fixed',
          top: '16px',
          left: '16px',
          height: 'calc(100vh - 32px)',
          zIndex: 30,
          borderRadius: '20px',
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
          <div className="dashboard-sidebar-brand-logo">
            <IkanLogo variant="light" size={28} showText={!desktopSidebarCollapsed} />
          </div>
          <div
            className="dashboard-role-label"
            style={{
              background: 'rgba(188, 207, 0, 0.14)',
              color: 'var(--color-lime)',
              fontSize: '0.68rem',
              fontWeight: 800,
              letterSpacing: '0.05em',
              padding: '3px 8px',
              borderRadius: '9999px',
              border: '1px solid rgba(188, 207, 0, 0.35)',
            }}
          >
            {roleLabel}
          </div>
          {mobileMenuOpen && (
            <button
              type="button"
              className="dashboard-mobile-close"
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Fermer le menu"
              style={{
                display: 'none',
                width: 36,
                height: 36,
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid rgba(255,255,255,0.18)',
                borderRadius: 10,
                background: 'rgba(255,255,255,0.08)',
                color: '#FFFFFF',
                cursor: 'pointer',
              }}
            >
              <XCloseIcon size={18} color="#FFFFFF" />
            </button>
          )}
        </div>

        {/* 2. Card Sélecteur d'Espace / Organisation Dynamique */}
        <SidebarWorkspaceCard user={user} collapsed={desktopSidebarCollapsed} />


        {/* 3. Navigation Links */}
        <nav
          aria-label="Navigation principale"
          className="dashboard-primary-nav"
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
                <div className="ikan-nav-section-title">
                  {section.title}
                </div>
              )}
              <ul style={{ display: 'flex', flexDirection: 'column', gap: '4px', listStyle: 'none', margin: 0, padding: 0 }}>
                {section.items.map((item) => {
                  return (
                    <li key={item.path}>
                      <NavLink
                        to={item.path}
                        aria-label={item.label}
                        title={desktopSidebarCollapsed ? item.label : undefined}
                        className={({ isActive }) => `ikan-nav-link${isActive ? ' ikan-nav-link--active' : ''}`}
                      >
                        {() => (
                          <>
                            <div className="ikan-nav-link-content" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                              <span className="ikan-nav-icon">
                                {item.icon}
                              </span>
                              <span className="ikan-nav-link-label">{item.label}</span>
                            </div>
                            {!!item.badge && (
                              <span className={`ikan-nav-badge${item.badgeUrgent ? ' ikan-nav-badge--urgent' : ''}`}>
                                {item.badge}
                              </span>
                            )}
                          </>
                        )}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* 4. Assistant IA YAM (ouvre le panneau de chat, ne change pas de page) */}
        {canUseYam && (
          <button
            type="button"
            onClick={() => setYamOpen((o) => !o)}
            aria-expanded={yamOpen}
            aria-controls={YAM_PANEL_ID}
            title={desktopSidebarCollapsed ? 'Demander à YAM' : 'Discuter avec YAM, l’assistant IA'}
            className="ikan-yam-button"
          >
            <YamAvatar size={34} />
            <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25, minWidth: 0 }}>
              <span className="ikan-yam-button-label" style={{ fontWeight: 800, fontSize: '0.88rem', color: 'var(--sidebar-text-strong)' }}>Demander à YAM</span>
              <span className="ikan-yam-subtitle" style={{ fontWeight: 600, fontSize: '0.72rem' }}>Assistant IA</span>
            </span>
            <span className="ikan-yam-chevron" aria-hidden="true">
              <ChevronRightIcon size={14} />
            </span>
          </button>
        )}
        <button
          type="button"
          className="dashboard-sidebar-toggle"
          onClick={() => setDesktopSidebarCollapsed((collapsed) => !collapsed)}
          aria-label={desktopSidebarCollapsed ? 'Agrandir la barre latérale' : 'Réduire la barre latérale'}
          aria-expanded={!desktopSidebarCollapsed}
          title={desktopSidebarCollapsed ? 'Agrandir' : 'Réduire'}
        >
          <ChevronRightIcon size={17} />
          <span>{desktopSidebarCollapsed ? 'Agrandir' : 'Réduire'}</span>
        </button>
      </aside>

      {/* ── Zone Contenu Principal ── */}
      <div
        className="dashboard-content"
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
          className="dashboard-header-inner"
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
            {/* Bouton hamburger : caché sur desktop, visible ≤768px (voir <style> plus bas). */}
            <button
              type="button"
              ref={hamburgerRef}
              className="dashboard-hamburger"
              onClick={() => setMobileMenuOpen((o) => !o)}
              aria-label={mobileMenuOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
              aria-expanded={mobileMenuOpen}
              aria-controls="dashboard-sidebar"
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '10px',
                background: '#FFFFFF',
                border: '1px solid #E2E8F0',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                flexShrink: 0,
                padding: 0,
              }}
            >
              {mobileMenuOpen ? (
                <XCloseIcon size={18} color="#02302D" />
              ) : (
                <span style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '16px' }}>
                  <span style={{ height: '2px', borderRadius: '1px', background: '#02302D' }} />
                  <span style={{ height: '2px', borderRadius: '1px', background: '#02302D' }} />
                  <span style={{ height: '2px', borderRadius: '1px', background: '#02302D' }} />
                </span>
              )}
            </button>

            {/* Fil d'Ariane */}
            {hideBreadcrumb ? (
              <div />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.86rem', minWidth: 0, overflow: 'hidden' }}>
                <span style={{ color: '#94A3B8', fontWeight: 600, whiteSpace: 'nowrap' }}>IKAN AI</span>
                <span style={{ color: '#CBD5E1' }}>/</span>
                <span style={{ color: '#02302D', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{getBreadcrumb()}</span>
              </div>
            )}
          </div>

          {/* Actions Droite Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>

            {/* Cloche Notifications / Alertes */}
            <button
              onClick={() => {
                if (user?.role === 'cx_manager' || user?.role === 'agency_manager') {
                  navigate('/pilotage');
                }
              }}
              disabled={user?.role === 'admin'}
              aria-label={
                user?.role === 'admin'
                  ? 'Notifications non disponibles pour le rôle administrateur'
                  : alertCount > 0
                    ? `${alertCount} alerte${alertCount > 1 ? 's' : ''} critique${alertCount > 1 ? 's' : ''}`
                    : 'Alertes de satisfaction, aucune alerte critique'
              }
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
                  aria-hidden="true"
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
                  aria-hidden="true"
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
          className="dashboard-main-inner"
          style={{
            flex: 1,
            padding: '12px 36px 40px',
            width: '100%',
            maxWidth: '100%',
            minWidth: 0,
            boxSizing: 'border-box',
          }}
        >
          {backFallback && (
            <div style={{ marginBottom: '12px' }}>
              <BackButton fallbackTo={backFallback.to} fallbackLabel={backFallback.label} />
            </div>
          )}
          <Outlet />
        </main>
      </div>

      {/* Panneau de chat YAM : fixé par-dessus la page (hors flux), une conversation par utilisateur */}
      {canUseYam && user && (
        <YamErrorBoundary>
          <YamChatPanel key={user.id} open={yamOpen} onClose={() => setYamOpen(false)} />
        </YamErrorBoundary>
      )}

      {/* ── Sidebar en tiroir sur mobile/tablette ──
          La sidebar reste en CSS pur (position fixed) sur desktop. En dessous de 1024px,
          elle devient un tiroir plein écran caché par défaut (translateX hors champ),
          ouvert par le bouton hamburger, fermé par le voile, Échap ou un lien de nav.
          (Entre 768 et 1024px la sidebar fixe de 270px écrasait sinon le contenu.)
          Les !important ne visent que des propriétés déjà fixées en style inline plus
          haut (seul moyen de les surcharger depuis une media query), pattern déjà utilisé
          ailleurs dans le dashboard (AdminDashboardPage, MonAgencePage, ParametresPage). */}
      <style>{`
        .dashboard-hamburger { display: none; }
        .dashboard-mobile-close { display: none; }
        .dashboard-sidebar-overlay { display: none; }

        .dashboard-sidebar-toggle {
          display: inline-flex;
          align-items: center;
          justify-content: flex-start;
          gap: 10px;
          width: 100%;
          min-height: 42px;
          margin-top: 10px;
          padding: 8px 12px;
          border: 1px solid rgba(255,255,255,0.14);
          border-radius: 12px;
          background: rgba(255,255,255,0.055);
          color: var(--sidebar-text);
          font: inherit;
          font-size: 0.82rem;
          font-weight: 700;
          cursor: pointer;
        }
        .dashboard-sidebar-toggle:hover { background: rgba(255,255,255,0.11); color: #FFFFFF; }
        .dashboard-sidebar-toggle:focus-visible { outline: 3px solid #BCCF00; outline-offset: 2px; }
        .dashboard-sidebar-toggle svg { transform: rotate(180deg); }

        @media (max-width: 1024px) {
          .dashboard-hamburger { display: flex !important; }

          .dashboard-sidebar {
            left: 0 !important;
            top: 0 !important;
            height: 100vh !important;
            height: 100dvh !important;
            width: min(280px, 82vw) !important;
            border-radius: 0 !important;
            transform: translateX(-100%);
            transition: transform 0.25s ease;
          }
          .dashboard-sidebar--open { transform: translateX(0); }
          .dashboard-mobile-close { display: flex !important; }
          .dashboard-sidebar-toggle { display: none; }

          .dashboard-sidebar-overlay.is-open {
            display: block;
            position: fixed;
            inset: 0;
            background: rgba(2, 48, 45, 0.4);
            z-index: 25;
          }

          .dashboard-content {
            margin-left: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
          }
        }

        @media (max-width: 640px) {
          .dashboard-header-inner { padding: 0 16px !important; }
          .dashboard-main-inner { padding: 12px 16px 28px !important; }
        }

        @media (min-width: 1025px) {
          .dashboard-sidebar--collapsed {
            width: 76px !important;
            padding: 20px 10px !important;
            overflow: visible !important;
          }
          .dashboard-sidebar--collapsed + .dashboard-content {
            margin-left: 108px !important;
            width: calc(100% - 108px) !important;
            max-width: calc(100% - 108px) !important;
          }
          .dashboard-sidebar--collapsed .dashboard-sidebar-brand-logo { display: flex; justify-content: center; width: 100%; }
          .dashboard-sidebar--collapsed .dashboard-sidebar-brand-logo > * { margin-inline: auto; }
          .dashboard-sidebar--collapsed .dashboard-role-label,
          .dashboard-sidebar--collapsed .ikan-nav-section-title,
          .dashboard-sidebar--collapsed .ikan-nav-link-label,
          .dashboard-sidebar--collapsed .ikan-nav-badge,
          .dashboard-sidebar--collapsed .ikan-yam-button-label,
          .dashboard-sidebar--collapsed .ikan-yam-subtitle,
          .dashboard-sidebar--collapsed .ikan-yam-chevron { display: none !important; }
          .dashboard-sidebar--collapsed .dashboard-primary-nav { gap: 10px !important; overflow: visible !important; }
          .dashboard-sidebar--collapsed .ikan-nav-link { justify-content: center; padding: 12px 8px; }
          .dashboard-sidebar--collapsed .ikan-nav-link-content { justify-content: center; }
          .dashboard-sidebar--collapsed .agency-context-wrap { margin-bottom: 14px; }
          .dashboard-sidebar--collapsed .agency-context-button,
          .dashboard-sidebar--collapsed .cx-context-card { min-height: 52px; padding: 4px; }
          .dashboard-sidebar--collapsed .agency-context-chevron { display: none; }
          .dashboard-sidebar--collapsed .agency-context-logo { width: 42px; height: 42px; }
          .dashboard-sidebar--collapsed .agency-context-tooltip { width: 220px; left: calc(100% + 8px); top: 0; }
          .dashboard-sidebar--collapsed .sidebar-admin-context { justify-content: center; padding: 6px; background: transparent; border-color: transparent; box-shadow: none; }
          .dashboard-sidebar--collapsed .sidebar-admin-context > div:not(:first-child) { display: none !important; }
          .dashboard-sidebar--collapsed .sidebar-admin-context > div:first-child { width: 44px; height: 44px; }
          .dashboard-sidebar--collapsed .ikan-yam-button { justify-content: center; padding: 8px; }
          .dashboard-sidebar--collapsed .dashboard-sidebar-toggle { justify-content: center; padding: 8px; }
          .dashboard-sidebar--collapsed .dashboard-sidebar-toggle span { display: none; }
          .dashboard-sidebar--collapsed .dashboard-sidebar-toggle svg { transform: none; }
        }

        @media (prefers-reduced-motion: reduce) {
          .dashboard-sidebar { transition: none !important; }
          .dashboard-sidebar-toggle { transition: none !important; }
        }
      `}</style>
    </div>
  );
}
