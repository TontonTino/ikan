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
from app.models.categorie import Categorie
from app.models.enums import UserRole
from app.services.acces_agence import verifier_acces_agence
from app.services.plan_catalog import FEATURE_ALERTES
from app.services.plan_service import organisation_a_la_fonctionnalite

router = APIRouter()


class AlerteResponse(BaseModel):
    agence_id: UUID
    agence_nom: str
    taux_actuel: float
    seuil: float
    message: str


class AlerteFeedbackResponse(BaseModel):
    feedback_id: UUID
    agence_id: UUID
    agence_nom: str
    note: int
    categorie_nom: str | None
    # 'negatif' | 'suggestion' | 'negatif_et_suggestion'
    raison: str
    commentaire: str | None
    date_soumission: datetime


class AlertesResponse(BaseModel):
    alertes_seuil: List[AlerteResponse]
    alertes_feedback: List[AlerteFeedbackResponse]


class SeuilUpdate(BaseModel):
    seuil_alerte: float


def _calculer_alertes_seuil(db: Session, current_user: Utilisateur) -> List[AlerteResponse]:
    """Système d'alertes existant (seuil de satisfaction par agence) — INCHANGÉ."""
    date_debut = datetime.now(timezone.utc) - timedelta(days=7)
    alertes: List[AlerteResponse] = []

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


def _calculer_alertes_feedback(db: Session, current_user: Utilisateur) -> List[AlerteFeedbackResponse]:
    """
    Alertes individuelles par feedback (nouvelle catégorie, s'ajoute au système de
    seuil ci-dessus sans le modifier) :
    - négatif (note <= 2) : alerte immédiate, pour les deux rôles.
    - catégorie marquée "suggestion" : alerte immédiate pour l'Agency Manager,
      alerte seulement après `delai_alerte_suggestion_heures` (réglable par
      compte) si toujours non traité pour le CX Manager.
    Une alerte disparaît dès que le feedback est marqué "resolu" (traité), pour
    les deux raisons. Calcul à la volée à chaque appel, comme le système de seuil.
    """
    query = (
        db.query(Feedback, Categorie, Agence)
        .join(QRCode, Feedback.qr_code_id == QRCode.id)
        .join(Agence, QRCode.agence_id == Agence.id)
        .outerjoin(Categorie, Feedback.categorie_id == Categorie.id)
        .filter(Feedback.statut_traitement != "resolu")
    )
    if current_user.role == UserRole.AGENCY_MANAGER:
        query = query.filter(Agence.id == current_user.agence_id)
    else:
        query = query.filter(Agence.organisation_id == current_user.organisation_id, Agence.active == True)

    now = datetime.now(timezone.utc)
    seuil_suggestion = now - timedelta(hours=current_user.delai_alerte_suggestion_heures)

    alertes: List[AlerteFeedbackResponse] = []
    for feedback, categorie, agence in query.all():
        negatif = feedback.note <= 2
        est_categorie_suggestion = bool(categorie and categorie.est_categorie_suggestion)
        suggestion_active = est_categorie_suggestion and (
            current_user.role == UserRole.AGENCY_MANAGER or feedback.date_soumission <= seuil_suggestion
        )
        if not negatif and not suggestion_active:
            continue

        if negatif and suggestion_active:
            raison = "negatif_et_suggestion"
        elif negatif:
            raison = "negatif"
        else:
            raison = "suggestion"

        alertes.append(AlerteFeedbackResponse(
            feedback_id=feedback.id,
            agence_id=agence.id,
            agence_nom=agence.nom,
            note=feedback.note,
            categorie_nom=categorie.nom if categorie else None,
            raison=raison,
            commentaire=feedback.commentaire,
            date_soumission=feedback.date_soumission,
        ))

    alertes.sort(key=lambda a: a.date_soumission, reverse=True)
    return alertes


@router.get("/", response_model=AlertesResponse)
def list_alertes(
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
):
    """
    Retourne les alertes actives : seuil de satisfaction par agence (inchangé)
    ET alertes individuelles par feedback (nouvelle catégorie), dans deux listes
    séparées d'un même payload. BF-12 — Agency Manager et CX Manager uniquement.
    """
    # Alertes = fonctionnalité Starter+. Listes vides (et non 403) pour un forfait
    # Gratuit : plusieurs écrans chargent cet endpoint avec d'autres appels.
    if not organisation_a_la_fonctionnalite(current_user.organisation_id, FEATURE_ALERTES, db):
        return AlertesResponse(alertes_seuil=[], alertes_feedback=[])

    return AlertesResponse(
        alertes_seuil=_calculer_alertes_seuil(db, current_user),
        alertes_feedback=_calculer_alertes_feedback(db, current_user),
    )


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
    # Un CX Manager ne configure que les agences de SON organisation (l'Admin, lui,
    # configure les seuils d'alerte par droit structurel — matrice des permissions).
    verifier_acces_agence(db, current_user, agence_id)
    agence.seuil_alerte = data.seuil_alerte
    db.commit()
    return {"message": f"Seuil mis à jour : {data.seuil_alerte}%"}
