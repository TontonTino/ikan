"""
Endpoints Recommandations — consultation par les Agency Managers.
"""
from uuid import UUID
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from datetime import datetime

from app.api.deps import get_cx_or_agency_manager, get_db
from app.models.utilisateur import Utilisateur
from app.models.recommandation import Recommandation
from app.models.enums import PriorityLevel

router = APIRouter()


class RecommandationResponse(BaseModel):
    id: UUID
    analyse_ia_id: UUID
    contenu: str
    priorite: PriorityLevel
    date_generation: datetime
    traitee: bool

    model_config = {"from_attributes": True}


@router.get("/agences/{agence_id}", response_model=List[RecommandationResponse])
def list_recommandations_agence(
    agence_id: UUID,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
):
    """Liste les recommandations non traitées pour une agence (CX Manager / Agency Manager)."""
    from app.models.analyse_ia import AnalyseIA
    from app.models.feedback import Feedback
    from app.models.qr_code import QRCode

    query = (
        db.query(Recommandation)
        .join(AnalyseIA, Recommandation.analyse_ia_id == AnalyseIA.id)
        .join(Feedback, AnalyseIA.feedback_id == Feedback.id)
        .join(QRCode, Feedback.qr_code_id == QRCode.id)
        .filter(
            QRCode.agence_id == agence_id,
            Recommandation.traitee == False,
        )
        .order_by(Recommandation.date_generation.desc())
    )
    return query.all()


@router.patch("/{recommandation_id}/traiter")
def marquer_traitee(
    recommandation_id: UUID,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
):
    reco = db.query(Recommandation).filter(Recommandation.id == recommandation_id).first()
    if not reco:
        raise HTTPException(status_code=404, detail="Recommandation introuvable")
    reco.traitee = True
    db.commit()
    return {"message": "Recommandation marquée comme traitée"}
