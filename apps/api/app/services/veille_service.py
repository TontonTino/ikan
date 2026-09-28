"""
Service d'intégration du microservice IKAN AI Veille (port 8002).
Permet à l'API principale de piloter le scraping Facebook / Réseaux sociaux
et d'ingérer automatiquement les avis extraits dans le pipeline d'analyse IA.
"""
import logging
from typing import Any, Dict, List, Optional
from uuid import UUID

import httpx
from sqlalchemy.orm import Session
from fastapi import BackgroundTasks

from app.core.config import settings
from app.models.agence import Agence
from app.models.feedback import Feedback
from app.models.qr_code import QRCode
from app.services.ai.analyse_service import analyser_feedback

logger = logging.getLogger(__name__)


def _get_headers() -> Dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if settings.VEILLE_API_KEY:
        headers["X-API-Key"] = settings.VEILLE_API_KEY
    return headers


async def check_veille_service() -> Dict[str, Any]:
    """Vérifie si le microservice de veille est actif et joignable."""
    if not settings.VEILLE_SERVICE_URL:
        return {"status": "disabled", "message": "VEILLE_SERVICE_URL non configuré"}

    url = f"{settings.VEILLE_SERVICE_URL.rstrip('/')}/health"
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            res = await client.get(url)
            if res.status_code == 200:
                data = res.json()
                return {"status": "online", "details": data}
            return {"status": "error", "code": res.status_code, "detail": res.text}
    except Exception as e:
        logger.warning(f"Microservice de veille injoignable sur {url}: {e}")
        return {"status": "offline", "error": str(e)}


async def get_session_status() -> Dict[str, Any]:
    """Récupère l'état de la session Facebook enregistrée dans le microservice."""
    url = f"{settings.VEILLE_SERVICE_URL.rstrip('/')}/session/facebook/status"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            res = await client.get(url, headers=_get_headers())
            if res.status_code == 200:
                return res.json()
            return {"valid": False, "error": f"Erreur {res.status_code}: {res.text}"}
    except Exception as e:
        return {"valid": False, "error": str(e)}


async def trigger_facebook_scrape(target: str, max_items: int = 20) -> Dict[str, Any]:
    """Déclenche une extraction de publications/avis Facebook via le microservice."""
    url = f"{settings.VEILLE_SERVICE_URL.rstrip('/')}/scrape/facebook"
    payload = {"target": target, "max_items": max_items}
    async with httpx.AsyncClient(timeout=120.0) as client:
        res = await client.post(url, json=payload, headers=_get_headers())
        if res.status_code != 200:
            logger.error(f"Échec du scraping veille ({res.status_code}): {res.text}")
            return {
                "success": False,
                "status_code": res.status_code,
                "error": res.text,
                "items": [],
            }
        data = res.json()
        return {"success": True, "data": data}


def ingest_feedback_items(
    items: List[Dict[str, Any]],
    agence_id: UUID,
    db: Session,
    background_tasks: BackgroundTasks,
) -> Dict[str, Any]:
    """
    Transforme les items extraits par le microservice de veille en vrais Feedbacks
    rattachés à l'agence, et lance l'analyse IA (sentiment, thématique, anomalies).
    """
    agence = db.query(Agence).filter(Agence.id == agence_id).first()
    if not agence:
        raise ValueError("Agence introuvable")

    # Récupérer ou trouver un QR code pour rattacher le feedback
    qr = db.query(QRCode).filter(QRCode.agence_id == agence.id, QRCode.actif == True).first()
    if not qr:
        # QR par défaut ou fallback
        qr = db.query(QRCode).filter(QRCode.agence_id == agence.id).first()

    if not qr:
        raise ValueError("Aucun QR Code rattaché à cette agence pour associer les avis")

    ingested_count = 0
    created_feedbacks = []

    for item in items:
        raw_text = item.get("text") or item.get("raw_text") or ""
        text = raw_text.strip()
        if not text:
            continue

        # Note : 1 à 5 étoiles. Si rating direct fourni (ex: reco 1 ou 5), l'utiliser, sinon note neutre 3
        rating_raw = item.get("rating")
        if rating_raw is not None:
            try:
                note = max(1, min(5, int(round(float(rating_raw)))))
            except (ValueError, TypeError):
                note = 3
        else:
            note = 3

        # Troncature max 1000 chars selon contrainte modèle Feedback
        commentaire = text[:1000]

        feedback = Feedback(
            qr_code_id=qr.id,
            note=note,
            commentaire=f"[Veille Facebook] {commentaire}"[:1000],
            statut_traitement="nouveau",
        )
        db.add(feedback)
        db.flush()

        # Déclencher l'analyse IA complète en tâche de fond (sentiment, thème, criticité)
        background_tasks.add_task(analyser_feedback, feedback.id)

        created_feedbacks.append(str(feedback.id))
        ingested_count += 1

    db.commit()

    return {
        "ingested_count": ingested_count,
        "agence_id": str(agence.id),
        "agence_nom": agence.nom,
        "feedback_ids": created_feedbacks,
    }
