"""
Classement d'agences : décisions calculées par le code, jamais laissées au modèle de langage.

  1. Une comparaison n'est affichée que si AU MOINS DEUX agences ont un volume suffisant
     (même seuil que `queries._SEUIL_VOLUME_FAIBLE`, repris du champ `volume_faible` des données).
     Sinon la réponse est entièrement écrite ici, avec les vrais chiffres, sans verdict.
  2. Quand la comparaison est affichée, la phrase de verdict (« la plus faible », « la plus forte »)
     est écrite ici à partir du classement calculé ; une ligne du modèle qui la contredit est retirée.

Limite assumée : la détection de contradiction est lexicale (une ligne qui nomme UNE agence et porte UN
superlatif). Elle n'attrape pas une contradiction formulée autrement ; le verdict calculé, lui, est toujours
présent et exact.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Any

SENS_FAIBLE = "faible"
SENS_FORT = "fort"
SENS_LES_DEUX = "les_deux"

_MAX_AGENCES_SANS_AVIS_LISTEES = 12


def _norm(texte: str) -> str:
    sans = unicodedata.normalize("NFD", texte.lower())
    return "".join(c for c in sans if unicodedata.category(c) != "Mn").replace("’", "'")


def _pct(valeur: float) -> str:
    return f"{valeur:.1f}".replace(".", ",").removesuffix(",0") + " %"


def _accord(n: int, singulier: str, pluriel: str) -> str:
    return f"{n} {singulier if n < 2 else pluriel}"


# ───────────────────────────── sens de la question ─────────────────────────────

_FAIBLE_QUESTION = re.compile(
    r"\b(?:faible|basse?|pire|moins|difficulte|mauvais\w*|dernier\w*|va mal)\b"
)
_FORT_QUESTION = re.compile(
    r"\b(?:forte?|haute?|elevee?|meilleur\w*|tete|performante|plus satisfais\w+|premier\w*|top)\b"
)


def sens_de_la_question(question: str) -> str:
    """Quel extrême le manager demande : le plus faible, le plus fort, ou (indéterminé) les deux."""
    q = _norm(question)
    faible, fort = bool(_FAIBLE_QUESTION.search(q)), bool(_FORT_QUESTION.search(q))
    if faible and not fort:
        return SENS_FAIBLE
    if fort and not faible:
        return SENS_FORT
    return SENS_LES_DEUX


# ───────────────────────────── volume suffisant ─────────────────────────────

def agences_avec_avis(donnees: dict[str, Any]) -> list[dict[str, Any]]:
    return list(donnees.get("classement_complet") or [])


def agences_a_volume_suffisant(donnees: dict[str, Any]) -> list[dict[str, Any]]:
    return [a for a in agences_avec_avis(donnees) if not a.get("volume_faible")]


def comparaison_possible(donnees: dict[str, Any]) -> bool:
    """Vrai si au moins deux agences ont un volume suffisant pour être comparées."""
    return len(agences_a_volume_suffisant(donnees)) >= 2


# ───────────────────────────── réponse « comparaison impossible » ─────────────────────────────

def _liste_noms(noms: list[str]) -> str:
    visibles = noms[:_MAX_AGENCES_SANS_AVIS_LISTEES]
    texte = ", ".join(visibles)
    reste = len(noms) - len(visibles)
    return texte + (f" et {_accord(reste, 'autre', 'autres')}" if reste > 0 else "")


def reponse_comparaison_impossible(donnees: dict[str, Any]) -> str:
    """Réponse complète, écrite par le code, quand moins de deux agences ont un volume suffisant."""
    jours = int(donnees.get("periode_jours") or 0)
    seuil = int(donnees.get("seuil_volume_faible") or 5)
    avec_avis = agences_avec_avis(donnees)
    sans_avis = list(donnees.get("agences_actives_sans_feedback") or [])
    total = sum(int(a.get("nb_feedbacks") or 0) for a in avec_avis)
    periode = f"sur les {jours} derniers jours" if jours > 1 else "sur la période demandée"

    if not avec_avis:
        constat = f"Aucune agence n'a reçu d'avis {periode}"
        constat += (
            f" ({_accord(len(sans_avis), 'agence active', 'agences actives')} sans avis)." if sans_avis else "."
        )
    else:
        constat = (
            f"{_accord(len(avec_avis), 'agence a', 'agences ont')} reçu des avis {periode} "
            f"({_accord(total, 'avis', 'avis')} au total)"
        )
        constat += (
            f", et {_accord(len(sans_avis), 'agence active n’en a', 'agences actives n’en ont')} aucun." if sans_avis else "."
        )

    blocs = [
        "Je ne peux pas comparer vos agences pour l'instant : une comparaison demande au moins deux agences "
        f"avec {seuil} avis ou plus.\n{constat}"
    ]
    detail = []
    for a in avec_avis:
        nb = int(a["nb_feedbacks"])
        ligne = f"- {a['agence_nom']} : {_accord(nb, 'avis', 'avis')}, {_pct(float(a['satisfaction_pct']))} de clients satisfaits (note 4 ou 5)."
        if nb < seuil:
            ligne += " Ce volume est trop faible pour en tirer une conclusion."
        detail.append(ligne)
    if detail:
        blocs.append("\n".join(detail))
    if sans_avis:
        blocs.append(f"Agences sans avis : {_liste_noms(sans_avis)}.")
    blocs.append(
        "Pour aller plus loin, élargissez la période (par exemple « ce trimestre » ou « cette année »), "
        "ou demandez la liste des agences sans avis."
    )
    return "\n\n".join(blocs)


# ───────────────────────────── verdict calculé ─────────────────────────────

def _extremes(donnees: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """(agences à égalité au plus bas, agences à égalité au plus haut), parmi les volumes suffisants."""
    suffisantes = agences_a_volume_suffisant(donnees)
    bas = min(a["satisfaction_pct"] for a in suffisantes)
    haut = max(a["satisfaction_pct"] for a in suffisantes)
    return (
        [a for a in suffisantes if a["satisfaction_pct"] == bas],
        [a for a in suffisantes if a["satisfaction_pct"] == haut],
    )


def _phrase_extreme(agences: list[dict[str, Any]], qualificatif: str) -> str:
    detail = f"{_pct(float(agences[0]['satisfaction_pct']))}"
    if len(agences) == 1:
        a = agences[0]
        return f"L'agence {a['agence_nom']} a la satisfaction {qualificatif} : {detail} sur {_accord(int(a['nb_feedbacks']), 'avis', 'avis')}."
    noms = ", ".join(a["agence_nom"] for a in agences)
    return f"Les agences {noms} sont à égalité pour la satisfaction {qualificatif} : {detail} chacune."


def verdict_calcule(donnees: dict[str, Any], sens: str) -> str:
    """Phrase de verdict écrite par le code (exige `comparaison_possible`)."""
    bas, haut = _extremes(donnees)
    if len(bas) == len(agences_a_volume_suffisant(donnees)):
        # Toutes les agences comparables ont exactement le même taux : pas de « plus faible/plus forte ».
        a = bas[0]
        return (
            f"Les agences comparables ont toutes la même satisfaction ({_pct(float(a['satisfaction_pct']))}) : "
            "aucune ne se distingue."
        )
    if sens == SENS_FAIBLE:
        return _phrase_extreme(bas, "la plus faible")
    if sens == SENS_FORT:
        return _phrase_extreme(haut, "la plus élevée")
    return _phrase_extreme(bas, "la plus faible") + " " + _phrase_extreme(haut, "la plus élevée")


# ───────────────────────────── contradiction du modèle ─────────────────────────────

_NEGATION = re.compile(r"\b(?:pas|jamais|ne|n')\b")
_SUPERLATIF_FAIBLE = re.compile(
    r"\b(?:plus (?:faible|basse?)(?! (?:volume|nombre|effectif))|pire|moins satisfais\w+|moins performan\w+)\b"
)
_SUPERLATIF_FORT = re.compile(
    r"\b(?:plus (?:elevee?|haute?|forte?|satisfais\w+|performan\w+)(?! (?:volume|nombre|effectif))|meilleur\w*)\b"
)


def retirer_verdicts_contradictoires(texte: str, donnees: dict[str, Any]) -> tuple[str, list[str]]:
    """
    Retire les lignes du modèle qui désignent comme « la plus faible / la plus forte » une agence qui n'est pas
    celle du classement calculé. Retourne (texte nettoyé, lignes retirées). Ne touche pas aux lignes qui nomment
    plusieurs agences, aucune agence, ou qui sont niées.
    """
    if not comparaison_possible(donnees):
        return texte, []
    bas, haut = _extremes(donnees)
    ids_bas, ids_haut = {a["agence_nom"] for a in bas}, {a["agence_nom"] for a in haut}
    noms = {a["agence_nom"] for a in agences_avec_avis(donnees)}
    retirees: list[str] = []
    gardees: list[str] = []
    for ligne in texte.split("\n"):
        n = _norm(ligne)
        nommees = {nom for nom in noms if _norm(nom) in n}
        if len(nommees) == 1 and not _NEGATION.search(n):
            nom = next(iter(nommees))
            dit_faible, dit_fort = bool(_SUPERLATIF_FAIBLE.search(n)), bool(_SUPERLATIF_FORT.search(n))
            if dit_faible != dit_fort and (
                (dit_faible and nom not in ids_bas) or (dit_fort and nom not in ids_haut)
            ):
                retirees.append(ligne.strip())
                continue
        gardees.append(ligne)
    return "\n".join(gardees).strip(), retirees
