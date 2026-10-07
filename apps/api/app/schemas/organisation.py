"""
Schémas Pydantic pour les organisations (OrganisationCreate, OrganisationUpdate, OrganisationRead).
"""
import uuid
from datetime import datetime
from typing import List, Literal
from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from app.services.secteurs import SECTEUR_CODES


def _valider_secteur_code(v: str) -> str:
    if v not in SECTEUR_CODES:
        raise ValueError(f"secteur_code invalide : '{v}'. Valeurs autorisées : {sorted(SECTEUR_CODES)}")
    return v


class OrganisationBase(BaseModel):
    nom: str = Field(..., description="Nom de l'organisation", min_length=2, max_length=255)
    logo: str | None = Field(default=None, description="Chemin ou URL du logo")
    # Plus de défaut applicatif : secteur_code (liste fermée) est la seule décision de
    # secteur qui compte désormais (voir app/services/secteurs.py et le rapport d'audit KPI).
    secteur_activite: str | None = Field(default=None, description="Libellé libre historique du secteur (voir secteur_code)")
    pays_region: str | None = Field(default="Tunisie / Afrique du Nord", description="Pays ou région principale")
    email_pro: str | None = Field(default=None, description="Adresse email professionnelle unique")


class PlanInfo(BaseModel):
    code: str
    nom: str

    model_config = {"from_attributes": True}


class OrganisationCreate(BaseModel):
    """Schéma de création d'une nouvelle organisation. `secteur_code` est désormais
    obligatoire (422 si hors liste, voir GET /secteurs) ; `secteur_activite` reste accepté
    pour compatibilité mais, si omis, est déduit par l'endpoint du libellé de secteur_code."""
    nom: str = Field(..., min_length=2, max_length=255)
    logo: str | None = None
    secteur_code: str = Field(..., description="Code de secteur, liste fermée — voir GET /secteurs")
    secteur_activite: str | None = Field(default=None, description="Libellé libre legacy, déduit de secteur_code si omis")
    pays_region: str = Field(...)
    email_pro: EmailStr = Field(...)

    @field_validator("secteur_code")
    @classmethod
    def _secteur_code_valide(cls, v: str) -> str:
        return _valider_secteur_code(v)


class OrganisationUpdate(BaseModel):
    """Schéma de mise à jour partielle d'une organisation."""
    nom: str | None = None
    logo: str | None = None
    secteur_code: str | None = Field(default=None, description="Code de secteur, liste fermée — voir GET /secteurs")
    secteur_activite: str | None = None
    pays_region: str | None = None
    email_pro: EmailStr | None = None
    active: bool | None = None

    @field_validator("secteur_code")
    @classmethod
    def _secteur_code_valide_optionnel(cls, v: str | None) -> str | None:
        return v if v is None else _valider_secteur_code(v)


class OrganisationRead(BaseModel):
    """Schéma de lecture d'une organisation."""
    id: uuid.UUID
    nom: str
    logo: str | None = None
    secteur_activite: str | None = None
    # secteur_code et son libellé — seule source fiable désormais (secteur_activite reste
    # exposé pour compatibilité mais n'est plus dérivé que par sync_legacy_fields ci-dessous).
    secteur_code: str
    secteur_libelle: str | None = None
    pays_region: str | None = None
    email_pro: str | None = None
    active: bool = True
    created_at: datetime | None = None
    plan: PlanInfo | None = None

    @model_validator(mode='before')
    @classmethod
    def sync_legacy_fields(cls, data: any) -> any:
        # Import local : évite un cycle (secteurs.py n'importe pas ce module).
        from app.services.secteurs import libelle_secteur

        if hasattr(data, '__dict__'):
            if not getattr(data, 'email_pro', None) and getattr(data, 'email', None):
                object.__setattr__(data, 'email_pro', getattr(data, 'email'))
            if not getattr(data, 'secteur_activite', None) and getattr(data, 'secteur', None):
                object.__setattr__(data, 'secteur_activite', getattr(data, 'secteur'))
            if not getattr(data, 'created_at', None) and getattr(data, 'date_creation', None):
                object.__setattr__(data, 'created_at', getattr(data, 'date_creation'))
            if not getattr(data, 'pays_region', None):
                object.__setattr__(data, 'pays_region', "Tunisie / Afrique du Nord")
            if not getattr(data, 'secteur_libelle', None):
                object.__setattr__(data, 'secteur_libelle', libelle_secteur(getattr(data, 'secteur_code', None)))
        elif isinstance(data, dict):
            if not data.get('email_pro') and data.get('email'):
                data['email_pro'] = data['email']
            if not data.get('secteur_activite') and data.get('secteur'):
                data['secteur_activite'] = data['secteur']
            if not data.get('created_at') and data.get('date_creation'):
                data['created_at'] = data['date_creation']
            if not data.get('pays_region'):
                data['pays_region'] = "Tunisie / Afrique du Nord"
            if not data.get('secteur_libelle'):
                data['secteur_libelle'] = libelle_secteur(data.get('secteur_code'))
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
