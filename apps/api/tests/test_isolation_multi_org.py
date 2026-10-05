"""
Isolation multi-organisation / multi-agence — suite de non-régression (5B-1).

Issue du script de preuve de l'audit 5A (8 contrôles vulnérables sur 16). Contrairement
aux tests unitaires de test_acces_agence.py, ces tests passent par le VRAI routeur et la
VRAIE authentification JWT (get_current_user / get_current_active_user ne sont PAS
surchargés), sur une base SQLite en mémoire avec deux organisations clientes A et B.

Règle vérifiée : l'organisation et l'agence autorisées se déduisent de l'identité
authentifiée et de relations vérifiées en base ; un identifiant fourni par le client
n'est jamais une preuve d'autorisation.
"""
import os
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-isolation-multi-org-0123456789")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401  (enregistre tous les modèles)
from app.api.v1.endpoints import agences, alertes, analyses, feedbacks, issues, kpis, qr_codes, utilisateurs
from app.core.security import create_access_token, get_password_hash
from app.db.session import Base, get_db
from app.models.agence import Agence
from app.models.analyse_ia import AnalyseIA
from app.models.demande_contact import DemandeContact
from app.models.enums import CriticiteType, SentimentType, UserRole
from app.models.feedback import Feedback
from app.models.issue import Issue
from app.models.organisation import Organisation
from app.models.qr_code import QRCode
from app.models.utilisateur import Utilisateur

REFUS = {403, 404}  # refus sécurisé : jamais 200


@pytest.fixture()
def ctx():
    engine = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    for table in Base.metadata.sorted_tables:
        try:
            table.create(engine, checkfirst=True)
        except Exception:  # noqa: BLE001 — tables propres à PostgreSQL, non utilisées ici
            pass
    Session = sessionmaker(bind=engine)

    def override_db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app = FastAPI()
    for prefixe, module in [
        ("/utilisateurs", utilisateurs), ("/feedbacks", feedbacks), ("/analyses", analyses),
        ("/qr-codes", qr_codes), ("/kpis", kpis), ("/issues", issues), ("/agences", agences),
        ("/alertes", alertes),
    ]:
        app.include_router(module.router, prefix=prefixe)
    app.dependency_overrides[get_db] = override_db

    db = Session()
    now = datetime.now(timezone.utc)
    org_a = Organisation(id=uuid4(), nom="Client A", active=True)
    org_b = Organisation(id=uuid4(), nom="Client B", active=True)
    org_admin = Organisation(id=uuid4(), nom="Plateforme", active=True)
    db.add_all([org_a, org_b, org_admin]); db.flush()

    a1 = Agence(id=uuid4(), organisation_id=org_a.id, nom="Agence A1", ville="Lyon", active=True, seuil_alerte=70)
    a2 = Agence(id=uuid4(), organisation_id=org_a.id, nom="Agence A2", ville="Lille", active=True, seuil_alerte=70)
    b1 = Agence(id=uuid4(), organisation_id=org_b.id, nom="Agence B1", ville="Paris", active=True, seuil_alerte=70)
    b_inactive = Agence(id=uuid4(), organisation_id=org_b.id, nom="Agence B fermée", ville="Nice", active=False, seuil_alerte=70)
    db.add_all([a1, a2, b1, b_inactive]); db.flush()

    qr = {}
    for agence, code in [(a1, "QR-A1"), (a2, "QR-A2"), (b1, "QR-B1")]:
        qr[code] = QRCode(id=uuid4(), agence_id=agence.id, code=code, url=f"http://t/{code}", actif=True)
    db.add_all(qr.values()); db.flush()

    def feedback(code, commentaire):
        fb = Feedback(id=uuid4(), qr_code_id=qr[code].id, note=1, commentaire=commentaire,
                      statut_traitement="nouveau", date_soumission=now)
        db.add(fb); db.flush()
        db.add(AnalyseIA(id=uuid4(), feedback_id=fb.id, sentiment=SentimentType.NEGATIF,
                         criticite=CriticiteType.CRITIQUE, score_sentiment=0.1, theme_principal="attente"))
        return fb

    fb_a1, fb_a2, fb_b1 = feedback("QR-A1", "avis A1"), feedback("QR-A2", "avis A2"), feedback("QR-B1", "SECRET-CLIENT-B")
    db.add(DemandeContact(id=uuid4(), feedback_id=fb_b1.id, nom="Client B", telephone="0600000000",
                          email="client.b@example.com", souhaite_etre_rappele=True))

    def issue(agence):
        i = Issue(id=uuid4(), organisation_id=agence.organisation_id, agence_id=agence.id, titre="Issue test",
                  statut="ouverte", severite=CriticiteType.ELEVEE, necessite_action=True, premiere_detection=now)
        db.add(i)
        return i

    issue_a1, issue_a2, issue_b1 = issue(a1), issue(a2), issue(b1)

    def user(role, org, agence=None):
        u = Utilisateur(id=uuid4(), organisation_id=org.id, agence_id=agence.id if agence else None,
                        nom="N", prenom="P", email=f"{uuid4().hex[:10]}@test.io",
                        mot_de_passe_hash=get_password_hash("Motdepasse-123"), role=role, active=True)
        db.add(u)
        return u

    cx_a = user(UserRole.CX_MANAGER, org_a)
    cx_b = user(UserRole.CX_MANAGER, org_b)
    am_a1 = user(UserRole.AGENCY_MANAGER, org_a, a1)
    am_a2 = user(UserRole.AGENCY_MANAGER, org_a, a2)
    am_sans_agence = user(UserRole.AGENCY_MANAGER, org_a)
    # Compte incohérent créé AVANT le correctif (AM de l'org A rattaché à une agence de l'org B).
    am_compromis = user(UserRole.AGENCY_MANAGER, org_a, b1)
    admin = user(UserRole.ADMIN, org_admin)
    db.commit()

    ids = SimpleNamespace(**{k: v.id for k, v in dict(
        org_a=org_a, org_b=org_b, a1=a1, a2=a2, b1=b1, b_inactive=b_inactive,
        fb_a1=fb_a1, fb_a2=fb_a2, fb_b1=fb_b1, issue_a1=issue_a1, issue_a2=issue_a2, issue_b1=issue_b1,
        cx_a=cx_a, cx_b=cx_b, am_a1=am_a1, am_a2=am_a2, am_sans_agence=am_sans_agence,
        am_compromis=am_compromis, admin=admin,
    ).items()})
    db.close()

    client = TestClient(app)
    entete = lambda user_id: {"Authorization": f"Bearer {create_access_token(user_id)}"}  # noqa: E731
    return SimpleNamespace(client=client, H=entete, Session=Session, **vars(ids))


def _creer_am(c, auteur, agence_id, **extra):
    return c.client.post("/utilisateurs/", headers=c.H(auteur), json={
        "nom": "Nouveau", "prenom": "AM", "email": f"{uuid4().hex[:10]}@test.io",
        "password": "Motdepasse-123", "role": "agency_manager", "agence_id": str(agence_id), **extra,
    })


# ── Organisation : rattachement utilisateur → agence ─────────────────────────────────

def test_cx_rattache_un_am_a_une_agence_de_son_organisation(ctx):
    assert _creer_am(ctx, ctx.cx_a, ctx.a1).status_code == 201


def test_cx_ne_peut_pas_creer_un_am_sur_une_agence_d_une_autre_organisation(ctx):
    r = _creer_am(ctx, ctx.cx_a, ctx.b1)
    assert r.status_code == 403
    db = ctx.Session()
    assert db.query(Utilisateur).filter(Utilisateur.agence_id == ctx.b1, Utilisateur.organisation_id == ctx.org_a).count() == 1  # seul le compte compromis du fixture


def test_cx_ne_peut_pas_fournir_une_organisation_arbitraire(ctx):
    # organisation_id envoyé par le client ignoré : l'AM est créé dans l'organisation du CX.
    r = _creer_am(ctx, ctx.cx_a, ctx.a1, organisation_id=str(ctx.org_b))
    assert r.status_code == 201 and r.json()["organisation_id"] == str(ctx.org_a)


def test_cx_reaffecte_un_am_dans_son_organisation_mais_pas_ailleurs(ctx):
    ok = ctx.client.patch(f"/utilisateurs/{ctx.am_a1}", headers=ctx.H(ctx.cx_a), json={"agence_id": str(ctx.a2)})
    assert ok.status_code == 200 and ok.json()["agence_id"] == str(ctx.a2)
    ko = ctx.client.patch(f"/utilisateurs/{ctx.am_a1}", headers=ctx.H(ctx.cx_a), json={"agence_id": str(ctx.b1)})
    assert ko.status_code == 403
    assert ctx.Session().get(Utilisateur, ctx.am_a1).agence_id == ctx.a2  # inchangé par la tentative


def test_cx_ne_peut_pas_modifier_un_utilisateur_d_une_autre_organisation(ctx):
    r = ctx.client.patch(f"/utilisateurs/{ctx.am_a1}", headers=ctx.H(ctx.cx_b), json={"agence_id": str(ctx.b1)})
    assert r.status_code in REFUS


# ── Agency Manager ───────────────────────────────────────────────────────────────────

def test_am_lit_les_feedbacks_de_son_agence_uniquement(ctx):
    r = ctx.client.get("/feedbacks/", headers=ctx.H(ctx.am_a1))
    assert r.status_code == 200
    assert {f["id"] for f in r.json()} == {str(ctx.fb_a1)}


def test_am_feedback_par_id(ctx):
    assert ctx.client.get(f"/feedbacks/{ctx.fb_a1}", headers=ctx.H(ctx.am_a1)).status_code == 200
    assert ctx.client.get(f"/feedbacks/{ctx.fb_a2}", headers=ctx.H(ctx.am_a1)).status_code in REFUS
    assert ctx.client.get(f"/feedbacks/{ctx.fb_b1}", headers=ctx.H(ctx.am_a1)).status_code in REFUS


def test_am_rattache_a_une_agence_d_une_autre_organisation_est_bloque_partout(ctx):
    """Compte incohérent préexistant : plus aucun accès aux feedbacks ni aux données
    personnelles de l'organisation B (fuite prouvée en 5A)."""
    for chemin in ["/feedbacks/", "/feedbacks/demandes-contact", f"/feedbacks/{ctx.fb_b1}", "/kpis/", "/issues/"]:
        r = ctx.client.get(chemin, headers=ctx.H(ctx.am_compromis))
        assert r.status_code == 403, chemin
        assert "SECRET-CLIENT-B" not in r.text and "0600000000" not in r.text


def test_am_sans_agence_n_accede_a_aucune_donnee_client(ctx):
    for chemin in ["/feedbacks/", "/issues/", "/kpis/"]:
        assert ctx.client.get(chemin, headers=ctx.H(ctx.am_sans_agence)).status_code == 403, chemin


# ── CX Manager ───────────────────────────────────────────────────────────────────────

def test_cx_feedback_par_id(ctx):
    assert ctx.client.get(f"/feedbacks/{ctx.fb_a1}", headers=ctx.H(ctx.cx_a)).status_code == 200
    assert ctx.client.get(f"/feedbacks/{ctx.fb_a2}", headers=ctx.H(ctx.cx_a)).status_code == 200
    assert ctx.client.get(f"/feedbacks/{ctx.fb_b1}", headers=ctx.H(ctx.cx_a)).status_code in REFUS


def test_cx_liste_filtree_sur_une_agence_etrangere_est_vide(ctx):
    r = ctx.client.get(f"/feedbacks/?agence_id={ctx.b1}", headers=ctx.H(ctx.cx_a))
    assert r.status_code == 200 and r.json() == []


def test_cx_ne_lit_pas_une_agence_d_une_autre_organisation(ctx):
    assert ctx.client.get(f"/agences/{ctx.b1}", headers=ctx.H(ctx.cx_a)).status_code in REFUS


# ── Analyses IA ──────────────────────────────────────────────────────────────────────

def test_analyses_cx(ctx):
    assert ctx.client.get(f"/analyses/{ctx.fb_a1}", headers=ctx.H(ctx.cx_a)).status_code == 200
    r = ctx.client.get(f"/analyses/{ctx.fb_b1}", headers=ctx.H(ctx.cx_a))
    assert r.status_code in REFUS and "attente" not in r.text


def test_analyses_am(ctx):
    assert ctx.client.get(f"/analyses/{ctx.fb_a1}", headers=ctx.H(ctx.am_a1)).status_code == 200
    assert ctx.client.get(f"/analyses/{ctx.fb_a2}", headers=ctx.H(ctx.am_a1)).status_code in REFUS
    assert ctx.client.get(f"/analyses/{ctx.fb_b1}", headers=ctx.H(ctx.am_a1)).status_code in REFUS


# ── KPI ──────────────────────────────────────────────────────────────────────────────

def test_kpi_cx(ctx):
    assert ctx.client.get("/kpis/", headers=ctx.H(ctx.cx_a)).status_code == 200
    assert ctx.client.get(f"/kpis/?agence_id={ctx.a1}", headers=ctx.H(ctx.cx_a)).status_code == 200
    assert ctx.client.get(f"/kpis/?agence_id={ctx.b1}", headers=ctx.H(ctx.cx_a)).status_code == 403


def test_kpi_am(ctx):
    r = ctx.client.get("/kpis/", headers=ctx.H(ctx.am_a1))
    assert r.status_code == 200 and r.json()["agence_id"] == str(ctx.a1)
    assert ctx.client.get(f"/kpis/?agence_id={ctx.a2}", headers=ctx.H(ctx.am_a1)).status_code == 403


def test_kpi_am_sans_agence_jamais_le_perimetre_organisation(ctx):
    r = ctx.client.get("/kpis/", headers=ctx.H(ctx.am_sans_agence))
    assert r.status_code == 403
    assert ctx.client.get("/kpis/CSAT", headers=ctx.H(ctx.am_sans_agence)).status_code == 403


# ── Issues / actions correctives ─────────────────────────────────────────────────────

def test_issues_par_id(ctx):
    assert ctx.client.get(f"/issues/{ctx.issue_a1}", headers=ctx.H(ctx.cx_a)).status_code == 200
    assert ctx.client.get(f"/issues/{ctx.issue_b1}", headers=ctx.H(ctx.cx_a)).status_code in REFUS
    assert ctx.client.get(f"/issues/{ctx.issue_a1}", headers=ctx.H(ctx.am_a1)).status_code == 200
    assert ctx.client.get(f"/issues/{ctx.issue_a2}", headers=ctx.H(ctx.am_a1)).status_code in REFUS


def test_issues_liste_etrangere_vide(ctx):
    r = ctx.client.get(f"/issues/?agence_id={ctx.b1}", headers=ctx.H(ctx.cx_a))
    assert r.status_code == 200 and r.json() == []


def test_issue_ne_peut_pas_etre_creee_sur_une_agence_etrangere(ctx):
    r = ctx.client.post("/issues/", headers=ctx.H(ctx.cx_a), json={"titre": "Intrusion", "agence_id": str(ctx.b1)})
    assert r.status_code in REFUS


def test_action_corrective_sur_issue_etrangere_refusee(ctx):
    r = ctx.client.post(f"/issues/{ctx.issue_b1}/actions", headers=ctx.H(ctx.cx_a), json={"titre": "Action pirate"})
    assert r.status_code in REFUS


def test_rattacher_un_feedback_etranger_a_son_issue_refuse(ctx):
    r = ctx.client.patch(f"/issues/{ctx.issue_a1}/rattacher-feedback/{ctx.fb_b1}", headers=ctx.H(ctx.cx_a))
    assert r.status_code in REFUS
    assert ctx.Session().get(Feedback, ctx.fb_b1).issue_id is None


# ── Admin ────────────────────────────────────────────────────────────────────────────

def test_admin_n_accede_pas_aux_donnees_clients(ctx):
    for chemin in ["/feedbacks/", f"/feedbacks/{ctx.fb_a1}", f"/analyses/{ctx.fb_a1}", "/kpis/", "/issues/"]:
        assert ctx.client.get(chemin, headers=ctx.H(ctx.admin)).status_code == 403, chemin


def test_admin_rattache_un_utilisateur_a_une_agence_de_l_organisation_cible(ctx):
    base = {"nom": "CX", "prenom": "Nouveau", "password": "Motdepasse-123", "role": "cx_manager",
            "organisation_id": str(ctx.org_a)}
    ok = ctx.client.post("/utilisateurs/", headers=ctx.H(ctx.admin),
                         json={**base, "email": f"{uuid4().hex[:8]}@t.io", "agence_id": str(ctx.a1)})
    assert ok.status_code == 201 and ok.json()["agence_id"] == str(ctx.a1)
    ko = ctx.client.post("/utilisateurs/", headers=ctx.H(ctx.admin),
                         json={**base, "email": f"{uuid4().hex[:8]}@t.io", "agence_id": str(ctx.b1)})
    assert ko.status_code == 403


def test_admin_conserve_son_droit_structurel_sur_les_seuils(ctx):
    r = ctx.client.patch(f"/alertes/agences/{ctx.a1}/seuil", headers=ctx.H(ctx.admin), json={"seuil_alerte": 65})
    assert r.status_code == 200
    # Le CX Manager, lui, reste limité à son organisation.
    assert ctx.client.patch(f"/alertes/agences/{ctx.b1}/seuil", headers=ctx.H(ctx.cx_a),
                            json={"seuil_alerte": 10}).status_code == 403


# ── QR public ────────────────────────────────────────────────────────────────────────

def test_liste_publique_des_agences_n_est_plus_anonyme(ctx):
    assert ctx.client.get("/qr-codes/public-agences").status_code in {401, 403}
    assert ctx.client.get("/qr-codes/public-agences", headers=ctx.H(ctx.cx_a)).status_code == 403
    assert ctx.client.get("/qr-codes/public-agences", headers=ctx.H(ctx.admin)).status_code == 200


def test_qr_public_resout_un_seul_contexte_par_code_opaque(ctx):
    r = ctx.client.get("/qr-codes/QR-A1/validate")
    assert r.status_code == 200 and r.json()["agence_id"] == str(ctx.a1)
    # Lien légitime généré par le dashboard : /feedback/{agence.id}
    assert ctx.client.get(f"/qr-codes/{ctx.a1}/validate").status_code == 200


def test_qr_public_ne_resout_plus_par_nom_ni_ville(ctx):
    db = ctx.Session()
    nb_qr = db.query(QRCode).count()
    for terme in ["Agence", "B1", "Paris", "a"]:
        assert ctx.client.get(f"/qr-codes/{terme}/validate").status_code == 404, terme
        assert ctx.client.get(f"/qr-codes/{terme}/categories").status_code == 404, terme
    assert ctx.Session().query(QRCode).count() == nb_qr  # aucune écriture sur un GET anonyme


def test_qr_public_refuse_une_agence_inactive(ctx):
    assert ctx.client.get(f"/qr-codes/{ctx.b_inactive}/validate").status_code == 404
