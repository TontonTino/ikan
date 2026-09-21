"""
Contrôle d'appartenance à une agence pour les endpoints accessibles à l'Agency
Manager et au CX Manager. Même règle que _check_feedback_access (feedbacks.py) :
- Agency Manager : uniquement SA propre agence ;
- CX Manager : uniquement les agences de SON organisation.
Le rôle Admin n'est volontairement pas traité ici (comportement inchangé).
"""
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.agence import Agence
from app.models.enums import UserRole
from app.models.utilisateur import Utilisateur


def verifier_acces_agence(db: Session, user: Utilisateur, agence_id: UUID | None) -> None:
    """Lève 403 si `user` n'a pas le droit d'accéder aux données de `agence_id`."""
    if user.role == UserRole.AGENCY_MANAGER:
        if agence_id is None or agence_id != user.agence_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Accès refusé : cette ressource n'appartient pas à votre agence",
            )
    elif user.role == UserRole.CX_MANAGER:
        agence = db.query(Agence).filter(Agence.id == agence_id).first() if agence_id else None
        if agence is None or agence.organisation_id != user.organisation_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Accès refusé : cette ressource n'appartient pas à votre organisation",
            )
