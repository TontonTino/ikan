import React, { useEffect, useRef, useState } from 'react';
import { Outlet, useNavigate, useLocation, matchPath } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { alertesApi } from '../../services/api';
import type { AlertesResponse, UserRole } from '../../types';
import UserMenu from './UserMenu';
import BackButton from './BackButton';
import Sidebar, { SIDEBAR_ID } from './Sidebar';
import NotificationCenter from './NotificationCenter';
import { ROLE_NAV_SECTIONS, type NavSection } from './navigation';
import YamChatPanel, { YAM_PANEL_ID } from '../agent/YamChatPanel';
import { useYamStore } from '../../stores/yamStore';
import { useMediaQuery, DESKTOP_QUERY } from '../ui/useMediaQuery';
import { XCloseIcon } from '../common/Icons';

// Seuils d'espace utile du contenu (hors sidebar, marges et panneau YAM).
// L'écart de 40 px évite les bascules répétées quand la largeur varie près du seuil.
const COMPACT_ENTER_THRESHOLD = 760;
const COMPACT_EXIT_THRESHOLD = 800;

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
  role === 'agency_manager' ? { to: '/agence', label: 'à la vue d’ensemble' } : { to: '/siege', label: 'à la vue d’ensemble' };

const BACK_ROUTES: BackRoute[] = [
  {
    pattern: '/agences/:agenceId/apercu',
    roles: ['cx_manager', 'agency_manager'],
    fallback: (role) => (role === 'cx_manager' ? { to: '/admin/gestion-agences', label: 'à la gestion des agences' } : dashboardDuRole(role)),
  },
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
  const [alertes, setAlertes] = useState<AlertesResponse | null>(null);
  const [alertesLoading, setAlertesLoading] = useState(false);
  const yamOpen = useYamStore((s) => s.open);
  const toggleYam = useYamStore((s) => s.toggle);
  const closeYam = useYamStore((s) => s.close);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const shellRef = useRef<HTMLDivElement>(null);
  const [compactNavigation, setCompactNavigation] = useState(false);
  // Les seuils portent sur la largeur intérieure réellement visible aux pages :
  // bornes du contenu, paddings CSS et éventuelle superposition de YAM inclus.
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    const updateNavigationMode = () => {
      const shellRect = shell.getBoundingClientRect();
      const shellStyle = window.getComputedStyle(shell);
      const expandedSidebarWidth = Number.parseFloat(shellStyle.getPropertyValue('--sidebar-width'));
      const layoutGutter = Number.parseFloat(shellStyle.getPropertyValue('--layout-gutter'));
      const main = shell.querySelector<HTMLElement>('.dashboard-main-inner');
      if (!main || !Number.isFinite(expandedSidebarWidth) || !Number.isFinite(layoutGutter)) return;

      const mainStyle = window.getComputedStyle(main);
      const contentPaddingLeft = Number.parseFloat(mainStyle.paddingLeft);
      const contentPaddingRight = Number.parseFloat(mainStyle.paddingRight);
      if (!Number.isFinite(contentPaddingLeft) || !Number.isFinite(contentPaddingRight)) return;

      // Coordonnées relatives au shell : la Sidebar est fixed, mais le contenu
      // réserve sa place via margin-left/width dans layout.css.
      const contentStart = expandedSidebarWidth + 2 * layoutGutter + contentPaddingLeft;
      const contentEnd = shellRect.width - contentPaddingRight;

      let visibleContentEnd = contentEnd;
      if (yamOpen) {
        const yamPanel = document.getElementById(YAM_PANEL_ID);
        if (yamPanel) {
          const panelStyle = window.getComputedStyle(yamPanel);
          const panelWidth = yamPanel.getBoundingClientRect().width;
          const panelRightInset = Number.parseFloat(panelStyle.right);
          if (Number.isFinite(panelWidth) && Number.isFinite(panelRightInset)) {
            // YAM est fixed et recouvre le contenu. Son bord gauche borne la
            // zone continue visible ; le padding droit déjà masqué n'est pas
            // déduit une seconde fois.
            const yamLeft = shellRect.width - panelRightInset - panelWidth;
            visibleContentEnd = Math.min(contentEnd, yamLeft);
          }
        }
      }

      const availableContentWidth = Math.max(0, visibleContentEnd - contentStart);
      setCompactNavigation((wasCompact) => {
        const threshold = wasCompact ? COMPACT_EXIT_THRESHOLD : COMPACT_ENTER_THRESHOLD;
        return availableContentWidth < threshold;
      });
    };

    updateNavigationMode();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateNavigationMode) : null;
    observer?.observe(shell);
    const yamPanel = yamOpen ? document.getElementById(YAM_PANEL_ID) : null;
    if (yamPanel) observer?.observe(yamPanel);
    window.addEventListener('resize', updateNavigationMode);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateNavigationMode);
    };
  }, [yamOpen]);
  // Le tiroir est réservé aux téléphones ; tablette et desktop utilisent la sidebar adaptive.
  const collapsed = compactNavigation && isDesktop;
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  // YAM : CX Manager et Agency Manager uniquement (l'Admin n'est jamais proposé, même si l'API le refuse aussi).
  const canUseYam = user?.role === 'cx_manager' || user?.role === 'agency_manager';

  // La sidebar mobile (tiroir) se ferme dès qu'on change de page — couvre le
  // clic sur un lien de nav sans avoir besoin d'un handler par lien.
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  // Sur mobile, le menu est un tiroir modal : focus contenu, tabulation contenue,
  // fermeture Échap et restitution du focus au bouton qui l'a ouvert.
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const sidebar = document.getElementById(SIDEBAR_ID);
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
      if (window.innerWidth >= 768) setMobileMenuOpen(false);
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

  // Alertes : une seule requête alimente la cloche (nouveautés) et le badge du menu « Alertes » (alertes actives).
  // Rafraîchie à chaque changement de page. L'Admin n'a pas d'alertes CX.
  useEffect(() => {
    if (user?.role !== 'cx_manager' && user?.role !== 'agency_manager') return;
    let cancelled = false;
    setAlertesLoading(true);
    alertesApi
      .list()
      .then((r) => { if (!cancelled) setAlertes(r.data ?? null); })
      .catch(() => { if (!cancelled) setAlertes(null); })
      .finally(() => { if (!cancelled) setAlertesLoading(false); });
    return () => { cancelled = true; };
  }, [user?.role, location.pathname]);
  const alertesActives = (alertes?.alertes_seuil?.length ?? 0) + (alertes?.alertes_feedback?.length ?? 0);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  // Badge « Alertes » du menu = nombre d'alertes actives (charge de travail), distinct du
  // compteur de la cloche (nouveautés non vues).
  const navSections: NavSection[] = (user ? ROLE_NAV_SECTIONS[user.role] || [] : []).map((section) => ({
    ...section,
    items: section.items.map((item) =>
      item.path === '/alertes' && alertesActives > 0 ? { ...item, badge: alertesActives, badgeUrgent: true } : item,
    ),
  }));
  const backRoute = user
    ? BACK_ROUTES.find((r) => r.roles.includes(user.role) && matchPath({ path: r.pattern, end: true }, location.pathname))
    : undefined;
  const backFallback = backRoute && user ? backRoute.fallback(user.role) : undefined;

  // Fil d'Ariane dynamique
  const getBreadcrumb = () => {
    if (location.pathname.includes('/statistiques')) return user?.role === 'admin' ? 'Statistiques de la plateforme' : 'Statistiques';
    if (location.pathname.includes('/admin/organisations')) return 'Organisations';
    if (location.pathname.includes('/admin/facturation')) return 'Facturation';
    if (location.pathname.includes('/admin/gestion-agences')) return 'Gestion des agences';
    if (location.pathname.includes('/admin/permissions')) return 'Rôles & permissions';
    if (location.pathname.includes('/admin/settings')) return 'Paramètres';
    if (location.pathname.includes('/parametres')) return 'Paramètres';
    if (location.pathname.includes('/mon-agence')) return 'Mon agence';
    if (location.pathname.includes('/apercu')) return 'Agence';
    if (location.pathname.includes('/admin/dashboard')) return 'Tableau de bord';
    if (location.pathname.includes('/siege')) return 'Vue d\'ensemble';
    if (location.pathname.includes('/agence')) return 'Vue d\'ensemble';
    if (location.pathname.includes('/feedbacks')) return 'Avis clients';
    if (location.pathname.includes('/alertes')) return 'Alertes';
    if (location.pathname.includes('/actions')) return 'Actions à mener';
    if (location.pathname.includes('/issues')) return 'Problèmes à traiter';
    if (location.pathname.includes('/veille')) return 'Veille réseaux sociaux';
    if (location.pathname.includes('/suggestions')) return 'Suggestions';
    if (location.pathname.includes('/demandes-rappel')) return 'Demandes de rappel';
    return 'Tableau de bord';
  };

  // Pages dont la bannière d'en-tête (et donc le fil d'Ariane) a été retirée :
  // Feedbacks, Alertes/Actions/Issues/Suggestions (titre de page dédié), Gestion des agences (tous rôles), Statistiques
  // uniquement pour le CX Manager (les vues Admin/Agence gardent leur bannière),
  // et l'ensemble des pages de l'Agency Manager (fil d'Ariane jugé superflu pour ce rôle).
  const hideBreadcrumb =
    location.pathname.includes('/feedbacks') ||
    ['/alertes', '/actions', '/issues', '/suggestions'].some((p) => location.pathname.startsWith(p)) ||
    location.pathname.includes('/apercu') ||
    location.pathname.includes('/admin/gestion-agences') ||
    (location.pathname.includes('/statistiques') && user?.role === 'cx_manager') ||
    user?.role === 'agency_manager';


  return (

    <div ref={shellRef} className={`app-shell${collapsed ? ' app-shell--collapsed' : ''}`}>
      {/* Voile derrière le tiroir mobile : ferme la sidebar au clic extérieur (mobile/tablette uniquement). */}
      <div
        className={`dashboard-sidebar-overlay${mobileMenuOpen ? ' is-open' : ''}`}
        onClick={() => setMobileMenuOpen(false)}
        aria-hidden="true"
      />

      <Sidebar
        user={user}
        sections={navSections}
        collapsed={collapsed}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
        yam={canUseYam ? { open: yamOpen, onToggle: toggleYam } : undefined}
      />

      {/* ── Zone Contenu Principal ── */}
      <div className="dashboard-content">
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
            {/* Bouton hamburger : réservé au drawer téléphone (< 768 px). */}
            <button
              type="button"
              ref={hamburgerRef}
              className="dashboard-hamburger"
              onClick={() => setMobileMenuOpen((o) => !o)}
              aria-label={mobileMenuOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
              aria-expanded={mobileMenuOpen}
              aria-controls={SIDEBAR_ID}
              style={{
                width: '44px',
                height: '44px',
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

            {/* Cloche = centre de notifications (événements récents, lien vers l'alerte).
                Masquée pour l'Admin : aucun flux d'alertes CX pour ce rôle (plus de bouton désactivé inutile). */}
            {user && (user.role === 'cx_manager' || user.role === 'agency_manager') && (
              <NotificationCenter userId={user.id} data={alertes} loading={alertesLoading} showAgency={user.role === 'cx_manager'} />
            )}

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
          <YamChatPanel key={user.id} open={yamOpen} onClose={closeYam} />
        </YamErrorBoundary>
      )}

    </div>
  );
}
