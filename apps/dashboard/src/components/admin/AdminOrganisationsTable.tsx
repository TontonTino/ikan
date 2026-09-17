import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AdminOrganisationHierarchy, AdminUserItem } from '../../types';
import {
  BuildingIcon,
  UsersIcon,
  StoreIcon,
  SearchIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  MoreVerticalIcon,
  CheckCircleIcon,
  ExternalLinkIcon,
  EditIcon,
  BarChartIcon,
  ClockIcon,
} from '../common/Icons';

interface AdminOrganisationsTableProps {
  organisations: AdminOrganisationHierarchy[];
  loading?: boolean;
}

export default function AdminOrganisationsTable({
  organisations = [],
  loading = false,
}: AdminOrganisationsTableProps) {
  const navigate = useNavigate();
  const [expandedOrgs, setExpandedOrgs] = useState<Record<string, boolean>>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  // Toggle expansion of an organisation row
  const toggleExpand = (orgId: string) => {
    setExpandedOrgs((prev) => ({
      ...prev,
      [orgId]: !prev[orgId],
    }));
  };

  // Filtrage et recherche
  const filteredOrganisations = useMemo(() => {
    return organisations.filter((org) => {
      const matchSearch =
        org.nom.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (org.email_pro && org.email_pro.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (org.secteur_activite && org.secteur_activite.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchStatus =
        statusFilter === 'all'
          ? true
          : statusFilter === 'active'
            ? org.active
            : !org.active;

      return matchSearch && matchStatus;
    });
  }, [organisations, searchTerm, statusFilter]);

  // Helper pour formater la date relative / d'activité
  const formatRelativeActivity = (isoDate?: string | null) => {
    if (!isoDate) return "Récemment";
    try {
      const date = new Date(isoDate);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffMins < 5) return "Il y a 5 min";
      if (diffMins < 60) return `Il y a ${diffMins} min`;
      if (diffHours < 24) return `Il y a ${diffHours} h`;
      if (diffDays === 1) return "Hier";
      if (diffDays < 7) return `Il y a ${diffDays} j`;
      return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    } catch {
      return "Récemment";
    }
  };

  return (
    <div
      style={{
        background: '#FFFFFF',
        borderRadius: '24px',
        border: '1px solid #E8ECE6',
        boxShadow: '0 2px 10px rgba(0, 0, 0, 0.02)',
        overflow: 'hidden',
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
      }}
    >
      {/* ── 1. Barre d'outils du Tableau (Recherche, Filtres & Titre) ── */}
      <div
        style={{
          padding: '22px 28px 18px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '16px',
          borderBottom: '1px solid #F1F5F2',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <BuildingIcon size={20} color="#02302D" />
            <h2
              style={{
                fontSize: '1.18rem',
                fontWeight: 800,
                color: '#02302D',
                margin: 0,
              }}
            >
              Organisations
            </h2>
            <span
              style={{
                background: '#EAF5EC',
                color: '#3C7730',
                fontSize: '0.76rem',
                fontWeight: 800,
                padding: '2px 8px',
                borderRadius: '9999px',
              }}
            >
              {filteredOrganisations.length}
            </span>
          </div>
          <p
            style={{
              color: '#64748B',
              fontSize: '0.84rem',
              marginTop: '4px',
              marginBottom: 0,
              fontWeight: 500,
            }}
          >
            Supervision hiérarchique : CX Managers, Agency Managers, Agences et Traitement
          </p>
        </div>

        {/* Contrôles de Recherche et Filtres */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {/* Recherche */}
          <div
            style={{
              background: '#F8FAFB',
              border: '1px solid #E2E8F0',
              borderRadius: '12px',
              padding: '7px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              width: '280px',
              boxSizing: 'border-box',
            }}
          >
            <SearchIcon size={15} color="#94A3B8" />
            <input
              type="text"
              placeholder="Rechercher une organisation..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
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
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#94A3B8',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                ✕
              </button>
            )}
          </div>

          {/* Filtre Statut */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            style={{
              background: '#F8FAFB',
              border: '1px solid #E2E8F0',
              borderRadius: '12px',
              padding: '7px 12px',
              fontSize: '0.82rem',
              fontWeight: 600,
              color: '#1E293B',
              outline: 'none',
              cursor: 'pointer',
              fontFamily: 'inherit',
              boxSizing: 'border-box',
            }}
          >
            <option value="all">Tous les statuts</option>
            <option value="active">Actives</option>
            <option value="inactive">Inactives</option>
          </select>
        </div>
      </div>

      {/* ── 2. Tableau Principal ── */}
      <div
        style={{
          overflowX: 'auto',
          width: '100%',
          maxWidth: '100%',
          minWidth: 0,
          boxSizing: 'border-box',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem', minWidth: '780px' }}>
          <thead style={{ background: '#F8FAFB', borderBottom: '1px solid #E8ECE6' }}>
            <tr>
              {[
                { label: 'Organisation', align: 'left' },
                { label: 'CX Managers', align: 'center' },
                { label: 'Agency Managers', align: 'center' },
                { label: 'Agences', align: 'center' },
                { label: 'Feedbacks reçus', align: 'center' },
                { label: 'Feedbacks traités', align: 'center' },
                { label: 'Taux de traitement', align: 'left' },
                { label: 'Statut', align: 'center' },
                { label: 'Actions', align: 'right' },
              ].map((col, idx) => (
                <th
                  key={idx}
                  style={{
                    textAlign: col.align as any,
                    padding: '14px 18px',
                    color: '#64748B',
                    fontWeight: 700,
                    fontSize: '0.76rem',
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} style={{ padding: '40px', textAlign: 'center', color: '#64748B' }}>
                  Chargement des données...
                </td>
              </tr>
            ) : filteredOrganisations.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ padding: '40px', textAlign: 'center', color: '#64748B' }}>
                  Aucune organisation trouvée.
                </td>
              </tr>
            ) : (
              filteredOrganisations.map((org) => {
                const isExpanded = !!expandedOrgs[org.id];
                const isMenuActive = activeMenuId === org.id;

                return (
                  <React.Fragment key={org.id}>
                    {/* Ligne principale Organisation */}
                    <tr
                      style={{
                        borderBottom: isExpanded ? 'none' : '1px solid #F1F4EE',
                        background: isExpanded ? '#F8FBF9' : 'transparent',
                        transition: 'background 0.15s ease',
                      }}
                      onMouseEnter={(e) => {
                        if (!isExpanded) e.currentTarget.style.background = '#F8FAFB';
                      }}
                      onMouseLeave={(e) => {
                        if (!isExpanded) e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      {/* Colonne 1 : Flèche Expand + Logo + Nom */}
                      <td style={{ padding: '16px 18px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <button
                            onClick={() => toggleExpand(org.id)}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: '#3C7730',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              padding: '4px',
                              borderRadius: '6px',
                              transition: 'transform 0.15s ease',
                            }}
                            title={isExpanded ? 'Replier les détails' : 'Déplier les détails'}
                          >
                            {isExpanded ? (
                              <ChevronDownIcon size={16} color="#3C7730" />
                            ) : (
                              <ChevronRightIcon size={16} color="#64748B" />
                            )}
                          </button>

                          {/* Logo ou Avatar */}
                          {org.logo ? (
                            <img
                              src={org.logo}
                              alt={org.nom}
                              style={{
                                width: '34px',
                                height: '34px',
                                borderRadius: '8px',
                                objectFit: 'contain',
                                background: '#FFFFFF',
                                padding: '2px',
                                border: '1px solid #E2E8F0',
                                flexShrink: 0,
                              }}
                            />
                          ) : (
                            <div
                              style={{
                                width: '34px',
                                height: '34px',
                                borderRadius: '8px',
                                background: '#EAF5EC',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '0.78rem',
                                fontWeight: 800,
                                color: '#3C7730',
                                flexShrink: 0,
                                border: '1px solid #D5E8D3',
                              }}
                            >
                              {org.nom.substring(0, 2).toUpperCase()}
                            </div>
                          )}

                          <div>
                            <div
                              onClick={() => toggleExpand(org.id)}
                              style={{
                                fontWeight: 800,
                                color: '#02302D',
                                cursor: 'pointer',
                                fontSize: '0.92rem',
                              }}
                            >
                              {org.nom}
                            </div>
                            <div style={{ fontSize: '0.74rem', color: '#64748B', fontWeight: 500 }}>
                              {org.secteur_activite || 'Entreprise'} • {org.pays_region || 'Afrique'}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Colonne 2 : CX Managers */}
                      <td style={{ textAlign: 'center', padding: '16px 18px', fontWeight: 700, color: '#02302D' }}>
                        <span
                          style={{
                            background: '#F1F5F2',
                            padding: '4px 10px',
                            borderRadius: '8px',
                            fontSize: '0.84rem',
                          }}
                        >
                          {org.cx_managers_count}
                        </span>
                      </td>

                      {/* Colonne 3 : Agency Managers */}
                      <td style={{ textAlign: 'center', padding: '16px 18px', fontWeight: 700, color: '#02302D' }}>
                        <span
                          style={{
                            background: '#F1F5F2',
                            padding: '4px 10px',
                            borderRadius: '8px',
                            fontSize: '0.84rem',
                          }}
                        >
                          {org.agency_managers_count}
                        </span>
                      </td>

                      {/* Colonne 4 : Agences */}
                      <td style={{ textAlign: 'center', padding: '16px 18px', fontWeight: 700, color: '#02302D' }}>
                        <span
                          style={{
                            background: '#F1F5F2',
                            padding: '4px 10px',
                            borderRadius: '8px',
                            fontSize: '0.84rem',
                          }}
                        >
                          {org.agences_count}
                        </span>
                      </td>

                      {/* Colonne 5 : Feedbacks reçus */}
                      <td style={{ textAlign: 'center', padding: '16px 18px', fontWeight: 700, color: '#02302D' }}>
                        {org.feedbacks_recus.toLocaleString('fr-FR')}
                      </td>

                      {/* Colonne 6 : Feedbacks traités */}
                      <td style={{ textAlign: 'center', padding: '16px 18px', fontWeight: 700, color: '#3C7730' }}>
                        {org.feedbacks_traites.toLocaleString('fr-FR')}
                      </td>

                      {/* Colonne 7 : Taux de traitement (Jauge visuelle) */}
                      <td style={{ padding: '16px 18px', minWidth: '150px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <div
                            style={{
                              flex: 1,
                              height: '7px',
                              background: '#EDF2EC',
                              borderRadius: '9999px',
                              overflow: 'hidden',
                              position: 'relative',
                            }}
                          >
                            <div
                              style={{
                                width: `${Math.min(100, Math.max(0, org.taux_traitement))}%`,
                                height: '100%',
                                background:
                                  org.taux_traitement >= 80
                                    ? 'linear-gradient(90deg, #75B72A 0%, #3C7730 100%)'
                                    : org.taux_traitement >= 50
                                      ? 'linear-gradient(90deg, #F59E0B 0%, #D97706 100%)'
                                      : 'linear-gradient(90deg, #EF4444 0%, #DC2626 100%)',
                                borderRadius: '9999px',
                                transition: 'width 0.3s ease',
                              }}
                            />
                          </div>
                          <span
                            style={{
                              fontSize: '0.82rem',
                              fontWeight: 800,
                              color: '#02302D',
                              minWidth: '42px',
                              textAlign: 'right',
                            }}
                          >
                            {org.taux_traitement}%
                          </span>
                        </div>
                      </td>

                      {/* Colonne 8 : Statut */}
                      <td style={{ textAlign: 'center', padding: '16px 18px' }}>
                        <span
                          style={{
                            background: org.active ? '#EBF5E9' : '#F1F5F9',
                            color: org.active ? '#3C7730' : '#64748B',
                            padding: '4px 10px',
                            borderRadius: '9999px',
                            fontSize: '0.74rem',
                            fontWeight: 800,
                            border: `1px solid ${org.active ? '#D5E8D3' : '#E2E8F0'}`,
                          }}
                        >
                          {org.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>

                      {/* Colonne 9 : Menu Actions "..." */}
                      <td style={{ textAlign: 'right', padding: '16px 18px', position: 'relative' }}>
                        <div style={{ display: 'inline-block', position: 'relative' }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveMenuId(isMenuActive ? null : org.id);
                            }}
                            style={{
                              background: isMenuActive ? '#F1F5F2' : 'transparent',
                              border: '1px solid',
                              borderColor: isMenuActive ? '#DCE8DF' : 'transparent',
                              borderRadius: '8px',
                              padding: '6px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: '#64748B',
                              transition: 'background 0.15s ease',
                            }}
                            title="Actions"
                          >
                            <MoreVerticalIcon size={16} />
                          </button>

                          {/* Menu Dropdown Contextuel */}
                          {isMenuActive && (
                            <div
                              style={{
                                position: 'absolute',
                                right: 0,
                                top: '100%',
                                marginTop: '4px',
                                background: '#FFFFFF',
                                borderRadius: '14px',
                                border: '1px solid #E2E8F0',
                                boxShadow: '0 10px 25px rgba(2, 48, 45, 0.12)',
                                zIndex: 50,
                                minWidth: '180px',
                                padding: '6px',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '2px',
                              }}
                            >
                              <button
                                onClick={() => {
                                  setActiveMenuId(null);
                                  navigate('/admin/organisations');
                                }}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '8px',
                                  padding: '8px 12px',
                                  background: 'transparent',
                                  border: 'none',
                                  borderRadius: '8px',
                                  fontSize: '0.82rem',
                                  fontWeight: 600,
                                  color: '#02302D',
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                  width: '100%',
                                  fontFamily: 'inherit',
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = '#F8FAFB')}
                                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                              >
                                <BuildingIcon size={14} color="#3C7730" />
                                <span>Voir organisation</span>
                              </button>

                              <button
                                onClick={() => {
                                  setActiveMenuId(null);
                                  navigate('/admin/utilisateurs');
                                }}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '8px',
                                  padding: '8px 12px',
                                  background: 'transparent',
                                  border: 'none',
                                  borderRadius: '8px',
                                  fontSize: '0.82rem',
                                  fontWeight: 600,
                                  color: '#02302D',
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                  width: '100%',
                                  fontFamily: 'inherit',
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = '#F8FAFB')}
                                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                              >
                                <UsersIcon size={14} color="#3C7730" />
                                <span>Voir utilisateurs</span>
                              </button>

                              <button
                                onClick={() => {
                                  setActiveMenuId(null);
                                  toggleExpand(org.id);
                                }}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '8px',
                                  padding: '8px 12px',
                                  background: 'transparent',
                                  border: 'none',
                                  borderRadius: '8px',
                                  fontSize: '0.82rem',
                                  fontWeight: 600,
                                  color: '#02302D',
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                  width: '100%',
                                  fontFamily: 'inherit',
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = '#F8FAFB')}
                                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                              >
                                <BarChartIcon size={14} color="#3C7730" />
                                <span>Voir statistiques</span>
                              </button>

                              <div style={{ height: '1px', background: '#F1F5F2', margin: '4px 0' }} />

                              <button
                                onClick={() => {
                                  setActiveMenuId(null);
                                  navigate('/admin/organisations');
                                }}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '8px',
                                  padding: '8px 12px',
                                  background: 'transparent',
                                  border: 'none',
                                  borderRadius: '8px',
                                  fontSize: '0.82rem',
                                  fontWeight: 600,
                                  color: '#02302D',
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                  width: '100%',
                                  fontFamily: 'inherit',
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = '#F8FAFB')}
                                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                              >
                                <EditIcon size={14} color="#64748B" />
                                <span>Modifier</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* ── Zone Expandable : Détail & Hiérarchie de l'organisation ── */}
                    {isExpanded && (
                      <tr style={{ background: '#F8FBF9', borderBottom: '1px solid #E8ECE6' }}>
                        <td colSpan={9} style={{ padding: '0 24px 24px 24px' }}>
                          <div
                            style={{
                              background: '#FFFFFF',
                              borderRadius: '16px',
                              border: '1px solid #DCE8DF',
                              padding: '20px',
                              boxShadow: '0 2px 8px rgba(2, 48, 45, 0.03)',
                            }}
                          >
                            {/* 1. Résumé Hiérarchique en 3 Blocs Clairs */}
                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                                gap: '16px',
                                marginBottom: '20px',
                              }}
                            >
                              {/* Bloc CX Managers */}
                              <div
                                style={{
                                  background: '#F8FAFB',
                                  borderRadius: '12px',
                                  padding: '14px 16px',
                                  border: '1px solid #E8ECE6',
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                  <UsersIcon size={16} color="#0369A1" />
                                  <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#0369A1', textTransform: 'uppercase' }}>
                                    CX Managers ({org.cx_managers.length})
                                  </span>
                                </div>
                                {org.cx_managers.length === 0 ? (
                                  <div style={{ fontSize: '0.8rem', color: '#94A3B8' }}>Aucun CX Manager assigné</div>
                                ) : (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    {org.cx_managers.map((cx) => (
                                      <div key={cx.id} style={{ fontSize: '0.84rem', fontWeight: 700, color: '#02302D', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <span style={{ color: '#75B72A' }}>•</span>
                                        <span>{cx.prenom} {cx.nom}</span>
                                        <span style={{ color: '#94A3B8', fontSize: '0.74rem', fontWeight: 500 }}>({cx.email})</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>

                              {/* Bloc Agency Managers */}
                              <div
                                style={{
                                  background: '#F8FAFB',
                                  borderRadius: '12px',
                                  padding: '14px 16px',
                                  border: '1px solid #E8ECE6',
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                  <UsersIcon size={16} color="#3C7730" />
                                  <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#3C7730', textTransform: 'uppercase' }}>
                                    Agency Managers ({org.agency_managers.length})
                                  </span>
                                </div>
                                {org.agency_managers.length === 0 ? (
                                  <div style={{ fontSize: '0.8rem', color: '#94A3B8' }}>Aucun Agency Manager</div>
                                ) : (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    {org.agency_managers.map((am) => (
                                      <div key={am.id} style={{ fontSize: '0.84rem', fontWeight: 700, color: '#02302D', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <span style={{ color: '#3C7730' }}>•</span>
                                        <span>{am.prenom} {am.nom}</span>
                                        {am.agence_nom && (
                                          <span style={{ color: '#64748B', fontSize: '0.74rem', fontWeight: 600 }}>({am.agence_nom})</span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>

                              {/* Bloc Agences */}
                              <div
                                style={{
                                  background: '#F8FAFB',
                                  borderRadius: '12px',
                                  padding: '14px 16px',
                                  border: '1px solid #E8ECE6',
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                  <StoreIcon size={16} color="#02302D" />
                                  <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#02302D', textTransform: 'uppercase' }}>
                                    Agences Réseau ({org.agences.length})
                                  </span>
                                </div>
                                {org.agences.length === 0 ? (
                                  <div style={{ fontSize: '0.8rem', color: '#94A3B8' }}>Aucune agence créée</div>
                                ) : (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    {org.agences.map((ag) => (
                                      <div key={ag.id} style={{ fontSize: '0.84rem', fontWeight: 700, color: '#02302D', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <span style={{ color: '#02302D' }}>•</span>
                                        <span>{ag.nom}</span>
                                        {ag.ville && <span style={{ color: '#94A3B8', fontSize: '0.74rem', fontWeight: 500 }}>({ag.ville})</span>}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* 2. Sous-Tableau des Utilisateurs de cette Organisation */}
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                                <h4 style={{ margin: 0, fontSize: '0.92rem', fontWeight: 800, color: '#02302D' }}>
                                  Utilisateurs rattachés ({org.users.length})
                                </h4>
                              </div>

                              {org.users.length === 0 ? (
                                <div style={{ fontSize: '0.84rem', color: '#64748B', fontStyle: 'italic', padding: '12px 0' }}>
                                  Aucun utilisateur enregistré dans cette organisation.
                                </div>
                              ) : (
                                <div style={{ overflowX: 'auto', width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
                                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', minWidth: '640px' }}>
                                    <thead>
                                      <tr style={{ background: '#F1F5F2', borderBottom: '1px solid #E2E8F0' }}>
                                        <th style={{ textAlign: 'left', padding: '10px 14px', color: '#475569', fontWeight: 700, borderRadius: '8px 0 0 8px' }}>Nom</th>
                                        <th style={{ textAlign: 'left', padding: '10px 14px', color: '#475569', fontWeight: 700 }}>Email</th>
                                        <th style={{ textAlign: 'left', padding: '10px 14px', color: '#475569', fontWeight: 700 }}>Rôle</th>
                                        <th style={{ textAlign: 'left', padding: '10px 14px', color: '#475569', fontWeight: 700 }}>Agences</th>
                                        <th style={{ textAlign: 'center', padding: '10px 14px', color: '#475569', fontWeight: 700 }}>Feedbacks reçus</th>
                                        <th style={{ textAlign: 'center', padding: '10px 14px', color: '#475569', fontWeight: 700 }}>Feedbacks traités</th>
                                        <th style={{ textAlign: 'center', padding: '10px 14px', color: '#475569', fontWeight: 700 }}>Statut</th>
                                        <th style={{ textAlign: 'right', padding: '10px 14px', color: '#475569', fontWeight: 700, borderRadius: '0 8px 8px 0' }}>Dernière activité</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {org.users.map((u) => {
                                        const isCX = u.role === 'CX Manager';
                                        return (
                                          <tr key={u.id} style={{ borderBottom: '1px solid #F1F4EE' }}>
                                            <td style={{ padding: '10px 14px', fontWeight: 700, color: '#02302D' }}>
                                              {u.prenom} {u.nom}
                                            </td>
                                            <td style={{ padding: '10px 14px', color: '#64748B' }}>
                                              {u.email}
                                            </td>
                                            <td style={{ padding: '10px 14px' }}>
                                              <span
                                                style={{
                                                  background: isCX ? '#E0F2FE' : '#EBF5E9',
                                                  color: isCX ? '#0369A1' : '#3C7730',
                                                  padding: '2px 8px',
                                                  borderRadius: '9999px',
                                                  fontSize: '0.72rem',
                                                  fontWeight: 800,
                                                  border: `1px solid ${isCX ? '#BAE6FD' : '#D5E8D3'}`,
                                                }}
                                              >
                                                {u.role}
                                              </span>
                                            </td>
                                            <td style={{ padding: '10px 14px', color: '#475569', fontWeight: 600 }}>
                                              {isCX ? `${u.agences_count} agences` : u.agence_nom || '—'}
                                            </td>
                                            <td style={{ textAlign: 'center', padding: '10px 14px', fontWeight: 700, color: '#02302D' }}>
                                              {u.feedbacks_recus}
                                            </td>
                                            <td style={{ textAlign: 'center', padding: '10px 14px', fontWeight: 700, color: '#3C7730' }}>
                                              {u.feedbacks_traites}
                                            </td>
                                            <td style={{ textAlign: 'center', padding: '10px 14px' }}>
                                              <span
                                                style={{
                                                  background: u.active ? '#EBF5E9' : '#F1F5F9',
                                                  color: u.active ? '#3C7730' : '#64748B',
                                                  padding: '2px 8px',
                                                  borderRadius: '9999px',
                                                  fontSize: '0.7rem',
                                                  fontWeight: 800,
                                                }}
                                              >
                                                {u.active ? 'Actif' : 'Inactif'}
                                              </span>
                                            </td>
                                            <td style={{ textAlign: 'right', padding: '10px 14px', color: '#64748B', fontSize: '0.76rem' }}>
                                              {formatRelativeActivity(u.derniere_connexion)}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
