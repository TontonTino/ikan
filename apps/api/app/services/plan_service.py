"""
Service de vérification des forfaits — FAIL-OPEN par conception.

Règle non négociable : si la vérification échoue pour une raison quelconque
(organisation introuvable, plan introuvable, erreur DB ou réseau), la
fonctionnalité est AUTORISÉE. Le risque accepté est « une fonctionnalité payante
s'exécute par erreur », jamais « un feedback légitime n'est pas traité ».

Les lectures passent par une connexion SÉPARÉE de la session de l'appelant : une
erreur SQL ici ne peut pas invalider (transaction avortée) la session qui
persiste l'analyse du feedback.
"""
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import text

from app.services.plan_catalog import (
    FEATURES_GATEES,
    FEATURES_TOUJOURS_ACTIVES,
    FEATURE_LIBELLES,
)

logger = logging.getLogger(__name__)

_CACHE_KEY = "_plan_features_cache"


def _lire_feature(organisation_id: uuid.UUID, feature_code: str) -> bool | None:
    """
    Interroge la base. Retourne True/False si le plan de l'organisation est
    connu, None si la situation est indéterminée (organisation ou plan absent,
    plan sans aucune fonctionnalité configurée) — l'appelant traite None en
    fail-open. Peut lever : l'appelant capture.
    """
    from app.db.session import engine

    with engine.connect() as conn:
        row = conn.execute(
            text("""
                SELECT o.plan_id,
                       (SELECT count(*) FROM plan_features pf
                         WHERE pf.plan_id = o.plan_id AND pf.feature_code = :code) AS a_la_feature,
                       (SELECT count(*) FROM plan_features pf
                         WHERE pf.plan_id = o.plan_id) AS total_features
                  FROM organisations o
                 WHERE o.id = :org
            """),
            {"org": organisation_id, "code": feature_code},
        ).first()

    if row is None or row.plan_id is None or row.total_features == 0:
        return None
    return row.a_la_feature > 0


def organisation_a_la_fonctionnalite(
    organisation_id: uuid.UUID | None,
    feature_code: str,
    db=None,
) -> bool:
    """
    True si l'organisation a accès à la fonctionnalité. Ne lève JAMAIS.

    `db` (optionnel) sert uniquement de support de cache : le résultat est mémorisé
    dans `db.info`, donc au plus une requête par (organisation, fonctionnalité)
    pendant la vie de la session/requête.
    """
    # Fonctionnalités de base : inconditionnelles, avant tout accès DB ou cache.
    if feature_code in FEATURES_TOUJOURS_ACTIVES:
        return True

    try:
        # Code inconnu du catalogue gaté, ou organisation non identifiée : autorisé.
        if feature_code not in FEATURES_GATEES or organisation_id is None:
            return True

        cache = None
        if db is not None:
            cache = db.info.setdefault(_CACHE_KEY, {})
            cle = (str(organisation_id), feature_code)
            if cle in cache:
                return cache[cle]

        resultat = _lire_feature(organisation_id, feature_code)
        autorise = True if resultat is None else bool(resultat)

        if cache is not None:
            cache[cle] = autorise
        return autorise
    except Exception as exc:  # noqa: BLE001 — fail-open volontaire
        logger.error(
            "[plan_service] Vérification '%s' impossible pour l'organisation %s, "
            "autorisée par défaut (fail-open) : %s",
            feature_code, organisation_id, exc,
        )
        return True


def organisation_du_feedback(feedback) -> uuid.UUID | None:
    """Organisation d'un feedback (feedback → QR code → agence). None si indéterminable."""
    try:
        return feedback.qr_code.agence.organisation_id
    except Exception as exc:  # noqa: BLE001
        logger.error("[plan_service] Organisation du feedback %s introuvable : %s",
                     getattr(feedback, "id", None), exc)
        return None


def utilisation_organisation(db, organisation_id: uuid.UUID) -> dict:
    """
    Plan, quotas réels (comptés en temps réel) et statut des fonctionnalités
    gatées d'une organisation. Purement informatif : ne bloque jamais rien.
    """
    from app.models.plan import Plan, PlanFeature
    from app.models.organisation import Organisation
    from app.models.agence import Agence
    from app.models.utilisateur import Utilisateur
    from app.models.enums import UserRole
    from app.models.feedback import Feedback
    from app.models.qr_code import QRCode

    org = db.query(Organisation).filter(Organisation.id == organisation_id).first()
    plan = db.query(Plan).filter(Plan.id == org.plan_id).first() if org else None

    nb_cx = db.query(Utilisateur).filter(
        Utilisateur.organisation_id == organisation_id,
        Utilisateur.role == UserRole.CX_MANAGER,
        Utilisateur.active == True,  # noqa: E712
    ).count()
    nb_agences = db.query(Agence).filter(
        Agence.organisation_id == organisation_id, Agence.active == True  # noqa: E712
    ).count()

    maintenant = datetime.now(timezone.utc)
    debut_mois = maintenant.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    nb_feedbacks = (
        db.query(Feedback)
        .join(QRCode, Feedback.qr_code_id == QRCode.id)
        .join(Agence, QRCode.agence_id == Agence.id)
        .filter(Agence.organisation_id == organisation_id, Feedback.date_soumission >= debut_mois)
        .count()
    )

    codes_actifs = set()
    if plan:
        codes_actifs = {
            f.feature_code for f in db.query(PlanFeature).filter(PlanFeature.plan_id == plan.id).all()
        }

    return {
        "plan": {"code": plan.code, "nom": plan.nom} if plan else None,
        "cx_managers": {"actuel": nb_cx, "max": plan.max_cx_managers if plan else None},
        "agences": {"actuel": nb_agences, "max": plan.max_agences if plan else None},
        "feedbacks_ce_mois": {"actuel": nb_feedbacks, "max": plan.max_feedbacks_mois if plan else None},
        "fonctionnalites": [
            {
                "code": code,
                "libelle": FEATURE_LIBELLES[code],
                # Sans plan connu : tout apparaît actif (cohérent avec le fail-open).
                "actif": True if plan is None else (code in FEATURES_TOUJOURS_ACTIVES or code in codes_actifs),
            }
            for code in FEATURES_GATEES
        ],
    }
