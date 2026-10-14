"""
Schémas Pydantic pour les suggestions/idées (BF-04, BF-11).
"""
import uuid
from datetime import datetime
from pydantic import BaseModel, Field, field_validator
from app.models.enums import IdeaStatus


class HistoriqueSuggestionResponse(BaseModel):
    """Un changement de statut d'une suggestion (AM-08). Jamais d'identifiant d'utilisateur, d'e-mail ni de téléphone."""
    id: uuid.UUID
    ancien_statut: IdeaStatus | None = None
    nouveau_statut: IdeaStatus
    date: datetime
    # None : compte supprimé depuis. Le rôle est la valeur technique (agency_manager, cx_manager).
    auteur_nom: str | None = None
    auteur_role: str | None = None
    commentaire: str | None = None


class SuggestionResponse(BaseModel):
    id: uuid.UUID
    feedback_id: uuid.UUID | None = None   # None : suggestion envoyée seule (« Partager une idée »)
    agence_id: uuid.UUID | None = None
    contenu: str
    statut: IdeaStatus
    date_soumission: datetime
    date_traitement: datetime | None
    notes_internes: str | None
    # Dernier changement de statut (champ additif) ; None tant que la suggestion n'a jamais changé de statut.
    dernier_changement: HistoriqueSuggestionResponse | None = None

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


LONGUEUR_MAX_COMMENTAIRE = 500


class SuggestionStatusUpdate(BaseModel):
    statut: IdeaStatus
    # Commentaire facultatif du changement de statut, conservé dans l'historique. Texte seulement : sauts de ligne et tabulations
    # permis, tout autre caractère de contrôle refusé. Jamais journalisé.
    commentaire: str | None = Field(None, max_length=LONGUEUR_MAX_COMMENTAIRE)
    notes_internes: str | None = Field(None, max_length=1000)

    @field_validator("commentaire")
    @classmethod
    def _commentaire_propre(cls, valeur: str | None) -> str | None:
        if valeur is None:
            return None
        valeur = valeur.replace("\r\n", "\n").strip()
        if any((ord(c) < 32 and c not in "\n\t") or ord(c) == 127 for c in valeur):
            raise ValueError("Le commentaire contient un caractère non autorisé.")
        return valeur or None
