import React from 'react';
import type { UserRole } from '../../types';
import {
  ActivityIcon,
  BarChartIcon,
  BellIcon,
  BuildingIcon,
  LandmarkIcon,
  LayoutGridIcon,
  LightbulbIcon,
  MegaphoneIcon,
  MessageSquareIcon,
  PhoneIcon,
  SettingsIcon,
  ShieldCheckIcon,
  StoreIcon,
  TargetIcon,
  UsersIcon,
} from '../common/Icons';

/*
 * Source unique de la navigation par rôle.
 *  - ROLE_NAV_SECTIONS : ce que la sidebar affiche, par rôle.
 *  - ROUTE_ROLES       : qui peut ouvrir chaque route (garde <RoleRoute> dans App.tsx).
 * Règle : un lien n'est visible que si la route l'autorise pour ce rôle
 * (vérifié au chargement en dev, voir assertNavCoherence).
 * Les permissions restent purement par rôle : l'API n'expose pas de droits
 * individuels (GET /system/permissions = description des 3 rôles).
 */

export interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
  badgeUrgent?: boolean;
}

export interface NavSection {
  title?: string;
  items: NavItem[];
}

const ALL: UserRole[] = ['admin', 'cx_manager', 'agency_manager'];
const MANAGERS: UserRole[] = ['cx_manager', 'agency_manager'];

/** Rôles autorisés par motif de route (motifs react-router, sans query string). */
export const ROUTE_ROLES: Record<string, UserRole[]> = {
  '/parametres': MANAGERS,
  '/statistiques': ALL,
  '/siege': ['cx_manager'],
  '/agence': MANAGERS,
  '/mon-agence': MANAGERS,
  '/agences/:agenceId/apercu': MANAGERS,
  '/feedbacks': MANAGERS,
  // Fonctionnalité métier managers : Agency = ses suggestions, CX = vision réseau.
  '/suggestions': MANAGERS,
  '/demandes-rappel': MANAGERS,
  '/alertes': MANAGERS,
  '/actions': MANAGERS,
  '/issues': MANAGERS,
  '/veille': ['cx_manager'],
  '/admin/dashboard': ['admin'],
  '/admin/statistiques': ['admin'],
  '/admin/organisations': ['admin'],
  '/admin/facturation': ['admin'],
  '/admin/gestion-agences': ['admin', 'cx_manager'],
  '/admin/permissions': ['admin'],
  '/admin/settings': ['admin'],
};

/** Page d'accueil de chaque rôle (redirection index et refus d'accès). */
export const ROLE_HOME: Record<UserRole, string> = {
  admin: '/admin/dashboard',
  cx_manager: '/siege',
  agency_manager: '/agence',
};

export const ROLE_NAV_SECTIONS: Record<UserRole, NavSection[]> = {
  admin: [
    {
      title: 'WORKSPACE',
      items: [
        { path: '/admin/dashboard', label: 'Dashboard', icon: <LayoutGridIcon size={18} /> },
        { path: '/admin/statistiques', label: 'Statistiques Plateforme', icon: <BarChartIcon size={18} /> },
        { path: '/admin/organisations', label: 'Organisations', icon: <BuildingIcon size={18} /> },
        { path: '/admin/facturation', label: 'Facturation', icon: <LandmarkIcon size={18} /> },
        { path: '/admin/gestion-agences', label: 'Gestion des agences', icon: <UsersIcon size={18} /> },
        { path: '/admin/permissions', label: 'Rôles & permissions', icon: <ShieldCheckIcon size={18} /> },
        { path: '/admin/settings', label: 'Paramètres', icon: <SettingsIcon size={18} /> },
      ],
    },
  ],
  // Sections calquées sur la boucle produit : Comprendre → Agir → Clients → Réseau.
  // Une entrée = une fonction ; aucune entrée ne mène à la même page qu'une autre.
  cx_manager: [
    {
      title: 'COMPRENDRE',
      items: [
        { path: '/siege', label: "Vue d'ensemble", icon: <LayoutGridIcon size={18} /> },
        { path: '/statistiques', label: 'Performance CX', icon: <BarChartIcon size={18} /> },
        { path: '/feedbacks', label: 'Feedbacks', icon: <MessageSquareIcon size={18} /> },
      ],
    },
    {
      title: 'AGIR',
      items: [
        { path: '/alertes', label: 'Alertes', icon: <BellIcon size={18} /> },
        { path: '/issues', label: 'Issues', icon: <ActivityIcon size={18} /> },
        { path: '/actions', label: 'Actions correctives', icon: <TargetIcon size={18} /> },
      ],
    },
    {
      title: 'CLIENTS',
      items: [
        { path: '/suggestions', label: 'Suggestions', icon: <LightbulbIcon size={18} /> },
        { path: '/demandes-rappel', label: 'Demandes de rappel', icon: <PhoneIcon size={18} /> },
      ],
    },
    {
      title: 'RÉSEAU',
      items: [
        { path: '/veille', label: 'Veille', icon: <MegaphoneIcon size={18} /> },
        { path: '/admin/gestion-agences', label: 'Gestion des agences', icon: <StoreIcon size={18} /> },
      ],
    },
  ],
  agency_manager: [
    {
      title: 'MON AGENCE',
      items: [
        { path: '/agence', label: "Vue d'ensemble", icon: <LayoutGridIcon size={18} /> },
        { path: '/statistiques', label: 'Performance CX', icon: <BarChartIcon size={18} /> },
        { path: '/feedbacks', label: 'Feedbacks', icon: <MessageSquareIcon size={18} /> },
      ],
    },
    {
      title: 'AGIR',
      items: [
        { path: '/alertes', label: 'Alertes', icon: <BellIcon size={18} /> },
        { path: '/issues', label: 'Issues', icon: <ActivityIcon size={18} /> },
        { path: '/actions', label: 'Mes actions', icon: <TargetIcon size={18} /> },
      ],
    },
    {
      title: 'CLIENTS',
      items: [
        { path: '/suggestions', label: 'Suggestions', icon: <LightbulbIcon size={18} /> },
        { path: '/demandes-rappel', label: 'Demandes de rappel', icon: <PhoneIcon size={18} /> },
      ],
    },
  ],
};

/** Signale en dev tout lien de menu pointant vers une route que le rôle ne peut pas ouvrir. */
export function assertNavCoherence() {
  (Object.keys(ROLE_NAV_SECTIONS) as UserRole[]).forEach((role) => {
    ROLE_NAV_SECTIONS[role].forEach((section) =>
      section.items.forEach((item) => {
        const path = item.path.split('?')[0];
        if (!ROUTE_ROLES[path]?.includes(role)) {
          console.error(`[navigation] « ${item.label} » (${path}) est visible pour ${role} mais la route ne l'autorise pas.`);
        }
      }),
    );
  });
}
