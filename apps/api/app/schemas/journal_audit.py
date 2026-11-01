"""Schémas du journal d'audit (lecture seule : il n'existe aucun schéma de création, de modification ni de suppression)."""
import uuid
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel


class JournalAuditItem(BaseModel):
    id: uuid.UUID
    date_action: datetime
    acteur_id: Optional[uuid.UUID] = None
    acteur_role: str
    acteur_email: Optional[str] = None
    action: str
    cible_type: Optional[str] = None
    cible_id: Optional[str] = None
    cible_libelle: Optional[str] = None
    organisation_id: Optional[uuid.UUID] = None
    resultat: str
    details: Optional[dict[str, Any]] = None
    adresse_ip: Optional[str] = None

    model_config = {"from_attributes": True}
