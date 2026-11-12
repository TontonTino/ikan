import React, { useCallback, useEffect, useRef, useState } from 'react';
import { issuesApi } from '../../services/api';
import type { EvenementProbleme } from '../../types';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import SkeletonBlock from '../ui/SkeletonBlock';
import { dateRelativeOuAbsolue, fullDate } from '../ui/format';
import { TAILLE_PAGE_FIL, annonceChargement, libelleAuteur, libelleEvenement, libelleRole, libelleVoirPlus } from '../../utils/filActivite';

export type EtatFil =
  | { statut: 'chargement' }
  | { statut: 'erreur' }
  | { statut: 'ok'; evenements: EvenementProbleme[]; total: number; chargementSuite: boolean; erreurSuite: boolean };

/**
 * Charge le fil d'un problème par pages de 10 (`GET /issues/{id}/historique`). `cle` change quand le problème évolue (action, résolution…) : le fil repart de la première page.
 * Une erreur n'est jamais présentée comme « aucun événement ».
 */
export function useFilActivite(issueId: string | undefined, cle: string): { etat: EtatFil; voirPlus: () => void; reessayer: () => void; ajoutes: number } {
  const [etat, setEtat] = useState<EtatFil>({ statut: 'chargement' });
  const [essai, setEssai] = useState(0);
  const [ajoutes, setAjoutes] = useState(0);
  const ordre = useRef(0);

  useEffect(() => {
    if (!issueId) return;
    const mon = ++ordre.current;
    setEtat({ statut: 'chargement' });
    setAjoutes(0);
    issuesApi.historique(issueId, { limit: TAILLE_PAGE_FIL, offset: 0 })
      .then((r) => { if (mon === ordre.current) setEtat({ statut: 'ok', evenements: r.data || [], total: Number(r.headers?.['x-total-count'] || (r.data || []).length), chargementSuite: false, erreurSuite: false }); })
      .catch(() => { if (mon === ordre.current) setEtat({ statut: 'erreur' }); });
  }, [issueId, cle, essai]);

  const voirPlus = useCallback(() => {
    if (!issueId || etat.statut !== 'ok' || etat.chargementSuite) return;
    const mon = ++ordre.current;
    const deja = etat.evenements.length;
    setEtat({ ...etat, chargementSuite: true, erreurSuite: false });
    issuesApi.historique(issueId, { limit: TAILLE_PAGE_FIL, offset: deja })
      .then((r) => {
        if (mon !== ordre.current) return;
        const suite = r.data || [];
        setAjoutes(suite.length);
        setEtat({ statut: 'ok', evenements: [...etat.evenements, ...suite], total: Number(r.headers?.['x-total-count'] || etat.total), chargementSuite: false, erreurSuite: false });
      })
      .catch(() => { if (mon === ordre.current) setEtat({ ...etat, chargementSuite: false, erreurSuite: true }); });
  }, [issueId, etat]);

  const reessayer = useCallback(() => setEssai((n) => n + 1), []);
  return { etat, voirPlus, reessayer, ajoutes };
}

interface ListeProps {
  etat: EtatFil;
  voirPlus: () => void;
  reessayer: () => void;
  /** Nombre d'événements ajoutés par le dernier « Voir plus » (annonce vocale, focus sur le premier ajouté). */
  ajoutes: number;
  maintenant?: Date;
}

/**
 * Fil chronologique, du plus récent au plus ancien : phrase, auteur par son nom, date (relative puis absolue dans <time>, date complète au survol). États : chargement, erreur avec
 * « Réessayer », vide, « Voir plus ». Après « Voir plus », le focus va au premier événement ajouté (le bouton peut disparaître) et l'ajout est annoncé.
 */
export function FilActiviteListe({ etat, voirPlus, reessayer, ajoutes, maintenant }: ListeProps) {
  const premierAjoute = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    if (ajoutes > 0) premierAjoute.current?.focus();
  }, [ajoutes]);

  if (etat.statut === 'chargement') {
    return (
      <div aria-busy="true" aria-label="Chargement de l’activité" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <SkeletonBlock height={36} /><SkeletonBlock height={36} /><SkeletonBlock height={36} />
      </div>
    );
  }
  if (etat.statut === 'erreur') {
    return (
      <Alert tone="critical" title="Impossible de charger l’activité. Cela ne signifie pas qu’il n’y en a pas." action={<Button size="sm" variant="secondary" onClick={reessayer}>Réessayer</Button>} />
    );
  }
  if (etat.evenements.length === 0) {
    return <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>Aucun événement enregistré pour ce problème.</p>;
  }
  const debutAjoutes = etat.evenements.length - ajoutes;
  const voirPlusTexte = libelleVoirPlus(etat.evenements.length, etat.total);
  return (
    <>
      <ol className="pb-fil" aria-label="Activité du problème, du plus récent au plus ancien">
        {etat.evenements.map((e, i) => {
          const { texte, detail } = libelleEvenement(e);
          const role = libelleRole(e);
          return (
            <li key={e.id} className="pb-fil__item" tabIndex={ajoutes > 0 && i === debutAjoutes ? -1 : undefined} ref={ajoutes > 0 && i === debutAjoutes ? premierAjoute : undefined}>
              <span className="pb-fil__point" aria-hidden="true" />
              <div className="pb-fil__corps">
                <p className="pb-fil__texte">{texte}{detail ? <> : « {detail} »</> : null}</p>
                <p className="pb-fil__meta">
                  <span title={role ?? undefined}>{libelleAuteur(e)}</span>
                  <span aria-hidden="true"> · </span>
                  <time dateTime={e.date_evenement} title={fullDate(e.date_evenement)}>{dateRelativeOuAbsolue(e.date_evenement, maintenant)}</time>
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      <span className="ui-sr-only" role="status">{annonceChargement(ajoutes)}</span>
      {etat.erreurSuite && <Alert tone="critical" title="Impossible de charger la suite de l’activité." action={<Button size="sm" variant="secondary" onClick={voirPlus}>Réessayer</Button>} />}
      {voirPlusTexte && !etat.erreurSuite && (
        <Button variant="secondary" size="sm" onClick={voirPlus} loading={etat.chargementSuite} style={{ alignSelf: 'flex-start' }}>
          {etat.chargementSuite ? 'Chargement…' : voirPlusTexte}
        </Button>
      )}
    </>
  );
}
