"""
Paramètres système (AD-05) : bornes, source UNIQUE de leur validation (schéma d'écriture), de leur lecture (valeurs hors bornes) et de
l'écran administrateur (exposées par GET /system/settings, champ `bornes`).

Bornes et justification :
- retention_mois : entier de 1 à 120 mois. Le plancher évite une durée nulle ou négative affichée aux clients dans la case de
  consentement ; le plafond (10 ans) est celui que proposait déjà l'écran (max=120) et reste cohérent avec une conservation
  commerciale raisonnable. La valeur par défaut est 24 mois (RETENTION_MOIS_DEFAUT).
- seuil_alerte_defaut : nombre de 0 à 100 (pourcentage), comme le seuil d'alerte d'une agence (schemas/agence.py).
- mode_ia : liste fermée, les deux modes proposés par l'écran.
- notifications_email_actives : booléen strict.
- nom_application : texte de 1 à 255 caractères (colonne String(255)).
"""
from math import isfinite
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.models.system_settings import RETENTION_MOIS_DEFAUT, SystemSettings

RETENTION_MOIS_MIN = 1
RETENTION_MOIS_MAX = 120
SEUIL_MIN = 0
SEUIL_MAX = 100
MODES_IA = ("deterministique", "hybride")
NOM_APPLICATION_MAX = 255

BORNES: Dict[str, Any] = {
    "retention_mois": {"min": RETENTION_MOIS_MIN, "max": RETENTION_MOIS_MAX},
    "seuil_alerte_defaut": {"min": SEUIL_MIN, "max": SEUIL_MAX},
    "mode_ia": {"valeurs": list(MODES_IA)},
    "nom_application": {"max_caracteres": NOM_APPLICATION_MAX},
}


def retention_valide(valeur: Any) -> bool:
    """Entier (ni booléen, ni décimal, ni texte) compris entre les bornes."""
    return isinstance(valeur, int) and not isinstance(valeur, bool) and RETENTION_MOIS_MIN <= valeur <= RETENTION_MOIS_MAX


def seuil_valide(valeur: Any) -> bool:
    return isinstance(valeur, (int, float)) and not isinstance(valeur, bool) and isfinite(valeur) and SEUIL_MIN <= valeur <= SEUIL_MAX


def valeurs_hors_bornes(ligne: Any) -> List[str]:
    """Noms des paramètres STOCKÉS hors des bornes (valeurs historiques) : signalés, jamais corrigés ni supprimés."""
    hors: List[str] = []
    if not retention_valide(getattr(ligne, "retention_mois", None)):
        hors.append("retention_mois")
    if not seuil_valide(getattr(ligne, "seuil_alerte_defaut", None)):
        hors.append("seuil_alerte_defaut")
    if getattr(ligne, "mode_ia", None) not in MODES_IA:
        hors.append("mode_ia")
    return hors


def retention_mois_affichee(db: Session, ligne: Optional[SystemSettings] = None) -> int:
    """Durée de conservation montrée aux clients (case de consentement), LECTURE SEULE : la valeur configurée si elle est dans les
    bornes, sinon la valeur par défaut (une valeur aberrante stockée n'est jamais affichée ; elle n'est pas modifiée)."""
    if ligne is None:
        ligne = db.query(SystemSettings).first()
    valeur = ligne.retention_mois if ligne is not None else None
    return valeur if retention_valide(valeur) else RETENTION_MOIS_DEFAUT
