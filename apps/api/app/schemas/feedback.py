"""
Schémas Pydantic pour les feedbacks (soumission client et workflow de traitement Closed-Loop).
"""
from __future__ import annotations
import re
import uuid
from datetime import datetime
from pydantic import BaseModel, Field, field_validator, model_validator
from typing import Optional, List

from app.utils.phone import MESSAGE_TELEPHONE_INVALIDE, normaliser_telephone


MESSAGE_CONSENTEMENT_REQUIS = (
    "Pour être recontacté, vous devez accepter que l'agence utilise votre numéro pour vous répondre."
)
MESSAGE_EMAIL_INVALIDE = "Adresse e-mail invalide."
_FORMAT_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$")


class FeedbackCreate(BaseModel):
    """Payload envoyé par le formulaire client."""
    categorie_id: uuid.UUID = Field(..., description="Catégorie choisie par le client parmi celles définies pour cette agence")
    note: Optional[int] = Field(None, ge=1, le=5, description="Note de satisfaction (1=Négatif, 3=Neutre, 5=Positif)")
    nps_note: Optional[int] = Field(None, ge=0, le=10, description="Réponse NPS facultative (0 à 10)")
    sentiment: Optional[str] = Field(None, max_length=20, description="Sentiment sélectionné (negatif, neutre, positif)")
    commentaire: Optional[str] = Field(None, max_length=1000)
    # Clé d'idempotence d'UN envoi (générée par le formulaire, rejouée à l'identique lors d'une nouvelle tentative).
    idempotency_key: Optional[str] = Field(None, min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    # Suggestion optionnelle (BF-04)
    suggestion: Optional[str] = Field(None, max_length=1000)
    # Demande de contact optionnelle (numéro ou email)
    contact_nom: Optional[str] = Field(None, max_length=100)
    contact_telephone: Optional[str] = Field(None, max_length=30)
    contact_email: Optional[str] = Field(None, max_length=254)
    souhaite_etre_rappele: bool = False
    # Consentement à être recontacté : obligatoire dès qu'un numéro est transmis (voir _exiger_consentement).
    consentement_contact: bool = False
    # Champ piège : invisible pour une personne, rempli par les robots. Un envoi qui le remplit répond comme un succès
    # mais n'enregistre rien (voir submit_feedback).
    website: Optional[str] = Field(None, max_length=200)

    @field_validator("contact_telephone")
    @classmethod
    def _valider_contact_telephone(cls, valeur: Optional[str]) -> Optional[str]:
        """Vide -> None ; sinon doit respecter la syntaxe internationale explicite. La valeur saisie
        est conservée telle quelle (trimée) : la normalisation se fait à la lecture."""
        if valeur is None or not valeur.strip():
            return None
        if normaliser_telephone(valeur) is None:
            raise ValueError(MESSAGE_TELEPHONE_INVALIDE)
        return valeur.strip()

    @field_validator("contact_email")
    @classmethod
    def _valider_contact_email(cls, valeur: Optional[str]) -> Optional[str]:
        if valeur is None or not valeur.strip():
            return None
        valeur = valeur.strip()
        if not _FORMAT_EMAIL.match(valeur):
            raise ValueError(MESSAGE_EMAIL_INVALIDE)
        return valeur

    @model_validator(mode="after")
    def _exiger_consentement(self):
        if self.contact_telephone and not self.consentement_contact:
            raise ValueError(MESSAGE_CONSENTEMENT_REQUIS)
        return self


class FeedbackSoumisResponse(BaseModel):
    """Réponse PUBLIQUE de POST /feedbacks : le strict nécessaire (aucune donnée de l'agence, de l'analyse ni du dossier)."""
    id: uuid.UUID
    nps_token: Optional[str] = None
    message: str = "Merci, votre avis a bien été enregistré."


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
    # Numéro normalisé pour wa.me (ex. "22670123456"). Renseigné UNIQUEMENT pour l'Agency
    # Manager et seulement si le numéro stocké est valide ; None sinon (jamais stocké en base).
    telephone_whatsapp: Optional[str] = None
    email: Optional[str] = None
    souhaite_etre_rappele: bool = False
    traitee: bool = False
    # Traitement (migration 032) : None pour une demande non traitée ou traitée avant la migration.
    date_traitement: Optional[datetime] = None
    traitee_par_nom: Optional[str] = None
    # Vrai quand la demande est traitée : téléphone et e-mail ne sont alors JAMAIS renvoyés (voir _masquer_si_traitee).
    coordonnees_masquees: bool = False
    # Consentement à être recontacté (migration 030). consentement_contact None = « Consentement non enregistré »
    # (demande antérieure à 030, ou e-mail seul). consentement_retention_mois : durée annoncée au client, pas une date de purge.
    consentement_contact: Optional[bool] = None
    consentement_date: Optional[datetime] = None
    consentement_retention_mois: Optional[int] = None

    model_config = {"from_attributes": True}

    @model_validator(mode="after")
    def _masquer_si_traitee(self):
        """Règle de masquage, au niveau du SCHÉMA : toute route qui sérialise une demande (liste des avis, détail, demandes de
        rappel, détail d'un problème…) est couverte, y compris les futures. Valable pour tous les rôles. Ne modifie jamais
        l'objet de la base : seule la copie sérialisée est vidée."""
        if self.traitee:
            self.telephone = None
            self.telephone_whatsapp = None
            self.email = None
            self.coordonnees_masquees = True
        return self


class DemandeContactListItem(DemandeContactInfo):
    """Item de GET /feedbacks/demandes-contact : DemandeContactInfo enrichi du contexte
    minimal du feedback lié (évite un aller-retour supplémentaire côté frontend pour
    afficher la liste)."""
    feedback_id: uuid.UUID
    date_demande: datetime
    feedback_commentaire: Optional[str] = None
    feedback_note: int
    agence_nom: Optional[str] = None


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


# Canaux de réponse reconnus. « autre » = réponse sans contact (en personne, courrier…). Longueur max : colonne reponses_client.canal.
CANAUX_REPONSE = ("telephone", "whatsapp", "email", "sms", "autre")
CANAL_LONGUEUR_MAX = 50


class ReponseClientCreate(BaseModel):
    contenu: str = Field(..., min_length=1, max_length=2000)
    canal: str = Field("telephone", max_length=CANAL_LONGUEUR_MAX, description="Canal utilisé: telephone, whatsapp, email, sms, autre")

    @field_validator("canal")
    @classmethod
    def _canal_connu(cls, valeur: str) -> str:
        canal = valeur.strip().lower()
        if canal not in CANAUX_REPONSE:
            raise ValueError(f"Canal inconnu. Valeurs acceptées : {', '.join(CANAUX_REPONSE)}.")
        return canal


class BrouillonReponseResponse(BaseModel):
    """Brouillon de réponse proposé (AM-09). `texte` est None quand il n'y a rien à proposer ; `raison` dit pourquoi."""
    disponible: bool
    raison: Optional[str] = None
    registre: Optional[str] = None
    texte: Optional[str] = None
    canal_suggere: Optional[str] = None


class FeedbackResponse(BaseModel):
    id: uuid.UUID
    qr_code_id: uuid.UUID
    agence_id: Optional[uuid.UUID] = None
    agence_nom: Optional[str] = None
    categorie_id: Optional[uuid.UUID] = None
    categorie_nom: Optional[str] = None
    note: int
    nps_note: Optional[int] = None
    # Posé UNIQUEMENT par submit_feedback (POST /feedbacks), jamais par les autres endpoints
    # qui réutilisent ce même schéma (liste, détail, workflow CX) : un jeton NPS frais n'a de
    # sens qu'au moment de la soumission elle-même. Additif, absent partout ailleurs.
    nps_token: Optional[str] = None
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
    issue_id: Optional[uuid.UUID] = None
    analyse_ia: Optional[AnalyseIAInfo] = None
    # IA-01 : « disponible » / « en_attente » (reprise possible) / « indisponible » (reprises épuisées). Additif, calculé sans requête.
    analyse_statut: Optional[str] = None
    demande_contact: Optional[DemandeContactInfo] = None

    model_config = {"from_attributes": True}


class NPSSubmit(BaseModel):
    """Payload de POST /feedbacks/{feedback_id}/nps (public, facultatif après l'envoi)."""
    nps_note: int = Field(..., ge=0, le=10, description="Réponse NPS, 0 à 10")
    token: str = Field(..., description="nps_token renvoyé par POST /feedbacks à la création")


class NPSSubmitResponse(BaseModel):
    nps_note: int
