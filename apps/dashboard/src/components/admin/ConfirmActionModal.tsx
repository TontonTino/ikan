import React, { useEffect, useState } from 'react';
import Button from '../ui/Button';
import Modal from '../ui/Modal';

interface ConfirmActionModalProps {
  title: string;
  /** Élément concerné, affiché en évidence (nom de l'organisation, du compte…). */
  subject: string;
  /** Conséquences de l'opération, telles qu'elles se produisent réellement. */
  children: React.ReactNode;
  confirmLabel: string;
  /** Si renseigné, l'utilisateur doit recopier ce texte pour activer la confirmation. */
  requireText?: string;
  danger?: boolean;
  busy?: boolean;
  /** Message d'échec propre à l'opération (jamais un détail brut de l'API). */
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation d'une opération sensible : rappelle l'élément concerné et les conséquences
 * avant de lancer l'appel. Reste ouverte en cas d'échec pour afficher l'erreur et réessayer.
 */
export default function ConfirmActionModal({
  title, subject, children, confirmLabel, requireText, danger = true, busy = false, error, onConfirm, onCancel,
}: ConfirmActionModalProps) {
  const [saisie, setSaisie] = useState('');
  useEffect(() => setSaisie(''), [subject]);
  const autorise = !requireText || saisie.trim().toLowerCase() === requireText.trim().toLowerCase();

  return (
    <Modal
      open
      onClose={busy ? () => undefined : onCancel}
      dismissOnScrim={false}
      size="sm"
      title={title}
      subtitle={subject}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Annuler</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={busy} disabled={!autorise}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', fontSize: '0.88rem', lineHeight: 1.5, color: 'var(--color-text-body)' }}>
        {children}
        {requireText && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontWeight: 700, fontSize: '0.8rem' }}>
            Pour confirmer, recopiez « {requireText} »
            <input
              type="text"
              value={saisie}
              onChange={(e) => setSaisie(e.target.value)}
              autoComplete="off"
              disabled={busy}
              style={{ minHeight: 44, padding: '0 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', fontFamily: 'inherit', fontSize: '0.9rem' }}
            />
          </label>
        )}
        {error && (
          <p role="alert" style={{ margin: 0, color: 'var(--color-critical-text)', fontWeight: 700 }}>{error}</p>
        )}
      </div>
    </Modal>
  );
}
