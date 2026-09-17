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
    verify_password,
    decode_token,
)
from app.db.session import get_db
from app.models.utilisateur import Utilisateur
from app.schemas.auth import LoginRequest, TokenResponse, UserPublic

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
