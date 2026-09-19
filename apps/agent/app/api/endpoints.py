"""
Endpoints de l'agent IA — 5 endpoints portés du prototype + 1 webhook.
"""
import hmac
import logging
import uuid
from typing import Optional

import requests
from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.agent import action_service, qa_service, queries
from app.api.deps import require_agent_access
from app.config.settings import settings
from app.db.session import SessionLocal, get_db
from app.models.enums import CriticiteType
from app.providers.llm_provider import LLMProviderError
from app.models.enums import UserRole
from app.models.readonly import Utilisateur
from app.schemas.models import (
    AskRequest,
    AskResponse,
    BrouillonRequest,
    ProactiveSummaryResponse,
    ActionAgentResponse,
    ValiderRequest,
    WebhookAnalyseComplete,
)

logger = logging.getLogger(__name__)

# ISOLATION MULTI-ORGANISATION — règle unique pour tous les endpoints /agent/* :
# l'organisation de référence est TOUJOURS `current_user.organisation_id`
# (issu du JWT vérifié puis relu en base), jamais un champ du corps ou de
# l'URL. Une ressource (agence, feedback, action) hors de cette organisation
# répond 404 — indistinguable d'une ressource inexistante, pour ne rien
# révéler de l'existence de données d'une autre organisation.
_RESSOURCE_INTROUVABLE = "Ressource introuvable."
MESSAGE_YAM_INDISPONIBLE = "YAM est momentanément indisponible. Réessayez dans quelques instants."

# RESTRICTION AGENCY MANAGER : comme dans apps/api, un Agency Manager est limité
# à SON agence (pas à toute l'organisation). Un Agency Manager sans agence
# rattachée n'a accès à rien (403, refus par défaut).
def agence_restreinte(current_user: Utilisateur) -> Optional[uuid.UUID]:
    if current_user.role != UserRole.AGENCY_MANAGER:
        return None
    if current_user.agence_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Accès refusé : aucune agence n'est rattachée à votre compte.",
        )
    return current_user.agence_id


agent_router = APIRouter(prefix="/agent", tags=["Agent IA"])
webhook_router = APIRouter(prefix="/webhook", tags=["Webhook"])


@agent_router.post("/ask", response_model=AskResponse)
def ask(
    payload: AskRequest,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(require_agent_access),
):
    """Q&A conversationnel pour les managers, avec mémoire de conversation."""
    restreinte = agence_restreinte(current_user)
    agence_id = payload.agence_id
    if restreinte is not None:
        if agence_id is not None and agence_id != restreinte:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_RESSOURCE_INTROUVABLE)
        agence_id = restreinte  # toutes les questions sont forcées sur SON agence
    try:
        resultat = qa_service.repondre_question(
            db,
            current_user.organisation_id,
            payload.question,
            agence_id=agence_id,
            jours=payload.jours,
            conversation_id=payload.conversation_id,
            utilisateur_id=current_user.id,
        )
    except queries.PerimetreOrganisationError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_RESSOURCE_INTROUVABLE) from exc
    except (LLMProviderError, requests.RequestException) as exc:
        logger.exception("Échec de l'appel au LLM")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=MESSAGE_YAM_INDISPONIBLE) from exc
    return AskResponse(**resultat)


@agent_router.get("/proactive-summary", response_model=ProactiveSummaryResponse)
def proactive_summary(
    jours: int = Query(default=7, ge=1, le=90),
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(require_agent_access),
):
    """
    Analyse proactive affichée à l'ouverture de l'Assistant IA, sans question.

    Périmètre déterminé UNIQUEMENT par le JWT : l'organisation de l'utilisateur
    et, pour un Agency Manager, son agence (jamais un paramètre de la requête).
    Un CX Manager / Admin voit toutes les agences de SON organisation.
    """
    resultat = qa_service.generer_resume_proactif(
        db, current_user.organisation_id, agence_restreinte(current_user), jours
    )
    return ProactiveSummaryResponse(**resultat)


@agent_router.post("/actions/brouillon", response_model=ActionAgentResponse)
def generer_brouillon(
    payload: BrouillonRequest,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(require_agent_access),
):
    """Génère manuellement un brouillon d'action pour un feedback déjà analysé de MON organisation."""
    try:
        action = action_service.generer_brouillon(
            db,
            current_user.organisation_id,
            payload.feedback_id,
            payload.type_action,
            agence_restreinte_id=agence_restreinte(current_user),
        )
    except action_service.FeedbackNonAnalyseError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return ActionAgentResponse.model_validate(action)


@agent_router.get("/actions", response_model=list[ActionAgentResponse])
def lister_actions_en_attente(
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(require_agent_access),
):
    """Liste des brouillons en attente de validation — uniquement ceux de MON organisation."""
    actions = action_service.lister_actions_en_attente(
        db, current_user.organisation_id, agence_restreinte(current_user)
    )
    return [ActionAgentResponse.model_validate(a) for a in actions]


@agent_router.post("/actions/{action_id}/valider", response_model=ActionAgentResponse)
def valider(
    action_id: uuid.UUID,
    payload: ValiderRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(require_agent_access),
):
    """
    Valide un brouillon. La réponse HTTP confirme la validation
    immédiatement ; l'envoi WhatsApp éventuel (si REPONSE_CLIENT + numéro
    de contact disponible) est tenté en tâche de fond.
    """
    restreinte = agence_restreinte(current_user)
    try:
        action = action_service.valider_action(
            db,
            current_user.organisation_id,
            action_id,
            valide_par_id=current_user.id,
            contenu_final=payload.contenu_final,
            agence_restreinte_id=restreinte,
        )
    except action_service.ActionInconnueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    background_tasks.add_task(
        action_service.envoyer_whatsapp_si_applicable,
        action_id,
        current_user.organisation_id,
        restreinte,
    )
    return ActionAgentResponse.model_validate(action)


@agent_router.post("/actions/{action_id}/rejeter", response_model=ActionAgentResponse)
def rejeter(
    action_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(require_agent_access),
):
    """Rejette un brouillon d'action de MON organisation."""
    try:
        action = action_service.rejeter_action(
            db, current_user.organisation_id, action_id, agence_restreinte(current_user)
        )
    except action_service.ActionInconnueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    return ActionAgentResponse.model_validate(action)


def _verifier_secret_webhook(x_webhook_secret: str | None) -> None:
    if not x_webhook_secret or not hmac.compare_digest(x_webhook_secret, settings.WEBHOOK_SECRET):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Secret webhook invalide")


def _declencher_alerte_en_tache_de_fond(feedback_id: uuid.UUID) -> None:
    """Ouvre sa propre session DB — exécutée après la réponse HTTP du webhook."""
    db = SessionLocal()
    try:
        action = action_service.declencher_alerte_si_critique(db, feedback_id)
        if action is not None:
            logger.info(f"Alerte déclenchée — brouillon {action.id} pour feedback {feedback_id}")
    except Exception:
        logger.exception(f"Échec du déclenchement d'alerte pour feedback {feedback_id}")
    finally:
        db.close()


@webhook_router.post("/analyse-complete", status_code=status.HTTP_202_ACCEPTED)
def webhook_analyse_complete(
    payload: WebhookAnalyseComplete,
    background_tasks: BackgroundTasks,
    x_webhook_secret: str | None = Header(default=None),
):
    """
    Appelé par le backend principal juste après la création d'une AnalyseIA.
    Protégé par un secret partagé (header X-Webhook-Secret), PAS par JWT —
    c'est un appel service-à-service, pas un appel utilisateur.
    """
    _verifier_secret_webhook(x_webhook_secret)

    if payload.criticite.lower() in {CriticiteType.ELEVEE.value, CriticiteType.CRITIQUE.value}:
        background_tasks.add_task(_declencher_alerte_en_tache_de_fond, payload.feedback_id)

    return {"status": "accepted"}
