import React from 'react';
import { AlertTriangleIcon, CheckCircleIcon, LockIcon } from '../common/Icons';

/** Champs de traitement et de consentement d'une demande de rappel (app/schemas/feedback.py::DemandeContactInfo). */
export interface ChampsTraitementDemande {
  traitee: boolean;
  date_traitement?: string | null;
  traitee_par_nom?: string | null;
  coordonnees_masquees?: boolean;
  consentement_contact?: boolean | null;
  consentement_date?: string | null;
  consentement_retention_mois?: number | null;
}

export const MESSAGE_CONFIRMATION_RECONTACT = 'Les coordonnées du client seront masquées une fois la demande traitée.';
export const MESSAGE_AVERTISSEMENT_REPONSE = 'Enregistrer la réponse marque la demande comme recontactée et masque les coordonnées du client.';

const dateLongue = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
const dateHeure = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * Confirmation AVANT « Marquer comme recontacté » : le masquage est définitif. Boutons natifs (accessibles au clavier),
 * cibles de 44 px minimum, Échap = Annuler, focus initial sur « Annuler » (le choix le moins lourd de conséquences).
 */
export function ConfirmationRecontact({ onConfirmer, onAnnuler, chargement = false }: { onConfirmer: () => void; onAnnuler: () => void; chargement?: boolean }) {
  const bouton: React.CSSProperties = { minHeight: 44, minWidth: 44, padding: '10px 18px', fontSize: '0.84rem', borderRadius: '10px', fontWeight: 800 };
  return (
    <div
      role="group"
      aria-label="Confirmer : marquer comme recontacté"
      onKeyDown={(e) => { if (e.key === 'Escape') onAnnuler(); }}
      style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '14px 16px', background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: '12px' }}
    >
      <p role="alert" style={{ margin: 0, display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '0.86rem', fontWeight: 700, color: '#7C2D12', lineHeight: 1.5 }}>
        <AlertTriangleIcon size={16} color="#9A3412" aria-hidden="true" />
        <span>{MESSAGE_CONFIRMATION_RECONTACT}</span>
      </p>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <button type="button" className="btn-secondary" style={bouton} onClick={onAnnuler} disabled={chargement} autoFocus>Annuler</button>
        <button type="button" className="btn-primary" style={bouton} onClick={onConfirmer} disabled={chargement}>{chargement ? 'Enregistrement…' : 'Confirmer'}</button>
      </div>
    </div>
  );
}

/** Avertissement à côté du formulaire « Enregistrer une réponse » : le geste traite aussi la demande de rappel. */
export function AvertissementReponse() {
  return (
    <p role="note" style={{ margin: '0 0 10px', display: 'flex', alignItems: 'flex-start', gap: '6px', fontSize: '0.78rem', fontWeight: 700, color: '#9A3412', lineHeight: 1.5 }}>
      <AlertTriangleIcon size={14} color="#9A3412" aria-hidden="true" />
      <span>{MESSAGE_AVERTISSEMENT_REPONSE}</span>
    </p>
  );
}

/** Remplace téléphone et e-mail d'une demande traitée (l'API ne les renvoie plus : ce n'est pas seulement un affichage). */
export function CoordonneesMasquees() {
  return (
    <p style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#475569', fontSize: '0.82rem', fontWeight: 700 }}>
      <LockIcon size={14} color="#475569" aria-hidden="true" />
      <span>Coordonnées masquées : la demande a été traitée.</span>
    </p>
  );
}

/** Consentement à être recontacté. « Consentement non enregistré » (lignes antérieures à la migration 030) ne bloque rien. */
export function ConsentementContact({ demande }: { demande: ChampsTraitementDemande }) {
  let texte: string;
  if (demande.consentement_contact === true) {
    texte = `Consentement : oui${demande.consentement_date ? `, donné le ${dateLongue(demande.consentement_date)}` : ''}`;
    if (demande.consentement_retention_mois) texte += ` · conservation annoncée au client : ${demande.consentement_retention_mois} mois`;
  } else if (demande.consentement_contact === false) {
    texte = 'Consentement : non';
  } else {
    texte = 'Consentement non enregistré';
  }
  return <p style={{ margin: 0, fontSize: '0.78rem', color: '#64748B', fontWeight: 600 }}>{texte}</p>;
}

/** « Recontactée le … par … » ; date et auteur absents pour une demande traitée avant la migration 032. */
export function InfoTraitement({ demande }: { demande: ChampsTraitementDemande }) {
  if (!demande.traitee) return null;
  const par = demande.traitee_par_nom ? ` par ${demande.traitee_par_nom}` : '';
  return (
    <p style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: '#3C7730', fontWeight: 700 }}>
      <CheckCircleIcon size={14} color="#3C7730" aria-hidden="true" />
      <span>{demande.date_traitement ? `Recontactée le ${dateHeure(demande.date_traitement)}${par}` : 'Recontactée (date non enregistrée)'}</span>
    </p>
  );
}
