import React, { useEffect, useRef, useState } from 'react';
import { PlusIcon, SendIcon, XCloseIcon } from '../common/Icons';
import RichText from './RichText';
import YamAvatar from './YamAvatar';
import YamMascot from './YamMascot';
import YamPicture3D from './YamPicture3D';
import { YAM_PRESENCE } from '../../config';
import './yamPresence.css';
import { MAX_QUESTION_LENGTH, useYamChat } from './useYamChat';
import { useYamStore } from '../../stores/yamStore';
import { useAuthStore } from '../../stores/authStore';
import { PERIODE_JOURS } from '../../services/agent';

export const YAM_PANEL_ID = 'yam-chat-panel';

const SUGGESTIONS = [
  'Y a-t-il des alertes critiques ?',
  'Quels sont les problèmes récurrents ?',
  'Fais-moi un résumé de la période',
];

// Au-delà de ce délai, on prévient l'utilisateur (réveil possible du service d'hébergement).
const SLOW_HINT_MS = 12_000;

function ThinkingBubble() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), SLOW_HINT_MS);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div className="yam-row yam-row-assistant" role="status" aria-live="polite">
      <YamAvatar size={28} pulsing />
      <div className="yam-bubble yam-bubble-assistant">
        <span className="yam-thinking">
          YAM réfléchit
          <span className="yam-dots" aria-hidden="true">
            <span className="yam-dot" />
            <span className="yam-dot" />
            <span className="yam-dot" />
          </span>
        </span>
        {YAM_PRESENCE && (
          <span className="yam-attente">
            <YamMascot variant="tete" state="reflexion" size={30} />
            YAM analyse vos avis…
          </span>
        )}
        {slow && (
          <div className="yam-slow-hint">
            Cela prend un peu plus de temps que d’habitude (le service peut être en cours de réveil). Merci de patienter…
          </div>
        )}
      </div>
    </div>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Panneau de chat glissant avec YAM : fixé par-dessus la page (hors flux), il
 * reste monté même fermé pour conserver la conversation entre deux ouvertures.
 */
export default function YamChatPanel({ open, onClose }: Props) {
  const { messages, loading, send, retry, reset } = useYamChat();
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const prefill = useYamStore((s) => s.prefill);
  const user = useAuthStore((s) => s.user);

  // Périmètre réellement appliqué par l'agent : un responsable d'agence est limité à son agence (côté serveur),
  // un CX Manager voit toutes les agences de son organisation. L'utilisateur le voit ici, sans avoir à le deviner.
  const perimetre =
    user?.role === 'agency_manager'
      ? `Votre agence${user.agence_nom ? ` : ${user.agence_nom}` : ''}`
      : 'Toutes les agences de votre organisation';

  // Question contextuelle (ex. depuis le dashboard) : pré-remplie, jamais envoyée automatiquement.
  useEffect(() => {
    if (!prefill) return;
    setDraft(prefill.text.slice(0, MAX_QUESTION_LENGTH));
    const t = window.setTimeout(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }, 260);
    return () => window.clearTimeout(t);
  }, [prefill]);

  // À la fermeture, le focus retourne à l'élément qui avait ouvert le panneau (sinon il retombe sur <body>).
  const declencheur = useRef<HTMLElement | null>(null);
  const etaitOuvert = useRef(false);
  useEffect(() => {
    if (open) {
      declencheur.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      etaitOuvert.current = true;
    } else if (etaitOuvert.current) {
      etaitOuvert.current = false;
      const el = declencheur.current;
      declencheur.current = null;
      // Si l'élément d'origine a été remplacé entre-temps, on retombe sur le bouton d'entrée de YAM dans le menu.
      // Léger différé : la barre latérale se re-rend à la fermeture et peut remplacer le bouton qu'on vient de focaliser.
      window.setTimeout(() => {
        const cible = el && document.contains(el) ? el : document.querySelector<HTMLElement>(`[aria-controls="${YAM_PANEL_ID}"]`);
        cible?.focus();
      }, 80);
    }
  }, [open]);

  // Focus sur le champ à l'ouverture ; Échap ferme le panneau.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 250);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  // Défilement : une réponse de YAM s'affiche depuis son début (pas depuis sa fin, souvent longue) ;
  // question de l'utilisateur et indicateur d'attente : jusqu'en bas.
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last && last.role === 'assistant' && !loading) {
      messagesRef.current
        ?.querySelector(`[data-msg-id="${last.id}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages, loading, open]);

  const submit = () => {
    if (!draft.trim() || loading) return;
    send(draft);
    setDraft('');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const canSend = draft.trim().length > 0 && !loading;

  return (
    <aside
      id={YAM_PANEL_ID}
      className={`yam-panel${open ? ' yam-panel-open' : ''}`}
      role="dialog"
      aria-label="Discussion avec YAM, assistant IKAN AI"
      aria-hidden={!open}
    >
      {/* En-tête */}
      <header className="yam-header">
        <YamAvatar size={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="yam-title">YAM</div>
          <div className="yam-subtitle">Assistant IA d'IKAN AI</div>
        </div>
        <button
          type="button"
          className="yam-icon-btn"
          onClick={reset}
          disabled={messages.length === 0 && !loading}
          title="Nouvelle conversation"
          aria-label="Nouvelle conversation"
        >
          <PlusIcon size={17} />
        </button>
        <button
          type="button"
          className="yam-icon-btn"
          onClick={onClose}
          title="Fermer"
          aria-label="Fermer le panneau YAM"
        >
          <XCloseIcon size={17} />
        </button>
      </header>

      <p className="yam-scope">
        <strong>Périmètre :</strong> {perimetre} · {PERIODE_JOURS} derniers jours
      </p>

      {/* Messages */}
      <div className="yam-messages" aria-live="polite" ref={messagesRef}>
        {YAM_PRESENCE && messages.length === 0 && (
          <div className="yam-hero">
            <YamPicture3D largeur={110} alt="YAM" />
          </div>
        )}
        <div className="yam-row yam-row-assistant">
          <YamAvatar size={28} />
          <div className="yam-bubble yam-bubble-assistant">
            <p className="yam-paragraph">
              Bonjour, je suis <strong>YAM</strong>. Je peux analyser les avis de votre
              périmètre : alertes, thèmes, problèmes récurrents, tendances et recommandations.
            </p>
            <p className="yam-paragraph">
              Mes réponses sont générées automatiquement : vérifiez-les avant d’agir.
            </p>
            {messages.length === 0 && (
              <div className="yam-suggestions">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="yam-chip"
                    onClick={() => send(s)}
                    disabled={loading}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="yam-row yam-row-user">
              <div className="yam-bubble yam-bubble-user">{m.text}</div>
            </div>
          ) : m.role === 'error' ? (
            <div key={m.id} className="yam-row yam-row-assistant" role="alert">
              <YamAvatar size={28} />
              <div className="yam-bubble yam-bubble-error">
                <div>
                  {YAM_PRESENCE && (
                    <span className="yam-erreur-mascotte">
                      <YamMascot variant="tete" state="alerte" size={30} />
                    </span>
                  )}
                  {m.text}
                </div>
                {m.retryQuestion && (
                  <button
                    type="button"
                    className="yam-retry"
                    onClick={() => retry(m.id, m.retryQuestion as string)}
                    disabled={loading}
                  >
                    Réessayer
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div key={m.id} data-msg-id={m.id} className="yam-row yam-row-assistant">
              <YamAvatar size={28} />
              <div className="yam-bubble yam-bubble-assistant">
                <RichText text={m.text} />
                {m.intention === 'autre' && (
                  <div className="yam-suggestions">
                    <span className="yam-suggestions-title">Voici des questions que je comprends :</span>
                    {SUGGESTIONS.map((s) => (
                      <button key={s} type="button" className="yam-chip" onClick={() => send(s)} disabled={loading}>
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ),
        )}

        {loading && <ThinkingBubble />}
        <div ref={endRef} />
      </div>

      {/* Saisie */}
      <form
        className="yam-composer"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Posez une question à YAM…"
          aria-label="Votre question pour YAM"
          rows={1}
          maxLength={MAX_QUESTION_LENGTH}
          className="yam-input"
        />
        <button
          type="submit"
          className="yam-send"
          disabled={!canSend}
          aria-label="Envoyer la question"
          title="Envoyer"
        >
          <SendIcon size={17} />
        </button>
      </form>
      <p className="yam-footnote">
        Réponses générées automatiquement : vérifiez-les avant d’agir. YAM suggère, il n’exécute aucune action.
      </p>
    </aside>
  );
}
