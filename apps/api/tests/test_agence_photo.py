"""
PATCH /agences/{agence_id}/photo — endpoint étroit (photo uniquement), ouvert au CX
Manager ET à l'Agency Manager (contrairement à update_agence, réservé au CX Manager/Admin),
cloisonné par _check_agence_access comme tous les autres endpoints de ce fichier.

Base SQLite en mémoire (même pattern que test_issues.py).
"""
import os
from types import SimpleNamespace
from uuid import uuid4

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-agence-photo-tests-0123456789")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_current_active_user
from app.api.v1.endpoints import agences
from app.db.session import Base, get_db
from app.models.agence import Agence
from app.models.enums import UserRole
from app.models.organisation import Organisation
from app.models.plan import Plan
from app.models.qr_code import QRCode
from app.models.utilisateur import Utilisateur

PHOTO_BASE64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="


@pytest.fixture()
def ctx():
    engine = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(
        engine,
        tables=[Plan.__table__, Organisation.__table__, Agence.__table__, QRCode.__table__, Utilisateur.__table__],
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
    db.commit()

    ids = SimpleNamespace(org_a=org_a.id, org_b=org_b.id, agence_a=agence_a.id, agence_b=agence_b.id)
    db.close()

    def _db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app = FastAPI()
    app.include_router(agences.router, prefix="/agences")
    app.dependency_overrides[get_db] = _db

    users = {
        "cx_a": SimpleNamespace(id=uuid4(), role=UserRole.CX_MANAGER, active=True, agence_id=None, organisation_id=ids.org_a),
        "am_a": SimpleNamespace(id=uuid4(), role=UserRole.AGENCY_MANAGER, active=True, agence_id=ids.agence_a, organisation_id=ids.org_a),
        "am_b": SimpleNamespace(id=uuid4(), role=UserRole.AGENCY_MANAGER, active=True, agence_id=ids.agence_b, organisation_id=ids.org_b),
        "cx_b": SimpleNamespace(id=uuid4(), role=UserRole.CX_MANAGER, active=True, agence_id=None, organisation_id=ids.org_b),
    }
    client = TestClient(app)

    def call(user_key, method, path, **kw):
        app.dependency_overrides[get_current_active_user] = lambda: users[user_key]
        return getattr(client, method)(path, **kw)

    return SimpleNamespace(Session=Session, call=call, **vars(ids))


def test_agency_manager_met_a_jour_la_photo_de_sa_propre_agence(ctx):
    r = ctx.call("am_a", "patch", f"/agences/{ctx.agence_a}/photo", json={"photo": PHOTO_BASE64})
    assert r.status_code == 200, r.text
    assert r.json()["photo"] == PHOTO_BASE64

    db = ctx.Session()
    agence = db.query(Agence).filter(Agence.id == ctx.agence_a).first()
    assert agence.photo == PHOTO_BASE64
    db.close()


def test_agency_manager_refuse_sur_une_autre_agence(ctx):
    r = ctx.call("am_a", "patch", f"/agences/{ctx.agence_b}/photo", json={"photo": PHOTO_BASE64})
    assert r.status_code == 403, r.text

    db = ctx.Session()
    agence = db.query(Agence).filter(Agence.id == ctx.agence_b).first()
    assert agence.photo is None
    db.close()


def test_cx_manager_met_a_jour_une_agence_de_son_organisation(ctx):
    r = ctx.call("cx_a", "patch", f"/agences/{ctx.agence_a}/photo", json={"photo": PHOTO_BASE64})
    assert r.status_code == 200, r.text
    assert r.json()["photo"] == PHOTO_BASE64


def test_cx_manager_refuse_hors_de_son_organisation(ctx):
    r = ctx.call("cx_a", "patch", f"/agences/{ctx.agence_b}/photo", json={"photo": PHOTO_BASE64})
    assert r.status_code == 403, r.text


def test_retrait_de_la_photo_avec_null(ctx):
    r1 = ctx.call("am_a", "patch", f"/agences/{ctx.agence_a}/photo", json={"photo": PHOTO_BASE64})
    assert r1.status_code == 200
    r2 = ctx.call("am_a", "patch", f"/agences/{ctx.agence_a}/photo", json={"photo": None})
    assert r2.status_code == 200
    assert r2.json()["photo"] is None


def test_ne_touche_a_aucun_autre_champ(ctx):
    """L'endpoint est étroit : seul `photo` change, le reste de l'agence est intact."""
    r = ctx.call("am_a", "patch", f"/agences/{ctx.agence_a}/photo", json={"photo": PHOTO_BASE64})
    data = r.json()
    assert data["nom"] == "Agence A"
    assert data["active"] is True
    assert data["organisation_id"] == str(ctx.org_a)
