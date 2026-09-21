"""
Schémas Pydantic pour les organisations (OrganisationCreate, OrganisationUpdate, OrganisationRead).
"""
import uuid
from datetime import datetime
from typing import List, Literal
from pydantic import BaseModel, EmailStr, Field, model_validator


class OrganisationBase(BaseModel):
    nom: str = Field(..., description="Nom de l'organisation", min_length=2, max_length=255)
    logo: str | None = Field(default=None, description="Chemin ou URL du logo")
    secteur_activite: str | None = Field(default="Télécommunications", description="Secteur d'activité de l'entreprise")
    pays_region: str | None = Field(default="Tunisie / Afrique du Nord", description="Pays ou région principale")
    email_pro: str | None = Field(default=None, description="Adresse email professionnelle unique")


class PlanInfo(BaseModel):
    code: str
    nom: str

    model_config = {"from_attributes": True}


class OrganisationCreate(BaseModel):
    """Schéma de création d'une nouvelle organisation."""
    nom: str = Field(..., min_length=2, max_length=255)
    logo: str | None = None
    secteur_activite: str = Field(...)
    pays_region: str = Field(...)
    email_pro: EmailStr = Field(...)


class OrganisationUpdate(BaseModel):
    """Schéma de mise à jour partielle d'une organisation."""
    nom: str | None = None
    logo: str | None = None
    secteur_activite: str | None = None
    pays_region: str | None = None
    email_pro: EmailStr | None = None
    active: bool | None = None


class OrganisationRead(BaseModel):
    """Schéma de lecture d'une organisation."""
    id: uuid.UUID
    nom: str
    logo: str | None = None
    secteur_activite: str | None = None
    pays_region: str | None = None
    email_pro: str | None = None
    active: bool = True
    created_at: datetime | None = None
    plan: PlanInfo | None = None

    @model_validator(mode='before')
    @classmethod
    def sync_legacy_fields(cls, data: any) -> any:
        if hasattr(data, '__dict__'):
            if not getattr(data, 'email_pro', None) and getattr(data, 'email', None):
                object.__setattr__(data, 'email_pro', getattr(data, 'email'))
            if not getattr(data, 'secteur_activite', None) and getattr(data, 'secteur', None):
                object.__setattr__(data, 'secteur_activite', getattr(data, 'secteur'))
            if not getattr(data, 'created_at', None) and getattr(data, 'date_creation', None):
                object.__setattr__(data, 'created_at', getattr(data, 'date_creation'))
            if not getattr(data, 'pays_region', None):
                object.__setattr__(data, 'pays_region', "Tunisie / Afrique du Nord")
        elif isinstance(data, dict):
            if not data.get('email_pro') and data.get('email'):
                data['email_pro'] = data['email']
            if not data.get('secteur_activite') and data.get('secteur'):
                data['secteur_activite'] = data['secteur']
            if not data.get('created_at') and data.get('date_creation'):
                data['created_at'] = data['date_creation']
            if not data.get('pays_region'):
                data['pays_region'] = "Tunisie / Afrique du Nord"
        return data

    model_config = {"from_attributes": True}


# Alias pour rétro-compatibilité
OrganisationResponse = OrganisationRead


class QuotaUtilisation(BaseModel):
    """Consommation actuelle et limite (max = None : illimité)."""
    actuel: int
    max: int | None = None


class FonctionnaliteStatut(BaseModel):
    code: str
    libelle: str
    # "disponible" | "verrouille" (gatées) | "a_venir" (non implémentées, identique pour tous)
    statut: Literal["disponible", "verrouille", "a_venir"]
    actif: bool


class UtilisationOrganisation(BaseModel):
    """Forfait, quotas réels et fonctionnalités de l'organisation — purement informatif."""
    plan: PlanInfo | None = None
    cx_managers: QuotaUtilisation
    agences: QuotaUtilisation
    feedbacks_ce_mois: QuotaUtilisation
    fonctionnalites: List[FonctionnaliteStatut]


class UpgradeCheckoutRequest(BaseModel):
    """Forfait payant demandé pour la mise à niveau en libre-service (Entreprise reste sur devis)."""
    plan_code: Literal["starter", "pro"]


class UpgradeCheckoutResponse(BaseModel):
    """URL de redirection vers Stripe Checkout."""
    checkout_url: str


class ChangementPlanRequest(BaseModel):
    """Override manuel du forfait par un Admin — réservé aux cas exceptionnels, raison obligatoire."""
    plan_id: uuid.UUID
    raison: str = Field(..., min_length=10, description="Motif de l'override, tracé dans changements_plan")
