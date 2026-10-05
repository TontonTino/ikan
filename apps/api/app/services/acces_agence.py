"""
Contrôles d'isolation multi-organisation / multi-agence — source unique, REFUS PAR DÉFAUT.

Règle : l'organisation et l'agence autorisées se déduisent TOUJOURS de l'utilisateur
authentifié (relu en base) et de relations vérifiées en base. Un identifiant fourni par
le client (agence_id, feedback_id, organisation_id…) n'est jamais une preuve d'autorisation.

- Agency Manager : uniquement SA propre agence (et elle doit appartenir à son organisation,
  vérifié une fois pour toutes dans app/api/deps.py).
- CX Manager : uniquement les agences de SON organisation.
- Admin : AUCUN accès aux données clients par défaut. Les rares droits structurels de
  l'Admin (ex. seuil d'alerte) sont accordés explicitement par l'appelant (`autoriser_admin`).
- Tout autre rôle, ou ressource sans rattachement résoluble : refusé.
"""
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.agence import Agence
from app.models.enums import UserRole
from app.models.utilisateur import Utilisateur

MESSAGE_HORS_AGENCE = "Accès refusé : cette ressource n'appartient pas à votre agence"
MESSAGE_HORS_ORGANISATION = "Accès refusé : cette ressource n'appartient pas à votre organisation"
MESSAGE_REFUSE = "Accès refusé"


def _refus(detail: str = MESSAGE_REFUSE) -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


def verifier_acces_agence(
    db: Session,
    user: Utilisateur,
    agence_id: UUID | None,
    *,
    autoriser_admin: bool = False,
) -> None:
    """Lève 403 si `user` n'a pas le droit d'accéder aux données de `agence_id`.

    `autoriser_admin=True` réservé aux droits STRUCTURELS explicites de l'Admin
    (jamais aux données clients). Sans ce drapeau, l'Admin est refusé.
    """
    if user.role == UserRole.AGENCY_MANAGER:
        if agence_id is None or user.agence_id is None or agence_id != user.agence_id:
            raise _refus(MESSAGE_HORS_AGENCE)
        return
    if user.role == UserRole.CX_MANAGER:
        agence = db.query(Agence).filter(Agence.id == agence_id).first() if agence_id else None
        if agence is None or agence.organisation_id != user.organisation_id:
            raise _refus(MESSAGE_HORS_ORGANISATION)
        return
    if user.role == UserRole.ADMIN and autoriser_admin:
        return
    raise _refus()


def verifier_agence_dans_organisation(db: Session, agence_id: UUID, organisation_id: UUID) -> Agence:
    """Rattachement d'un utilisateur à une agence : l'agence doit exister ET appartenir
    à l'organisation de l'utilisateur rattaché. Lève 403 sinon (sans révéler si l'agence
    existe dans une autre organisation)."""
    agence = db.query(Agence).filter(Agence.id == agence_id).first()
    if agence is None or agence.organisation_id != organisation_id:
        raise _refus("Agence invalide : elle n'appartient pas à l'organisation de cet utilisateur")
    return agence


def agence_id_du_feedback(feedback) -> UUID | None:
    """Agence d'un feedback, résolue par sa relation QR Code (jamais par un champ client)."""
    qr = getattr(feedback, "qr_code", None)
    return getattr(qr, "agence_id", None) if qr is not None else None


def verifier_acces_feedback(db: Session, user: Utilisateur, feedback) -> None:
    """Accès à un feedback (et à ses données dérivées : analyse IA, historique…).
    Un feedback dont l'agence ne peut pas être résolue est refusé (refus par défaut)."""
    agence_id = agence_id_du_feedback(feedback)
    if agence_id is None:
        raise _refus()
    verifier_acces_agence(db, user, agence_id)


def verifier_acces_issue(user: Utilisateur, issue) -> None:
    """Accès à une Issue : même organisation, et même agence pour l'Agency Manager.
    L'Issue porte organisation_id et agence_id en base (pas besoin de requête)."""
    if issue.organisation_id is None or issue.organisation_id != user.organisation_id:
        raise _refus("Accès refusé à cette Issue hors de votre organisation")
    if user.role == UserRole.AGENCY_MANAGER:
        if user.agence_id is None or issue.agence_id != user.agence_id:
            raise _refus("Accès refusé à cette Issue hors de votre agence")
        return
    if user.role == UserRole.CX_MANAGER:
        return
    raise _refus()
