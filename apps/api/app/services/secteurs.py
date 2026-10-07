"""
Secteur d'activité d'une organisation — code stable (`secteur_code`), distinct du libellé
affiché et de l'ancien champ libre `Organisation.secteur_activite` (conservé pour
compatibilité, jamais lu pour une décision métier désormais).

Source UNIQUE du code -> libellé (`libelle_secteur`), utilisée partout où le secteur est
affiché : GET /secteurs, les réponses OrganisationRead, et les écrans Admin (dashboard.py,
dashboard_statistics_admin.py). Source unique aussi de la liste fermée des codes valides,
réutilisée par le schéma OrganisationCreate/Update (422 si hors liste) et par le registre
de packs KPI (app/services/kpi/packs.py — un secteur_code inconnu du registre n'a
simplement pas de pack, voir kpis_visibles()).
"""
import unicodedata

SECTEUR_AUTRE = "autre"

# Liste fermée — doit rester synchronisée avec la contrainte CHECK posée par la migration
# 023_organisation_secteur_code (ck_organisations_secteur_code_valide).
SECTEUR_CODES: tuple[str, ...] = (
    "banque",
    "telecom",
    "restauration",
    "hotellerie",
    "commerce",
    "sante",
    SECTEUR_AUTRE,
)

_LIBELLES: dict[str, str] = {
    "banque": "Banque",
    "telecom": "Télécommunications",
    "restauration": "Restauration",
    "hotellerie": "Hôtellerie",
    "commerce": "Commerce / Distribution",
    "sante": "Santé / Pharmacie",
    SECTEUR_AUTRE: "Autre",
}


def libelle_secteur(code: str | None) -> str:
    """Libellé à afficher pour un secteur_code. Un code hors liste (ne devrait pas
    arriver grâce à la contrainte CHECK en base) retombe sur le libellé de "autre",
    jamais une exception — l'affichage ne doit jamais casser sur un secteur inconnu."""
    return _LIBELLES.get(code, _LIBELLES[SECTEUR_AUTRE])


def secteurs_disponibles() -> list[dict[str, str]]:
    """Liste code/libellé dans l'ordre de SECTEUR_CODES — réponse de GET /secteurs,
    source unique consommée par le select du dashboard (AdminOrgsPage)."""
    return [{"code": code, "libelle": _LIBELLES[code]} for code in SECTEUR_CODES]


def _sans_accents(texte: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", texte) if unicodedata.category(c) != "Mn")


def normaliser_secteur_libre(valeur: str | None) -> str:
    """Devine un secteur_code à partir d'une ancienne valeur libre (secteur_activite ou
    secteur), pour le backfill de la migration 023 uniquement — ne jamais appeler ceci
    pour une décision applicative après coup, secteur_code est la seule source ensuite.

    Minuscules, sans accents, recherche de motifs (cf. rapport d'audit KPI pour les 4
    valeurs réellement rencontrées en base) ; "autre" si rien ne correspond, y compris
    valeur vide ou nulle.
    """
    if not valeur or not valeur.strip():
        return SECTEUR_AUTRE
    v = _sans_accents(valeur.strip().lower())
    if "banque" in v or "financ" in v:
        return "banque"
    if "telecom" in v:
        return "telecom"
    if "restau" in v or "maquis" in v:
        return "restauration"
    if "hotel" in v:
        return "hotellerie"
    if "commerce" in v or "distribution" in v:
        return "commerce"
    if "sante" in v or "pharmac" in v or "clinique" in v:
        return "sante"
    return SECTEUR_AUTRE
