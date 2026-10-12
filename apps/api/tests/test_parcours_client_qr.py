"""
Parcours client par QR Code — association agence/feedback, validations et idempotence de l'envoi.

Public, sans authentification. Base SQLite en mémoire, même pattern que test_feedbacks_nps.py (l'analyse IA est
remplacée par un double : ces tests couvrent le rattachement, les validations et les doublons, pas l'analyse).
"""
import os
from types import SimpleNamespace
from uuid import uuid4

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-parcours-client-qr-0123456789")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_db
from app.api.v1.endpoints import feedbacks, qr_codes
from app.db.session import Base
from app.models.agence import Agence
from app.models.analyse_ia import AnalyseIA
from app.models.categorie import Categorie
from app.models.demande_contact import DemandeContact
from app.models.feedback import Feedback
from app.models.historique_feedback import HistoriqueFeedback
from app.models.organisation import Organisation
from app.models.qr_code import QRCode
from app.models.system_settings import SystemSettings
from app.models.utilisateur import Utilisateur


@pytest.fixture()
def ctx(monkeypatch):
    monkeypatch.setattr(feedbacks, "analyser_feedback", lambda feedback_id, db: None)

    engine = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(
        engine,
        tables=[Organisation.__table__, Agence.__table__, Utilisateur.__table__, QRCode.__table__,
                Categorie.__table__, Feedback.__table__, HistoriqueFeedback.__table__,
                DemandeContact.__table__, AnalyseIA.__table__, SystemSettings.__table__],
    )
    Session = sessionmaker(bind=engine)
    db = Session()

    def creer_agence(nom, code_qr, org, *, active=True, ville=None, qr_actif=True):
        agence = Agence(id=uuid4(), organisation_id=org.id, nom=nom, ville=ville, active=active)
        db.add(agence)
        db.flush()
        qr = QRCode(id=uuid4(), agence_id=agence.id, code=code_qr, url=f"http://test/{code_qr}", actif=qr_actif)
        db.add(qr)
        db.flush()
        cat = Categorie(id=uuid4(), agence_id=agence.id, nom=f"Cat {nom}", active=True)
        db.add(cat)
        db.flush()
        return SimpleNamespace(agence=agence.id, qr=qr.id, categorie=cat.id, code=code_qr)

    org_a = Organisation(id=uuid4(), nom="Org A", active=True)
    org_b = Organisation(id=uuid4(), nom="Org B", active=True)
    db.add_all([org_a, org_b])
    db.flush()
    a1 = creer_agence("Agence Tunis Centre", "QR-A1", org_a, ville="Tunis")
    a2 = creer_agence("Agence Sfax", "QR-A2", org_a, ville="Sfax")
    b1 = creer_agence("Agence Tunis Autre Org", "QR-B1", org_b, ville="Tunis")
    inactive = creer_agence("Agence Fermee", "QR-FERMEE", org_a, active=False, qr_actif=False)
    db.commit()
    db.close()

    def _db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app = FastAPI()
    app.include_router(feedbacks.router, prefix="/feedbacks")
    app.include_router(qr_codes.router, prefix="/qr-codes")
    app.dependency_overrides[get_db] = _db
    client = TestClient(app)

    def feedbacks_en_base():
        s = Session()
        try:
            return [
                SimpleNamespace(id=f.id, qr=f.qr_code_id, note=f.note, commentaire=f.commentaire, cle=f.cle_idempotence)
                for f in s.query(Feedback).all()
            ]
        finally:
            s.close()

    return SimpleNamespace(client=client, a1=a1, a2=a2, b1=b1, inactive=inactive, feedbacks=feedbacks_en_base, Session=Session)


def envoyer(ctx, agence, code=None, **extra):
    corps = {"categorie_id": str(agence.categorie), "note": 4, **extra}
    return ctx.client.post("/feedbacks/", params={"qr_code": code or agence.code}, json=corps)


# ───────────────────────── association à la bonne agence ─────────────────────────

def test_le_qr_code_rattache_le_feedback_a_son_agence_et_a_aucune_autre(ctx):
    r = envoyer(ctx, ctx.a2)
    assert r.status_code == 201, r.text
    en_base = ctx.feedbacks()
    assert len(en_base) == 1 and en_base[0].qr == ctx.a2.qr


def test_validate_et_submit_resolvent_le_meme_qr(ctx):
    v = ctx.client.get(f"/qr-codes/{ctx.a1.code}/validate")
    assert v.status_code == 200 and v.json()["agence_nom"] == "Agence Tunis Centre"
    assert v.json()["qr_code_id"] == str(ctx.a1.qr)
    assert envoyer(ctx, ctx.a1).status_code == 201
    assert ctx.feedbacks()[0].qr == ctx.a1.qr


def test_le_code_est_insensible_a_la_casse_et_aux_espaces(ctx):
    assert envoyer(ctx, ctx.a1, code="  qr-a1 ").status_code == 201


@pytest.mark.parametrize("code", ["QR-INCONNU", "tunis", "Tunis Centre", "sfax", "Agence", "%", "_", "a", "%%", "QR-A"])
def test_code_inconnu_partiel_ou_joker_ne_rattache_a_aucune_agence(ctx, code):
    """Avant correction, POST /feedbacks résolvait un code inconnu par ILIKE sur le nom/la ville de TOUTES les
    organisations : « tunis » ou « % » créait un avis sur la première agence trouvée."""
    r = ctx.client.post("/feedbacks/", params={"qr_code": code}, json={"categorie_id": str(ctx.a1.categorie), "note": 3})
    assert r.status_code == 404, r.text
    assert ctx.feedbacks() == []


def test_agence_et_qr_inactifs_sont_refuses_sans_rien_creer(ctx):
    assert envoyer(ctx, ctx.inactive).status_code == 404
    assert ctx.client.get(f"/qr-codes/{ctx.inactive.code}/validate").status_code == 404
    assert ctx.feedbacks() == []


def test_uuid_d_une_agence_inactive_n_est_pas_un_point_d_entree(ctx):
    r = ctx.client.post(
        "/feedbacks/", params={"qr_code": str(ctx.inactive.agence)},
        json={"categorie_id": str(ctx.inactive.categorie), "note": 3},
    )
    assert r.status_code == 404 and ctx.feedbacks() == []


def test_categorie_d_une_autre_agence_est_refusee(ctx):
    r = ctx.client.post(
        "/feedbacks/", params={"qr_code": ctx.a1.code},
        json={"categorie_id": str(ctx.b1.categorie), "note": 3},
    )
    assert r.status_code == 400 and ctx.feedbacks() == []


def test_les_categories_publiques_sont_celles_de_l_agence_du_qr(ctx):
    r = ctx.client.get(f"/qr-codes/{ctx.a2.code}/categories")
    assert r.status_code == 200 and [c["id"] for c in r.json()] == [str(ctx.a2.categorie)]


def test_qr_invalide_donne_une_erreur_sans_detail_technique(ctx):
    r = ctx.client.get("/qr-codes/QR-INCONNU/validate")
    assert r.status_code == 404 and "Traceback" not in r.text


# ───────────────────────── validations du formulaire ─────────────────────────

def test_commentaire_facultatif(ctx):
    r = envoyer(ctx, ctx.a1)
    assert r.status_code == 201
    assert ctx.feedbacks()[0].commentaire in (None, "")


def test_commentaire_de_1000_caracteres_accepte_1001_refuse(ctx):
    assert envoyer(ctx, ctx.a1, commentaire="x" * 1000).status_code == 201
    assert envoyer(ctx, ctx.a1, commentaire="x" * 1001).status_code == 422
    assert len(ctx.feedbacks()) == 1


@pytest.mark.parametrize("note", [0, 6, -1])
def test_note_hors_de_1_a_5_refusee(ctx, note):
    assert envoyer(ctx, ctx.a1, note=note).status_code == 422
    assert ctx.feedbacks() == []


@pytest.mark.parametrize("cle", ["court", "a" * 65, "cle avec espaces", "clé-accentuée-123", "../../etc/passwd"])
def test_cle_d_idempotence_mal_formee_refusee(ctx, cle):
    assert envoyer(ctx, ctx.a1, idempotency_key=cle).status_code == 422
    assert ctx.feedbacks() == []


def test_erreur_serveur_ne_divulgue_pas_le_detail_interne(ctx, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("secret-interne-ne-pas-divulguer")

    monkeypatch.setattr(feedbacks, "HistoriqueFeedback", boom)
    r = envoyer(ctx, ctx.a1)
    assert r.status_code == 500 and "secret-interne" not in r.text and ctx.feedbacks() == []


# ───────────────────────── idempotence : un seul feedback par envoi ─────────────────────────

CLE = "envoi-2026-aaaa-bbbb-0001"


def test_renvoi_avec_la_meme_cle_ne_cree_qu_un_feedback(ctx):
    premier = envoyer(ctx, ctx.a1, idempotency_key=CLE, commentaire="Attente trop longue")
    second = envoyer(ctx, ctx.a1, idempotency_key=CLE, commentaire="Attente trop longue")
    assert premier.status_code == 201 and second.status_code == 200
    assert premier.json()["id"] == second.json()["id"]
    assert len(ctx.feedbacks()) == 1
    # la réponse rejouée porte un jeton NPS utilisable : la 1re réponse a pu être perdue côté client
    assert second.json()["nps_token"]


def test_deux_clients_differents_au_meme_comptoir_creent_deux_feedbacks(ctx):
    """Même note, même catégorie, même minute, SANS commentaire : seuls des envois distincts (clés distinctes)
    doivent compter — d'où une clé par envoi plutôt qu'une détection par contenu."""
    r1 = envoyer(ctx, ctx.a1, idempotency_key="client-un-0000001")
    r2 = envoyer(ctx, ctx.a1, idempotency_key="client-deux-000002")
    assert r1.status_code == r2.status_code == 201 and r1.json()["id"] != r2.json()["id"]
    assert len(ctx.feedbacks()) == 2


def test_envoi_sans_cle_reste_possible_comme_avant(ctx):
    assert envoyer(ctx, ctx.a1).status_code == 201 and envoyer(ctx, ctx.a1).status_code == 201
    assert len(ctx.feedbacks()) == 2


def test_la_meme_cle_sur_deux_agences_ne_melange_rien(ctx):
    r1 = envoyer(ctx, ctx.a1, idempotency_key=CLE)
    r2 = envoyer(ctx, ctx.a2, idempotency_key=CLE)
    assert r1.status_code == r2.status_code == 201
    assert {f.qr for f in ctx.feedbacks()} == {ctx.a1.qr, ctx.a2.qr}


def test_un_renvoi_reste_valide_meme_si_la_categorie_a_ete_desactivee_entre_temps(ctx):
    assert envoyer(ctx, ctx.a1, idempotency_key=CLE).status_code == 201
    s = ctx.Session()
    s.query(Categorie).filter(Categorie.id == ctx.a1.categorie).update({"active": False})
    s.commit()
    s.close()
    assert envoyer(ctx, ctx.a1, idempotency_key=CLE).status_code == 200
    assert len(ctx.feedbacks()) == 1


def test_une_course_perdue_sur_la_contrainte_d_unicite_rend_le_feedback_du_premier(ctx, monkeypatch):
    """Simule la fenêtre de course : la recherche préalable ne voit rien, l'insertion se heurte à l'unicité."""
    assert envoyer(ctx, ctx.a1, idempotency_key=CLE).status_code == 201
    vrai = feedbacks._feedback_par_cle
    appels = {"n": 0}

    def aveugle_au_premier_appel(db, qr_id, cle):
        appels["n"] += 1
        return None if appels["n"] == 1 else vrai(db, qr_id, cle)

    monkeypatch.setattr(feedbacks, "_feedback_par_cle", aveugle_au_premier_appel)
    r = envoyer(ctx, ctx.a1, idempotency_key=CLE)
    assert r.status_code == 200 and len(ctx.feedbacks()) == 1
