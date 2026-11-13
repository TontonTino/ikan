import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import SkeletonBlock from '../ui/SkeletonBlock';
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
  BarChartIcon,
  ClockIcon,
} from '../common/Icons';
import { ROLE_LABELS_PLURIEL, RESPONSABLE_CX, codeRole, libelleRole } from '../../utils/vocabulaire';

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
    if (!isoDate) return "Aucune connexion enregistrée";
    try {
      const date = new Date(isoDate);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffMins < 5) return "À l’instant";
      if (diffMins < 60) return `Il y a ${diffMins} min`;
      if (diffHours < 24) return `Il y a ${diffHours} h`;
      if (diffDays === 1) return "Hier";
      if (diffDays < 7) return `Il y a ${diffDays} j`;
      return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    } catch {
      return "Date inconnue";
    }
  };

  return (
    <div
      style={{
        background: 'var(--color-surface)',
        borderRadius: '24px',
        border: '1px solid var(--color-trait)',
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
          borderBottom: '1px solid var(--color-trait)',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <BuildingIcon size={20} color="var(--color-encre)" />
            <h2
              style={{
                fontSize: 'var(--text-lg)',
                fontWeight: 'var(--weight-semibold)',
                color: 'var(--color-encre)',
                margin: 0,
              }}
            >
              Organisations
            </h2>
            <span
              style={{
                background: 'var(--color-bon-fond)',
                color: 'var(--color-bon-texte)',
                fontSize: 'var(--text-xs)',
                fontWeight: 'var(--weight-semibold)',
                padding: '2px 8px',
                borderRadius: '9999px',
              }}
            >
              {filteredOrganisations.length}
            </span>
          </div>
          <p
            style={{
              color: 'var(--color-text-2)',
              fontSize: 'var(--text-sm)',
              marginTop: '4px',
              marginBottom: 0,
              fontWeight: 'var(--weight-normal)',
            }}
          >
            {ROLE_LABELS_PLURIEL.cx_manager}, responsables d’agence, agences et forfaits de chaque organisation
          </p>
        </div>

        {/* Contrôles de Recherche et Filtres */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {/* Recherche */}
          <div
            style={{
              background: 'var(--color-bg)',
              border: '1px solid var(--color-trait)',
              borderRadius: '12px',
              padding: '10px 16px',
              minHeight: '44px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              width: 'min(280px, 100%)',
              boxSizing: 'border-box',
            }}
          >
            <SearchIcon size={15} color="var(--color-text-2)" />
            <input
              type="text"
              aria-label="Rechercher une organisation"
              placeholder="Rechercher une organisation..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                border: 'none',
                background: 'transparent',
                fontSize: 'var(--text-sm)',
                color: 'var(--color-encre)',
                width: '100%',
                minHeight: '24px',
                boxSizing: 'border-box',
                padding: 0,
                fontFamily: 'inherit',
              }}
            />
            {searchTerm && (
              <button
                type="button"
                aria-label="Effacer la recherche"
                onClick={() => setSearchTerm('')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--color-text-2)',
                  cursor: 'pointer',
                  fontSize: 'var(--text-sm)',
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
            aria-label="Filtrer les organisations par statut"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            style={{
              background: 'var(--color-bg)',
              border: '1px solid var(--color-trait)',
              borderRadius: '12px',
              padding: '7px 12px',
              fontSize: 'var(--text-sm)',
              fontWeight: 'var(--weight-semibold)',
              color: 'var(--color-encre)',
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
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)', minWidth: '780px' }}>
          <thead style={{ background: 'var(--color-bg)', borderBottom: '1px solid var(--color-trait)' }}>
            <tr>
              {[
                { label: 'Organisation', align: 'left' },
                { label: ROLE_LABELS_PLURIEL.cx_manager, align: 'center' },
                { label: 'Responsables d’agence', align: 'center' },
                { label: 'Agences', align: 'center' },
                { label: 'Forfait', align: 'center' },
                { label: 'Statut', align: 'center' },
                { label: 'Actions', align: 'right' },
              ].map((col, idx) => (
                <th
                  key={idx}
                  style={{
                    textAlign: col.align as any,
                    padding: '14px 18px',
                    color: 'var(--color-text-2)',
                    fontWeight: 'var(--weight-semibold)',
                    fontSize: 'var(--text-xs)',
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
              [0, 1, 2].map((i) => (
                <tr key={i} aria-busy="true">
                  <td colSpan={7} style={{ padding: '14px 24px' }}>
                    <SkeletonBlock height={38} radius="var(--radius-md)" />
                  </td>
                </tr>
              ))
            ) : filteredOrganisations.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-2)' }}>
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
                        borderBottom: isExpanded ? 'none' : '1px solid var(--color-trait)',
                        background: isExpanded ? 'var(--color-bg)' : 'transparent',
                        transition: 'background 0.15s ease',
                      }}
                      onMouseEnter={(e) => {
                        if (!isExpanded) e.currentTarget.style.background = 'var(--color-bg)';
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
                              color: 'var(--color-bon-texte)',
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
                              <ChevronDownIcon size={16} color="var(--color-bon-texte)" />
                            ) : (
                              <ChevronRightIcon size={16} color="var(--color-text-2)" />
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
                                background: 'var(--color-surface)',
                                padding: '2px',
                                border: '1px solid var(--color-trait)',
                                flexShrink: 0,
                              }}
                            />
                          ) : (
                            <div
                              style={{
                                width: '34px',
                                height: '34px',
                                borderRadius: '8px',
                                background: 'var(--color-bon-fond)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 'var(--text-xs)',
                                fontWeight: 'var(--weight-semibold)',
                                color: 'var(--color-bon-texte)',
                                flexShrink: 0,
                                border: '1px solid var(--color-bon-fond)',
                              }}
                            >
                              {org.nom.substring(0, 2).toUpperCase()}
                            </div>
                          )}

                          <div>
                            <div
                              onClick={() => toggleExpand(org.id)}
                              style={{
                                fontWeight: 'var(--weight-semibold)',
                                color: 'var(--color-encre)',
                                cursor: 'pointer',
                                fontSize: 'var(--text-base)',
                              }}
                            >
                              {org.nom}
                            </div>
                            <div className="t-xs t-2 t-normal">
                              {org.secteur_activite || 'Entreprise'} • {org.pays_region || 'Afrique'}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Colonne 2 : CX Managers */}
                      <td style={{ textAlign: 'center', padding: '16px 18px', fontWeight: 'var(--weight-semibold)', color: 'var(--color-encre)' }}>
                        <span
                          style={{
                            background: 'var(--color-bg)',
                            padding: '4px 10px',
                            borderRadius: '8px',
                            fontSize: 'var(--text-sm)',
                          }}
                        >
                          {org.cx_managers_count}
                        </span>
                      </td>

                      {/* Colonne 3 : Agency Managers */}
                      <td style={{ textAlign: 'center', padding: '16px 18px', fontWeight: 'var(--weight-semibold)', color: 'var(--color-encre)' }}>
                        <span
                          style={{
                            background: 'var(--color-bg)',
                            padding: '4px 10px',
                            borderRadius: '8px',
                            fontSize: 'var(--text-sm)',
                          }}
                        >
                          {org.agency_managers_count}
                        </span>
                      </td>

                      {/* Colonne 4 : Agences */}
                      <td style={{ textAlign: 'center', padding: '16px 18px', fontWeight: 'var(--weight-semibold)', color: 'var(--color-encre)' }}>
                        <span
                          style={{
                            background: 'var(--color-bg)',
                            padding: '4px 10px',
                            borderRadius: '8px',
                            fontSize: 'var(--text-sm)',
                          }}
                        >
                          {org.agences_count}
                        </span>
                      </td>

                      {/* Colonne 5 : Forfait */}
                      <td style={{ textAlign: 'center', padding: '16px 18px' }}>
                        <span
                          style={{
                            background: 'var(--color-bon-fond)',
                            color: 'var(--color-bon-texte)',
                            padding: '3px 10px',
                            borderRadius: '9999px',
                            fontSize: 'var(--text-xs)',
                            fontWeight: 'var(--weight-semibold)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {org.plan_nom || '—'}
                        </span>
                      </td>

                      {/* Colonne 8 : Statut */}
                      <td style={{ textAlign: 'center', padding: '16px 18px' }}>
                        <span
                          style={{
                            background: org.active ? 'var(--color-bon-fond)' : 'var(--color-neutre-fond)',
                            color: org.active ? 'var(--color-bon-texte)' : 'var(--color-text-2)',
                            padding: '4px 10px',
                            borderRadius: '9999px',
                            fontSize: 'var(--text-xs)',
                            fontWeight: 'var(--weight-semibold)',
                            border: `1px solid ${org.active ? 'var(--color-bon-fond)' : 'var(--color-trait)'}`,
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
                              background: isMenuActive ? 'var(--color-bg)' : 'transparent',
                              border: '1px solid',
                              borderColor: isMenuActive ? 'var(--color-trait)' : 'transparent',
                              borderRadius: '8px',
                              padding: '6px',
                              minWidth: 44,
                              minHeight: 44,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: 'var(--color-text-2)',
                              transition: 'background 0.15s ease',
                            }}
                            title="Actions"
                            aria-label={`Actions pour ${org.nom}`}
                            aria-haspopup="menu"
                            aria-expanded={isMenuActive}
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
                                background: 'var(--color-surface)',
                                borderRadius: '14px',
                                border: '1px solid var(--color-trait)',
                                boxShadow: 'var(--shadow-sm)',
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
                                  fontSize: 'var(--text-sm)',
                                  fontWeight: 'var(--weight-semibold)',
                                  color: 'var(--color-encre)',
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                  width: '100%',
                                  fontFamily: 'inherit',
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg)')}
                                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                              >
                                <BuildingIcon size={14} color="var(--color-bon-texte)" />
                                <span>Ouvrir la page Organisations</span>
                              </button>

                              <button
                                onClick={() => {
                                  setActiveMenuId(null);
                                  navigate('/admin/gestion-agences?tab=utilisateurs');
                                }}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '8px',
                                  padding: '8px 12px',
                                  background: 'transparent',
                                  border: 'none',
                                  borderRadius: '8px',
                                  fontSize: 'var(--text-sm)',
                                  fontWeight: 'var(--weight-semibold)',
                                  color: 'var(--color-encre)',
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                  width: '100%',
                                  fontFamily: 'inherit',
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg)')}
                                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                              >
                                <UsersIcon size={14} color="var(--color-bon-texte)" />
                                <span>Ouvrir les comptes {ROLE_LABELS_PLURIEL.cx_manager.toLowerCase()}</span>
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
                                  fontSize: 'var(--text-sm)',
                                  fontWeight: 'var(--weight-semibold)',
                                  color: 'var(--color-encre)',
                                  cursor: 'pointer',
                                  textAlign: 'left',
                                  width: '100%',
                                  fontFamily: 'inherit',
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg)')}
                                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                              >
                                <BarChartIcon size={14} color="var(--color-bon-texte)" />
                                <span>Voir le détail</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* ── Zone Expandable : Détail & Hiérarchie de l'organisation ── */}
                    {isExpanded && (
                      <tr style={{ background: 'var(--color-bg)', borderBottom: '1px solid var(--color-trait)' }}>
                        <td colSpan={7} style={{ padding: '0 24px 24px 24px' }}>
                          <div
                            style={{
                              background: 'var(--color-surface)',
                              borderRadius: '16px',
                              border: '1px solid var(--color-trait)',
                              padding: '20px',
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
                                  background: 'var(--color-bg)',
                                  borderRadius: '12px',
                                  padding: '14px 16px',
                                  border: '1px solid var(--color-trait)',
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                  <UsersIcon size={16} color="var(--color-neutre-texte)" />
                                  <span className="t-sm t-semi t-neutre t-majuscules">
                                    {ROLE_LABELS_PLURIEL.cx_manager} ({org.cx_managers.length})
                                  </span>
                                </div>
                                {org.cx_managers.length === 0 ? (
                                  <div className="t-xs t-2">Aucun {RESPONSABLE_CX} assigné</div>
                                ) : (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    {org.cx_managers.map((cx) => (
                                      <div key={cx.id} style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-encre)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <span aria-hidden="true" className="t-2">•</span>
                                        <span>{cx.prenom} {cx.nom}</span>
                                        <span className="t-2 t-xs t-normal">({cx.email})</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>

                              {/* Bloc Agency Managers */}
                              <div
                                style={{
                                  background: 'var(--color-bg)',
                                  borderRadius: '12px',
                                  padding: '14px 16px',
                                  border: '1px solid var(--color-trait)',
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                  <UsersIcon size={16} color="var(--color-bon-texte)" />
                                  <span className="t-sm t-semi t-bon t-majuscules">
                                    Responsables d’agence ({org.agency_managers.length})
                                  </span>
                                </div>
                                {org.agency_managers.length === 0 ? (
                                  <div className="t-xs t-2">Aucun responsable d’agence</div>
                                ) : (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    {org.agency_managers.map((am) => (
                                      <div key={am.id} style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-encre)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <span className="t-bon">•</span>
                                        <span>{am.prenom} {am.nom}</span>
                                        {am.agence_nom && (
                                          <span className="t-2 t-xs t-semi">({am.agence_nom})</span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>

                              {/* Bloc Agences */}
                              <div
                                style={{
                                  background: 'var(--color-bg)',
                                  borderRadius: '12px',
                                  padding: '14px 16px',
                                  border: '1px solid var(--color-trait)',
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                  <StoreIcon size={16} color="var(--color-encre)" />
                                  <span className="t-sm t-semi t-encre t-majuscules">
                                    Agences Réseau ({org.agences.length})
                                  </span>
                                </div>
                                {org.agences.length === 0 ? (
                                  <div className="t-xs t-2">Aucune agence créée</div>
                                ) : (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    {org.agences.map((ag) => (
                                      <div key={ag.id} style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-encre)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <span className="t-encre">•</span>
                                        <span>{ag.nom}</span>
                                        {ag.ville && <span className="t-2 t-xs t-normal">({ag.ville})</span>}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* 2. Sous-Tableau des Utilisateurs de cette Organisation */}
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                                <h4 style={{ margin: 0, fontSize: 'var(--text-base)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-encre)' }}>
                                  Utilisateurs rattachés ({org.users.length})
                                </h4>
                              </div>

                              {org.users.length === 0 ? (
                                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-2)', fontStyle: 'italic', padding: '12px 0' }}>
                                  Aucun utilisateur enregistré dans cette organisation.
                                </div>
                              ) : (
                                <div style={{ overflowX: 'auto', width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
                                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)', minWidth: '640px' }}>
                                    <thead>
                                      <tr style={{ background: 'var(--color-bg)', borderBottom: '1px solid var(--color-trait)' }}>
                                        <th style={{ textAlign: 'left', padding: '10px 14px', color: 'var(--color-text-2)', fontWeight: 'var(--weight-semibold)', borderRadius: '8px 0 0 8px' }}>Nom</th>
                                        <th style={{ textAlign: 'left', padding: '10px 14px', color: 'var(--color-text-2)', fontWeight: 'var(--weight-semibold)' }}>E-mail</th>
                                        <th style={{ textAlign: 'left', padding: '10px 14px', color: 'var(--color-text-2)', fontWeight: 'var(--weight-semibold)' }}>Rôle</th>
                                        <th style={{ textAlign: 'left', padding: '10px 14px', color: 'var(--color-text-2)', fontWeight: 'var(--weight-semibold)' }}>Agences</th>
                                        <th style={{ textAlign: 'center', padding: '10px 14px', color: 'var(--color-text-2)', fontWeight: 'var(--weight-semibold)' }}>Statut</th>
                                        <th style={{ textAlign: 'right', padding: '10px 14px', color: 'var(--color-text-2)', fontWeight: 'var(--weight-semibold)', borderRadius: '0 8px 8px 0' }}>Dernière activité</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {org.users.map((u) => {
                                        const isCX = codeRole(u.role) === 'cx_manager'; // code, jamais le libellé affiché
                                        return (
                                          <tr key={u.id} style={{ borderBottom: '1px solid var(--color-trait)' }}>
                                            <td style={{ padding: '10px 14px', fontWeight: 'var(--weight-semibold)', color: 'var(--color-encre)' }}>
                                              {u.prenom} {u.nom}
                                            </td>
                                            <td style={{ padding: '10px 14px', color: 'var(--color-text-2)' }}>
                                              {u.email}
                                            </td>
                                            <td style={{ padding: '10px 14px' }}>
                                              <span
                                                style={{
                                                  background: isCX ? 'var(--color-neutre-fond)' : 'var(--color-bon-fond)',
                                                  color: isCX ? 'var(--color-neutre-texte)' : 'var(--color-bon-texte)',
                                                  padding: '2px 8px',
                                                  borderRadius: '9999px',
                                                  fontSize: 'var(--text-xs)',
                                                  fontWeight: 'var(--weight-semibold)',
                                                  border: `1px solid ${isCX ? 'var(--color-neutre-fond)' : 'var(--color-bon-fond)'}`,
                                                }}
                                              >
                                                {libelleRole(u.role)}
                                              </span>
                                            </td>
                                            <td style={{ padding: '10px 14px', color: 'var(--color-text-2)', fontWeight: 'var(--weight-semibold)' }}>
                                              {isCX ? `${u.agences_count} agences` : u.agence_nom || '—'}
                                            </td>
                                            <td style={{ textAlign: 'center', padding: '10px 14px' }}>
                                              <span
                                                style={{
                                                  background: u.active ? 'var(--color-bon-fond)' : 'var(--color-neutre-fond)',
                                                  color: u.active ? 'var(--color-bon-texte)' : 'var(--color-text-2)',
                                                  padding: '2px 8px',
                                                  borderRadius: '9999px',
                                                  fontSize: 'var(--text-xs)',
                                                  fontWeight: 'var(--weight-semibold)',
                                                }}
                                              >
                                                {u.active ? 'Actif' : 'Inactif'}
                                              </span>
                                            </td>
                                            <td style={{ textAlign: 'right', padding: '10px 14px', color: 'var(--color-text-2)', fontSize: 'var(--text-xs)' }}>
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
