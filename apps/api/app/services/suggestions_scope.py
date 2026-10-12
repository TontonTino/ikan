"""
Périmètre des suggestions — source UNIQUE de « à quelle agence appartient une suggestion ».

Deux origines coexistent :
- suggestion liée à un feedback (formulaire noté, ou antérieure à la migration 031) : agence = feedback -> QR code -> agence ;
- suggestion envoyée seule (« Partager une idée ») : agence = suggestions.agence_id, sans feedback.

L'agence effective est donc COALESCE(suggestions.agence_id, agence du feedback). Toute lecture de suggestions
(liste, détail, statut, tableaux de bord, historique) passe par ici : une suggestion sans feedback apparaît partout où une
suggestion apparaît, avec les mêmes règles d'isolation (Agency Manager : son agence, CX Manager : son organisation,
Admin : rien).
"""
from uuid import UUID

from sqlalchemy import false, func, select
from sqlalchemy.orm import Session

from app.models.agence import Agence
from app.models.enums import UserRole
from app.models.feedback import Feedback
from app.models.qr_code import QRCode
from app.models.suggestion import Suggestion
from app.models.utilisateur import Utilisateur


def agence_effective():
    """Expression SQL : agence d'une suggestion (colonne directe, sinon celle de son feedback)."""
    via_feedback = (
        select(QRCode.agence_id)
        .join(Feedback, Feedback.qr_code_id == QRCode.id)
        .where(Feedback.id == Suggestion.feedback_id)
        .correlate(Suggestion)
        .scalar_subquery()
    )
    return func.coalesce(Suggestion.agence_id, via_feedback)


def agence_id_de_la_suggestion(db: Session, suggestion: Suggestion) -> UUID | None:
    """Agence d'une suggestion, ou None si elle n'est pas résoluble (refus par défaut chez l'appelant)."""
    if suggestion.agence_id is not None:
        return suggestion.agence_id
    if suggestion.feedback_id is None:
        return None
    return (
        db.query(QRCode.agence_id)
        .join(Feedback, Feedback.qr_code_id == QRCode.id)
        .filter(Feedback.id == suggestion.feedback_id)
        .scalar()
    )


def filtrer_par_perimetre(query, user: Utilisateur):
    """Restreint une requête sur Suggestion au périmètre du rôle. Admin et tout autre rôle : aucune ligne."""
    agence = agence_effective()
    if user.role == UserRole.AGENCY_MANAGER:
        if user.agence_id is None:
            return query.filter(false())
        return query.filter(agence == user.agence_id)
    if user.role == UserRole.CX_MANAGER:
        if user.organisation_id is None:
            return query.filter(false())
        agences_org = select(Agence.id).where(Agence.organisation_id == user.organisation_id)
        return query.filter(agence.in_(agences_org))
    return query.filter(false())
