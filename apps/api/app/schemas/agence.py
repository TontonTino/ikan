"""
Schémas Pydantic pour les agences.
"""
import uuid
from datetime import datetime
from math import isfinite
from typing import Annotated, Optional

from pydantic import BaseModel, BeforeValidator

MESSAGE_SEUIL_INVALIDE = "Le seuil d'alerte doit être un nombre compris entre 0 et 100 %."


def _seuil_valide(valeur):
    """Seuil d'alerte en pourcentage : un nombre (jamais un texte ni un booléen), fini, de 0 à 100 inclus."""
    if isinstance(valeur, bool) or not isinstance(valeur, (int, float)) or not isfinite(valeur) or not 0 <= valeur <= 100:
        raise ValueError(MESSAGE_SEUIL_INVALIDE)
    return float(valeur)


# Type unique du seuil d'alerte (création, modification d'agence et PATCH /alertes/agences/{id}/seuil).
SeuilAlerte = Annotated[float, BeforeValidator(_seuil_valide)]


class AgenceCreate(BaseModel):
    nom: str
    adresse: str | None = None
    ville: str | None = None
    telephone: str | None = None
    email: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    seuil_alerte: SeuilAlerte = 80.0


class AgenceUpdate(BaseModel):
    nom: str | None = None
    adresse: str | None = None
    ville: str | None = None
    telephone: str | None = None
    email: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    # Absent = inchangé ; un null explicite serait écrit dans une colonne NOT NULL : refusé comme toute valeur invalide.
    seuil_alerte: SeuilAlerte = None  # type: ignore[assignment]
    active: bool | None = None


class AgenceResponse(BaseModel):
    id: uuid.UUID
    organisation_id: uuid.UUID
    nom: str
    adresse: str | None
    ville: str | None
    telephone: str | None = None
    email: str | None = None
    latitude: float | None
    longitude: float | None
    active: bool
    seuil_alerte: float
    photo: str | None = None
    date_creation: datetime
    qr_code_token: str | None = None
    qr_code_url: str | None = None
    manager_nom: str | None = None

    model_config = {"from_attributes": True}


class AgenceContexteItem(BaseModel):
    """Informations minimales pour le sélecteur de contexte du CX Manager."""
    id: uuid.UUID
    nom: str
    ville: str | None = None

    model_config = {"from_attributes": True}


class AgencePhotoUpdate(BaseModel):
    photo: str | None = None


class ActiviteAgenceItem(BaseModel):
    """Un événement du fil d'activité d'une agence (onglet Activité, page agence unifiée)."""
    id: uuid.UUID
    date: datetime
    type_evenement: str
    auteur_nom: str
    auteur_role: Optional[str] = None
    details: Optional[str] = None

    model_config = {"from_attributes": True}
