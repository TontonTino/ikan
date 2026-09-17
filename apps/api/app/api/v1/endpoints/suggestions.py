"""
Endpoints Suggestions/Idées — gestion du statut (BF-11).
"""
from uuid import UUID
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from datetime import datetime, timezone

from app.api.deps import get_cx_or_agency_manager, get_db
from app.models.utilisateur import Utilisateur
from app.models.suggestion import Suggestion, HistoriqueSuggestion
from app.models.enums import UserRole, IdeaStatus
from app.schemas.suggestion import SuggestionResponse, SuggestionStatusUpdate

router = APIRouter()


@router.get("/", response_model=List[SuggestionResponse])
def list_suggestions(
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
):
    """Liste les suggestions (CX Manager / Agency Manager uniquement, Admin exclu)."""
    from app.models.feedback import Feedback
    from app.models.qr_code import QRCode

    query = db.query(Suggestion).options(
        joinedload(Suggestion.feedback).joinedload(Feedback.qr_code).joinedload(QRCode.agence)
    )

    if current_user.role == UserRole.AGENCY_MANAGER:
        query = (
            query
            .join(Feedback, Suggestion.feedback_id == Feedback.id)
            .join(QRCode, Feedback.qr_code_id == QRCode.id)
            .filter(QRCode.agence_id == current_user.agence_id)
        )
    elif current_user.role == UserRole.CX_MANAGER:
        from app.models.agence import Agence
        query = (
            query
            .join(Feedback, Suggestion.feedback_id == Feedback.id)
            .join(QRCode, Feedback.qr_code_id == QRCode.id)
            .join(Agence, QRCode.agence_id == Agence.id)
            .filter(Agence.organisation_id == current_user.organisation_id)
        )

    return query.order_by(Suggestion.date_soumission.desc()).all()


@router.get("/{suggestion_id}", response_model=SuggestionResponse)
def get_suggestion(
    suggestion_id: UUID,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
):
    suggestion = db.query(Suggestion).filter(Suggestion.id == suggestion_id).first()
    if not suggestion:
        raise HTTPException(status_code=404, detail="Suggestion introuvable")
    return suggestion


@router.patch("/{suggestion_id}/statut", response_model=SuggestionResponse)
def update_suggestion_statut(
    suggestion_id: UUID,
    data: SuggestionStatusUpdate,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
):
    """
    Met à jour le statut d'une suggestion — tracé dans l'historique d'audit (BNF-09).
    """
    suggestion = db.query(Suggestion).filter(Suggestion.id == suggestion_id).first()
    if not suggestion:
        raise HTTPException(status_code=404, detail="Suggestion introuvable")

    ancien_statut = suggestion.statut

    # Créer l'entrée d'historique
    historique = HistoriqueSuggestion(
        suggestion_id=suggestion.id,
        ancien_statut=ancien_statut,
        nouveau_statut=data.statut,
        commentaire=data.commentaire,
        utilisateur_id=current_user.id,
    )
    db.add(historique)

    # Mettre à jour le statut
    suggestion.statut = data.statut
    if data.notes_internes:
        suggestion.notes_internes = data.notes_internes
    if data.statut in (IdeaStatus.TRAITE, IdeaStatus.REJETE):
        suggestion.date_traitement = datetime.now(timezone.utc)

    db.commit()
    db.refresh(suggestion)
    return suggestion
