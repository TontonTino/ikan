"""
Calculs faits par le CODE (jamais par le LLM) et transmis dans le champ `calculs_verifies` du JSON de prompt.

Origine : un modèle de langage qui calcule lui-même des pourcentages se trompe (réponse réelle observée :
« 18 % / 18 = 100 % »). Les valeurs ci-dessous sont déterministes ; le prompt interdit au modèle de recalculer.
"""
from __future__ import annotations

from collections import Counter
from typing import Any, Optional

_SEUIL_STABLE = 0.02  # variation de sentiment moyen sous laquelle on parle de « stable »


def pourcentage(partie: int, total: int) -> Optional[float]:
    """Pourcentage arrondi à 1 décimale, ou None si le total est nul (jamais de division par zéro)."""
    if not total:
        return None
    return round(100 * partie / total, 1)


def qualifier_proportion(pct: Optional[float]) -> Optional[str]:
    """
    Formulation française d'une proportion, choisie PAR LE CODE : le modèle la reprend telle quelle au lieu de
    l'inférer (réponse réelle observée : « la moitié des incidents critiques (7 sur 8) »). Les seuils sont ceux
    que contrôle app.agent.coherence : une formulation fournie ici n'est jamais jugée contradictoire.
    """
    if pct is None:
        return None
    if pct >= 99.95:
        return "la totalité"
    if pct >= 75:
        return "la grande majorité"
    if pct > 55:
        return "la majorité"
    if pct >= 45:
        return "environ la moitié"
    if pct >= 30:
        return "une part significative"
    if pct >= 15:
        return "une minorité"
    if pct > 0:
        return "une faible part"
    return "aucun"


def _part(nombre: int, total: int) -> dict[str, Any]:
    pct = pourcentage(nombre, total)
    return {"nombre": nombre, "pourcentage": pct, "formulation": qualifier_proportion(pct)}


def repartition_themes(par_theme: dict[str, int]) -> dict[str, Any]:
    total = sum(par_theme.values())
    return {
        "total_feedbacks": total,
        "themes": [
            {"theme": theme, **_part(nombre, total)}
            for theme, nombre in sorted(par_theme.items(), key=lambda kv: kv[1], reverse=True)
        ],
    }


def resume_periode(agregats: dict[str, Any]) -> dict[str, Any]:
    total = agregats.get("total", 0)
    return {
        "part_critiques": _part(agregats.get("critiques", 0), total),
        "part_elevees": _part(agregats.get("elevees", 0), total),
        "top_themes": [{"theme": t["theme"], **_part(t["count"], total)} for t in agregats.get("top_themes", [])],
    }


def alertes(alertes_liste: list[dict[str, Any]]) -> dict[str, Any]:
    total = len(alertes_liste)
    par_agence = Counter(a.get("agence_nom") for a in alertes_liste if a.get("agence_nom"))
    par_theme = Counter(a.get("theme_principal") for a in alertes_liste if a.get("theme_principal"))
    par_criticite = Counter(a.get("criticite") for a in alertes_liste if a.get("criticite"))
    return {
        "nombre_alertes": total,
        "par_criticite": {niveau: _part(n, total) for niveau, n in par_criticite.items()},
        "par_agence": [{"agence_nom": nom, **_part(n, total)} for nom, n in par_agence.most_common()],
        "par_theme": [{"theme": nom, **_part(n, total)} for nom, n in par_theme.most_common()],
    }


def evolution(periodes: list[dict[str, Any]]) -> dict[str, Any]:
    """Tendance du sentiment moyen entre la première et la dernière période AVEC données."""
    avec_donnees = [p for p in periodes if p.get("sentiment_moyen") is not None]
    sans_donnees = [p["periode"] for p in periodes if p.get("sentiment_moyen") is None]
    resultat: dict[str, Any] = {"periodes_sans_donnees": sans_donnees}
    if len(avec_donnees) < 2:
        resultat["sens"] = "indeterminee"
        resultat["raison"] = "moins de deux périodes avec des feedbacks : aucune tendance ne peut être établie"
        return resultat
    premiere, derniere = avec_donnees[0], avec_donnees[-1]
    variation = round(derniere["sentiment_moyen"] - premiere["sentiment_moyen"], 3)
    if abs(variation) < _SEUIL_STABLE:
        sens = "stable"
    else:
        sens = "hausse" if variation > 0 else "baisse"
    resultat.update({
        "sens": sens,
        "variation_sentiment_moyen": variation,
        "de_periode": premiere["periode"],
        "a_periode": derniere["periode"],
        "feedbacks_premiere_periode": premiere.get("nombre_feedbacks"),
        "feedbacks_derniere_periode": derniere.get("nombre_feedbacks"),
    })
    return resultat
