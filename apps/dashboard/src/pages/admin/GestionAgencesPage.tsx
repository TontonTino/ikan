import React, { useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import TabsNavigation, { TabItem } from '../../components/ui/TabsNavigation';
import { StoreIcon, UsersIcon } from '../../components/common/Icons';
import AdminAgencesContent from './AdminAgencesContent';
import AdminUsersContent from './AdminUsersContent';

type GestionTab = 'agences' | 'utilisateurs';

/**
 * Page fusionnée "Gestion des agences" : remplace les deux anciennes entrées de
 * menu séparées (Agences & QR Codes / Agency Managers-CX Managers) par une seule
 * page à onglets. Le CX Manager voit les deux onglets, l'Admin ne gère pas les
 * agences directement et ne voit donc que l'onglet Utilisateurs (CX Managers).
 */
export default function GestionAgencesPage() {
  const currentUser = useAuthStore((s) => s.user);
  const isAdmin = currentUser?.role === 'admin';
  const isCXManager = currentUser?.role === 'cx_manager';

  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab') === 'utilisateurs' ? 'utilisateurs' : 'agences';
  const [activeTab, setActiveTab] = useState<GestionTab>(isCXManager ? requestedTab : 'utilisateurs');

  const tabsConfig: TabItem[] = isCXManager
    ? [
        { id: 'agences', label: 'Agences & QR Codes', icon: <StoreIcon size={16} /> },
        { id: 'utilisateurs', label: 'Agency Managers', icon: <UsersIcon size={16} /> },
      ]
    : [
        { id: 'utilisateurs', label: 'CX Managers', icon: <UsersIcon size={16} /> },
      ];

  const handleTabChange = (id: string) => {
    const tab = id as GestionTab;
    setActiveTab(tab);
    setSearchParams(tab === 'agences' ? {} : { tab }, { replace: true });
  };

  // Redirection APRÈS tous les hooks (Rules of Hooks) ; ce composant ne fait aucun appel API lui-même
  // (les onglets enfants ne sont montés qu'en l'absence de redirection).
  if (currentUser?.role === 'agency_manager') {
    return <Navigate to="/agence" replace />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
      {tabsConfig.length > 1 && (
        <TabsNavigation tabs={tabsConfig} activeTab={activeTab} onChange={handleTabChange} />
      )}

      {activeTab === 'agences' && isCXManager && <AdminAgencesContent />}
      {activeTab === 'utilisateurs' && <AdminUsersContent />}
    </div>
  );
}
