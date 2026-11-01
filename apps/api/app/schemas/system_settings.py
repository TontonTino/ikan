"""
Schémas Pydantic pour la configuration système.

Écriture (SystemSettingsUpdate) : validation STRICTE (AD-05) — aucun texte pris pour un nombre, aucun booléen déguisé, aucune valeur
nulle, aucune clé inconnue ; les messages sont en français et ne répètent jamais la valeur saisie. Lecture (SystemSettingsResponse) :
aucune validation, pour renvoyer telles quelles d'éventuelles valeurs historiques hors bornes, avec le signalement `valeurs_hors_bornes`.
"""
from uuid import UUID
from datetime import datetime
from typing import Annotated, Any, Dict, List
from pydantic import BaseModel, BeforeValidator, computed_field, model_validator

from app.services import parametres_systeme as limites


class SystemSettingsBase(BaseModel):
    nom_application: str = "IKAN AI — Plateforme Feedback Client"
    seuil_alerte_defaut: float = 80.0
    retention_mois: int = 24
    mode_ia: str = "deterministique"
    notifications_email_actives: bool = True


MESSAGE_NOM = f"Le nom de l'application doit être un texte de 1 à {limites.NOM_APPLICATION_MAX} caractères."
MESSAGE_SEUIL = f"Le seuil d'alerte par défaut doit être un nombre compris entre {limites.SEUIL_MIN} et {limites.SEUIL_MAX} %."
MESSAGE_RETENTION = f"La durée de conservation doit être un nombre entier de mois, de {limites.RETENTION_MOIS_MIN} à {limites.RETENTION_MOIS_MAX}."
MESSAGE_MODE_IA = "Le mode d'analyse doit être l'un des modes proposés : " + ", ".join(limites.MODES_IA) + "."
MESSAGE_BOOLEEN = "Les notifications par e-mail doivent être activées ou désactivées (vrai ou faux)."
MESSAGE_CLE_INCONNUE = "Paramètre inconnu : seuls les paramètres système existants peuvent être modifiés."


def _nom(valeur):
    if not isinstance(valeur, str) or not 1 <= len(valeur.strip()) <= limites.NOM_APPLICATION_MAX:
        raise ValueError(MESSAGE_NOM)
    return valeur.strip()


def _seuil(valeur):
    if not limites.seuil_valide(valeur):
        raise ValueError(MESSAGE_SEUIL)
    return float(valeur)


def _retention(valeur):
    if not limites.retention_valide(valeur):
        raise ValueError(MESSAGE_RETENTION)
    return valeur


def _mode_ia(valeur):
    if not isinstance(valeur, str) or valeur not in limites.MODES_IA:
        raise ValueError(MESSAGE_MODE_IA)
    return valeur


def _booleen(valeur):
    if not isinstance(valeur, bool):
        raise ValueError(MESSAGE_BOOLEEN)
    return valeur


class SystemSettingsUpdate(BaseModel):
    """Mise à jour PARTIELLE : seuls les champs envoyés sont modifiés (exclude_unset côté route). Un champ envoyé à null est refusé."""
    nom_application: Annotated[str, BeforeValidator(_nom)] = None  # type: ignore[assignment]
    seuil_alerte_defaut: Annotated[float, BeforeValidator(_seuil)] = None  # type: ignore[assignment]
    retention_mois: Annotated[int, BeforeValidator(_retention)] = None  # type: ignore[assignment]
    mode_ia: Annotated[str, BeforeValidator(_mode_ia)] = None  # type: ignore[assignment]
    notifications_email_actives: Annotated[bool, BeforeValidator(_booleen)] = None  # type: ignore[assignment]

    @model_validator(mode="before")
    @classmethod
    def _refuser_cles_inconnues(cls, donnees: Any):
        if isinstance(donnees, dict) and set(donnees) - set(cls.model_fields):
            raise ValueError(MESSAGE_CLE_INCONNUE)
        return donnees


class SystemSettingsResponse(SystemSettingsBase):
    id: UUID
    date_modification: datetime

    @computed_field  # type: ignore[prop-decorator]
    @property
    def valeurs_hors_bornes(self) -> List[str]:
        return limites.valeurs_hors_bornes(self)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def bornes(self) -> Dict[str, Any]:
        return limites.BORNES

    class Config:
        from_attributes = True
