import React, { useRef, useState } from 'react';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import { issuesApi } from '../../services/api';
import type { ActionCorrective } from '../../types';
import { envoyerTerminaison, type EchecAction } from '../../utils/actionsProbleme';

/** Phrase de conséquence, affichée telle quelle avant l'envoi. */
export const TEXTE_CONFIRMATION_TERMINER = 'Cette action sera marquée comme terminée. Cette décision ne peut pas être annulée pour l’instant.';
export const TEXTE_DERNIERE_ACTION = 'C’est la dernière action à mener : le problème passera à « Résolu ». Le CX Manager pourra alors confirmer la résolution.';

interface CorpsProps {
  derniere: boolean;
  echec: EchecAction | null;
  envoi: boolean;
  onReessayer: () => void;
}

/** Corps de la confirmation : la conséquence en clair, puis l'erreur éventuelle (« Réessayer » seulement pour une erreur serveur ou réseau). */
export function CorpsTerminerAction({ derniere, echec, envoi, onReessayer }: CorpsProps) {
  return (
    <div className="alerte-dialogue__corps">
      <p className="alerte-dialogue__texte">{TEXTE_CONFIRMATION_TERMINER}</p>
      {derniere && <p className="alerte-dialogue__texte"><strong>{TEXTE_DERNIERE_ACTION}</strong></p>}
      {echec && (
        <Alert
          tone="critical"
          title={echec.message}
          action={echec.nature === 'serveur' ? <Button size="sm" variant="secondary" onClick={onReessayer} disabled={envoi}>Réessayer</Button> : undefined}
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

/** « Annuler » reçoit le focus à l'ouverture (choix sûr pour une décision irréversible) ; pendant l'envoi les deux boutons sont désactivés. */
export function PiedTerminerAction({ envoi, onAnnuler, onConfirmer }: PiedProps) {
  return (
    <>
      <Button variant="ghost" data-autofocus onClick={onAnnuler} disabled={envoi}>Annuler</Button>
      <Button variant="primary" onClick={onConfirmer} loading={envoi}>{envoi ? 'Enregistrement…' : 'Terminer l’action'}</Button>
    </>
  );
}

interface DialogProps {
  /** L'action à terminer ; null : la boîte est fermée. */
  action: ActionCorrective | null;
  issueId: string;
  /** Vrai si c'est la dernière action non terminée du problème. */
  derniere: boolean;
  onFermer: () => void;
  onTerminee: () => void;
  /** 404 / 409 : l'action n'est plus dans l'état attendu, la page rafraîchit et affiche le message. */
  onDisparue: (message: string) => void;
}

/**
 * Confirmation avant de terminer une action. L'envoi est verrouillé (un second clic ou Entrée pendant l'envoi est ignoré) et les boutons sont désactivés.
 * Aucun commentaire de clôture : l'API ne l'accepte pas (voir PR 3).
 */
export default function TerminerActionDialog({ action, issueId, derniere, onFermer, onTerminee, onDisparue }: DialogProps) {
  const [envoi, setEnvoi] = useState(false);
  const [echec, setEchec] = useState<EchecAction | null>(null);
  const enCours = useRef(false);

  const fermer = () => {
    if (enCours.current) return;
    setEchec(null);
    onFermer();
  };

  const confirmer = async () => {
    if (!action || enCours.current) return;
    enCours.current = true;
    setEnvoi(true);
    setEchec(null);
    const resultat = await envoyerTerminaison(issuesApi.terminerAction, issueId, action.id);
    enCours.current = false;
    setEnvoi(false);
    if (resultat.type === 'succes') {
      onTerminee();
      return;
    }
    if (resultat.nature === 'disparu') {
      setEchec(null);
      onDisparue(resultat.message);
      return;
    }
    setEchec({ nature: resultat.nature, message: resultat.message });
  };

  return (
    <Modal
      open={action !== null}
      onClose={fermer}
      title="Terminer cette action ?"
      subtitle={action?.titre}
      size="sm"
      dismissOnScrim={false}
      footer={<PiedTerminerAction envoi={envoi} onAnnuler={fermer} onConfirmer={confirmer} />}
    >
      <CorpsTerminerAction derniere={derniere} echec={echec} envoi={envoi} onReessayer={confirmer} />
    </Modal>
  );
}
