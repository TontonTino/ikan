"""
Démonstration publique (app/core/demo.py) : entrée sans mot de passe par rôle, garde-fous, refus sur la base de production.

SÉCURITÉ DES TESTS : SQLite en mémoire uniquement (type de base vérifié).
"""
import os
import uuid
from types import SimpleNamespace

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-demo-publique-0123456789")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.endpoints import auth, organisations, utilisateurs
from app.core import demo
from app.core.config import settings
from app.core.erreurs_validation import installer_erreurs_validation
from app.core.security import create_access_token, decode_token, get_password_hash
from app.db.session import Base, get_db
from app.models.agence import Agence
from app.models.enums import UserRole
from app.models.organisation import Organisation
from app.models.plan import Plan
from app.models.utilisateur import Utilisateur
from app.services.plan_catalog import PLAN_GRATUIT_ID

MDP = "Motdepasse-123"
EMAIL_CX = "cx@demo.ikanai.bf"
EMAIL_AM = "agence@demo.ikanai.bf"


def _configurer(monkeypatch, mode="oui", cx=EMAIL_CX, am=EMAIL_AM, base="sqlite+pysqlite://"):
    monkeypatch.setattr(settings, "DEMO_MODE", mode)
    monkeypatch.setattr(settings, "DEMO_COMPTE_CX", cx)
    monkeypatch.setattr(settings, "DEMO_COMPTE_AGENCE", am)
    monkeypatch.setattr(settings, "DATABASE_URL", base)


@pytest.fixture()
def ctx(monkeypatch):
    _configurer(monkeypatch)
    moteur = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    assert moteur.url.get_backend_name() == "sqlite"                  # jamais la vraie base
    for table in Base.metadata.sorted_tables:
        try:
            table.create(moteur, checkfirst=True)
        except Exception:  # noqa: BLE001
            pass
    Session = sessionmaker(bind=moteur)

    def base():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app = FastAPI()
    for prefixe, module in (("/auth", auth), ("/utilisateurs", utilisateurs), ("/organisations", organisations)):
        app.include_router(module.router, prefix=prefixe)
    app.dependency_overrides[get_db] = base
    installer_erreurs_validation(app)

    db = Session()
    db.add(Plan(id=PLAN_GRATUIT_ID, code="gratuit", nom="Gratuit", ordre=0)); db.flush()
    org = Organisation(id=uuid.uuid4(), nom="Orange Burkina Faso (démo)", active=True)
    db.add(org); db.flush()
    ag = Agence(id=uuid.uuid4(), organisation_id=org.id, nom="Agence démo", ville="Ouagadougou", active=True, seuil_alerte=80)
    db.add(ag); db.flush()

    def user(role, email, agence=None):
        u = Utilisateur(id=uuid.uuid4(), organisation_id=org.id, agence_id=agence.id if agence else None, nom="N", prenom="P",
                        email=email, mot_de_passe_hash=get_password_hash(MDP), role=role, active=True)
        db.add(u)
        return u

    comptes = dict(cx=user(UserRole.CX_MANAGER, EMAIL_CX), am=user(UserRole.AGENCY_MANAGER, EMAIL_AM, ag),
                   autre_am=user(UserRole.AGENCY_MANAGER, "autre@demo.ikanai.bf", ag),
                   admin=user(UserRole.ADMIN, "admin@demo.ikanai.bf"))
    db.commit()
    ids = {k: v.id for k, v in comptes.items()}
    db.close()
    return SimpleNamespace(client=TestClient(app), Session=Session, ids=ids,
                           H=lambda uid: {"Authorization": "Bearer " + create_access_token(str(uid))})


# ── Entrée par rôle ──────────────────────────────────────────────────────────────────────────────────────────────────────────

def test_les_roles_proposes_sont_ceux_configures(ctx):
    assert ctx.client.get("/auth/demo").json() == {"roles": ["cx_manager", "agency_manager"]}


@pytest.mark.parametrize("role, compte", [("cx_manager", "cx"), ("agency_manager", "am")])
def test_un_bouton_ouvre_la_session_du_compte_d_entree(ctx, role, compte):
    r = ctx.client.post("/auth/demo", json={"role": role})
    assert r.status_code == 200
    corps = r.json()
    assert corps["user"]["id"] == str(ctx.ids[compte]) and corps["user"]["role"] == role
    assert decode_token(corps["access_token"])["sub"] == str(ctx.ids[compte])
    assert "access_token" in r.cookies and "refresh_token" in r.cookies      # même session qu'une connexion normale
    assert ctx.client.get("/auth/me", cookies={"access_token": r.cookies["access_token"]}).json()["id"] == str(ctx.ids[compte])


def test_l_admin_n_est_jamais_propose(ctx):
    assert ctx.client.post("/auth/demo", json={"role": "admin"}).status_code == 422


def test_un_role_sans_compte_configure_n_a_pas_de_bouton(ctx, monkeypatch):
    monkeypatch.setattr(settings, "DEMO_COMPTE_AGENCE", "")
    assert ctx.client.get("/auth/demo").json() == {"roles": ["cx_manager"]}
    assert ctx.client.post("/auth/demo", json={"role": "agency_manager"}).status_code == 404


def test_compte_d_entree_absent_de_la_base_503(ctx, monkeypatch):
    monkeypatch.setattr(settings, "DEMO_COMPTE_CX", "introuvable@demo.ikanai.bf")
    r = ctx.client.post("/auth/demo", json={"role": "cx_manager"})
    assert r.status_code == 503 and "préparation" in r.json()["detail"]


def test_l_email_doit_correspondre_au_role(ctx, monkeypatch):
    """Une erreur de configuration (e-mail de l'Admin mis en compte CX) n'ouvre jamais une session Admin."""
    monkeypatch.setattr(settings, "DEMO_COMPTE_CX", "admin@demo.ikanai.bf")
    assert ctx.client.post("/auth/demo", json={"role": "cx_manager"}).status_code == 503


def test_hors_demo_les_routes_n_existent_pas(ctx, monkeypatch):
    monkeypatch.setattr(settings, "DEMO_MODE", "non")
    assert ctx.client.get("/auth/demo").status_code == 404
    assert ctx.client.post("/auth/demo", json={"role": "cx_manager"}).status_code == 404


@pytest.mark.parametrize("valeur", ["OUI", "1", "true", " oui-", ""])
def test_seule_la_valeur_exacte_oui_active_la_demo(monkeypatch, valeur):
    _configurer(monkeypatch, mode=valeur)
    assert demo.demo_active() is False


# ── Garde-fous : ce qui casserait la démo pour les visiteurs suivants ────────────────────────────────────────────────────────

def test_mot_de_passe_d_un_compte_d_entree_verrouille(ctx):
    r = ctx.client.post("/auth/me/mot-de-passe", headers=ctx.H(ctx.ids["cx"]),
                        json={"ancien_mot_de_passe": MDP, "nouveau_mot_de_passe": "Nouveau-mdp-456"})
    assert r.status_code == 403 and r.json()["detail"] == demo.MESSAGE_ACTION_DESACTIVEE


def test_email_d_un_compte_d_entree_verrouille_mais_le_nom_reste_modifiable(ctx):
    assert ctx.client.patch("/auth/me", headers=ctx.H(ctx.ids["cx"]), json={"email": "pirate@exemple.io"}).status_code == 403
    r = ctx.client.patch("/auth/me", headers=ctx.H(ctx.ids["cx"]), json={"prenom": "Awa"})
    assert r.status_code == 200 and r.json()["prenom"] == "Awa"


def test_le_cx_ne_peut_ni_modifier_ni_desactiver_le_compte_d_entree_agence(ctx):
    h = ctx.H(ctx.ids["cx"])
    assert ctx.client.patch(f"/utilisateurs/{ctx.ids['am']}", headers=h, json={"active": False}).status_code == 403
    assert ctx.client.delete(f"/utilisateurs/{ctx.ids['am']}", headers=h).status_code == 403
    assert ctx.client.post("/auth/demo", json={"role": "agency_manager"}).status_code == 200


def test_les_autres_comptes_restent_gerables(ctx):
    h = ctx.H(ctx.ids["cx"])
    assert ctx.client.patch(f"/utilisateurs/{ctx.ids['autre_am']}", headers=h, json={"prenom": "Issa"}).status_code == 200
    assert ctx.client.delete(f"/utilisateurs/{ctx.ids['autre_am']}", headers=h).status_code == 204


def test_aucun_paiement_dans_la_demo(ctx):
    r = ctx.client.post("/organisations/moi/upgrade-checkout", headers=ctx.H(ctx.ids["cx"]), json={"plan_code": "pro"})
    assert r.status_code == 403


def test_hors_demo_les_garde_fous_ne_s_appliquent_pas(ctx, monkeypatch):
    monkeypatch.setattr(settings, "DEMO_MODE", "non")
    r = ctx.client.post("/auth/me/mot-de-passe", headers=ctx.H(ctx.ids["cx"]),
                        json={"ancien_mot_de_passe": MDP, "nouveau_mot_de_passe": "Nouveau-mdp-456"})
    assert r.status_code == 200


# ── Démarrage : jamais sur la base de production ─────────────────────────────────────────────────────────────────────────────

def test_demarrage_refuse_sur_la_base_de_production(monkeypatch):
    _configurer(monkeypatch, base="postgresql://postgres.slynbxonwureptrmuskn:x@pooler.supabase.com:6543/postgres")
    with pytest.raises(demo.DemoMalConfiguree) as erreur:
        demo.verifier_demarrage()
    assert "PRODUCTION" in str(erreur.value) and "slynbx" not in str(erreur.value)


def test_demarrage_refuse_sans_compte_d_entree(monkeypatch):
    _configurer(monkeypatch, cx="", am="")
    with pytest.raises(demo.DemoMalConfiguree):
        demo.verifier_demarrage()


def test_demarrage_normal_sans_demo_meme_en_production(monkeypatch):
    _configurer(monkeypatch, mode="non", base="postgresql://postgres.slynbxonwureptrmuskn:x@pooler.supabase.com:6543/postgres")
    demo.verifier_demarrage()   # aucune exception : l'instance de production n'est pas concernée
