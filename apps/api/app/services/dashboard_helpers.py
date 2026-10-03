"""Fonctions partag?es par les endpoints dashboard et statistiques."""
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.enums import UserRole
from app.models.utilisateur import Utilisateur
from app.schemas.dashboard import RepartitionForfaitItem


def _repartition_forfaits(db: Session, organisations: list) -> list[RepartitionForfaitItem]:
    """Nombre d'organisations par forfait (les forfaits sont list?s, m?me ? 0)."""
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
        return "Cette ann?e"
    return f"{jours} derniers jours"


def _calc_kpi_trend(
    curr: float, prev: float, is_pct_diff: bool = False, invert_positive: bool = False
) -> tuple[str | None, bool]:
    """Calcule une variation de volume ou de points de pourcentage."""
    if prev == 0:
        if curr > 0:
            return ("+100%", not invert_positive)
        return (None, True)

    if is_pct_diff:
        diff = round(curr - prev, 1)
        sign = "+" if diff >= 0 else ""
        pos = (diff >= 0) if not invert_positive else (diff <= 0)
        return (f"{sign}{diff}%", pos)

    diff_pct = round((curr - prev) / prev * 100, 1)
    sign = "+" if diff_pct >= 0 else ""
    pos = (diff_pct >= 0) if not invert_positive else (diff_pct <= 0)
    return (f"{sign}{diff_pct}%", pos)
