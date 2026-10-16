"""
Part d'avis négatifs et thèmes (CX-05) : agrégats SQL, aucun avis n'est chargé en Python.

- « Négatif » : UNE seule définition, `dashboard_helpers.est_negatif` (note faible OU sentiment négatif), ici sous sa forme SQL
  `condition_negatif_sql`.
- Évolution : écart en POINTS entre la période et la précédente de même durée, calculé seulement si la période précédente compte au
  moins MIN_AVIS_COMPARAISON avis (sinon « données insuffisantes »).
- Thèmes : la casse et les espaces du thème (`lower(trim(...))`) sont normalisés À LA LECTURE ; les données en base ne sont jamais
  modifiées. Les avis sans thème (pas d'analyse ou thème vide) forment le thème « non_categorise ».
"""
from datetime import datetime
from typing import Iterable, Optional
from uuid import UUID

from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.api.v1.endpoints.dashboard_statistics_shared import THEME_LABELS_MAP
from app.models.agence import Agence
from app.models.analyse_ia import AnalyseIA
from app.models.enums import CriticiteType, SentimentType
from app.models.feedback import Feedback
from app.models.qr_code import QRCode
from app.schemas.dashboard import PartNegatifs, ThemeStatsDetail
from app.services.dashboard_helpers import _taux, condition_negatif_sql

MIN_AVIS_COMPARAISON = 5
MAX_THEMES = 20
NON_CATEGORISE = "non_categorise"


def normaliser_theme(valeur: Optional[str]) -> Optional[str]:
    """Clé canonique d'un thème (espaces et casse ignorés) ; None si vide."""
    propre = (valeur or "").strip().lower()
    return propre or None


def theme_normalise_sql():
    """Expression SQL de la clé canonique du thème ; les avis sans thème donnent « non_categorise »."""
    return func.coalesce(func.nullif(func.lower(func.trim(AnalyseIA.theme_principal)), ""), NON_CATEGORISE)


def libelle_theme(cle: str) -> str:
    if cle == NON_CATEGORISE:
        return "Non catégorisé"
    return THEME_LABELS_MAP.get(cle, cle.replace("_", " ").capitalize())


def construire_part_negatifs(negatifs: int, total: int, negatifs_prec: int, total_prec: int) -> PartNegatifs:
    part = _taux(negatifs, total)
    part_prec = _taux(negatifs_prec, total_prec)
    if part is None:
        statut, evolution = "sans_avis", None
    elif total_prec < MIN_AVIS_COMPARAISON:
        statut, evolution = "insuffisant", None
    else:
        statut, evolution = "ok", round(part - part_prec, 1)
    return PartNegatifs(
        negatifs=negatifs, total=total, part=part, total_precedent=total_prec,
        part_precedente=part_prec, evolution_pts=evolution, statut_evolution=statut,
    )


def _somme_negatifs():
    return func.coalesce(func.sum(case((condition_negatif_sql(), 1), else_=0)), 0)


def negatifs_par_agence(db: Session, agence_ids: Iterable[UUID], debut: datetime, fin: datetime, *, fin_incluse: bool) -> dict:
    """{agence_id: (négatifs, total)} sur [debut, fin] (ou [debut, fin[), une seule requête groupée. Agences sans avis absentes."""
    ids = list(agence_ids)
    if not ids:
        return {}
    requete = (
        db.query(QRCode.agence_id, func.count(Feedback.id), _somme_negatifs())
        .select_from(Feedback)
        .join(QRCode, Feedback.qr_code_id == QRCode.id)
        .outerjoin(AnalyseIA, AnalyseIA.feedback_id == Feedback.id)
        .filter(QRCode.agence_id.in_(ids), Feedback.date_soumission >= debut)
        .filter(Feedback.date_soumission <= fin if fin_incluse else Feedback.date_soumission < fin)
        .group_by(QRCode.agence_id)
    )
    return {agence_id: (int(neg), int(total)) for agence_id, total, neg in requete.all()}


def _base(db: Session, colonnes: list, criteres: list, debut: Optional[datetime], fin: Optional[datetime], *, fin_incluse: bool):
    """Avis du périmètre (`criteres`) et de la période, avec agence, QR code et analyse (outer join) — base de tous les agrégats."""
    requete = (
        db.query(*colonnes)
        .select_from(Feedback)
        .join(QRCode, Feedback.qr_code_id == QRCode.id)
        .join(Agence, QRCode.agence_id == Agence.id)
        .outerjoin(AnalyseIA, AnalyseIA.feedback_id == Feedback.id)
        .filter(*criteres)
    )
    if debut is not None:
        requete = requete.filter(Feedback.date_soumission >= debut)
    if fin is not None:
        requete = requete.filter(Feedback.date_soumission <= fin if fin_incluse else Feedback.date_soumission < fin)
    return requete


def _requete_themes(db: Session, criteres: list, debut: Optional[datetime], fin: Optional[datetime], *, fin_incluse: bool):
    cle = theme_normalise_sql().label("cle")
    requete = _base(
        db,
        [
            cle,
            func.count(Feedback.id),
            _somme_negatifs(),
            func.coalesce(func.sum(case((AnalyseIA.sentiment == SentimentType.POSITIF, 1), else_=0)), 0),
            func.coalesce(func.sum(case((AnalyseIA.sentiment == SentimentType.NEUTRE, 1), else_=0)), 0),
            func.coalesce(func.sum(case((AnalyseIA.sentiment == SentimentType.NEGATIF, 1), else_=0)), 0),
            func.count(func.distinct(QRCode.agence_id)),
        ],
        criteres, debut, fin, fin_incluse=fin_incluse,
    )
    return requete, cle


# Gravité : en cas d'égalité de fréquence, la plus grave l'emporte.
_RANG_GRAVITE = {CriticiteType.FAIBLE: 1, CriticiteType.MOYENNE: 2, CriticiteType.ELEVEE: 3, CriticiteType.CRITIQUE: 4}
NB_VERBATIMS = 3


def _gravites_frequentes(db: Session, criteres: list, debut, fin, cles: list[str]) -> dict[str, str]:
    """Gravité la plus fréquente de chaque thème retenu : UNE requête groupée (thème, gravité), égalité départagée par la plus grave."""
    cle = theme_normalise_sql().label("cle")
    lignes = (
        _base(db, [cle, AnalyseIA.criticite, func.count(Feedback.id)], criteres, debut, fin, fin_incluse=True)
        .filter(cle.in_(cles), AnalyseIA.criticite.isnot(None))
        .group_by(cle, AnalyseIA.criticite)
        .all()
    )
    meilleure: dict[str, tuple[int, int, str]] = {}
    for theme, criticite, nombre in lignes:
        valeur = criticite if isinstance(criticite, CriticiteType) else CriticiteType(criticite)
        score = (int(nombre), _RANG_GRAVITE[valeur], valeur.value)
        if theme not in meilleure or score[:2] > meilleure[theme][:2]:
            meilleure[theme] = score
    return {theme: score[2] for theme, score in meilleure.items()}


def _verbatims_recents(db: Session, criteres: list, debut, fin, cles: list[str]) -> dict[str, list[str]]:
    """Extraits les plus récents (NB_VERBATIMS au plus par thème retenu), UNE requête à fonction de fenêtre.

    Seul le texte du commentaire est lu : jamais le nom, le téléphone ni l'e-mail d'une demande de contact."""
    cle = theme_normalise_sql().label("cle")
    rang = func.row_number().over(partition_by=cle, order_by=(Feedback.date_soumission.desc(), Feedback.id.desc())).label("rang")
    sous_requete = (
        _base(db, [cle, Feedback.commentaire, rang], criteres, debut, fin, fin_incluse=True)
        .filter(cle.in_(cles), Feedback.commentaire.isnot(None), func.trim(Feedback.commentaire) != "")
        .subquery()
    )
    lignes = (
        db.query(sous_requete.c.cle, sous_requete.c.commentaire)
        .filter(sous_requete.c.rang <= NB_VERBATIMS)
        .order_by(sous_requete.c.cle, sous_requete.c.rang)
        .all()
    )
    extraits: dict[str, list[str]] = {}
    for theme, commentaire in lignes:
        extraits.setdefault(theme, []).append(commentaire.strip())
    return extraits


def agreger_themes(
    db: Session,
    criteres: list,
    *,
    debut: Optional[datetime],
    fin: Optional[datetime],
    debut_prec: Optional[datetime] = None,
    fin_prec: Optional[datetime] = None,
    inclure_non_categorise: bool,
    limite: int = MAX_THEMES,
    enrichir: bool = False,
) -> tuple[list[ThemeStatsDetail], int]:
    """
    Thèmes de TOUS les avis de la période (jamais un échantillon), les `limite` premiers (≤ MAX_THEMES) du plus au moins cité.
    Retourne (thèmes, total d'avis pris en compte) ; le total sert de dénominateur aux pourcentages et ne dépend pas du plafond.
    `criteres` : conditions SQL sur Feedback/QRCode/Agence/AnalyseIA — c'est l'appelant qui impose le périmètre (organisation, agence).
    """
    limite = max(1, min(limite, MAX_THEMES))
    requete, cle = _requete_themes(db, criteres, debut, fin, fin_incluse=True)
    if not inclure_non_categorise:
        requete = requete.filter(cle != NON_CATEGORISE)
    lignes = requete.group_by(cle).order_by(func.count(Feedback.id).desc(), cle.asc()).all()
    total = sum(int(ligne[1]) for ligne in lignes)
    retenues = lignes[:limite]

    precedent: dict[str, tuple[int, int]] = {}
    if debut_prec is not None and fin_prec is not None and retenues:
        req_prec, cle_prec = _requete_themes(db, criteres, debut_prec, fin_prec, fin_incluse=False)
        req_prec = req_prec.filter(cle_prec.in_([ligne[0] for ligne in retenues])).group_by(cle_prec)
        precedent = {ligne[0]: (int(ligne[2]), int(ligne[1])) for ligne in req_prec.all()}

    gravites: dict[str, str] = {}
    verbatims: dict[str, list[str]] = {}
    if enrichir and retenues:
        cles = [ligne[0] for ligne in retenues]
        gravites = _gravites_frequentes(db, criteres, debut, fin, cles)
        verbatims = _verbatims_recents(db, criteres, debut, fin, cles)

    themes: list[ThemeStatsDetail] = []
    for theme, nombre, negatifs, positifs, neutres, sent_negatifs, nb_agences in retenues:
        sentiments = {"neutre": int(neutres), "positif": int(positifs), "negatif": int(sent_negatifs)}
        predominant = max(sentiments.items(), key=lambda element: element[1])[0] if any(sentiments.values()) else "neutre"
        neg_prec, tot_prec = precedent.get(theme, (0, 0))
        themes.append(ThemeStatsDetail(
            theme=theme,
            label=libelle_theme(theme),
            count=int(nombre),
            pourcentage=round(int(nombre) / total * 100, 1) if total else 0.0,
            sentiment_predominant=predominant,
            negatifs=int(negatifs),
            agences_concernees=int(nb_agences) if enrichir else None,
            gravite_frequente=gravites.get(theme) if enrichir else None,
            verbatims=verbatims.get(theme, []),
            part_negatifs=construire_part_negatifs(int(negatifs), int(nombre), neg_prec, tot_prec) if debut_prec is not None else None,
        ))
    return themes, total
