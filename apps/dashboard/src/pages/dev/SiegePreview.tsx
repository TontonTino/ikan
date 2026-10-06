/**
 * Aperçu de DÉVELOPPEMENT du Dashboard CX avec des réponses d'API d'EXEMPLE.
 * Route /design-system/siege, montée uniquement si import.meta.env.DEV (absente du build).
 * Sert à vérifier mise en page, états et cas limites sans backend.
 * Aucune de ces données n'est utilisée en production.
 *
 * ?etat=vide | erreur | chargement  pour vérifier les 3 états.
 */
import React, { useEffect, useState } from 'react';
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios';
import { useSearchParams } from 'react-router-dom';
import api from '../../services/api';
import DashboardSiegePage from '../cx/DashboardSiegePage';
import StatsCXView from '../stats/StatsCXView';

const DAY = 86400e3;

function evolution(jours: number, vide: boolean) {
  if (vide) return [];
  const pts = [];
  for (let i = Math.min(jours, 60) - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * DAY);
    const key = d.toISOString().slice(0, 10);
    const feedbacks = i % 9 === 0 ? 3 : 12 + ((i * 7) % 9); // quelques jours à faible volume
    const positifs = Math.round(feedbacks * (0.62 + ((i * 13) % 20) / 100));
    pts.push({ date: key, label: `${d.getDate()}/${d.getMonth() + 1}`, feedbacks, traites: feedbacks, satisfaction: Math.round((positifs / feedbacks) * 1000) / 10, positifs, neutres: 0, negatifs: feedbacks - positifs });
  }
  return pts;
}

const kpi = (v: number | null, prev: number | null) => ({ status: v === null ? 'no_data' : 'ok', valeur: v, valeur_num: v, valeur_precedente: prev, evolution: null, is_positive: true });

function statsCx(jours: number, agenceId: string | undefined, vide: boolean) {
  const ranking = [
    { agence_id: 'a1', agence_nom: 'Agence (exemple) Centre', ville: 'Ville A', satisfaction_rate: 88.2, total_feedbacks: 210, feedbacks_traites: 190, taux_traitement: 90, alertes_critiques: 0, tendance_val: '+2.1 pts', tendance_positive: true, wilson_score: 0.83 },
    { agence_id: 'a2', agence_nom: 'Agence (exemple) Gare', ville: 'Ville B', satisfaction_rate: 61.5, total_feedbacks: 96, feedbacks_traites: 60, taux_traitement: 62, alertes_critiques: 5, tendance_val: '-4.0 pts', tendance_positive: false, wilson_score: 0.51 },
    { agence_id: 'a3', agence_nom: 'Agence (exemple) Port', ville: 'Ville C', satisfaction_rate: 70.0, total_feedbacks: 40, feedbacks_traites: 30, taux_traitement: 75, alertes_critiques: 1, tendance_val: '-15.2 pts', tendance_positive: false, wilson_score: 0.55 },
    { agence_id: 'a4', agence_nom: 'Agence (exemple) Nord', ville: 'Ville D', satisfaction_rate: 79.0, total_feedbacks: 120, feedbacks_traites: 110, taux_traitement: 92, alertes_critiques: 0, tendance_val: '+0.5 pts', tendance_positive: true, wilson_score: 0.71 },
    { agence_id: 'a5', agence_nom: 'Agence (exemple) Sud', ville: 'Ville E', satisfaction_rate: 100, total_feedbacks: 2, feedbacks_traites: 2, taux_traitement: 100, alertes_critiques: 0, tendance_val: null, tendance_positive: true, wilson_score: 0.34 },
    { agence_id: 'a6', agence_nom: 'Agence (exemple) Nouvelle', ville: 'Ville F', satisfaction_rate: null, total_feedbacks: 0, feedbacks_traites: 0, taux_traitement: null, alertes_critiques: 0, tendance_val: null, tendance_positive: true, wilson_score: 0 },
    { agence_id: 'a7', agence_nom: 'Agence (exemple) Ouest', ville: 'Ville G', satisfaction_rate: 74.4, total_feedbacks: 78, feedbacks_traites: 70, taux_traitement: 90, alertes_critiques: 0, tendance_val: '-1.0 pts', tendance_positive: false, wilson_score: 0.63 },
  ];
  const one = agenceId ? ranking.find((r) => r.agence_id === agenceId) : undefined;
  const total = vide ? 0 : one ? one.total_feedbacks : 548;
  return {
    periode_jours: jours,
    periode_label: `${jours} derniers jours`,
    kpis: {
      satisfaction: kpi(vide ? null : one ? one.satisfaction_rate : 77.6, vide ? null : 74.1),
      total_feedbacks: kpi(total, vide ? 0 : one ? Math.round(one.total_feedbacks * 0.9) : 501),
      alertes_critiques: kpi(vide ? 0 : one ? one.alertes_critiques : 6, vide ? 0 : 4),
    },
    evolution_satisfaction: evolution(jours, vide || (!!one && one.total_feedbacks === 0)),
    evolution_volume: [],
    sentiments: [],
    themes: vide
      ? []
      : [
          { theme: 'attente', label: 'Attente & Délais en caisse', count: 142, pourcentage: 31.4, sentiment_predominant: 'negatif' },
          { theme: 'accueil', label: 'Accueil & Conseillers', count: 98, pourcentage: 21.7, sentiment_predominant: 'positif' },
          { theme: 'tarifs', label: 'Tarifs & Frais', count: 51, pourcentage: 11.3, sentiment_predominant: 'neutre' },
        ],
    agences_ranking: vide ? ranking.map((r) => ({ ...r, total_feedbacks: 0, satisfaction_rate: null, taux_traitement: null, alertes_critiques: 0, tendance_val: null })) : ranking,
    alertes_synthese: { total_critiques: 6, agences_impactees: [], evolution_positive: false },
    insights_ia: [],
  };
}

const COORDS: [number, number][] = [[48.86, 2.35], [48.84, 2.37], [43.3, 5.37], [50.63, 3.06], [43.6, 1.44], [47.22, -1.55]];
// a7 volontairement sans coordonnées : doit apparaître dans « Agences sans coordonnées ».
const agences = Array.from({ length: 7 }, (_, i) => ({ id: `a${i + 1}`, nom: `Agence ${i + 1}`, ville: '', seuil_alerte: 70, active: true, organisation_id: 'o', date_creation: '', ...(COORDS[i] ? { latitude: COORDS[i][0], longitude: COORDS[i][1] } : {}) }));

const issues = (statut: string, agenceId?: string) =>
  (statut === 'ouverte'
    ? [
        { id: 'i1', agence_id: 'a2', agence_nom: 'Agence (exemple) Gare', titre: 'Attente', statut: 'ouverte', severite: 'critique', necessite_action: true },
        { id: 'i2', agence_id: 'a7', agence_nom: 'Agence (exemple) Ouest', titre: 'Accueil', statut: 'ouverte', severite: 'elevee', necessite_action: true },
        { id: 'i3', agence_id: 'a4', agence_nom: 'Agence (exemple) Nord', titre: 'Info', statut: 'ouverte', severite: 'faible', necessite_action: false },
      ]
    : statut === 'action_en_cours'
      ? [{ id: 'i4', agence_id: 'a2', agence_nom: 'Agence (exemple) Gare', titre: 'Propreté', statut: 'action_en_cours', severite: 'moyenne', necessite_action: true }]
      : []
  ).filter((i) => !agenceId || i.agence_id === agenceId);

function makeAdapter(etat: string | null): AxiosAdapter {
  return (config: InternalAxiosRequestConfig) =>
    new Promise((resolve, reject) => {
      if (etat === 'chargement') return; // ne répond jamais : état de chargement
      const url = config.url ?? '';
      const p = (config.params ?? {}) as Record<string, string>;
      const ok = (data: unknown, total?: number) =>
        resolve({ data, status: 200, statusText: 'OK', headers: total != null ? { 'x-total-count': String(total) } : {}, config });
      window.setTimeout(() => {
        if (etat === 'erreur') return reject(Object.assign(new Error('Erreur simulée (aperçu)'), { config, response: { status: 500, data: {} } }));
        const vide = etat === 'vide';
        if (url.includes('/dashboard/statistics/cx')) return ok(statsCx(Number(p.jours ?? 30), p.agence_id, vide));
        if (url.startsWith('/alertes')) return ok({ alertes_seuil: vide ? [] : [{ agence_id: 'a2', agence_nom: 'Agence (exemple) Gare', taux_actuel: 58.3, seuil: 70, message: '' }], alertes_feedback: [] });
        if (url.startsWith('/agences')) return ok(agences);
        if (url.startsWith('/issues')) { const l = vide ? [] : issues(p.statut, p.agence_id); return ok(l, l.length); }
        if (url.startsWith('/feedbacks')) return ok([], vide ? 0 : String(p.action_realisee) === 'true' ? 37 : p.agence_id ? 2 : 9);
        return ok({});
      }, 150);
    });
}

export default function SiegePreview() {
  const [params] = useSearchParams();
  const etat = params.get('etat');
  // Adaptateur installé AVANT le premier rendu du dashboard (initialiseur synchrone).
  const [ready] = useState(() => {
    const previous = api.defaults.adapter;
    (api.defaults as { __prevAdapter?: unknown }).__prevAdapter = previous;
    api.defaults.adapter = makeAdapter(etat);
    return true;
  });
  useEffect(() => () => {
    api.defaults.adapter = (api.defaults as { __prevAdapter?: typeof api.defaults.adapter }).__prevAdapter;
  }, []);

  return (
    <div style={{ padding: 'var(--space-5)', maxWidth: 1240, margin: '0 auto' }}>
      <p role="note" style={{ margin: '0 0 var(--space-4)', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-sm)', background: 'var(--color-warning-bg)', color: 'var(--color-warning-text)', fontSize: 'var(--text-sm)', fontWeight: 700 }}>
        Aperçu de développement — réponses d'API d'exemple ({etat ?? 'données'}). Non inclus dans le build de production.
      </p>
      {ready && (params.get('vue') === 'performance' ? <StatsCXView /> : <DashboardSiegePage />)}
    </div>
  );
}
