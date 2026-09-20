"""
Webhook Stripe — endpoint public (aucun JWT), authentifié uniquement par la
signature Stripe (STRIPE_WEBHOOK_SECRET). Toute requête à la signature absente
ou invalide est rejetée en 400, sans exception : c'est la seule protection de
cet endpoint, elle n'est jamais contournée.

En cas d'erreur de traitement inattendue (organisation introuvable exceptée,
qui est gérée et journalisée sans lever), l'exception remonte au handler
global de app/main.py qui répond 500 — Stripe réessaiera automatiquement
l'événement plus tard. C'est le comportement fail-safe voulu ICI : contrairement
au reste du système (fail-open, ne bloque jamais), un webhook de facturation
DOIT signaler l'échec pour que Stripe retente, plutôt que de renvoyer 200 et
perdre silencieusement l'événement.
"""
import logging

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.config import settings
from app.models.stripe_event_traite import StripeEventTraite
from app.services.stripe_webhook_service import traiter_evenement

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/stripe")
async def recevoir_webhook_stripe(request: Request, db: Session = Depends(get_db)):
    if not settings.STRIPE_WEBHOOK_SECRET:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Webhook Stripe non configuré")

    payload = await request.body()
    signature = request.headers.get("stripe-signature")

    try:
        event = stripe.Webhook.construct_event(payload, signature, settings.STRIPE_WEBHOOK_SECRET)
    except (ValueError, stripe.error.SignatureVerificationError) as exc:
        logger.warning(f"[stripe webhook] Signature invalide ou payload malformé : {exc}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Signature invalide")

    event_id = event.id
    event_type = event.type

    # Idempotence : Stripe documente explicitement pouvoir livrer le même
    # événement plusieurs fois — rejouer un événement déjà traité ne doit
    # rien refaire, mais doit quand même répondre 200 (sinon Stripe réessaie
    # indéfiniment un événement qu'on a déjà correctement traité).
    deja_traite = db.query(StripeEventTraite).filter(StripeEventTraite.event_id == event_id).first()
    if deja_traite:
        logger.info(f"[stripe webhook] Événement {event_id} ({event_type}) déjà traité, ignoré")
        return {"received": True, "deja_traite": True}

    event_object = event.data.object.to_dict()
    geré = traiter_evenement(db, event_type, event_object)

    db.add(StripeEventTraite(event_id=event_id))
    db.commit()

    if not geré:
        logger.info(f"[stripe webhook] Événement {event_id} ({event_type}) reçu mais non suivi, ignoré")

    return {"received": True}
