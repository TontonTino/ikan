import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangleIcon, CheckCircleIcon, InfoIcon, XCloseIcon } from '../common/Icons';
import IconButton from './IconButton';

export type ToastTone = 'success' | 'warning' | 'critical' | 'info';

export interface ToastOptions {
  tone?: ToastTone;
  title?: string;
  message: string;
  /** Durée en ms (défaut 4000 ; 0 = jusqu'à fermeture). Les erreurs restent 8 s. */
  duration?: number;
}

interface ToastItem extends Required<Omit<ToastOptions, 'title'>> {
  id: number;
  title?: string;
}

interface ToastApi {
  show: (opts: ToastOptions) => void;
  success: (message: string, title?: string) => void;
  error: (message: string, title?: string) => void;
  info: (message: string, title?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const ICONS: Record<ToastTone, React.ReactNode> = {
  success: <CheckCircleIcon size={18} />,
  warning: <AlertTriangleIcon size={18} />,
  critical: <AlertTriangleIcon size={18} />,
  info: <InfoIcon size={18} />,
};
const SR_PREFIX: Record<ToastTone, string> = { success: 'Succès : ', warning: 'Attention : ', critical: 'Erreur : ', info: '' };

function ToastView({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const timer = useRef<number>();
  const start = useCallback(() => {
    if (item.duration > 0) timer.current = window.setTimeout(() => onDismiss(item.id), item.duration);
  }, [item, onDismiss]);
  const pause = () => window.clearTimeout(timer.current);

  useEffect(() => {
    start();
    return pause;
  }, [start]);

  return (
    // Pause au survol/focus : laisse le temps de lire (WCAG 2.2.1)
    <li className={`ui-toast ui-toast--${item.tone}`} onPointerEnter={pause} onPointerLeave={start} onFocus={pause} onBlur={start}>
      <span className="ui-toast__icon" aria-hidden="true">{ICONS[item.tone]}</span>
      <div className="ui-toast__content">
        {item.title && <p className="ui-toast__title">{item.title}</p>}
        <p className="ui-toast__message">
          <span className="ui-sr-only">{SR_PREFIX[item.tone]}</span>
          {item.message}
        </p>
      </div>
      <IconButton label="Fermer la notification" icon={<XCloseIcon size={14} />} size="sm" variant="ghost" showTooltip={false} onClick={() => onDismiss(item.id)} />
    </li>
  );
}

/**
 * Notifications éphémères (confirmation d'action, erreur réseau).
 * Monté une fois à la racine (main.tsx). Régions live séparées : polite pour
 * le reste, assertive pour les erreurs.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);

  const show = useCallback((opts: ToastOptions) => {
    const tone = opts.tone ?? 'info';
    const item: ToastItem = {
      id: nextId.current++,
      tone,
      title: opts.title,
      message: opts.message,
      duration: opts.duration ?? (tone === 'critical' ? 8000 : 4000),
    };
    setItems((list) => [...list.slice(-3), item]); // 4 max à l'écran
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (message, title) => show({ tone: 'success', message, title }),
      error: (message, title) => show({ tone: 'critical', message, title }),
      info: (message, title) => show({ tone: 'info', message, title }),
    }),
    [show],
  );

  const polite = items.filter((t) => t.tone !== 'critical');
  const assertive = items.filter((t) => t.tone === 'critical');

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="ui-toast-region">
        <ol className="ui-toast-list" aria-live="polite" aria-label="Notifications">
          {polite.map((t) => <ToastView key={t.id} item={t} onDismiss={dismiss} />)}
        </ol>
        <ol className="ui-toast-list" aria-live="assertive" aria-label="Erreurs">
          {assertive.map((t) => <ToastView key={t.id} item={t} onDismiss={dismiss} />)}
        </ol>
      </div>
    </ToastContext.Provider>
  );
}

const noop: ToastApi = {
  show: () => undefined,
  success: () => undefined,
  error: () => undefined,
  info: () => undefined,
};

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx && import.meta.env.DEV) console.warn('useToast() appelé hors de <ToastProvider> : notification ignorée.');
  return ctx ?? noop;
}
