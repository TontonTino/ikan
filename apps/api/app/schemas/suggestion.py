"""
Schémas Pydantic pour les suggestions/idées (BF-04, BF-11).
"""
import uuid
from datetime import datetime
from pydantic import BaseModel, Field, field_validator
from app.models.enums import IdeaStatus


class SuggestionResponse(BaseModel):
    id: uuid.UUID
    feedback_id: uuid.UUID | None = None   # None : suggestion envoyée seule (« Partager une idée »)
    agence_id: uuid.UUID | None = None
    contenu: str
    statut: IdeaStatus
    date_soumission: datetime
    date_traitement: datetime | None
    notes_internes: str | None

    model_config = {"from_attributes": True}


MESSAGE_IDEE_VIDE = "Écrivez votre idée avant de l'envoyer."


class SuggestionCreate(BaseModel):
    """Corps de POST /qr-codes/{code}/suggestions (public) : un texte, rien d'autre (aucun contact)."""
    contenu: str = Field(..., max_length=1000)
    # Champ piège : invisible pour une personne, rempli par les robots (réponse de succès, rien enregistré).
    website: str | None = Field(None, max_length=200)

    @field_validator("contenu")
    @classmethod
    def _contenu_non_vide(cls, valeur: str) -> str:
        valeur = valeur.strip()
        if len(valeur) < 3:
            raise ValueError(MESSAGE_IDEE_VIDE)
        return valeur


class SuggestionSoumiseResponse(BaseModel):
    """Réponse PUBLIQUE : un message, aucune donnée du dossier."""
    message: str = "Merci, votre idée a bien été transmise à l'agence."


class SuggestionStatusUpdate(BaseModel):
    statut: IdeaStatus
    commentaire: str | None = None
    notes_internes: str | None = None
