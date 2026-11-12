import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { agencesApi, alertesApi, organisationsApi } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import type { Agence, Alerte, AlerteFeedback } from '../../types';
import { useToast } from '../../components/ui/Toast';
import PilotageAlertesActionsTab from './PilotageAlertesActionsTab';
import HistoriqueAlertes from '../../components/alerts/HistoriqueAlertes';
import PriseEnChargeDialog, { type IssuePriseEnCharge } from '../../components/alerts/PriseEnChargeDialog';
import { alerteSeuilAnchor } from '../../components/alerts/alerteLabels';
import { sourceInitiale, sourceReducer, type ActionSource, type EtatSource } from './alertesVue';

export interface AlertesData {
  seuil: Alerte[];
  avis: AlerteFeedback[];
  /** false : forfait sans alertes (les listes sont vides par indisponibilité, pas par absence d'alerte). */
  incluses: boolean;
}

const reducerAlertes = sourceReducer as React.Reducer<EtatSource<AlertesData>, ActionSource<AlertesData>>;

/**
 * Conteneur de la page /alertes : charge les alertes (recalculées à chaque appel, sans état « lu/traité ») et le forfait.
 * Le périmètre est décidé par le serveur selon le rôle ; le filtre d'agence du CX Manager s'applique à la liste complète des alertes.
 * Les recommandations automatiques ne sont plus affichées ici (texte générique identique partout) : l'API et les données restent.
 */
export default function AlertesView() {
  const user = useAuthStore((s) => s.user);
  const isAgencyManager = user?.role === 'agency_manager';
  const toast = useToast();

  const [alertes, dispatchAlertes] = useReducer(reducerAlertes, sourceInitiale<AlertesData>({ seuil: [], avis: [], incluses: true }));
  const [nomForfait, setNomForfait] = useState<string | null>(null);
  const [agences, setAgences] = useState<Agence[]>([]);
  const [selectedAgenceId, setSelectedAgenceId] = useState<string | null>(null);
  // Prise en charge d'une alerte (Agency Manager) : l'alerte dont la boîte de dialogue est ouverte ; le compteur recharge l'historique avec la liste.
  const [aPrendreEnCharge, setAPrendreEnCharge] = useState<Alerte | null>(null);
  const [rafraichissement, setRafraichissement] = useState(0);
  const requeteAlertes = useRef(0);

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

  const rafraichirAlertes = useCallback(() => {
    chargerAlertes();
    setRafraichissement((n) => n + 1);
  }, [chargerAlertes]);

  // Succès : l'alerte RESTE dans la liste avec l'état « Prise en charge » (liste et historique rechargés), le résultat est annoncé, le focus revient sur la ligne.
  // 409 / 404 : même rafraîchissement, avec le message clair de la boîte de dialogue. Les compteurs de synthèse ne changent pas.
  const apresPriseEnCharge = async (issue: IssuePriseEnCharge) => {
    const agenceId = aPrendreEnCharge?.agence_id;
    setAPrendreEnCharge(null);
    toast.show(issue.type === 'succes'
      ? { message: 'Alerte prise en charge : elle reste affichée avec son nouvel état.', tone: 'success' }
      : { message: issue.message, tone: 'warning', duration: 8000 });
    await chargerAlertes();
    setRafraichissement((n) => n + 1);
    if (agenceId) window.setTimeout(() => document.getElementById(alerteSeuilAnchor(agenceId))?.focus({ preventScroll: true }), 60);
  };

  return (
    <>
      <PilotageAlertesActionsTab
        isAgencyManager={isAgencyManager}
        alertes={alertes}
        nomForfait={nomForfait}
        agences={agences}
        selectedAgenceId={selectedAgenceId}
        onSelectAgence={setSelectedAgenceId}
        onRefresh={rafraichirAlertes}
        onPrendreEnCharge={isAgencyManager ? setAPrendreEnCharge : undefined}
        historique={<HistoriqueAlertes isAgencyManager={isAgencyManager} agences={agences} rafraichissement={rafraichissement} />}
      />
      {isAgencyManager && <PriseEnChargeDialog alerte={aPrendreEnCharge} onFermer={() => setAPrendreEnCharge(null)} onTermine={apresPriseEnCharge} />}
    </>
  );
}
