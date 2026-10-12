"""
Suggestions — contexte d'agence (aperçu d'agence du CX Manager).

Le filtre `agence_id` de GET /suggestions/ s'ajoute au périmètre du rôle : il ne l'élargit jamais.
Vrai routeur, vraie authentification JWT, SQLite en mémoire, deux organisations clientes.
"""
import os
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-suggestions-contexte-0123456789")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.endpoints import suggestions
from app.core.security import create_access_token, get_password_hash
from app.db.session import Base, get_db
from app.models.agence import Agence
from app.models.enums import UserRole
from app.models.feedback import Feedback
from app.models.organisation import Organisation
from app.models.qr_code import QRCode
from app.models.suggestion import Suggestion
from app.models.utilisateur import Utilisateur


@pytest.fixture()
def ctx():
    engine = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    for table in Base.metadata.sorted_tables:
        try:
            table.create(engine, checkfirst=True)
        except Exception:  # noqa: BLE001 — tables propres à PostgreSQL
            pass
    Session = sessionmaker(bind=engine)

    def override_db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app = FastAPI()
    app.include_router(suggestions.router, prefix="/suggestions")
    app.dependency_overrides[get_db] = override_db

    db = Session()
    now = datetime.now(timezone.utc)
    org_a, org_b, org_admin = (Organisation(id=uuid4(), nom=n, active=True) for n in ("Client A", "Client B", "Plateforme"))
    db.add_all([org_a, org_b, org_admin]); db.flush()
    a1 = Agence(id=uuid4(), organisation_id=org_a.id, nom="Agence A1", ville="Lyon", active=True, seuil_alerte=70)
    a2 = Agence(id=uuid4(), organisation_id=org_a.id, nom="Agence A2", ville="Lille", active=True, seuil_alerte=70)
    b1 = Agence(id=uuid4(), organisation_id=org_b.id, nom="Agence B1", ville="Paris", active=True, seuil_alerte=70)
    db.add_all([a1, a2, b1]); db.flush()
    qr = {c: QRCode(id=uuid4(), agence_id=ag.id, code=c, url=f"http://t/{c}", actif=True) for c, ag in [("QR-A1", a1), ("QR-A2", a2), ("QR-B1", b1)]}
    db.add_all(qr.values()); db.flush()

    def suggestion(code, texte):
        fb = Feedback(id=uuid4(), qr_code_id=qr[code].id, note=4, commentaire="x", statut_traitement="nouveau", date_soumission=now)
        db.add(fb); db.flush()
        s = Suggestion(id=uuid4(), feedback_id=fb.id, contenu=texte)
        db.add(s)
        return s

    s_a1, s_a2, s_b1 = suggestion("QR-A1", "idée A1"), suggestion("QR-A2", "idée A2"), suggestion("QR-B1", "IDEE-SECRETE-B")

    def user(role, org, agence=None):
        u = Utilisateur(id=uuid4(), organisation_id=org.id, agence_id=agence.id if agence else None, nom="N", prenom="P",
                        email=f"{uuid4().hex[:10]}@test.io", mot_de_passe_hash=get_password_hash("Motdepasse-123"), role=role, active=True)
        db.add(u)
        return u

    users = dict(cx_a=user(UserRole.CX_MANAGER, org_a), cx_b=user(UserRole.CX_MANAGER, org_b),
                 am_a1=user(UserRole.AGENCY_MANAGER, org_a, a1), admin=user(UserRole.ADMIN, org_admin))
    db.commit()
    ids = SimpleNamespace(**{k: v.id for k, v in dict(users, s_a1=s_a1, s_a2=s_a2, s_b1=s_b1, a1=a1, a2=a2, b1=b1).items()})
    db.close()
    return SimpleNamespace(client=TestClient(app), H=lambda uid: {"Authorization": f"Bearer {create_access_token(uid)}"}, **vars(ids))


def _ids(ctx, acteur, params=None):
    r = ctx.client.get("/suggestions/", headers=ctx.H(getattr(ctx, acteur)), params=params)
    assert r.status_code == 200, r.text
    return {s["id"] for s in r.json()}, r.headers["x-total-count"]


def test_cx_sans_filtre_voit_tout_son_reseau(ctx):
    ids, total = _ids(ctx, "cx_a")
    assert ids == {str(ctx.s_a1), str(ctx.s_a2)} and total == "2"


def test_cx_filtre_sur_une_agence_de_son_reseau(ctx):
    assert _ids(ctx, "cx_a", {"agence_id": str(ctx.a1)}) == ({str(ctx.s_a1)}, "1")
    assert _ids(ctx, "cx_a", {"agence_id": str(ctx.a2)}) == ({str(ctx.s_a2)}, "1")


def test_cx_ne_peut_pas_lire_une_agence_d_une_autre_organisation(ctx):
    r = ctx.client.get("/suggestions/", headers=ctx.H(ctx.cx_a), params={"agence_id": str(ctx.b1)})
    assert r.status_code == 200 and r.json() == [] and r.headers["x-total-count"] == "0"
    assert "IDEE-SECRETE-B" not in r.text


def test_identifiant_d_agence_inconnu_donne_une_liste_vide(ctx):
    assert _ids(ctx, "cx_a", {"agence_id": str(uuid4())}) == (set(), "0")


def test_identifiant_d_agence_invalide_est_refuse(ctx):
    assert ctx.client.get("/suggestions/", headers=ctx.H(ctx.cx_a), params={"agence_id": "pas-un-uuid"}).status_code == 422


def test_responsable_d_agence_ne_sort_pas_de_son_agence(ctx):
    assert _ids(ctx, "am_a1")[0] == {str(ctx.s_a1)}
    assert _ids(ctx, "am_a1", {"agence_id": str(ctx.a2)}) == (set(), "0")   # autre agence, même organisation
    assert _ids(ctx, "am_a1", {"agence_id": str(ctx.b1)}) == (set(), "0")   # autre organisation


def test_admin_reste_exclu_et_sans_authentification_refuse(ctx):
    assert ctx.client.get("/suggestions/", headers=ctx.H(ctx.admin), params={"agence_id": str(ctx.a1)}).status_code == 403
    assert ctx.client.get("/suggestions/", params={"agence_id": str(ctx.a1)}).status_code in {401, 403}
