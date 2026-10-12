"""
Secteur d'activité de l'organisation, tel que renseigné en base (colonne `organisations.secteur_code`, liste
fermée de apps/api/app/services/secteurs.py — recopiée ici car l'agent n'importe jamais le code de l'API).

RÈGLE : aucun secteur n'est supposé. Si le code est absent, inconnu ou « autre », aucune consigne sectorielle
n'est ajoutée aux prompts : YAM reste neutre et se limite aux données.
"""
from __future__ import annotations

from typing import Optional

_LIBELLES: dict[str, str] = {
    "banque": "Banque",
    "telecom": "Télécommunications",
    "restauration": "Restauration",
    "hotellerie": "Hôtellerie",
    "commerce": "Commerce / Distribution",
    "sante": "Santé / Pharmacie",
}


def libelle_secteur(code: Optional[str]) -> Optional[str]:
    """Libellé du secteur, ou None si le code est absent, « autre » ou hors liste."""
    if not code:
        return None
    return _LIBELLES.get(code.strip().lower())


def consigne_secteur(code: Optional[str]) -> str:
    """Phrase à ajouter au prompt système, ou chaîne vide quand le secteur n'est pas connu."""
    libelle = libelle_secteur(code)
    if libelle is None:
        return ""
    return (
        f"Secteur de l'organisation : {libelle}. Adapte seulement le vocabulaire (clients, points de contact, "
        "agences) à ce secteur ; n'en déduis aucun fait, chiffre ou pratique qui ne soit pas dans les données."
    )
