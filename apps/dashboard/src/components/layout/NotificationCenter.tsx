import React, { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Feedback } from '../../types';
import { BellIcon, MessageSquareIcon } from '../common/Icons';
import { fullDate, relativeTime } from '../ui/format';
import { LIEN_FILE_A_TRAITER, estEnRetard, lienAvisDeLaFile } from '../../utils/fileATraiter';

/*
 * Cloche = la file « À traiter » (lot 3), et rien d'autre : son compteur est le nombre d'avis de la file, le même que l'onglet
 * « À traiter » de la page Avis et que le lien de la page Alertes. Les alertes de seuil restent sur la page Alertes.
 * Les avis arrivent dans l'ordre du serveur : sans prise en charge depuis plus de 48 h d'abord, puis du plus récent au plus ancien.
 */

const MAX_ITEMS = 8;

export interface FileATraiter {
  /** Premiers avis de la file, dans l'ordre du serveur. */
  avis: Feedback[];
  /** Nombre total d'avis de la file (en-tête X-Total-Count). */
  total: number;
}

export interface NotificationCenterProps {
  file: FileATraiter | null;
  loading: boolean;
  /** Afficher l'agence dans chaque ligne (vue réseau CX). */
  showAgency: boolean;
  /** Ouvert au montage (vitrine / tests). */
  defaultOpen?: boolean;
  /** Date de référence (tests) : sert à repérer les avis en retard. */
  maintenant?: Date;
}

const extrait = (avis: Feedback) => {
  const texte = (avis.commentaire ?? '').trim().replace(/\s+/g, ' ');
  return texte || 'Sans commentaire';
};

export default function NotificationCenter({ file, loading, showAgency, defaultOpen = false, maintenant }: NotificationCenterProps) {
  const panelId = useId();
  const titleId = useId();
  const [open, setOpen] = useState(defaultOpen);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const total = file?.total ?? 0;
  const visible = (file?.avis ?? []).slice(0, MAX_ITEMS);

  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>('a, button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const label = loading && !file
    ? 'Avis à traiter, chargement'
    : total > 0
      ? `Avis à traiter : ${total}`
      : 'Avis à traiter : aucun';

  return (
    <div className="notif" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`notif__bell${open ? ' is-open' : ''}`}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <BellIcon size={18} aria-hidden="true" />
        {total > 0 && (
          <span className="notif__count" aria-hidden="true">
            {total > 9 ? '9+' : total}
          </span>
        )}
      </button>

      {open && (
        <div ref={panelRef} id={panelId} role="dialog" aria-labelledby={titleId} className="notif__panel">
          <div className="notif__head">
            <h2 id={titleId} className="notif__title">Avis à traiter</h2>
            {total > 0 && <span className="notif__new">{total} avis</span>}
          </div>

          {loading && !file ? (
            <p className="notif__empty">Chargement…</p>
          ) : visible.length === 0 ? (
            <p className="notif__empty">Aucun avis à traiter pour le moment.</p>
          ) : (
            <ul className="notif__list">
              {visible.map((avis) => {
                const enRetard = estEnRetard(avis, maintenant);
                return (
                  <li key={avis.id} className={`notif__item${enRetard ? ' is-late' : ''}`}>
                    <span className="notif__icon notif__icon--feedback" aria-hidden="true">
                      <MessageSquareIcon size={16} />
                    </span>
                    <div className="notif__body">
                      <p className="notif__item-title">
                        <span className="notif__note">{avis.note}/5<span className="ui-sr-only"> :</span></span>
                        <span className="notif__extrait">{extrait(avis)}</span>
                      </p>
                      <p className="notif__meta">
                        {showAgency && avis.agence_nom && <span>{avis.agence_nom} · </span>}
                        <time dateTime={avis.date_soumission} title={fullDate(avis.date_soumission)}>{relativeTime(avis.date_soumission)}</time>
                        {enRetard && <span> · sans prise en charge depuis plus de 48 h</span>}
                      </p>
                      <Link to={lienAvisDeLaFile(avis.id)} className="notif__link" onClick={() => close(false)}>
                        Ouvrir l'avis<span className="ui-sr-only"> noté {avis.note} sur 5{showAgency && avis.agence_nom ? `, ${avis.agence_nom}` : ''}</span>
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="notif__foot">
            <Link to={LIEN_FILE_A_TRAITER} className="notif__all" onClick={() => close(false)}>
              {total > 0 ? `Voir la file (${total} avis)` : 'Voir la page Avis'}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
