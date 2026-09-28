"""
Calcul de la satisfaction glissante d'une agence et de sa persistance sous le seuil d'alerte.

Fonctions PURES (aucun accès base, testables avec de simples listes) utilisées par
app/api/v1/endpoints/alertes.py :

- Agency Manager : alerte IMMÉDIATE dès que la satisfaction glissante est sous le seuil (instantané).
- CX Manager : alerte seulement si la satisfaction est restée sous le seuil EN CONTINU pendant
  DUREE_PERSISTANCE_SEUIL_CX (48 h).

Aucun historique ni job planifié : les feedbacks sont immuables et horodatés, la satisfaction glissante à un
instant passé se recalcule donc directement. La valeur ne change qu'à des instants précis (un avis entre dans
la fenêtre, ou en sort) ; il suffit de l'évaluer à ces instants pour connaître son comportement sur toute la
période. Le seuil utilisé est le seuil ACTUEL de l'agence (appliqué rétroactivement).
"""
from datetime import datetime, timedelta, timezone
from typing import Sequence

# Fenêtre glissante de la satisfaction (identique au système d'alertes de seuil historique).
FENETRE_SATISFACTION = timedelta(days=7)
# Nombre minimal d'avis dans la fenêtre : en dessous, pas assez de données pour alerter.
MIN_AVIS_FENETRE = 3
# Durée pendant laquelle l'agence doit rester sous le seuil avant d'alerter le CX Manager (constante fixe).
DUREE_PERSISTANCE_SEUIL_CX = timedelta(hours=48)

_MICROSECONDE = timedelta(microseconds=1)

# (date de soumission, note 1-5)
Avis = tuple[datetime, int]
# (instant, nombre d'avis dans la fenêtre, satisfaction % ou None si moins de MIN_AVIS_FENETRE avis)
PointSatisfaction = tuple[datetime, int, "float | None"]


def en_utc(d: datetime) -> datetime:
    """Datetime « aware » en UTC (les bases de test renvoient des datetimes naïfs, PostgreSQL des aware)."""
    return d.replace(tzinfo=timezone.utc) if d.tzinfo is None else d.astimezone(timezone.utc)


def satisfaction_a(avis: Sequence[Avis], instant: datetime) -> "tuple[int, float | None]":
    """
    Satisfaction glissante à `instant` : part (en %) des notes >= 4 parmi les avis de [instant - 7 j, instant].
    Retourne (nombre d'avis dans la fenêtre, satisfaction) ; satisfaction = None s'il y a moins de
    MIN_AVIS_FENETRE avis. Borne basse INCLUSIVE, comme le système d'alertes de seuil historique.
    """
    debut = instant - FENETRE_SATISFACTION
    notes = [note for date, note in avis if debut <= date <= instant]
    if len(notes) < MIN_AVIS_FENETRE:
        return len(notes), None
    return len(notes), round(sum(1 for n in notes if n >= 4) / len(notes) * 100, 1)


def instants_de_changement(avis: Sequence[Avis], debut: datetime, fin: datetime) -> "list[datetime]":
    """
    Instants de [debut, fin] où la satisfaction glissante peut changer : les bornes, l'arrivée de chaque avis
    (à sa date) et sa sortie de la fenêtre (juste APRÈS date + 7 j, la borne étant inclusive).
    """
    instants = {debut, fin}
    for date, _ in avis:
        if debut < date <= fin:
            instants.add(date)
        sortie = date + FENETRE_SATISFACTION + _MICROSECONDE
        if debut < sortie <= fin:
            instants.add(sortie)
    return sorted(instants)


def historique_satisfaction(avis: Sequence[Avis], debut: datetime, fin: datetime) -> "list[PointSatisfaction]":
    """Satisfaction glissante évaluée à chaque instant de changement de [debut, fin] (l'« historique de calcul »)."""
    return [(t, *satisfaction_a(avis, t)) for t in instants_de_changement(avis, debut, fin)]


def sous_seuil_en_continu(
    avis: Sequence[Avis],
    seuil: float,
    fin: datetime,
    duree: timedelta = DUREE_PERSISTANCE_SEUIL_CX,
) -> "tuple[bool, list[PointSatisfaction]]":
    """
    True si la satisfaction est restée STRICTEMENT sous `seuil` à tous les instants de [fin - duree, fin]
    (un instant avec moins de MIN_AVIS_FENETRE avis compte comme « pas sous le seuil »).
    Retourne aussi l'historique de calcul, pour diagnostic.
    """
    points = historique_satisfaction(avis, fin - duree, fin)
    return all(taux is not None and taux < seuil for _, _, taux in points), points
