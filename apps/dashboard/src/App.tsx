import React, { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import RouteLoadingFallback from './components/ui/RouteLoadingFallback';
import RoleRoute from './components/layout/RoleRoute';
import { ROLE_HOME, assertNavCoherence } from './components/layout/navigation';

if (import.meta.env.DEV) assertNavCoherence();

// Pages are loaded only when their route is visited.
const LoginPage = lazy(() => import('./pages/LoginPage'));
const DashboardLayout = lazy(() => import('./components/layout/DashboardLayout'));
const DashboardSiegePage = lazy(() => import('./pages/cx/DashboardSiegePage'));
const DashboardAgencePage = lazy(() => import('./pages/agency/DashboardAgencePage'));
const FeedbacksPage = lazy(() => import('./pages/agency/FeedbacksPage'));
const PilotagePage = lazy(() => import('./pages/cx/PilotagePage'));
const VeillePage = lazy(() => import('./pages/cx/VeillePage'));
const AdminOrgsPage = lazy(() => import('./pages/admin/AdminOrgsPage'));
const GestionAgencesPage = lazy(() => import('./pages/admin/GestionAgencesPage'));
const AdminSettingsPage = lazy(() => import('./pages/admin/AdminSettingsPage'));
const AdminPermissionsPage = lazy(() => import('./pages/admin/AdminPermissionsPage'));
const AdminDashboardPage = lazy(() => import('./pages/admin/AdminDashboardPage'));
const AdminFacturationPage = lazy(() => import('./pages/admin/AdminFacturationPage'));
const StatistiquesPage = lazy(() => import('./pages/stats/StatistiquesPage'));
const ParametresPage = lazy(() => import('./pages/ParametresPage'));
const MonAgencePage = lazy(() => import('./pages/agency/MonAgencePage'));
const DemandesRappelPage = lazy(() => import('./pages/agency/DemandesRappelPage'));
// Vitrine du design system : développement uniquement (non incluse en production).
const DesignSystemPage = import.meta.env.DEV ? lazy(() => import('./pages/dev/DesignSystemPage')) : null;
const SiegePreview = import.meta.env.DEV ? lazy(() => import('./pages/dev/SiegePreview')) : null;

import { useParams, useSearchParams } from 'react-router-dom';
import { getFeedbackUrl } from './config';

function FeedbackRedirect() {
  const { code } = useParams();
  const host = window.location.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.');
  const clientUrl = isLocal ? `http://${host}:4321/feedback/${code || ''}` : getFeedbackUrl(code || '');
  window.location.href = clientUrl;
  return (
    <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'sans-serif' }}>
      Redirection vers le formulaire d’avis...
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function IndexRedirect() {
  const user = useAuthStore((s) => s.user);
  if (user?.role === 'admin') return <Navigate to="/admin/dashboard" replace />;
  if (user?.role === 'agency_manager') return <Navigate to="/agence" replace />;
  return <Navigate to="/siege" replace />;
}

// Ancienne page fusionnée /pilotage (4 onglets) : chaque fonction a désormais sa
// propre destination (Alertes, Actions, Issues, Suggestions). /pilotage reste en
// redirection pour les favoris et liens externes existants.
const PILOTAGE_TAB_TO_ROUTE: Record<string, string> = {
  actions: '/actions',
  issues: '/issues',
  idees: '/suggestions',
};

function PilotageRedirect() {
  const [params] = useSearchParams();
  return <Navigate to={PILOTAGE_TAB_TO_ROUTE[params.get('tab') ?? ''] ?? '/alertes'} replace />;
}

export default function App() {
  const fetchMe = useAuthStore((s) => s.fetchMe);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  return (
    <Suspense fallback={<RouteLoadingFallback />}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {DesignSystemPage && <Route path="/design-system" element={<DesignSystemPage />} />}
      {SiegePreview && <Route path="/design-system/siege" element={<SiegePreview />} />}
      <Route path="/feedback/:code" element={<FeedbackRedirect />} />
      <Route path="/feedback" element={<FeedbackRedirect />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<IndexRedirect />} />

        {/* Paramètres de compte personnel — CX Manager & Agency Manager (l'Admin garde /admin/settings) */}
        <Route path="parametres" element={<RoleRoute pattern="/parametres"><ParametresPage /></RoleRoute>} />

        {/* Statistiques & Analyses (Multi-profils : CX, Agence, Admin) */}
        <Route path="statistiques" element={<RoleRoute pattern="/statistiques"><StatistiquesPage /></RoleRoute>} />

        {/* CX Manager — Vue siège */}
        <Route path="siege" element={<RoleRoute pattern="/siege"><DashboardSiegePage /></RoleRoute>} />

        {/* Agency Manager & CX Manager */}
        <Route path="agence" element={<RoleRoute pattern="/agence"><DashboardAgencePage /></RoleRoute>} />
        {/* Page agence unifiée : Agency Manager sur sa propre agence (mon-agence),
            CX Manager sur une agence précise de son organisation (agences/:agenceId/apercu) —
            même composant, résout l'agence effective en interne (voir MonAgencePage.tsx). */}
        <Route path="mon-agence" element={<RoleRoute pattern="/mon-agence"><MonAgencePage /></RoleRoute>} />
        <Route path="agences/:agenceId/apercu" element={<RoleRoute pattern="/agences/:agenceId/apercu"><MonAgencePage /></RoleRoute>} />
        <Route path="feedbacks" element={<RoleRoute pattern="/feedbacks"><FeedbacksPage /></RoleRoute>} />
        <Route path="suggestions" element={<RoleRoute pattern="/suggestions"><PilotagePage key="suggestions" section="suggestions" /></RoleRoute>} />
        {/* CX Manager & Agency Manager (scoping organisation/agence géré côté API) */}
        <Route path="demandes-rappel" element={<RoleRoute pattern="/demandes-rappel"><DemandesRappelPage /></RoleRoute>} />
        <Route path="alertes" element={<RoleRoute pattern="/alertes"><PilotagePage key="alertes" section="alertes" /></RoleRoute>} />
        <Route path="actions" element={<RoleRoute pattern="/actions"><PilotagePage key="actions" section="actions" /></RoleRoute>} />
        <Route path="issues" element={<RoleRoute pattern="/issues"><PilotagePage key="issues" section="issues" /></RoleRoute>} />

        {/* Ancienne page fusionnée : redirige vers la destination dédiée (?tab=actions → /actions, etc.) */}
        <Route path="pilotage" element={<PilotageRedirect />} />

        {/* Veille réseaux sociaux — CX Manager uniquement (garde de rôle interne à la page) */}
        <Route path="veille" element={<RoleRoute pattern="/veille"><VeillePage /></RoleRoute>} />

        {/* Admin */}
        <Route path="admin/dashboard" element={<RoleRoute pattern="/admin/dashboard"><AdminDashboardPage /></RoleRoute>} />
        <Route path="admin/statistiques" element={<RoleRoute pattern="/admin/statistiques"><StatistiquesPage /></RoleRoute>} />
        <Route path="admin/organisations" element={<RoleRoute pattern="/admin/organisations"><AdminOrgsPage /></RoleRoute>} />
        <Route path="admin/facturation" element={<RoleRoute pattern="/admin/facturation"><AdminFacturationPage /></RoleRoute>} />
        <Route path="admin/gestion-agences" element={<RoleRoute pattern="/admin/gestion-agences"><GestionAgencesPage /></RoleRoute>} />
        {/* Anciennes routes conservées en redirection pour ne pas casser les liens/favoris existants */}
        <Route path="admin/agences" element={<Navigate to="/admin/gestion-agences" replace />} />
        <Route path="admin/utilisateurs" element={<Navigate to="/admin/gestion-agences?tab=utilisateurs" replace />} />
        <Route path="admin/permissions" element={<RoleRoute pattern="/admin/permissions"><AdminPermissionsPage /></RoleRoute>} />
        <Route path="admin/settings" element={<RoleRoute pattern="/admin/settings"><AdminSettingsPage /></RoleRoute>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}
