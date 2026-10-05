"""
Dépendances FastAPI — authentification, RBAC, session DB.
"""
from typing import Optional
from uuid import UUID

from fastapi import Depends, HTTPException, status, Cookie
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.core.security import decode_token
from app.db.session import get_db
from app.models.agence import Agence
from app.models.utilisateur import Utilisateur
from app.models.enums import UserRole

# Permet à Swagger UI d'afficher le cadenas et d'injecter le token Bearer
security_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    auth_header: Optional[HTTPAuthorizationCredentials] = Depends(security_scheme),
    access_token: Optional[str] = Cookie(default=None),
    db: Session = Depends(get_db),
) -> Utilisateur:
    """
    Extrait l'utilisateur courant depuis l'en-tête Authorization Bearer ou depuis le cookie JWT.
    Lève une 401 si le token est absent ou invalide.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Non authentifié",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    token = auth_header.credentials if auth_header else access_token
    if not token:
        raise credentials_exception

    payload = decode_token(token)
    if payload is None or payload.get("type") != "access":
        raise credentials_exception

    user_id: str = payload.get("sub")
    if not user_id:
        raise credentials_exception

    user = db.query(Utilisateur).filter(
        Utilisateur.id == UUID(user_id),
        Utilisateur.active == True,
    ).first()

    if not user:
        raise credentials_exception

    return user


def get_current_active_user(
    current_user: Utilisateur = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Utilisateur:
    """Vérifie que l'utilisateur est actif et que son rattachement est cohérent.

    Isolation multi-organisation : un Agency Manager rattaché à une agence inexistante
    ou appartenant à une AUTRE organisation est refusé sur toute requête authentifiée.
    Les endpoints de l'Agency Manager filtrant par `agence_id`, ce verrou neutralise aussi
    les comptes incohérents créés avant la validation de rattachement (utilisateurs.py).
    """
    if not current_user.active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Compte désactivé",
        )
    if current_user.role == UserRole.AGENCY_MANAGER and current_user.agence_id is not None:
        agence = db.query(Agence).filter(Agence.id == current_user.agence_id).first()
        if agence is None or agence.organisation_id != current_user.organisation_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=MESSAGE_RATTACHEMENT_INVALIDE,
            )
    return current_user


MESSAGE_RATTACHEMENT_INVALIDE = (
    "Accès refusé : le rattachement de votre compte à une agence est invalide. "
    "Contactez votre CX Manager."
)
MESSAGE_SANS_AGENCE = "Accès refusé : aucune agence n'est rattachée à votre compte."


def _exiger_agence_si_agency_manager(current_user: Utilisateur) -> None:
    """Refus par défaut : un Agency Manager sans agence n'accède à aucune donnée client
    (jamais de repli sur le périmètre de l'organisation)."""
    if current_user.role == UserRole.AGENCY_MANAGER and current_user.agence_id is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=MESSAGE_SANS_AGENCE)


class RequireRole:
    """
    Dépendance RBAC — vérifie que l'utilisateur possède un des rôles autorisés.
    Exemple : RequireRole(UserRole.ADMIN, UserRole.CX_MANAGER)
    """
    def __init__(self, *roles: UserRole):
        self.roles = roles

    def __call__(
        self,
        current_user: Utilisateur = Depends(get_current_active_user),
    ) -> Utilisateur:
        if current_user.role not in self.roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Accès refusé. Rôle requis : {[r.value for r in self.roles]}",
            )
        return current_user


def get_admin_user(
    current_user: Utilisateur = Depends(get_current_active_user),
) -> Utilisateur:
    """Exige le rôle Administrateur."""
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Accès réservé aux administrateurs",
        )
    return current_user


def get_cx_or_admin(
    current_user: Utilisateur = Depends(get_current_active_user),
) -> Utilisateur:
    """Exige le rôle CX Manager ou Administrateur."""
    if current_user.role not in (UserRole.CX_MANAGER, UserRole.ADMIN):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Accès réservé aux CX Managers et Administrateurs",
        )
    return current_user


def get_cx_manager(
    current_user: Utilisateur = Depends(get_current_active_user),
) -> Utilisateur:
    """Exige le rôle CX Manager uniquement (Admin exclu)."""
    if current_user.role != UserRole.CX_MANAGER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Accès réservé exclusivement aux CX Managers",
        )
    return current_user


def get_agency_manager(
    current_user: Utilisateur = Depends(get_current_active_user),
) -> Utilisateur:
    """Exige le rôle Agency Manager uniquement (CX Manager et Admin exclus). Seul l'Agency
    Manager prend en charge un feedback jusqu'à sa résolution ; le CX Manager consulte."""
    if current_user.role != UserRole.AGENCY_MANAGER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Accès réservé exclusivement aux Agency Managers",
        )
    _exiger_agence_si_agency_manager(current_user)
    return current_user


MESSAGE_ADMIN_EXCLU = (
    "Accès interdit : l'Administrateur n'a aucun accès aux données clients "
    "(feedbacks, suggestions, alertes, recommandations, analyses) — uniquement à la vue structurelle."
)


def get_cx_or_agency_manager(
    current_user: Utilisateur = Depends(get_current_active_user),
) -> Utilisateur:
    """
    Exige le rôle CX Manager ou Agency Manager. Exclut STRICTEMENT l'Administrateur
    (403) : principe RBAC fondateur, l'Admin ne voit JAMAIS les données clients.
    À utiliser sur TOUT endpoint qui lit ou modifie feedbacks, suggestions, alertes,
    recommandations, analyses IA ou demandes de contact.
    """
    if current_user.role not in (UserRole.CX_MANAGER, UserRole.AGENCY_MANAGER):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=MESSAGE_ADMIN_EXCLU)
    _exiger_agence_si_agency_manager(current_user)
    return current_user


def get_feedback_viewer_user(
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
) -> Utilisateur:
    """Alias historique de get_cx_or_agency_manager (même règle, une seule définition)."""
    return current_user
