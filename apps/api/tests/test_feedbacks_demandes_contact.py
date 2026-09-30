"""
Demandes de contact (rappel client) — liste scopée par organisation/agence et
cloisonnement du PATCH .../traiter, jusque-là totalement absent (faille corrigée dans
cette même tâche : n'importe quel CX Manager ou Agency Manager authentifié pouvait
marquer traitée une DemandeContact hors de son périmètre en devinant/obtenant son UUID).

Base SQLite en mémoire (même pattern que test_issues.py) — seule façon d'exercer
réellement le routage et l'isolation sans toucher la base partagée.
"""
import os
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import UUID, uuid4

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-demandes-contact-tests-0123456789")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_current_active_user
from app.api.v1.endpoints import feedbacks
from app.db.session import Base, get_db
from app.models.agence import Agence
from app.models.demande_contact import DemandeContact
from app.models.enums import UserRole
from app.models.feedback import Feedback
from app.models.organisation import Organisation
from app.models.qr_code import QRCode
from app.models.utilisateur import Utilisateur

NOW = datetime.now(timezone.utc)


@pytest.fixture()
def ctx():
    engine = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(
        engine,
        tables=[Organisation.__table__, Agence.__table__, Utilisateur.__table__,
                QRCode.__table__, Feedback.__table__, DemandeContact.__table__],
    )
    Session = sessionmaker(bind=engine)
    db = Session()

    org_a = Organisation(id=uuid4(), nom="Org A", active=True)
    org_b = Organisation(id=uuid4(), nom="Org B", active=True)
    db.add_all([org_a, org_b])
    db.flush()

    agence_a = Agence(id=uuid4(), organisation_id=org_a.id, nom="Agence A", active=True)
    agence_b = Agence(id=uuid4(), organisation_id=org_b.id, nom="Agence B", active=True)
    db.add_all([agence_a, agence_b])
    db.flush()

    qr_a = QRCode(id=uuid4(), agence_id=agence_a.id, code="QR-A", url="http://test/a", actif=True)
    qr_b = QRCode(id=uuid4(), agence_id=agence_b.id, code="QR-B", url="http://test/b", actif=True)
    db.add_all([qr_a, qr_b])
    db.flush()

    # Org A : 2 feedbacks avec demande de contact (1 non traitée, 1 traitée).
    fb_a1 = Feedback(id=uuid4(), qr_code_id=qr_a.id, note=2, commentaire="A1 non traite", statut_traitement="nouveau", date_soumission=NOW)
    fb_a2 = Feedback(id=uuid4(), qr_code_id=qr_a.id, note=1, commentaire="A2 deja traite", statut_traitement="nouveau", date_soumission=NOW)
    db.add_all([fb_a1, fb_a2])
    db.flush()
    dc_a1 = DemandeContact(id=uuid4(), feedback_id=fb_a1.id, nom="Client A1", telephone="0100000001", souhaite_etre_rappele=True, traitee=False, date_demande=NOW)
    dc_a2 = DemandeContact(id=uuid4(), feedback_id=fb_a2.id, nom="Client A2", telephone="0100000002", souhaite_etre_rappele=True, traitee=True, date_demande=NOW)
    db.add_all([dc_a1, dc_a2])

    # Org B : 1 feedback avec demande de contact non traitée (donnees tres differentes de
    # A pour detecter facilement toute fuite).
    fb_b1 = Feedback(id=uuid4(), qr_code_id=qr_b.id, note=1, commentaire="B1 non traite", statut_traitement="nouveau", date_soumission=NOW)
    db.add(fb_b1)
    db.flush()
    dc_b1 = DemandeContact(id=uuid4(), feedback_id=fb_b1.id, nom="Client B1", telephone="0200000001", souhaite_etre_rappele=True, traitee=False, date_demande=NOW)
    db.add(dc_b1)
    db.commit()

    ids = SimpleNamespace(
        org_a=org_a.id, org_b=org_b.id, agence_a=agence_a.id, agence_b=agence_b.id,
        fb_a1=fb_a1.id, fb_a2=fb_a2.id, fb_b1=fb_b1.id,
        dc_a1=dc_a1.id, dc_a2=dc_a2.id, dc_b1=dc_b1.id,
    )
    db.close()

    def _db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app = FastAPI()
    app.include_router(feedbacks.router, prefix="/feedbacks")
    app.dependency_overrides[get_db] = _db

    users = {
        "cx_a": SimpleNamespace(id=uuid4(), role=UserRole.CX_MANAGER, active=True, agence_id=None, organisation_id=ids.org_a, nom="A", prenom="CX"),
        "am_a": SimpleNamespace(id=uuid4(), role=UserRole.AGENCY_MANAGER, active=True, agence_id=ids.agence_a, organisation_id=ids.org_a, nom="A", prenom="AM"),
        "cx_b": SimpleNamespace(id=uuid4(), role=UserRole.CX_MANAGER, active=True, agence_id=None, organisation_id=ids.org_b, nom="B", prenom="CX"),
        "am_b": SimpleNamespace(id=uuid4(), role=UserRole.AGENCY_MANAGER, active=True, agence_id=ids.agence_b, organisation_id=ids.org_b, nom="B", prenom="AM"),
    }
    client = TestClient(app)

    def call(user_key, method, path, **kw):
        app.dependency_overrides[get_current_active_user] = lambda: users[user_key]
        return getattr(client, method)(path, **kw)

    return SimpleNamespace(Session=Session, call=call, **vars(ids))


# ── Liste : scoping organisation / agence ─────────────────────────────────────────

def test_cx_a_liste_uniquement_org_a_non_traitees_par_defaut(ctx):
    r = ctx.call("cx_a", "get", "/feedbacks/demandes-contact")
    assert r.status_code == 200, r.text
    noms = {d["nom"] for d in r.json()}
    assert noms == {"Client A1"}  # A2 est déjà traitée (exclue par défaut), B jamais visible


def test_cx_a_avec_traitee_true_voit_a2(ctx):
    r = ctx.call("cx_a", "get", "/feedbacks/demandes-contact", params={"traitee": True})
    assert r.status_code == 200
    noms = {d["nom"] for d in r.json()}
    assert noms == {"Client A2"}


def test_am_a_ne_voit_que_son_agence_non_traitees(ctx):
    r = ctx.call("am_a", "get", "/feedbacks/demandes-contact")
    assert r.status_code == 200
    noms = {d["nom"] for d in r.json()}
    assert noms == {"Client A1"}
    assert "Client B1" not in noms


def test_am_a_avec_traitee_true_voit_a2_pas_b(ctx):
    r = ctx.call("am_a", "get", "/feedbacks/demandes-contact", params={"traitee": True})
    assert r.status_code == 200
    noms = {d["nom"] for d in r.json()}
    assert noms == {"Client A2"}


def test_cx_b_ne_voit_jamais_les_donnees_de_a(ctx):
    r = ctx.call("cx_b", "get", "/feedbacks/demandes-contact")
    assert r.status_code == 200
    noms = {d["nom"] for d in r.json()}
    assert noms == {"Client B1"}


def test_item_contient_le_contexte_feedback(ctx):
    r = ctx.call("cx_a", "get", "/feedbacks/demandes-contact")
    item = r.json()[0]
    assert item["feedback_id"] == str(ctx.fb_a1)
    assert item["feedback_note"] == 2
    assert item["feedback_commentaire"] == "A1 non traite"
    assert item["agence_nom"] == "Agence A"
    assert "date_demande" in item


# ── Faille corrigée : PATCH .../traiter doit vérifier l'accès ────────────────────

def test_am_b_ne_peut_pas_traiter_une_demande_de_a_403(ctx):
    """Avant la correction : aucune vérification, ce PATCH réussissait (200) pour
    n'importe quel utilisateur authentifié, quelle que soit l'agence/organisation."""
    r = ctx.call("am_b", "patch", f"/feedbacks/demandes-contact/{ctx.dc_a1}/traiter")
    assert r.status_code == 403, r.text

    # Vérifie qu'elle n'a PAS été modifiée malgré la tentative.
    db = ctx.Session()
    dc = db.query(DemandeContact).filter(DemandeContact.id == ctx.dc_a1).first()
    assert dc.traitee is False
    db.close()


def test_cx_b_ne_peut_pas_traiter_une_demande_de_a_403(ctx):
    r = ctx.call("cx_b", "patch", f"/feedbacks/demandes-contact/{ctx.dc_a1}/traiter")
    assert r.status_code == 403, r.text


def test_am_a_peut_traiter_une_demande_de_sa_propre_agence(ctx):
    r = ctx.call("am_a", "patch", f"/feedbacks/demandes-contact/{ctx.dc_a1}/traiter")
    assert r.status_code == 200, r.text

    db = ctx.Session()
    dc = db.query(DemandeContact).filter(DemandeContact.id == ctx.dc_a1).first()
    assert dc.traitee is True
    db.close()


def test_cx_a_ne_peut_pas_traiter_une_demande_hors_organisation(ctx):
    r = ctx.call("cx_a", "patch", f"/feedbacks/demandes-contact/{ctx.dc_b1}/traiter")
    # dc_b1 appartient à org B : le CX Manager de A doit être refusé.
    assert r.status_code == 403, r.text


def test_cx_a_peut_traiter_une_demande_de_son_organisation(ctx):
    r = ctx.call("cx_a", "patch", f"/feedbacks/demandes-contact/{ctx.dc_a1}/traiter")
    assert r.status_code == 200, r.text

    db = ctx.Session()
    dc = db.query(DemandeContact).filter(DemandeContact.id == ctx.dc_a1).first()
    assert dc.traitee is True
    db.close()
