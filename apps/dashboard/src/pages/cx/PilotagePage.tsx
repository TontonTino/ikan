import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { alertesApi, suggestionsApi, recommandationsApi, agencesApi } from '../../services/api';
import type { Alerte, Suggestion, IdeaStatus, RecommandationOrg, Agence } from '../../types';
import TabsNavigation, { TabItem } from '../../components/ui/TabsNavigation';
import RecommandationCard from '../../components/stats/RecommandationCard';
import AgenceFilterSelect from '../../components/stats/AgenceFilterSelect';
import {
  BellIcon,
  LightningIcon,
  LightbulbIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
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

type PilotageTab = 'alertes_actions' | 'idees';

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
  // sur l'onglet par défaut "Alertes & Actions".
  const initialTab: PilotageTab = requestedTab === 'idees' ? 'idees' : 'alertes_actions';
  const [activeTab, setActiveTab] = useState<PilotageTab>(initialTab);

  const handleTabChange = (id: string) => {
    const tab = id as PilotageTab;
    setActiveTab(tab);
    setSearchParams(tab === 'alertes_actions' ? {} : { tab }, { replace: true });
  };

  const [toast, setToast] = useState('');
  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  // ── Alertes ──────────────────────────────────────────
  const [alertes, setAlertes] = useState<Alerte[]>([]);
  const [alertesLoading, setAlertesLoading] = useState(true);

  useEffect(() => {
    alertesApi
      .list()
      .then((r) => setAlertes(r.data || []))
      .catch(() => setAlertes([]))
      .finally(() => setAlertesLoading(false));
  }, []);

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

  // Badge combiné : total des éléments nécessitant une action dans cet onglet
  // fusionné (alertes actives + recommandations en attente), plus lisible
  // qu'un seul des deux compteurs isolément puisque le contenu des deux est
  // désormais présenté ensemble.
  const alertesActionsCount = alertes.length + recos.length;

  const tabsConfig: TabItem[] = [
    {
      id: 'alertes_actions',
      label: 'Alertes & Actions',
      icon: <BellIcon size={16} />,
      badge: alertesActionsCount,
      badgeColor: alertesActionsCount > 0 ? 'red' : 'default',
    },
    { id: 'idees', label: 'Boîte à idées', icon: <LightbulbIcon size={16} />, badge: suggestions.length },
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
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#02302D' }}>
                Alertes ({alertes.length})
              </h3>
            </div>
            {alertesLoading ? (
            <div style={{ color: '#64748B', padding: '32px', fontWeight: 600 }}>Chargement des alertes...</div>
          ) : alertes.length === 0 ? (
            <div
              style={{
                background: '#EBF5E9',
                border: '1px solid #D5E8D3',
                borderRadius: '24px',
                padding: '32px',
                color: '#3C7730',
                display: 'flex',
                alignItems: 'center',
                gap: '16px',
              }}
            >
              <div style={{ width: '44px', height: '44px', borderRadius: '14px', background: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CheckCircleIcon size={24} color="#3C7730" />
              </div>
              <div>
                <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#02302D' }}>Aucune alerte critique active</div>
                <p style={{ margin: '4px 0 0', fontSize: '0.88rem', color: '#166534' }}>
                  {isAgencyManager
                    ? "Votre agence maintient un taux de satisfaction supérieur à son seuil d'alerte."
                    : "Toutes les agences du réseau maintiennent un taux de satisfaction supérieur à leurs seuils d'alerte."}
                </p>
              </div>
            </div>
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
            </div>
          )}
        </div>

        {/* ── Sous-section : Actions (recommandations IA — réseau pour le CX Manager, agence pour l'Agency Manager) ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <LightningIcon size={18} color="#75B72A" />
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#02302D' }}>
                Actions ({recos.length})
              </h3>
            </div>
            {!isAgencyManager && (
              <AgenceFilterSelect agences={agencesList} selectedId={selectedAgenceId} onChange={setSelectedAgenceId} />
            )}
          </div>

          {recosLoading ? (
            <div style={{ color: '#64748B', padding: '32px', fontWeight: 600 }}>Chargement des recommandations...</div>
          ) : recosAffichees.length === 0 ? (
            <div
              style={{
                padding: '24px',
                textAlign: 'center',
                color: '#3C7730',
                background: '#EBF5E9',
                borderRadius: '16px',
                border: '1px solid #D5E8D3',
                fontWeight: 700,
              }}
            >
              Aucune recommandation en attente sur ce périmètre ! Toutes les actions suggérées ont été traitées.
            </div>
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
    </div>
  );
}
