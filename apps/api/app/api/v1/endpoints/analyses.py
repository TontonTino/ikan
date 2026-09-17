"""
Endpoints Analyses IA — consultation des analyses de sentiments.
Exclusion stricte de l'administrateur système pour la confidentialité des feedbacks individuels.
"""
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_feedback_viewer_user, get_db
from app.models.utilisateur import Utilisateur
from app.models.analyse_ia import AnalyseIA
from app.models.feedback import Feedback
from app.models.qr_code import QRCode
from app.models.enums import UserRole
from app.schemas.analyse import AnalyseIAResponse

router = APIRouter()


@router.get("/{feedback_id}", response_model=AnalyseIAResponse)
def get_analyse(
    feedback_id: UUID,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_feedback_viewer_user),
):
    """Retourne l'analyse IA d'un feedback spécifique (CX Manager / Agency Manager uniquement)."""
    analyse = db.query(AnalyseIA).filter(AnalyseIA.feedback_id == feedback_id).first()
    if not analyse:
        raise HTTPException(status_code=404, detail="Analyse introuvable")

    # Vérification du périmètre
    fb = db.query(Feedback).filter(Feedback.id == feedback_id).first()
    if fb:
        qr = db.query(QRCode).filter(QRCode.id == fb.qr_code_id).first()
        if qr:
            if current_user.role == UserRole.AGENCY_MANAGER and qr.agence_id != current_user.agence_id:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accès refusé.")

    return analyse
