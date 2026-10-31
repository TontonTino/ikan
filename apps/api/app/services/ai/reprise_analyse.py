"""
IA-01 — reprise automatique de l'analyse d'un avis dont l'analyse a échoué ou manque.

Contexte : POST /feedbacks lance l'analyse (moteur lexical local) juste après l'enregistrement de l'avis ; en cas d'exception elle est
avalée, l'avis reste enregistré SANS ligne dans `analyses_ia`. Ce job planifié reprend ces avis. Il ne touche jamais au chemin de la
réponse du formulaire client, et n'est appelé par AUCUNE route de lecture (GET).

Sans migration : l'état se déduit de l'absence d'analyse et de l'ancienneté de l'avis, et les échecs de reprise sont comptés dans
`historique_feedbacks` (type_evenement=TYPE_ECHEC_REPRISE), qui sert de mémoire persistante (elle survit aux redémarrages et aux mises
en veille). Ces événements techniques sont exclus du fil d'un avis et de l'activité d'agence (TYPES_TECHNIQUES).

Règles :
 - délai croissant : la tentative n+1 n'a lieu qu'après DELAI_BASE x 2^n depuis le dernier échec (5, 10, 20, 40, 80 minutes) ;
 - plafond : MAX_TENTATIVES échecs, puis l'avis n'est plus repris (état « indisponible », avis intact) ;
 - organisation désactivée : ses avis ne sont pas repris ;
 - idempotent : un avis déjà analysé n'est jamais sélectionné, une analyse existante n'est jamais doublée (unicité en base) ;
 - une seule requête de sélection par exécution, quel que soit le nombre d'avis, plafonnée à TAILLE_LOT ;
 - le moteur ne reçoit que le texte, la note et la catégorie de SON avis (voir analyse_service) : jamais de contact ni de nom.
"""
import json
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.agence import Agence
from app.models.analyse_ia import AnalyseIA
from app.models.feedback import Feedback
from app.models.historique_feedback import HistoriqueFeedback
from app.models.organisation import Organisation
from app.models.qr_code import QRCode
from app.services.ai.analyse_service import analyser_feedback

logger = logging.getLogger(__name__)
journal = logging.getLogger("ikan.analyse_ia")

MAX_TENTATIVES = 5
DELAI_BASE = timedelta(minutes=5)
INTERVALLE_JOB_MINUTES = 5
TAILLE_LOT = 200

TYPE_ECHEC_REPRISE = "analyse_reprise_echec"
# Événements techniques : écrits par ce job, jamais affichés dans le fil d'un avis ni dans l'activité d'une agence.
TYPES_TECHNIQUES = (TYPE_ECHEC_REPRISE,)

ETAT_DISPONIBLE = "disponible"
ETAT_EN_ATTENTE = "en_attente"
ETAT_INDISPONIBLE = "indisponible"


def delai_avant_tentative(echecs: int) -> timedelta:
    """Attente avant la tentative suivante quand `echecs` reprises ont déjà échoué (0 -> 5 min, 1 -> 10, 2 -> 20, 3 -> 40, 4 -> 80)."""
    return DELAI_BASE * (2 ** echecs)


# Au-delà, un avis sans analyse est présenté comme « indisponible » : toutes les reprises ont eu lieu (ou n'auront plus lieu).
DELAI_INDISPONIBLE = sum((delai_avant_tentative(n) for n in range(MAX_TENTATIVES)), timedelta()) + 2 * timedelta(minutes=INTERVALLE_JOB_MINUTES)


def _en_utc(date):
    if date is not None and date.tzinfo is None:
        return date.replace(tzinfo=timezone.utc)
    return date


def etat_analyse(feedback, maintenant: datetime | None = None) -> str:
    """État d'analyse d'un avis, sans requête : disponible / en_attente (reprises possibles) / indisponible."""
    if feedback.analyse_ia is not None:
        return ETAT_DISPONIBLE
    maintenant = maintenant or datetime.now(timezone.utc)
    soumission = _en_utc(feedback.date_soumission)
    if soumission is not None and maintenant - soumission >= DELAI_INDISPONIBLE:
        return ETAT_INDISPONIBLE
    return ETAT_EN_ATTENTE


def _selection(db: Session, maintenant: datetime):
    """UNE requête : avis sans analyse, d'organisation active, sous le plafond, dont le délai croissant est écoulé."""
    echecs = (
        select(
            HistoriqueFeedback.feedback_id.label("feedback_id"),
            func.count().label("nb"),
            func.max(HistoriqueFeedback.date_evenement).label("dernier"),
        )
        .where(HistoriqueFeedback.type_evenement == TYPE_ECHEC_REPRISE)
        .group_by(HistoriqueFeedback.feedback_id)
        .subquery()
    )
    nb = func.coalesce(echecs.c.nb, 0)
    reference = func.coalesce(echecs.c.dernier, Feedback.date_soumission)
    # Délai croissant exprimé en comparaisons simples (portable SQLite / PostgreSQL) : pour n échecs, la référence doit dater d'au moins
    # delai_avant_tentative(n).
    echeance = or_(*[and_(nb == n, reference <= maintenant - delai_avant_tentative(n)) for n in range(MAX_TENTATIVES)])
    requete = (
        select(Feedback.id, QRCode.agence_id, nb.label("echecs"))
        .select_from(Feedback)
        .join(QRCode, QRCode.id == Feedback.qr_code_id)
        .join(Agence, Agence.id == QRCode.agence_id)
        .join(Organisation, Organisation.id == Agence.organisation_id)
        .outerjoin(AnalyseIA, AnalyseIA.feedback_id == Feedback.id)
        .outerjoin(echecs, echecs.c.feedback_id == Feedback.id)
        .where(AnalyseIA.id.is_(None), Organisation.active.is_(True), nb < MAX_TENTATIVES, echeance)
        .order_by(Feedback.date_soumission)
        .limit(TAILLE_LOT)
    )
    return db.execute(requete).all()


def _journaliser_abandon(feedback_id, agence_id, tentatives: int) -> None:
    """Échec définitif : ligne JSON structurée, sans texte d'avis ni contact."""
    journal.error("%s", json.dumps({
        "evenement": "analyse_ia_abandonnee",
        "horodatage": datetime.now(timezone.utc).isoformat(),
        "feedback_id": str(feedback_id),
        "agence_id": str(agence_id) if agence_id else None,
        "tentatives": tentatives,
    }, ensure_ascii=False))


def reprendre_analyses(db: Session | None = None, maintenant: datetime | None = None) -> dict:
    """Reprend les avis sans analyse éligibles. Retourne {selectionnes, reussis, echecs, abandonnes}.
    Ne lève jamais : un avis en erreur n'empêche pas les suivants."""
    maintenant = maintenant or datetime.now(timezone.utc)
    ferme = False
    if db is None:
        db = SessionLocal()
        ferme = True
    bilan = {"selectionnes": 0, "reussis": 0, "echecs": 0, "abandonnes": 0}
    try:
        candidats = _selection(db, maintenant)
        bilan["selectionnes"] = len(candidats)
        for feedback_id, agence_id, echecs in candidats:
            try:
                analyser_feedback(feedback_id, db)
                analyse_creee = db.execute(select(AnalyseIA.id).where(AnalyseIA.feedback_id == feedback_id)).first() is not None
                if analyse_creee:
                    bilan["reussis"] += 1
                    continue
                tentative = echecs + 1
                db.add(HistoriqueFeedback(
                    feedback_id=feedback_id, agence_id=agence_id, auteur_nom="Système", auteur_role="systeme",
                    type_evenement=TYPE_ECHEC_REPRISE, details=f"Reprise de l'analyse : tentative {tentative}/{MAX_TENTATIVES} sans résultat",
                    date_evenement=maintenant,
                ))
                db.commit()
                bilan["echecs"] += 1
                if tentative >= MAX_TENTATIVES:
                    bilan["abandonnes"] += 1
                    _journaliser_abandon(feedback_id, agence_id, tentative)
            except Exception as exc:  # noqa: BLE001 — jamais le message : il pourrait contenir le texte de l'avis
                db.rollback()
                logger.error("Reprise de l'analyse : échec technique pour le feedback %s (%s)", feedback_id, type(exc).__name__)
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        logger.error("Reprise des analyses : échec de la sélection (%s)", type(exc).__name__)
    finally:
        if ferme:
            db.close()
    if bilan["selectionnes"]:
        logger.info("Reprise des analyses : %s", bilan)
    return bilan
