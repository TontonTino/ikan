/**
 * Vue SiÃ¨ge (CX Manager) â€” hiÃ©rarchie de lecture en 4 niveaux, un <h2> par groupe :
 *   Niveau 1  Situation globale  â†’ Â« Comment vont nos clients ? Â» (onglet Vue d'ensemble :
 *             KPI de tÃªte + Ã©volution du CSAT)
 *   Niveau 2  Attention          â†’ Â« Urgent Â» (rÃ©sumÃ© des alertes en Vue d'ensemble,
 *             dÃ©tail dans l'onglet Alertes)
 *   Niveau 3  ComprÃ©hension      â†’ Â« Que disent nos clients ? Â» (onglet Performance CX :
 *             sentiments, thÃ¨mes) et Â« OÃ¹ sont les problÃ¨mes ? Â» (onglet Agences)
 *   Niveau 4  Action             â†’ non prÃ©sent sur cette page : aucune donnÃ©e d'actions
 *             (recommandations crÃ©Ã©es/en cours/rÃ©solues) n'est chargÃ©e ici, elles vivent
 *             dans Pilotage (recommandationsApi).
 */
import React, { lazy, Suspense, useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
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
import { dashboardApi, alertesApi } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import type { DashboardSiege, Alerte, KPIAgence } from '../../types';

const DashboardSiegeMap = lazy(() => import('./DashboardSiegeMap'));
import TabsNavigation from '../../components/ui/TabsNavigation';
import PageHeader from '../../components/ui/PageHeader';
import KpiCoreGrid from '../../components/kpi/KpiCoreGrid';
import EmptyState from '../../components/ui/EmptyState';
import SkeletonBlock from '../../components/ui/SkeletonBlock';
import SectionHeading from '../../components/ui/SectionHeading';
import AlerteRow from '../../components/alerts/AlerteRow';
import EphemeralAlertsBanner from '../../components/alerts/EphemeralAlertsBanner';
import {
  StoreIcon,
  LightbulbIcon,
  TrendingUpIcon,
  CheckCircleIcon,
  MapIcon,
  BarChartIcon,
  ThumbsUpIcon,
  ThumbsDownIcon,
  ArrowUpRightIcon,
  ArrowDownRightIcon,
  TargetIcon,
  BellIcon,
} from '../../components/common/Icons';

// â”€â”€ Types enrichis â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€ Constantes Design â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const SENTIMENT_COLORS: Record<string, string> = {
  positif: '#3C7730',
  neutre: '#F59E0B',
  negatif: '#DC2626',
};

const THEME_LABELS: Record<string, string> = {
  attente: "Attente & DÃ©lais en caisse",
  accueil: "Accueil & Courtoisie conseillers",
  disponibilite_accessibilite: "AccessibilitÃ© & Horaires d'ouverture",
  tarifs: "Tarifs & Transparence offres",
  qualite_produit: "QualitÃ© RÃ©seau & Forfaits",
  proprete_cadre: "PropretÃ© & Cadre agence",
  application_mobile: "Application Mobile & E-espace",
  reseau: "Couverture 4G/5G & Fibre",
  facturation: "Facturation & PrÃ©lÃ¨vements",
  communication_information: "Conseils & ClartÃ© information",
  livraison_logistique: "DisponibilitÃ© Cartes SIM / Box",
  resolution_probleme: "Service Client & SAV",
  securite_confidentialite: "SÃ©curitÃ© & ConfidentialitÃ©",
  disponibilite_produit: "Stock Terminaux & Accessoires",
  personnalisation_besoin: "Ã‰coute & Personnalisation",
};

const AGENCE_COLOR = (taux: number) =>
  taux >= 80 ? '#3C7730' : taux >= 60 ? '#F59E0B' : '#DC2626';

// â”€â”€ Section Card Moderne â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function SectionCard({
  title,
  subtitle,
  children,
  action,
  critical = false,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  /** Ã‰quivalent visuel de .saas-card--critical (SectionCard est en styles
      inline, pas en classes) â€” rÃ©servÃ© aux cartes vÃ©ritablement critiques
      (alertes actives), jamais aux cartes neutres. */
  critical?: boolean;
}) {
  return (
    <div
      className={critical ? 'on-dark' : undefined}
      style={{
        background: critical ? 'var(--color-primary-dark)' : '#FFFFFF',
        borderRadius: '24px',
        padding: '24px 28px',
        boxShadow: critical ? '0 4px 20px rgba(2, 48, 45, 0.25)' : '0 2px 12px rgba(20, 60, 40, 0.03)',
        border: critical ? '1px solid #0A4A44' : '1px solid #E8ECE6',
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
              color: critical ? '#FFFFFF' : '#02302D',
            }}
          >
            {title}
          </h3>
          {subtitle && (
            <p style={{ margin: '3px 0 0', fontSize: '0.82rem', color: critical ? 'var(--color-text-on-dark-muted)' : '#64748B', fontWeight: 500 }}>
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

// â”€â”€ Squelette de chargement : reproduit la structure de chaque onglet â”€â”€
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
    <div aria-busy="true" aria-label="Chargement des donnÃ©es du rÃ©seau" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
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

// â”€â”€ Tooltip personnalisÃ© Recharts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
        <p key={i} style={{ color: 'var(--color-text-on-dark-muted)', margin: '2px 0', fontWeight: 600 }}>
          {p.name} : <strong style={{ color: 'var(--color-lime)', fontWeight: 800 }}>{p.value}{typeof p.value === 'number' && p.name.toLowerCase().includes('satisfaction') || p.name.toLowerCase().includes('csat') ? '%' : ''}</strong>
        </p>
      ))}
    </div>
  );
};

export default function DashboardSiegePage() {
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const voirAgence = (agenceId: string) => navigate(`/agences/${agenceId}/apercu`, { state: { retour: 'Vue SiÃ¨ge' } });
  const [data, setData] = useState<DashboardSiegeFull | null>(null);
  const [alertes, setAlertes] = useState<Alerte[]>([]);
  const [jours, setJours] = useState(30);
  const [loading, setLoading] = useState(true);

  // 4 Onglets SpÃ©cifiÃ©s pour /siege
  const [activeTab, setActiveTab] = useState<'overview' | 'performance' | 'agences' | 'alertes'>('overview');

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

  // Aucune donnÃ©e (Ã©chec du chargement) : la structure de la page n'est pas remplacÃ©e par un texte brut.
  const loadFailed = !loading && !data;

  // Calculs & mÃ©triques dÃ©rivÃ©es
  const agences = data?.agences ?? [];
  const agencesAvecCoords = agences.filter((a): a is KPIAgence & { latitude: number; longitude: number } => a.latitude != null && a.longitude != null);
  const agencesSansCoords = agences.filter((a) => a.latitude == null || a.longitude == null);

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

      {/* â”€â”€ 1. En-tÃªte (salutation + date + sÃ©lecteur de pÃ©riode) â”€â”€ */}
      <PageHeader
        greetingUser={user?.prenom}
        subtitle="Voici la situation de votre rÃ©seau aujourd'hui."
        showDateBesideActions
        onRefresh={load}
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

      {/* â”€â”€ 2. Alertes RÃ©seau Ã‰phÃ©mÃ¨res â”€â”€ */}
      <EphemeralAlertsBanner alerts={alertes} userId={user?.id} />

      {/* â”€â”€ 3. Navigation par Onglets SpÃ©cialisÃ©s â”€â”€ */}
      <TabsNavigation
        tabs={tabsConfig}
        activeTab={activeTab}
        onChange={(id) => setActiveTab(id as any)}
      />

      {loadFailed && (
        <EmptyState
          illustration="no-data"
          title="Impossible de charger les donnÃ©es du rÃ©seau"
          message="VÃ©rifiez votre connexion puis rÃ©essayez."
          action={{ label: 'RÃ©essayer', onClick: load }}
        />
      )}
      {!data && !loadFailed && <SiegeSkeleton tab={activeTab} />}

      {/* Pendant une actualisation (changement de pÃ©riode), les donnÃ©es prÃ©cÃ©dentes restent affichÃ©es, attÃ©nuÃ©es. */}
      {data && (
      <div aria-busy={loading} style={{ display: 'flex', flexDirection: 'column', gap: '20px', opacity: loading ? 0.55 : 1, transition: 'opacity 0.2s ease' }}>
      {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
          ONGLET 1 : VUE D'ENSEMBLE â€” niveau 1 (situation) puis niveau 2 (urgent)
      â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
      {activeTab === 'overview' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
          <section aria-labelledby="siege-situation" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div id="siege-situation"><SectionHeading>Comment vont nos clients ?</SectionHeading></div>

            <KpiCoreGrid jours={jours} />

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Link
                to="/pilotage?tab=issues"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.84rem', fontWeight: 700, color: '#3C7730', textDecoration: 'none' }}
              >
                Voir le dÃ©tail des Issues et actions
                <ArrowUpRightIcon size={13} color="#3C7730" />
              </Link>
            </div>

          {/* Graphique Unique d'Ã‰volution CSAT */}
          <SectionCard
            title="Ã‰volution du CSAT RÃ©seau"
            subtitle="Tendance globale de satisfaction client sur la pÃ©riode sÃ©lectionnÃ©e"
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

          {/* RÃ©sumÃ© ExÃ©cutif Compact du RÃ©seau */}
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
                <div style={{ fontSize: '0.76rem', color: '#64748B', fontWeight: 600 }}>RÃ©seau ConnectÃ©</div>
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
                <div style={{ fontSize: '0.76rem', color: '#64748B', fontWeight: 600 }}>BoÃ®te Ã  IdÃ©es</div>
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
                  {data.nombre_discordances} discordances signalÃ©es
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
                  {alertes.length > 3 ? `Voir les ${alertes.length} alertes â†’` : 'Voir le dÃ©tail des alertes â†’'}
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

      {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
          ONGLET 2 : PERFORMANCE CX (Analyses Approfondies)
      â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
      {activeTab === 'performance' && (
        <section aria-labelledby="siege-comprehension" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div id="siege-comprehension"><SectionHeading>Que disent nos clients ?</SectionHeading></div>
          {/* Row 1: Sentiments (l'Ã©volution temporelle du CSAT est dans Statistiques & Analyses) */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))', gap: '20px' }}>
            {/* RÃ©partition des Sentiments */}
            <SectionCard title="Distribution des Sentiments" subtitle="Classification Ã©motionnelle par le modÃ¨le IA">
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
                  Pas encore de donnÃ©es.
                </div>
              )}
            </SectionCard>
          </div>

          {/* Row 2: Top 5 Pain Points & ThÃ¨mes IA */}
          <SectionCard
            title="ThÃ©matiques & Pain Points Majeurs"
            subtitle="Extraction sÃ©mantique automatique des points d'attention"
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
                      {t.count} retours enregistrÃ©s
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ textAlign: 'center', color: '#94A3B8', padding: '40px 0' }}>
                Pas de thÃ¨mes dÃ©tectÃ©s pour cette pÃ©riode.
              </div>
            )}
          </SectionCard>
        </section>
      )}

      {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
          ONGLET 3 : AGENCES (Cartographie & Benchmark RÃ©seau)
      â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
      {activeTab === 'agences' && (
        <section aria-labelledby="siege-agences" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div id="siege-agences"><SectionHeading>OÃ¹ sont les problÃ¨mes ?</SectionHeading></div>
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
                  Top 3 Agences â€” Satisfaction
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
                  Agences Ã  surveiller
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
            title="Cartographie GÃ©ographique du RÃ©seau"
            subtitle="Localisation des agences avec code couleur selon le niveau de satisfaction"
          >
            {agencesAvecCoords.length > 0 ? (
              <>
                <Suspense fallback={<div role="status" style={{ height: 420, display: 'grid', placeItems: 'center', color: '#64748B' }}>Chargement de la carte?</div>}>
                  <DashboardSiegeMap agences={agencesAvecCoords} onVoirAgence={voirAgence} />
                </Suspense>
              </>
            ) : (
              <div style={{ textAlign: 'center', padding: '60px 0', color: '#94A3B8' }}>
                Aucune coordonnÃ©e gÃ©ographique disponible.
              </div>
            )}
          </SectionCard>

          {agencesSansCoords.length > 0 && (
            <SectionCard title="Agences sans coordonnées" subtitle="Elles restent accessibles dans le classement, mais ne peuvent pas être placées sur la carte.">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {agencesSansCoords.map((agence) => (
                  <button key={agence.agence_id} type="button" onClick={() => voirAgence(agence.agence_id)} className="btn-secondary" style={{ padding: '8px 12px', borderRadius: 9 }}>
                    {agence.agence_nom}{agence.ville ? ` · ${agence.ville}` : ''}
                  </button>
                ))}
              </div>
            </SectionCard>
          )}

          {/* Tableau RÃ©pertoire et Benchmark */}
          <SectionCard title="Classement et MÃ©triques par Agence" subtitle="Le score Wilson estime la satisfaction basse plausible à 95 % de confiance, en tenant compte du nombre d’avis. Il aide à comparer les agences sans surévaluer les petits échantillons.">
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #E8ECE6', background: '#F8FAFB' }}>
                    {['Agence', 'Ville', 'Avis', 'Satisfaction', 'Score Wilson à 95 %', 'Avis NÃ©gatifs', 'Suggestions'].map((h) => (
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
                  {sortedAgences.map((a) => (
                    <tr
                      key={a.agence_id}
                      style={{ borderBottom: '1px solid #F1F4EE' }}
                    >
                      <td style={{ padding: '12px 14px', fontWeight: 700 }}><button type="button" onClick={() => voirAgence(a.agence_id)} style={{ padding: 0, border: 0, background: 'none', color: '#02302D', font: 'inherit', fontWeight: 700, textAlign: 'left', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }}>{a.agence_nom}</button></td>
                      <td style={{ padding: '12px 14px', color: '#64748B' }}>{a.ville || 'â€”'}</td>
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
                      <td title="Borne inférieure de satisfaction à 95 %" style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 700, color: '#475569' }}>{(a.wilson_score * 100).toFixed(1)}%</td>
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

      {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
          ONGLET 4 : ALERTES â€” dÃ©tail du niveau 2 (seuil de satisfaction par agence)
      â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
      {activeTab === 'alertes' && (
        <section aria-labelledby="siege-alertes" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div id="siege-alertes"><SectionHeading>Urgent</SectionHeading></div>
          <SectionCard
            title="Agences sous leur seuil d'alerte"
            subtitle="Satisfaction de la semaine infÃ©rieure au seuil configurÃ© pour l'agence"
            critical={alertes.length > 0}
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
                message="La satisfaction de chaque agence est au-dessus du seuil configurÃ© pour elle."
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
