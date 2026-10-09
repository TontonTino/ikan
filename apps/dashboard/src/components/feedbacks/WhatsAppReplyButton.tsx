import React, { useId, useState } from 'react';
import { construireLienWhatsApp } from '../../utils/whatsapp';
import { MessageSquareIcon, SendIcon, AlertTriangleIcon } from '../common/Icons';

/** À n'utiliser que pour l'Agency Manager : c'est le parent qui décide de l'afficher. */
interface Props {
  /** Numéro tel que laissé par le client (affichage uniquement). */
  telephone?: string | null;
  /** Numéro normalisé par l'API (`telephone_whatsapp`) ; null/absent si le numéro stocké est invalide. */
  telephoneWhatsapp?: string | null;
  className?: string;
}

const noteStyle: React.CSSProperties = { margin: 0, fontSize: '0.78rem', color: '#64748B', lineHeight: 1.5 };

/**
 * « Répondre au client » via WhatsApp : ouvre wa.me avec le numéro et le message prérempli
 * dans un nouvel onglet. Aucun envoi automatique (l'Agency Manager appuie lui-même sur
 * « Envoyer » dans WhatsApp), aucun appel API, la demande de rappel n'est PAS marquée traitée.
 */
export default function WhatsAppReplyButton({ telephone, telephoneWhatsapp, className }: Props) {
  const [ouvert, setOuvert] = useState(false);
  const [message, setMessage] = useState('');
  const [erreur, setErreur] = useState('');
  const champId = useId();

  if (!telephone) {
    return (
      <div className={className}>
        <button type="button" className="btn-secondary" disabled style={{ padding: '8px 14px', fontSize: '0.8rem', borderRadius: '10px', opacity: 0.55, cursor: 'not-allowed' }}>
          <MessageSquareIcon size={14} />
          <span>Répondre au client</span>
        </button>
        <p style={{ ...noteStyle, marginTop: '6px' }}>
          Le client n’a pas laissé de numéro de téléphone : impossible de lui répondre sur WhatsApp.
        </p>
      </div>
    );
  }

  if (!telephoneWhatsapp) {
    return (
      <div className={className} role="alert" style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', color: '#B45309', fontSize: '0.8rem', fontWeight: 600, lineHeight: 1.5 }}>
        <AlertTriangleIcon size={15} color="#B45309" />
        <span>
          Le numéro laissé par le client (« {telephone} ») n’est pas valide : WhatsApp ne peut pas être ouvert.
          Un numéro burkinabè compte 8 chiffres (ex. 70 12 34 56).
        </span>
      </div>
    );
  }

  const ouvrirWhatsApp = () => {
    const lien = construireLienWhatsApp(telephoneWhatsapp, message);
    if (!lien) {
      setErreur('Rédigez votre réponse avant d’ouvrir WhatsApp.');
      return;
    }
    setErreur('');
    // Appelé directement par le clic (pas après un await) pour ne pas être bloqué comme pop-up.
    window.open(lien, '_blank', 'noopener,noreferrer');
  };

  if (!ouvert) {
    return (
      <div className={className}>
        <button type="button" onClick={() => setOuvert(true)} className="btn-primary" style={{ padding: '8px 14px', fontSize: '0.8rem', borderRadius: '10px' }}>
          <MessageSquareIcon size={14} />
          <span>Répondre au client</span>
        </button>
      </div>
    );
  }

  return (
    <div className={className} style={{ background: '#FFFFFF', padding: '14px', borderRadius: '12px', border: '1px solid #FFEDD5' }}>
      <label htmlFor={champId} style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#431407', marginBottom: '6px' }}>
        Réponse par WhatsApp au {telephone}
      </label>
      <textarea
        id={champId}
        rows={4}
        value={message}
        onChange={(e) => { setMessage(e.target.value); if (erreur) setErreur(''); }}
        placeholder="Rédigez votre réponse au client…"
        style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #E2E8F0', fontSize: '0.84rem', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: '8px' }}
      />
      <p style={{ ...noteStyle, marginBottom: '10px' }}>
        WhatsApp s’ouvre avec ce message prérempli : vous appuyez vous-même sur « Envoyer ». IKAN AI n’envoie rien
        et ne marque pas la demande de rappel comme traitée.
      </p>
      {erreur && (
        <p role="alert" style={{ margin: '0 0 8px', fontSize: '0.78rem', fontWeight: 700, color: '#B91C1C' }}>{erreur}</p>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
        <button type="button" onClick={() => { setOuvert(false); setErreur(''); }} className="btn-secondary" style={{ padding: '6px 12px', fontSize: '0.78rem', borderRadius: '8px' }}>
          Fermer
        </button>
        <button
          type="button"
          onClick={ouvrirWhatsApp}
          disabled={!message.trim()}
          className="btn-primary"
          style={{ padding: '6px 14px', fontSize: '0.78rem', borderRadius: '8px', opacity: message.trim() ? 1 : 0.5, cursor: message.trim() ? 'pointer' : 'not-allowed' }}
        >
          <SendIcon size={12} />
          <span>Ouvrir WhatsApp</span>
        </button>
      </div>
    </div>
  );
}
