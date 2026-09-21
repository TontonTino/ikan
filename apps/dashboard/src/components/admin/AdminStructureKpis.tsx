import React from 'react';
import KpiCard from '../ui/KpiCard';
import { BuildingIcon, StoreIcon, UsersIcon } from '../common/Icons';

interface AdminStructureKpisProps {
  totalOrganisations: number;
  totalAgences: number;
  totalCXManagers: number;
  totalAgencyManagers: number;
  totalUtilisateursActifs: number;
}

/** Compteurs structurels de la plateforme (aucune donnée issue des feedbacks). */
export default function AdminStructureKpis(p: AdminStructureKpisProps) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', width: '100%' }}>
      <KpiCard icon={<BuildingIcon size={20} />} label="Organisations" value={p.totalOrganisations} compact subtitle="Comptes entreprises actifs" />
      <KpiCard icon={<StoreIcon size={20} />} label="Agences" value={p.totalAgences} compact subtitle="Points de vente actifs" />
      <KpiCard icon={<UsersIcon size={20} />} label="CX Managers" value={p.totalCXManagers} compact subtitle="Responsables siège" />
      <KpiCard icon={<UsersIcon size={20} />} label="Agency Managers" value={p.totalAgencyManagers} compact subtitle="Responsables d'agence" />
      <KpiCard icon={<UsersIcon size={20} />} label="Utilisateurs actifs" value={p.totalUtilisateursActifs} compact subtitle="Tous rôles confondus" />
    </div>
  );
}
