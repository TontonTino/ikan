"""
CL-05 « Partager une idée » : suggestion envoyée SEULE (sans note, sans feedback), côté serveur.

Vraie authentification JWT, vrais routeurs, SQLite en mémoire AVEC clés étrangères actives (PRAGMA) pour que la
suppression d'agence en cascade soit réellement exercée. Trois organisations, quatre agences dont une désactivée.
"""
import logging
import os
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-suggestions-sans-feedback-0123456789")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.endpoints import agences, dashboard, feedbacks, qr_codes, suggestions
from app.core.body_limit import LimiteCorpsPublic
from app.core.config import settings
from app.core.security import create_access_token, get_password_hash
from app.db.session import Base, get_db
from app.models.agence import Agence
from app.models.analyse_ia import AnalyseIA
from app.models.demande_contact import DemandeContact
from app.models.enums import IdeaStatus, UserRole
from app.models.feedback import Feedback
from app.models.historique_feedback import HistoriqueFeedback
from app.models.organisation import Organisation
from app.models.qr_code import QRCode
from app.models.suggestion import HistoriqueSuggestion, Suggestion
from app.models.utilisateur import Utilisateur
from app.services.kpi.engine import calculer_csat, calculer_feedback_volume
from app.services.plan_service import utilisation_organisation

ROUTE = "/api/v1/qr-codes/{}/suggestions"
HOSTILE = '<script>alert("x")</script><img src=x onerror=alert(1)> & "guillemets" \'apostrophes\''


@pytest.fixture()
def ctx(monkeypatch):
    analyses = []
    monkeypatch.setattr(feedbacks, "analyser_feedback", lambda feedback_id, db: analyses.append(feedback_id))
    monkeypatch.setattr(settings, "RATE_LIMIT_FEEDBACK_PAR_IP", 0)
    monkeypatch.setattr(settings, "RATE_LIMIT_FEEDBACK_PAR_QR", 0)
    monkeypatch.setattr(settings, "TRUSTED_PROXY_HOPS", 0)

    engine = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})

    for table in Base.metadata.sorted_tables:
        try:
            table.create(engine, checkfirst=True)
        except Exception:  # noqa: BLE001 — tables propres à PostgreSQL
            pass
    Session = sessionmaker(bind=engine)

    def _db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app = FastAPI()
    app.add_middleware(LimiteCorpsPublic)
    app.include_router(qr_codes.router, prefix="/api/v1/qr-codes")
    app.include_router(feedbacks.router, prefix="/api/v1/feedbacks")
    app.include_router(suggestions.router, prefix="/api/v1/suggestions")
    app.include_router(agences.router, prefix="/api/v1/agences")
    app.include_router(dashboard.router, prefix="/api/v1/dashboard")
    app.dependency_overrides[get_db] = _db

    db = Session()
    org_a, org_b, org_p = (Organisation(id=uuid4(), nom=n, active=True) for n in ("Client A", "Client B", "Plateforme"))
    db.add_all([org_a, org_b, org_p]); db.flush()
    a1 = Agence(id=uuid4(), organisation_id=org_a.id, nom="Agence A1", ville="Lyon", active=True, seuil_alerte=70)
    a2 = Agence(id=uuid4(), organisation_id=org_a.id, nom="Agence A2", ville="Lille", active=True, seuil_alerte=70)
    b1 = Agence(id=uuid4(), organisation_id=org_b.id, nom="Agence B1", ville="Paris", active=True, seuil_alerte=70)
    off = Agence(id=uuid4(), organisation_id=org_a.id, nom="Agence Fermée", ville="Nice", active=False, seuil_alerte=70)
    db.add_all([a1, a2, b1, off]); db.flush()
    qrs = {c: QRCode(id=uuid4(), agence_id=ag.id, code=c, url=f"http://t/{c}", actif=True)
           for c, ag in [("QR-A1", a1), ("QR-A2", a2), ("QR-B1", b1), ("QR-OFF", off)]}
    db.add_all(qrs.values()); db.flush()
    qrs["QR-A1-INACTIF"] = QRCode(id=uuid4(), agence_id=a2.id, code="QR-A2-INACTIF", url="http://t/x", actif=False)
    db.add(qrs["QR-A1-INACTIF"]); db.flush()

    # Un avis NOTÉ de l'agence A1 portant une suggestion (ancien parcours) : sert de témoin.
    fb = Feedback(id=uuid4(), qr_code_id=qrs["QR-A1"].id, note=5, commentaire="ok", statut_traitement="nouveau",
                  date_soumission=datetime.now(timezone.utc))
    db.add(fb); db.flush()
    ancienne = Suggestion(id=uuid4(), feedback_id=fb.id, contenu="ancienne idée A1")
    db.add(ancienne)

    def user(role, org, agence=None):
        u = Utilisateur(id=uuid4(), organisation_id=org.id, agence_id=agence.id if agence else None, nom="N", prenom="P",
                        email=f"{uuid4().hex[:10]}@test.io", mot_de_passe_hash=get_password_hash("Motdepasse-123"),
                        role=role, active=True)
        db.add(u)
        return u

    users = dict(cx_a=user(UserRole.CX_MANAGER, org_a), cx_b=user(UserRole.CX_MANAGER, org_b),
                 am_a1=user(UserRole.AGENCY_MANAGER, org_a, a1), am_a2=user(UserRole.AGENCY_MANAGER, org_a, a2),
                 am_b1=user(UserRole.AGENCY_MANAGER, org_b, b1), admin=user(UserRole.ADMIN, org_p))
    db.commit()
    # Clés étrangères actives APRÈS le jeu de données (les organisations de test n'ont pas de forfait en base) : la
    # cascade de suppression d'agence est ainsi réellement appliquée par SQLite.
    db.connection().exec_driver_sql("PRAGMA foreign_keys=ON")
    ids = SimpleNamespace(**{k: v.id for k, v in dict(users, a1=a1, a2=a2, b1=b1, off=off, org_a=org_a, org_b=org_b,
                                                      ancienne=ancienne).items()})
    db.close()

    client = TestClient(app)

    def lignes(modele):
        s = Session()
        try:
            return s.query(modele).count()
        finally:
            s.close()

    return SimpleNamespace(client=client, Session=Session, ids=ids, analyses=analyses, lignes=lignes,
                           H=lambda uid: {"Authorization": f"Bearer {create_access_token(uid)}"})


def poster(ctx, code="QR-A1", **corps):
    corps = {"contenu": "Ajouter une rampe d'accès à l'entrée.", **corps}
    return ctx.client.post(ROUTE.format(code), json=corps)


def suggestions_en_base(ctx):
    s = ctx.Session()
    try:
        return s.query(Suggestion).filter(Suggestion.feedback_id.is_(None)).all()
    finally:
        s.close()


# ───────────────────────── enregistrement ─────────────────────────

def test_suggestion_enregistree_avec_statut_nouveau_et_rattachee_a_l_agence_du_qr(ctx):
    r = poster(ctx, "QR-A1")
    assert r.status_code == 201, r.text
    assert set(r.json()) == {"message"} and "transmise" in r.json()["message"]
    [s] = suggestions_en_base(ctx)
    assert s.statut == IdeaStatus.NOUVEAU
    assert s.agence_id == ctx.ids.a1 and s.feedback_id is None
    assert s.contenu == "Ajouter une rampe d'accès à l'entrée."
    # aucune trace d'un avis : ni feedback, ni analyse, ni historique d'avis, ni contact
    assert ctx.lignes(Feedback) == 1  # le seul avis est le témoin de la fixture
    assert (ctx.lignes(AnalyseIA), ctx.lignes(HistoriqueFeedback), ctx.lignes(DemandeContact)) == (0, 0, 0)
    assert ctx.analyses == []


def test_chaque_qr_rattache_a_sa_propre_agence(ctx):
    poster(ctx, "QR-A2"); poster(ctx, "QR-B1")
    par_agence = {s.agence_id for s in suggestions_en_base(ctx)}
    assert par_agence == {ctx.ids.a2, ctx.ids.b1}


def test_aucun_champ_de_contact_n_est_conserve(ctx):
    r = poster(ctx, contact_telephone="+22670123456", contact_email="a@b.fr", souhaite_etre_rappele=True)
    assert r.status_code == 201
    assert ctx.lignes(DemandeContact) == 0


def test_une_suggestion_envoyee_seule_ne_modifie_ni_csat_ni_volume_ni_quota(ctx):
    s = ctx.Session()
    org = ctx.ids.org_a

    def mesures():
        csat = calculer_csat(s, org, None, 30)
        volume = calculer_feedback_volume(s, org, None, 30)
        quota = utilisation_organisation(s, org)["feedbacks_ce_mois"]["actuel"]
        s.expire_all()
        return csat.value, csat.denominator, volume.value, quota

    avant = mesures()
    assert avant[2] == 1.0 and avant[3] == 1   # le seul avis noté de l'organisation
    for _ in range(3):
        assert poster(ctx, "QR-A1").status_code == 201
    assert mesures() == avant
    s.close()


def test_le_texte_hostile_est_stocke_et_restitue_tel_quel(ctx):
    assert poster(ctx, contenu=HOSTILE).status_code == 201
    r = ctx.client.get("/api/v1/suggestions/", headers=ctx.H(ctx.ids.am_a1))
    assert r.status_code == 200
    assert HOSTILE in [x["contenu"] for x in r.json()]
    assert r.headers["content-type"].startswith("application/json")  # jamais du HTML


# ───────────────────────── protections du formulaire public ─────────────────────────

def test_limitation_de_debit_par_ip_sans_rien_enregistrer(ctx, monkeypatch):
    monkeypatch.setattr(settings, "RATE_LIMIT_FEEDBACK_PAR_IP", 2)
    assert [poster(ctx).status_code for _ in range(2)] == [201, 201]
    avant = len(suggestions_en_base(ctx))
    r = poster(ctx)
    assert r.status_code == 429 and "Trop de demandes" in r.json()["detail"] and int(r.headers["Retry-After"]) >= 1
    assert len(suggestions_en_base(ctx)) == avant


def test_limitation_par_qr_depuis_des_ip_differentes(ctx, monkeypatch):
    monkeypatch.setattr(settings, "RATE_LIMIT_FEEDBACK_PAR_QR", 2)
    monkeypatch.setattr(settings, "TRUSTED_PROXY_HOPS", 1)
    codes = [poster(ctx, "QR-A1").status_code for _ in range(2)]
    ctx.client.headers.update({"X-Forwarded-For": "10.0.0.1"})
    assert codes == [201, 201]
    assert poster(ctx, "QR-A1").status_code == 429
    assert poster(ctx, "QR-A2").status_code == 201


def test_le_budget_est_partage_avec_l_envoi_d_un_avis(ctx, monkeypatch):
    """Un avis et une idée sont le même formulaire public : alterner ne double pas le budget d'une IP."""
    monkeypatch.setattr(settings, "RATE_LIMIT_FEEDBACK_PAR_IP", 2)
    cat = ctx.Session()
    from app.models.categorie import Categorie
    categorie_id = uuid4()
    cat.add(Categorie(id=categorie_id, agence_id=ctx.ids.a1, nom="Accueil", active=True)); cat.commit(); cat.close()
    avis = ctx.client.post("/api/v1/feedbacks/", params={"qr_code": "QR-A1"}, json={"categorie_id": str(categorie_id), "note": 4})
    assert avis.status_code == 201
    assert poster(ctx).status_code == 201
    assert poster(ctx).status_code == 429


def test_champ_piege_repond_comme_un_succes_sans_rien_enregistrer(ctx):
    avant = ctx.lignes(Suggestion)
    r = poster(ctx, website="http://spam.example")
    assert r.status_code == 201 and set(r.json()) == {"message"}
    assert ctx.lignes(Suggestion) == avant


@pytest.mark.parametrize("code", ["QR-INCONNU", "QR-A2-INACTIF", "QR-OFF"])
def test_qr_inconnu_inactif_ou_agence_desactivee_repond_404_sans_rien_enregistrer(ctx, code):
    avant = ctx.lignes(Suggestion)
    assert poster(ctx, code).status_code == 404
    assert ctx.lignes(Suggestion) == avant


def test_agence_desactivee_par_uuid_repond_404_et_agence_active_par_uuid_fonctionne(ctx):
    avant = ctx.lignes(Suggestion)
    assert poster(ctx, str(ctx.ids.off)).status_code == 404
    assert ctx.lignes(Suggestion) == avant
    assert poster(ctx, str(ctx.ids.a1)).status_code == 201
    assert suggestions_en_base(ctx)[0].agence_id == ctx.ids.a1


@pytest.mark.parametrize("contenu", ["", "   ", "ab", "  a  "])
def test_idee_vide_ou_trop_courte_refusee(ctx, contenu):
    r = poster(ctx, contenu=contenu)
    assert r.status_code == 422
    assert ctx.lignes(Suggestion) == 1


def test_taille_maximale_1000_caracteres(ctx):
    assert poster(ctx, contenu="x" * 1000).status_code == 201
    assert poster(ctx, contenu="x" * 1001).status_code == 422
    assert len(suggestions_en_base(ctx)) == 1


def test_corps_trop_volumineux_refuse_en_413(ctx):
    avant = ctx.lignes(Suggestion)
    r = ctx.client.post(ROUTE.format("QR-A1"), content=b'{"contenu": "' + b"x" * (settings.PUBLIC_BODY_MAX_OCTETS + 10) + b'"}',
                        headers={"Content-Type": "application/json"})
    assert r.status_code == 413
    assert ctx.lignes(Suggestion) == avant


def test_aucune_authentification_requise_et_le_journal_ne_contient_pas_le_texte(ctx, monkeypatch, caplog):
    def explose(*a, **k):
        raise RuntimeError("INSERT suggestions ... Idée très confidentielle")
    monkeypatch.setattr(qr_codes, "Suggestion", explose)
    with caplog.at_level(logging.DEBUG):
        r = poster(ctx, contenu="Idée très confidentielle")
    assert r.status_code == 500
    assert "confidentielle" not in caplog.text and "INSERT" not in caplog.text
    assert all(rec.exc_info is None for rec in caplog.records)


# ───────────────────────── isolation ─────────────────────────

def _liste(ctx, acteur, **params):
    r = ctx.client.get("/api/v1/suggestions/", headers=ctx.H(getattr(ctx.ids, acteur)), params=params)
    return r


def _contenus(r):
    assert r.status_code == 200, r.text
    return {s["contenu"] for s in r.json()}


def test_agency_manager_voit_les_suggestions_de_son_agence_uniquement(ctx):
    poster(ctx, "QR-A1", contenu="idée sans avis A1")
    poster(ctx, "QR-A2", contenu="idée sans avis A2")
    poster(ctx, "QR-B1", contenu="IDEE-SECRETE-B")
    vues = _liste(ctx, "am_a1")
    assert _contenus(vues) == {"ancienne idée A1", "idée sans avis A1"}
    assert "idée sans avis A2" not in vues.text and "IDEE-SECRETE-B" not in vues.text
    assert _contenus(_liste(ctx, "am_a2")) == {"idée sans avis A2"}
    assert _contenus(_liste(ctx, "am_b1")) == {"IDEE-SECRETE-B"}


def test_cx_manager_voit_son_organisation_uniquement_avec_le_statut_nouveau(ctx):
    poster(ctx, "QR-A1", contenu="idée sans avis A1")
    poster(ctx, "QR-A2", contenu="idée sans avis A2")
    poster(ctx, "QR-B1", contenu="IDEE-SECRETE-B")
    r = _liste(ctx, "cx_a")
    assert _contenus(r) == {"ancienne idée A1", "idée sans avis A1", "idée sans avis A2"}
    assert {s["statut"] for s in r.json()} == {"nouveau"}
    assert "IDEE-SECRETE-B" not in r.text
    assert _contenus(_liste(ctx, "cx_b")) == {"IDEE-SECRETE-B"}
    # filtre d'agence : ne s'ajoute qu'au périmètre
    assert _contenus(_liste(ctx, "cx_a", agence_id=str(ctx.ids.a2))) == {"idée sans avis A2"}
    r = _liste(ctx, "cx_a", agence_id=str(ctx.ids.b1))
    assert r.status_code == 200 and r.json() == []


def test_admin_n_a_aucun_acces(ctx):
    poster(ctx, "QR-A1")
    assert _liste(ctx, "admin").status_code == 403


def test_detail_et_changement_de_statut_refuses_hors_perimetre(ctx):
    poster(ctx, "QR-A1", contenu="idée sans avis A1")
    sid = str(suggestions_en_base(ctx)[0].id)
    for acteur in ("am_a2", "am_b1", "cx_b", "admin"):
        h = ctx.H(getattr(ctx.ids, acteur))
        assert ctx.client.get(f"/api/v1/suggestions/{sid}", headers=h).status_code == 403, acteur
        r = ctx.client.patch(f"/api/v1/suggestions/{sid}/statut", headers=h, json={"statut": "rejete"})
        assert r.status_code == 403, acteur
    assert suggestions_en_base(ctx)[0].statut == IdeaStatus.NOUVEAU
    # le bon périmètre peut lire et traiter
    for acteur in ("am_a1", "cx_a"):
        assert ctx.client.get(f"/api/v1/suggestions/{sid}", headers=ctx.H(getattr(ctx.ids, acteur))).status_code == 200


def test_changement_de_statut_dans_le_perimetre_est_trace_et_visible_dans_l_activite(ctx):
    poster(ctx, "QR-A1", contenu="idée sans avis A1")
    sid = str(suggestions_en_base(ctx)[0].id)
    r = ctx.client.patch(f"/api/v1/suggestions/{sid}/statut", headers=ctx.H(ctx.ids.am_a1),
                         json={"statut": "en_cours", "commentaire": "à étudier"})
    assert r.status_code == 200 and r.json()["statut"] == "en_cours"
    assert ctx.lignes(HistoriqueSuggestion) == 1
    act = ctx.client.get(f"/api/v1/agences/{ctx.ids.a1}/activite", headers=ctx.H(ctx.ids.am_a1))
    assert act.status_code == 200
    assert "suggestion_en_cours" in {e["type_evenement"] for e in act.json()}
    # l'activité d'une autre agence ne la montre pas
    autre = ctx.client.get(f"/api/v1/agences/{ctx.ids.a2}/activite", headers=ctx.H(ctx.ids.cx_a))
    assert "suggestion_en_cours" not in {e["type_evenement"] for e in autre.json()}


# ───────────────────────── tableaux de bord ─────────────────────────

def test_les_tableaux_de_bord_comptent_les_suggestions_sans_feedback(ctx):
    poster(ctx, "QR-A1"); poster(ctx, "QR-A1"); poster(ctx, "QR-A2"); poster(ctx, "QR-B1")
    ag = ctx.client.get(f"/api/v1/dashboard/agence/{ctx.ids.a1}", headers=ctx.H(ctx.ids.am_a1))
    assert ag.status_code == 200, ag.text
    assert ag.json()["nombre_suggestions"] == 3    # l'ancienne (avec avis) + 2 idées seules
    assert ag.json()["nombre_feedbacks"] == 1      # les idées seules ne sont PAS des avis
    siege = ctx.client.get("/api/v1/dashboard/siege", headers=ctx.H(ctx.ids.cx_a))
    assert siege.status_code == 200, siege.text
    corps = siege.json()
    assert corps["idees_en_attente"] == 4          # ancienne + 3 idées seules de l'organisation A (pas B1)
    assert corps["feedbacks_total"] == 1
    par_agence = {k["agence_nom"]: k for k in corps["agences"]}
    assert par_agence["Agence A1"]["nombre_suggestions"] == 3 and par_agence["Agence A1"]["nombre_feedbacks"] == 1
    assert par_agence["Agence A2"]["nombre_suggestions"] == 1 and par_agence["Agence A2"]["nombre_feedbacks"] == 0
    assert "Agence B1" not in par_agence
    assert ctx.client.get("/api/v1/dashboard/siege", headers=ctx.H(ctx.ids.admin)).status_code == 403
    autre = ctx.client.get("/api/v1/dashboard/siege", headers=ctx.H(ctx.ids.cx_b))
    assert autre.json()["idees_en_attente"] == 1


# ───────────────────────── suppression d'agence ─────────────────────────

def test_supprimer_une_agence_supprime_aussi_ses_suggestions_sans_feedback(ctx):
    """Une agence SANS AVIS se supprime ; ses suggestions sans feedback partent avec elle (FK agence_id ON DELETE CASCADE) :
    elles ne restent jamais orphelines ni ne survivent à leur agence. Une agence qui a des avis (A1, qui porte l'avis témoin)
    n'est plus supprimable (409, PR B) : rien n'est alors supprimé, pas même ses suggestions."""
    poster(ctx, "QR-A1", contenu="idée seule A1"); poster(ctx, "QR-A2", contenu="idée seule A2")

    refus = ctx.client.delete(f"/api/v1/agences/{ctx.ids.a1}", headers=ctx.H(ctx.ids.cx_a))
    assert refus.status_code == 409, refus.text
    s = ctx.Session()
    assert {x.contenu for x in s.query(Suggestion).all()} == {"ancienne idée A1", "idée seule A1", "idée seule A2"}
    s.close()

    r = ctx.client.delete(f"/api/v1/agences/{ctx.ids.a2}", headers=ctx.H(ctx.ids.cx_a))
    assert r.status_code == 204, r.text
    s = ctx.Session()
    restantes = {x.contenu for x in s.query(Suggestion).all()}
    s.close()
    assert restantes == {"ancienne idée A1", "idée seule A1"}      # idée seule A2 supprimée avec son agence, celles de A1 intactes
    assert ctx.lignes(HistoriqueSuggestion) == 0
