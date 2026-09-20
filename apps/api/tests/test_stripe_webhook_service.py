"""
Tests unitaires (logique pure, sans base réelle) du service de traitement des
événements webhook Stripe. La vérification bout-en-bout (signature, plan_id
qui change réellement en base, idempotence, dégradation automatique) a été
faite manuellement avec de vrais objets Stripe en mode test — voir le rapport
de la Phase 2. Ces tests couvrent le routage et les règles qui ne nécessitent
pas de base de données.
"""
import uuid
from datetime import datetime, timezone

from app.services import stripe_webhook_service as svc
from app.services.plan_catalog import STRIPE_PRICE_IDS


def test_price_id_to_plan_code_est_le_miroir_exact_du_catalogue():
    assert svc.PRICE_ID_TO_PLAN_CODE == {v: k for k, v in STRIPE_PRICE_IDS.items()}
    for code, price_id in STRIPE_PRICE_IDS.items():
        assert svc.PRICE_ID_TO_PLAN_CODE[price_id] == code


def test_traiter_evenement_type_inconnu_ignore_sans_erreur():
    appels = []

    class FakeDb:
        pass

    ok = svc.traiter_evenement(FakeDb(), "payment_method.attached", {"id": "pm_x"})
    assert ok is False


def test_traiter_evenement_dispatch_vers_le_bon_handler(monkeypatch):
    appels = []
    for event_type in list(svc.EVENT_HANDLERS):
        monkeypatch.setitem(svc.EVENT_HANDLERS, event_type, lambda db, obj, et=event_type: appels.append(et))

    for event_type in ["checkout.session.completed", "customer.subscription.updated",
                       "customer.subscription.deleted", "invoice.payment_failed"]:
        assert svc.traiter_evenement(object(), event_type, {}) is True

    assert appels == [
        "checkout.session.completed", "customer.subscription.updated",
        "customer.subscription.deleted", "invoice.payment_failed",
    ]


class _FakeQuery:
    def __init__(self, resultat):
        self._resultat = resultat

    def filter(self, *a, **k):
        return self

    def first(self):
        return self._resultat


class _FakeDb:
    """Stand-in minimal : une seule organisation, comme test_plan_service.py."""
    def __init__(self, organisation):
        self.organisation = organisation
        self.added = []

    def query(self, *a, **k):
        return _FakeQuery(self.organisation)

    def add(self, obj):
        self.added.append(obj)


class _FakeOrganisation:
    def __init__(self, **kwargs):
        self.id = uuid.uuid4()
        self.plan_id = uuid.uuid4()
        self.stripe_customer_id = "cus_x"
        self.stripe_subscription_id = "sub_x"
        self.stripe_subscription_status = "active"
        self.payment_failed_at = None
        for k, v in kwargs.items():
            setattr(self, k, v)


def test_invoice_payment_failed_renseigne_la_date_si_absente():
    org = _FakeOrganisation(payment_failed_at=None)
    db = _FakeDb(org)

    svc.gerer_invoice_payment_failed(db, {"subscription": "sub_x", "customer": "cus_x"})

    assert org.payment_failed_at is not None


def test_invoice_payment_failed_ne_reecrase_jamais_la_premiere_date():
    premiere_date = datetime(2026, 1, 1, tzinfo=timezone.utc)
    org = _FakeOrganisation(payment_failed_at=premiere_date)
    db = _FakeDb(org)

    svc.gerer_invoice_payment_failed(db, {"subscription": "sub_x", "customer": "cus_x"})

    assert org.payment_failed_at == premiere_date


def test_invoice_payment_failed_organisation_introuvable_ne_leve_pas():
    db = _FakeDb(organisation=None)
    # Ne doit pas lever d'exception, juste journaliser et ne rien faire.
    svc.gerer_invoice_payment_failed(db, {"subscription": "sub_inconnu", "customer": "cus_inconnu"})


def test_checkout_session_completed_sans_metadonnees_ignore_sans_erreur():
    db = _FakeDb(organisation=None)
    # Pas de metadata organisation_id/plan_code : ne doit rien faire ni lever.
    svc.gerer_checkout_session_completed(db, {"subscription": "sub_x"})
    assert db.added == []
