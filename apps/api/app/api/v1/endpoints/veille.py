"""
Endpoints Veille & Réseaux Sociaux — pilotage du microservice de veille et ingestion IA.
"""
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user, get_db
from app.models.enums import UserRole
from app.models.utilisateur import Utilisateur
from app.services.veille_service import (
    check_veille_service,
    get_session_status,
    ingest_feedback_items,
    trigger_facebook_scrape,
)

router = APIRouter()


class ScrapeAndIngestRequest(BaseModel):
    target: str = Field(..., description="URL de la page Facebook cible")
    max_items: int = Field(20, ge=1, le=100, description="Nombre max d'items à extraire")
    agence_id: Optional[UUID] = Field(None, description="Agence à laquelle associer les avis (optionnel)")
    auto_ingest: bool = Field(False, description="Si True, ingère directement les avis dans la BDD")


class IngestBatchRequest(BaseModel):
    agence_id: UUID = Field(..., description="Agence cible")
    items: List[Dict[str, Any]] = Field(..., description="Liste des items de veille à ingérer")


@router.get("/status", tags=["Veille & Réseaux"])
async def veille_status(
    current_user: Utilisateur = Depends(get_current_active_user),
) -> Dict[str, Any]:
    """
    Vérifie l'état de santé du microservice de veille et la validité de la session Facebook.
    Réservé aux Administrateurs et CX Managers.
    """
    if current_user.role not in (UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.CX_MANAGER):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accès réservé aux managers et administrateurs")

    health = await check_veille_service()
    session = await get_session_status() if health.get("status") == "online" else {"valid": False}
    return {
        "service": health,
        "facebook_session": session,
    }


@router.post("/facebook/scrape", tags=["Veille & Réseaux"])
async def scrape_facebook(
    payload: ScrapeAndIngestRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_current_active_user),
) -> Dict[str, Any]:
    """
    Déclenche une extraction Facebook via le microservice de veille.
    Optionnellement, convertit et injecte les avis directement dans le pipeline d'analyse IA.
    """
    if current_user.role not in (UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.CX_MANAGER):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accès réservé aux managers et administrateurs")

    scrape_result = await trigger_facebook_scrape(payload.target, payload.max_items)
    if not scrape_result.get("success"):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Erreur lors du scraping de veille: {scrape_result.get('error', 'Inconnu')}",
        )

    scraped_data = scrape_result.get("data", {})
    items = scraped_data.get("items", [])

    ingestion_summary = None
    if payload.auto_ingest and items:
        # Résoudre l'agence cible
        target_agence_id = payload.agence_id or current_user.agence_id
        if not target_agence_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Veuillez spécifier agence_id pour auto-ingérer les avis",
            )
        try:
            ingestion_summary = ingest_feedback_items(
                items=items,
                agence_id=target_agence_id,
                db=db,
                background_tasks=background_tasks,
            )
        except Exception as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return {
        "status": "success",
        "scraped_count": len(items),
        "target": payload.target,
        "items": items,
        "ingestion": ingestion_summary,
    }


@router.post("/ingest", tags=["Veille & Réseaux"])
def ingest_batch(
    payload: IngestBatchRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_current_active_user),
) -> Dict[str, Any]:
    """
    Ingère manuellement un lot d'items de veille dans une agence et lance l'analyse IA.
    """
    if current_user.role not in (UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.CX_MANAGER):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accès réservé aux managers et administrateurs")

    try:
        summary = ingest_feedback_items(
            items=payload.items,
            agence_id=payload.agence_id,
            db=db,
            background_tasks=background_tasks,
        )
        return {"status": "success", "summary": summary}
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
