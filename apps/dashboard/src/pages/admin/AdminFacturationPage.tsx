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
import { AlertTriangleIcon, ClockIcon, XCloseIcon, CheckCircleIcon } from '../../components/common/Icons';

const SOURCE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  stripe: { label: 'Stripe', color: '#3C7730', bg: '#EAF5EC' },
  admin_override: { label: 'Override Admin', color: '#B45309', bg: '#FEF3C7' },
  auto_downgrade: { label: 'Dégradation auto', color: '#B91C1C', bg: '#FEE2E2' },
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

  const soumettre = async () => {
    setErreur('');
    if (raison.trim().length < 10) {
      setErreur('La raison doit contenir au moins 10 caractères.');
      return;
    }
    if (!planId) {
      setErreur('Choisissez un forfait.');
      return;
    }
    setEnvoi(true);
    try {
      await organisationsApi.changerPlan(org.id, planId, raison.trim());
      onSuccess();
    } catch (err: any) {
      setErreur(err?.response?.data?.detail || 'Erreur lors du changement de forfait.');
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(15, 23, 42, 0.65)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
        padding: '16px', boxSizing: 'border-box',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '440px', maxWidth: '100%', background: '#FFFFFF', borderRadius: '20px',
          padding: '24px', boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
          <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#02302D' }}>Changer le forfait</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px' }}>
            <XCloseIcon size={18} color="#94A3B8" />
          </button>
        </div>
        <p style={{ margin: '4px 0 18px', fontSize: '0.84rem', color: '#64748B' }}>
          {org.nom} — forfait actuel : <strong>{org.plan?.nom || '—'}</strong>
        </p>

        <div
          style={{
            background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '10px', padding: '10px 12px',
            fontSize: '0.78rem', color: '#92400E', marginBottom: '16px', display: 'flex', gap: '8px',
          }}
        >
          <AlertTriangleIcon size={16} color="#B45309" />
          <span>Réservé aux cas exceptionnels (ex. partenariat négocié). Ce changement contourne Stripe et est tracé de façon permanente.</span>
        </div>

        <label style={{ display: 'block', fontWeight: 700, fontSize: '0.82rem', color: '#1E293B', marginBottom: '6px' }}>
          Nouveau forfait
        </label>
        <select value={planId} onChange={(e) => setPlanId(e.target.value)} className="saas-input" style={{ marginBottom: '14px', width: '100%' }}>
          <option value="">— Choisir —</option>
          {forfaits.map((f) => (
            <option key={f.id} value={f.id}>{f.nom}</option>
          ))}
        </select>

        <label style={{ display: 'block', fontWeight: 700, fontSize: '0.82rem', color: '#1E293B', marginBottom: '6px' }}>
          Raison (obligatoire, min. 10 caractères)
        </label>
        <textarea
          value={raison}
          onChange={(e) => setRaison(e.target.value)}
          rows={3}
          placeholder="ex : Partenariat négocié directement avec le client, forfait Pro offert pour 6 mois."
          className="saas-input"
          style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
        />

        {erreur && (
          <div style={{ marginTop: '10px', color: '#B91C1C', fontSize: '0.8rem', fontWeight: 600 }}>{erreur}</div>
        )}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '20px' }}>
          <button type="button" onClick={onClose} className="btn-secondary">Annuler</button>
          <button type="button" onClick={soumettre} disabled={envoi} className="btn-primary">
            {envoi ? 'Enregistrement…' : 'Confirmer le changement'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modale : historique des changements de forfait ───────────────────
function ModaleHistorique({ org, onClose }: { org: Organisation; onClose: () => void }) {
  const [historique, setHistorique] = useState<ChangementPlanHistoriqueItem[] | null>(null);

  useEffect(() => {
    let annule = false;
    adminFacturationApi.historique(org.id).then((res) => {
      if (!annule) setHistorique(res.data);
    });
    return () => { annule = true; };
  }, [org.id]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(15, 23, 42, 0.65)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
        padding: '16px', boxSizing: 'border-box',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '520px', maxWidth: '100%', maxHeight: '80vh', overflowY: 'auto', background: '#FFFFFF',
          borderRadius: '20px', padding: '24px', boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#02302D' }}>Historique du forfait</h3>
            <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: '#64748B' }}>{org.nom}</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px' }}>
            <XCloseIcon size={18} color="#94A3B8" />
          </button>
        </div>

        {historique === null ? (
          <div style={{ color: '#94A3B8', fontSize: '0.84rem' }}>Chargement…</div>
        ) : historique.length === 0 ? (
          <div style={{ color: '#94A3B8', fontSize: '0.84rem' }}>Aucun changement de forfait enregistré.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {historique.map((h) => {
              const src = SOURCE_LABELS[h.source] || { label: h.source, color: '#475569', bg: '#F1F5F9' };
              return (
                <div key={h.id} style={{ border: '1px solid #E8ECE6', borderRadius: '12px', padding: '10px 12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.84rem', color: '#02302D' }}>
                      {h.ancien_plan_nom || '—'} → {h.nouveau_plan_nom}
                    </span>
                    <span style={{ background: src.bg, color: src.color, fontWeight: 700, fontSize: '0.68rem', padding: '2px 8px', borderRadius: '9999px' }}>
                      {src.label}
                    </span>
                  </div>
                  {h.raison && <div style={{ fontSize: '0.8rem', color: '#475569', marginBottom: '4px' }}>{h.raison}</div>}
                  <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>
                    {new Date(h.created_at).toLocaleString('fr-FR')}
                    {h.modifie_par_nom && ` · ${h.modifie_par_nom}`}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminFacturationPage() {
  const user = useAuthStore((s) => s.user);
  if (user?.role !== 'admin') {
    return <Navigate to="/siege" replace />;
  }

  const [vueEnsemble, setVueEnsemble] = useState<VueEnsembleFacturation | null>(null);
  const [paiementsEchoues, setPaiementsEchoues] = useState<OrganisationPaiementEchoue[] | null>(null);
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [loading, setLoading] = useState(true);
  const [orgPourChangement, setOrgPourChangement] = useState<Organisation | null>(null);
  const [orgPourHistorique, setOrgPourHistorique] = useState<Organisation | null>(null);

  const chargerTout = () => {
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
            Conversion Gratuit→payant (30j)
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
          Triés par proximité de la dégradation automatique en Gratuit (7 jours de grâce).
        </p>

        {!paiementsEchoues || paiementsEchoues.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#3C7730', fontSize: '0.84rem', fontWeight: 600 }}>
            <CheckCircleIcon size={16} color="#3C7730" />
            Aucun paiement en échec actuellement.
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
                      ? 'Dégradation imminente'
                      : `${p.jours_restants_avant_degradation} jour(s) avant dégradation`}
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
                      style={{ background: '#FFFFFF', color: '#02302D', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '6px 12px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700, fontFamily: 'inherit' }}
                    >
                      Changer le forfait
                    </button>
                    <button
                      onClick={() => setOrgPourHistorique(o)}
                      style={{ background: '#FFFFFF', color: '#475569', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '6px 12px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700, fontFamily: 'inherit' }}
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

      {orgPourChangement && vueEnsemble && (
        <ModaleChangerForfait
          org={orgPourChangement}
          forfaits={vueEnsemble.repartition}
          onClose={() => setOrgPourChangement(null)}
          onSuccess={() => {
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
