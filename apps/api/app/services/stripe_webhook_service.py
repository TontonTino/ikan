"""
Traitement métier des événements webhook Stripe déjà authentifiés (signature
vérifiée par l'appelant) — met à jour plan_id/statut d'abonnement et journalise
dans changements_plan. Chaque handler est idempotent au niveau métier (rejouer
un événement déjà appliqué ne change rien de plus) en complément de
l'idempotence par event_id gérée par l'endpoint (table stripe_events_traites).
"""
import logging
from datetime import datetime, timezone

import stripe
from sqlalchemy.orm import Session

from app.models.organisation import Organisation
from app.models.changement_plan import ChangementPlan
from app.services.plan_catalog import PLANS, STRIPE_PRICE_IDS, PLAN_GRATUIT_ID

logger = logging.getLogger(__name__)

PRICE_ID_TO_PLAN_CODE = {price_id: code for code, price_id in STRIPE_PRICE_IDS.items()}


def _plan_id_pour_code(plan_code: str):
    entree = PLANS.get(plan_code)
    return entree[0] if entree else None


def journaliser_changement_plan(db: Session, organisation_id, ancien_plan_id, nouveau_plan_id, source: str, raison: str) -> None:
    db.add(ChangementPlan(
        organisation_id=organisation_id,
        ancien_plan_id=ancien_plan_id,
        nouveau_plan_id=nouveau_plan_id,
        raison=raison,
        modifie_par_id=None,
        source=source,
    ))


def _organisation_par_customer_ou_subscription(
    db: Session, customer_id: str | None, subscription_id: str | None
) -> Organisation | None:
    if subscription_id:
        org = db.query(Organisation).filter(Organisation.stripe_subscription_id == subscription_id).first()
        if org:
            return org
    if customer_id:
        return db.query(Organisation).filter(Organisation.stripe_customer_id == customer_id).first()
    return None


def gerer_checkout_session_completed(db: Session, session_obj: dict) -> None:
    """Paiement confirmé : associe l'abonnement et passe l'organisation au forfait acheté."""
    metadata = session_obj.get("metadata") or {}
    organisation_id = metadata.get("organisation_id")
    plan_code = metadata.get("plan_code")
    subscription_id = session_obj.get("subscription")

    if not organisation_id or not plan_code:
        logger.warning("[stripe webhook] checkout.session.completed sans métadonnées organisation_id/plan_code, ignoré")
        return

    org = db.query(Organisation).filter(Organisation.id == organisation_id).first()
    if not org:
        logger.error(f"[stripe webhook] Organisation {organisation_id} introuvable (checkout.session.completed)")
        return

    nouveau_plan_id = _plan_id_pour_code(plan_code)
    if nouveau_plan_id is None:
        logger.error(f"[stripe webhook] Forfait '{plan_code}' inconnu du catalogue, checkout.session.completed ignoré")
        return

    statut = None
    if subscription_id:
        try:
            statut = stripe.Subscription.retrieve(subscription_id).status
        except stripe.error.StripeError as exc:
            logger.warning(f"[stripe webhook] Statut abonnement {subscription_id} non récupérable : {exc}")

    ancien_plan_id = org.plan_id
    org.plan_id = nouveau_plan_id
    org.stripe_subscription_id = subscription_id
    org.stripe_subscription_status = statut or "active"
    org.payment_failed_at = None

    if ancien_plan_id != nouveau_plan_id:
        journaliser_changement_plan(db, org.id, ancien_plan_id, nouveau_plan_id, "stripe", "Paiement Stripe confirmé")


def gerer_subscription_updated(db: Session, subscription_obj: dict) -> None:
    """Resynchronise le statut, et le forfait si le prix de l'abonnement a changé côté Stripe."""
    subscription_id = subscription_obj.get("id")
    customer_id = subscription_obj.get("customer")
    statut = subscription_obj.get("status")

    org = _organisation_par_customer_ou_subscription(db, customer_id, subscription_id)
    if not org:
        logger.warning(f"[stripe webhook] Organisation introuvable pour l'abonnement {subscription_id}")
        return

    org.stripe_subscription_id = subscription_id
    org.stripe_subscription_status = statut

    items = (subscription_obj.get("items") or {}).get("data") or []
    price = items[0].get("price") if items else None
    price_id = price.get("id") if price else None
    plan_code = PRICE_ID_TO_PLAN_CODE.get(price_id)

    if statut == "active" and plan_code:
        nouveau_plan_id = _plan_id_pour_code(plan_code)
        if nouveau_plan_id and nouveau_plan_id != org.plan_id:
            ancien_plan_id = org.plan_id
            org.plan_id = nouveau_plan_id
            org.payment_failed_at = None
            journaliser_changement_plan(db, org.id, ancien_plan_id, nouveau_plan_id, "stripe", "Changement de forfait Stripe")


def gerer_subscription_deleted(db: Session, subscription_obj: dict) -> None:
    """Résiliation (ou fin des tentatives de relance côté Stripe) : repasse immédiatement en Gratuit."""
    subscription_id = subscription_obj.get("id")
    customer_id = subscription_obj.get("customer")

    org = _organisation_par_customer_ou_subscription(db, customer_id, subscription_id)
    if not org:
        logger.warning(f"[stripe webhook] Organisation introuvable pour la résiliation {subscription_id}")
        return

    ancien_plan_id = org.plan_id
    org.plan_id = PLAN_GRATUIT_ID
    org.stripe_subscription_status = "canceled"
    org.payment_failed_at = None

    if ancien_plan_id != PLAN_GRATUIT_ID:
        journaliser_changement_plan(db, org.id, ancien_plan_id, PLAN_GRATUIT_ID, "stripe", "Résiliation")


def gerer_invoice_payment_failed(db: Session, invoice_obj: dict) -> None:
    """
    Premier échec de paiement détecté : démarre la période de grâce (payment_failed_at).
    Ne modifie JAMAIS plan_id ici — c'est le rôle du job de dégradation automatique
    (Phase 2, point 4) après expiration de la grâce.
    """
    subscription_id = invoice_obj.get("subscription")
    if not subscription_id:
        parent = invoice_obj.get("parent") or {}
        subscription_id = (parent.get("subscription_details") or {}).get("subscription")
    customer_id = invoice_obj.get("customer")

    org = _organisation_par_customer_ou_subscription(db, customer_id, subscription_id)
    if not org:
        logger.warning(f"[stripe webhook] Organisation introuvable pour l'échec de paiement (abonnement {subscription_id})")
        return

    # Ne pas écraser une date de premier échec déjà enregistrée : la période de
    # grâce se compte depuis le PREMIER échec, pas depuis chaque relance Stripe.
    if org.payment_failed_at is None:
        org.payment_failed_at = datetime.now(timezone.utc)
        logger.info(f"[stripe webhook] Échec de paiement pour l'organisation {org.id} — période de grâce démarrée")


EVENT_HANDLERS = {
    "checkout.session.completed": gerer_checkout_session_completed,
    "customer.subscription.updated": gerer_subscription_updated,
    "customer.subscription.deleted": gerer_subscription_deleted,
    "invoice.payment_failed": gerer_invoice_payment_failed,
}


def traiter_evenement(db: Session, event_type: str, event_object: dict) -> bool:
    """Retourne True si l'événement était suivi (et traité), False s'il est ignoré (type non géré)."""
    handler = EVENT_HANDLERS.get(event_type)
    if handler is None:
        return False
    handler(db, event_object)
    return True
