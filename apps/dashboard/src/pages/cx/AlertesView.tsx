import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { agencesApi, alertesApi, organisationsApi, recommandationsApi } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import type { Agence, Alerte, AlerteFeedback } from '../../types';
import { useToast } from '../../components/ui/Toast';
import type { RecoAffichee } from '../../components/agency/AgencyRecommendations';
import PilotageAlertesActionsTab from './PilotageAlertesActionsTab';
import { sourceInitiale, sourceReducer, type ActionSource, type EtatSource } from './alertesVue';

export interface AlertesData {
  seuil: Alerte[];
  avis: AlerteFeedback[];
  /** false : forfait sans alertes (les listes sont vides par indisponibilité, pas par absence d'alerte). */
  incluses: boolean;
}
export interface RecosData {
  items: RecoAffichee[];
  total: number;
}

const PAGE_RECOS = 50;
const reducerAlertes = sourceReducer as React.Reducer<EtatSource<AlertesData>, ActionSource<AlertesData>>;
const reducerRecos = sourceReducer as React.Reducer<EtatSource<RecosData>, ActionSource<RecosData>>;

/**
 * Conteneur de la page /alertes : charge les alertes (recalculées à chaque appel, sans état « lu/traité »), le forfait et
 * les recommandations. Le périmètre est décidé par le serveur selon le rôle ; le filtre d'agence du CX Manager est
 * transmis au serveur pour les recommandations (jamais filtré sur une liste partielle) et appliqué à la liste complète des alertes.
 */
export default function AlertesView() {
  const user = useAuthStore((s) => s.user);
  const isAgencyManager = user?.role === 'agency_manager';
  const toast = useToast();

  const [alertes, dispatchAlertes] = useReducer(reducerAlertes, sourceInitiale<AlertesData>({ seuil: [], avis: [], incluses: true }));
  const [recos, dispatchRecos] = useReducer(reducerRecos, sourceInitiale<RecosData>({ items: [], total: 0 }));
  const [recosLoadingMore, setRecosLoadingMore] = useState(false);
  const [nomForfait, setNomForfait] = useState<string | null>(null);
  const [agences, setAgences] = useState<Agence[]>([]);
  const [selectedAgenceId, setSelectedAgenceId] = useState<string | null>(null);
  const requeteAlertes = useRef(0);
  const requeteRecos = useRef(0);

  const chargerAlertes = useCallback(async () => {
    const id = ++requeteAlertes.current;
    dispatchAlertes({ type: 'debut' });
    try {
      const r = await alertesApi.list();
      if (id !== requeteAlertes.current) return;
      dispatchAlertes({
        type: 'succes',
        donnees: { seuil: r.data?.alertes_seuil ?? [], avis: r.data?.alertes_feedback ?? [], incluses: r.data?.alertes_incluses !== false },
      });
    } catch (err) {
      console.error('Erreur chargement des alertes:', err);
      if (id === requeteAlertes.current) dispatchAlertes({ type: 'echec' });
    }
  }, []);

  useEffect(() => {
    chargerAlertes();
    return () => { requeteAlertes.current += 1; };
  }, [chargerAlertes]);

  // Nom du forfait : seul le CX Manager peut le lire ; le Responsable d'agence reçoit un message générique.
  useEffect(() => {
    if (user?.role !== 'cx_manager') return;
    let annule = false;
    organisationsApi
      .utilisation()
      .then((r) => {
        const f = r.data?.fonctionnalites?.find((x) => x.code === 'alertes_satisfaction');
        if (!annule && f && f.actif === false) setNomForfait(r.data?.plan?.nom ?? null);
      })
      .catch((err) => console.error('Erreur chargement du forfait:', err));
    return () => { annule = true; };
  }, [user?.role]);

  useEffect(() => {
    if (isAgencyManager) return;
    agencesApi
      .list()
      .then((res) => { if (Array.isArray(res.data)) setAgences(res.data); })
      .catch(() => setAgences([]));
  }, [isAgencyManager]);

  const demanderRecos = useCallback(
    (offset: number) =>
      selectedAgenceId
        ? recommandationsApi.listAgence(selectedAgenceId, { limit: PAGE_RECOS, offset })
        : recommandationsApi.listOrganisation(undefined, { limit: PAGE_RECOS, offset }),
    [selectedAgenceId],
  );

  const chargerRecos = useCallback(async () => {
    const id = ++requeteRecos.current;
    dispatchRecos({ type: 'debut' });
    try {
      const res = await demanderRecos(0);
      if (id !== requeteRecos.current) return;
      const items = (res.data ?? []) as RecoAffichee[];
      const total = Number(res.headers?.['x-total-count']);
      dispatchRecos({ type: 'succes', donnees: { items, total: Number.isFinite(total) ? total : items.length } });
    } catch (err) {
      console.error('Erreur chargement des recommandations:', err);
      if (id === requeteRecos.current) dispatchRecos({ type: 'echec' });
    }
  }, [demanderRecos]);

  useEffect(() => {
    chargerRecos();
    return () => { requeteRecos.current += 1; };
  }, [chargerRecos]);

  const chargerPlusRecos = async () => {
    const { items, total } = recos.donnees;
    if (recosLoadingMore || items.length >= total) return;
    const id = requeteRecos.current;
    setRecosLoadingMore(true);
    try {
      const res = await demanderRecos(items.length);
      if (id !== requeteRecos.current) return;
      const connues = new Set(items.map((r) => r.id));
      const suite = ((res.data ?? []) as RecoAffichee[]).filter((r) => !connues.has(r.id));
      dispatchRecos({ type: 'succes', donnees: { items: [...items, ...suite], total } });
    } catch {
      toast.show({ message: 'Impossible de charger les recommandations suivantes', tone: 'critical' });
    } finally {
      setRecosLoadingMore(false);
    }
  };

  const marquerRecoTraitee = async (recoId: string) => {
    try {
      await recommandationsApi.marquerTraitee(recoId);
      dispatchRecos({
        type: 'succes',
        donnees: { items: recos.donnees.items.filter((r) => r.id !== recoId), total: Math.max(0, recos.donnees.total - 1) },
      });
      toast.show({ message: 'Recommandation marquée comme traitée', tone: 'success' });
    } catch {
      toast.show({ message: 'Impossible d’enregistrer la modification. Réessayez.', tone: 'critical' });
    }
  };

  return (
    <PilotageAlertesActionsTab
      isAgencyManager={isAgencyManager}
      alertes={alertes}
      recos={recos}
      recosLoadingMore={recosLoadingMore}
      nomForfait={nomForfait}
      agences={agences}
      selectedAgenceId={selectedAgenceId}
      onSelectAgence={setSelectedAgenceId}
      onRefresh={chargerAlertes}
      onRetryRecos={chargerRecos}
      onLoadMoreRecos={chargerPlusRecos}
      onMarquerRecoTraitee={marquerRecoTraitee}
    />
  );
}
