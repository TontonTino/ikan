"""
Contrôles déterministes de COHÉRENCE d'une réponse générée — complément de app.agent.verification (nombres).

⚠ PORTÉE : ces contrôles détectent des cas précis et mécaniques ; ils ne garantissent pas la véracité de toutes
les phrases. Ils repèrent :
  - une formulation de proportion contredite par les chiffres de la MÊME phrase (« la moitié … (7 sur 8) ») ;
  - une fraction impossible (« 8 sur 7 ») ;
  - une capacité opérationnelle, une équipe ou un dispositif absents des données (« équipe de secours »,
    « agents supplémentaires », « RAPID-TEAM ») ;
  - une action recommandée sans « fondée sur : » ancré dans les données.
Ce qu'ils ne voient pas (cause avancée à tort, comparaison entre deux chiffres de phrases différentes, nuance)
reste du ressort du prompt et de la relecture humaine : YAM présente ses réponses comme des suggestions à valider.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Optional


def _sans_accents(texte: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", texte) if unicodedata.category(c) != "Mn")


def _normaliser(texte: str) -> str:
    return re.sub(r"\s+", " ", _sans_accents(texte).lower()).strip()


# ───────────────────────────── proportions ─────────────────────────────

# (motif sur le texte normalisé sans accents, libellé, borne basse incluse, borne haute incluse)
_QUALIFICATIFS: list[tuple[str, str, float, float]] = [
    (r"\btrois quarts\b", "trois quarts", 0.70, 0.80),
    (r"\bdeux tiers\b", "deux tiers", 0.60, 0.72),
    (r"\bquasi[- ]totalite\b", "la quasi-totalité", 0.85, 1.0),
    (r"\bgrande majorite\b", "la grande majorité", 0.65, 1.0),
    (r"\btotalite\b", "la totalité", 0.995, 1.0),
    (r"(?<!moins de la )(?<!plus de la )(?<!moins de )(?<!plus de )\bmoitie\b", "la moitié", 0.40, 0.60),
    (r"\bminorite\b", "une minorité", 0.0001, 0.4999),
    (r"\bquart\b", "un quart", 0.20, 0.30),
    (r"\btiers\b", "un tiers", 0.28, 0.38),
    (r"(?<!pas la )(?<!moins que la )\bmajorite\b", "la majorité", 0.5001, 1.0),
    (r"\baucun(?:e)?\b", "aucun", 0.0, 0.005),
]
_POURCENT_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*%")
_RATIO_RE = re.compile(r"\b(\d+)\s*(?:sur|des|/)\s*(\d+)\b")
_PHRASES_RE = re.compile(r"(?<=[.!?])\s+|\n+")


def _proportions_de(phrase: str) -> list[tuple[float, str]]:
    """Proportions chiffrées d'une phrase : pourcentages et fractions « N sur M » / « N des M »."""
    trouvees: list[tuple[float, str]] = []
    for m in _POURCENT_RE.finditer(phrase):
        trouvees.append((float(m.group(1).replace(",", ".")) / 100, f"{m.group(1)} %"))
    for m in _RATIO_RE.finditer(phrase):
        n, total = int(m.group(1)), int(m.group(2))
        if total > 0:
            trouvees.append((n / total, f"{n} sur {total}"))
    return trouvees


def incoherences_proportions(texte: str) -> list[str]:
    """
    Phrases dont le qualificatif de proportion contredit TOUTES les proportions chiffrées de la phrase, et
    fractions impossibles. Une phrase sans chiffre n'est pas jugée (on ne peut pas la vérifier).
    """
    problemes: list[str] = []
    for phrase in _PHRASES_RE.split(texte):
        phrase = phrase.strip()
        if not phrase:
            continue
        for m in _RATIO_RE.finditer(phrase):
            if int(m.group(2)) > 0 and int(m.group(1)) > int(m.group(2)):
                problemes.append(f"fraction impossible « {m.group(1)} sur {m.group(2)} » dans : « {phrase[:140]} »")
        proportions = _proportions_de(phrase)
        if not proportions:
            continue
        norm = _normaliser(phrase)
        for motif, libelle, bas, haut in _QUALIFICATIFS:
            if not re.search(motif, norm):
                continue
            if any(bas <= valeur <= haut for valeur, _ in proportions):
                break  # le qualificatif la plus spécifique est cohérent : on s'arrête là
            chiffres = ", ".join(texte_p for _, texte_p in proportions)
            problemes.append(f"« {libelle} » contredit les chiffres de la phrase ({chiffres}) : « {phrase[:140]} »")
            break
    return problemes


# ───────────────────────────── capacités inventées ─────────────────────────────

# Termes qui supposent une équipe, un effectif, un budget ou un dispositif dont les données ne parlent pas.
_CAPACITES = (
    "agents supplementaires", "agent supplementaire", "personnel supplementaire", "effectif supplementaire",
    "renfort", "renforts", "embaucher", "embauche", "recruter", "recrutement", "budget",
    "equipe dediee", "equipe d'intervention", "equipe de secours", "equipe rapide", "equipe d'urgence",
    "task force", "cellule de crise", "cellule", "comite", "brigade", "astreinte", "numero vert",
    "plateforme dediee", "application dediee", "systeme de ticketing", "ticketing",
)
# Nom d'équipe ou de dispositif en majuscules (« RAPID-TEAM », « TEAM-ACCUEIL ») : seuls les noms qui se terminent
# ou commencent par un mot d'équipe sont visés, pour ne pas prendre un sigle légitime (« ADSL-4G ») pour une invention.
_NOM_EN_MAJUSCULES_RE = re.compile(
    r"\b[A-Z0-9]+(?:[-‑][A-Z0-9]+)*[-‑](?:TEAM|FORCE|SQUAD|UNIT|CREW|CELL)\b|\b(?:TEAM|SQUAD)[-‑][A-Z0-9]+\b"
)


def capacites_inventees(texte: str, source: str) -> list[str]:
    """Termes de capacité/équipe/dispositif présents dans la réponse mais ABSENTS des données et de la question."""
    reponse_norm = _normaliser(texte)
    source_norm = _normaliser(source)
    trouves = []
    for terme in _CAPACITES:
        if re.search(rf"(?<![a-z]){re.escape(terme)}(?![a-z])", reponse_norm) and terme not in source_norm:
            trouves.append(terme)
    for nom in _NOM_EN_MAJUSCULES_RE.findall(texte):
        if _normaliser(nom) not in source_norm and nom not in trouves:
            trouves.append(nom)
    # « équipe de secours » contient « equipe » : on garde le terme le plus long seulement
    return [t for t in trouves if not any(t != u and t in u for u in trouves)]


# ───────────────────────────── recommandations justifiées ─────────────────────────────

_NIVEAU_RE = re.compile(r"^\W*(?:urgent|important|a surveiller)\b", re.IGNORECASE)
_PIED_RE = re.compile(r"^\W*(?:ces suggestions|ces recommandations|attention\b|dans ikan)", re.IGNORECASE)
_FONDEE_RE = re.compile(r"fond[ée]e?s?\s+sur\s*:?\s*(.*)$", re.IGNORECASE)


def _lignes_d_action(texte: str) -> list[str]:
    """Lignes d'action d'une réponse à niveaux (URGENT / IMPORTANT / À SURVEILLER), hors en-têtes et pied."""
    lignes: list[str] = []
    dans_un_niveau = False
    for brut in texte.split("\n"):
        ligne = brut.strip()
        if not ligne:
            continue
        norm = _sans_accents(ligne)
        if _NIVEAU_RE.match(norm):
            dans_un_niveau = True
            reste = re.sub(r"^\W*(?:urgent|important|a surveiller)\b[^:\n]*:?", "", norm, flags=re.IGNORECASE).strip(" -•*")
            if len(reste) > 12:  # action écrite sur la ligne même de l'en-tête
                lignes.append(ligne)
            continue
        if _PIED_RE.match(norm) or ligne.startswith("["):
            dans_un_niveau = False
            continue
        if dans_un_niveau:
            lignes.append(ligne)
    return lignes


def _ancrage(justification: str, source_norm: str) -> bool:
    """La justification contient au moins un mot (≥ 5 lettres) ou nombre qui figure dans les données."""
    for mot in re.findall(r"[a-z0-9]{5,}|\d+", _normaliser(justification)):
        if mot in source_norm:
            return True
    return False


def recommandations_sans_justification(texte: str, source: str) -> list[str]:
    """Actions de niveau sans « fondée sur : … » ancré dans les données (agence, thème, nombre, constat)."""
    source_norm = _normaliser(source)
    non_justifiees = []
    for ligne in _lignes_d_action(texte):
        m = _FONDEE_RE.search(ligne)
        if not m or len(m.group(1).strip()) < 6 or not _ancrage(m.group(1), source_norm):
            non_justifiees.append(ligne)
    return non_justifiees


def retirer_lignes(texte: str, lignes: list[str]) -> str:
    """Retire du texte les lignes données (comparaison sur la ligne nettoyée), sans toucher au reste."""
    a_retirer = {l.strip() for l in lignes}
    return "\n".join(l for l in texte.split("\n") if l.strip() not in a_retirer)
