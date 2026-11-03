import React, { useId, useRef, useState } from 'react';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import { alertesApi } from '../../services/api';
import type { Alerte } from '../../types';
import {
  COMMENTAIRE_MAX,
  SEUIL_COMPTEUR_VOCAL,
  caracteresRestants,
  compteurCommentaire,
  envoyerPriseEnCharge,
  episodeDeAlerte,
} from '../../utils/episodesAlertes';

/** Issue de la boîte de dialogue, transmise à la page pour rafraîchir la liste, annoncer le résultat et replacer le focus. */
export type IssuePriseEnCharge = { type: 'succes' } | { type: 'conflit'; message: string };

interface CorpsProps {
  agenceNom: string;
  commentaire: string;
  onCommentaire: (valeur: string) => void;
  envoi: boolean;
  erreur: string | null;
  onReessayer: () => void;
  idChamp: string;
  idCompteur: string;
}

/**
 * Corps de la boîte de dialogue : ce que la prise en charge veut dire, le commentaire facultatif (500 caractères, compteur) et l'erreur éventuelle.
 * Le champ porte `data-autofocus` : le focus y est placé à l'ouverture (useOverlay). L'erreur est dans une région `role="alert"` (annoncée aussitôt).
 */
export function CorpsPriseEnCharge({ agenceNom, commentaire, onCommentaire, envoi, erreur, onReessayer, idChamp, idCompteur }: CorpsProps) {
  const restants = caracteresRestants(commentaire);
  return (
    <div className="alerte-dialogue__corps">
      <p className="alerte-dialogue__texte">
        Vous indiquez à votre CX Manager que vous vous occupez de la situation de <strong>{agenceNom}</strong>. L’alerte reste affichée avec l’état « Prise en
        charge » jusqu’à ce que la satisfaction repasse au-dessus du seuil.
      </p>
      <div className="alerte-dialogue__champ">
        <label htmlFor={idChamp} className="alerte-dialogue__label">Commentaire <span className="alerte-dialogue__facultatif">(facultatif)</span></label>
        <textarea
          id={idChamp}
          className="alerte-dialogue__saisie"
          data-autofocus
          rows={4}
          maxLength={COMMENTAIRE_MAX}
          value={commentaire}
          readOnly={envoi}
          aria-describedby={idCompteur}
          placeholder="Ex. : rappel de l’équipe d’accueil prévu demain matin."
          onChange={(e) => onCommentaire(e.target.value)}
        />
        <p id={idCompteur} className={`alerte-dialogue__compteur${restants <= SEUIL_COMPTEUR_VOCAL ? ' is-limite' : ''}`}>{compteurCommentaire(commentaire)}</p>
        {/* Annonce vocale seulement à l'approche de la limite : pas à chaque frappe. */}
        <span className="ui-sr-only" role="status">
          {restants <= SEUIL_COMPTEUR_VOCAL ? (restants === 0 ? 'Limite de caractères atteinte.' : `Il reste ${restants} caractère${restants > 1 ? 's' : ''}.`) : ''}
        </span>
      </div>
      {erreur && (
        <Alert
          tone="critical"
          title={erreur}
          action={<Button size="sm" variant="secondary" onClick={onReessayer} disabled={envoi}>Réessayer</Button>}
        />
      )}
    </div>
  );
}

interface PiedProps {
  envoi: boolean;
  onAnnuler: () => void;
  onConfirmer: () => void;
}

/** Pied de la boîte : « Annuler » et la confirmation explicite. Pendant l'envoi : les deux sont désactivés et la confirmation montre un indicateur de chargement. */
export function PiedPriseEnCharge({ envoi, onAnnuler, onConfirmer }: PiedProps) {
  return (
    <>
      <Button variant="ghost" onClick={onAnnuler} disabled={envoi}>Annuler</Button>
      <Button variant="primary" onClick={onConfirmer} loading={envoi}>{envoi ? 'Enregistrement…' : 'Confirmer la prise en charge'}</Button>
    </>
  );
}

interface DialogProps {
  /** L'alerte à prendre en charge ; null : la boîte est fermée. */
  alerte: Alerte | null;
  onFermer: () => void;
  onTermine: (issue: IssuePriseEnCharge) => void;
}

/**
 * Boîte de dialogue de prise en charge (Agency Manager). Construite sur <Modal> : focus piégé, Échap ferme, focus rendu au bouton qui l'a ouverte.
 * Pendant l'envoi, Échap et « Fermer » sont sans effet (pas de double envoi ni d'abandon silencieux). 409 / 404 : la boîte se ferme et la page rafraîchit la
 * liste avec un message clair ; autre erreur : la boîte reste ouverte, le commentaire est conservé, « Réessayer ».
 */
export default function PriseEnChargeDialog({ alerte, onFermer, onTermine }: DialogProps) {
  const [commentaire, setCommentaire] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const enCours = useRef(false);
  const idChamp = useId();
  const idCompteur = useId();
  const episode = alerte ? episodeDeAlerte(alerte) : null;

  const fermer = () => {
    if (enCours.current) return;
    setCommentaire('');
    setErreur(null);
    onFermer();
  };

  const confirmer = async () => {
    if (!episode || enCours.current) return;
    enCours.current = true;
    setEnvoi(true);
    setErreur(null);
    const resultat = await envoyerPriseEnCharge(alertesApi.prendreEnCharge, episode.id, commentaire);
    enCours.current = false;
    setEnvoi(false);
    if (resultat.type === 'reessayer') {
      setErreur(resultat.message);
      return;
    }
    setCommentaire('');
    onTermine(resultat.type === 'succes' ? { type: 'succes' } : { type: 'conflit', message: resultat.message });
  };

  return (
    <Modal
      open={alerte !== null}
      onClose={fermer}
      title="Prendre en charge cette alerte"
      subtitle={alerte ? `${alerte.agence_nom} · Satisfaction sous le seuil` : undefined}
      size="sm"
      dismissOnScrim={false}
      footer={<PiedPriseEnCharge envoi={envoi} onAnnuler={fermer} onConfirmer={confirmer} />}
    >
      <CorpsPriseEnCharge
        agenceNom={alerte?.agence_nom ?? ''}
        commentaire={commentaire}
        onCommentaire={setCommentaire}
        envoi={envoi}
        erreur={erreur}
        onReessayer={confirmer}
        idChamp={idChamp}
        idCompteur={idCompteur}
      />
    </Modal>
  );
}
