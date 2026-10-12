"""Fonctions partagées par les endpoints dashboard et statistiques.

Conventions de données (5B-2) :
- Une donnée absente reste absente : un taux calculé sur 0 observation vaut None
  (jamais 0.0), comme le statut "no_data" du moteur KPI (app/services/kpi/).
- Une évolution n'est calculée que si la base de comparaison existe : 0 → N n'est
  pas « +100 % », c'est « pas de comparaison » (None).
- L'écart entre deux TAUX s'exprime en points de pourcentage (« pts »), jamais en
  pourcentage relatif.
- Les périodes hebdomadaires utilisent une clé ISO « AAAA-Www » (année ISO), triable
  chronologiquement et sans fusion de semaines de deux années différentes.
"""
from datetime import datetime
from typing import Iterable, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.enums import SentimentType, UserRole
from app.models.utilisateur import Utilisateur
from app.schemas.dashboard import RepartitionForfaitItem, StatKPI


def _repartition_forfaits(db: Session, organisations: list) -> list[RepartitionForfaitItem]:
    """Nombre d'organisations par forfait (les forfaits sont listés, même à 0)."""
    from collections import Counter
    from app.models.plan import Plan

    plans = db.query(Plan).order_by(Plan.ordre).all()
    compteur = Counter(o.plan_id for o in organisations)
    return [RepartitionForfaitItem(code=p.code, nom=p.nom, nombre=compteur.get(p.id, 0)) for p in plans]


def _compter_utilisateurs_actifs(db: Session, role: UserRole | None = None) -> int:
    requete = db.query(func.count(Utilisateur.id)).filter(Utilisateur.active == True)  # noqa: E712
    if role is not None:
        requete = requete.filter(Utilisateur.role == role)
    return requete.scalar() or 0


def _period_label(jours: int) -> str:
    if jours == 1:
        return "Aujourd'hui"
    if jours in (7, 14, 30, 90):
        return f"{jours} derniers jours"
    if jours >= 365:
        return "Cette année"
    return f"{jours} derniers jours"


# ── Taux et évolutions ──────────────────────────────────────────────────────────

def _taux(numerateur: int, total: int) -> Optional[float]:
    """Pourcentage arrondi à 0,1, ou None s'il n'y a aucune observation (jamais 0.0)."""
    if not total:
        return None
    return round(numerateur / total * 100, 1)


def _calc_kpi_trend(
    curr: Optional[float],
    prev: Optional[float],
    is_pct_diff: bool = False,
    invert_positive: bool = False,
) -> tuple[str | None, bool]:
    """Évolution affichable entre deux valeurs, et sa valence (favorable ou non).

    - Volumes (is_pct_diff=False) : variation relative en %, uniquement si la base
      précédente est non nulle. 0 → 0 et 0 → N : (None, True), pas de comparaison.
      N → 0 : -100 % (baisse réelle).
    - Taux (is_pct_diff=True) : écart en POINTS (« -10 pts »), uniquement si les deux
      taux existent (None = période sans observation).
    """
    if curr is None or prev is None:
        return (None, True)

    if is_pct_diff:
        diff = round(curr - prev, 1)
        sign = "+" if diff >= 0 else ""
        pos = (diff >= 0) if not invert_positive else (diff <= 0)
        return (f"{sign}{diff} pts", pos)

    if prev == 0:
        return (None, True)
    diff_pct = round((curr - prev) / prev * 100, 1)
    sign = "+" if diff_pct >= 0 else ""
    pos = (diff_pct >= 0) if not invert_positive else (diff_pct <= 0)
    return (f"{sign}{diff_pct}%", pos)


def _kpi_taux(
    taux: Optional[float],
    taux_precedent: Optional[float],
    sous_titre: str,
    invert_positive: bool = False,
) -> StatKPI:
    """StatKPI d'un taux : status "no_data" et valeur None s'il n'y a aucune observation
    sur la période (jamais « 0% »), évolution en points si les deux périodes en ont."""
    evolution, positif = _calc_kpi_trend(taux, taux_precedent, is_pct_diff=True, invert_positive=invert_positive)
    if taux is None:
        return StatKPI(
            status="no_data",
            valeur=None,
            valeur_num=None,
            valeur_precedente=taux_precedent,
            evolution=None,
            is_positive=True,
            sous_titre=sous_titre,
        )
    return StatKPI(
        status="ok",
        valeur=f"{taux}%",
        valeur_num=taux,
        valeur_precedente=taux_precedent,
        evolution=evolution,
        is_positive=positif,
        sous_titre=sous_titre,
    )


# ── Avis négatif : UNE seule définition (celle des alertes sur avis) ────────────────────────────
#
# Un avis est négatif si sa note est faible (≤ NOTE_FAIBLE_MAX) OU si l'analyse IA lui attribue un sentiment négatif.
# Les deux critères sont indépendants et un avis qui les remplit tous deux compte UNE seule fois. Un sentiment
# manquant (analyse en attente, échouée ou absente) n'est jamais déduit positif ni neutre : seule la note décide alors.

NOTE_FAIBLE_MAX = 2


def a_note_faible(feedback) -> bool:
    return feedback.note <= NOTE_FAIBLE_MAX


def a_sentiment_negatif(analyse) -> bool:
    return analyse is not None and analyse.sentiment == SentimentType.NEGATIF


def est_negatif(feedback, analyse=None) -> bool:
    return a_note_faible(feedback) or a_sentiment_negatif(analyse)


def compter_negatifs(feedbacks, analyses_par_feedback: dict) -> int:
    """Nombre d'avis négatifs (chaque avis une seule fois) ; `analyses_par_feedback` : feedback.id -> AnalyseIA."""
    return sum(1 for f in feedbacks if est_negatif(f, analyses_par_feedback.get(f.id)))


# ── Cycle de traitement d'un avis : UNE seule définition pour toutes les pages et périodes ──────
#
# Deux dimensions DISTINCTES :
#  - le statut métier humain (feedbacks.statut_traitement) : nouveau → en_traitement → en_cours → resolu ;
#  - l'analyse IA, automatique : une ligne AnalyseIA existe et est exploitable.
# Une analyse IA terminée n'est JAMAIS une prise en charge humaine.

STATUT_NOUVEAU = "nouveau"
STATUT_RESOLU = "resolu"
# Statuts de traitement humain (les trois derniers sont hérités : aucun code ne les écrit aujourd'hui).
STATUTS_PRIS_EN_CHARGE = frozenset({"en_cours", "en_traitement", "recontacte", "resolu", "escalade", "ferme"})


def est_nouveau(feedback) -> bool:
    """Statut métier « nouveau », qu'une analyse IA existe ou non."""
    return getattr(feedback, "statut_traitement", STATUT_NOUVEAU) == STATUT_NOUVEAU


def est_pris_en_charge(feedback) -> bool:
    """Prise en charge HUMAINE : le statut a quitté « nouveau » (action explicite ou transition métier).
    Inclut les avis résolus (ils ont été pris en charge) ; ne dépend jamais de l'analyse IA."""
    return getattr(feedback, "statut_traitement", STATUT_NOUVEAU) in STATUTS_PRIS_EN_CHARGE


def est_resolu(feedback) -> bool:
    """Statut de résolution officiel (« resolu »)."""
    return getattr(feedback, "statut_traitement", STATUT_NOUVEAU) == STATUT_RESOLU


def est_analyse_ia(feedback, feedback_ids_analyses: set) -> bool:
    """Analyse IA terminée et exploitable : une ligne AnalyseIA existe pour cet avis.

    Le schéma ne persiste pas d'état d'analyse : l'absence de ligne signifie « en attente OU échouée »
    (indistinguables aujourd'hui) ; dans les deux cas l'avis n'est PAS déclaré analysé."""
    return feedback.id in feedback_ids_analyses


def _est_traite(feedback, feedback_ids_analyses: set | None = None) -> bool:
    """Ancien nom de « prise en charge ». L'analyse IA ne compte plus (le second paramètre est ignoré) :
    un avis analysé mais encore « nouveau » n'est pas traité."""
    return est_pris_en_charge(feedback)


def repartition_cycle(feedbacks, feedback_ids_analyses: set) -> dict:
    """Décompte du cycle de traitement d'une liste d'avis. Chaque avis compte UNE fois par dimension :
    nouveaux + pris_en_charge = total (la résolution est un sous-ensemble de la prise en charge)."""
    feedbacks = list(feedbacks)
    return {
        "total": len(feedbacks),
        "nouveaux": sum(1 for f in feedbacks if not est_pris_en_charge(f)),
        "pris_en_charge": sum(1 for f in feedbacks if est_pris_en_charge(f)),
        "resolus": sum(1 for f in feedbacks if est_resolu(f)),
        "analyses_ia": sum(1 for f in feedbacks if est_analyse_ia(f, feedback_ids_analyses)),
    }


# ── Semaines ISO ────────────────────────────────────────────────────────────────

def _cle_semaine_iso(dt: datetime) -> str:
    """Clé triable « AAAA-Www » basée sur l'année ISO (le 29/12/2025 est en 2026-W01)."""
    annee, semaine, _ = dt.isocalendar()
    return f"{annee}-W{semaine:02d}"


def _libelles_semaines(cles: Iterable[str], prefixe: str = "Sem") -> dict[str, str]:
    """Libellés lisibles des clés « AAAA-Www » : « Sem 9 », avec l'année ajoutée
    (« Sem 9 2026 ») uniquement quand la série couvre plusieurs années ISO."""
    cles = list(cles)
    annees = {c.split("-W")[0] for c in cles}
    plusieurs = len(annees) > 1
    libelles = {}
    for c in cles:
        annee, semaine = c.split("-W")
        libelle = f"{prefixe} {int(semaine)}"
        libelles[c] = f"{libelle} {annee}" if plusieurs else libelle
    return libelles
