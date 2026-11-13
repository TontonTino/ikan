import React, { useId, useRef, useState } from 'react';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import { issuesApi } from '../../services/api';
import type { ActionCorrective } from '../../types';
import {
  DESCRIPTION_MAX,
  SANS_RESPONSABLE,
  SAISIE_VIDE,
  TITRE_MAX,
  compteurDescription,
  envoyerCreationAction,
  jourLocal,
  validerSaisie,
  type EchecAction,
  type ErreursSaisie,
  type Personne,
  type SaisieAction,
} from '../../utils/actionsProbleme';
import { SEUIL_COMPTEUR_VOCAL } from '../../utils/episodesAlertes';
import type { EtatResponsables } from './useResponsables';
import { LIBELLES } from '../../utils/vocabulaire';

/** Identifiants des champs (liaison étiquette / aide / erreur). */
export interface IdsChamps {
  formulaire: string;
  titre: string;
  description: string;
  compteur: string;
  responsable: string;
  echeance: string;
}

interface CorpsProps {
  saisie: SaisieAction;
  onChange: (patch: Partial<SaisieAction>) => void;
  erreurs: ErreursSaisie;
  envoi: boolean;
  /** Échec de l'envoi (affiché dans une région annoncée aussitôt). */
  echec: EchecAction | null;
  onReessayer: () => void;
  onSoumettre: () => void;
  personnes: Personne[];
  responsables: EtatResponsables;
  onRechargerResponsables: () => void;
  ids: IdsChamps;
  aujourdhui: string;
}

/**
 * Corps de la boîte « Définir une action » : intitulé, précisions (facultatives, compteur), responsable (choix explicite), échéance (facultative).
 * L'intitulé porte `data-autofocus` (focus à l'ouverture, via useOverlay). Les erreurs de champ sont liées par aria-describedby et annoncées.
 * « Réessayer » n'apparaît que pour une erreur serveur ou réseau ; les autres erreurs se corrigent puis se renvoient.
 */
export function CorpsDefinirAction({ saisie, onChange, erreurs, envoi, echec, onReessayer, onSoumettre, personnes, responsables, onRechargerResponsables, ids, aujourdhui }: CorpsProps) {
  const restants = DESCRIPTION_MAX - saisie.description.length;
  return (
    <form
      id={ids.formulaire}
      className="alerte-dialogue__corps"
      noValidate
      onSubmit={(e) => { e.preventDefault(); onSoumettre(); }}
    >
      <p className="alerte-dialogue__texte">Décidez ce qui doit être fait pour régler ce problème. L’action apparaît ensuite dans le détail du problème, qui passe à l’état « Action en cours ».</p>

      <div className="alerte-dialogue__champ">
        <label htmlFor={ids.titre} className="alerte-dialogue__label">{LIBELLES.action} <span className="alerte-dialogue__requis" aria-hidden="true">*</span></label>
        <input
          id={ids.titre}
          className="alerte-dialogue__controle"
          data-autofocus
          type="text"
          maxLength={TITRE_MAX}
          value={saisie.titre}
          readOnly={envoi}
          required
          aria-required="true"
          aria-invalid={erreurs.titre ? true : undefined}
          aria-describedby={erreurs.titre ? `${ids.titre}-erreur` : undefined}
          placeholder="Ex. : Réparer la climatisation"
          onChange={(e) => onChange({ titre: e.target.value })}
        />
        {erreurs.titre && <p id={`${ids.titre}-erreur`} className="alerte-dialogue__erreur" role="alert">{erreurs.titre}</p>}
      </div>

      <div className="alerte-dialogue__champ">
        <label htmlFor={ids.description} className="alerte-dialogue__label">Précisions <span className="alerte-dialogue__facultatif">(facultatif)</span></label>
        <textarea
          id={ids.description}
          className="alerte-dialogue__saisie"
          rows={3}
          maxLength={DESCRIPTION_MAX}
          value={saisie.description}
          readOnly={envoi}
          aria-describedby={ids.compteur}
          onChange={(e) => onChange({ description: e.target.value })}
        />
        <p id={ids.compteur} className={`alerte-dialogue__compteur${restants <= SEUIL_COMPTEUR_VOCAL ? ' is-limite' : ''}`}>{compteurDescription(saisie.description)}</p>
        <span className="ui-sr-only" role="status">
          {restants <= SEUIL_COMPTEUR_VOCAL ? (restants === 0 ? 'Limite de caractères atteinte.' : `Il reste ${restants} caractère${restants > 1 ? 's' : ''}.`) : ''}
        </span>
      </div>

      <div className="alerte-dialogue__champ">
        <label htmlFor={ids.responsable} className="alerte-dialogue__label">Responsable <span className="alerte-dialogue__requis" aria-hidden="true">*</span></label>
        <select
          id={ids.responsable}
          className="alerte-dialogue__controle"
          value={saisie.responsableId}
          disabled={envoi || responsables.statut === 'chargement'}
          required
          aria-required="true"
          aria-invalid={erreurs.responsable ? true : undefined}
          aria-describedby={`${ids.responsable}-aide${erreurs.responsable ? ` ${ids.responsable}-erreur` : ''}`}
          onChange={(e) => onChange({ responsableId: e.target.value })}
        >
          <option value="">{responsables.statut === 'chargement' ? 'Chargement des responsables…' : 'Choisir un responsable'}</option>
          {personnes.map((p) => <option key={p.id} value={p.id}>{p.libelle}</option>)}
          <option value={SANS_RESPONSABLE}>Sans responsable pour l’instant</option>
        </select>
        <p id={`${ids.responsable}-aide`} className="alerte-dialogue__aide">Seules les personnes de l’agence du problème sont proposées.</p>
        {erreurs.responsable && <p id={`${ids.responsable}-erreur`} className="alerte-dialogue__erreur" role="alert">{erreurs.responsable}</p>}
        {responsables.statut === 'erreur' && (
          <Alert
            tone="warning"
            title="La liste des responsables n’a pas pu être chargée."
            action={<Button size="sm" variant="secondary" onClick={onRechargerResponsables}>Recharger la liste</Button>}
          />
        )}
      </div>

      <div className="alerte-dialogue__champ">
        <label htmlFor={ids.echeance} className="alerte-dialogue__label">Échéance <span className="alerte-dialogue__facultatif">(facultatif)</span></label>
        <input
          id={ids.echeance}
          className="alerte-dialogue__controle"
          type="date"
          min={aujourdhui}
          value={saisie.echeance}
          readOnly={envoi}
          aria-invalid={erreurs.echeance ? true : undefined}
          aria-describedby={`${ids.echeance}-aide${erreurs.echeance ? ` ${ids.echeance}-erreur` : ''}`}
          onChange={(e) => onChange({ echeance: e.target.value })}
        />
        <p id={`${ids.echeance}-aide`} className="alerte-dialogue__aide">{saisie.echeance ? 'Vous pouvez effacer la date pour ne fixer aucune échéance.' : 'Sans date, l’action sera enregistrée « sans échéance ».'}</p>
        {erreurs.echeance && <p id={`${ids.echeance}-erreur`} className="alerte-dialogue__erreur" role="alert">{erreurs.echeance}</p>}
      </div>

      {echec && (
        <Alert
          tone="critical"
          title={echec.message}
          action={echec.nature === 'serveur' ? <Button size="sm" variant="secondary" onClick={onReessayer} disabled={envoi}>Réessayer</Button> : undefined}
        />
      )}
    </form>
  );
}

interface PiedProps {
  envoi: boolean;
  formulaire: string;
  onAnnuler: () => void;
}

/** Pied de la boîte : pendant l'envoi, « Annuler » est désactivé et la confirmation montre un indicateur de chargement. */
export function PiedDefinirAction({ envoi, formulaire, onAnnuler }: PiedProps) {
  return (
    <>
      <Button variant="ghost" onClick={onAnnuler} disabled={envoi}>Annuler</Button>
      <Button variant="primary" type="submit" form={formulaire} loading={envoi}>{envoi ? 'Enregistrement…' : 'Définir l’action'}</Button>
    </>
  );
}

interface DialogProps {
  /** Le problème concerné ; null : la boîte est fermée. */
  issue: { id: string; titre: string; agence_id: string; agence_nom?: string } | null;
  /** Personnes proposables (déjà limitées à l'agence du problème). */
  personnes: Personne[];
  responsables: EtatResponsables;
  onRechargerResponsables: () => void;
  onFermer: () => void;
  onCree: (action: ActionCorrective) => void;
  /** 404 / 409 : le problème n'est plus tel qu'attendu, la page rafraîchit et affiche le message. */
  onDisparu: (message: string) => void;
}

/**
 * Boîte « Définir une action » sur un problème (CX Manager). Construite sur <Modal>, comme « Prendre en charge » : focus piégé, Échap ferme, focus rendu au bouton
 * qui l'a ouverte, aucun envoi double (verrou + boutons désactivés). La saisie est conservée après toute erreur ; le contexte du problème reste affiché
 * derrière (et dans le sous-titre).
 */
export default function DefinirActionDialog({ issue, personnes, responsables, onRechargerResponsables, onFermer, onCree, onDisparu }: DialogProps) {
  const [saisie, setSaisie] = useState<SaisieAction>(SAISIE_VIDE);
  const [erreurs, setErreurs] = useState<ErreursSaisie>({});
  const [echec, setEchec] = useState<EchecAction | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const enCours = useRef(false);
  const base = useId();
  const ids: IdsChamps = { formulaire: `${base}-form`, titre: `${base}-titre`, description: `${base}-description`, compteur: `${base}-compteur`, responsable: `${base}-responsable`, echeance: `${base}-echeance` };

  const reinitialiser = () => { setSaisie(SAISIE_VIDE); setErreurs({}); setEchec(null); };
  const fermer = () => {
    if (enCours.current) return;
    reinitialiser();
    onFermer();
  };

  const soumettre = async () => {
    if (!issue || enCours.current) return;
    const invalides = validerSaisie(saisie);
    setErreurs(invalides);
    if (Object.keys(invalides).length > 0) {
      setEchec(null);
      const premier = invalides.titre ? ids.titre : invalides.responsable ? ids.responsable : ids.echeance;
      document.getElementById(premier)?.focus();
      return;
    }
    enCours.current = true;
    setEnvoi(true);
    setEchec(null);
    const resultat = await envoyerCreationAction(issuesApi.creerAction, issue.id, saisie);
    enCours.current = false;
    setEnvoi(false);
    if (resultat.type === 'succes') {
      reinitialiser();
      onCree(resultat.action);
      return;
    }
    if (resultat.nature === 'disparu') {
      reinitialiser();
      onDisparu(resultat.message);
      return;
    }
    setEchec({ nature: resultat.nature, message: resultat.message });
  };

  return (
    <Modal
      open={issue !== null}
      onClose={fermer}
      title="Définir une action"
      subtitle={issue ? `${issue.titre}${issue.agence_nom ? ` · ${issue.agence_nom}` : ''}` : undefined}
      size="md"
      dismissOnScrim={false}
      footer={<PiedDefinirAction envoi={envoi} formulaire={ids.formulaire} onAnnuler={fermer} />}
    >
      <CorpsDefinirAction
        saisie={saisie}
        onChange={(patch) => setSaisie((s) => ({ ...s, ...patch }))}
        erreurs={erreurs}
        envoi={envoi}
        echec={echec}
        onReessayer={soumettre}
        onSoumettre={soumettre}
        personnes={personnes}
        responsables={responsables}
        onRechargerResponsables={onRechargerResponsables}
        ids={ids}
        aujourdhui={jourLocal()}
      />
    </Modal>
  );
}
