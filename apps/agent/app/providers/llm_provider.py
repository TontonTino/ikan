"""
Client pour l'API de complétion de chat — Groq (modèle configuré par GROQ_MODEL).

Ce provider est délibérément minimal : il envoie un prompt système + un prompt utilisateur et retourne
le texte généré. Il ne prend AUCUNE décision de routage ou de logique métier — le LLM ne reçoit jamais
la question brute de l'utilisateur pour l'interpréter librement, seulement des données déjà récupérées
et mises en forme par les couches supérieures (qa_service, action_service).

FIABILITÉ DE LA SORTIE (vérifiée par appels réels, voir settings.GROQ_REASONING_EFFORT) : avec un modèle à
raisonnement, les jetons de raisonnement consomment le budget `max_tokens`. Un budget trop serré donne
`finish_reason="length"` avec un `content` tronqué, voire vide. Le provider :
  - envoie `reasoning_effort` pour la famille gpt-oss ;
  - conserve `finish_reason` au lieu de l'ignorer ;
  - relance UNE fois avec un budget doublé (plafonné) si la sortie est vide ou tronquée ;
  - ne supprime jamais silencieusement une réponse partielle : le texte renvoyé porte ses métadonnées
    (`TexteGenere.tronquee`, `.vide`, `.finish_reason`), que l'appelant doit exploiter.
`generate_text` reste compatible avec ses appelants historiques : il renvoie toujours une `str`.
"""
from __future__ import annotations

import logging
import time

import requests

from app.config.settings import settings

logger = logging.getLogger(__name__)

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
_ATTENTE_429_MAX_S = 10.0


class LLMProviderError(RuntimeError):
    """Erreur levée pour tout problème d'appel au provider LLM."""


class LLMEmptyResponseError(LLMProviderError):
    """Le fournisseur a répondu sans texte exploitable, même après un nouvel essai."""


class TexteGenere(str):
    """Texte généré, avec les métadonnées de la complétion (une `str` ordinaire pour tout appelant)."""

    finish_reason: str | None = None
    tronquee: bool = False

    @property
    def vide(self) -> bool:
        return not self.strip()


def _ensure_api_key() -> None:
    if not settings.GROQ_API_KEY:
        raise LLMProviderError(
            "GROQ_API_KEY est vide. Renseigne cette clé dans le fichier "
            ".env avant d'appeler le provider LLM."
        )


def _parametres_raisonnement() -> dict:
    effort = (settings.GROQ_REASONING_EFFORT or "").strip().lower()
    if effort and "gpt-oss" in settings.GROQ_MODEL.lower():
        return {"reasoning_effort": effort}
    return {}


def _completion(messages: list[dict], max_tokens: int) -> TexteGenere:
    """Un seul appel au fournisseur, sans nouvel essai."""
    headers = {
        "Authorization": f"Bearer {settings.GROQ_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": settings.GROQ_MODEL,
        "max_tokens": max_tokens,
        "messages": messages,
        **_parametres_raisonnement(),
    }
    response = requests.post(GROQ_URL, headers=headers, json=payload, timeout=60)
    if response.status_code == 429:
        # Limite de débit du fournisseur (plan gratuit) : UNE nouvelle tentative après le délai indiqué (plafonné).
        try:
            attente = float(response.headers.get("retry-after", ""))
        except (TypeError, ValueError):
            attente = 2.0
        attente = max(0.5, min(attente, _ATTENTE_429_MAX_S))
        logger.warning("Groq : limite de débit (429) — nouvelle tentative dans %.1f s.", attente)
        time.sleep(attente)
        response = requests.post(GROQ_URL, headers=headers, json=payload, timeout=60)
    response.raise_for_status()
    data = response.json()

    try:
        choix = data["choices"][0]
        contenu = choix["message"].get("content")
    except (KeyError, IndexError, AttributeError, TypeError) as exc:
        raise LLMProviderError(f"Format de réponse Groq inattendu : {data!r}") from exc

    texte = TexteGenere(contenu if isinstance(contenu, str) else "")
    texte.finish_reason = choix.get("finish_reason")
    texte.tronquee = texte.finish_reason == "length"
    return texte


def generate_text(
    system_prompt: str,
    user_prompt: str,
    *,
    messages_history: list[dict] | None = None,
    max_tokens: int = 400,
) -> TexteGenere:
    """
    Appelle Groq et retourne le texte généré (sous-classe de `str`, voir TexteGenere).

    Comportement par défaut (un seul tour) : messages = [system_prompt, user_prompt]. Si `messages_history`
    est fourni — liste de messages OpenAI-compatible déjà construite, typiquement via
    app.agent.conversation_manager.build_messages_history() — elle est utilisée telle quelle (elle inclut
    déjà le system prompt, l'historique et le prompt courant).

    Une sortie vide ou tronquée (finish_reason="length") déclenche UN nouvel essai avec un budget doublé,
    plafonné à settings.LLM_MAX_TOKENS_PLAFOND. Si elle reste vide/tronquée, le résultat est renvoyé tel
    quel, marqué (`.vide`, `.tronquee`) : c'est à l'appelant de décider (message explicite, repli…).
    """
    _ensure_api_key()

    messages = (
        messages_history
        if messages_history is not None
        else [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]
    )

    resultat = _completion(messages, max_tokens)
    if resultat.vide or resultat.tronquee:
        budget = min(max(max_tokens * 2, max_tokens + 1), max(settings.LLM_MAX_TOKENS_PLAFOND, max_tokens))
        if budget > max_tokens:
            logger.warning(
                "Sortie LLM %s (finish_reason=%s, max_tokens=%s) : nouvel essai avec max_tokens=%s.",
                "vide" if resultat.vide else "tronquée", resultat.finish_reason, max_tokens, budget,
            )
            resultat = _completion(messages, budget)
    return resultat
