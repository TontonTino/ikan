import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AlertesResponse } from '../../types';
import { AlertTriangleIcon, BellIcon, MessageSquareIcon } from '../common/Icons';
import { raisonLabel, alerteFeedbackAnchor, alerteSeuilAnchor } from '../alerts/alerteLabels';
import { fullDate, relativeTime } from '../ui/format';

/*
 * Cloche = centre de notifications : événements récents, format court,
 * lien direct vers l'alerte. Pas d'analyse, pas de filtres (→ page Alertes).
 *
 * Limite API : les alertes de seuil sont des ÉTATS (agence sous son seuil),
 * sans identifiant ni date — affichées « En cours », jamais avec une date
 * inventée. Seules les alertes feedback portent un horodatage.
 */

const MAX_ITEMS = 8;

interface NotifItem {
  key: string;
  kind: 'seuil' | 'feedback';
  title: string;
  agence: string;
  date?: string;
  href: string;
  unread: boolean;
}

interface SeenState {
  /** Horodatage de la dernière ouverture (alertes feedback plus récentes = non lues). */
  lastOpenedAt: number;
  /** Clés des alertes de seuil déjà vues (agence + niveau). */
  seuils: string[];
}

const storageKey = (userId: string) => `ikan-notifications-seen-${userId}`;

function readSeen(userId: string): SeenState {
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (raw) return JSON.parse(raw) as SeenState;
  } catch {
    // stockage indisponible : tout est considéré comme non lu, sans bloquer l'affichage
  }
  return { lastOpenedAt: 0, seuils: [] };
}

function writeSeen(userId: string, seen: SeenState) {
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(seen));
  } catch {
    // préférence non persistée : sans conséquence fonctionnelle
  }
}

const seuilKey = (agenceId: string, taux: number, seuil: number) => `${agenceId}_${taux}_${seuil}`;

export interface NotificationCenterProps {
  userId: string;
  data: AlertesResponse | null;
  loading: boolean;
  /** Afficher l'agence dans chaque ligne (vue réseau CX). */
  showAgency: boolean;
  /** Ouvert au montage (vitrine / tests). */
  defaultOpen?: boolean;
}

export default function NotificationCenter({ userId, data, loading, showAgency, defaultOpen = false }: NotificationCenterProps) {
  const panelId = useId();
  const titleId = useId();
  const [open, setOpen] = useState(defaultOpen);
  const [seen, setSeen] = useState<SeenState>(() => readSeen(userId));
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => setSeen(readSeen(userId)), [userId]);

  const items = useMemo<NotifItem[]>(() => {
    if (!data) return [];
    const seuils: NotifItem[] = (data.alertes_seuil ?? []).map((a) => ({
      key: `s-${a.agence_id}`,
      kind: 'seuil',
      title: `Satisfaction ${a.taux_actuel} % (seuil ${a.seuil} %)`,
      agence: a.agence_nom,
      href: `/alertes#${alerteSeuilAnchor(a.agence_id)}`,
      unread: !seen.seuils.includes(seuilKey(a.agence_id, a.taux_actuel, a.seuil)),
    }));
    const feedbacks: NotifItem[] = [...(data.alertes_feedback ?? [])]
      .sort((x, y) => new Date(y.date_soumission).getTime() - new Date(x.date_soumission).getTime())
      .map((f) => ({
        key: `f-${f.feedback_id}`,
        kind: 'feedback',
        title: `${raisonLabel(f.raison)} · ${f.note}/5`,
        agence: f.agence_nom,
        date: f.date_soumission,
        href: `/alertes#${alerteFeedbackAnchor(f.feedback_id)}`,
        unread: new Date(f.date_soumission).getTime() > seen.lastOpenedAt,
      }));
    // Non lues d'abord, puis états en cours, puis événements datés du plus récent au plus ancien.
    return [...seuils, ...feedbacks].sort((a, b) => Number(b.unread) - Number(a.unread));
  }, [data, seen]);

  const unreadCount = items.filter((i) => i.unread).length;
  const visible = items.slice(0, MAX_ITEMS);

  const markAllSeen = () => {
    if (!data) return;
    const next: SeenState = {
      lastOpenedAt: Date.now(),
      seuils: (data.alertes_seuil ?? []).map((a) => seuilKey(a.agence_id, a.taux_actuel, a.seuil)),
    };
    writeSeen(userId, next);
    // L'état « non lu » reste visible pendant l'ouverture ; il est appliqué à la fermeture.
    return next;
  };

  const close = (returnFocus = true) => {
    setOpen(false);
    const next = markAllSeen();
    if (next) setSeen(next);
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

  const label = loading
    ? 'Notifications, chargement'
    : unreadCount > 0
      ? `Notifications : ${unreadCount} nouvelle${unreadCount > 1 ? 's' : ''}`
      : 'Notifications : rien de nouveau';

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
        {unreadCount > 0 && (
          <span className="notif__count" aria-hidden="true">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div ref={panelRef} id={panelId} role="dialog" aria-labelledby={titleId} className="notif__panel">
          <div className="notif__head">
            <h2 id={titleId} className="notif__title">Notifications</h2>
            {unreadCount > 0 && <span className="notif__new">{unreadCount} nouvelle{unreadCount > 1 ? 's' : ''}</span>}
          </div>

          {loading && !data ? (
            <p className="notif__empty">Chargement…</p>
          ) : visible.length === 0 ? (
            <p className="notif__empty">Rien à signaler pour le moment. Les nouvelles alertes apparaîtront ici.</p>
          ) : (
            <ul className="notif__list">
              {visible.map((n) => (
                <li key={n.key} className={`notif__item${n.unread ? ' is-unread' : ''}`}>
                  <span className={`notif__icon notif__icon--${n.kind}`} aria-hidden="true">
                    {n.kind === 'seuil' ? <AlertTriangleIcon size={16} /> : <MessageSquareIcon size={16} />}
                  </span>
                  <div className="notif__body">
                    <p className="notif__item-title">
                      {n.unread && <span className="ui-sr-only">Nouveau : </span>}
                      {n.title}
                    </p>
                    <p className="notif__meta">
                      {showAgency && <span>{n.agence}</span>}
                      {showAgency && <span aria-hidden="true"> · </span>}
                      {n.date ? (
                        <time dateTime={n.date} title={fullDate(n.date)}>{relativeTime(n.date)}</time>
                      ) : (
                        <span>En cours</span>
                      )}
                    </p>
                    <Link to={n.href} className="notif__link" onClick={() => close(false)}>
                      Voir l'alerte<span className="ui-sr-only"> : {n.title}{showAgency ? `, ${n.agence}` : ''}</span>
                    </Link>
                  </div>
                  {n.unread && <span className="notif__dot" aria-hidden="true" />}
                </li>
              ))}
            </ul>
          )}

          <div className="notif__foot">
            <Link to="/alertes" className="notif__all" onClick={() => close(false)}>
              Toutes les alertes{items.length > MAX_ITEMS ? ` (${items.length})` : ''}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
