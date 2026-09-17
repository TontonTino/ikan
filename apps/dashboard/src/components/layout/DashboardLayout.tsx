import React, { useEffect, useState } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { alertesApi } from '../../services/api';
import type { UserRole } from '../../types';
import IkanLogo from '../common/IkanLogo';
import SidebarWorkspaceCard from './SidebarWorkspaceCard';
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
  LightbulbIcon,
  TrendingUpIcon,
  LogOutIcon,
  SearchIcon,
  ChevronDownIcon,
  SparklesIcon,
} from '../common/Icons';

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
  badge?: number | string;
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
        { path: '/admin/utilisateurs', label: 'CX Managers', icon: <UsersIcon size={18} /> },
        { path: '/admin/settings', label: 'Paramètres', icon: <SettingsIcon size={18} /> },
      ],
    },
  ],
  cx_manager: [
    {
      title: 'WORKSPACE',
      items: [
        { path: '/siege', label: "Vue d'ensemble", icon: <LayoutGridIcon size={18} /> },
        { path: '/statistiques', label: 'Statistiques & Analyses', icon: <BarChartIcon size={18} /> },
        { path: '/feedbacks', label: 'Feedbacks Réseau', icon: <MessageSquareIcon size={18} /> },
        { path: '/agent-ia', label: 'Agent IA & Copilot', icon: <SparklesIcon size={18} color="#75B72A" /> },
      ],
    },
    {
      title: 'PILOTAGE',
      items: [
        { path: '/alertes', label: 'Alertes & Actions', icon: <BellIcon size={18} /> },
      ],
    },
    {
      title: 'RÉSEAU',
      items: [
        { path: '/admin/agences', label: 'Agences & QR Codes', icon: <StoreIcon size={18} /> },
        { path: '/admin/utilisateurs', label: 'Agency Managers', icon: <UsersIcon size={18} /> },
        { path: '/suggestions', label: 'Boîte à Idées', icon: <LightbulbIcon size={18} /> },
        { path: '/abonnements', label: 'Abonnements', icon: <SparklesIcon size={18} /> },
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
        { path: '/suggestions', label: 'Boîte à Idées', icon: <LightbulbIcon size={18} /> },
      ],
    },
  ],
};

export default function DashboardLayout() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [alertCount, setAlertCount] = useState<number>(0);

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
  const isAlertesActive = location.pathname === '/alertes';

  // Fil d'Ariane dynamique
  const getBreadcrumb = () => {
    if (location.pathname.includes('/agent-ia')) return 'Agent IA & Copilot';
    if (location.pathname.includes('/abonnements')) return 'Forfait & Abonnements';
    if (location.pathname.includes('/statistiques')) return user?.role === 'admin' ? 'Statistiques de la plateforme' : 'Statistiques & Analyses';
    if (location.pathname.includes('/admin/organisations')) return 'Organisations';
    if (location.pathname.includes('/admin/agences')) return user?.role === 'cx_manager' ? 'Agences & QR Codes' : 'Agences';
    if (location.pathname.includes('/admin/utilisateurs')) return user?.role === 'admin' ? 'CX Managers' : 'Agency Managers';
    if (location.pathname.includes('/admin/permissions')) return 'Permissions';
    if (location.pathname.includes('/admin/settings')) return 'Paramètres';
    if (location.pathname.includes('/admin/dashboard')) return 'Dashboard';
    if (location.pathname.includes('/siege')) return 'Vue Siège';
    if (location.pathname.includes('/agence')) return 'Dashboard Agence';
    if (location.pathname.includes('/feedbacks')) return 'Feedbacks';
    if (location.pathname.includes('/suggestions')) return 'Boîte à idées';
    if (location.pathname.includes('/alertes')) return 'Alertes';
    return 'Dashboard';
  };

  const initials = user ? `${user.prenom?.[0] || 'A'}${user.nom?.[0] || 'D'}`.toUpperCase() : 'AD';
  const fullName = user ? `${user.prenom || ''} ${user.nom || ''}`.trim() || 'Amina Diallo' : 'Amina Diallo';

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
                {section.items.map((item) => (
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
                        {item.badge && (
                          <span
                            style={{
                              background: isActive ? '#D3EAD7' : '#EAF2EC',
                              color: isActive ? '#022D2A' : '#64748B',
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              padding: '2px 8px',
                              borderRadius: '9999px',
                            }}
                          >
                            {item.badge}
                          </span>
                        )}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* 4. Encart Statut / Pro en bas de Sidebar */}
        <div
          style={{
            background: 'linear-gradient(135deg, #F5FBF5 0%, #EEF7ED 100%)',
            border: '1px solid #E2EFE1',
            borderRadius: '16px',
            padding: '14px',
            marginBottom: '14px',
            position: 'relative',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <SparklesIcon size={16} color="#75B72A" />
            <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#02302D' }}>
              IKAN AI Pro
            </span>
          </div>
          <p
            style={{
              fontSize: '0.73rem',
              color: '#64748B',
              margin: 0,
              lineHeight: 1.35,
              fontWeight: 500,
            }}
          >
            Analyse sémantique et détection de criticité actives en temps réel.
          </p>
        </div>

        {/* 5. Bas de Sidebar : Info Utilisateur & Bouton Déconnexion */}
        <div
          style={{
            paddingTop: '12px',
            borderTop: '1px solid #DCE8DF',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '4px 6px' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                background: '#EAF5EC',
                color: '#3C7730',
                border: '1.5px solid #D5E8D3',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
                fontSize: '0.82rem',
                flexShrink: 0,
              }}
            >
              {initials}
            </div>
            <div style={{ overflow: 'hidden', flex: 1 }}>
              <div
                style={{
                  fontWeight: 700,
                  color: '#111827',
                  fontSize: '0.84rem',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {fullName}
              </div>
              <div
                style={{
                  color: '#9CA3AF',
                  fontSize: '0.72rem',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {user?.email || 'admin@ikanai.com'}
              </div>
            </div>
          </div>

          <button
            onClick={handleLogout}
            style={{
              width: '100%',
              padding: '8px 12px',
              background: '#FFFFFF',
              border: '1px solid #DCE8DF',
              borderRadius: '10px',
              color: '#DC2626',
              cursor: 'pointer',
              fontSize: '0.78rem',
              fontWeight: 700,
              fontFamily: 'inherit',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#FEE2E2')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#FFFFFF')}
          >
            <LogOutIcon size={14} color="#DC2626" />
            Déconnexion
          </button>
        </div>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.86rem' }}>
            <span style={{ color: '#94A3B8', fontWeight: 600 }}>IKAN AI</span>
            <span style={{ color: '#CBD5E1' }}>/</span>
            <span style={{ color: '#02302D', fontWeight: 700 }}>{getBreadcrumb()}</span>
          </div>

          {/* Actions Droite Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>

            {/* Search Input Pill */}
            <div
              style={{
                background: '#FFFFFF',
                border: '1px solid #E2E8F0',
                borderRadius: '9999px',
                padding: '7px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                width: '280px',
                boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
              }}
            >
              <SearchIcon size={16} color="#94A3B8" />
              <input
                type="text"
                placeholder="Rechercher organisations, agences..."
                style={{
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  fontSize: '0.82rem',
                  color: '#1E293B',
                  width: '100%',
                  fontFamily: 'inherit',
                }}
              />
              <span
                style={{
                  background: '#F1F5F9',
                  color: '#64748B',
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  padding: '2px 6px',
                  borderRadius: '6px',
                  border: '1px solid #E2E8F0',
                  lineHeight: 1,
                }}
              >
                ⌘ K
              </span>
            </div>

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

            {/* Profil Utilisateur (Avatar Initiales + Nom Complet) */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '4px 8px',
                borderRadius: '9999px',
                background: '#FFFFFF',
                border: '1px solid #E2E8F0',
                boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                cursor: 'pointer',
              }}
            >
              <div
                style={{
                  width: '30px',
                  height: '30px',
                  borderRadius: '50%',
                  background: '#EAF5EC',
                  color: '#3C7730',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 800,
                  fontSize: '0.78rem',
                }}
              >
                {initials}
              </div>
              <span
                style={{
                  fontSize: '0.84rem',
                  fontWeight: 700,
                  color: '#1E293B',
                  paddingRight: '6px',
                }}
              >
                {fullName}
              </span>
            </div>
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
    </div>
  );
}
