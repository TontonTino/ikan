"""
Schémas Pydantic pour l'authentification.
"""
from pydantic import BaseModel, EmailStr
from app.models.enums import UserRole
import uuid


class LoginRequest(BaseModel):
    email: EmailStr
    password: str | None = None
    mot_de_passe: str | None = None


class UserPublic(BaseModel):
    id: uuid.UUID
    nom: str
    prenom: str
    email: str
    role: UserRole
    organisation_id: uuid.UUID
    agence_id: uuid.UUID | None = None
    organisation_nom: str | None = None
    organisation_logo: str | None = None
    agence_nom: str | None = None

    model_config = {"from_attributes": True}


class TokenResponse(BaseModel):
    message: str
    user: UserPublic
    access_token: str | None = None
    refresh_token: str | None = None
    token_type: str = "bearer"
