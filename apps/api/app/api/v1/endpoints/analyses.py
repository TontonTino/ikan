"""
Endpoints Analyses IA — consultation des analyses de sentiments.
Exclusion stricte de l'administrateur système pour la confidentialité des feedbacks individuels.
"""
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_feedback_viewer_user, get_db
from app.models.utilisateur import Utilisateur
from app.models.analyse_ia import AnalyseIA
from app.models.feedback import Feedback
from app.schemas.analyse import AnalyseIAResponse
from app.services.acces_agence import verifier_acces_feedback

router = APIRouter()


@router.get("/{feedback_id}", response_model=AnalyseIAResponse)
def get_analyse(
    feedback_id: UUID,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_feedback_viewer_user),
):
    """Retourne l'analyse IA d'un feedback spécifique (CX Manager / Agency Manager uniquement).

    Le périmètre est vérifié AVANT toute lecture de l'analyse, pour TOUS les rôles :
    CX Manager = même organisation, Agency Manager = même agence (refus par défaut).
    """
    feedback = (
        db.query(Feedback)
        .options(joinedload(Feedback.qr_code))
        .filter(Feedback.id == feedback_id)
        .first()
    )
    if not feedback:
        raise HTTPException(status_code=404, detail="Analyse introuvable")
    verifier_acces_feedback(db, current_user, feedback)

    analyse = db.query(AnalyseIA).filter(AnalyseIA.feedback_id == feedback_id).first()
    if not analyse:
        raise HTTPException(status_code=404, detail="Analyse introuvable")
    return analyse
