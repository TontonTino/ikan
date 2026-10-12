"""
Parcours de gestion des avis — permissions côté serveur (vrai routeur, vraie authentification JWT,
SQLite en mémoire, deux organisations clientes A et B).

Matrice vérifiée sur CHAQUE endpoint feedback : un responsable d'agence ne voit que son agence,
un CX Manager que son organisation, l'admin plateforme aucune donnée client, et une tentative
refusée ne révèle ni le contenu de l'avis ni ne modifie la base.
"""
import os
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-parcours-avis-0123456789")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.endpoints import feedbacks
from app.core.security import create_access_token, get_password_hash
from app.db.session import Base, get_db
from app.models.agence import Agence
from app.models.analyse_ia import AnalyseIA
from app.models.demande_contact import DemandeContact
from app.models.enums import CriticiteType, SentimentType, UserRole
from app.models.feedback import Feedback
from app.models.organisation import Organisation
from app.models.qr_code import QRCode
from app.models.utilisateur import Utilisateur

SECRET = "SECRET-CLIENT-B-ne-doit-jamais-fuiter"
SECRET_A2 = "SECRET-AGENCE-A2-ne-doit-jamais-fuiter"


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
    app.include_router(feedbacks.router, prefix="/feedbacks")
    app.dependency_overrides[get_db] = override_db

    db = Session()
    now = datetime.now(timezone.utc)
    org_a, org_b, org_admin = (Organisation(id=uuid4(), nom=n, active=True) for n in ("Client A", "Client B", "Plateforme"))
    db.add_all([org_a, org_b, org_admin]); db.flush()
    a1 = Agence(id=uuid4(), organisation_id=org_a.id, nom="Agence A1", ville="Lyon", active=True, seuil_alerte=70)
    a2 = Agence(id=uuid4(), organisation_id=org_a.id, nom="Agence A2", ville="Lille", active=True, seuil_alerte=70)
    b1 = Agence(id=uuid4(), organisation_id=org_b.id, nom="Agence B1", ville="Paris", active=True, seuil_alerte=70)
    db.add_all([a1, a2, b1]); db.flush()
    qr = {code: QRCode(id=uuid4(), agence_id=ag.id, code=code, url=f"http://t/{code}", actif=True)
          for code, ag in [("QR-A1", a1), ("QR-A2", a2), ("QR-B1", b1)]}
    db.add_all(qr.values()); db.flush()

    def feedback(code, commentaire, note=1, jours=0, statut="nouveau", critique=True):
        fb = Feedback(id=uuid4(), qr_code_id=qr[code].id, note=note, commentaire=commentaire,
                      statut_traitement=statut, date_soumission=now - timedelta(days=jours))
        db.add(fb); db.flush()
        db.add(AnalyseIA(id=uuid4(), feedback_id=fb.id, sentiment=SentimentType.NEGATIF if critique else SentimentType.POSITIF,
                         criticite=CriticiteType.CRITIQUE if critique else CriticiteType.FAIBLE,
                         score_sentiment=0.1, theme_principal="attente"))
        return fb

    fb_a1 = feedback("QR-A1", "avis A1", note=2)
    fb_a1_ancien = feedback("QR-A1", "avis A1 ancien", note=5, jours=40, statut="resolu", critique=False)
    fb_a2 = feedback("QR-A2", SECRET_A2)
    fb_b1 = feedback("QR-B1", SECRET)
    dc_a2 = DemandeContact(id=uuid4(), feedback_id=fb_a2.id, nom="Client A2", telephone="0611111111", email="a2@example.com", souhaite_etre_rappele=True)
    dc_b1 = DemandeContact(id=uuid4(), feedback_id=fb_b1.id, nom="Client B", telephone="0600000000", email="client.b@example.com", souhaite_etre_rappele=True)
    db.add_all([dc_a2, dc_b1])

    def user(role, org, agence=None):
        u = Utilisateur(id=uuid4(), organisation_id=org.id, agence_id=agence.id if agence else None, nom="N", prenom="P",
                        email=f"{uuid4().hex[:10]}@test.io", mot_de_passe_hash=get_password_hash("Motdepasse-123"), role=role, active=True)
        db.add(u)
        return u

    users = dict(cx_a=user(UserRole.CX_MANAGER, org_a), cx_b=user(UserRole.CX_MANAGER, org_b),
                 am_a1=user(UserRole.AGENCY_MANAGER, org_a, a1), am_a2=user(UserRole.AGENCY_MANAGER, org_a, a2),
                 am_b1=user(UserRole.AGENCY_MANAGER, org_b, b1), admin=user(UserRole.ADMIN, org_admin))
    db.commit()
    ids = SimpleNamespace(**{k: v.id for k, v in dict(users, fb_a1=fb_a1, fb_a1_ancien=fb_a1_ancien, fb_a2=fb_a2, fb_b1=fb_b1,
                                                      dc_a2=dc_a2, dc_b1=dc_b1, a1=a1, a2=a2, b1=b1).items()})
    db.close()
    return SimpleNamespace(client=TestClient(app), Session=Session,
                           H=lambda uid: {"Authorization": f"Bearer {create_access_token(uid)}"}, **vars(ids))


def _requetes(c, fb):
    """Toutes les routes qui prennent un identifiant d'avis (méthode, chemin, corps)."""
    return [
        ("GET", f"/feedbacks/{fb}", None),
        ("POST", f"/feedbacks/{fb}/open", None),
        ("POST", f"/feedbacks/{fb}/notes", {"texte": "note interdite"}),
        ("POST", f"/feedbacks/{fb}/suggestion-agence", {"suggestion": "suggestion interdite"}),
        ("POST", f"/feedbacks/{fb}/action-cx", {"action": "action interdite"}),
        ("POST", f"/feedbacks/{fb}/confirmer-action", None),
        ("POST", f"/feedbacks/{fb}/reponses-client", {"contenu": "reponse interdite", "canal": "telephone"}),
        ("POST", f"/feedbacks/{fb}/reouvrir", None),
        ("GET", f"/feedbacks/{fb}/historique", None),
        ("GET", f"/feedbacks/{fb}/reponses", None),
    ]


def _empreinte(c):
    db = c.Session()
    try:
        return [(str(f.id), f.statut_traitement, f.action_a_prendre, f.note_interne if hasattr(f, "note_interne") else None,
                 str(f.assigne_a_id) if getattr(f, "assigne_a_id", None) else None)
                for f in db.query(Feedback).order_by(Feedback.id).all()], [(str(d.id), d.traitee) for d in db.query(DemandeContact).order_by(DemandeContact.id).all()]
    finally:
        db.close()


INTERDITS = [
    ("am_a1", "fb_a2"),   # autre agence, même organisation
    ("am_a1", "fb_b1"),   # autre organisation
    ("am_a2", "fb_a1"),
    ("am_b1", "fb_a1"),
    ("cx_a", "fb_b1"),    # CX : autre organisation
    ("cx_b", "fb_a1"),
    ("cx_b", "fb_a2"),
    ("admin", "fb_a1"),   # admin plateforme exclu des données clients
    ("admin", "fb_b1"),
]


@pytest.mark.parametrize("acteur,cible", INTERDITS)
def test_aucune_route_par_id_n_est_accessible_hors_perimetre(ctx, acteur, cible):
    avant = _empreinte(ctx)
    for methode, chemin, corps in _requetes(ctx, getattr(ctx, cible)):
        r = ctx.client.request(methode, chemin, headers=ctx.H(getattr(ctx, acteur)), json=corps)
        assert r.status_code in {403, 404}, f"{acteur} {methode} {chemin} -> {r.status_code}"
        assert SECRET not in r.text and SECRET_A2 not in r.text and "avis A1" not in r.text, f"fuite : {methode} {chemin}"
    assert _empreinte(ctx) == avant, "une tentative refusée a modifié la base"


@pytest.mark.parametrize("acteur,cible", [("am_a1", "dc_a2"), ("am_a1", "dc_b1"), ("cx_a", "dc_b1"), ("cx_b", "dc_a2"), ("admin", "dc_a2")])
def test_traiter_une_demande_de_contact_hors_perimetre_est_refuse(ctx, acteur, cible):
    avant = _empreinte(ctx)
    r = ctx.client.patch(f"/feedbacks/demandes-contact/{getattr(ctx, cible)}/traiter", headers=ctx.H(getattr(ctx, acteur)))
    assert r.status_code in {403, 404}
    assert "0600000000" not in r.text and "0611111111" not in r.text
    assert _empreinte(ctx) == avant


def test_autorises_peuvent_lire_le_detail(ctx):
    for acteur, cible in [("am_a1", "fb_a1"), ("am_a2", "fb_a2"), ("cx_a", "fb_a1"), ("cx_a", "fb_a2"), ("cx_b", "fb_b1"), ("am_b1", "fb_b1")]:
        r = ctx.client.get(f"/feedbacks/{getattr(ctx, cible)}", headers=ctx.H(getattr(ctx, acteur)))
        assert r.status_code == 200, f"{acteur}/{cible}"
        assert r.json()["id"] == str(getattr(ctx, cible))


def test_liste_est_cloisonnee_par_role(ctx):
    def ids(acteur, params=None):
        r = ctx.client.get("/feedbacks/", headers=ctx.H(getattr(ctx, acteur)), params=params)
        assert r.status_code == 200
        return {f["id"] for f in r.json()}, r.headers["x-total-count"]

    am, total = ids("am_a1")
    assert am == {str(ctx.fb_a1), str(ctx.fb_a1_ancien)} and total == "2"
    cx_a, total = ids("cx_a")
    assert cx_a == {str(ctx.fb_a1), str(ctx.fb_a1_ancien), str(ctx.fb_a2)} and total == "3"
    assert ids("cx_b")[0] == {str(ctx.fb_b1)}
    # Un identifiant d'agence fourni dans l'URL ne contourne pas le périmètre.
    assert ids("cx_a", {"agence_id": str(ctx.b1)})[0] == set()
    assert ids("am_a1", {"agence_id": str(ctx.a2)})[0] == am
    assert ids("am_a1", {"agence_id": str(ctx.b1)})[0] == am
    assert ctx.client.get("/feedbacks/", headers=ctx.H(ctx.admin)).status_code == 403


def test_demandes_contact_cloisonnees(ctx):
    def liste(acteur, params=None):
        r = ctx.client.get("/feedbacks/demandes-contact", headers=ctx.H(getattr(ctx, acteur)), params=params)
        assert r.status_code == 200
        return {d["id"] for d in r.json()}

    assert liste("am_a1") == set()
    assert liste("am_a2") == {str(ctx.dc_a2)}
    assert liste("cx_a") == {str(ctx.dc_a2)}
    assert liste("cx_a", {"agence_id": str(ctx.b1)}) == set()
    assert liste("cx_b") == {str(ctx.dc_b1)}
    assert ctx.client.get("/feedbacks/demandes-contact", headers=ctx.H(ctx.admin)).status_code == 403


def test_filtres_statut_et_dates(ctx):
    h = ctx.H(ctx.am_a1)
    r = ctx.client.get("/feedbacks/", headers=h, params={"statut": "resolu"})
    assert {f["id"] for f in r.json()} == {str(ctx.fb_a1_ancien)}
    debut = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    r = ctx.client.get("/feedbacks/", headers=h, params={"date_debut": debut})
    assert {f["id"] for f in r.json()} == {str(ctx.fb_a1)}
    r = ctx.client.get("/feedbacks/", headers=h, params={"statut": "inconnu"})
    assert r.status_code == 200 and r.json() == [] and r.headers["x-total-count"] == "0"


def test_liste_coherente_avec_ce_qui_est_enregistre(ctx):
    r = ctx.client.get(f"/feedbacks/{ctx.fb_a1}", headers=ctx.H(ctx.am_a1))
    f = r.json()
    assert f["note"] == 2 and f["commentaire"] == "avis A1"
    assert f["agence_nom"] == "Agence A1"
    assert f["analyse_ia"]["criticite"] == "critique" and f["analyse_ia"]["theme_principal"] == "attente"
    liste = {x["id"]: x for x in ctx.client.get("/feedbacks/", headers=ctx.H(ctx.am_a1)).json()}
    assert liste[str(ctx.fb_a1)]["note"] == 2 and liste[str(ctx.fb_a1)]["commentaire"] == "avis A1"


def test_sans_authentification_aucune_route_n_est_accessible(ctx):
    for methode, chemin, corps in _requetes(ctx, ctx.fb_a1) + [("GET", "/feedbacks/", None), ("GET", "/feedbacks/demandes-contact", None)]:
        r = ctx.client.request(methode, chemin, json=corps)
        assert r.status_code in {401, 403}, f"{methode} {chemin}"
        assert "avis A1" not in r.text


def test_cx_sans_organisation_ne_voit_rien(ctx):
    """Défense en profondeur : un CX dont l'organisation est absente n'obtient pas « tout »."""
    from app.api.v1.endpoints.feedbacks import _check_feedback_access
    from fastapi import HTTPException

    db = ctx.Session()
    fb = db.get(Feedback, ctx.fb_b1)
    cx = SimpleNamespace(role=UserRole.CX_MANAGER, organisation_id=None, agence_id=None)
    with pytest.raises(HTTPException) as exc:
        _check_feedback_access(fb, cx)
    assert exc.value.status_code == 403
    db.close()
