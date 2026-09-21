"""
PATCH /auth/me et POST /auth/me/mot-de-passe — self-service de son propre
compte uniquement. Inclut le test de sécurité explicite : role/organisation_id/
agence_id doivent être ignorés même envoyés manuellement dans le payload.
"""
import os
from types import SimpleNamespace
from uuid import uuid4

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-auth-me-tests-0123456789")

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.deps import get_current_active_user
from app.api.v1.endpoints import auth
from app.core.security import get_password_hash, verify_password
from app.db.session import get_db
from app.models.enums import UserRole


class _FakeQuery:
    def __init__(self, resultat):
        self._resultat = resultat

    def filter(self, *a, **k):
        return self

    def first(self):
        return self._resultat


class _FakeDb:
    """email_deja_pris : simule un AUTRE utilisateur déjà propriétaire de l'email demandé."""
    def __init__(self, email_deja_pris=None):
        self.email_deja_pris = email_deja_pris
        self.committed = False

    def query(self, *a, **k):
        return _FakeQuery(self.email_deja_pris)

    def commit(self):
        self.committed = True

    def refresh(self, obj):
        pass


def _client(user, db=None):
    app = FastAPI()
    app.include_router(auth.router, prefix="/auth")
    app.dependency_overrides[get_current_active_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: (db if db is not None else _FakeDb())
    return TestClient(app)


def _user(**overrides):
    base = dict(
        id=uuid4(), role=UserRole.AGENCY_MANAGER, active=True,
        nom="SOUMBOUGMA", prenom="Ousmane", email="agency@orange.bf",
        organisation_id=uuid4(), agence_id=uuid4(),
        organisation_nom=None, organisation_logo=None, agence_nom=None,
        mot_de_passe_hash=get_password_hash("AncienMotDePasse123"),
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def test_update_me_modifie_nom_prenom_email():
    user = _user()
    client = _client(user)
    r = client.patch("/auth/me", json={"prenom": "Nouveau", "nom": "Nom", "email": "nouveau@orange.bf"})
    assert r.status_code == 200
    assert user.prenom == "Nouveau"
    assert user.nom == "Nom"
    assert user.email == "nouveau@orange.bf"


def test_update_me_ignore_role_et_organisation_meme_envoyes():
    """Test de sécurité explicite : tentative d'auto-élévation via payload manuel manipulé."""
    user = _user()
    org_originale = user.organisation_id
    agence_originale = user.agence_id
    client = _client(user)

    r = client.patch("/auth/me", json={
        "nom": "Test",
        "role": "admin",
        "organisation_id": str(uuid4()),
        "agence_id": None,
    })

    assert r.status_code == 200
    assert user.role == UserRole.AGENCY_MANAGER  # inchangé malgré la tentative
    assert user.organisation_id == org_originale  # inchangé
    assert user.agence_id == agence_originale  # inchangé
    assert user.nom == "Test"  # le champ légitime, lui, est bien passé


def test_update_me_email_deja_pris_par_un_autre_compte_refuse():
    user = _user()
    db = _FakeDb(email_deja_pris=SimpleNamespace(id=uuid4()))
    client = _client(user, db)
    r = client.patch("/auth/me", json={"email": "deja-pris@orange.bf"})
    assert r.status_code == 400
    assert user.email == "agency@orange.bf"  # inchangé


def test_changer_mot_de_passe_refuse_si_ancien_incorrect():
    user = _user()
    client = _client(user)
    r = client.post("/auth/me/mot-de-passe", json={
        "ancien_mot_de_passe": "Mauvais",
        "nouveau_mot_de_passe": "NouveauMotDePasse123",
    })
    assert r.status_code == 400
    assert verify_password("AncienMotDePasse123", user.mot_de_passe_hash)  # inchangé


def test_changer_mot_de_passe_reussit_si_ancien_correct():
    user = _user()
    client = _client(user)
    r = client.post("/auth/me/mot-de-passe", json={
        "ancien_mot_de_passe": "AncienMotDePasse123",
        "nouveau_mot_de_passe": "NouveauMotDePasse123",
    })
    assert r.status_code == 200
    assert verify_password("NouveauMotDePasse123", user.mot_de_passe_hash)


def test_changer_mot_de_passe_trop_court_refuse():
    user = _user()
    client = _client(user)
    r = client.post("/auth/me/mot-de-passe", json={
        "ancien_mot_de_passe": "AncienMotDePasse123",
        "nouveau_mot_de_passe": "court",
    })
    assert r.status_code == 422
