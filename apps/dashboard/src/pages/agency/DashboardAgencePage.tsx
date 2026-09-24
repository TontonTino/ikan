/**
 * Dashboard d'agence (Agency Manager) — hiérarchie de lecture en 4 niveaux, un <h2> par groupe.
 * Toutes les données sont celles d'UNE seule agence (dashboardApi.agence, recommandationsApi.listAgence,
 * alertes filtrées par rôle côté API — voir verifier_acces_agence).
 *   Niveau 1  Situation de l'agence → « Comment va mon agence ? » (KPI + évolution de la satisfaction)
 *   Niveau 2  Urgent pour l'agence  → « Urgent » (alertes de seuil de satisfaction)
 *   Niveau 3  Compréhension         → « Que disent mes clients ? » (répartition des thèmes)
 *   Niveau 4  Action                → « Actions » (recommandations IA à traiter)
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { dashboardApi, recommandationsApi, alertesApi } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import type { DashboardAgence, Recommandation, Alerte } from '../../types';
import PageHeader from '../../components/ui/PageHeader';
import KpiCard from '../../components/ui/KpiCard';
import EmptyState from '../../components/ui/EmptyState';
import SkeletonBlock from '../../components/ui/SkeletonBlock';
import SectionHeading from '../../components/ui/SectionHeading';
import AlerteRow from '../../components/alerts/AlerteRow';
import EphemeralAlertsBanner from '../../components/alerts/EphemeralAlertsBanner';
import RecommandationCard from '../../components/stats/RecommandationCard';
import { ThumbsUpIcon, ThumbsDownIcon, BarChartIcon, AlertTriangleIcon } from '../../components/common/Icons';

const THEME_COLORS = [
  '#02302D', '#3C7730', '#75B72A', '#BCCF00', '#0284C7',
  '#DC2626', '#8B5CF6', '#F59E0B', '#EC4899', '#06B6D4',
  '#10B981', '#6366F1', '#D97706', '#14B8A6', '#64748B',
];

const cardStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  borderRadius: '24px',
  padding: '24px 28px',
  border: '1px solid var(--color-border)',
  boxShadow: '0 2px 10px rgba(0,0,0,0.02)',
};

export default function DashboardAgencePage() {
  const user = useAuthStore((s) => s.user);
  const [data, setData] = useState<DashboardAgence | null>(null);
  const [alertes, setAlertes] = useState<Alerte[]>([]);
  const [recos, setRecos] = useState<Recommandation[]>([]);
  const [jours, setJours] = useState(30);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');

  const agenceId = user?.agence_id;

  const load = useCallback(() => {
    if (!agenceId) return;
    setLoading(true);
    Promise.all([
      dashboardApi.agence(agenceId, jours),
      recommandationsApi.listAgence(agenceId),
      alertesApi.list(),
    ])
      .then(([d, r, a]) => {
        setData(d.data);
        setRecos(r.data);
        setAlertes(a.data?.alertes_seuil || []);
      })
      .finally(() => setLoading(false));
  }, [agenceId, jours]);

  useEffect(() => {
    load();
  }, [load]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const marquerTraitee = async (id: string) => {
    try {
      await recommandationsApi.marquerTraitee(id);
      setRecos((prev) => prev.filter((r) => r.id !== id));
      showToast('✅ Recommandation marquée comme traitée');
    } catch {
      showToast('❌ Erreur lors de la mise à jour');
    }
  };

  if (!agenceId) {
    return (
      <EmptyState
        title="Aucune agence rattachée à votre compte"
        message="Contactez votre CX Manager pour être rattaché à une agence."
        fullHeight
      />
    );
  }

  // Aucune donnée (échec du chargement) : la structure de la page n'est pas remplacée par un texte brut.
  const loadFailed = !loading && !data;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Toast */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            top: '24px',
            right: '24px',
            zIndex: 1000,
            background: '#02302D',
            color: 'white',
            padding: '12px 20px',
            borderRadius: '12px',
            boxShadow: '0 8px 30px rgba(0,0,0,0.15)',
            fontSize: '0.88rem',
            fontWeight: 700,
          }}
        >
          {toast}
        </div>
      )}

      {/* ── En-tête avec sélecteur de période (toujours affiché, y compris pendant le chargement) ── */}
      <PageHeader
        title={data?.agence_nom ?? user?.agence_nom ?? 'Mon agence'}
        subtitle={`Pilotage opérationnel de votre point de vente — ${jours} derniers jours.`}
      >
        <div
          style={{
            display: 'flex',
            background: '#F1F5F2',
            padding: '3px',
            borderRadius: '12px',
            gap: '2px',
          }}
        >
          {[
            { v: 7, l: '7 jours' },
            { v: 30, l: '30 jours' },
            { v: 90, l: '90 jours' },
          ].map((item) => (
            <button
              key={item.v}
              onClick={() => setJours(item.v)}
              style={{
                background: jours === item.v ? '#FFFFFF' : 'transparent',
                color: jours === item.v ? '#02302D' : '#64748B',
                border: 'none',
                borderRadius: '9px',
                padding: '6px 14px',
                fontSize: '0.8rem',
                fontWeight: jours === item.v ? 700 : 600,
                fontFamily: 'inherit',
                cursor: 'pointer',
                boxShadow: jours === item.v ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              {item.l}
            </button>
          ))}
        </div>
      </PageHeader>

      {/* Alertes éphémères (nouvelles alertes non vues — 15s) */}
      <EphemeralAlertsBanner alerts={alertes} userId={user?.id} />

      {loadFailed && (
        <EmptyState
          illustration="no-data"
          title="Impossible de charger le tableau de bord de l'agence"
          message="Vérifiez votre connexion puis réessayez."
          action={{ label: 'Réessayer', onClick: load }}
        />
      )}

      {/* Squelette : reproduit la structure de la page pendant le premier chargement */}
      {!data && !loadFailed && (
        <div aria-busy="true" aria-label="Chargement du tableau de bord d'agence" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
            {[0, 1, 2, 3].map((i) => (
              <SkeletonBlock key={i} height={84} radius="var(--radius-lg)" />
            ))}
          </div>
          <div style={cardStyle}>
            <SkeletonBlock width="40%" height={18} style={{ marginBottom: 20 }} />
            <SkeletonBlock height={230} radius="var(--radius-lg)" />
          </div>
          <div style={cardStyle}>
            <SkeletonBlock width="30%" height={18} style={{ marginBottom: 20 }} />
            <SkeletonBlock height={120} radius="var(--radius-lg)" />
          </div>
        </div>
      )}

      {/* Pendant une actualisation (changement de période), les données précédentes restent affichées, atténuées. */}
      {data && (
        <div
          aria-busy={loading}
          style={{ display: 'flex', flexDirection: 'column', gap: '28px', opacity: loading ? 0.55 : 1, transition: 'opacity 0.2s ease' }}
        >
          {/* ── Niveau 1 : situation de l'agence ── */}
          <section aria-labelledby="agence-situation" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div id="agence-situation"><SectionHeading>Comment va mon agence ?</SectionHeading></div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
              <KpiCard
                compact
                icon={<ThumbsUpIcon size={14} />}
                label="Satisfaction"
                value={`${data.taux_satisfaction}%`}
                subtitle={`${jours} derniers jours`}
                sparklineType="neutral"
              />
              <KpiCard
                compact
                icon={<BarChartIcon size={14} />}
                label="Avis collectés"
                value={data.nombre_feedbacks}
                subtitle={`${jours} derniers jours`}
                sparklineType="neutral"
              />
              <KpiCard
                compact
                icon={<ThumbsDownIcon size={14} />}
                label="Avis négatifs"
                value={data.nombre_negatifs}
                badgeColor={data.nombre_negatifs > 0 ? 'red' : 'green'}
                subtitle={`${jours} derniers jours`}
                sparklineType="neutral"
              />
              <KpiCard
                compact
                icon={<AlertTriangleIcon size={14} />}
                label="Avis critiques"
                value={data.nombre_critiques}
                badgeColor={data.nombre_critiques > 0 ? 'red' : 'green'}
                subtitle={`${jours} derniers jours`}
                sparklineType="neutral"
              />
            </div>

            {/* Évolution de la satisfaction */}
            <div style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px' }}>
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#02302D' }}>
                  Évolution de la satisfaction de l'agence
                </h3>
                <div
                  style={{
                    background: '#EBF5E9',
                    color: '#3C7730',
                    borderRadius: '9999px',
                    padding: '3px 9px',
                    fontSize: '0.74rem',
                    fontWeight: 700,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <span className="live-dot" />
                  <span>En direct</span>
                </div>
              </div>

              <div style={{ width: '100%', height: 230 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.tendances}>
                    <defs>
                      <linearGradient id="gradAgence" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3C7730" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#3C7730" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#EDF2EC" />
                    <XAxis dataKey="date" tick={{ fill: '#94A3B8', fontSize: 11, fontWeight: 600 }} />
                    <YAxis domain={[0, 100]} tick={{ fill: '#94A3B8', fontSize: 11, fontWeight: 600 }} tickFormatter={(v) => `${v}%`} />
                    <Tooltip formatter={(v: number) => [`${v}%`, 'Satisfaction']} />
                    <Area
                      type="monotone"
                      dataKey="taux"
                      stroke="#3C7730"
                      strokeWidth={2.8}
                      fillOpacity={1}
                      fill="url(#gradAgence)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>

          {/* ── Niveau 2 : urgent pour cette agence ── */}
          <section aria-labelledby="agence-urgent" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div id="agence-urgent"><SectionHeading>Urgent</SectionHeading></div>
            {alertes.length > 0 ? (
              alertes.map((al) => <AlerteRow key={al.agence_id} alerte={al} />)
            ) : (
              <p style={{ margin: 0, fontSize: '0.86rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>
                Votre agence est au-dessus de son seuil d'alerte de satisfaction.
              </p>
            )}
          </section>

          {/* ── Niveau 3 : compréhension ── */}
          <section aria-labelledby="agence-comprehension" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div id="agence-comprehension"><SectionHeading>Que disent mes clients ?</SectionHeading></div>
            <div style={cardStyle}>
              <h3 style={{ margin: '0 0 18px', fontSize: '1.05rem', fontWeight: 800, color: '#02302D' }}>
                Répartition des thèmes
              </h3>
              {data.themes.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '24px', flexWrap: 'wrap' }}>
                  {/* Donut */}
                  <div style={{ flex: '0 0 auto', width: '160px', height: '160px' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={data.themes}
                          dataKey="count"
                          nameKey="theme"
                          cx="50%"
                          cy="50%"
                          innerRadius={42}
                          outerRadius={70}
                          paddingAngle={3}
                        >
                          {data.themes.map((_, i) => (
                            <Cell key={i} fill={THEME_COLORS[i % THEME_COLORS.length]} stroke="#FFFFFF" strokeWidth={2} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v: number, name: string) => [`${v} avis`, name]} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Légende : pastille + catégorie (choisie par le client) + pourcentage */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, minWidth: '200px', maxHeight: '210px', overflowY: 'auto' }}>
                    {data.themes.map((t, i) => (
                      <div
                        key={t.theme}
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '5px 10px', background: '#F8FAFC', borderRadius: '9px' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                          <span
                            style={{
                              width: '8px',
                              height: '8px',
                              borderRadius: '50%',
                              background: THEME_COLORS[i % THEME_COLORS.length],
                              flexShrink: 0,
                            }}
                          />
                          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {t.theme}
                          </span>
                        </div>
                        <strong style={{ fontSize: '0.8rem', color: '#02302D', flexShrink: 0 }}>{t.pourcentage}%</strong>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <EmptyState
                  illustration="no-data"
                  title="Aucune donnée thématique"
                  message="Aucun avis analysé sur cette période."
                />
              )}
            </div>
          </section>

          {/* ── Niveau 4 : actions ── */}
          <section aria-labelledby="agence-actions" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div id="agence-actions"><SectionHeading>Actions</SectionHeading></div>
            <div style={{ ...cardStyle, padding: '26px 28px' }}>
              <div style={{ marginBottom: '18px' }}>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#02302D' }}>
                  Plan d'action & Recommandations IA ({recos.length})
                </h3>
                <p style={{ margin: '3px 0 0', fontSize: '0.84rem', color: '#64748B', fontWeight: 500 }}>
                  Actions concrètes suggérées automatiquement par l'IA pour traiter les points de douleur récurrents.
                </p>
              </div>

              {recos.length === 0 ? (
                <EmptyState
                  illustration="no-alert"
                  title="Aucune recommandation en attente"
                  message="Toutes les actions suggérées ont été traitées."
                />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {recos.map((r) => (
                    <RecommandationCard key={r.id} recommandation={r} onMarquerTraitee={marquerTraitee} />
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
