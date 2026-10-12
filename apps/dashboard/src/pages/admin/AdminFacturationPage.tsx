import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { adminFacturationApi, organisationsApi } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import type {
  Organisation,
  VueEnsembleFacturation,
  OrganisationPaiementEchoue,
  ChangementPlanHistoriqueItem,
} from '../../types';
import PageHeader from '../../components/ui/PageHeader';
import EmptyState from '../../components/ui/EmptyState';
import Alert from '../../components/ui/Alert';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import { AlertTriangleIcon, ClockIcon } from '../../components/common/Icons';
import { userFacingError } from '../../utils/userFacingError';

const SOURCE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  stripe: { label: 'Stripe', color: '#3C7730', bg: '#EAF5EC' },
  admin_override: { label: 'Changement manuel (admin)', color: '#B45309', bg: '#FEF3C7' },
  auto_downgrade: { label: 'Retour automatique au forfait Gratuit', color: '#B91C1C', bg: '#FEE2E2' },
};

function cardStyle(): React.CSSProperties {
  return {
    background: '#FFFFFF',
    borderRadius: '18px',
    border: '1px solid #E8ECE6',
    boxShadow: '0 2px 10px rgba(0,0,0,0.02)',
    padding: '18px 20px',
  };
}

// ── Modale : changer le forfait ──────────────────────────────────────
function ModaleChangerForfait({
  org,
  forfaits,
  onClose,
  onSuccess,
}: {
  org: Organisation;
  forfaits: { id: string; code: string; nom: string }[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [planId, setPlanId] = useState('');
  const [raison, setRaison] = useState('');
  const [erreur, setErreur] = useState('');
  const [envoi, setEnvoi] = useState(false);

  const planChoisi = forfaits.find((f) => f.id === planId);
  const memePlan = !!planChoisi && planChoisi.code === org.plan?.code;

  const soumettre = async () => {
    setErreur('');
    if (!planId) {
      setErreur('Choisissez un forfait.');
      return;
    }
    if (memePlan) {
      setErreur('Cette organisation a déjà ce forfait : rien ne serait modifié.');
      return;
    }
    if (raison.trim().length < 10) {
      setErreur('La raison doit contenir au moins 10 caractères.');
      return;
    }
    setEnvoi(true);
    try {
      await organisationsApi.changerPlan(org.id, planId, raison.trim());
      onSuccess();
    } catch (err: any) {
      console.error('Erreur changement de forfait:', err);
      setErreur(userFacingError(err, 'Impossible de changer le forfait. Veuillez réessayer.', undefined, {
        404: 'Cette organisation est introuvable, ou vous n’avez pas le droit de la modifier.',
      }));
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Modal
      open
      onClose={envoi ? () => undefined : onClose}
      dismissOnScrim={false}
      size="sm"
      title="Changer le forfait"
      subtitle={`${org.nom} — forfait actuel : ${org.plan?.nom || 'non renseigné'}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={envoi}>Annuler</Button>
          <Button onClick={soumettre} loading={envoi}>
            {planChoisi ? `Passer au forfait ${planChoisi.nom}` : 'Confirmer le changement'}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div
          style={{
            background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '10px', padding: '10px 12px',
            fontSize: '0.8rem', color: '#92400E', display: 'flex', gap: '8px', lineHeight: 1.5,
          }}
        >
          <AlertTriangleIcon size={16} color="#B45309" />
          <span>Réservé aux cas exceptionnels (ex. partenariat négocié). Ce changement contourne Stripe et est tracé de façon permanente, avec votre nom et la raison saisie.</span>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontWeight: 700, fontSize: '0.82rem', color: '#1E293B' }}>
          Nouveau forfait
          <select value={planId} onChange={(e) => setPlanId(e.target.value)} className="saas-input" style={{ width: '100%', minHeight: 44 }}>
            <option value="">— Choisir —</option>
            {forfaits.map((f) => (
              <option key={f.id} value={f.id} disabled={f.code === org.plan?.code}>
                {f.nom}{f.code === org.plan?.code ? ' (forfait actuel)' : ''}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontWeight: 700, fontSize: '0.82rem', color: '#1E293B' }}>
          Raison (obligatoire, 10 caractères minimum)
          <textarea
            value={raison}
            onChange={(e) => setRaison(e.target.value)}
            rows={3}
            placeholder="ex : Partenariat négocié directement avec le client, forfait Pro offert pour 6 mois."
            className="saas-input"
            style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
          />
        </label>

        {erreur && (
          <div role="alert" style={{ color: '#B91C1C', fontSize: '0.82rem', fontWeight: 700 }}>{erreur}</div>
        )}
      </div>
    </Modal>
  );
}

// ── Modale : historique des changements de forfait ───────────────────
function ModaleHistorique({ org, onClose }: { org: Organisation; onClose: () => void }) {
  const [historique, setHistorique] = useState<ChangementPlanHistoriqueItem[] | null>(null);
  const [erreur, setErreur] = useState('');
  const [rechargement, setRechargement] = useState(0);

  useEffect(() => {
    let annule = false;
    setHistorique(null);
    setErreur('');
    adminFacturationApi
      .historique(org.id)
      .then((res) => { if (!annule) setHistorique(Array.isArray(res.data) ? res.data : []); })
      .catch((err) => {
        console.error('Erreur chargement de l’historique de forfait:', err);
        if (!annule) setErreur(userFacingError(err, 'Impossible de charger l’historique. Veuillez réessayer.'));
      });
    return () => { annule = true; };
  }, [org.id, rechargement]);

  return (
    <Modal open onClose={onClose} size="md" title="Historique du forfait" subtitle={org.nom}>
      {erreur ? (
        <div role="alert" style={{ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'flex-start' }}>
          <span style={{ color: '#B91C1C', fontWeight: 700, fontSize: '0.86rem' }}>{erreur}</span>
          <span style={{ color: '#64748B', fontSize: '0.8rem' }}>Cela ne signifie pas qu’aucun changement n’a eu lieu.</span>
          <Button size="sm" variant="secondary" onClick={() => setRechargement((n) => n + 1)}>Réessayer</Button>
        </div>
      ) : historique === null ? (
        <div aria-busy="true" style={{ color: '#94A3B8', fontSize: '0.84rem' }}>Chargement…</div>
      ) : historique.length === 0 ? (
        <EmptyState title="Aucun changement de forfait" message="Aucun changement de forfait enregistré." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {historique.map((h) => {
            const src = SOURCE_LABELS[h.source] || { label: 'Autre origine', color: '#475569', bg: '#F1F5F9' };
            return (
              <div key={h.id} style={{ border: '1px solid #E8ECE6', borderRadius: '12px', padding: '10px 12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.84rem', color: '#02302D' }}>
                    {h.ancien_plan_nom || '—'} → {h.nouveau_plan_nom}
                  </span>
                  <span style={{ background: src.bg, color: src.color, fontWeight: 700, fontSize: '0.7rem', padding: '2px 8px', borderRadius: '9999px' }}>
                    {src.label}
                  </span>
                </div>
                {h.raison && <div style={{ fontSize: '0.8rem', color: '#475569', marginBottom: '4px' }}>{h.raison}</div>}
                <div style={{ fontSize: '0.74rem', color: '#64748B' }}>
                  {new Date(h.created_at).toLocaleString('fr-FR')}
                  {h.modifie_par_nom && ` · ${h.modifie_par_nom}`}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

// Contrôle d'accès séparé du contenu : les hooks du contenu ne sont jamais appelés après un retour anticipé.
export default function AdminFacturationPage() {
  const user = useAuthStore((s) => s.user);
  if (user?.role !== 'admin') {
    return <Navigate to="/siege" replace />;
  }
  return <AdminFacturationPageContenu />;
}

function AdminFacturationPageContenu() {
  const [vueEnsemble, setVueEnsemble] = useState<VueEnsembleFacturation | null>(null);
  const [paiementsEchoues, setPaiementsEchoues] = useState<OrganisationPaiementEchoue[] | null>(null);
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [loading, setLoading] = useState(true);
  const [orgPourChangement, setOrgPourChangement] = useState<Organisation | null>(null);
  const [orgPourHistorique, setOrgPourHistorique] = useState<Organisation | null>(null);
  const [erreurChargement, setErreurChargement] = useState('');
  const [succes, setSucces] = useState('');

  const chargerTout = () => {
    setErreurChargement('');
    Promise.all([
      adminFacturationApi.vueEnsemble(),
      adminFacturationApi.paiementsEchoues(),
      organisationsApi.list(),
    ])
      .then(([ve, pe, orgs]) => {
        setVueEnsemble(ve.data);
        setPaiementsEchoues(pe.data);
        setOrganisations(orgs.data);
      })
      .catch((err) => {
        console.error('Erreur chargement de la facturation:', err);
        setErreurChargement(userFacingError(err, 'Impossible de charger la facturation. Veuillez réessayer.'));
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    chargerTout();
  }, []);

  if (loading) {
    return <div style={{ color: '#64748B', padding: '32px', fontWeight: 600 }}>Chargement de la facturation…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <PageHeader
        title="Facturation"
        subtitle="Vue d'ensemble des forfaits, paiements en échec et changements manuels — organisations que vous avez créées."
      />

      {succes && <Alert tone="success" title={succes} onDismiss={() => setSucces('')} />}

      {erreurChargement && (
        <Alert
          tone="critical"
          title={erreurChargement}
          action={<Button size="sm" variant="secondary" onClick={() => { setLoading(true); chargerTout(); }}>Réessayer</Button>}
        >
          Les chiffres ci-dessous ne sont pas fiables tant que le chargement n’a pas abouti.
        </Alert>
      )}

      {/* ── KPIs : répartition par forfait + taux de conversion ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '14px' }}>
        {vueEnsemble?.repartition.map((r) => (
          <div key={r.code} style={cardStyle()}>
            <div style={{ fontSize: '0.76rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
              {r.nom}
            </div>
            <div style={{ fontSize: '1.7rem', fontWeight: 800, color: '#02302D', marginTop: '4px' }}>{r.nombre}</div>
          </div>
        ))}
        <div style={{ ...cardStyle(), background: '#EAF5EC', border: '1px solid #CFE3D3' }}>
          <div style={{ fontSize: '0.76rem', fontWeight: 700, color: '#3C7730', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
            Passage du forfait Gratuit à un forfait payant (30 jours)
          </div>
          <div style={{ fontSize: '1.7rem', fontWeight: 800, color: '#02302D', marginTop: '4px' }}>
            {vueEnsemble?.taux_conversion_30j === null || vueEnsemble?.taux_conversion_30j === undefined
              ? '—'
              : `${Math.round(vueEnsemble.taux_conversion_30j * 100)}%`}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#3C7730', marginTop: '2px' }}>
            {vueEnsemble?.nb_conversions_30j ?? 0} conversion(s) / {vueEnsemble?.nb_base_calcul_30j ?? 0} organisation(s)
          </div>
        </div>
      </div>

      {/* ── Paiements en échec ── */}
      <div style={cardStyle()}>
        <h3 style={{ margin: '0 0 4px', fontSize: '0.95rem', fontWeight: 800, color: '#02302D', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <AlertTriangleIcon size={18} color="#DC2626" />
          Paiements en échec
        </h3>
        <p style={{ margin: '0 0 14px', fontSize: '0.8rem', color: '#64748B' }}>
          Triés par date du retour automatique au forfait Gratuit (7 jours de délai après l’échec).
        </p>

        {!paiementsEchoues ? (
          <p style={{ margin: 0, fontSize: '0.84rem', color: '#64748B' }}>
            Les paiements en échec n’ont pas pu être chargés : cela ne signifie pas qu’il n’y en a aucun.
          </p>
        ) : paiementsEchoues.length === 0 ? (
          <div className="saas-card saas-card--success" style={{ padding: 0 }}>
            <EmptyState
              title="Aucun paiement en échec"
              message="Aucun paiement en échec actuellement."
              illustration="no-alert"
            />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {paiementsEchoues.map((p) => {
              const critique = p.jours_restants_avant_degradation <= 2;
              return (
                <div
                  key={p.organisation_id}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 14px', borderRadius: '10px',
                    background: critique ? '#FEF2F2' : '#FFFBEB',
                    border: `1px solid ${critique ? '#FECACA' : '#FDE68A'}`,
                  }}
                >
                  <div>
                    <span style={{ fontWeight: 700, color: '#1E293B', fontSize: '0.86rem' }}>{p.organisation_nom}</span>
                    <span style={{ marginLeft: '10px', color: '#64748B', fontSize: '0.78rem' }}>Forfait {p.plan_nom}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: critique ? '#B91C1C' : '#B45309', fontWeight: 700, fontSize: '0.8rem' }}>
                    <ClockIcon size={14} color={critique ? '#B91C1C' : '#B45309'} />
                    {p.jours_restants_avant_degradation <= 0
                      ? 'Retour au forfait Gratuit imminent'
                      : `${p.jours_restants_avant_degradation} jour(s) avant le retour au forfait Gratuit`}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Organisations : forfait actuel + override manuel ── */}
      <div style={{ ...cardStyle(), padding: 0, overflow: 'hidden' }}>
        <h3 style={{ margin: 0, padding: '18px 20px 4px', fontSize: '0.95rem', fontWeight: 800, color: '#02302D' }}>
          Organisations
        </h3>
        <div style={{ width: '100%', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.86rem' }}>
          <thead style={{ background: '#F8FAFB', borderBottom: '1px solid #E8ECE6' }}>
            <tr>
              {['Organisation', 'Forfait actuel', 'Actions'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '12px 20px', color: '#64748B', fontWeight: 700, fontSize: '0.76rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {organisations.length === 0 && (
              <tr>
                <td colSpan={3} style={{ padding: '24px 20px', color: '#64748B' }}>
                  {erreurChargement ? 'Liste non chargée.' : 'Aucune organisation pour le moment.'}
                </td>
              </tr>
            )}
            {organisations.map((o) => (
              <tr key={o.id} style={{ borderBottom: '1px solid #F1F4EE' }}>
                <td style={{ padding: '12px 20px', fontWeight: 700, color: '#02302D' }}>{o.nom}</td>
                <td style={{ padding: '12px 20px' }}>
                  <span style={{ background: '#EAF5EC', color: '#3C7730', fontWeight: 700, fontSize: '0.76rem', padding: '3px 10px', borderRadius: '9999px' }}>
                    {o.plan?.nom || '—'}
                  </span>
                </td>
                <td style={{ padding: '12px 20px' }}>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => setOrgPourChangement(o)}
                      className="btn-primary"
                      style={{ padding: '6px 12px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700, fontFamily: 'inherit' }}
                    >
                      Changer le forfait
                    </button>
                    <button
                      onClick={() => setOrgPourHistorique(o)}
                      className="btn-secondary"
                      style={{ padding: '6px 12px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700, fontFamily: 'inherit' }}
                    >
                      Historique
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {orgPourChangement && vueEnsemble && (
        <ModaleChangerForfait
          org={orgPourChangement}
          forfaits={vueEnsemble.repartition}
          onClose={() => setOrgPourChangement(null)}
          onSuccess={() => {
            setSucces(`Le forfait de « ${orgPourChangement.nom} » a été modifié. Le changement est enregistré dans l’historique.`);
            setOrgPourChangement(null);
            chargerTout();
          }}
        />
      )}

      {orgPourHistorique && (
        <ModaleHistorique org={orgPourHistorique} onClose={() => setOrgPourHistorique(null)} />
      )}
    </div>
  );
}
