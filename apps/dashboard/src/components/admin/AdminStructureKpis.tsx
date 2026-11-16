import React from 'react';
import ChiffresCles from './ChiffresCles';
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
    <ChiffresCles
      label="Structure de la plateforme"
      items={[
        { label: 'Organisations', valeur: p.totalOrganisations, note: 'clientes, actives' },
        { label: 'Agences', valeur: p.totalAgences, note: 'enregistrées' },
        { label: ROLE_LABELS_PLURIEL.cx_manager, valeur: p.totalCXManagers, note: 'au siège' },
        { label: ROLE_LABELS_PLURIEL.agency_manager, valeur: p.totalAgencyManagers, note: 'comptes actifs' },
        { label: 'Utilisateurs actifs', valeur: p.totalUtilisateursActifs, note: 'tous rôles' },
      ]}
    />
  );
}
