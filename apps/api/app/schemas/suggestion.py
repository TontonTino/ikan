"""
Schémas Pydantic pour les suggestions/idées (BF-04, BF-11).
"""
import uuid
from datetime import datetime
from pydantic import BaseModel
from app.models.enums import IdeaStatus


class SuggestionResponse(BaseModel):
    id: uuid.UUID
    feedback_id: uuid.UUID
    contenu: str
    statut: IdeaStatus
    date_soumission: datetime
    date_traitement: datetime | None
    notes_internes: str | None

    model_config = {"from_attributes": True}


class SuggestionStatusUpdate(BaseModel):
    statut: IdeaStatus
    commentaire: str | None = None
    notes_internes: str | None = None
