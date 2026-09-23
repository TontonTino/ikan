"""
Schémas Pydantic pour les catégories de feedback définies par le CX Manager, par agence.
"""
import uuid
from datetime import datetime
from pydantic import BaseModel, Field
from typing import Optional


class CategorieCreate(BaseModel):
    nom: str = Field(..., min_length=1, max_length=100)
    est_categorie_suggestion: bool = False


class CategorieUpdate(BaseModel):
    nom: Optional[str] = Field(None, min_length=1, max_length=100)
    active: Optional[bool] = None
    est_categorie_suggestion: Optional[bool] = None


class CategorieResponse(BaseModel):
    id: uuid.UUID
    agence_id: uuid.UUID
    nom: str
    active: bool
    est_categorie_suggestion: bool = False
    created_at: datetime
    cree_par_id: Optional[uuid.UUID] = None
    # 'cx_manager' | 'agency_manager' | None (catégorie antérieure à cette fonctionnalité)
    cree_par_role: Optional[str] = None

    model_config = {"from_attributes": True}


class CategoriePublicResponse(BaseModel):
    """Réponse allégée pour le formulaire client public (pas d'authentification)."""
    id: uuid.UUID
    nom: str

    model_config = {"from_attributes": True}
