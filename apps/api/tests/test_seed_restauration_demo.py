"""
scripts/seed_restauration_demo.py — base SQLite en mémoire, clés étrangères activées (les
ON DELETE CASCADE s'appliquent comme sur PostgreSQL). Toute la chaîne réelle tourne :
create_organisation, changer_plan_organisation, create_utilisateur, create_agence (dont
creer_categories_depart), submit_feedback (analyse IA réelle), envoyer_reponse_client,
marquer_demande_contact_traitee, creer_issue et le cycle des actions correctives.
"""
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-seed-restauration-0123456789")

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.security import get_password_hash
from app.db.session import Base
from app.models.agence import Agence
from app.models.analyse_ia import AnalyseIA
from app.models.categorie import Categorie
from app.models.changement_plan import ChangementPlan
from app.models.demande_contact import DemandeContact
from app.models.enums import SentimentType, UserRole
from app.models.feedback import Feedback
from app.models.historique_feedback import HistoriqueFeedback
from app.models.issue import Issue
from app.models.organisation import Organisation
from app.models.plan import Plan
from app.models.qr_code import QRCode
from app.models.reponse_client import ReponseClient
from app.models.utilisateur import Utilisateur
from app.services.ai.sentiment import analyser_sentiment
from app.services.kpi.packs_restauration import CLES_RESTAURATION
from app.services.plan_catalog import PLAN_GRATUIT_ID, PLAN_PRO_ID
from app.api.v1.endpoints.kpis import lister_kpis

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))
import seed_restauration_demo as seed  # noqa: E402

NOW = datetime.now(timezone.utc)
CX_CORE = {
    "CSAT", "NEGATIVE_SENTIMENT_RATE", "FEEDBACK_VOLUME", "ISSUE_VOLUME",
    "CRITICAL_ISSUE_RATE", "ISSUE_RESOLUTION_RATE", "MEDIAN_RESOLUTION_TIME", "LOOP_CLOSURE_RATE",
}
RESTO = {"RESTO_TAUX_TRAITEMENT_RECONTACTS", "RESTO_RISQUE_SILENCIEUX", "RESTO_RECIDIVE_CATEGORIE"}


@pytest.fixture()
def ctx(monkeypatch):
    engine = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def _fk_on(dbapi_conn, _record):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    db.add_all([Plan(id=PLAN_GRATUIT_ID, code="gratuit", nom="Gratuit"), Plan(id=PLAN_PRO_ID, code="pro", nom="Pro", ordre=3)])
    db.flush()
    autre = Organisation(id=uuid.uuid4(), nom="Autre organisation", active=True, secteur_code="banque", email_pro="autre@example.com")
    db.add(autre)
    db.flush()
    admin = Utilisateur(id=uuid.uuid4(), organisation_id=autre.id, nom="Admin", prenom="Ikan", email="admin@example.com",
                        mot_de_passe_hash=get_password_hash("x"), role=UserRole.ADMIN, active=True)
    db.add(admin)
    db.commit()
    ids = SimpleNamespace(autre=autre.id, admin=admin.id)
    db.close()
    monkeypatch.setattr(seed, "SessionLocal", Session)
    return SimpleNamespace(Session=Session, **vars(ids))


def _org(db):
    return db.query(Organisation).filter(Organisation.email_pro == seed.EMAIL_PRO).one_or_none()


def _kpis(db, org):
    u = SimpleNamespace(id=None, organisation_id=org.id, role=UserRole.CX_MANAGER, agence_id=None)
    return {k.code: k for k in lister_kpis(jours=30, agence_id=None, db=db, current_user=u).kpis}


# ── Plan (pur) ─────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("p", seed.PLAN_FEEDBACKS, ids=lambda p: p.commentaire[:30])
def test_commentaire_classe_par_le_texte(p):
    sentiment, score = analyser_sentiment(p.commentaire, p.note)
    assert sentiment == p.sentiment_attendu
    assert score not in (0.4, 0.6)  # jamais le filet de secours sur la note


def test_plan_coherent():
    seed.verifier_plan()
    assert {p.cle for p in seed.PLAN_FEEDBACKS} <= CLES_RESTAURATION
    assert {i.cle for i in seed.PLAN_ISSUES} <= CLES_RESTAURATION
    assert len({p.agence for p in seed.PLAN_FEEDBACKS}) == 3
    assert all(1 <= p.jours <= 28 for p in seed.PLAN_FEEDBACKS)


# ── Exécution complète ─────────────────────────────────────────────────────────

def test_seed_cree_organisation_comptes_agences_categories(ctx):
    seed.main([])
    db = ctx.Session()
    org = _org(db)
    assert (org.nom, org.secteur_code, org.plan_id, org.created_by_id) == (seed.ORGANISATION_NOM, "restauration", PLAN_PRO_ID, ctx.admin)
    assert db.query(ChangementPlan).filter(ChangementPlan.organisation_id == org.id, ChangementPlan.source == "admin_override").count() == 1
    agences = db.query(Agence).filter(Agence.organisation_id == org.id).all()
    assert sorted(a.nom for a in agences) == sorted(a.nom for a in seed.AGENCES)
    for a in agences:
        cles = {c.cle for c in db.query(Categorie).filter(Categorie.agence_id == a.id).all()}
        assert cles == CLES_RESTAURATION
        assert db.query(QRCode).filter(QRCode.agence_id == a.id, QRCode.actif == True).count() == 1  # noqa: E712
    users = {u.email: u for u in db.query(Utilisateur).filter(Utilisateur.organisation_id == org.id).all()}
    assert users[seed.CX["email"]].role == UserRole.CX_MANAGER and users[seed.CX["email"]].agence_id is None
    chef = users[seed.CHEF["email"]]
    assert chef.role == UserRole.AGENCY_MANAGER
    assert db.get(Agence, chef.agence_id).nom == seed.AGENCE_DU_CHEF
    db.close()


def test_seed_feedbacks_contacts_issues(ctx):
    seed.main([])
    db = ctx.Session()
    org = _org(db)
    fbs = (db.query(Feedback).join(QRCode).join(Agence).filter(Agence.organisation_id == org.id).all())
    assert len(fbs) == 45
    for fb in fbs:
        assert db.query(HistoriqueFeedback).filter(HistoriqueFeedback.feedback_id == fb.id,
                                                   HistoriqueFeedback.type_evenement == seed.MARQUEUR).count() == 1
        assert db.query(AnalyseIA).filter(AnalyseIA.feedback_id == fb.id).count() == 1
    sentiments = sorted(db.query(AnalyseIA.sentiment).join(Feedback).filter(Feedback.id.in_([f.id for f in fbs])).all())
    assert sentiments == sorted((p.sentiment_attendu,) for p in seed.PLAN_FEEDBACKS)
    demandes = db.query(DemandeContact).filter(DemandeContact.feedback_id.in_([f.id for f in fbs])).all()
    rappels = [d for d in demandes if d.souhaite_etre_rappele]
    assert (len(rappels), sum(d.traitee for d in rappels), len(demandes)) == (13, 8, 15)
    assert db.query(ReponseClient).filter(ReponseClient.feedback_id.in_([f.id for f in fbs])).count() == 6
    issues = {i.titre.replace(seed.MARQUEUR_TITRE, ""): i for i in db.query(Issue).filter(Issue.organisation_id == org.id).all()}
    assert len(issues) == 11
    for plan in seed.PLAN_ISSUES:
        issue = issues[plan.titre]
        assert issue.statut == plan.statut
        assert db.get(Categorie, issue.categorie_id).cle == plan.cle
        assert (issue.issue_origine_id is not None) == bool(plan.origine)
    db.close()


def test_kpis_apres_seed(ctx):
    """Recontacts 8/13 = 61.5 ; risque silencieux 6/16 = 37.5 ; récidive 3/8 = 37.5 — ni 0 %
    ni 100 %, dénominateurs >= 5. Les 8 KPI universels restent visibles."""
    seed.main([])
    db = ctx.Session()
    k = _kpis(db, _org(db))
    assert set(k) == CX_CORE | RESTO
    v = lambda c: (k[c].status, k[c].value, k[c].numerator, k[c].denominator)  # noqa: E731
    assert v("RESTO_TAUX_TRAITEMENT_RECONTACTS") == ("ok", 61.5, 8, 13)
    assert v("RESTO_RISQUE_SILENCIEUX") == ("ok", 37.5, 6, 16)
    assert v("RESTO_RECIDIVE_CATEGORIE") == ("ok", 37.5, 3, 8)
    assert k["FEEDBACK_VOLUME"].value == 45.0 and k["ISSUE_VOLUME"].value == 11.0
    db.close()


def test_idempotent_refuse_sans_force(ctx, capsys):
    seed.main([])
    seed.main([])
    assert "[REFUS]" in capsys.readouterr().out
    db = ctx.Session()
    assert db.query(Organisation).filter(Organisation.nom == seed.ORGANISATION_NOM).count() == 1
    assert db.query(Feedback).count() == 45
    db.close()


def test_force_ajoute_un_second_lot_sans_recreer_comptes(ctx):
    seed.main([])
    seed.main(["--force"])
    db = ctx.Session()
    org = _org(db)
    assert db.query(Feedback).count() == 90
    assert db.query(Issue).filter(Issue.organisation_id == org.id).count() == 22
    assert db.query(Utilisateur).filter(Utilisateur.organisation_id == org.id).count() == 2
    assert db.query(Agence).filter(Agence.organisation_id == org.id).count() == 3
    db.close()


def test_supprimer_retire_tout_et_rien_dautre(ctx):
    seed.main([])
    seed.main(["--supprimer"])
    db = ctx.Session()
    assert _org(db) is None
    for model in (Agence, Feedback, Issue, DemandeContact, ReponseClient, AnalyseIA, Categorie, QRCode):
        assert db.query(model).count() == 0, model
    assert db.get(Organisation, ctx.autre) is not None and db.get(Utilisateur, ctx.admin) is not None
    db.close()


def test_supprimer_refuse_si_donnee_etrangere(ctx):
    seed.main([])
    db = ctx.Session()
    org = _org(db)
    agence = db.query(Agence).filter(Agence.organisation_id == org.id).first()
    qr = db.query(QRCode).filter(QRCode.agence_id == agence.id).first()
    db.add(Feedback(id=uuid.uuid4(), qr_code_id=qr.id, note=5, statut_traitement="nouveau", date_soumission=NOW))
    db.commit()
    db.close()
    with pytest.raises(SystemExit, match="sans marqueur"):
        seed.main(["--supprimer"])
    db = ctx.Session()
    assert _org(db) is not None and db.query(Feedback).count() == 46
    db.close()


def test_organisation_homonyme_etrangere_jamais_touchee(ctx):
    db = ctx.Session()
    db.add(Organisation(id=uuid.uuid4(), nom=seed.ORGANISATION_NOM, active=True, secteur_code="restauration",
                        email_pro="vrai@restaurant.bf"))
    db.commit()
    db.close()
    for args in ([], ["--supprimer"], ["--force"]):
        with pytest.raises(SystemExit, match="n'est pas celle de ce script"):
            seed.main(args)


def test_sans_admin_arret_avant_toute_ecriture(ctx):
    db = ctx.Session()
    db.get(Utilisateur, ctx.admin).active = False
    db.commit()
    db.close()
    with pytest.raises(SystemExit, match="Administrateur"):
        seed.main([])
    db = ctx.Session()
    assert _org(db) is None
    db.close()
