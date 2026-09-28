"""
Endpoints Alertes — configuration et consultation (BF-12).
"""
from uuid import UUID
from typing import List
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.api.deps import get_cx_or_agency_manager, get_cx_or_admin, get_db
from app.models.utilisateur import Utilisateur
from app.models.agence import Agence
from app.models.feedback import Feedback
from app.models.qr_code import QRCode
from app.models.categorie import Categorie
from app.models.analyse_ia import AnalyseIA
from app.models.enums import UserRole, SentimentType
from app.services.acces_agence import verifier_acces_agence
from app.services.alertes_seuil import (
    DUREE_PERSISTANCE_SEUIL_CX,
    FENETRE_SATISFACTION,
    en_utc,
    satisfaction_a,
    sous_seuil_en_continu,
)
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
    # 'note_basse' | 'sentiment_negatif' | 'note_basse_et_sentiment_negatif'
    raison: str
    commentaire: str | None
    date_soumission: datetime


class AlertesResponse(BaseModel):
    alertes_seuil: List[AlerteResponse]
    alertes_feedback: List[AlerteFeedbackResponse]


class SeuilUpdate(BaseModel):
    seuil_alerte: float


def _calculer_alertes_seuil(db: Session, current_user: Utilisateur) -> List[AlerteResponse]:
    """
    Alertes de seuil de satisfaction par agence (fenêtre glissante de 7 jours, au moins 3 avis).
    - Agency Manager (son agence) : IMMÉDIAT, dès que la satisfaction est sous le seuil.
    - CX Manager (agences actives de son organisation) : uniquement si la satisfaction est restée sous le
      seuil EN CONTINU pendant DUREE_PERSISTANCE_SEUIL_CX (48 h) — voir app/services/alertes_seuil.py.
    """
    maintenant = datetime.now(timezone.utc)
    pour_cx = current_user.role != UserRole.AGENCY_MANAGER

    if not pour_cx:
        agences = db.query(Agence).filter(Agence.id == current_user.agence_id).all()
    else:
        agences = db.query(Agence).filter(
            Agence.organisation_id == current_user.organisation_id,
            Agence.active == True,
        ).all()
    if not agences:
        return []

    # Une seule requête : les avis nécessaires à la fenêtre de 7 jours, en remontant de 48 h pour le CX Manager.
    debut_donnees = maintenant - FENETRE_SATISFACTION - (DUREE_PERSISTANCE_SEUIL_CX if pour_cx else timedelta(0))
    lignes = (
        db.query(QRCode.agence_id, Feedback.date_soumission, Feedback.note)
        .join(Feedback, Feedback.qr_code_id == QRCode.id)
        .filter(
            QRCode.agence_id.in_([a.id for a in agences]),
            Feedback.date_soumission >= debut_donnees,
        )
        .all()
    )
    avis_par_agence: dict = {}
    for agence_id, date_soumission, note in lignes:
        avis_par_agence.setdefault(agence_id, []).append((en_utc(date_soumission), note))

    alertes: List[AlerteResponse] = []
    for agence in agences:
        avis = avis_par_agence.get(agence.id, [])
        _, taux = satisfaction_a(avis, maintenant)
        if taux is None:
            continue  # Pas assez de données pour déclencher une alerte

        if pour_cx:
            sous_le_seuil, _ = sous_seuil_en_continu(avis, agence.seuil_alerte, maintenant)
            if not sous_le_seuil:
                continue
            heures = int(DUREE_PERSISTANCE_SEUIL_CX.total_seconds() // 3600)
            message = (
                f"Satisfaction sous le seuil depuis plus de {heures} h — {agence.nom} : "
                f"{taux}% sur 7 jours, seuil de {agence.seuil_alerte}%"
            )
        else:
            if not taux < agence.seuil_alerte:
                continue
            message = f"Satisfaction en baisse — {agence.nom} : {taux}% cette semaine, sous le seuil de {agence.seuil_alerte}%"

        alertes.append(AlerteResponse(
            agence_id=agence.id,
            agence_nom=agence.nom,
            taux_actuel=taux,
            seuil=agence.seuil_alerte,
            message=message,
        ))

    return alertes


def _raison_alerte_feedback(note: int, sentiment) -> "str | None":
    """Motif d'alerte d'un feedback : note <= 2 et/ou sentiment IA négatif (None = pas d'alerte)."""
    note_basse = note <= 2
    sentiment_negatif = sentiment == SentimentType.NEGATIF
    if note_basse and sentiment_negatif:
        return "note_basse_et_sentiment_negatif"
    if note_basse:
        return "note_basse"
    if sentiment_negatif:
        return "sentiment_negatif"
    return None


def _calculer_alertes_feedback(db: Session, current_user: Utilisateur) -> List[AlerteFeedbackResponse]:
    """
    Alertes individuelles par feedback : mauvaise note (<= 2) OU sentiment IA négatif
    (AnalyseIA.sentiment == NEGATIF ; un feedback sans analyse n'est pas considéré négatif).
    - Agency Manager (sa propre agence) : alerte IMMÉDIATE.
    - CX Manager (son organisation) : seulement si le feedback n'est pas traité (statut != 'resolu') une fois
      le délai configuré par ce CX Manager (delai_alerte_negatif_heures) écoulé depuis sa soumission.
    Une alerte disparaît dès que le feedback est marqué « resolu ». Calcul à la volée, sans cache ni job.
    La catégorie (et son étiquette informative est_categorie_suggestion) ne déclenche aucune alerte.
    """
    query = (
        db.query(Feedback, Categorie, Agence, AnalyseIA)
        .join(QRCode, Feedback.qr_code_id == QRCode.id)
        .join(Agence, QRCode.agence_id == Agence.id)
        .outerjoin(Categorie, Feedback.categorie_id == Categorie.id)
        .outerjoin(AnalyseIA, AnalyseIA.feedback_id == Feedback.id)
        .filter(
            Feedback.statut_traitement != "resolu",
            or_(Feedback.note <= 2, AnalyseIA.sentiment == SentimentType.NEGATIF),
        )
    )
    if current_user.role == UserRole.AGENCY_MANAGER:
        query = query.filter(Agence.id == current_user.agence_id)
    else:
        query = query.filter(Agence.organisation_id == current_user.organisation_id, Agence.active == True)

    maintenant = datetime.now(timezone.utc)
    apres_delai = maintenant - timedelta(hours=current_user.delai_alerte_negatif_heures)

    alertes: List[AlerteFeedbackResponse] = []
    for feedback, categorie, agence, analyse in query.all():
        if current_user.role != UserRole.AGENCY_MANAGER and en_utc(feedback.date_soumission) > apres_delai:
            continue  # CX Manager : le chef d'agence a encore le temps de traiter ce feedback
        raison = _raison_alerte_feedback(feedback.note, analyse.sentiment if analyse else None)
        if raison is None:
            continue

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

    alertes.sort(key=lambda a: en_utc(a.date_soumission), reverse=True)
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
