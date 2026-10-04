import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  placement?: 'top' | 'bottom' | 'right' | 'left';
  /** Délai d'ouverture au survol en ms (le focus clavier ouvre immédiatement). */
  delay?: number;
  /**
   * true quand le contenu répète un libellé déjà accessible (ex. aria-label
   * d'un IconButton) : pas d'aria-describedby pour éviter une double lecture.
   */
  decorative?: boolean;
}

const GAP = 8;

/**
 * Infobulle accessible (WCAG 1.4.13) : ouverture au survol ET au focus,
 * fermeture par Échap, reste visible tant que le pointeur/focus est là.
 * Le contenu est complémentaire : jamais la seule source d'une information.
 */
export default function Tooltip({ content, children, placement = 'top', delay = 250, decorative = false }: TooltipProps) {
  const id = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number>();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const show = useCallback((immediate: boolean) => {
    window.clearTimeout(timer.current);
    if (immediate) setOpen(true);
    else timer.current = window.setTimeout(() => setOpen(true), delay);
  }, [delay]);

  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    setOpen(false);
    setPos(null);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hide(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', hide, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', hide, true);
    };
  }, [open, hide]);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !tipRef.current) return;
    const a = anchorRef.current.getBoundingClientRect();
    const t = tipRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let side = placement;
    if (side === 'top' && a.top - t.height - GAP < 0) side = 'bottom';
    else if (side === 'bottom' && a.bottom + t.height + GAP > vh) side = 'top';
    else if (side === 'right' && a.right + t.width + GAP > vw) side = 'left';
    else if (side === 'left' && a.left - t.width - GAP < 0) side = 'right';

    let top = 0;
    let left = 0;
    if (side === 'top' || side === 'bottom') {
      top = side === 'top' ? a.top - t.height - GAP : a.bottom + GAP;
      left = a.left + a.width / 2 - t.width / 2;
    } else {
      top = a.top + a.height / 2 - t.height / 2;
      left = side === 'right' ? a.right + GAP : a.left - t.width - GAP;
    }
    left = Math.min(Math.max(GAP, left), vw - t.width - GAP);
    top = Math.min(Math.max(GAP, top), vh - t.height - GAP);
    setPos({ top, left });
  }, [open, placement, content]);

  const child = decorative
    ? children
    : React.cloneElement(children, { 'aria-describedby': open ? id : undefined } as Record<string, unknown>);

  return (
    <>
      <span
        ref={anchorRef}
        style={{ display: 'inline-flex', maxWidth: '100%' }}
        onPointerEnter={() => show(false)}
        onPointerLeave={hide}
        onFocus={() => show(true)}
        onBlur={hide}
      >
        {child}
      </span>
      {open && content != null && createPortal(
        <div
          ref={tipRef}
          id={id}
          role="tooltip"
          className="ui-tooltip"
          style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: 'hidden' }}
        >
          {content}
        </div>,
        document.body,
      )}
    </>
  );
}
