import React, { useState } from 'react';
import Modal from '../components/ui/Modal';
import Button from '../components/ui/Button';
import { SUPPORT_EMAIL, mailtoSupport } from '../utils/contact';
import { ROLE_LABELS } from '../utils/vocabulaire';

const OBJET = 'Mot de passe oublié - IKAN AI';

/**
 * « Mot de passe oublié ? » sous le champ mot de passe (lot 6).
 * L'API n'a pas de réinitialisation en libre-service : un mot de passe est réinitialisé par un administrateur (le responsable
 * expérience client pour ses responsables d'agence, l'équipe IKAN AI pour les responsables expérience client). Le lien ouvre
 * donc une boîte qui dit qui contacter, avec l'adresse ; il ne mène à aucune fausse page.
 */
/** Qui contacter, selon le rôle, avec l'adresse de l'équipe IKAN AI. */
export function QuiContacter() {
  return (
    <dl className="login-oubli__qui">
      <dt>Vous êtes {ROLE_LABELS.agency_manager.toLowerCase()}</dt>
      <dd>Demandez au {ROLE_LABELS.cx_manager.toLowerCase()} de votre entreprise.</dd>
      <dt>Vous êtes {ROLE_LABELS.cx_manager.toLowerCase()}</dt>
      <dd>
        Écrivez à l’équipe IKAN AI : <a href={mailtoSupport(OBJET)}>{SUPPORT_EMAIL}</a>
      </dd>
    </dl>
  );
}

export default function MotDePasseOublie() {
  const [ouvert, setOuvert] = useState(false);
  return (
    <>
      <button type="button" className="login-oubli" onClick={() => setOuvert(true)}>
        Mot de passe oublié ?
      </button>
      <Modal
        open={ouvert}
        onClose={() => setOuvert(false)}
        size="sm"
        title="Mot de passe oublié"
        subtitle="Par sécurité, un mot de passe ne se réinitialise pas en ligne : un administrateur vous en donne un nouveau."
        footer={<Button variant="secondary" onClick={() => setOuvert(false)}>Fermer</Button>}
      >
        <QuiContacter />
      </Modal>
    </>
  );
}
