"""
Schémas Pydantic pour l'authentification.
"""
from pydantic import BaseModel, EmailStr, Field, field_validator
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
    # Pertinent uniquement pour role=cx_manager (délai avant qu'un avis négatif non traité
    # devienne une alerte pour ce compte) — présent pour tous les rôles par simplicité de
    # schéma, ignoré/masqué ailleurs.
    delai_alerte_negatif_heures: int = 24

    model_config = {"from_attributes": True}


class TokenResponse(BaseModel):
    message: str
    user: UserPublic
    access_token: str | None = None
    refresh_token: str | None = None
    token_type: str = "bearer"


class AgentTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int  # secondes


class UpdateMeRequest(BaseModel):
    """Modification de son propre profil — jamais role/organisation_id/agence_id,
    ces champs n'existent volontairement pas dans ce schéma (même envoyés, ignorés)."""
    nom: str | None = Field(default=None, min_length=1, max_length=150)
    prenom: str | None = Field(default=None, min_length=1, max_length=150)
    email: EmailStr | None = None
    # Réservé au CX Manager (vérifié dans update_me). Bornes : 1 h à 168 h (une semaine).
    delai_alerte_negatif_heures: int | None = Field(default=None, ge=1, le=168)

    @field_validator("delai_alerte_negatif_heures")
    @classmethod
    def _delai_non_vide(cls, valeur: int | None) -> int | None:
        # None explicite serait écrit en base dans une colonne NOT NULL : refusé à la validation (422).
        if valeur is None:
            raise ValueError("Le délai d'alerte ne peut pas être vide.")
        return valeur


class ChangerMotDePasseRequest(BaseModel):
    ancien_mot_de_passe: str
    # Aucune règle de robustesse n'existe ailleurs dans le projet (même pas à la
    # création de compte) : min_length=8 introduit ici comme filet minimal, pas
    # repris d'un pattern existant.
    nouveau_mot_de_passe: str = Field(..., min_length=8)
