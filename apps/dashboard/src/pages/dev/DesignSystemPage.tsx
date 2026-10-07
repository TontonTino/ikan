import React, { useState } from 'react';
import { Area, ComposedChart, CartesianGrid, Line, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import {
  ActionCard,
  Alert,
  Badge,
  Button,
  Card,
  Chart,
  ChartTooltip,
  DataTable,
  Drawer,
  Dropdown,
  EmptyState,
  FeedbackCard,
  IconButton,
  KpiCard,
  Modal,
  Skeleton,
  Tooltip,
  chartAxisProps,
  chartGridProps,
  useToast,
  BentoGrid,
  BentoItem,
  type Granularity,
} from '../../components/ui';
import Sidebar from '../../components/layout/Sidebar';
import NotificationCenter from '../../components/layout/NotificationCenter';
import { ROLE_NAV_SECTIONS } from '../../components/layout/navigation';
import type { User, UserRole } from '../../types';
import {
  AlertTriangleIcon,
  DownloadIcon,
  EditIcon,
  MessageSquareIcon,
  MoreVerticalIcon,
  PlusIcon,
  SmileIcon,
  TrashIcon,
} from '../../components/common/Icons';
import type { Feedback } from '../../types';

const DEMO_USER = (role: UserRole): User => ({
  id: 'demo', nom: 'Exemple', prenom: 'Utilisateur', email: 'demo@example.com', role,
  organisation_id: 'demo-org', organisation_nom: 'Organisation (exemple)', agence_nom: role === 'agency_manager' ? 'Agence (exemple)' : undefined,
});

/** Cadre qui contient la sidebar (position: fixed) grâce à transform. */
function SidebarFrame({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div className="ds-sidebar-frame" style={{ position: 'relative', transform: 'translateZ(0)', height: 640, width: 320, borderRadius: 'var(--radius-xl)', background: 'var(--color-bg-subtle)', overflow: 'hidden' }}>
        {children}
      </div>
      <figcaption style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', fontWeight: 600 }}>{label}</figcaption>
    </figure>
  );
}

function Zone({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <Card padding="sm" title={label} headingLevel={3}>
      {children ?? <Skeleton variant="rect" height={56} />}
    </Card>
  );
}

/*
 * Vitrine du design system — route /design-system, montée UNIQUEMENT en dev
 * (import.meta.env.DEV). Toutes les données ci-dessous sont des exemples
 * statiques de démonstration, aucune ne vient de l'API.
 */

const DEMO_FEEDBACKS: Feedback[] = [
  {
    id: 'demo-1', qr_code_id: 'qr', agence_nom: 'Agence (exemple) A', note: 1,
    commentaire: "Exemple de commentaire : attente de 45 minutes en caisse, un seul conseiller présent.",
    date_soumission: new Date(Date.now() - 3 * 3600e3).toISOString(), statut_traitement: 'nouveau',
    analyse_ia: { id: 'a', sentiment: 'negatif', criticite: 'critique', theme_principal: 'attente', discordance_detectee: false },
  },
  {
    id: 'demo-2', qr_code_id: 'qr', agence_nom: 'Agence (exemple) B', note: 5,
    date_soumission: new Date(Date.now() - 2 * 86400e3).toISOString(), statut_traitement: 'resolu',
    analyse_ia: { id: 'b', sentiment: 'positif', criticite: 'faible', theme_principal: 'accueil', discordance_detectee: false },
  },
];

const SERIES = Array.from({ length: 12 }, (_, i) => ({
  label: `S${i + 1}`,
  csat: [72, 74, 73, 76, 75, 78, 77, 74, 71, 73, 76, 79][i],
  previous: [70, 71, 72, 72, 73, 74, 74, 73, 72, 72, 73, 74][i],
}));

const TOKENS_COLORS = [
  ['--color-primary-dark', 'Marque'], ['--color-primary', 'Marque'], ['--color-accent', 'Marque'], ['--color-lime', 'Marque (déco)'],
  ['--color-text-main', 'Texte'], ['--color-text-body', 'Texte'], ['--color-text-muted', 'Texte'],
  ['--color-bg', 'Neutre'], ['--color-bg-subtle', 'Neutre'], ['--color-border', 'Neutre'],
  ['--color-success-solid', 'Succès'], ['--color-warning-solid', 'Attention'], ['--color-critical-solid', 'Critique'], ['--color-info-solid', 'Info'],
  ['--dataviz-positive', 'Dataviz'], ['--dataviz-critical', 'Dataviz'], ['--dataviz-attention', 'Dataviz'], ['--dataviz-info', 'Dataviz'], ['--dataviz-neutral', 'Dataviz'],
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <h2 style={{ margin: 0, fontSize: 'var(--text-xl)', fontWeight: 'var(--weight-black)', color: 'var(--color-text-main)' }}>{title}</h2>
      {children}
    </section>
  );
}

const row: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', alignItems: 'center' };
const grid: React.CSSProperties = { display: 'grid', gap: 'var(--space-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' };

export default function DesignSystemPage() {
  const toast = useToast();
  const [modal, setModal] = useState(false);
  const [drawerLevel, setDrawerLevel] = useState<0 | 1 | 2>(0);
  const [granularity, setGranularity] = useState<Granularity>('week');
  const [chartState, setChartState] = useState<'data' | 'loading' | 'empty'>('data');
  const [demoRole, setDemoRole] = useState<UserRole>('cx_manager');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-7)', padding: 'var(--space-5)', maxWidth: 1200, margin: '0 auto' }}>
      <header>
        <h1 style={{ margin: 0, fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-black)', color: 'var(--color-text-main)' }}>Design system IKAN AI</h1>
        <p style={{ margin: 'var(--space-1) 0 0', color: 'var(--color-text-muted)' }}>Vitrine de développement — données d'exemple, aucune donnée réelle.</p>
      </header>

      <Section title="Sidebar adaptative">
        <style>{'.ds-sidebar-frame .dashboard-sidebar { height: calc(100% - 2 * var(--layout-gutter)); }'}</style>
        <div style={row} role="group" aria-label="Rôle de démonstration">
          {(['cx_manager', 'agency_manager', 'admin'] as UserRole[]).map((r) => (
            <Button key={r} size="sm" variant={demoRole === r ? 'primary' : 'secondary'} aria-pressed={demoRole === r} onClick={() => setDemoRole(r)}>
              {r === 'cx_manager' ? 'CX Manager' : r === 'agency_manager' ? 'Agency Manager' : 'Admin'}
            </Button>
          ))}
        </div>
        <div style={{ ...row, alignItems: 'flex-start' }}>
          <SidebarFrame label="Ouverte : libellés, sections, espace de travail">
            <Sidebar user={DEMO_USER(demoRole)} sections={ROLE_NAV_SECTIONS[demoRole]} collapsed={false} mobileOpen={false} onCloseMobile={() => undefined} yam={demoRole !== 'admin' ? { open: false, onToggle: () => undefined } : undefined} />
          </SidebarFrame>
          <SidebarFrame label="Réduite : icônes + tooltip au survol et au focus (Tab)">
            <Sidebar user={DEMO_USER(demoRole)} sections={ROLE_NAV_SECTIONS[demoRole].map((sec, i) => i === 0 ? { ...sec, items: sec.items.map((it, j) => j === 2 ? { ...it, badge: 4, badgeUrgent: true } : it) } : sec)} collapsed mobileOpen={false} onCloseMobile={() => undefined} yam={demoRole !== 'admin' ? { open: false, onToggle: () => undefined } : undefined} />
          </SidebarFrame>
        </div>
      </Section>

      <Section title="Centre de notifications — cloche (étape 3)">
        <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>Format court + lien vers l'alerte. Les alertes de seuil n'ont pas de date côté API : affichées « En cours ».</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-start', maxWidth: 520, minHeight: 470 }}>
          <NotificationCenter
            userId="demo-notif"
            defaultOpen
            loading={false}
            showAgency
            data={{
              alertes_seuil: [{ agence_id: 'a1', agence_nom: 'Agence (exemple) A', taux_actuel: 62, seuil: 70, message: '' }],
              alertes_feedback: [
                { feedback_id: 'f1', agence_id: 'a2', agence_nom: 'Agence (exemple) B', note: 1, raison: 'note_basse_et_sentiment_negatif', date_soumission: new Date(Date.now() - 40 * 60e3).toISOString() },
                { feedback_id: 'f2', agence_id: 'a3', agence_nom: 'Agence (exemple) C', note: 3, raison: 'sentiment_negatif', date_soumission: new Date(Date.now() - 26 * 3600e3).toISOString() },
              ],
            }}
          />
        </div>
      </Section>

      <Section title="Bento grid (étape 2)">
        <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>Composition type CX Manager. Ordre du DOM = ordre de lecture : Situation → Évolution → Priorités → Explication → Action → Impact.</p>
        <BentoGrid>
          <BentoItem size="kpi" aria-label="Situation — CSAT"><KpiCard icon={<SmileIcon />} label="CSAT global" value="78 %" trend={{ value: '+3 pts', isPositive: true }} sparkline={SERIES.map((x) => x.csat)} /></BentoItem>
          <BentoItem size="kpi" aria-label="Situation — volume"><KpiCard icon={<MessageSquareIcon />} label="Volume de feedbacks" value="1 284" tone="neutral" trend={{ value: '+12 %', isPositive: true }} /></BentoItem>
          <BentoItem size="kpi" aria-label="Situation — critiques"><KpiCard icon={<AlertTriangleIcon />} label="Feedbacks critiques" value="17" tone="critical" trend={{ value: '+4', isPositive: false }} /></BentoItem>
          <BentoItem size="kpi" aria-label="Situation — alertes"><KpiCard icon={<AlertTriangleIcon />} label="Alertes ouvertes" value="5" tone="warning" /></BentoItem>
          <BentoItem size="hero" aria-label="Évolution">
            <Zone label="Évolution — graphique principal (hero, 8 col × 2 rangées)"><Skeleton variant="rect" height={300} /></Zone>
          </BentoItem>
          <BentoItem size="side" aria-label="Priorités"><Zone label="Priorités — alertes réseau (side)" /></BentoItem>
          <BentoItem size="side" aria-label="Priorités"><Zone label="Priorités — agences en difficulté (side)" /></BentoItem>
          <BentoItem size="two-thirds" aria-label="Explication"><Zone label="Explication — sentiments & thèmes (two-thirds)" /></BentoItem>
          <BentoItem size="third" aria-label="Insights"><Zone label="Insight IA (third)" /></BentoItem>
          <BentoItem size="half" aria-label="Action"><Zone label="Action — actions correctives (half)" /></BentoItem>
          <BentoItem size="half" aria-label="Impact"><Zone label="Impact — suivi d'efficacité (half)" /></BentoItem>
        </BentoGrid>
      </Section>

      <Section title="Tokens — couleurs">
        <div style={{ ...grid, gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
          {TOKENS_COLORS.map(([v, group]) => (
            <div key={v} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <span style={{ width: 32, height: 32, borderRadius: 'var(--radius-sm)', background: `var(${v})`, border: '1px solid var(--color-border)', flexShrink: 0 }} />
              <span style={{ fontSize: 'var(--text-xs)' }}><strong>{group}</strong><br /><code>{v}</code></span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Tokens — espacements & rayons">
        <div style={row}>
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <div key={n} style={{ textAlign: 'center', fontSize: 'var(--text-xs)' }}>
              <div style={{ width: `var(--space-${n})`, height: 24, background: 'var(--color-primary)', borderRadius: 2, margin: '0 auto' }} />
              <code>--space-{n}</code>
            </div>
          ))}
        </div>
        <div style={row}>
          {['sm', 'md', 'lg', 'xl'].map((r) => (
            <div key={r} style={{ width: 88, height: 56, borderRadius: `var(--radius-${r})`, border: '2px solid var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--text-xs)' }}>
              --radius-{r}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Button & IconButton">
        <div style={row}>
          <Button icon={<PlusIcon size={16} />}>Créer une action</Button>
          <Button variant="accent">Accent marque</Button>
          <Button variant="secondary" icon={<DownloadIcon size={16} />}>Exporter</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger" icon={<TrashIcon size={16} />}>Supprimer</Button>
          <Button loading>Envoi…</Button>
          <Button disabled>Désactivé</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
        </div>
        <div style={row}>
          <IconButton label="Modifier" icon={<EditIcon size={16} />} />
          <IconButton label="Télécharger" icon={<DownloadIcon size={16} />} size="sm" />
          <IconButton label="Plus d'options" icon={<MoreVerticalIcon size={18} />} variant="ghost" size="lg" />
        </div>
      </Section>

      <Section title="Badge">
        <div style={row}>
          <Badge variant="success" label="Résolu" />
          <Badge variant="warning" label="En cours" />
          <Badge variant="critical" label="Critique" icon={<AlertTriangleIcon size={12} />} />
          <Badge variant="info" label="En traitement" />
          <Badge variant="neutral" label="Faible" />
          <Badge variant="brand" label="Marque" />
          <Badge variant="outline" label="Outline" />
          <Badge value="negatif" label="Valeur backend « negatif »" size="md" />
        </div>
      </Section>

      <Section title="Tooltip & Dropdown">
        <div style={row}>
          <Tooltip content="Score Wilson — borne inférieure à 95 %">
            <Button variant="secondary">Survoler ou focus</Button>
          </Tooltip>
          <Dropdown
            label="Actions sur le feedback"
            trigger={(p) => <Button variant="secondary" {...p}>Ouvrir le menu</Button>}
            items={[
              { key: 'edit', label: 'Modifier', icon: <EditIcon size={16} />, onSelect: () => toast.info('Modifier sélectionné') },
              { key: 'dl', label: 'Exporter', icon: <DownloadIcon size={16} />, onSelect: () => toast.info('Exporter sélectionné') },
              { type: 'separator', key: 's' },
              { key: 'del', label: 'Supprimer', icon: <TrashIcon size={16} />, danger: true, onSelect: () => toast.error('Suppression (démo)') },
            ]}
          />
        </div>
      </Section>

      <Section title="Modal, Drawer, Toast">
        <div style={row}>
          <Button variant="secondary" onClick={() => setModal(true)}>Ouvrir une modale</Button>
          <Button variant="secondary" onClick={() => setDrawerLevel(1)}>Ouvrir un drawer (2 niveaux)</Button>
          <Button variant="secondary" onClick={() => toast.success('Action marquée comme réalisée.')}>Toast succès</Button>
          <Button variant="secondary" onClick={() => toast.error('Impossible de joindre le serveur.')}>Toast erreur</Button>
        </div>
        <Modal
          open={modal}
          onClose={() => setModal(false)}
          title="Transmettre à l'Agency Manager"
          subtitle="Exemple de modale de décision."
          footer={<><Button variant="secondary" onClick={() => setModal(false)}>Annuler</Button><Button onClick={() => setModal(false)}>Transmettre</Button></>}
        >
          <p style={{ margin: 0 }}>Contenu de la modale. Tab reste piégé, Échap ferme, le focus revient au bouton.</p>
        </Modal>
        <Drawer
          open={drawerLevel > 0}
          onClose={() => setDrawerLevel(0)}
          onBack={drawerLevel === 2 ? () => setDrawerLevel(1) : undefined}
          title={drawerLevel === 1 ? 'Satisfaction — agences' : 'Agence (exemple) A — thèmes'}
          subtitle="Exemple de progressive disclosure"
        >
          {drawerLevel === 1 ? (
            <Button variant="secondary" onClick={() => setDrawerLevel(2)}>Agence (exemple) A →</Button>
          ) : (
            <FeedbackCard feedback={DEMO_FEEDBACKS[0]} />
          )}
        </Drawer>
      </Section>

      <Section title="Card & KpiCard">
        <div style={grid}>
          <KpiCard icon={<SmileIcon />} label="CSAT global" value="78 %" trend={{ value: '+3 pts', isPositive: true }} sparkline={SERIES.map((s) => s.csat)} highlight hint="Part des notes 4 et 5 sur 5." onClick={() => setDrawerLevel(1)} />
          <KpiCard icon={<MessageSquareIcon />} label="Volume de feedbacks" value="1 284" tone="neutral" trend={{ value: '+12 %', isPositive: true }} />
          <KpiCard icon={<AlertTriangleIcon />} label="Feedbacks critiques" value="17" tone="critical" trend={{ value: '+4', isPositive: false }} />
          <KpiCard icon={<SmileIcon />} label="Chargement" value="" loading />
        </div>
        <div style={grid}>
          <KpiCard compact icon={<SmileIcon />} label="CSAT (compact)" value="78 %" trend={{ value: '-2 pts', isPositive: false }} sparkline={[80, 79, 78, 78]} />
          <KpiCard compact icon={<MessageSquareIcon />} label="Stable (compact)" value="42" tone="neutral" trend={{ value: '0', isPositive: true }} />
        </div>
        <div style={grid}>
          <Card title="Carte standard" subtitle="Sous-titre" actions={<Button size="sm" variant="ghost">Voir tout</Button>}>Contenu.</Card>
          <Card title="Carte critique" tone="critical">Bordure critique.</Card>
          <Card title="Carte cliquable" onClick={() => toast.info('Carte activée')}>Entrée / Espace au clavier.</Card>
        </div>
      </Section>

      <Section title="Alert">
        <Alert tone="critical" title="3 agences sous le seuil de satisfaction" action={<Button size="sm" variant="secondary">Voir les agences</Button>}>Exemple de message critique.</Alert>
        <Alert tone="warning" title="Thème récurrent détecté">Exemple d'avertissement.</Alert>
        <Alert tone="success" title="Action réalisée" onDismiss={() => undefined} />
        <Alert tone="info" title="Données mises à jour toutes les 15 minutes." />
      </Section>

      <Section title="FeedbackCard & ActionCard">
        <div style={grid}>
          <FeedbackCard feedback={DEMO_FEEDBACKS[0]} showAgency onOpen={() => toast.info('Ouverture du feedback')} />
          <FeedbackCard feedback={DEMO_FEEDBACKS[1]} showAgency />
          <ActionCard action={{ id: 'a1', title: 'Renforcer l’accueil le samedi matin', status: 'en_cours', owner: 'Responsable (exemple)', createdAt: new Date(Date.now() - 5 * 86400e3).toISOString(), source: 'attente' }} onComplete={() => toast.success('Action marquée comme réalisée.')} />
          <ActionCard action={{ id: 'a2', title: 'Exemple avec échéance dépassée', status: 'a_faire', dueDate: new Date(Date.now() - 86400e3).toISOString() }} />
          <ActionCard action={{ id: 'a3', title: 'Action terminée', status: 'terminee', owner: 'Responsable (exemple)' }} />
        </div>
      </Section>

      <Section title="Chart">
        <div style={row}>
          {(['data', 'loading', 'empty'] as const).map((s) => (
            <Button key={s} size="sm" variant={chartState === s ? 'primary' : 'secondary'} onClick={() => setChartState(s)}>État : {s}</Button>
          ))}
        </div>
        <Chart
          title="Évolution du CSAT"
          subtitle="Données d'exemple"
          series={[{ key: 'csat', label: 'CSAT', color: 'positive' }, { key: 'previous', label: 'Période précédente', color: 'neutral', dashed: true }]}
          loading={chartState === 'loading'}
          isEmpty={chartState === 'empty'}
          emptyTitle="Aucun feedback sur cette période."
          emptyMessage="Élargissez la période ou vérifiez que les QR codes sont actifs."
          granularity={{ value: granularity, onChange: setGranularity }}
          table={
            <DataTable
              caption="CSAT par semaine"
              rows={SERIES}
              rowKey={(r) => r.label}
              columns={[
                { key: 'label', header: 'Semaine' },
                { key: 'csat', header: 'CSAT', align: 'right', numeric: true, render: (r) => `${r.csat} %` },
                { key: 'previous', header: 'Période préc.', align: 'right', numeric: true, render: (r) => `${r.previous} %` },
              ]}
            />
          }
        >
          {({ isVisible, color }) => (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={SERIES} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid {...chartGridProps} />
                <XAxis dataKey="label" {...chartAxisProps} />
                <YAxis domain={[0, 100]} unit=" %" {...chartAxisProps} />
                <RTooltip content={<ChartTooltip formatter={(v) => `${v} %`} />} />
                {isVisible('csat') && <Area type="monotone" dataKey="csat" name="CSAT" stroke={color('positive')} strokeWidth={2} fill={color('positive')} fillOpacity={0.14} isAnimationActive={false} />}
                {isVisible('previous') && <Line type="monotone" dataKey="previous" name="Période précédente" stroke={color('neutral')} strokeWidth={2} strokeDasharray="4 4" dot={false} isAnimationActive={false} />}
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </Chart>
      </Section>

      <Section title="DataTable">
        <DataTable
          caption="Exemple de tableau triable"
          rows={SERIES.slice(0, 5)}
          rowKey={(r) => r.label}
          onRowClick={(r) => toast.info(`Ligne ${r.label}`)}
          rowLabel={(r) => `Ouvrir ${r.label}`}
          defaultSort={{ key: 'csat', direction: 'desc' }}
          columns={[
            { key: 'label', header: 'Semaine', sortValue: (r) => r.label },
            { key: 'csat', header: 'CSAT', align: 'right', numeric: true, sortValue: (r) => r.csat, render: (r) => `${r.csat} %` },
          ]}
        />
        <DataTable caption="Chargement" rows={[] as typeof SERIES} rowKey={(r) => r.label} loading skeletonRows={3} columns={[{ key: 'label', header: 'Semaine' }, { key: 'csat', header: 'CSAT', numeric: true }]} />
        <DataTable caption="Vide" rows={[] as typeof SERIES} rowKey={(r) => r.label} emptyTitle="Aucune action en cours." emptyMessage="Les actions créées depuis un feedback apparaîtront ici." columns={[{ key: 'label', header: 'Semaine' }]} />
      </Section>

      <Section title="EmptyState & Skeleton">
        <div style={grid}>
          <Card padding="none"><EmptyState title="Aucune alerte active" message="Aucune agence ne dépasse les seuils sur cette période." illustration="no-alert" /></Card>
          <Card padding="none"><EmptyState compact title="Aucun feedback critique sur cette période." action={{ label: 'Changer la période', onClick: () => undefined }} /></Card>
          <Card>
            <Skeleton variant="text" width="40%" height={20} />
            <Skeleton variant="text" lines={3} />
            <div style={row}><Skeleton variant="circle" width={40} /><Skeleton variant="rect" width={120} height={32} /></div>
          </Card>
        </div>
      </Section>
    </div>
  );
}
