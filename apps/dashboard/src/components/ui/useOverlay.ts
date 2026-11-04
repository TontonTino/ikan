import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let scrollLocks = 0;

/**
 * Pile des overlays ouverts (le dernier est au premier plan). Une boîte ouverte PAR-DESSUS une autre (ex. « Définir une action » sur le détail d'un problème)
 * est seule à réagir à Échap et à Tab : sans cela, Échap fermerait les deux et le focus serait piégé par la boîte du dessous.
 */
const pile: symbol[] = [];
export const estAuPremierPlan = (jeton: symbol, empilees: readonly symbol[] = pile): boolean => empilees[empilees.length - 1] === jeton;

/**
 * Comportement commun Modal / Drawer :
 *  - focus placé dans le panneau à l'ouverture, rendu à l'élément d'origine à la fermeture ;
 *  - Tab / Shift+Tab bouclent dans le panneau (focus trap) ;
 *  - Échap ferme ;
 *  - scroll de la page verrouillé tant qu'un overlay est ouvert (compteur : overlays empilés).
 */
export function useOverlay<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const panelRef = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const jeton = Symbol('overlay');
    pile.push(jeton);

    const first = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    scrollLocks += 1;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e: KeyboardEvent) => {
      if (!estAuPremierPlan(jeton)) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const rang = pile.indexOf(jeton);
      if (rang >= 0) pile.splice(rang, 1);
      scrollLocks -= 1;
      if (scrollLocks === 0) document.body.style.overflow = '';
      previouslyFocused?.focus?.();
    };
  }, [open]);

  return panelRef;
}
