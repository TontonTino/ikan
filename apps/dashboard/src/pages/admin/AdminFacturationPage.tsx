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
import { formaterPourcentage } from '../../utils/formatNombre';

const SOURCE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  stripe: { label: 'Stripe', color: 'var(--color-bon-texte)', bg: 'var(--color-bon-fond)' },
  admin_override: { label: 'Changement manuel (admin)', color: 'var(--color-surveiller-texte)', bg: 'var(--color-surveiller-fond)' },
  auto_downgrade: { label: 'Retour automatique au forfait Gratuit', color: 'var(--color-critique-texte)', bg: 'var(--color-critique-fond)' },
};

function cardStyle(): React.CSSProperties {
  return {
    background: 'var(--color-surface)',
    borderRadius: '18px',
    border: '1px solid var(--color-trait)',
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
            background: 'var(--color-surveiller-fond)', border: '1px solid var(--color-surveiller-fond)', borderRadius: '10px', padding: '10px 12px',
            fontSize: 'var(--text-xs)', color: 'var(--color-surveiller-texte)', display: 'flex', gap: '8px', lineHeight: 1.5,
          }}
        >
          <AlertTriangleIcon size={16} color="var(--color-surveiller-texte)" />
          <span>Réservé aux cas exceptionnels (ex. partenariat négocié). Ce changement contourne Stripe et est tracé de façon permanente, avec votre nom et la raison saisie.</span>
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-sm)', color: 'var(--color-encre)' }}>
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

        <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-sm)', color: 'var(--color-encre)' }}>
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
          <div role="alert" className="t-critique t-sm t-semi">{erreur}</div>
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
          <span className="t-critique t-semi t-sm">{erreur}</span>
          <span className="t-2 t-xs">Cela ne signifie pas qu’aucun changement n’a eu lieu.</span>
          <Button size="sm" variant="secondary" onClick={() => setRechargement((n) => n + 1)}>Réessayer</Button>
        </div>
      ) : historique === null ? (
        <div aria-busy="true" className="t-2 t-sm">Chargement…</div>
      ) : historique.length === 0 ? (
        <EmptyState title="Aucun changement de forfait" message="Aucun changement de forfait enregistré." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {historique.map((h) => {
            const src = SOURCE_LABELS[h.source] || { label: 'Autre origine', color: 'var(--color-text-2)', bg: 'var(--color-neutre-fond)' };
            return (
              <div key={h.id} style={{ border: '1px solid var(--color-trait)', borderRadius: '12px', padding: '10px 12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px', gap: '8px', flexWrap: 'wrap' }}>
                  <span className="t-semi t-sm t-encre">
                    {h.ancien_plan_nom || '—'} → {h.nouveau_plan_nom}
                  </span>
                  <span style={{ background: src.bg, color: src.color, fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-xs)', padding: '2px 8px', borderRadius: '9999px' }}>
                    {src.label}
                  </span>
                </div>
                {h.raison && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-2)', marginBottom: '4px' }}>{h.raison}</div>}
                <div className="t-xs t-2">
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
    return <div style={{ color: 'var(--color-text-2)', padding: '32px', fontWeight: 'var(--weight-semibold)' }}>Chargement de la facturation…</div>;
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
            <div style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-2)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
              {r.nom}
            </div>
            <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-encre)', marginTop: '4px' }}>{r.nombre}</div>
          </div>
        ))}
        <div style={{ ...cardStyle(), background: 'var(--color-bon-fond)', border: '1px solid var(--color-trait)' }}>
          <div style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-bon-texte)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
            Passage du forfait Gratuit à un forfait payant (30 jours)
          </div>
          <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-encre)', marginTop: '4px' }}>
            {vueEnsemble?.taux_conversion_30j === null || vueEnsemble?.taux_conversion_30j === undefined
              ? '—'
              : formaterPourcentage(Math.round(vueEnsemble.taux_conversion_30j * 100), 0)}
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-bon-texte)', marginTop: '2px' }}>
            {vueEnsemble?.nb_conversions_30j ?? 0} conversion(s) / {vueEnsemble?.nb_base_calcul_30j ?? 0} organisation(s)
          </div>
        </div>
      </div>

      {/* ── Paiements en échec ── */}
      <div style={cardStyle()}>
        <h3 style={{ margin: '0 0 4px', fontSize: 'var(--text-base)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-encre)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <AlertTriangleIcon size={18} color="var(--color-critique-texte)" />
          Paiements en échec
        </h3>
        <p style={{ margin: '0 0 14px', fontSize: 'var(--text-xs)', color: 'var(--color-text-2)' }}>
          Triés par date du retour automatique au forfait Gratuit (7 jours de délai après l’échec).
        </p>

        {!paiementsEchoues ? (
          <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-text-2)' }}>
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
                    background: critique ? 'var(--color-critique-fond)' : 'var(--color-surveiller-fond)',
                    border: `1px solid ${critique ? 'var(--color-critique-fond)' : 'var(--color-surveiller-fond)'}`,
                  }}
                >
                  <div>
                    <span className="t-semi t-encre t-sm">{p.organisation_nom}</span>
                    <span style={{ marginLeft: '10px', color: 'var(--color-text-2)', fontSize: 'var(--text-xs)' }}>Forfait {p.plan_nom}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: critique ? 'var(--color-critique-texte)' : 'var(--color-surveiller-texte)', fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-xs)' }}>
                    <ClockIcon size={14} color={critique ? 'var(--color-critique-texte)' : 'var(--color-surveiller-texte)'} />
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
        <h3 style={{ margin: 0, padding: '18px 20px 4px', fontSize: 'var(--text-base)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-encre)' }}>
          Organisations
        </h3>
        <div style={{ width: '100%', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
          <thead style={{ background: 'var(--color-bg)', borderBottom: '1px solid var(--color-trait)' }}>
            <tr>
              {['Organisation', 'Forfait actuel', 'Actions'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '12px 20px', color: 'var(--color-text-2)', fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {organisations.length === 0 && (
              <tr>
                <td colSpan={3} style={{ padding: '24px 20px', color: 'var(--color-text-2)' }}>
                  {erreurChargement ? 'Liste non chargée.' : 'Aucune organisation pour le moment.'}
                </td>
              </tr>
            )}
            {organisations.map((o) => (
              <tr key={o.id} style={{ borderBottom: '1px solid var(--color-trait)' }}>
                <td style={{ padding: '12px 20px', fontWeight: 'var(--weight-semibold)', color: 'var(--color-encre)' }}>{o.nom}</td>
                <td style={{ padding: '12px 20px' }}>
                  <span style={{ background: 'var(--color-bon-fond)', color: 'var(--color-bon-texte)', fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-xs)', padding: '3px 10px', borderRadius: '9999px' }}>
                    {o.plan?.nom || '—'}
                  </span>
                </td>
                <td style={{ padding: '12px 20px' }}>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => setOrgPourChangement(o)}
                      className="btn-primary"
                      style={{ padding: '6px 12px', cursor: 'pointer', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', fontFamily: 'inherit' }}
                    >
                      Changer le forfait
                    </button>
                    <button
                      onClick={() => setOrgPourHistorique(o)}
                      className="btn-secondary"
                      style={{ padding: '6px 12px', cursor: 'pointer', fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', fontFamily: 'inherit' }}
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
