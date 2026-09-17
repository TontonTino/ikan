import React, { useEffect, useState } from 'react';
import { alertesApi } from '../../services/api';
import type { Alerte } from '../../types';
import PageHeader from '../../components/ui/PageHeader';
import { AlertTriangleIcon, CheckCircleIcon } from '../../components/common/Icons';

export default function AlertesPage() {
  const [alertes, setAlertes] = useState<Alerte[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    alertesApi
      .list()
      .then((r) => {
        setAlertes(r.data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ color: '#64748B', padding: '32px', fontWeight: 600 }}>Chargement des alertes...</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* ── Page Header Standardisé ── */}
      <PageHeader
        title={`Alertes de satisfaction (${alertes.length})`}
        subtitle="Agences nécessitant une intervention suite au franchissement des seuils d'insatisfaction."
      />

      {alertes.length === 0 ? (
        <div
          style={{
            background: '#EBF5E9',
            border: '1px solid #D5E8D3',
            borderRadius: '24px',
            padding: '32px',
            color: '#3C7730',
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
          }}
        >
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '14px',
              background: '#FFFFFF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <CheckCircleIcon size={24} color="#3C7730" />
          </div>
          <div>
            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#02302D' }}>
              Aucune alerte critique active
            </div>
            <p style={{ margin: '4px 0 0', fontSize: '0.88rem', color: '#166534' }}>
              Toutes les agences du réseau maintiennent un taux de satisfaction supérieur à leurs seuils d'alerte.
            </p>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {alertes.map((a, i) => (
            <div
              key={i}
              style={{
                background: '#FFFFFF',
                border: '1px solid #E8ECE6',
                borderLeft: '6px solid #DC2626',
                borderRadius: '24px',
                padding: '22px 26px',
                boxShadow: '0 2px 10px rgba(0,0,0,0.02)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '8px',
                  flexWrap: 'wrap',
                  gap: '10px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <AlertTriangleIcon size={20} color="#DC2626" />
                  <h3 style={{ fontWeight: 800, color: '#02302D', margin: 0, fontSize: '1rem' }}>
                    {a.agence_nom}
                  </h3>
                </div>
                <span
                  style={{
                    background: '#FEE2E2',
                    color: '#DC2626',
                    padding: '4px 12px',
                    borderRadius: '9999px',
                    fontSize: '0.78rem',
                    fontWeight: 800,
                  }}
                >
                  Taux actuel : {a.taux_actuel}% / Seuil {a.seuil}%
                </span>
              </div>
              <p style={{ color: '#64748B', fontSize: '0.9rem', margin: 0, lineHeight: 1.5 }}>
                {a.message}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
