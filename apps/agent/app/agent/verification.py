"""
Vérification déterministe des chiffres d'une réponse générée.

Le LLM ne doit citer que des nombres présents dans les données qu'on lui a transmises (ou calculés par le
code, champ `calculs_verifies`). Cette vérification ne juge pas la justesse d'un raisonnement : elle
détecte seulement un nombre ABSENT de la source (statistique, durée, effectif, délai inventés).

Elle est volontairement prudente côté faux positifs :
  - les numéros de liste (« 1. », « 2) ») et les dates ISO ne comptent pas ;
  - une valeur 0-1 de la source (ex. sentiment 0,55) autorise aussi sa forme en pourcentage (55) ;
  - le nombre d'éléments de chaque liste de la source est autorisé (ex. « 4 alertes »).
"""
from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation
from typing import Any

_NOMBRE_RE = re.compile(r"\d+(?:[.,]\d+)?")
_NUMERO_LISTE_RE = re.compile(r"(?m)^\s*(?:[-*•]\s*)?\d{1,2}[.)]\s+")
_DATE_ISO_RE = re.compile(
    r"\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?"
)


def _normaliser(brut: str) -> str:
    try:
        valeur = Decimal(brut.replace(",", "."))
    except InvalidOperation:
        return brut.replace(",", ".").lstrip("0") or "0"
    if valeur == valeur.to_integral_value():
        return str(int(valeur))
    return format(valeur.normalize(), "f")


def nombres_de(texte: str, *, ignorer_numeros_de_liste: bool = False) -> dict[str, str]:
    """Nombres d'un texte → {forme normalisée: forme brute}. 35,0 = 35.0 = 35 ; 08 = 8."""
    if ignorer_numeros_de_liste:
        texte = _NUMERO_LISTE_RE.sub("", texte)
    trouves: dict[str, str] = {}
    for brut in _NOMBRE_RE.findall(texte):
        trouves.setdefault(_normaliser(brut), brut)
    return trouves


def _collecter(valeur: Any, autorises: set[str]) -> None:
    """Parcourt la source : nombres (valeurs, textes), tailles de listes, formes en pourcentage."""
    if isinstance(valeur, bool) or valeur is None:
        return
    if isinstance(valeur, (int, float)):
        autorises.add(_normaliser(repr(valeur)))
        if 0 < abs(valeur) <= 1:
            autorises.add(_normaliser(repr(round(valeur * 100, 1))))
            autorises.add(_normaliser(repr(round(valeur * 100))))
        return
    if isinstance(valeur, str):
        # Une date ISO autorise ses composantes (année, mois, jour, heure, minute : « le 10 octobre 2026 »)
        # mais pas ses fractions de seconde ni son fuseau, qui n'ont aucun sens à citer.
        for date in _DATE_ISO_RE.findall(valeur):
            for morceau in re.findall(r"\d+", date)[:5]:
                autorises.add(_normaliser(morceau))
        autorises.update(nombres_de(_DATE_ISO_RE.sub(" ", valeur)))
        return
    if isinstance(valeur, dict):
        for cle, sous in valeur.items():
            autorises.update(nombres_de(str(cle)))
            _collecter(sous, autorises)
        return
    if isinstance(valeur, (list, tuple)):
        autorises.add(str(len(valeur)))
        for sous in valeur:
            _collecter(sous, autorises)


def nombres_autorises(*sources: Any) -> set[str]:
    """Ensemble des nombres (normalisés) que la réponse a le droit de citer."""
    autorises: set[str] = set()
    for source in sources:
        _collecter(source, autorises)
    return autorises


def nombres_non_justifies(reponse: str, autorises: set[str]) -> list[str]:
    """Nombres de la réponse absents de la source, dans l'ordre d'apparition (forme brute)."""
    sans_dates = _DATE_ISO_RE.sub(" ", reponse)
    return [
        brut
        for normalise, brut in nombres_de(sans_dates, ignorer_numeros_de_liste=True).items()
        if normalise not in autorises
    ]
