/**
 * Vue Siège (CX Manager) — hiérarchie de lecture en 4 niveaux, un <h2> par groupe :
 *   Niveau 1  Situation globale  → « Comment vont nos clients ? » (onglet Vue d'ensemble :
 *             KPI de tête + évolution du CSAT)
 *   Niveau 2  Attention          → « Urgent » (résumé des alertes en Vue d'ensemble,
 *             détail dans l'onglet Alertes)
 *   Niveau 3  Compréhension      → « Que disent nos clients ? » (onglet Performance CX :
 *             sentiments, thèmes) et « Où sont les problèmes ? » (onglet Agences)
 *   Niveau 4  Action             → non présent sur cette page : aucune donnée d'actions
 *             (recommandations créées/en cours/résolues) n'est chargée ici, elles vivent
 *             dans Pilotage (recommandationsApi).
 */
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { MapPin } from '@phosphor-icons/react';
import { pinIcon } from '../../components/map/pinIcon';
import 'leaflet/dist/leaflet.css';
import { dashboardApi, alertesApi } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import type { DashboardSiege, Alerte } from '../../types';
import TabsNavigation from '../../components/ui/TabsNavigation';
import KpiCard from '../../components/ui/KpiCard';
import EmptyState from '../../components/ui/EmptyState';
import SkeletonBlock from '../../components/ui/SkeletonBlock';
import SectionHeading from '../../components/ui/SectionHeading';
import AlerteRow from '../../components/alerts/AlerteRow';
import EphemeralAlertsBanner from '../../components/alerts/EphemeralAlertsBanner';
import {
  StoreIcon,
  LightbulbIcon,
  AlertTriangleIcon,
  TrendingUpIcon,
  CheckCircleIcon,
  MapIcon,
  BarChartIcon,
  ClockIcon,
  ThumbsUpIcon,
  ThumbsDownIcon,
  ArrowUpRightIcon,
  ArrowDownRightIcon,
  TargetIcon,
  BellIcon,
} from '../../components/common/Icons';

// ── Types enrichis ─────────────────────────────────────
interface ThemeStats {
  theme: string;
  count: number;
  pourcentage: number;
}
interface SentimentStats {
  sentiment: string;
  count: number;
  pourcentage: number;
}
interface DashboardSiegeFull extends DashboardSiege {
  themes_globaux: ThemeStats[];
  sentiments_globaux: SentimentStats[];
  nombre_discordances: number;
  nombre_critiques: number;
}

// ── Constantes Design ──────────────────────────────────
const SENTIMENT_COLORS: Record<string, string> = {
  positif: '#3C7730',
  neutre: '#F59E0B',
  negatif: '#DC2626',
};

const THEME_LABELS: Record<string, string> = {
  attente: "Attente & Délais en caisse",
  accueil: "Accueil & Courtoisie conseillers",
  disponibilite_accessibilite: "Accessibilité & Horaires d'ouverture",
  tarifs: "Tarifs & Transparence offres",
  qualite_produit: "Qualité Réseau & Forfaits",
  proprete_cadre: "Propreté & Cadre agence",
  application_mobile: "Application Mobile & E-espace",
  reseau: "Couverture 4G/5G & Fibre",
  facturation: "Facturation & Prélèvements",
  communication_information: "Conseils & Clarté information",
  livraison_logistique: "Disponibilité Cartes SIM / Box",
  resolution_probleme: "Service Client & SAV",
  securite_confidentialite: "Sécurité & Confidentialité",
  disponibilite_produit: "Stock Terminaux & Accessoires",
  personnalisation_besoin: "Écoute & Personnalisation",
};

const AGENCE_COLOR = (taux: number) =>
  taux >= 80 ? '#3C7730' : taux >= 60 ? '#F59E0B' : '#DC2626';

// ── Section Card Moderne ────────────────────────────────
function SectionCard({
  title,
  subtitle,
  children,
  action,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: '#FFFFFF',
        borderRadius: '24px',
        padding: '24px 28px',
        boxShadow: '0 2px 12px rgba(20, 60, 40, 0.03)',
        border: '1px solid #E8ECE6',
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
        transition: 'box-shadow 0.2s ease, border-color 0.2s ease',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '18px',
          flexWrap: 'wrap',
          gap: '10px',
        }}
      >
        <div>
          <h3
            style={{
              margin: 0,
              fontSize: '1.05rem',
              fontWeight: 800,
              color: '#02302D',
            }}
          >
            {title}
          </h3>
          {subtitle && (
            <p style={{ margin: '3px 0 0', fontSize: '0.82rem', color: '#64748B', fontWeight: 500 }}>
              {subtitle}
            </p>
          )}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

// ── Squelette de chargement : reproduit la structure de chaque onglet ──
function SiegeSkeleton({ tab }: { tab: 'overview' | 'performance' | 'agences' | 'alertes' }) {
  const card = (h: number) => (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: '24px',
        padding: '24px 28px',
      }}
    >
      <SkeletonBlock width="35%" height={18} style={{ marginBottom: 8 }} />
      <SkeletonBlock width="55%" height={12} style={{ marginBottom: 20 }} />
      <SkeletonBlock height={h} radius="var(--radius-lg)" />
    </div>
  );
  return (
    <div aria-busy="true" aria-label="Chargement des données du réseau" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {tab === 'overview' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
            <SkeletonBlock height={84} radius="var(--radius-lg)" />
            <SkeletonBlock height={84} radius="var(--radius-lg)" />
            <SkeletonBlock height={84} radius="var(--radius-lg)" />
          </div>
          {card(260)}
          {card(90)}
        </>
      )}
      {tab === 'performance' && (
        <>
          {card(180)}
          {card(200)}
        </>
      )}
      {tab === 'agences' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
            <SkeletonBlock height={140} radius="var(--radius-xl)" />
            <SkeletonBlock height={140} radius="var(--radius-xl)" />
          </div>
          {card(420)}
        </>
      )}
      {tab === 'alertes' && card(220)}
    </div>
  );
}

// ── Tooltip personnalisé Recharts ───────────────────────
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: '#02302D',
        borderRadius: '12px',
        padding: '12px 16px',
        boxShadow: '0 8px 24px rgba(2, 48, 45, 0.25)',
        fontSize: '0.84rem',
        color: '#FFFFFF',
      }}
    >
      <p style={{ fontWeight: 800, marginBottom: '6px', color: '#E2F2E5' }}>{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color || '#75B72A', margin: '2px 0', fontWeight: 600 }}>
          {p.name} : <strong>{p.value}{typeof p.value === 'number' && p.name.toLowerCase().includes('satisfaction') || p.name.toLowerCase().includes('csat') ? '%' : ''}</strong>
        </p>
      ))}
    </div>
  );
};

export default function DashboardSiegePage() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const voirAgence = (agenceId: string) => navigate(`/agences/${agenceId}/apercu`);
  const [data, setData] = useState<DashboardSiegeFull | null>(null);
  const [alertes, setAlertes] = useState<Alerte[]>([]);
  const [jours, setJours] = useState(30);
  const [loading, setLoading] = useState(true);
  
  // 4 Onglets Spécifiés pour /siege
  const [activeTab, setActiveTab] = useState<'overview' | 'performance' | 'agences' | 'alertes'>('overview');

  const formattedDate = useMemo(() => {
    try {
      const now = new Date();
      return now.toLocaleDateString('fr-FR', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }).toUpperCase();
    } catch {
      return 'AUJOURD\'HUI';
    }
  }, []);

  const userName = user
    ? `${user.prenom || ''} ${user.nom || ''}`.trim() || 'Responsable CX'
    : 'Responsable CX';

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([dashboardApi.siege(jours), alertesApi.list()])
      .then(([d, a]) => {
        setData(d.data as DashboardSiegeFull);
        setAlertes(a.data?.alertes_seuil || []);
      })
      .finally(() => setLoading(false));
  }, [jours]);

  useEffect(() => {
    load();
  }, [load]);

  // Aucune donnée (échec du chargement) : la structure de la page n'est pas remplacée par un texte brut.
  const loadFailed = !loading && !data;

  // Calculs & métriques dérivées
  const agences = data?.agences ?? [];
  const agencesAvecCoords = agences.filter((a) => a.latitude && a.longitude);
  const centerLat = agencesAvecCoords.length > 0
    ? agencesAvecCoords.reduce((s, a) => s + (a.latitude || 0), 0) / agencesAvecCoords.length
    : 34.0;
  const centerLng = agencesAvecCoords.length > 0
    ? agencesAvecCoords.reduce((s, a) => s + (a.longitude || 0), 0) / agencesAvecCoords.length
    : 9.0;

  // Top & Flop agences
  const sortedAgences = [...agences].sort((a, b) => b.wilson_score - a.wilson_score);
  const topAgences = sortedAgences.slice(0, 3);
  const flopAgences = sortedAgences.slice(-3).reverse();

  const tabsConfig = [
    { id: 'overview', label: "Vue d'ensemble", icon: <TrendingUpIcon size={16} /> },
    { id: 'performance', label: 'Performance CX', icon: <BarChartIcon size={16} /> },
    { id: 'agences', label: 'Agences', icon: <StoreIcon size={16} />, badge: data ? agences.length : undefined },
    {
      id: 'alertes',
      label: 'Alertes',
      icon: <BellIcon size={16} />,
      badge: alertes.length,
      badgeColor: alertes.length > 0 ? ('red' as const) : ('default' as const),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
      
      {/* ── 1. Bannière d'En-tête Unifiée ── */}
      <div
        style={{
          background: 'linear-gradient(135deg, #F4FAF5 0%, #EBF6ED 100%)',
          borderRadius: '24px',
          border: '1px solid #D6E8D9',
          boxShadow: '0 4px 20px rgba(2, 48, 45, 0.04)',
          padding: '24px 32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          position: 'relative',
          overflow: 'hidden',
          gap: '24px',
          width: '100%',
          maxWidth: '100%',
          minWidth: 0,
          boxSizing: 'border-box',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ zIndex: 2, maxWidth: '580px', minWidth: 0, flex: '1 1 320px' }}>
          <div
            style={{
              fontSize: '0.74rem',
              fontWeight: 800,
              color: '#4B7B47',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              marginBottom: '6px',
            }}
          >
            {formattedDate}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h1
              style={{
                fontSize: '1.8rem',
                fontWeight: 800,
                color: '#02302D',
                margin: 0,
                letterSpacing: '-0.02em',
                lineHeight: 1.2,
              }}
            >
              Bonjour {userName}
            </h1>
          </div>

          <p
            style={{
              color: '#526E60',
              fontSize: '0.88rem',
              marginTop: '6px',
              marginBottom: 0,
              fontWeight: 500,
            }}
          >
            Supervision de l'expérience client et pilotage des agences en temps réel.
          </p>
        </div>

        {/* Côté Droit : Contrôles */}
        <div
          style={{
            zIndex: 2,
            display: 'flex',
            alignItems: 'center',
            gap: '20px',
            flexWrap: 'wrap',
            justifyContent: 'flex-end',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '10px' }}>
            <button
              onClick={load}
              title="Actualiser les données"
              style={{
                background: '#FFFFFF',
                border: '1px solid #D5E8D3',
                borderRadius: '9999px',
                padding: '6px 14px',
                fontSize: '0.76rem',
                color: '#3C7730',
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <ClockIcon size={13} color="#3C7730" />
              <span>Mis à jour <strong>à l'instant</strong></span>
            </button>

            {/* Sélecteur de période */}
            <div
              style={{
                display: 'flex',
                background: 'rgba(255, 255, 255, 0.9)',
                padding: '3px',
                borderRadius: '12px',
                gap: '2px',
                border: '1px solid #D5E8D3',
              }}
            >
              {[
                { v: 7, l: '7 jours' },
                { v: 30, l: '30 jours' },
                { v: 90, l: '90 jours' },
                { v: 365, l: '12 mois' },
              ].map((item) => (
                <button
                  key={item.v}
                  onClick={() => setJours(item.v)}
                  style={{
                    background: jours === item.v ? '#FFFFFF' : 'transparent',
                    color: jours === item.v ? '#02302D' : '#64748B',
                    border: 'none',
                    borderRadius: '9px',
                    padding: '5px 11px',
                    fontSize: '0.76rem',
                    fontWeight: jours === item.v ? 800 : 600,
                    fontFamily: 'inherit',
                    cursor: 'pointer',
                  }}
                >
                  {item.l}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── 2. Alertes Réseau Éphémères ── */}
      <EphemeralAlertsBanner alerts={alertes} userId={user?.id} />

      {/* ── 3. Navigation par Onglets Spécialisés ── */}
      <TabsNavigation
        tabs={tabsConfig}
        activeTab={activeTab}
        onChange={(id) => setActiveTab(id as any)}
      />

      {loadFailed && (
        <EmptyState
          illustration="no-data"
          title="Impossible de charger les données du réseau"
          message="Vérifiez votre connexion puis réessayez."
          action={{ label: 'Réessayer', onClick: load }}
        />
      )}
      {!data && !loadFailed && <SiegeSkeleton tab={activeTab} />}

      {/* Pendant une actualisation (changement de période), les données précédentes restent affichées, atténuées. */}
      {data && (
      <div aria-busy={loading} style={{ display: 'flex', flexDirection: 'column', gap: '20px', opacity: loading ? 0.55 : 1, transition: 'opacity 0.2s ease' }}>
      {/* ══════════════════════════════════════════════════════
          ONGLET 1 : VUE D'ENSEMBLE — niveau 1 (situation) puis niveau 2 (urgent)
      ══════════════════════════════════════════════════════ */}
      {activeTab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
          <section aria-labelledby="siege-situation" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div id="siege-situation"><SectionHeading>Comment vont nos clients ?</SectionHeading></div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
              <KpiCard
                compact
                icon={<ThumbsUpIcon size={14} />}
                label="Satisfaction réseau"
                value={`${data.taux_satisfaction_global}%`}
                trend={data.evolution_satisfaction ? { value: data.evolution_satisfaction, isPositive: data.evolution_satisfaction_positive, period: 'vs. période précédente' } : undefined}
                sparklineType={data.evolution_satisfaction_positive === false ? 'down' : 'up'}
              />
              <KpiCard
                compact
                icon={<BarChartIcon size={14} />}
                label="Avis collectés"
                value={data.feedbacks_total}
                trend={data.evolution_feedbacks_total ? { value: data.evolution_feedbacks_total, isPositive: data.evolution_feedbacks_total_positive, period: 'vs. période précédente' } : undefined}
                sparklineType="neutral"
              />
              <KpiCard
                compact
                icon={<AlertTriangleIcon size={14} />}
                label="Avis critiques"
                value={data.nombre_critiques}
                badgeColor={data.nombre_critiques > 0 ? 'red' : 'green'}
                subtitle="sur la période"
                sparklineType="neutral"
              />
            </div>

          {/* Graphique Unique d'Évolution CSAT */}
          <SectionCard
            title="Évolution du CSAT Réseau"
            subtitle="Tendance globale de satisfaction client sur la période sélectionnée"
          >
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.tendances}>
                  <defs>
                    <linearGradient id="csatGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3C7730" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#3C7730" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#EDF2EC" />
                  <XAxis dataKey="date" tick={{ fill: '#94A3B8', fontSize: 11, fontWeight: 600 }} />
                  <YAxis domain={[0, 100]} tick={{ fill: '#94A3B8', fontSize: 11, fontWeight: 600 }} tickFormatter={(v) => `${v}%`} />
                  <Tooltip content={<CustomTooltip />} />
                  <Line type="monotone" dataKey="taux" name="Satisfaction" stroke="#3C7730" strokeWidth={3} dot={{ r: 4, fill: '#3C7730' }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>

          {/* Résumé Exécutif Compact du Réseau */}
          <div
            style={{
              background: '#FFFFFF',
              borderRadius: '20px',
              padding: '20px 24px',
              border: '1px solid #E8ECE6',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: '16px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: '#EBF6ED', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3C7730' }}>
                <StoreIcon size={20} />
              </div>
              <div>
                <div style={{ fontSize: '0.76rem', color: '#64748B', fontWeight: 600 }}>Réseau Connecté</div>
                <div style={{ fontSize: '1rem', fontWeight: 800, color: '#02302D' }}>
                  {data.agences_actives} / {data.agences.length} agences actives
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: '#FEF3C7', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#D97706' }}>
                <LightbulbIcon size={20} />
              </div>
              <div>
                <div style={{ fontSize: '0.76rem', color: '#64748B', fontWeight: 600 }}>Boîte à Idées</div>
                <div style={{ fontSize: '1rem', fontWeight: 800, color: '#02302D' }}>
                  {data.idees_en_attente} suggestions clients
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: '#EFF6FF', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#2563EB' }}>
                <CheckCircleIcon size={20} />
              </div>
              <div>
                <div style={{ fontSize: '0.76rem', color: '#64748B', fontWeight: 600 }}>Moteur IA NLP</div>
                <div style={{ fontSize: '1rem', fontWeight: 800, color: '#02302D' }}>
                  {data.nombre_discordances} discordances signalées
                </div>
              </div>
            </div>
          </div>
          </section>

          <section aria-labelledby="siege-urgent" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div id="siege-urgent"><SectionHeading>Urgent</SectionHeading></div>
            {alertes.length > 0 ? (
              <>
                {alertes.slice(0, 3).map((al) => (
                  <AlerteRow key={al.agence_id} alerte={al} />
                ))}
                <button
                  type="button"
                  onClick={() => setActiveTab('alertes')}
                  style={{ alignSelf: 'flex-start', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.84rem', fontWeight: 700, color: 'var(--color-primary)' }}
                >
                  {alertes.length > 3 ? `Voir les ${alertes.length} alertes →` : 'Voir le détail des alertes →'}
                </button>
              </>
            ) : (
              <p style={{ margin: 0, fontSize: '0.86rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>
                Aucune agence sous son seuil d'alerte de satisfaction.
              </p>
            )}
          </section>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          ONGLET 2 : PERFORMANCE CX (Analyses Approfondies)
      ══════════════════════════════════════════════════════ */}
      {activeTab === 'performance' && (
        <section aria-labelledby="siege-comprehension" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div id="siege-comprehension"><SectionHeading>Que disent nos clients ?</SectionHeading></div>
          {/* Row 1: Sentiments (l'évolution temporelle du CSAT est dans Statistiques & Analyses) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))', gap: '20px' }}>
            {/* Répartition des Sentiments */}
            <SectionCard title="Distribution des Sentiments" subtitle="Classification émotionnelle par le modèle IA">
              {data.sentiments_globaux.length > 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '20px', flexWrap: 'wrap' }}>
                  <div style={{ width: '180px', height: 180 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={data.sentiments_globaux}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={75}
                          dataKey="count"
                          nameKey="sentiment"
                          paddingAngle={3}
                        >
                          {data.sentiments_globaux.map((entry) => (
                            <Cell key={entry.sentiment} fill={SENTIMENT_COLORS[entry.sentiment] || '#94A3B8'} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v: number, name: string) => [`${v} avis`, name]} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, minWidth: '160px' }}>
                    {data.sentiments_globaux.map((s) => (
                      <div
                        key={s.sentiment}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 12px',
                          borderRadius: '10px',
                          background: `${SENTIMENT_COLORS[s.sentiment] || '#94A3B8'}12`,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: SENTIMENT_COLORS[s.sentiment] || '#94A3B8' }} />
                          <span style={{ textTransform: 'capitalize', fontSize: '0.82rem', fontWeight: 700, color: '#0F172A' }}>
                            {s.sentiment}
                          </span>
                        </div>
                        <span style={{ fontWeight: 800, fontSize: '0.86rem', color: SENTIMENT_COLORS[s.sentiment] || '#02302D' }}>
                          {s.pourcentage}% ({s.count})
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', color: '#94A3B8', paddingTop: '40px' }}>
                  Pas encore de données.
                </div>
              )}
            </SectionCard>
          </div>

          {/* Row 2: Top 5 Pain Points & Thèmes IA */}
          <SectionCard
            title="Thématiques & Pain Points Majeurs"
            subtitle="Extraction sémantique automatique des points d'attention"
          >
            {data.themes_globaux.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '14px' }}>
                {data.themes_globaux.slice(0, 6).map((t, i) => (
                  <div
                    key={t.theme}
                    style={{
                      background: '#F8FAFC',
                      border: '1px solid #E2E8F0',
                      borderRadius: '16px',
                      padding: '14px 16px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <span style={{ fontWeight: 700, color: '#02302D', fontSize: '0.84rem' }}>
                        {THEME_LABELS[t.theme] || t.theme}
                      </span>
                      <span style={{ color: '#64748B', fontWeight: 800, fontSize: '0.82rem' }}>
                        {t.pourcentage}%
                      </span>
                    </div>
                    <div style={{ height: '6px', background: '#E2E8F0', borderRadius: '4px', overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          background: i === 0 ? '#DC2626' : i === 1 ? '#D97706' : '#3C7730',
                          width: `${t.pourcentage}%`,
                          borderRadius: '4px',
                        }}
                      />
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: '6px' }}>
                      {t.count} retours enregistrés
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ textAlign: 'center', color: '#94A3B8', padding: '40px 0' }}>
                Pas de thèmes détectés pour cette période.
              </div>
            )}
          </SectionCard>
        </section>
      )}

      {/* ══════════════════════════════════════════════════════
          ONGLET 3 : AGENCES (Cartographie & Benchmark Réseau)
      ══════════════════════════════════════════════════════ */}
      {activeTab === 'agences' && (
        <section aria-labelledby="siege-agences" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div id="siege-agences"><SectionHeading>Où sont les problèmes ?</SectionHeading></div>
          {/* Top & Flop Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
            <div
              style={{
                background: '#FFFFFF',
                borderRadius: '20px',
                padding: '20px 24px',
                border: '1px solid #D6E8D9',
                boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <ThumbsUpIcon size={16} color="#3C7730" />
                <h3 style={{ margin: 0, fontWeight: 800, fontSize: '0.90rem', color: '#02302D' }}>
                  Top 3 Agences — Satisfaction
                </h3>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {topAgences.map((ag, idx) => (
                  <div
                    key={ag.agence_id}
                    onClick={() => voirAgence(ag.agence_id)}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: '#F8FAFC', borderRadius: '10px', cursor: 'pointer' }}
                  >
                    <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#0F172A' }}>
                      #{idx + 1} {ag.agence_nom}
                    </span>
                    <strong style={{ color: '#3C7730', fontSize: '0.84rem' }}>{ag.taux_satisfaction}%</strong>
                  </div>
                ))}
              </div>
            </div>

            <div
              style={{
                background: '#FFFFFF',
                borderRadius: '20px',
                padding: '20px 24px',
                border: '1px solid #FECACA',
                boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <ThumbsDownIcon size={16} color="#DC2626" />
                <h3 style={{ margin: 0, fontWeight: 800, fontSize: '0.90rem', color: '#02302D' }}>
                  Agences à surveiller
                </h3>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {flopAgences.map((ag) => (
                  <div
                    key={ag.agence_id}
                    onClick={() => voirAgence(ag.agence_id)}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: '#FFF7F7', borderRadius: '10px', cursor: 'pointer' }}
                  >
                    <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#0F172A' }}>
                      {ag.agence_nom}
                    </span>
                    <strong style={{ color: '#DC2626', fontSize: '0.84rem' }}>{ag.taux_satisfaction}%</strong>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Carte Interactive */}
          <SectionCard
            title="Cartographie Géographique du Réseau"
            subtitle="Localisation des agences avec code couleur selon le niveau de satisfaction"
          >
            {agencesAvecCoords.length > 0 ? (
              <>
                <div style={{ borderRadius: '16px', overflow: 'hidden', border: '1px solid #E8ECE6' }}>
                  <MapContainer center={[centerLat, centerLng]} zoom={7} style={{ height: '420px', width: '100%' }}>
                    <TileLayer
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                      attribution='&copy; OpenStreetMap'
                    />
                    {agencesAvecCoords.map((a) => (
                      <Marker
                        key={a.agence_id}
                        position={[a.latitude!, a.longitude!]}
                        icon={pinIcon(AGENCE_COLOR(a.taux_satisfaction))}
                        title={a.agence_nom}
                      >
                        <Popup>
                          <div style={{ minWidth: '160px' }}>
                            <strong style={{ color: '#02302D' }}>{a.agence_nom}</strong>
                            <div style={{ fontSize: '0.78rem', color: '#64748B' }}>{a.ville}</div>
                            <div style={{ marginTop: '6px', fontSize: '0.80rem' }}>
                              Satisfaction : <strong style={{ color: AGENCE_COLOR(a.taux_satisfaction) }}>{a.taux_satisfaction}%</strong>
                            </div>
                            <div style={{ fontSize: '0.78rem' }}>Avis : {a.nombre_feedbacks}</div>
                            <button
                              type="button"
                              onClick={() => voirAgence(a.agence_id)}
                              style={{ marginTop: '8px', background: '#02302D', color: '#FFFFFF', border: 'none', borderRadius: '8px', padding: '5px 10px', fontSize: '0.76rem', fontWeight: 700, cursor: 'pointer' }}
                            >
                              Voir l'agence
                            </button>
                          </div>
                        </Popup>
                      </Marker>
                    ))}
                  </MapContainer>
                </div>
                <div style={{ display: 'flex', gap: '20px', justifyContent: 'center', marginTop: '14px', flexWrap: 'wrap' }}>
                  {[
                    { color: '#3C7730', label: '≥ 80% — Excellent' },
                    { color: '#F59E0B', label: '60-80% — À surveiller' },
                    { color: '#DC2626', label: '< 60% — Critique' },
                  ].map(({ color, label }) => (
                    <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '0.80rem', fontWeight: 600 }}>
                      <MapPin size={18} weight="fill" color={color} aria-hidden="true" />
                      {label}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: '60px 0', color: '#94A3B8' }}>
                Aucune coordonnée géographique disponible.
              </div>
            )}
          </SectionCard>

          {/* Tableau Répertoire et Benchmark */}
          <SectionCard title="Classement et Métriques par Agence" subtitle="Performances opérationnelles détaillées">
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #E8ECE6', background: '#F8FAFB' }}>
                    {['Agence', 'Ville', 'Avis', 'Satisfaction', 'Avis Négatifs', 'Suggestions'].map((h) => (
                      <th
                        key={h}
                        style={{
                          textAlign: h === 'Agence' || h === 'Ville' ? 'left' : 'right',
                          padding: '12px 14px',
                          color: '#64748B',
                          fontWeight: 700,
                          fontSize: '0.76rem',
                          textTransform: 'uppercase',
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.agences.map((a) => (
                    <tr
                      key={a.agence_id}
                      onClick={() => voirAgence(a.agence_id)}
                      style={{ borderBottom: '1px solid #F1F4EE', cursor: 'pointer' }}
                    >
                      <td style={{ padding: '12px 14px', fontWeight: 700, color: '#02302D' }}>{a.agence_nom}</td>
                      <td style={{ padding: '12px 14px', color: '#64748B' }}>{a.ville || '—'}</td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 700 }}>{a.nombre_feedbacks}</td>
                      <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                        <span
                          style={{
                            fontWeight: 800,
                            color: AGENCE_COLOR(a.taux_satisfaction),
                            background: `${AGENCE_COLOR(a.taux_satisfaction)}15`,
                            padding: '3px 8px',
                            borderRadius: '9999px',
                          }}
                        >
                          {a.taux_satisfaction}%
                        </span>
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', color: '#DC2626', fontWeight: 700 }}>
                        {a.nombre_negatifs}
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', color: '#0369A1', fontWeight: 700 }}>
                        {a.nombre_suggestions}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </section>
      )}

      {/* ══════════════════════════════════════════════════════
          ONGLET 4 : ALERTES — détail du niveau 2 (seuil de satisfaction par agence)
      ══════════════════════════════════════════════════════ */}
      {activeTab === 'alertes' && (
        <section aria-labelledby="siege-alertes" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div id="siege-alertes"><SectionHeading>Urgent</SectionHeading></div>
          <SectionCard
            title="Agences sous leur seuil d'alerte"
            subtitle="Satisfaction de la semaine inférieure au seuil configuré pour l'agence"
          >
            {alertes.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {alertes.map((al) => (
                  <AlerteRow key={al.agence_id} alerte={al} />
                ))}
              </div>
            ) : (
              <EmptyState
                illustration="no-alert"
                title="Aucune agence sous son seuil d'alerte"
                message="La satisfaction de chaque agence est au-dessus du seuil configuré pour elle."
              />
            )}
          </SectionCard>
        </section>
      )}
      </div>
      )}
    </div>
  );
}
