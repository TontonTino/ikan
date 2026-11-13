"""Urgence affichée (lot 4) : trois niveaux à l'écran — critique, élevée, normale — pour quatre valeurs en base.

« normale » n'est PAS une valeur stockée : c'est un alias de filtre qui regroupe « faible » et « moyenne ». Les valeurs en base
(CriticiteType) ne changent pas ; seuls l'affichage et ce filtre les regroupent.
"""
from typing import List, Optional

from app.models.enums import CriticiteType

URGENCE_NORMALE = "normale"
NIVEAUX_URGENCE_NORMALE = (CriticiteType.FAIBLE, CriticiteType.MOYENNE)


def valeurs_filtre_urgence(valeur: Optional[str]) -> Optional[List[CriticiteType]]:
    """Valeurs en base couvertes par un filtre d'urgence ; None si la valeur n'est pas connue (au code appelant de refuser)."""
    if valeur == URGENCE_NORMALE:
        return list(NIVEAUX_URGENCE_NORMALE)
    if valeur in {c.value for c in CriticiteType}:
        return [CriticiteType(valeur)]
    return None
