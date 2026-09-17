import React, { useState } from 'react';
import PageHeader from '../../components/ui/PageHeader';
import TabsNavigation from '../../components/ui/TabsNavigation';
import KpiCard from '../../components/ui/KpiCard';
import {
  CheckCircleIcon,
  SparklesIcon,
  BuildingIcon,
  ClockIcon,
  FileTextIcon,
  DownloadIcon,
} from '../../components/common/Icons';

export default function AbonnementsPage() {
  const [activeTab, setActiveTab] = useState<'forfait' | 'consommation' | 'facturation'>('forfait');

  const tabsConfig = [
    { id: 'forfait', label: 'Mon forfait', icon: <SparklesIcon size={16} color="#75B72A" /> },
    { id: 'consommation', label: 'Consommation & Quotas', icon: <ClockIcon size={16} /> },
    { id: 'facturation', label: 'Facturation & Factures', icon: <FileTextIcon size={16} /> },
  ];

  return (
    <div
      style={{
        padding: '0 36px 48px',
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
      }}
    >
      <PageHeader
        title="Forfait & Abonnements"
        subtitle="Gestion de votre souscription SaaS, quotas d'analyses IA et facturation"
      />

      <TabsNavigation
        tabs={tabsConfig}
        activeTab={activeTab}
        onChange={(id) => setActiveTab(id as any)}
      />

      {/* ── 1. MON FORFAIT ── */}
      {activeTab === 'forfait' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '1000px' }}>
          <div
            style={{
              background: 'linear-gradient(135deg, #02302D 0%, #0F4C47 100%)',
              color: '#FFFFFF',
              borderRadius: '24px',
              padding: '32px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '20px',
            }}
          >
            <div>
              <span style={{ background: '#75B72A', color: '#02302D', padding: '4px 12px', borderRadius: '9999px', fontSize: '0.74rem', fontWeight: 800 }}>
                FORFAIT ACTIF
              </span>
              <h2 style={{ fontSize: '1.8rem', fontWeight: 800, margin: '12px 0 6px' }}>
                IKAN Enterprise Network
              </h2>
              <p style={{ margin: 0, fontSize: '0.88rem', color: '#E2F2E5' }}>
                Accès illimité pour toutes vos agences avec analyses NLP en temps réel et alertes automatiques.
              </p>
            </div>

            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '2rem', fontWeight: 800 }}>Sur mesure</div>
              <div style={{ fontSize: '0.78rem', color: '#94A3B8' }}>Renouvellement annuel</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
            <div style={{ background: '#FFFFFF', borderRadius: '20px', padding: '20px', border: '1px solid #E8ECE6' }}>
              <div style={{ fontSize: '0.80rem', fontWeight: 700, color: '#64748B' }}>Agences incluses</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#02302D', marginTop: '4px' }}>Illimité</div>
            </div>
            <div style={{ background: '#FFFFFF', borderRadius: '20px', padding: '20px', border: '1px solid #E8ECE6' }}>
              <div style={{ fontSize: '0.80rem', fontWeight: 700, color: '#64748B' }}>Analyses IA mensuelles</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#02302D', marginTop: '4px' }}>50 000 / mois</div>
            </div>
            <div style={{ background: '#FFFFFF', borderRadius: '20px', padding: '20px', border: '1px solid #E8ECE6' }}>
              <div style={{ fontSize: '0.80rem', fontWeight: 700, color: '#64748B' }}>Support dédié</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#3C7730', marginTop: '4px' }}>24/7 Premium</div>
            </div>
          </div>
        </div>
      )}

      {/* ── 2. CONSOMMATION & QUOTAS ── */}
      {activeTab === 'consommation' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '1000px' }}>
          <div style={{ background: '#FFFFFF', borderRadius: '24px', padding: '24px 28px', border: '1px solid #E8ECE6' }}>
            <h3 style={{ margin: '0 0 4px', fontSize: '1.05rem', fontWeight: 800, color: '#02302D' }}>
              Suivi de la Consommation IA du Mois
            </h3>
            <p style={{ margin: '0 0 20px', fontSize: '0.80rem', color: '#64748B' }}>
              Usage des inférences sémantiques et de classification
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.84rem', fontWeight: 700, marginBottom: '6px' }}>
                  <span>Analyses de feedbacks (4 250 / 50 000)</span>
                  <span style={{ color: '#3C7730' }}>8.5%</span>
                </div>
                <div style={{ height: '8px', background: '#F1F5F9', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: '8.5%', background: '#3C7730', borderRadius: '4px' }} />
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.84rem', fontWeight: 700, marginBottom: '6px' }}>
                  <span>Questions posées au Copilot IA (120 / 1 000)</span>
                  <span style={{ color: '#02302D' }}>12%</span>
                </div>
                <div style={{ height: '8px', background: '#F1F5F9', borderRadius: '4px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: '12%', background: '#02302D', borderRadius: '4px' }} />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 3. FACTURATION & HISTORIQUE ── */}
      {activeTab === 'facturation' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '1000px' }}>
          <div style={{ background: '#FFFFFF', borderRadius: '24px', padding: '24px 28px', border: '1px solid #E8ECE6' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: '1.05rem', fontWeight: 800, color: '#02302D' }}>
              Historique des Factures
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[
                { date: '01 Août 2026', ref: 'FACT-2026-08', montant: '1 250,000 TND', statut: 'Payée' },
                { date: '01 Juillet 2026', ref: 'FACT-2026-07', montant: '1 250,000 TND', statut: 'Payée' },
                { date: '01 Juin 2026', ref: 'FACT-2026-06', montant: '1 250,000 TND', statut: 'Payée' },
              ].map((f) => (
                <div
                  key={f.ref}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '14px 18px',
                    background: '#F8FAFC',
                    borderRadius: '14px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <FileTextIcon size={18} color="#3C7730" />
                    <div>
                      <strong style={{ fontSize: '0.86rem', color: '#02302D' }}>{f.ref}</strong>
                      <div style={{ fontSize: '0.74rem', color: '#64748B' }}>Émise le {f.date}</div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <span style={{ fontWeight: 800, fontSize: '0.90rem', color: '#02302D' }}>{f.montant}</span>
                    <span style={{ background: '#EBF6ED', color: '#3C7730', padding: '3px 8px', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 800 }}>
                      {f.statut}
                    </span>
                    <button
                      type="button"
                      style={{
                        background: '#FFFFFF',
                        border: '1px solid #E2E8F0',
                        borderRadius: '8px',
                        padding: '6px 10px',
                        fontSize: '0.76rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      <DownloadIcon size={12} /> PDF
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
