/**
 * Page "Demandes de rappel" — suivi des demandes de contact client (CX Manager & Agency
 * Manager). Backend déjà scopé par rôle (organisation pour le CX Manager, agence forcée
 * pour l'Agency Manager) — voir GET /feedbacks/demandes-contact.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { demandesContactApi, agencesApi } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { parametresDemandes } from './demandesRappelParams';
import type { DemandeContactListItem, Agence } from '../../types';
import AgenceFilterSelect from '../../components/stats/AgenceFilterSelect';
import { StatsErrorState } from '../../components/stats/StatsStates';
import EmptyState from '../../components/ui/EmptyState';
import WhatsAppReplyButton from '../../components/feedbacks/WhatsAppReplyButton';
import { ConfirmationRecontact, CoordonneesMasquees, ConsentementContact, InfoTraitement } from '../../components/feedbacks/DemandeContactBlocs';
import SkeletonBlock from '../../components/ui/SkeletonBlock';
import SectionHeading from '../../components/ui/SectionHeading';
import PageTitle from '../../components/ui/PageTitle';
import { PhoneIcon, MailIcon, CheckCircleIcon, AlertTriangleIcon } from '../../components/common/Icons';

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });

/**
 * `agenceId` (aperçu d'agence du CX Manager) fixe l'agence : elle est transmise au serveur, qui l'ajoute à son
 * propre périmètre (jamais une autorisation) ; le sélecteur d'agence disparaît alors.
 */
export default function DemandesRappelPage({ agenceId }: { agenceId?: string } = {}) {
  const user = useAuthStore((s) => s.user);
  const isCXManager = user?.role === 'cx_manager';
  const isAgencyManager = user?.role === 'agency_manager';

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
  const agenceFiltre = agenceId ?? (isCXManager ? selectedAgenceId : null);

  // Demande dont la confirmation « Marquer comme recontacté » est ouverte (le masquage est définitif), et celle en cours d'envoi.
  const [aConfirmer, setAConfirmer] = useState<string | null>(null);
  const [enregistrement, setEnregistrement] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  useEffect(() => {
    // Le filtre par agence n'a de sens que pour le CX Manager (réseau multi-agences).
    if (!isCXManager || agenceId) return;
    agencesApi
      .list()
      .then((res) => {
        if (Array.isArray(res.data)) setAgencesList(res.data);
      })
      .catch(() => setAgencesList([]));
  }, [isCXManager, agenceId]);

  const fetchDemandes = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setLoadingMore(false);
    setError(false);
    try {
      const res = await demandesContactApi.list(parametresDemandes(toggle === 'traitees', agenceFiltre, 0));
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
  }, [toggle, agenceFiltre]);

  const loadMoreDemandes = async () => {
    if (loadingMore || demandes.length >= demandesTotal) return;
    const requestId = requestIdRef.current;
    setLoadingMore(true);
    try {
      const response = await demandesContactApi.list(parametresDemandes(toggle === 'traitees', agenceFiltre, demandes.length));
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
    setEnregistrement(id);
    try {
      await demandesContactApi.traiter(id);
      // La liste courante ne contient que le sous-ensemble du toggle actif (le serveur
      // refiltre à chaque changement de toggle) : on retire simplement la carte plutôt que
      // de la faire "basculer" côté Traitées, ce qui exigerait un état à deux listes tenues
      // en parallèle pour un bénéfice minime.
      setDemandes((prev) => prev.filter((d) => d.id !== id));
      setDemandesTotal((total) => Math.max(0, total - 1));
      showToast('Client recontacté : ses coordonnées sont masquées.');
    } catch {
      showToast('Impossible d’enregistrer. Réessayez.');
    } finally {
      setEnregistrement(null);
      setAConfirmer(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
      {/* Page autonome : même titre que l'entrée de menu (lot 4). Dans l'aperçu d'une agence, l'onglet porte déjà le nom. */}
      {!agenceId && <PageTitle title="Demandes de rappel" description="Clients qui ont demandé à être recontactés après leur avis." />}
      {toast && (
        <div style={{ position: 'fixed', top: '24px', right: '24px', zIndex: 1000, background: 'var(--color-encre)', color: 'white', padding: '12px 20px', borderRadius: '12px', fontWeight: 'var(--weight-semibold)' }}>
          {toast}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div
          style={{
            display: 'inline-flex',
            padding: '4px',
            background: 'var(--color-bg)',
            border: '1px solid var(--color-trait)',
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
              fontSize: 'var(--text-sm)',
              fontWeight: 'var(--weight-semibold)',
              cursor: 'pointer',
              fontFamily: 'inherit',
              background: toggle === 'attente' ? 'var(--color-surface)' : 'transparent',
              color: toggle === 'attente' ? 'var(--color-encre)' : 'var(--color-text-2)',
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
              fontSize: 'var(--text-sm)',
              fontWeight: 'var(--weight-semibold)',
              cursor: 'pointer',
              fontFamily: 'inherit',
              background: toggle === 'traitees' ? 'var(--color-surface)' : 'transparent',
              color: toggle === 'traitees' ? 'var(--color-encre)' : 'var(--color-text-2)',
            }}
          >
            Traitées
          </button>
        </div>
        {isCXManager && !agenceId && (
          <AgenceFilterSelect agences={agencesList} selectedId={selectedAgenceId} onChange={setSelectedAgenceId} />
        )}
      </div>

      <SectionHeading>Demandes de rappel ({firstLoadDone && !error ? `${demandes.length}/${demandesTotal}` : '…'})</SectionHeading>

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
                background: 'var(--color-surface)',
                border: '1px solid var(--color-trait)',
                borderRadius: '24px',
                padding: '20px 24px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {isCXManager && d.agence_nom && (
                    <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-bon-texte)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      {d.agence_nom}
                    </span>
                  )}
                  <h3 style={{ margin: 0, fontSize: 'var(--text-base)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-encre)' }}>
                    {d.nom || 'Client anonyme'}
                  </h3>
                </div>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-2)', fontWeight: 'var(--weight-semibold)', whiteSpace: 'nowrap' }}>
                  Demandé le {formatDate(d.date_demande)}
                </span>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', fontSize: 'var(--text-sm)' }}>
                {d.telephone && (
                  <a
                    href={`tel:${d.telephone}`}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', minHeight: 44, color: 'var(--color-bon-texte)', fontWeight: 'var(--weight-semibold)', textDecoration: 'none' }}
                  >
                    <PhoneIcon size={14} color="var(--color-bon-texte)" />
                    {d.telephone}
                  </a>
                )}
                {d.email && (
                  <a
                    href={`mailto:${d.email}`}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', minHeight: 44, color: 'var(--color-bon-texte)', fontWeight: 'var(--weight-semibold)', textDecoration: 'none' }}
                  >
                    <MailIcon size={14} color="var(--color-bon-texte)" />
                    {d.email}
                  </a>
                )}
                {d.coordonnees_masquees && <CoordonneesMasquees />}
                {!d.coordonnees_masquees && !d.telephone && !d.email && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--color-surveiller-texte)', fontWeight: 'var(--weight-semibold)' }}>
                    <AlertTriangleIcon size={14} color="var(--color-surveiller-texte)" />
                    Aucune coordonnée laissée par le client
                  </span>
                )}
              </div>

              <div style={{ background: 'var(--color-bg)', border: '1px solid var(--color-trait)', borderRadius: '12px', padding: '12px 14px' }}>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-2)', fontWeight: 'var(--weight-semibold)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '4px' }}>
                  Avis lié — Note {d.feedback_note}/5
                </div>
                <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-encre)', lineHeight: 1.5 }}>
                  {d.feedback_commentaire || 'Aucun commentaire.'}
                </p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <InfoTraitement demande={d} />
                <ConsentementContact demande={d} />
              </div>

              {isAgencyManager && !d.coordonnees_masquees && (
                <WhatsAppReplyButton telephone={d.telephone} telephoneWhatsapp={d.telephone_whatsapp} masque={d.coordonnees_masquees} />
              )}

              {toggle === 'attente' && aConfirmer === d.id && (
                <ConfirmationRecontact chargement={enregistrement === d.id} onAnnuler={() => setAConfirmer(null)} onConfirmer={() => marquerTraitee(d.id)} />
              )}

              {toggle === 'attente' && aConfirmer !== d.id && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--color-trait)', paddingTop: '12px' }}>
                  <button
                    type="button"
                    onClick={() => setAConfirmer(d.id)}
                    className="btn-primary"
                    style={{ padding: '8px 16px', fontSize: 'var(--text-xs)', borderRadius: '10px', fontWeight: 'var(--weight-semibold)', minHeight: 44 }}
                    title="À utiliser une fois le client recontacté : ses coordonnées seront masquées. Ce marquage ne modifie pas le statut de l’avis."
                  >
                    <CheckCircleIcon size={15} />
                    Marquer comme recontacté
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
