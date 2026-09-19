import React, { useEffect, useRef, useState } from 'react';
import { PlusIcon, SendIcon, XCloseIcon } from '../common/Icons';
import RichText from './RichText';
import YamAvatar from './YamAvatar';
import { MAX_QUESTION_LENGTH, useYamChat } from './useYamChat';

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
        {slow && (
          <div className="yam-slow-hint">
            Cela prend un peu plus de temps que d'habitude (le service se réveille), merci de patienter…
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

      {/* Messages */}
      <div className="yam-messages" aria-live="polite" ref={messagesRef}>
        <div className="yam-row yam-row-assistant">
          <YamAvatar size={28} />
          <div className="yam-bubble yam-bubble-assistant">
            <p className="yam-paragraph">
              Bonjour, je suis <strong>YAM</strong>. Je peux analyser les feedbacks de votre
              périmètre : alertes, thèmes, problèmes récurrents, tendances et recommandations.
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
                <div>{m.text}</div>
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
    </aside>
  );
}
