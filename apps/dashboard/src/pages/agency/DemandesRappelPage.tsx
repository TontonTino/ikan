/**
 * Page "Demandes de rappel" — suivi des demandes de contact client (CX Manager & Agency
 * Manager). Backend déjà scopé par rôle (organisation pour le CX Manager, agence forcée
 * pour l'Agency Manager) — voir GET /feedbacks/demandes-contact.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { demandesContactApi, agencesApi } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import type { DemandeContactListItem, Agence } from '../../types';
import AgenceFilterSelect from '../../components/stats/AgenceFilterSelect';
import { StatsErrorState } from '../../components/stats/StatsStates';
import EmptyState from '../../components/ui/EmptyState';
import SkeletonBlock from '../../components/ui/SkeletonBlock';
import SectionHeading from '../../components/ui/SectionHeading';
import { PhoneIcon, MailIcon, CheckCircleIcon, AlertTriangleIcon } from '../../components/common/Icons';

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });

export default function DemandesRappelPage() {
  const user = useAuthStore((s) => s.user);
  const isCXManager = user?.role === 'cx_manager';

  const [toggle, setToggle] = useState<'attente' | 'traitees'>('attente');
  const [demandes, setDemandes] = useState<DemandeContactListItem[]>([]);
  const [demandesTotal, setDemandesTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [firstLoadDone, setFirstLoadDone] = useState(false);
  const requestIdRef = useRef(0);

  const [agencesList, setAgencesList] = useState<Agence[]>([]);
  const [selectedAgenceId, setSelectedAgenceId] = useState<string | null>(null);

  const [toast, setToast] = useState('');
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  useEffect(() => {
    // Le filtre par agence n'a de sens que pour le CX Manager (réseau multi-agences).
    if (!isCXManager) return;
    agencesApi
      .list()
      .then((res) => {
        if (Array.isArray(res.data)) setAgencesList(res.data);
      })
      .catch(() => setAgencesList([]));
  }, [isCXManager]);

  const fetchDemandes = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setLoadingMore(false);
    setError(false);
    try {
      const params: { traitee: boolean; agence_id?: string; limit: number; offset: number } = { traitee: toggle === 'traitees', limit: 50, offset: 0 };
      if (isCXManager && selectedAgenceId) params.agence_id = selectedAgenceId;
      const res = await demandesContactApi.list(params);
      if (requestId === requestIdRef.current) {
        setDemandes(res.data || []);
        setDemandesTotal(Number(res.headers?.['x-total-count'] || 0));
      }
    } catch {
      if (requestId === requestIdRef.current) setError(true);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
        setFirstLoadDone(true);
      }
    }
  }, [toggle, isCXManager, selectedAgenceId]);

  const loadMoreDemandes = async () => {
    if (loadingMore || demandes.length >= demandesTotal) return;
    const requestId = requestIdRef.current;
    setLoadingMore(true);
    try {
      const params: { traitee: boolean; agence_id?: string; limit: number; offset: number } = {
        traitee: toggle === 'traitees', limit: 50, offset: demandes.length,
      };
      if (isCXManager && selectedAgenceId) params.agence_id = selectedAgenceId;
      const response = await demandesContactApi.list(params);
      if (requestId === requestIdRef.current) setDemandes((current) => [...current, ...(response.data || [])]);
    } catch {
      if (requestId === requestIdRef.current) showToast('Impossible de charger les demandes suivantes');
    } finally {
      if (requestId === requestIdRef.current) setLoadingMore(false);
    }
  };

  useEffect(() => {
    fetchDemandes();
    return () => { requestIdRef.current += 1; };
  }, [fetchDemandes]);

  const marquerTraitee = async (id: string) => {
    try {
      await demandesContactApi.traiter(id);
      // La liste courante ne contient que le sous-ensemble du toggle actif (le serveur
      // refiltre à chaque changement de toggle) : on retire simplement la carte plutôt que
      // de la faire "basculer" côté Traitées, ce qui exigerait un état à deux listes tenues
      // en parallèle pour un bénéfice minime.
      setDemandes((prev) => prev.filter((d) => d.id !== id));
      setDemandesTotal((total) => Math.max(0, total - 1));
      showToast('Demande marquée comme traitée');
    } catch {
      showToast('Erreur lors de la mise à jour');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
      {toast && (
        <div style={{ position: 'fixed', top: '24px', right: '24px', zIndex: 1000, background: '#02302D', color: 'white', padding: '12px 20px', borderRadius: '12px', fontWeight: 700 }}>
          {toast}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div
          style={{
            display: 'inline-flex',
            padding: '4px',
            background: '#F8FAFB',
            border: '1px solid #E2E8F0',
            borderRadius: '12px',
            width: 'fit-content',
          }}
        >
          <button
            type="button"
            onClick={() => setToggle('attente')}
            style={{
              padding: '7px 16px',
              borderRadius: '9px',
              border: 'none',
              fontSize: '0.82rem',
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'inherit',
              background: toggle === 'attente' ? '#FEF3C7' : 'transparent',
              color: toggle === 'attente' ? '#B45309' : '#64748B',
            }}
          >
            En attente
          </button>
          <button
            type="button"
            onClick={() => setToggle('traitees')}
            style={{
              padding: '7px 16px',
              borderRadius: '9px',
              border: 'none',
              fontSize: '0.82rem',
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'inherit',
              background: toggle === 'traitees' ? '#EBF5E9' : 'transparent',
              color: toggle === 'traitees' ? '#3C7730' : '#64748B',
            }}
          >
            Traitées
          </button>
        </div>
        {isCXManager && (
          <AgenceFilterSelect agences={agencesList} selectedId={selectedAgenceId} onChange={setSelectedAgenceId} />
        )}
      </div>

      <SectionHeading>Demandes de rappel ({firstLoadDone ? `${demandes.length}/${demandesTotal}` : '…'})</SectionHeading>

      {error ? (
        <StatsErrorState message="Impossible de charger les demandes de rappel." onRetry={fetchDemandes} />
      ) : loading ? (
        <div aria-busy="true" aria-label="Chargement des demandes de rappel" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {[0, 1, 2].map((i) => (
            <SkeletonBlock key={i} height={110} radius="var(--radius-2xl)" />
          ))}
        </div>
      ) : demandes.length === 0 ? (
        toggle === 'attente' ? (
          <div className="saas-card saas-card--success">
            <EmptyState
              illustration="no-alert"
              title="Aucune demande en attente"
              message="Toutes les demandes de rappel ont été traitées."
            />
          </div>
        ) : (
          <EmptyState
            illustration="no-data"
            title="Aucune demande traitée"
            message="Les demandes marquées comme traitées apparaîtront ici."
          />
        )
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {demandes.map((d) => (
            <div
              key={d.id}
              style={{
                background: '#FFFFFF',
                border: '1px solid #E8ECE6',
                borderRadius: '24px',
                padding: '20px 24px',
                boxShadow: '0 2px 10px rgba(0,0,0,0.02)',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {isCXManager && d.agence_nom && (
                    <span style={{ fontSize: '0.76rem', fontWeight: 800, color: '#3C7730', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      {d.agence_nom}
                    </span>
                  )}
                  <h3 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 800, color: '#02302D' }}>
                    {d.nom || 'Client anonyme'}
                  </h3>
                </div>
                <span style={{ fontSize: '0.78rem', color: '#94A3B8', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  Demandé le {formatDate(d.date_demande)}
                </span>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', fontSize: '0.84rem' }}>
                {d.telephone && (
                  <a
                    href={`tel:${d.telephone}`}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#3C7730', fontWeight: 700, textDecoration: 'none' }}
                  >
                    <PhoneIcon size={14} color="#3C7730" />
                    {d.telephone}
                  </a>
                )}
                {d.email && (
                  <a
                    href={`mailto:${d.email}`}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#3C7730', fontWeight: 700, textDecoration: 'none' }}
                  >
                    <MailIcon size={14} color="#3C7730" />
                    {d.email}
                  </a>
                )}
                {!d.telephone && !d.email && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#B45309', fontWeight: 700 }}>
                    <AlertTriangleIcon size={14} color="#B45309" />
                    Aucune coordonnée laissée par le client
                  </span>
                )}
              </div>

              <div style={{ background: '#F8FAFB', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '12px 14px' }}>
                <div style={{ fontSize: '0.74rem', color: '#64748B', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '4px' }}>
                  Feedback lié — Note {d.feedback_note}/5
                </div>
                <p style={{ margin: 0, fontSize: '0.86rem', color: '#334155', lineHeight: 1.5 }}>
                  {d.feedback_commentaire || 'Aucun commentaire.'}
                </p>
              </div>

              {toggle === 'attente' && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #F1F4EE', paddingTop: '12px' }}>
                  <button
                    type="button"
                    onClick={() => marquerTraitee(d.id)}
                    className="btn-primary"
                    style={{ padding: '8px 16px', fontSize: '0.8rem', borderRadius: '10px', fontWeight: 800 }}
                  >
                    <CheckCircleIcon size={15} />
                    Marquer traitée
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {!loading && !error && demandes.length < demandesTotal && (
        <button type="button" onClick={loadMoreDemandes} disabled={loadingMore} className="btn-secondary" style={{ alignSelf: 'center' }}>
          {loadingMore ? 'Chargement…' : 'Charger plus de demandes'}
        </button>
      )}
    </div>
  );
}
