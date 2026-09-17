"""
Endpoints Alertes — configuration et consultation (BF-12).
"""
from uuid import UUID
from typing import List
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_cx_or_agency_manager, get_cx_or_admin, get_db
from app.models.utilisateur import Utilisateur
from app.models.agence import Agence
from app.models.feedback import Feedback
from app.models.qr_code import QRCode
from app.models.enums import UserRole

router = APIRouter()


class AlerteResponse(BaseModel):
    agence_id: UUID
    agence_nom: str
    taux_actuel: float
    seuil: float
    message: str


class SeuilUpdate(BaseModel):
    seuil_alerte: float


@router.get("/", response_model=List[AlerteResponse])
def list_alertes(
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
):
    """
    Retourne les alertes actives (agences dont la satisfaction est sous le seuil).
    BF-12 — consultable par Agency Manager et CX Manager uniquement (Admin exclu).
    """
    date_debut = datetime.now(timezone.utc) - timedelta(days=7)
    alertes = []

    if current_user.role == UserRole.AGENCY_MANAGER:
        agences = db.query(Agence).filter(Agence.id == current_user.agence_id).all()
    else:
        agences = db.query(Agence).filter(
            Agence.organisation_id == current_user.organisation_id,
            Agence.active == True,
        ).all()

    for agence in agences:
        feedbacks = (
            db.query(Feedback)
            .join(QRCode, Feedback.qr_code_id == QRCode.id)
            .filter(
                QRCode.agence_id == agence.id,
                Feedback.date_soumission >= date_debut,
            )
            .all()
        )
        total = len(feedbacks)
        if total < 3:
            continue  # Pas assez de données pour déclencher une alerte

        taux = round(sum(1 for f in feedbacks if f.note >= 4) / total * 100, 1)
        if taux < agence.seuil_alerte:
            alertes.append(AlerteResponse(
                agence_id=agence.id,
                agence_nom=agence.nom,
                taux_actuel=taux,
                seuil=agence.seuil_alerte,
                message=f"Satisfaction en baisse — {agence.nom} : {taux}% cette semaine, sous le seuil de {agence.seuil_alerte}%",
            ))

    return alertes


@router.patch("/agences/{agence_id}/seuil")
def update_seuil_alerte(
    agence_id: UUID,
    data: SeuilUpdate,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_admin),
):
    """Configure le seuil d'alerte d'une agence (Admin ou CX Manager)."""
    agence = db.query(Agence).filter(Agence.id == agence_id).first()
    if not agence:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Agence introuvable")
    agence.seuil_alerte = data.seuil_alerte
    db.commit()
    return {"message": f"Seuil mis à jour : {data.seuil_alerte}%"}
