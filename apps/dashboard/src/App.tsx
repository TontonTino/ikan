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
import AdminOrgsPage from './pages/admin/AdminOrgsPage';
import AdminAgencesPage from './pages/admin/AdminAgencesPage';
import AdminUsersPage from './pages/admin/AdminUsersPage';
import AdminSettingsPage from './pages/admin/AdminSettingsPage';
import AdminPermissionsPage from './pages/admin/AdminPermissionsPage';
import AdminDashboardPage from './pages/admin/AdminDashboardPage';
import StatistiquesPage from './pages/stats/StatistiquesPage';
import AgentIAPage from './pages/cx/AgentIAPage';
import AbonnementsPage from './pages/cx/AbonnementsPage';

import { useParams } from 'react-router-dom';

function FeedbackRedirect() {
  const { code } = useParams();
  const host = window.location.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.');
  const clientUrl = isLocal ? `http://${host}:4321/feedback/${code || ''}` : `https://ikanai-client.onrender.com/feedback/${code || ''}`;
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
        
        {/* Statistiques & Analyses (Multi-profils : CX, Agence, Admin) */}
        <Route path="statistiques" element={<StatistiquesPage />} />

        {/* CX Manager — Vue siège */}
        <Route path="siege" element={<DashboardSiegePage />} />
        <Route path="agent-ia" element={<AgentIAPage />} />
        <Route path="abonnements" element={<AbonnementsPage />} />

        {/* Agency Manager & CX Manager */}
        <Route path="agence" element={<DashboardAgencePage />} />
        <Route path="feedbacks" element={<FeedbacksPage />} />
        <Route path="suggestions" element={<SuggestionsPage />} />
        <Route path="alertes" element={<AlertesPage />} />

        {/* Admin */}
        <Route path="admin/dashboard" element={<AdminDashboardPage />} />
        <Route path="admin/statistiques" element={<StatistiquesPage />} />
        <Route path="admin/organisations" element={<AdminOrgsPage />} />
        <Route path="admin/agences" element={<AdminAgencesPage />} />
        <Route path="admin/utilisateurs" element={<AdminUsersPage />} />
        <Route path="admin/permissions" element={<AdminPermissionsPage />} />
        <Route path="admin/settings" element={<AdminSettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
