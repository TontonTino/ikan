"""
Détection d'une agence NOMMÉE dans le texte d'une question — et résolution des ambiguïtés.

⚠ SÉCURITÉ — règle absolue : le nom lu dans le texte ne donne JAMAIS un droit d'accès. Cette détection ne sert
qu'à (1) restreindre davantage une question de CX Manager à UNE agence de SON organisation, (2) refuser d'une
phrase claire un responsable d'agence qui nomme une autre agence que la sienne, (3) DEMANDER UNE PRÉCISION quand
le texte ne désigne pas une agence sans ambiguïté. Le périmètre autorisé vient toujours du JWT (organisation, et
agence pour un responsable d'agence) ; la liste des agences candidates est elle-même lue UNIQUEMENT dans
l'organisation de l'appelant (queries.lister_agences_organisation).

PRINCIPE : une ambiguïté n'élargit jamais silencieusement le périmètre des données et ne choisit jamais une agence
au hasard — elle produit un statut « ambigue » ou « multiples » que l'appelant traduit en question de précision.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any

# Mots du nom d'une agence qui ne la distinguent pas d'une autre.
_MOTS_GENERIQUES = frozenset({"agence", "agences", "ville", "centre", "de", "du", "des", "la", "le", "les", "d", "l"})
# Mots du vocabulaire de la question qu'on ne prend jamais pour le morceau d'un nom d'agence.
_MOTS_DU_DOMAINE = frozenset({
    "accueil", "service", "services", "client", "clients", "reseau", "satisfaction", "feedback", "feedbacks",
    "qualite", "attente", "alertes", "alerte", "themes", "theme", "principal", "principale", "nouvelle", "ancienne",
})
_LONGUEUR_MIN = 4
_LONGUEUR_MIN_JETON = 5

AUCUNE = "aucune"
UNIQUE = "unique"
AMBIGUE = "ambigue"        # un même terme peut désigner plusieurs agences (ville commune, noms identiques, nom partiel)
MULTIPLES = "multiples"    # la question cite plusieurs agences distinctes


@dataclass
class ResolutionAgence:
    statut: str
    agences: list[dict[str, Any]] = field(default_factory=list)


def normaliser(texte: str) -> str:
    """Minuscules, sans accents, ponctuation → espaces, espaces compactés."""
    sans_accents = "".join(c for c in unicodedata.normalize("NFD", texte or "") if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", sans_accents.lower()).strip()


def _formes_fortes(agence: dict[str, Any]) -> set[str]:
    """Le nom complet, avec ou sans le préfixe « agence » : correspondance sans équivoque sur le terme employé."""
    nom = normaliser(agence.get("nom", ""))
    formes = {nom}
    sans_prefixe = nom[len("agence "):] if nom.startswith("agence ") else None
    # Sans le préfixe « agence », un nom fait seulement de mots du domaine (« Agence Accueil ») se confondrait avec
    # le simple mot « accueil » d'une question : on exige alors le nom complet.
    if sans_prefixe and not all(m in _MOTS_DU_DOMAINE or m in _MOTS_GENERIQUES for m in sans_prefixe.split()):
        formes.add(sans_prefixe)
    return {f for f in formes if len(f) >= _LONGUEUR_MIN}


def _formes_faibles(agence: dict[str, Any]) -> set[str]:
    """Partie distinctive du nom et ville : plusieurs agences peuvent les partager (ex. « Tunis »)."""
    nom = normaliser(agence.get("nom", ""))
    ville = normaliser(agence.get("ville") or "")
    formes = set()
    jetons = [m for m in nom.split() if m not in _MOTS_GENERIQUES]
    if jetons and not all(m in _MOTS_DU_DOMAINE for m in jetons):  # « Agence Accueil » ≠ le mot « accueil »
        formes.add(" ".join(jetons))
    if ville:
        formes.add(ville)
    return {f for f in formes if len(f) >= _LONGUEUR_MIN}


def _formes_jetons(agence: dict[str, Any]) -> set[str]:
    """Un seul mot distinctif du nom (« bourguiba », « oliviers ») : nom partiel, le moins sûr des trois niveaux."""
    nom = normaliser(agence.get("nom", ""))
    return {
        m for m in nom.split()
        if m not in _MOTS_GENERIQUES and m not in _MOTS_DU_DOMAINE and len(m) >= _LONGUEUR_MIN_JETON
    }


def _contient(texte_normalise: str, forme: str) -> bool:
    return re.search(rf"(?<![a-z0-9]){re.escape(forme)}(?![a-z0-9])", texte_normalise) is not None


def _inclus(court: str, long: str) -> bool:
    return court != long and f" {court} " in f" {long} "


def resoudre_agences(question: str, agences: list[dict[str, Any]]) -> ResolutionAgence:
    """
    Quelles agences (parmi `agences`, déjà limitées à l'organisation de l'appelant) la question désigne-t-elle ?

    - AUCUNE    : aucun nom ni terme reconnu.
    - UNIQUE    : une seule agence, désignée sans ambiguïté.
    - AMBIGUE   : un terme correspond à plusieurs agences (même ville, noms identiques, nom partiel commun), ou un
                  terme ambigu est mêlé à d'autres : on ne devine pas.
    - MULTIPLES : plusieurs agences distinctes sont citées, chacune sans ambiguïté.

    Trois niveaux de termes sont reconnus (nom complet → partie distinctive/ville → mot isolé). Un terme contenu
    dans un terme plus précis du même texte est écarté : « Agence ALPHA-Nord » ne désigne pas aussi
    « Agence ALPHA-Centre » parce qu'elles partagent « Alpha ».
    """
    texte = normaliser(question)
    if not texte:
        return ResolutionAgence(AUCUNE)

    # Tous les niveaux sont collectés (sinon « Sfax » serait ignoré dans « Sfax et Agence Tunis Lac ») ; les termes
    # inclus dans un terme plus long sont ensuite écartés (« alpha » dans « agence alpha nord », « tunis » dans
    # « agence tunis lac ») : le plus précis l'emporte, le moins précis ne crée ni agence candidate ni ambiguïté.
    termes: dict[str, list[dict[str, Any]]] = {}
    for formes in (_formes_fortes, _formes_faibles, _formes_jetons):
        for agence in agences:
            for forme in formes(agence):
                if _contient(texte, forme):
                    liste = termes.setdefault(forme, [])
                    if all(a["id"] != agence["id"] for a in liste):
                        liste.append(agence)
    if not termes:
        return ResolutionAgence(AUCUNE)

    # Un terme inclus dans un terme plus long trouvé aussi (« alpha nord » dans « agence alpha nord ») n'est pas
    # un second terme : c'est la même désignation.
    formes_maximales = [f for f in termes if not any(_inclus(f, g) for g in termes)]
    groupes = [termes[f] for f in formes_maximales]
    candidates: list[dict[str, Any]] = []
    for groupe in groupes:
        for agence in groupe:
            if all(a["id"] != agence["id"] for a in candidates):
                candidates.append(agence)

    if len(candidates) == 1:
        return ResolutionAgence(UNIQUE, candidates)
    if all(len(groupe) == 1 for groupe in groupes):
        return ResolutionAgence(MULTIPLES, candidates)
    return ResolutionAgence(AMBIGUE, candidates)


def detecter_agences_mentionnees(question: str, agences: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Agences désignées par la question (toute résolution confondue). Conservé pour compatibilité."""
    return resoudre_agences(question, agences).agences


def libelle_agence(agence: dict[str, Any]) -> str:
    """« Agence Tunis Bourguiba » (Tunis) — la ville aide à départager deux agences au nom proche."""
    ville = (agence.get("ville") or "").strip()
    return f"« {agence['nom']} »" + (f" ({ville})" if ville else "")
