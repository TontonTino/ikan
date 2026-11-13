import React from 'react';
import KpiCard from '../ui/KpiCard';
import { BuildingIcon, StoreIcon, UsersIcon } from '../common/Icons';
import { ROLE_LABELS_PLURIEL } from '../../utils/vocabulaire';

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
      <KpiCard icon={<BuildingIcon size={20} />} label="Organisations" value={p.totalOrganisations} compact subtitle="Organisations clientes actives" />
      <KpiCard icon={<StoreIcon size={20} />} label="Agences" value={p.totalAgences} compact subtitle="Agences enregistrées" />
      <KpiCard icon={<UsersIcon size={20} />} label={ROLE_LABELS_PLURIEL.cx_manager} value={p.totalCXManagers} compact subtitle="Au siège" />
      <KpiCard icon={<UsersIcon size={20} />} label="Responsables d’agence" value={p.totalAgencyManagers} compact subtitle="Comptes actifs" />
      <KpiCard icon={<UsersIcon size={20} />} label="Utilisateurs actifs" value={p.totalUtilisateursActifs} compact subtitle="Tous rôles confondus" />
    </div>
  );
}
