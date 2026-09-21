"""
Endpoints Recommandations — consultation par les Agency Managers, et vue
consolidée multi-agences pour le CX Manager (aide à la décision stratégique).
"""
from uuid import UUID
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from datetime import datetime

from app.api.deps import get_cx_or_agency_manager, get_db
from app.models.utilisateur import Utilisateur
from app.models.recommandation import Recommandation
from app.models.enums import PriorityLevel, UserRole
from app.services.acces_agence import verifier_acces_agence

router = APIRouter()


class RecommandationResponse(BaseModel):
    id: UUID
    analyse_ia_id: UUID
    contenu: str
    priorite: PriorityLevel
    date_generation: datetime
    traitee: bool

    model_config = {"from_attributes": True}


class RecommandationOrgResponse(RecommandationResponse):
    agence_id: UUID
    agence_nom: str


# Ordre de criticité décroissante pour le tri par défaut de la vue consolidée
_PRIORITE_ORDRE = {
    PriorityLevel.CRITICAL: 0,
    PriorityLevel.HIGH: 1,
    PriorityLevel.MEDIUM: 2,
    PriorityLevel.LOW: 3,
}


@router.get("/agences/{agence_id}", response_model=List[RecommandationResponse])
def list_recommandations_agence(
    agence_id: UUID,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
):
    """Liste les recommandations non traitées pour une agence (CX Manager / Agency Manager)."""
    verifier_acces_agence(db, current_user, agence_id)

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


@router.get("/organisation", response_model=List[RecommandationOrgResponse])
def list_recommandations_organisation(
    traitee: Optional[bool] = Query(
        None, description="Filtre par statut : true=traitées, false ou absent=non traitées (défaut)"
    ),
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
):
    """
    Vue consolidée des recommandations IA de toutes les agences de l'organisation
    du CX Manager connecté (aide à la décision stratégique réseau). Pour un Agency
    Manager, la même vue est restreinte à SA seule agence.
    Triée par criticité décroissante puis par date la plus récente.
    Par défaut, ne montre que les recommandations non traitées.
    """
    from app.models.analyse_ia import AnalyseIA
    from app.models.feedback import Feedback
    from app.models.qr_code import QRCode
    from app.models.agence import Agence

    query = (
        db.query(Recommandation, Agence.id, Agence.nom)
        .join(AnalyseIA, Recommandation.analyse_ia_id == AnalyseIA.id)
        .join(Feedback, AnalyseIA.feedback_id == Feedback.id)
        .join(QRCode, Feedback.qr_code_id == QRCode.id)
        .join(Agence, QRCode.agence_id == Agence.id)
        .filter(Agence.active == True)
    )
    if current_user.organisation_id:
        query = query.filter(Agence.organisation_id == current_user.organisation_id)
    if current_user.role == UserRole.AGENCY_MANAGER:
        query = query.filter(Agence.id == current_user.agence_id)

    query = query.filter(Recommandation.traitee == (traitee if traitee is not None else False))

    rows = query.all()
    rows.sort(key=lambda row: (_PRIORITE_ORDRE.get(row[0].priorite, 99), -row[0].date_generation.timestamp()))

    return [
        RecommandationOrgResponse(
            id=reco.id,
            analyse_ia_id=reco.analyse_ia_id,
            contenu=reco.contenu,
            priorite=reco.priorite,
            date_generation=reco.date_generation,
            traitee=reco.traitee,
            agence_id=agence_id,
            agence_nom=agence_nom,
        )
        for reco, agence_id, agence_nom in rows
    ]


@router.patch("/{recommandation_id}/traiter")
def marquer_traitee(
    recommandation_id: UUID,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
):
    from app.models.analyse_ia import AnalyseIA
    from app.models.feedback import Feedback
    from app.models.qr_code import QRCode

    reco = db.query(Recommandation).filter(Recommandation.id == recommandation_id).first()
    if not reco:
        raise HTTPException(status_code=404, detail="Recommandation introuvable")

    agence_id = (
        db.query(QRCode.agence_id)
        .join(Feedback, Feedback.qr_code_id == QRCode.id)
        .join(AnalyseIA, AnalyseIA.feedback_id == Feedback.id)
        .filter(AnalyseIA.id == reco.analyse_ia_id)
        .scalar()
    )
    verifier_acces_agence(db, current_user, agence_id)

    reco.traitee = True
    db.commit()
    return {"message": "Recommandation marquée comme traitée"}
