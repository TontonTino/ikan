"""
Schémas Pydantic pour les agences.
"""
import uuid
from datetime import datetime
from pydantic import BaseModel


class AgenceCreate(BaseModel):
    nom: str
    adresse: str | None = None
    ville: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    seuil_alerte: float = 80.0


class AgenceUpdate(BaseModel):
    nom: str | None = None
    adresse: str | None = None
    ville: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    seuil_alerte: float | None = None
    active: bool | None = None


class AgenceResponse(BaseModel):
    id: uuid.UUID
    organisation_id: uuid.UUID
    nom: str
    adresse: str | None
    ville: str | None
    latitude: float | None
    longitude: float | None
    active: bool
    seuil_alerte: float
    date_creation: datetime
    qr_code_token: str | None = None
    qr_code_url: str | None = None

    model_config = {"from_attributes": True}
