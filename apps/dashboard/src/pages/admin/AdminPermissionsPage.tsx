import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { systemApi } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import PageHeader from '../../components/ui/PageHeader';
import { ShieldCheckIcon, BarChartIcon, StoreIcon, UsersIcon, CheckIcon } from '../../components/common/Icons';

interface Permission {
  role: string;
  nom_affichage: string;
  description: string;
  droits: string[];
}

const ROLE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  admin: { bg: '#FEF3C7', text: '#92400E', border: '#FDE68A' },
  cx_manager: { bg: '#E0F2FE', text: '#0369A1', border: '#BAE6FD' },
  agency_manager: { bg: '#EBF5E9', text: '#3C7730', border: '#D5E8D3' },
};

const getRoleIcon = (role: string, size = 22) => {
  switch (role) {
    case 'admin':
      return <ShieldCheckIcon size={size} color="#92400E" />;
    case 'cx_manager':
      return <BarChartIcon size={size} color="#0369A1" />;
    case 'agency_manager':
      return <StoreIcon size={size} color="#3C7730" />;
    default:
      return <UsersIcon size={size} color="#475569" />;
  }
};

export default function AdminPermissionsPage() {
  const currentUser = useAuthStore((s) => s.user);
  if (currentUser?.role !== 'admin') {
    return <Navigate to="/siege" replace />;
  }

  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    systemApi
      .getPermissions()
      .then((r) => {
        setPermissions(r.data);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ color: '#64748B', padding: '32px', fontWeight: 600 }}>Chargement des permissions...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* ── Page Header Standardisé ── */}
      <PageHeader
        title="Rôles & Permissions RBAC"
        subtitle="Matrice complète des droits d'accès et des niveaux de gouvernance de la plateforme IKAN AI."
      />

      {/* ── Bandeaux de Rôles SaaS ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '20px',
        }}
      >
        {permissions.map((p) => {
          const colors = ROLE_COLORS[p.role] || { bg: '#F8FAFB', text: '#475569', border: '#E2E8F0' };
          return (
            <div
              key={p.role}
              style={{
                background: '#FFFFFF',
                border: '1px solid #E8ECE6',
                borderRadius: '24px',
                padding: '24px',
                boxShadow: '0 2px 10px rgba(0,0,0,0.02)',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div
                  style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '14px',
                    background: colors.bg,
                    border: `1px solid ${colors.border}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {getRoleIcon(p.role, 22)}
                </div>
                <div>
                  <div style={{ fontWeight: 800, fontSize: '1.05rem', color: '#02302D' }}>
                    {p.nom_affichage}
                  </div>
                  <div
                    style={{
                      display: 'inline-block',
                      fontSize: '0.7rem',
                      fontWeight: 800,
                      background: colors.bg,
                      color: colors.text,
                      border: `1px solid ${colors.border}`,
                      borderRadius: '9999px',
                      padding: '2px 8px',
                      marginTop: '3px',
                    }}
                  >
                    {p.role.toUpperCase()}
                  </div>
                </div>
              </div>
              <p
                style={{
                  fontSize: '0.84rem',
                  color: '#64748B',
                  margin: 0,
                  lineHeight: 1.4,
                  fontWeight: 500,
                }}
              >
                {p.description}
              </p>
            </div>
          );
        })}
      </div>

      {/* ── Tableau Comparatif des Droits par Rôle ── */}
      <div
        style={{
          background: '#FFFFFF',
          borderRadius: '24px',
          border: '1px solid #E8ECE6',
          boxShadow: '0 2px 10px rgba(0,0,0,0.02)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid #E8ECE6',
            background: '#F8FAFB',
          }}
        >
          <h2 style={{ fontWeight: 800, fontSize: '1.05rem', color: '#02302D', margin: 0 }}>
            Droits d'accès détaillés par rôle
          </h2>
        </div>
        {permissions.map((p, idx) => {
          const colors = ROLE_COLORS[p.role] || { bg: '#F8FAFB', text: '#475569', border: '#E2E8F0' };
          return (
            <div key={p.role} style={{ borderTop: idx > 0 ? '1px solid #F1F4EE' : undefined }}>
              <div
                style={{
                  padding: '16px 24px',
                  background: '#FFFFFF',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  borderBottom: '1px solid #F8FAFB',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  {getRoleIcon(p.role, 18)}
                </div>
                <span style={{ fontWeight: 800, color: '#02302D', fontSize: '0.95rem' }}>
                  {p.nom_affichage}
                </span>
                <span
                  style={{
                    fontSize: '0.68rem',
                    fontWeight: 800,
                    background: colors.bg,
                    color: colors.text,
                    border: `1px solid ${colors.border}`,
                    borderRadius: '9999px',
                    padding: '2px 7px',
                  }}
                >
                  {p.role.toUpperCase()}
                </span>
              </div>
              <div style={{ padding: '16px 24px 20px' }}>
                <ul
                  style={{
                    margin: 0,
                    padding: 0,
                    listStyle: 'none',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                    gap: '10px',
                  }}
                >
                  {p.droits.map((droit, i) => (
                    <li
                      key={i}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontSize: '0.86rem',
                        color: '#1E293B',
                        fontWeight: 500,
                      }}
                    >
                      <CheckIcon size={14} color="#3C7730" strokeWidth={3} />
                      <span>{droit}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Note d'information ── */}
      <div
        style={{
          background: '#FEF3C7',
          border: '1px solid #FDE68A',
          borderRadius: '16px',
          padding: '16px 20px',
          display: 'flex',
          gap: '12px',
          alignItems: 'center',
        }}
      >
        <ShieldCheckIcon size={20} color="#92400E" />
        <div style={{ fontSize: '0.84rem', color: '#92400E', fontWeight: 600 }}>
          <strong>Gouvernance de Sécurité :</strong> Les privilèges RBAC sont centralisés au niveau applicatif.
          Pour toute demande d'attribution personnalisée, contactez le support administrateur IKAN AI.
        </div>
      </div>
    </div>
  );
}
