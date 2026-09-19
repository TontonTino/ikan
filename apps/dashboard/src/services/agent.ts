/**
 * Client de l'agent IA YAM (service séparé, autre domaine que l'API).
 *
 * Authentification : le cookie de session HTTP-only n'est ni lisible en JS ni
 * envoyé à l'agent (autre site). On demande donc à l'API un jeton d'accès court
 * (GET /auth/agent-token, session cookie à l'appui), gardé UNIQUEMENT en mémoire
 * — jamais dans localStorage — et présenté en Bearer à l'agent.
 *
 * Ce client utilise sa propre instance axios : l'intercepteur de `api` renvoie
 * vers /login sur tout 401, ce qui ne doit pas arriver à cause de l'agent.
 */
import axios from 'axios';
import api from './api';
import { AGENT_URL } from '../config';

export interface AgentAnswer {
  intention: string;
  reponse: string;
  donnees: unknown;
  conversation_id: string;
}

export type AgentErrorKind = 'network' | 'timeout' | 'session' | 'forbidden' | 'unavailable' | 'server';

export const AGENT_ERROR_MESSAGES: Record<AgentErrorKind, string> = {
  network: "Impossible de joindre YAM. Vérifiez votre connexion internet, puis réessayez.",
  timeout: "YAM met trop de temps à répondre. Réessayez dans un instant.",
  session: "Votre session a expiré. Reconnectez-vous pour parler à YAM.",
  forbidden: "Votre compte n'a pas accès à YAM.",
  unavailable: "YAM est momentanément indisponible. Réessayez dans quelques instants.",
  server: "YAM a rencontré un problème. Réessayez dans un instant.",
};

export class AgentError extends Error {
  kind: AgentErrorKind;
  constructor(kind: AgentErrorKind) {
    super(AGENT_ERROR_MESSAGES[kind]);
    this.name = 'AgentError';
    this.kind = kind;
  }
}

// 90 s : le premier appel peut inclure le réveil d'un service Render gratuit.
const REQUEST_TIMEOUT_MS = 90_000;
// Période d'analyse envoyée à l'agent (alignée sur les 30 jours par défaut du dashboard).
const PERIODE_JOURS = 30;
const TOKEN_MARGE_MS = 60_000;

const agentHttp = axios.create({
  baseURL: AGENT_URL,
  timeout: REQUEST_TIMEOUT_MS,
  headers: { 'Content-Type': 'application/json' },
});

let cachedToken: { value: string; expiresAt: number } | null = null;
let pendingToken: Promise<string> | null = null;

async function getAgentToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedToken && Date.now() < cachedToken.expiresAt - TOKEN_MARGE_MS) {
    return cachedToken.value;
  }
  if (!pendingToken) {
    pendingToken = api
      .get<{ access_token: string; expires_in: number }>('/auth/agent-token')
      .then((res) => {
        cachedToken = {
          value: res.data.access_token,
          expiresAt: Date.now() + res.data.expires_in * 1000,
        };
        return cachedToken.value;
      })
      .finally(() => {
        pendingToken = null;
      });
  }
  return pendingToken;
}

/** À appeler à la déconnexion / au changement d'utilisateur. */
export function clearAgentSession(): void {
  cachedToken = null;
  pendingToken = null;
}

function toAgentError(err: unknown): AgentError {
  if (err instanceof AgentError) return err;
  if (axios.isAxiosError(err)) {
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') return new AgentError('timeout');
    const status = err.response?.status;
    if (!err.response) return new AgentError('network');
    if (status === 401) return new AgentError('session');
    if (status === 403) return new AgentError('forbidden');
    if (status === 502 || status === 503 || status === 504) return new AgentError('unavailable');
  }
  return new AgentError('server');
}

export const agentApi = {
  /** Pose une question à YAM. Lève toujours une AgentError (jamais une erreur brute). */
  async ask(question: string, conversationId?: string | null): Promise<AgentAnswer> {
    const post = async (forceRefresh: boolean) => {
      const token = await getAgentToken(forceRefresh);
      return agentHttp.post<AgentAnswer>(
        '/agent/ask',
        { question, jours: PERIODE_JOURS, ...(conversationId ? { conversation_id: conversationId } : {}) },
        { headers: { Authorization: `Bearer ${token}` } },
      );
    };

    try {
      try {
        return (await post(false)).data;
      } catch (err) {
        // Jeton expiré/rejeté : un seul nouvel essai avec un jeton frais.
        if (axios.isAxiosError(err) && err.response?.status === 401) {
          return (await post(true)).data;
        }
        throw err;
      }
    } catch (err) {
      throw toAgentError(err);
    }
  },
};
