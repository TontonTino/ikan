"""
Recherche texte dans les avis : casse et accents ignorés, jokers LIKE échappés, aucune concaténation SQL.

Portable (PostgreSQL en production, SQLite en test) et sans extension : la normalisation côté base est une chaîne de
`replace()` puis `lower()`, et la même table sert à normaliser la saisie côté Python.
"""
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import String, func
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.sql.expression import FunctionElement

LONGUEUR_MAX_RECHERCHE = 100
ECHAPPEMENT = "\\"

# Repliement du français courant, appliqué avant `lower()` (aucune dépendance à la locale de la base pour « É » → « e »).
_MINUSCULES = {
    "à": "a", "â": "a", "ä": "a", "ç": "c", "é": "e", "è": "e", "ê": "e", "ë": "e",
    "î": "i", "ï": "i", "ô": "o", "ö": "o", "ù": "u", "û": "u", "ü": "u", "œ": "oe", "æ": "ae",
}
_TABLE = {**_MINUSCULES, **{k.upper(): v for k, v in _MINUSCULES.items()}, "’": "'", "‘": "'"}
# Version courte pour les moteurs sans `translate()` (SQLite des tests) : ils refusent plus de ~30 `replace()` imbriqués.
_TABLE_COURTE = {**_MINUSCULES, "’": "'", **{c: _MINUSCULES[c.lower()] for c in "ÉÈÊÀÇŒ"}}


def normaliser_texte(texte: str) -> str:
    for source, cible in _TABLE.items():
        texte = texte.replace(source, cible)
    return texte.lower()


class NormaliserTexte(FunctionElement):
    """Expression SQL équivalente à `normaliser_texte` (une colonne NULL reste NULL : elle ne correspond jamais)."""
    type = String()
    name = "normaliser_texte"
    inherit_cache = True


def _chaine_replace(colonne, table):
    for source, cible in table.items():
        colonne = func.replace(colonne, source, cible)
    return colonne


@compiles(NormaliserTexte)
def _normaliser_generique(element, compiler, **kw):
    colonne = list(element.clauses)[0]
    return compiler.process(func.lower(_chaine_replace(colonne, _TABLE_COURTE)), **kw)


def normaliser_sql(colonne):
    return NormaliserTexte(colonne)


def motif_contient(recherche: str) -> str:
    """Motif LIKE « contient » : \\, % et _ de la saisie sont échappés, donc cherchés littéralement."""
    brut = normaliser_texte(recherche)
    for car in (ECHAPPEMENT, "%", "_"):
        brut = brut.replace(car, ECHAPPEMENT + car)
    return f"%{brut}%"


def valider_recherche(q: Optional[str]) -> Optional[str]:
    """None si la recherche est absente ou vide ; 422 si trop longue ou contenant un caractère de contrôle (un NUL fait
    d'ailleurs échouer PostgreSQL)."""
    if q is None:
        return None
    recherche = q.strip()
    if len(recherche) > LONGUEUR_MAX_RECHERCHE:
        raise HTTPException(status_code=422, detail=f"La recherche ne peut pas dépasser {LONGUEUR_MAX_RECHERCHE} caractères.")
    if any(ord(c) < 32 or ord(c) == 127 for c in recherche):
        raise HTTPException(status_code=422, detail="La recherche contient un caractère non autorisé.")
    return recherche or None


# ── PostgreSQL : expression régulière à classes d'accents ────────────────────────────────────────────────────────
# Mesuré sur 100 000 avis d'une agence : `translate()` + `lower()` ≈ 2,2 s, `~*` avec classes d'accents ≈ 0,2 s, et plus
# juste (« agreable » trouve « agréable »). Le motif est construit caractère par caractère : tout caractère de la saisie
# est échappé ou placé dans une classe fixe, jamais interprété (pas de quantificateur, donc pas de motif catastrophique),
# et il est transmis comme paramètre lié.
_VARIANTES = {
    "a": "aàâäÀÂÄ", "c": "cçÇ", "e": "eéèêëÉÈÊË", "i": "iîïÎÏ", "o": "oôöÔÖ", "u": "uùûüÙÛÜ",
}
_SPECIAUX_REGEX = set(ECHAPPEMENT + ".^$|?*+()[]{}")


def motif_regex(recherche: str) -> str:
    texte = normaliser_texte(recherche)
    morceaux, i = [], 0
    while i < len(texte):
        deux = texte[i:i + 2]
        if deux in ("oe", "ae"):                       # « œ » et « æ » s'écrivent oe / ae dans la saisie normalisée
            morceaux.append(f"(?:{deux}|{'œ' if deux == 'oe' else 'æ'})")
            i += 2
            continue
        car = texte[i]
        if car in _VARIANTES:
            morceaux.append(f"[{_VARIANTES[car]}]")
        elif car == "'":
            morceaux.append("['’‘]")
        elif car in _SPECIAUX_REGEX:
            morceaux.append("\\" + car)
        else:
            morceaux.append(car)
        i += 1
    return "".join(morceaux)


def condition_recherche(dialecte: str, colonne, recherche: str):
    """Condition « la colonne contient `recherche` » (casse et accents ignorés), adaptée au moteur."""
    if dialecte == "postgresql":
        return colonne.op("~*")(motif_regex(recherche))
    return normaliser_sql(colonne).like(motif_contient(recherche), escape=ECHAPPEMENT)
