"""
Endpoints d'authentification — login, logout, refresh, profil courant.
"""
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user
from app.core.config import settings
from app.core.security import (
    create_access_token,
    create_refresh_token,
    get_password_hash,
    verify_password,
    decode_token,
)
from app.db.session import get_db
from app.models.enums import UserRole
from app.models.utilisateur import Utilisateur
from app.schemas.auth import (
    AgentTokenResponse, ChangerMotDePasseRequest, LoginRequest, TokenResponse,
    UpdateMeRequest, UserPublic,
)

router = APIRouter()

COOKIE_SECURE = settings.APP_ENV == "production"
COOKIE_SAMESITE = "none" if COOKIE_SECURE else "lax"


@router.post("/login", response_model=TokenResponse)
def login(
    credentials: LoginRequest,
    response: Response,
    db: Session = Depends(get_db),
):
    """
    Authentification par email/mot de passe.
    Retourne les tokens dans le corps de réponse JSON ET dans des cookies HTTP-only.
    """
    email = (credentials.email or "").strip().lower()
    pwd = (credentials.password or credentials.mot_de_passe or "").strip()

    if not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="L'email est requis",
        )

    if not pwd:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Le mot de passe est requis",
        )

    user = db.query(Utilisateur).filter(
        Utilisateur.email.ilike(email),
        Utilisateur.active == True,
    ).first()

    if not user or not verify_password(pwd, user.mot_de_passe_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email ou mot de passe incorrect",
        )

    access_token = create_access_token(subject=str(user.id))
    refresh_token = create_refresh_token(subject=str(user.id))

    # Cookies HTTP-only (optionnel / fallback)
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600,
    )

    return TokenResponse(
        message="Connexion réussie",
        user=UserPublic.model_validate(user),
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
    )


@router.post("/logout")
def logout(response: Response):
    """Déconnexion — supprime les cookies d'authentification."""
    response.delete_cookie("access_token")
    response.delete_cookie("refresh_token")
    return {"message": "Déconnexion réussie"}


@router.post("/refresh", response_model=TokenResponse)
def refresh_token(
    response: Response,
    refresh_token: str | None = None,
    db: Session = Depends(get_db),
):
    """Rafraîchit le token d'accès depuis le refresh token."""
    from fastapi import Cookie as FastAPICookie

    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token de rafraîchissement invalide ou expiré",
    )

    if not refresh_token:
        raise credentials_exception

    payload = decode_token(refresh_token)
    if payload is None or payload.get("type") != "refresh":
        raise credentials_exception

    user_id = payload.get("sub")
    user = db.query(Utilisateur).filter(
        Utilisateur.id == user_id,
        Utilisateur.active == True,
    ).first()

    if not user:
        raise credentials_exception

    new_access_token = create_access_token(subject=str(user.id))
    response.set_cookie(
        key="access_token",
        value=new_access_token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )

    return TokenResponse(
        message="Token rafraîchi",
        user=UserPublic.model_validate(user),
        access_token=new_access_token,
        refresh_token=refresh_token,
        token_type="bearer",
    )


@router.get("/me", response_model=UserPublic)
def get_me(current_user: Utilisateur = Depends(get_current_active_user)):
    """Retourne le profil de l'utilisateur connecté."""
    return UserPublic.model_validate(current_user)


@router.patch("/me", response_model=UserPublic)
def update_me(
    data: UpdateMeRequest,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_current_active_user),
):
    """
    Modifie SON PROPRE nom/prénom/email — accessible à tout utilisateur authentifié
    (CX Manager, Agency Manager, Admin). role/organisation_id/agence_id n'existent
    pas dans UpdateMeRequest : impossibles à modifier via cet endpoint, même en
    les ajoutant manuellement au payload (Pydantic les ignore silencieusement).

    Le JWT encode l'identité par id (jamais par email, voir create_access_token) :
    changer son email ne casse donc jamais la session en cours.
    """
    updates = data.model_dump(exclude_unset=True)

    if updates.get("email"):
        nouvel_email = updates["email"].strip().lower()
        if nouvel_email != current_user.email.lower():
            existing = db.query(Utilisateur).filter(
                Utilisateur.email.ilike(nouvel_email),
                Utilisateur.id != current_user.id,
            ).first()
            if existing:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Cet email est déjà utilisé par un autre compte.",
                )
        updates["email"] = nouvel_email

    for field, value in updates.items():
        setattr(current_user, field, value)

    db.commit()
    db.refresh(current_user)
    return UserPublic.model_validate(current_user)


@router.post("/me/mot-de-passe")
def changer_mot_de_passe(
    data: ChangerMotDePasseRequest,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_current_active_user),
):
    """Change son propre mot de passe — exige l'ancien mot de passe."""
    if not verify_password(data.ancien_mot_de_passe, current_user.mot_de_passe_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ancien mot de passe incorrect.",
        )

    current_user.mot_de_passe_hash = get_password_hash(data.nouveau_mot_de_passe)
    db.commit()
    return {"message": "Mot de passe mis à jour."}


@router.get("/agent-token", response_model=AgentTokenResponse)
def get_agent_token(current_user: Utilisateur = Depends(get_current_active_user)):
    """
    Jeton d'accès court pour l'agent IA YAM (service séparé, autre domaine).

    Le cookie de session HTTP-only n'est pas envoyé à l'agent (autre site) et
    n'est pas lisible par le JavaScript du dashboard : le dashboard demande donc
    ici, session cookie à l'appui, un jeton d'accès qu'il garde UNIQUEMENT en
    mémoire et présente en Bearer à l'agent. Même format, même durée de vie
    (ACCESS_TOKEN_EXPIRE_MINUTES) et même contrôle d'organisation que le jeton
    de session. Réservé aux rôles qui ont accès à YAM.
    """
    if current_user.role not in (UserRole.CX_MANAGER, UserRole.AGENCY_MANAGER):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="L'assistant YAM est réservé aux CX Managers et Agency Managers.",
        )
    return AgentTokenResponse(
        access_token=create_access_token(subject=str(current_user.id)),
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )
