"""
Job planifié (une fois par jour) : dégrade automatiquement en Gratuit les
organisations dont le paiement est en échec depuis plus de PERIODE_GRACE_JOURS
jours.

Fail-safe : si Stripe est injoignable pour vérifier le statut réel d'une
organisation, on NE LA DÉGRADE PAS — elle reste pour le prochain cycle. On ne
se fie jamais à la seule présence de payment_failed_at : on revérifie toujours
le statut réel de l'abonnement auprès de Stripe au moment du job, au cas où le
paiement aurait été régularisé entre-temps (webhook manqué ou en retard).
"""
import logging
from datetime import datetime, timedelta, timezone

import stripe
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.organisation import Organisation
from app.services.plan_catalog import PLAN_GRATUIT_ID
from app.services.stripe_webhook_service import journaliser_changement_plan

logger = logging.getLogger(__name__)

PERIODE_GRACE_JOURS = 7

# Statuts Stripe considérés comme "toujours en échec" : le client n'a toujours
# pas de moyen de paiement valide accepté. "canceled" n'apparaît pas ici — une
# résiliation complète est déjà gérée immédiatement par customer.subscription.deleted.
STATUTS_TOUJOURS_EN_ECHEC = {"past_due", "unpaid", "incomplete_expired"}


def _statut_abonnement_toujours_en_echec(subscription_id: str | None) -> bool | None:
    """
    True si l'abonnement est toujours en échec de paiement, False s'il a été
    régularisé, None si indéterminable (pas d'abonnement connu, Stripe
    injoignable...). L'appelant ne dégrade JAMAIS sur un résultat None.
    """
    if not subscription_id:
        return None
    try:
        sub = stripe.Subscription.retrieve(subscription_id)
        return sub.status in STATUTS_TOUJOURS_EN_ECHEC
    except stripe.error.StripeError as exc:
        logger.warning(f"[degradation auto] Statut Stripe non vérifiable pour {subscription_id} : {exc}")
        return None
    except Exception as exc:  # noqa: BLE001 — fail-safe : jamais de dégradation sur erreur inattendue
        logger.error(f"[degradation auto] Erreur inattendue en vérifiant {subscription_id} : {exc}")
        return None


def degrader_organisations_en_echec_de_paiement() -> None:
    """Point d'entrée du job quotidien (voir la planification dans app/main.py)."""
    if not settings.STRIPE_SECRET_KEY:
        logger.info("[degradation auto] STRIPE_SECRET_KEY non configuré, job ignoré")
        return

    stripe.api_key = settings.STRIPE_SECRET_KEY
    seuil = datetime.now(timezone.utc) - timedelta(days=PERIODE_GRACE_JOURS)

    db: Session = SessionLocal()
    try:
        candidats = db.query(Organisation).filter(
            Organisation.payment_failed_at.isnot(None),
            Organisation.payment_failed_at <= seuil,
        ).all()

        if not candidats:
            logger.info("[degradation auto] Aucune organisation en grâce expirée")
            return

        for org in candidats:
            toujours_en_echec = _statut_abonnement_toujours_en_echec(org.stripe_subscription_id)

            if toujours_en_echec is None:
                logger.warning(f"[degradation auto] Organisation {org.id} laissée en l'état (statut indéterminé)")
                continue

            if not toujours_en_echec:
                # Régularisé entre-temps : on lève la grâce sans dégrader.
                org.payment_failed_at = None
                db.commit()
                logger.info(f"[degradation auto] Organisation {org.id} régularisée, grâce levée sans dégradation")
                continue

            ancien_plan_id = org.plan_id
            org.plan_id = PLAN_GRATUIT_ID
            org.payment_failed_at = None
            if ancien_plan_id != PLAN_GRATUIT_ID:
                journaliser_changement_plan(
                    db, org.id, ancien_plan_id, PLAN_GRATUIT_ID,
                    "auto_downgrade", "Échec de paiement non résolu après 7 jours",
                )
            db.commit()
            logger.info(f"[degradation auto] Organisation {org.id} repassée en Gratuit (grâce expirée)")
    except Exception as exc:  # noqa: BLE001 — le job ne doit jamais planter le scheduler ni dégrader sur erreur
        logger.error(f"[degradation auto] Erreur inattendue, cycle abandonné sans dégradation supplémentaire : {exc}")
        db.rollback()
    finally:
        db.close()
