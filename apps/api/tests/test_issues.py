"""
Issues / ActionCorrective — cycle de vie, durcissement et cloisonnement inter-organisation.
Base SQLite en mémoire (comme test_veille_mentions.py / test_categories_permissions.py) —
seule façon d'exercer réellement le workflow et l'isolation sans toucher la base partagée.

Workflow V1 volontairement conservé tel quel (validé explicitement, pas de nouveaux statuts
'en_analyse'/'action_requise') : ouverte → action_en_cours → resolue → verifiee, avec
réouverture (verifiee → reouverte) déclenchée par un rattachement de feedback ou une
nouvelle action, qui repasse ensuite immédiatement par action_en_cours.
"""
import os
from types import SimpleNamespace
from uuid import UUID, uuid4

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-issues-tests-0123456789")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_current_active_user
from app.api.v1.endpoints import issues
from app.db.session import Base, get_db
from app.models.action_corrective import ActionCorrective
from app.models.agence import Agence
from app.models.analyse_ia import AnalyseIA
from app.models.categorie import Categorie
from app.models.demande_contact import DemandeContact
from app.models.enums import CriticiteType, UserRole
from app.models.feedback import Feedback
from app.models.historique_issue import HistoriqueIssue
from app.models.issue import Issue
from app.models.organisation import Organisation
from app.models.plan import Plan
from app.models.qr_code import QRCode
from app.models.utilisateur import Utilisateur


@pytest.fixture()
def ctx():
    engine = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(
        engine,
        tables=[
            Plan.__table__, Organisation.__table__, Agence.__table__, Utilisateur.__table__,
            QRCode.__table__, Feedback.__table__, Categorie.__table__, AnalyseIA.__table__,
            DemandeContact.__table__, Issue.__table__, ActionCorrective.__table__, HistoriqueIssue.__table__,
        ],
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

    cx_a = Utilisateur(id=uuid4(), organisation_id=org_a.id, nom="N", prenom="CX-A", email="cxa@test.bf",
                        mot_de_passe_hash="x", role=UserRole.CX_MANAGER, active=True)
    am_a = Utilisateur(id=uuid4(), organisation_id=org_a.id, agence_id=agence_a.id, nom="N", prenom="AM-A",
                        email="ama@test.bf", mot_de_passe_hash="x", role=UserRole.AGENCY_MANAGER, active=True)
    cx_b = Utilisateur(id=uuid4(), organisation_id=org_b.id, nom="N", prenom="CX-B", email="cxb@test.bf",
                        mot_de_passe_hash="x", role=UserRole.CX_MANAGER, active=True)
    am_b = Utilisateur(id=uuid4(), organisation_id=org_b.id, agence_id=agence_b.id, nom="N", prenom="AM-B",
                        email="amb@test.bf", mot_de_passe_hash="x", role=UserRole.AGENCY_MANAGER, active=True)
    db.add_all([cx_a, am_a, cx_b, am_b])
    db.flush()

    qr_a = QRCode(id=uuid4(), agence_id=agence_a.id, code="QR-A", url="http://test/a", actif=True)
    qr_b = QRCode(id=uuid4(), agence_id=agence_b.id, code="QR-B", url="http://test/b", actif=True)
    db.add_all([qr_a, qr_b])
    db.flush()

    fb_a = Feedback(id=uuid4(), qr_code_id=qr_a.id, note=2, commentaire="Feedback A", statut_traitement="nouveau")
    fb_b = Feedback(id=uuid4(), qr_code_id=qr_b.id, note=2, commentaire="Feedback B", statut_traitement="nouveau")
    db.add_all([fb_a, fb_b])
    db.commit()

    ids = SimpleNamespace(
        org_a=org_a.id, org_b=org_b.id, agence_a=agence_a.id, agence_b=agence_b.id,
        cx_a=cx_a.id, am_a=am_a.id, cx_b=cx_b.id, am_b=am_b.id, fb_a=fb_a.id, fb_b=fb_b.id,
    )
    db.close()

    def _db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app = FastAPI()
    app.include_router(issues.router, prefix="/issues")
    app.dependency_overrides[get_db] = _db

    users = {
        "cx_a": SimpleNamespace(id=ids.cx_a, role=UserRole.CX_MANAGER, active=True, agence_id=None, organisation_id=ids.org_a, nom="A", prenom="CX"),
        "am_a": SimpleNamespace(id=ids.am_a, role=UserRole.AGENCY_MANAGER, active=True, agence_id=ids.agence_a, organisation_id=ids.org_a, nom="A", prenom="AM"),
        "cx_b": SimpleNamespace(id=ids.cx_b, role=UserRole.CX_MANAGER, active=True, agence_id=None, organisation_id=ids.org_b, nom="B", prenom="CX"),
        "am_b": SimpleNamespace(id=ids.am_b, role=UserRole.AGENCY_MANAGER, active=True, agence_id=ids.agence_b, organisation_id=ids.org_b, nom="B", prenom="AM"),
    }
    client = TestClient(app)

    def call(user_key, method, path, **kw):
        # L'override vit sur l'app FastAPI PARTAGEE : le reappliquer juste avant CHAQUE appel.
        app.dependency_overrides[get_current_active_user] = lambda: users[user_key]
        return getattr(client, method)(path, **kw)

    return SimpleNamespace(Session=Session, call=call, **vars(ids))


def _creer_issue(ctx, user_key="cx_a", agence_id=None, titre="Issue test"):
    r = ctx.call(user_key, "post", "/issues/", json={"titre": titre, "agence_id": str(agence_id or ctx.agence_a)})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _creer_action(ctx, issue_id, user_key="cx_a", titre="Action test", **extra):
    return ctx.call(user_key, "post", f"/issues/{issue_id}/actions", json={"titre": titre, **extra})


# ── Création / lecture ──────────────────────────────────────────────────────────

def test_creation_issue_valide(ctx):
    r = ctx.call("cx_a", "post", "/issues/", json={"titre": "Attente au guichet", "agence_id": str(ctx.agence_a)})
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["organisation_id"] == str(ctx.org_a)
    assert data["agence_id"] == str(ctx.agence_a)
    assert data["statut"] == "ouverte"
    assert data["necessite_action"] is False


def test_creation_par_agency_manager(ctx):
    r = ctx.call("am_a", "post", "/issues/", json={"titre": "Bruit en salle", "agence_id": str(ctx.agence_a)})
    assert r.status_code == 201, r.text


def test_detail_et_liste(ctx):
    issue_id = _creer_issue(ctx)
    r = ctx.call("cx_a", "get", f"/issues/{issue_id}")
    assert r.status_code == 200
    assert r.json()["feedbacks"] == []
    assert r.json()["actions"] == []

    r = ctx.call("cx_a", "get", "/issues/")
    assert r.status_code == 200
    assert any(i["id"] == issue_id for i in r.json())


def test_issue_inexistante_404(ctx):
    assert ctx.call("cx_a", "get", f"/issues/{uuid4()}").status_code == 404
    assert ctx.call("cx_a", "post", f"/issues/{uuid4()}/verifier").status_code == 404


# ── Transitions valides (workflow V1 conservé tel quel) ──────────────────────────

def test_workflow_complet_ouverte_a_verifiee_puis_reouverture(ctx):
    issue_id = _creer_issue(ctx, titre="Attente trop longue")

    # ouverte -> action_en_cours
    r = _creer_action(ctx, issue_id, titre="Ajouter un guichet")
    assert r.status_code == 201
    action1_id = r.json()["id"]
    assert ctx.call("cx_a", "get", f"/issues/{issue_id}").json()["statut"] == "action_en_cours"

    # action_en_cours -> resolue (toutes les actions terminées)
    r = ctx.call("cx_a", "post", f"/issues/{issue_id}/actions/{action1_id}/terminer")
    assert r.status_code == 200
    detail = ctx.call("cx_a", "get", f"/issues/{issue_id}").json()
    assert detail["statut"] == "resolue"
    assert detail["date_resolution"] is not None

    # resolue -> verifiee
    r = ctx.call("cx_a", "post", f"/issues/{issue_id}/verifier")
    assert r.status_code == 200
    assert r.json()["statut"] == "verifiee"
    assert r.json()["date_verification"] is not None

    # verifiee -> reouverte (rattachement d'un nouveau feedback)
    r = ctx.call("cx_a", "patch", f"/issues/{issue_id}/rattacher-feedback/{ctx.fb_a}")
    assert r.status_code == 200
    assert r.json()["statut"] == "reouverte"
    assert r.json()["date_verification"] is None

    # reouverte -> action_en_cours (nouvelle action)
    r = _creer_action(ctx, issue_id, titre="Nouvelle action")
    assert r.status_code == 201
    assert ctx.call("cx_a", "get", f"/issues/{issue_id}").json()["statut"] == "action_en_cours"


def test_deux_actions_une_seule_terminee_pas_encore_resolue(ctx):
    issue_id = _creer_issue(ctx)
    a1 = _creer_action(ctx, issue_id, titre="Action 1").json()["id"]
    a2 = _creer_action(ctx, issue_id, titre="Action 2").json()["id"]

    ctx.call("cx_a", "post", f"/issues/{issue_id}/actions/{a1}/terminer")
    assert ctx.call("cx_a", "get", f"/issues/{issue_id}").json()["statut"] == "action_en_cours"

    ctx.call("cx_a", "post", f"/issues/{issue_id}/actions/{a2}/terminer")
    assert ctx.call("cx_a", "get", f"/issues/{issue_id}").json()["statut"] == "resolue"


# ── Transitions invalides ────────────────────────────────────────────────────────

def test_verifier_refuse_si_ouverte(ctx):
    issue_id = _creer_issue(ctx)
    r = ctx.call("cx_a", "post", f"/issues/{issue_id}/verifier")
    assert r.status_code == 400


def test_verifier_refuse_si_action_en_cours(ctx):
    issue_id = _creer_issue(ctx)
    _creer_action(ctx, issue_id)
    r = ctx.call("cx_a", "post", f"/issues/{issue_id}/verifier")
    assert r.status_code == 400


def test_ouverte_ne_devient_pas_reouverte_sur_simple_rattachement(ctx):
    """'ouverte' -> 'reouverte' directement : le seul chemin vers 'reouverte' passe par une
    Issue déjà 'verifiee' — un rattachement sur une Issue 'ouverte' ne change pas son statut."""
    issue_id = _creer_issue(ctx)
    r = ctx.call("cx_a", "patch", f"/issues/{issue_id}/rattacher-feedback/{ctx.fb_a}")
    assert r.status_code == 200
    assert r.json()["statut"] == "ouverte"


def test_verifier_deux_fois_refuse_la_seconde_fois(ctx):
    issue_id = _creer_issue(ctx)
    a1 = _creer_action(ctx, issue_id).json()["id"]
    ctx.call("cx_a", "post", f"/issues/{issue_id}/actions/{a1}/terminer")
    assert ctx.call("cx_a", "post", f"/issues/{issue_id}/verifier").status_code == 200
    assert ctx.call("cx_a", "post", f"/issues/{issue_id}/verifier").status_code == 400


def test_action_creee_sur_issue_verifiee_repasse_par_reouverte(ctx):
    issue_id = _creer_issue(ctx)
    a1 = _creer_action(ctx, issue_id).json()["id"]
    ctx.call("cx_a", "post", f"/issues/{issue_id}/actions/{a1}/terminer")
    ctx.call("cx_a", "post", f"/issues/{issue_id}/verifier")

    r = _creer_action(ctx, issue_id, titre="Nouvelle action")
    assert r.status_code == 201

    detail = ctx.call("cx_a", "get", f"/issues/{issue_id}").json()
    assert detail["statut"] == "action_en_cours"
    assert detail["date_verification"] is None

    db = ctx.Session()
    evenements = [(e.type_evenement, e.ancien_statut, e.nouveau_statut) for e in
                  db.query(HistoriqueIssue).filter(HistoriqueIssue.issue_id == UUID(issue_id)).all()]
    assert ("action_creee", "verifiee", "reouverte") in evenements
    assert ("action_creee", "reouverte", "action_en_cours") in evenements
    db.close()


def test_action_creee_sur_issue_resolue_reste_inchangee(ctx):
    """Non-régression : une Issue 'resolue' (mais pas 'verifiee') repasse directement à
    'action_en_cours' sans passer par 'reouverte'."""
    issue_id = _creer_issue(ctx)
    a1 = _creer_action(ctx, issue_id).json()["id"]
    ctx.call("cx_a", "post", f"/issues/{issue_id}/actions/{a1}/terminer")
    assert ctx.call("cx_a", "get", f"/issues/{issue_id}").json()["statut"] == "resolue"

    r = _creer_action(ctx, issue_id, titre="Encore une action")
    assert r.status_code == 201
    detail = ctx.call("cx_a", "get", f"/issues/{issue_id}").json()
    assert detail["statut"] == "action_en_cours"
    assert detail["date_verification"] is None


# ── ActionCorrective ──────────────────────────────────────────────────────────────

def test_action_creee_puis_terminee(ctx):
    issue_id = _creer_issue(ctx)
    r = _creer_action(ctx, issue_id, titre="Former le personnel")
    assert r.status_code == 201
    assert r.json()["statut"] == "creee"
    action_id = r.json()["id"]

    r = ctx.call("cx_a", "post", f"/issues/{issue_id}/actions/{action_id}/terminer")
    assert r.status_code == 200
    assert r.json()["statut"] == "terminee"
    assert r.json()["date_completion"] is not None


def test_action_inexistante_404(ctx):
    issue_id = _creer_issue(ctx)
    r = ctx.call("cx_a", "post", f"/issues/{issue_id}/actions/{uuid4()}/terminer")
    assert r.status_code == 404


def test_action_responsable_valide(ctx):
    issue_id = _creer_issue(ctx)
    r = _creer_action(ctx, issue_id, responsable_id=str(ctx.am_a))
    assert r.status_code == 201, r.text
    assert r.json()["responsable_id"] == str(ctx.am_a)


def test_action_responsable_inexistant_refuse(ctx):
    issue_id = _creer_issue(ctx)
    r = _creer_action(ctx, issue_id, responsable_id=str(uuid4()))
    assert r.status_code == 400


def test_action_responsable_autre_organisation_refuse(ctx):
    issue_id = _creer_issue(ctx)
    r = _creer_action(ctx, issue_id, responsable_id=str(ctx.am_b))
    assert r.status_code == 400
    assert "organisation" in r.json()["detail"]


# ── Feedback -> Issue : rattachement, détachement, déplacement ──────────────────

def test_rattachement_et_detachement(ctx):
    issue_id = _creer_issue(ctx)
    assert ctx.call("cx_a", "patch", f"/issues/{issue_id}/rattacher-feedback/{ctx.fb_a}").status_code == 200
    assert ctx.call("cx_a", "patch", f"/issues/{issue_id}/detacher-feedback/{ctx.fb_a}").status_code == 200

    db = ctx.Session()
    assert db.query(Feedback).filter(Feedback.id == ctx.fb_a).first().issue_id is None
    db.close()


def test_deplacement_feedback_entre_deux_issues_trace_des_deux_cotes(ctx):
    issue1_id = _creer_issue(ctx, titre="Issue 1")
    issue2_id = _creer_issue(ctx, titre="Issue 2")

    ctx.call("cx_a", "patch", f"/issues/{issue1_id}/rattacher-feedback/{ctx.fb_a}")
    r = ctx.call("cx_a", "patch", f"/issues/{issue2_id}/rattacher-feedback/{ctx.fb_a}")
    assert r.status_code == 200

    db = ctx.Session()
    fb = db.query(Feedback).filter(Feedback.id == ctx.fb_a).first()
    assert str(fb.issue_id) == issue2_id

    types_issue1 = [e.type_evenement for e in db.query(HistoriqueIssue).filter(HistoriqueIssue.issue_id == UUID(issue1_id)).all()]
    types_issue2 = [e.type_evenement for e in db.query(HistoriqueIssue).filter(HistoriqueIssue.issue_id == UUID(issue2_id)).all()]
    assert "feedback_deplace_sortant" in types_issue1
    assert "feedback_deplace_entrant" in types_issue2
    db.close()


# ── Isolation inter-organisation (priorité) ──────────────────────────────────────

def test_isolation_lecture_detail(ctx):
    issue_a_id = _creer_issue(ctx, "cx_a", titre="Issue A")
    assert ctx.call("cx_b", "get", f"/issues/{issue_a_id}").status_code == 403


def test_isolation_liste_scopee_par_organisation(ctx):
    _creer_issue(ctx, "cx_a", titre="Issue A")
    _creer_issue(ctx, "cx_b", agence_id=ctx.agence_b, titre="Issue B")
    titres_a = [i["titre"] for i in ctx.call("cx_a", "get", "/issues/").json()]
    titres_b = [i["titre"] for i in ctx.call("cx_b", "get", "/issues/").json()]
    assert "Issue A" in titres_a and "Issue B" not in titres_a
    assert "Issue B" in titres_b and "Issue A" not in titres_b


def test_isolation_verifier(ctx):
    issue_a_id = _creer_issue(ctx, "cx_a", titre="Issue A")
    a1 = _creer_action(ctx, issue_a_id).json()["id"]
    ctx.call("cx_a", "post", f"/issues/{issue_a_id}/actions/{a1}/terminer")
    assert ctx.call("cx_b", "post", f"/issues/{issue_a_id}/verifier").status_code == 403


def test_isolation_reouverture(ctx):
    """Un utilisateur B ne doit pas pouvoir rouvrir (rattacher un feedback) une Issue A déjà vérifiée."""
    issue_a_id = _creer_issue(ctx, "cx_a", titre="Issue A")
    a1 = _creer_action(ctx, issue_a_id).json()["id"]
    ctx.call("cx_a", "post", f"/issues/{issue_a_id}/actions/{a1}/terminer")
    ctx.call("cx_a", "post", f"/issues/{issue_a_id}/verifier")
    r = ctx.call("cx_b", "patch", f"/issues/{issue_a_id}/rattacher-feedback/{ctx.fb_b}")
    assert r.status_code == 403


def test_isolation_creer_action_sur_issue_autre_org(ctx):
    issue_a_id = _creer_issue(ctx, "cx_a", titre="Issue A")
    r = ctx.call("cx_b", "post", f"/issues/{issue_a_id}/actions", json={"titre": "Intrusion"})
    assert r.status_code == 403


def test_isolation_terminer_action_autre_org(ctx):
    issue_a_id = _creer_issue(ctx, "cx_a", titre="Issue A")
    action_a_id = _creer_action(ctx, issue_a_id, titre="Action A").json()["id"]
    r = ctx.call("cx_b", "post", f"/issues/{issue_a_id}/actions/{action_a_id}/terminer")
    assert r.status_code == 403


def test_isolation_historique_inaccessible_hors_organisation(ctx):
    """Le journal n'est exposé qu'au travers du détail de l'Issue (aucune route dédiée) :
    le 403 sur le détail suffit à garantir qu'aucun événement ne fuite."""
    issue_a_id = _creer_issue(ctx, "cx_a", titre="Issue A")
    assert ctx.call("cx_b", "get", f"/issues/{issue_a_id}").status_code == 403


def test_isolation_rattacher_feedback_a_sur_issue_b_refuse(ctx):
    issue_b_id = _creer_issue(ctx, "cx_b", agence_id=ctx.agence_b, titre="Issue B")
    r = ctx.call("cx_a", "patch", f"/issues/{issue_b_id}/rattacher-feedback/{ctx.fb_a}")
    assert r.status_code == 403  # accès à Issue B refusé avant même de considérer le feedback


def test_isolation_rattacher_feedback_b_sur_issue_a_refuse(ctx):
    issue_a_id = _creer_issue(ctx, "cx_a", titre="Issue A")
    r = ctx.call("cx_a", "patch", f"/issues/{issue_a_id}/rattacher-feedback/{ctx.fb_b}")
    assert r.status_code == 403  # feedback B hors organisation de cx_a


def test_isolation_responsable_autre_organisation(ctx):
    issue_a_id = _creer_issue(ctx, "cx_a", titre="Issue A")
    r = _creer_action(ctx, issue_a_id, responsable_id=str(ctx.cx_b))
    assert r.status_code == 400


def test_isolation_agency_manager_hors_de_son_agence(ctx):
    issue_b_id = _creer_issue(ctx, "cx_b", agence_id=ctx.agence_b, titre="Issue B")
    assert ctx.call("am_a", "get", f"/issues/{issue_b_id}").status_code == 403


def test_isolation_dans_les_deux_sens(ctx):
    """Même suite de vérifications, A et B inversés — confirme que ce n'est pas un hasard d'ordre."""
    issue_b_id = _creer_issue(ctx, "cx_b", agence_id=ctx.agence_b, titre="Issue B")
    assert ctx.call("cx_a", "get", f"/issues/{issue_b_id}").status_code == 403
    assert ctx.call("cx_a", "post", f"/issues/{issue_b_id}/actions", json={"titre": "Intrusion"}).status_code == 403
    assert ctx.call("cx_a", "post", f"/issues/{issue_b_id}/verifier").status_code == 403
    assert ctx.call("cx_a", "patch", f"/issues/{issue_b_id}/rattacher-feedback/{ctx.fb_a}").status_code == 403


def test_isolation_creation_issue_sur_agence_autre_organisation_refuse(ctx):
    r = ctx.call("cx_a", "post", "/issues/", json={"titre": "Intrusion", "agence_id": str(ctx.agence_b)})
    assert r.status_code == 403
