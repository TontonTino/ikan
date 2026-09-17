"""
Schémas Pydantic pour les feedbacks (soumission client et workflow de traitement Closed-Loop).
"""
from __future__ import annotations
import uuid
from datetime import datetime
from pydantic import BaseModel, Field
from typing import Optional, List


class FeedbackCreate(BaseModel):
    """Payload envoyé par le formulaire client."""
    note: Optional[int] = Field(None, ge=1, le=5, description="Note de satisfaction (1=Négatif, 3=Neutre, 5=Positif)")
    sentiment: Optional[str] = Field(None, description="Sentiment sélectionné (negatif, neutre, positif)")
    commentaire: Optional[str] = Field(None, max_length=1000)
    # Suggestion optionnelle (BF-04)
    suggestion: Optional[str] = None
    # Demande de contact optionnelle (numéro ou email)
    contact_nom: Optional[str] = None
    contact_telephone: Optional[str] = None
    contact_email: Optional[str] = None
    souhaite_etre_rappele: bool = False


class AnalyseIAInfo(BaseModel):
    id: uuid.UUID
    sentiment: str
    criticite: str
    theme_principal: Optional[str] = None
    discordance_detectee: bool = False
    score_sentiment: Optional[float] = None

    model_config = {"from_attributes": True}


class DemandeContactInfo(BaseModel):
    id: uuid.UUID
    nom: Optional[str] = None
    telephone: Optional[str] = None
    email: Optional[str] = None
    souhaite_etre_rappele: bool = False
    traitee: bool = False

    model_config = {"from_attributes": True}


class HistoriqueFeedbackResponse(BaseModel):
    id: uuid.UUID
    feedback_id: uuid.UUID
    utilisateur_id: Optional[uuid.UUID] = None
    auteur_nom: str
    auteur_role: str
    agence_nom: Optional[str] = None
    type_evenement: str
    ancien_statut: Optional[str] = None
    nouveau_statut: Optional[str] = None
    details: Optional[str] = None
    date_evenement: datetime

    model_config = {"from_attributes": True}


class ReponseClientResponse(BaseModel):
    id: uuid.UUID
    feedback_id: uuid.UUID
    utilisateur_id: Optional[uuid.UUID] = None
    auteur_nom: str
    auteur_role: str
    canal: str
    contenu: str
    date_envoi: datetime

    model_config = {"from_attributes": True}


class NoteInterneCreate(BaseModel):
    texte: str = Field(..., min_length=1, max_length=2000)


class SuggestionAgenceCreate(BaseModel):
    suggestion: str = Field(..., min_length=3, max_length=2000)


class ActionCXCreate(BaseModel):
    action: str = Field(..., min_length=3, max_length=2000)


class ReponseClientCreate(BaseModel):
    contenu: str = Field(..., min_length=1, max_length=2000)
    canal: str = Field("telephone", description="Canal utilisé: telephone, email, whatsapp, sms")


class FeedbackResponse(BaseModel):
    id: uuid.UUID
    qr_code_id: uuid.UUID
    agence_id: Optional[uuid.UUID] = None
    agence_nom: Optional[str] = None
    note: int
    commentaire: Optional[str] = None
    date_soumission: datetime
    statut_traitement: str = "nouveau"
    assigne_a_id: Optional[uuid.UUID] = None
    assigne_a_nom: Optional[str] = None
    date_assignation: Optional[datetime] = None
    date_resolution: Optional[datetime] = None
    action_a_prendre: Optional[str] = None
    action_realisee: bool = False
    suggestion_agence: Optional[str] = None
    suggestion_agence_auteur: Optional[str] = None
    suggestion_agence_date: Optional[datetime] = None
    notes_internes: Optional[List[dict]] = []
    discordance_status: Optional[str] = None
    analyse_ia: Optional[AnalyseIAInfo] = None
    demande_contact: Optional[DemandeContactInfo] = None

    model_config = {"from_attributes": True}
