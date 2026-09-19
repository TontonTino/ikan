import { useCallback, useEffect, useRef, useState } from 'react';
import { agentApi, AgentError, AGENT_ERROR_MESSAGES } from '../../services/agent';

export interface YamMessage {
  id: number;
  role: 'user' | 'assistant' | 'error';
  text: string;
  /** Pour un message d'erreur : la question à renvoyer via « Réessayer ». */
  retryQuestion?: string;
}

export const MAX_QUESTION_LENGTH = 1000;

/**
 * État d'une conversation avec YAM : messages, conversation_id (mémoire côté
 * agent), attente. Aucune exception ne sort de ce hook : toute erreur devient
 * un message `error` dans la conversation.
 */
export function useYamChat() {
  const [messages, setMessages] = useState<YamMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const conversationId = useRef<string | null>(null);
  const nextId = useRef(1);
  // Incrémenté à chaque reset/démontage : une réponse tardive d'une ancienne conversation est ignorée.
  const generation = useRef(0);
  const inFlight = useRef(false);

  useEffect(() => {
    const gen = generation;
    return () => {
      gen.current += 1;
    };
  }, []);

  const push = useCallback((message: Omit<YamMessage, 'id'>) => {
    setMessages((prev) => [...prev, { ...message, id: nextId.current++ }]);
  }, []);

  /** Envoie la question à l'agent et ajoute la réponse (ou l'erreur) à la conversation. */
  const ask = useCallback(
    async (question: string) => {
      if (inFlight.current) return;
      inFlight.current = true;
      const gen = generation.current;
      setLoading(true);
      try {
        const answer = await agentApi.ask(question, conversationId.current);
        if (gen !== generation.current) return;
        conversationId.current = answer.conversation_id;
        push({ role: 'assistant', text: answer.reponse });
      } catch (err) {
        if (gen !== generation.current) return;
        push({
          role: 'error',
          text: err instanceof AgentError ? err.message : AGENT_ERROR_MESSAGES.server,
          retryQuestion: question,
        });
      } finally {
        if (gen === generation.current) {
          setLoading(false);
          inFlight.current = false;
        }
      }
    },
    [push],
  );

  const send = useCallback(
    (rawQuestion: string) => {
      const question = rawQuestion.trim().slice(0, MAX_QUESTION_LENGTH);
      if (!question || inFlight.current) return;
      push({ role: 'user', text: question });
      void ask(question);
    },
    [ask, push],
  );

  /** Renvoie la question d'un message d'erreur (retire ce message ; la question reste affichée). */
  const retry = useCallback(
    (errorMessageId: number, question: string) => {
      if (inFlight.current) return;
      setMessages((prev) => prev.filter((m) => m.id !== errorMessageId));
      void ask(question);
    },
    [ask],
  );

  /** Nouvelle conversation : oublie l'historique local et le conversation_id. */
  const reset = useCallback(() => {
    generation.current += 1;
    conversationId.current = null;
    inFlight.current = false;
    setMessages([]);
    setLoading(false);
  }, []);

  return { messages, loading, send, retry, reset };
}
