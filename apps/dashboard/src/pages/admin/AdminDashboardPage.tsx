/**
 * Vue Admin — compteurs structurels uniquement (aucune donnée de satisfaction client : hors périmètre du rôle).
 * <h1> porté par AdminWelcomeBanner ; <h2> « Structure de la plateforme » ici, <h2> « Organisations » dans le tableau.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { dashboardApi } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import AdminWelcomeBanner from '../../components/admin/AdminWelcomeBanner';
import AdminStructureKpis from '../../components/admin/AdminStructureKpis';
import RepartitionForfaitsCard from '../../components/admin/RepartitionForfaitsCard';
import AdminOrganisationsTable from '../../components/admin/AdminOrganisationsTable';
import EmptyState from '../../components/ui/EmptyState';
import SkeletonBlock from '../../components/ui/SkeletonBlock';
import SectionHeading from '../../components/ui/SectionHeading';
import type { DashboardAdminStats } from '../../types';

export default function AdminDashboardPage() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';

  // Tous les hooks sont appelés avant toute condition de retour (Rules of Hooks).
  const [stats, setStats] = useState<DashboardAdminStats | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(() => {
    // Un non-admin est redirigé plus bas : on ne lance alors aucun appel (comportement inchangé).
    if (!isAdmin) return;
    setLoading(true);
    dashboardApi
      .admin()
      .then((res) => {
        if (res.data) {
          setStats(res.data);
        }
      })
      .catch((err) => {
        console.error('Erreur chargement dashboard admin:', err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [isAdmin]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (!isAdmin) {
    return <Navigate to="/siege" replace />;
  }

  const prenom = user?.prenom || 'Système';
  // Échec du chargement : visible pour l'utilisateur (l'erreur n'est plus seulement dans la console).
  const loadFailed = !loading && !stats;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
      {/* ── 1. Bannière ── */}
      <AdminWelcomeBanner
        userName={prenom}
        subtitle="Voici un aperçu structurel de vos organisations, agences et comptes sur la plateforme IKAN AI."
      />

      {loadFailed ? (
        <EmptyState
          illustration="no-data"
          title="Impossible de charger les données de la plateforme"
          message="Vérifiez votre connexion puis réessayez."
          action={{ label: 'Réessayer', onClick: loadData }}
        />
      ) : (
        <>
          {/* ── 2. Compteurs structurels + répartition par forfait ── */}
          <section aria-labelledby="admin-structure" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div id="admin-structure"><SectionHeading>Structure de la plateforme</SectionHeading></div>
            {stats ? (
              <>
                <AdminStructureKpis
                  totalOrganisations={stats.total_organisations}
                  totalAgences={stats.total_agences}
                  totalCXManagers={stats.total_cx_managers}
                  totalAgencyManagers={stats.total_agency_managers}
                  totalUtilisateursActifs={stats.total_utilisateurs_actifs}
                />
                <RepartitionForfaitsCard repartition={stats.repartition_forfaits ?? []} />
              </>
            ) : (
              <div aria-busy="true" aria-label="Chargement des compteurs de la plateforme" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                  {[0, 1, 2, 3, 4].map((i) => (
                    <SkeletonBlock key={i} height={84} radius="var(--radius-lg)" />
                  ))}
                </div>
                <SkeletonBlock height={120} radius="var(--radius-xl)" />
              </div>
            )}
          </section>

          {/* ── 3. Tableau Organisations en PLEINE LARGEUR (100%) — son <h2> « Organisations » est dans le composant ── */}
          <div style={{ width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
            <AdminOrganisationsTable organisations={stats?.organisations_overview ?? []} loading={loading} />
          </div>
        </>
      )}
    </div>
  );
}
