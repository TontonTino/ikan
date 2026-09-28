import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { alertesApi, suggestionsApi, recommandationsApi, agencesApi, feedbacksApi } from '../../services/api';
import type { Alerte, AlerteFeedback, Suggestion, IdeaStatus, RecommandationOrg, Agence, Feedback } from '../../types';
import TabsNavigation, { TabItem } from '../../components/ui/TabsNavigation';
import RecommandationCard from '../../components/stats/RecommandationCard';
import AgenceFilterSelect from '../../components/stats/AgenceFilterSelect';
import EmptyState from '../../components/ui/EmptyState';
import SkeletonBlock from '../../components/ui/SkeletonBlock';
import SectionHeading from '../../components/ui/SectionHeading';
import {
  BellIcon,
  LightningIcon,
  LightbulbIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
  TargetIcon,
} from '../../components/common/Icons';

const STATUS_LABELS: Record<IdeaStatus, string> = {
  nouveau: 'Nouveau',
  en_cours: 'En cours',
  traite: 'Traité',
  rejete: 'Rejeté',
};

const STATUS_STYLE: Record<IdeaStatus, { bg: string; text: string; border: string }> = {
  nouveau: { bg: '#E0F2FE', text: '#0369A1', border: '#BAE6FD' },
  en_cours: { bg: '#FEF3C7', text: '#B45309', border: '#FDE68A' },
  traite: { bg: '#EBF5E9', text: '#3C7730', border: '#D5E8D3' },
  rejete: { bg: '#FEE2E2', text: '#B91C1C', border: '#FCA5A5' },
};

const NEXT_STATUS: Record<IdeaStatus, IdeaStatus | null> = {
  nouveau: 'en_cours',
  en_cours: 'traite',
  traite: null,
  rejete: null,
};

type PilotageTab = 'alertes_actions' | 'idees' | 'actions_correctives';

/**
 * Page fusionnée "Pilotage" : regroupe Alertes & Actions (alertes réseau +
 * recommandations IA consolidées, déplacées depuis Statistiques & Analyses)
 * et Boîte à idées en une seule page à 2 onglets, pour le CX Manager (réseau)
 * et l'Agency Manager (limité à sa seule agence — le scoping est fait par l'API).
 */
export default function PilotagePage() {
  const currentUser = useAuthStore((s) => s.user);
  const isAgencyManager = currentUser?.role === 'agency_manager';

  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  // Un ancien lien "?tab=action" (onglet désormais fusionné) retombe simplement
  // sur l'onglet par défaut "Alertes & Recommandations".
  const initialTab: PilotageTab =
    requestedTab === 'idees' ? 'idees' : requestedTab === 'actions' ? 'actions_correctives' : 'alertes_actions';
  const [activeTab, setActiveTab] = useState<PilotageTab>(initialTab);

  // Alias URL court pour l'onglet "Actions correctives" (?tab=actions plutôt
  // que ?tab=actions_correctives), même logique que ?tab=idees existant.
  const TAB_URL_PARAM: Record<PilotageTab, string | null> = {
    alertes_actions: null,
    idees: 'idees',
    actions_correctives: 'actions',
  };

  const handleTabChange = (id: string) => {
    const tab = id as PilotageTab;
    setActiveTab(tab);
    const param = TAB_URL_PARAM[tab];
    setSearchParams(param ? { tab: param } : {}, { replace: true });
  };

  const [toast, setToast] = useState('');
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  // ── Alertes ──────────────────────────────────────────
  const [alertes, setAlertes] = useState<Alerte[]>([]);
  const [alertesFeedback, setAlertesFeedback] = useState<AlerteFeedback[]>([]);
  const [alertesLoading, setAlertesLoading] = useState(true);

  useEffect(() => {
    alertesApi
      .list()
      .then((r) => {
        setAlertes(r.data?.alertes_seuil || []);
        setAlertesFeedback(r.data?.alertes_feedback || []);
      })
      .catch(() => {
        setAlertes([]);
        setAlertesFeedback([]);
      })
      .finally(() => setAlertesLoading(false));
  }, []);

  const RAISON_LABELS: Record<string, string> = {
    negatif: 'Négatif',
    suggestion: 'Suggestion',
    negatif_et_suggestion: 'Négatif + Suggestion',
  };

  const totalAlertes = alertes.length + alertesFeedback.length;

  // ── Action (recommandations IA consolidées réseau) ───
  const [recos, setRecos] = useState<RecommandationOrg[]>([]);
  const [recosLoading, setRecosLoading] = useState(true);
  const [agencesList, setAgencesList] = useState<Agence[]>([]);
  const [selectedAgenceId, setSelectedAgenceId] = useState<string | null>(null);

  useEffect(() => {
    // Le filtre par agence n'a de sens que pour le CX Manager (réseau multi-agences).
    if (isAgencyManager) return;
    agencesApi
      .list()
      .then((res) => {
        if (Array.isArray(res.data)) setAgencesList(res.data);
      })
      .catch(() => setAgencesList([]));
  }, []);

  const fetchRecos = useCallback(async () => {
    setRecosLoading(true);
    try {
      const res = await recommandationsApi.listOrganisation();
      setRecos(res.data || []);
    } catch {
      setRecos([]);
    } finally {
      setRecosLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRecos();
  }, [fetchRecos]);

  const marquerRecoTraitee = async (id: string) => {
    try {
      await recommandationsApi.marquerTraitee(id);
      setRecos((prev) => prev.filter((r) => r.id !== id));
    } catch {
      // Silencieux : la recommandation reste visible, l'utilisateur peut réessayer
    }
  };

  const recosAffichees = useMemo(() => {
    return selectedAgenceId ? recos.filter((r) => r.agence_id === selectedAgenceId) : recos;
  }, [recos, selectedAgenceId]);

  // ── Boîte à idées ─────────────────────────────────────
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(true);
  const [ideesSubTab, setIdeesSubTab] = useState<'toutes' | 'a_etudier' | 'decisions'>('toutes');

  useEffect(() => {
    suggestionsApi
      .list()
      .then((r) => setSuggestions(r.data || []))
      .catch(() => setSuggestions([]))
      .finally(() => setSuggestionsLoading(false));
  }, []);

  const updateStatut = async (id: string, statut: IdeaStatus) => {
    try {
      await suggestionsApi.updateStatut(id, statut);
      setSuggestions((prev) => prev.map((s) => (s.id === id ? { ...s, statut } : s)));
      showToast(`Statut mis à jour : ${STATUS_LABELS[statut]}`);
    } catch {
      showToast('Erreur lors de la mise à jour');
    }
  };

  const aEtudierCount = useMemo(
    () => suggestions.filter((s) => s.statut === 'nouveau' || s.statut === 'en_cours').length,
    [suggestions]
  );
  const decisionsCount = useMemo(
    () => suggestions.filter((s) => s.statut === 'traite' || s.statut === 'rejete').length,
    [suggestions]
  );
  const filteredSuggestions = useMemo(() => {
    if (ideesSubTab === 'a_etudier') return suggestions.filter((s) => s.statut === 'nouveau' || s.statut === 'en_cours');
    if (ideesSubTab === 'decisions') return suggestions.filter((s) => s.statut === 'traite' || s.statut === 'rejete');
    return suggestions;
  }, [suggestions, ideesSubTab]);

  const ideesTabsConfig: TabItem[] = [
    { id: 'toutes', label: 'Toutes les idées', icon: <LightbulbIcon size={16} />, badge: suggestions.length },
    {
      id: 'a_etudier',
      label: 'À étudier',
      icon: <ClockIcon size={16} />,
      badge: aEtudierCount,
      badgeColor: aEtudierCount > 0 ? 'red' : 'default',
    },
    { id: 'decisions', label: 'Décisions prises', icon: <CheckCircleIcon size={16} />, badge: decisionsCount },
  ];

  // ── Actions correctives (suivi + confirmation, pas de création ici) ──
  const [actionsToggle, setActionsToggle] = useState<'en_cours' | 'terminees'>('en_cours');
  const [actionsEnCours, setActionsEnCours] = useState<Feedback[]>([]);
  const [actionsTerminees, setActionsTerminees] = useState<Feedback[]>([]);
  const [actionsLoading, setActionsLoading] = useState(true);
  const [actionsFirstLoadDone, setActionsFirstLoadDone] = useState(false);
  const [actionsAgenceId, setActionsAgenceId] = useState<string | null>(null);

  const fetchActions = useCallback(async () => {
    setActionsLoading(true);
    try {
      const agenceParam = actionsAgenceId ? { agence_id: actionsAgenceId } : {};
      const [enCoursRes, termineesRes] = await Promise.all([
        feedbacksApi.list({ avec_action: true, action_realisee: false, ...agenceParam }),
        feedbacksApi.list({ avec_action: true, action_realisee: true, ...agenceParam }),
      ]);
      setActionsEnCours(enCoursRes?.data || []);
      setActionsTerminees(termineesRes?.data || []);
    } catch {
      setActionsEnCours([]);
      setActionsTerminees([]);
    } finally {
      setActionsLoading(false);
      setActionsFirstLoadDone(true);
    }
  }, [actionsAgenceId]);

  useEffect(() => {
    fetchActions();
  }, [fetchActions]);

  const marquerActionRealisee = async (feedbackId: string) => {
    try {
      await feedbacksApi.confirmerActionRealisee(feedbackId);
      setActionsEnCours((prev) => prev.filter((f) => f.id !== feedbackId));
      showToast('Action marquée comme réalisée');
    } catch {
      showToast("Erreur lors de la confirmation de l'action");
    }
  };

  const actionsAffichees = actionsToggle === 'en_cours' ? actionsEnCours : actionsTerminees;

  const extraitCommentaire = (texte?: string, max = 140) => {
    if (!texte) return 'Aucun commentaire.';
    return texte.length > max ? `${texte.slice(0, max)}…` : texte;
  };

  const formatDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : null);

  // Badge combiné : total des éléments nécessitant une action dans cet onglet
  // fusionné (alertes actives + recommandations en attente), plus lisible
  // qu'un seul des deux compteurs isolément puisque le contenu des deux est
  // désormais présenté ensemble.
  const alertesActionsCount = totalAlertes + recos.length;

  const tabsConfig: TabItem[] = [
    {
      id: 'alertes_actions',
      label: 'Alertes & Recommandations',
      icon: <BellIcon size={16} />,
      badge: alertesActionsCount,
      badgeColor: alertesActionsCount > 0 ? 'red' : 'default',
    },
    { id: 'idees', label: 'Boîte à idées', icon: <LightbulbIcon size={16} />, badge: suggestions.length },
    {
      id: 'actions_correctives',
      label: 'Actions correctives',
      icon: <TargetIcon size={16} />,
      badge: actionsFirstLoadDone ? actionsEnCours.length : undefined,
      badgeColor: actionsEnCours.length > 0 ? 'red' : 'default',
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
      {toast && (
        <div style={{ position: 'fixed', top: '24px', right: '24px', zIndex: 1000, background: '#02302D', color: 'white', padding: '12px 20px', borderRadius: '12px', fontWeight: 700 }}>
          {toast}
        </div>
      )}

      <TabsNavigation tabs={tabsConfig} activeTab={activeTab} onChange={handleTabChange} />

      {/* ── ONGLET ALERTES & ACTIONS (fusion : alertes réseau + recommandations IA) ── */}
      {activeTab === 'alertes_actions' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
          {/* ── Sous-section : Alertes ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <AlertTriangleIcon size={18} color="#DC2626" />
              <SectionHeading>Alertes réseau ({alertesLoading ? '…' : totalAlertes})</SectionHeading>
            </div>
            {alertesLoading ? (
            <div aria-busy="true" aria-label="Chargement des alertes" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {[0, 1].map((i) => (
                <SkeletonBlock key={i} height={84} radius="var(--radius-2xl)" />
              ))}
            </div>
          ) : totalAlertes === 0 ? (
            <EmptyState
              illustration="no-alert"
              title="Aucune alerte critique active"
              message={
                isAgencyManager
                  ? "Votre agence maintient un taux de satisfaction supérieur à son seuil d'alerte."
                  : "Toutes les agences du réseau maintiennent un taux de satisfaction supérieur à leurs seuils d'alerte."
              }
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {alertes.map((a, i) => (
                <div
                  key={i}
                  style={{
                    background: '#FFFFFF',
                    border: '1px solid #E8ECE6',
                    borderLeft: '6px solid #DC2626',
                    borderRadius: '24px',
                    padding: '22px 26px',
                    boxShadow: '0 2px 10px rgba(0,0,0,0.02)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <AlertTriangleIcon size={20} color="#DC2626" />
                      <h3 style={{ fontWeight: 800, color: '#02302D', margin: 0, fontSize: '1rem' }}>{a.agence_nom}</h3>
                    </div>
                    <span style={{ background: '#FEE2E2', color: '#DC2626', padding: '4px 12px', borderRadius: '9999px', fontSize: '0.78rem', fontWeight: 800 }}>
                      Taux actuel : {a.taux_actuel}% / Seuil {a.seuil}%
                    </span>
                  </div>
                  <p style={{ color: '#64748B', fontSize: '0.9rem', margin: 0, lineHeight: 1.5 }}>{a.message}</p>
                </div>
              ))}
              {alertesFeedback.map((af) => (
                <div
                  key={af.feedback_id}
                  style={{
                    background: '#FFFFFF',
                    border: '1px solid #E8ECE6',
                    borderLeft: '6px solid #DC2626',
                    borderRadius: '24px',
                    padding: '22px 26px',
                    boxShadow: '0 2px 10px rgba(0,0,0,0.02)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <AlertTriangleIcon size={20} color="#DC2626" />
                      <h3 style={{ fontWeight: 800, color: '#02302D', margin: 0, fontSize: '1rem' }}>{af.agence_nom}</h3>
                    </div>
                    <span style={{ background: '#FEE2E2', color: '#DC2626', padding: '4px 12px', borderRadius: '9999px', fontSize: '0.78rem', fontWeight: 800 }}>
                      {RAISON_LABELS[af.raison] || af.raison} — Note {af.note}/5
                    </span>
                  </div>
                  <p style={{ color: '#64748B', fontSize: '0.9rem', margin: 0, lineHeight: 1.5 }}>
                    {af.categorie_nom ? `Catégorie « ${af.categorie_nom} » — ` : ''}
                    {af.commentaire || 'Aucun commentaire.'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Sous-section : Actions (recommandations IA — réseau pour le CX Manager, agence pour l'Agency Manager) ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <LightningIcon size={18} color="#75B72A" />
              <SectionHeading>Recommandations IA ({recosLoading ? '…' : recos.length})</SectionHeading>
            </div>
            {!isAgencyManager && (
              <AgenceFilterSelect agences={agencesList} selectedId={selectedAgenceId} onChange={setSelectedAgenceId} />
            )}
          </div>

          {recosLoading ? (
            <div aria-busy="true" aria-label="Chargement des recommandations" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {[0, 1, 2].map((i) => (
                <SkeletonBlock key={i} height={96} radius="var(--radius-xl)" />
              ))}
            </div>
          ) : recosAffichees.length === 0 ? (
            <EmptyState
              illustration="no-alert"
              title="Aucune recommandation en attente"
              message="Sur ce périmètre, toutes les actions suggérées ont été traitées."
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {recosAffichees.map((r) => (
                <RecommandationCard key={r.id} recommandation={r} agenceNom={r.agence_nom} onMarquerTraitee={marquerRecoTraitee} />
              ))}
            </div>
          )}
        </div>
        </div>
      )}

      {/* ── ONGLET BOÎTE À IDÉES ── */}
      {activeTab === 'idees' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {suggestionsLoading ? (
            <div style={{ color: '#64748B', padding: '32px', fontWeight: 600 }}>Chargement des suggestions...</div>
          ) : (
            <>
              <TabsNavigation tabs={ideesTabsConfig} activeTab={ideesSubTab} onChange={(id) => setIdeesSubTab(id as any)} />

              {filteredSuggestions.length === 0 ? (
                <div style={{ background: '#FFFFFF', borderRadius: '24px', padding: '48px', textAlign: 'center', color: '#64748B', border: '1px solid #E8ECE6', fontWeight: 600 }}>
                  Aucune suggestion dans cette catégorie.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
                  {filteredSuggestions.map((s) => {
                    const st = STATUS_STYLE[s.statut] || { bg: '#F8FAFB', text: '#475569', border: '#E2E8F0' };
                    const next = NEXT_STATUS[s.statut];
                    return (
                      <div
                        key={s.id}
                        style={{
                          background: '#FFFFFF',
                          borderRadius: '20px',
                          padding: '22px',
                          border: '1px solid #E8ECE6',
                          boxShadow: '0 2px 10px rgba(0,0,0,0.02)',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          gap: '16px',
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                            <span style={{ background: st.bg, color: st.text, border: `1px solid ${st.border}`, padding: '3px 10px', borderRadius: '9999px', fontSize: '0.74rem', fontWeight: 800 }}>
                              {STATUS_LABELS[s.statut]}
                            </span>
                            <span style={{ fontSize: '0.76rem', color: '#94A3B8', fontWeight: 600 }}>
                              {new Date(s.date_soumission).toLocaleDateString('fr-FR')}
                            </span>
                          </div>
                          <p style={{ margin: 0, fontSize: '0.88rem', color: '#1E293B', lineHeight: 1.5, fontWeight: 500 }}>"{s.contenu}"</p>
                        </div>

                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', borderTop: '1px solid #F1F4EE', paddingTop: '12px' }}>
                          {next && (
                            <button
                              type="button"
                              onClick={() => updateStatut(s.id, next)}
                              style={{ background: '#02302D', color: '#FFFFFF', border: 'none', borderRadius: '10px', padding: '6px 12px', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer' }}
                            >
                              → Passer à "{STATUS_LABELS[next]}"
                            </button>
                          )}
                          {s.statut !== 'rejete' && (
                            <button
                              type="button"
                              onClick={() => updateStatut(s.id, 'rejete')}
                              style={{ background: '#FFFFFF', color: '#DC2626', border: '1px solid #FEE2E2', borderRadius: '10px', padding: '6px 12px', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer' }}
                            >
                              Rejeter
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── ONGLET ACTIONS CORRECTIVES (suivi + confirmation uniquement — la définition d'une action reste dans FeedbackTreatmentModal) ── */}
      {activeTab === 'actions_correctives' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
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
                onClick={() => setActionsToggle('en_cours')}
                style={{
                  padding: '7px 16px',
                  borderRadius: '9px',
                  border: 'none',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  background: actionsToggle === 'en_cours' ? '#FEF3C7' : 'transparent',
                  color: actionsToggle === 'en_cours' ? '#B45309' : '#64748B',
                }}
              >
                En cours {actionsFirstLoadDone ? `(${actionsEnCours.length})` : ''}
              </button>
              <button
                type="button"
                onClick={() => setActionsToggle('terminees')}
                style={{
                  padding: '7px 16px',
                  borderRadius: '9px',
                  border: 'none',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  background: actionsToggle === 'terminees' ? '#EBF5E9' : 'transparent',
                  color: actionsToggle === 'terminees' ? '#3C7730' : '#64748B',
                }}
              >
                Terminées {actionsFirstLoadDone ? `(${actionsTerminees.length})` : ''}
              </button>
            </div>
            {!isAgencyManager && (
              <AgenceFilterSelect agences={agencesList} selectedId={actionsAgenceId} onChange={setActionsAgenceId} />
            )}
          </div>

          {actionsLoading ? (
            <div aria-busy="true" aria-label="Chargement des actions correctives" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {[0, 1, 2].map((i) => (
                <SkeletonBlock key={i} height={90} radius="var(--radius-2xl)" />
              ))}
            </div>
          ) : actionsAffichees.length === 0 ? (
            <EmptyState
              illustration="no-alert"
              title={actionsToggle === 'en_cours' ? 'Aucune action en cours' : 'Aucune action terminée pour l’instant'}
              message={
                actionsToggle === 'en_cours'
                  ? 'Toutes les actions correctives définies ont été confirmées comme réalisées.'
                  : 'Les actions confirmées comme réalisées apparaîtront ici.'
              }
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {actionsAffichees.map((f) => (
                <div
                  key={f.id}
                  style={{
                    background: '#FFFFFF',
                    border: '1px solid #E8ECE6',
                    borderLeft: `6px solid ${actionsToggle === 'en_cours' ? '#D97706' : '#3C7730'}`,
                    borderRadius: '24px',
                    padding: '22px 26px',
                    boxShadow: '0 2px 10px rgba(0,0,0,0.02)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {!isAgencyManager && f.agence_nom && (
                        <span style={{ fontSize: '0.76rem', fontWeight: 800, color: '#3C7730', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          {f.agence_nom}
                        </span>
                      )}
                      <p style={{ margin: 0, fontSize: '0.88rem', color: '#1E293B', lineHeight: 1.5, fontWeight: 500 }}>
                        "{extraitCommentaire(f.commentaire)}"
                      </p>
                    </div>
                    <span
                      style={{
                        background: actionsToggle === 'en_cours' ? '#FEF3C7' : '#EBF5E9',
                        color: actionsToggle === 'en_cours' ? '#B45309' : '#3C7730',
                        padding: '4px 12px',
                        borderRadius: '9999px',
                        fontSize: '0.76rem',
                        fontWeight: 800,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {actionsToggle === 'en_cours' ? 'En cours' : 'Terminée'}
                    </span>
                  </div>

                  <div style={{ background: '#F8FAFB', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '12px 14px' }}>
                    <div style={{ fontSize: '0.74rem', color: '#64748B', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Action à prendre
                    </div>
                    <p style={{ margin: '4px 0 0 0', fontSize: '0.86rem', color: '#02302D', fontWeight: 600 }}>
                      {f.action_a_prendre || '—'}
                    </p>
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', fontSize: '0.78rem', color: '#64748B', fontWeight: 600 }}>
                    {f.assigne_a_nom && <span>Assigné à : {f.assigne_a_nom}</span>}
                    {formatDate(f.date_assignation) && <span>Assignée le {formatDate(f.date_assignation)}</span>}
                    {actionsToggle === 'terminees' && formatDate(f.date_resolution) && (
                      <span>Résolue le {formatDate(f.date_resolution)}</span>
                    )}
                  </div>

                  {actionsToggle === 'en_cours' && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #F1F4EE', paddingTop: '12px' }}>
                      <button
                        type="button"
                        onClick={() => marquerActionRealisee(f.id)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '8px',
                          background: '#3C7730',
                          color: '#FFFFFF',
                          border: 'none',
                          borderRadius: '10px',
                          padding: '8px 16px',
                          fontSize: '0.8rem',
                          fontWeight: 800,
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                        }}
                      >
                        <CheckCircleIcon size={15} />
                        Marquer réalisée
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
