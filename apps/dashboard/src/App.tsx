import React, { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';

// Pages
import LoginPage from './pages/LoginPage';
import DashboardLayout from './components/layout/DashboardLayout';
import DashboardSiegePage from './pages/cx/DashboardSiegePage';
import DashboardAgencePage from './pages/agency/DashboardAgencePage';
import FeedbacksPage from './pages/agency/FeedbacksPage';
import SuggestionsPage from './pages/agency/SuggestionsPage';
import AlertesPage from './pages/agency/AlertesPage';
import PilotagePage from './pages/cx/PilotagePage';
import AdminOrgsPage from './pages/admin/AdminOrgsPage';
import GestionAgencesPage from './pages/admin/GestionAgencesPage';
import AdminSettingsPage from './pages/admin/AdminSettingsPage';
import AdminPermissionsPage from './pages/admin/AdminPermissionsPage';
import AdminDashboardPage from './pages/admin/AdminDashboardPage';
import AdminFacturationPage from './pages/admin/AdminFacturationPage';
import StatistiquesPage from './pages/stats/StatistiquesPage';
import ParametresPage from './pages/ParametresPage';
import MonAgencePage from './pages/agency/MonAgencePage';

import { useParams } from 'react-router-dom';
import { getFeedbackUrl } from './config';

function FeedbackRedirect() {
  const { code } = useParams();
  const host = window.location.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.');
  const clientUrl = isLocal ? `http://${host}:4321/feedback/${code || ''}` : getFeedbackUrl(code || '');
  window.location.href = clientUrl;
  return (
    <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'sans-serif' }}>
      Redirection vers le formulaire de feedback...
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

// /alertes et /suggestions sont fusionnées dans /pilotage (onglets dédiés) pour le
// CX Manager ET l'Agency Manager (même page, données déjà scopées par rôle côté API).
// Les anciens liens (cloche de notifications, bannière d'alertes, favoris) redirigent.
const ROLES_PILOTAGE = ['cx_manager', 'agency_manager'];

function AlertesRoute() {
  const user = useAuthStore((s) => s.user);
  if (user && ROLES_PILOTAGE.includes(user.role)) return <Navigate to="/pilotage" replace />;
  return <AlertesPage />;
}

function SuggestionsRoute() {
  const user = useAuthStore((s) => s.user);
  if (user && ROLES_PILOTAGE.includes(user.role)) return <Navigate to="/pilotage?tab=idees" replace />;
  return <SuggestionsPage />;
}

export default function App() {
  const fetchMe = useAuthStore((s) => s.fetchMe);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
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
        <Route path="parametres" element={<ParametresPage />} />

        {/* Statistiques & Analyses (Multi-profils : CX, Agence, Admin) */}
        <Route path="statistiques" element={<StatistiquesPage />} />

        {/* CX Manager — Vue siège */}
        <Route path="siege" element={<DashboardSiegePage />} />

        {/* Agency Manager & CX Manager */}
        <Route path="agence" element={<DashboardAgencePage />} />
        {/* Page agence unifiée : Agency Manager sur sa propre agence (mon-agence),
            CX Manager sur une agence précise de son organisation (agences/:agenceId/apercu) —
            même composant, résout l'agence effective en interne (voir MonAgencePage.tsx). */}
        <Route path="mon-agence" element={<MonAgencePage />} />
        <Route path="agences/:agenceId/apercu" element={<MonAgencePage />} />
        <Route path="feedbacks" element={<FeedbacksPage />} />
        <Route path="suggestions" element={<SuggestionsRoute />} />
        <Route path="alertes" element={<AlertesRoute />} />

        {/* Pilotage CX Manager & Agency Manager (Alertes + Actions + Boîte à idées fusionnés) */}
        <Route path="pilotage" element={<PilotagePage />} />

        {/* Admin */}
        <Route path="admin/dashboard" element={<AdminDashboardPage />} />
        <Route path="admin/statistiques" element={<StatistiquesPage />} />
        <Route path="admin/organisations" element={<AdminOrgsPage />} />
        <Route path="admin/facturation" element={<AdminFacturationPage />} />
        <Route path="admin/gestion-agences" element={<GestionAgencesPage />} />
        {/* Anciennes routes conservées en redirection pour ne pas casser les liens/favoris existants */}
        <Route path="admin/agences" element={<Navigate to="/admin/gestion-agences" replace />} />
        <Route path="admin/utilisateurs" element={<Navigate to="/admin/gestion-agences?tab=utilisateurs" replace />} />
        <Route path="admin/permissions" element={<AdminPermissionsPage />} />
        <Route path="admin/settings" element={<AdminSettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
