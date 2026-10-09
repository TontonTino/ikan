"""
scripts/seed_feedbacks_reclamations_demo.py — base SQLite en mémoire (clés étrangères
activées pour que les ON DELETE CASCADE s'appliquent comme sur PostgreSQL), pipeline
réel de soumission ET analyse IA réelle (aucun double de analyser_feedback, sauf pour le
test de défaillance de l'analyse).

Les catégories cibles portent des noms arbitraires : seule la clé (categories_agence.cle)
doit permettre au script de les trouver. Une catégorie leurre porte le nom "Internet &
Réseau Mobile" sans clé : elle ne doit jamais recevoir de feedback.
"""
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-seed-reclamations-0123456789")

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.endpoints import feedbacks as feedbacks_endpoint
from app.db.session import Base
from app.models.agence import Agence
from app.models.analyse_ia import AnalyseIA
from app.models.categorie import Categorie
from app.models.enums import CriticiteType, SentimentType
from app.models.feedback import Feedback
from app.models.historique_feedback import HistoriqueFeedback
from app.models.organisation import Organisation
from app.models.plan import Plan
from app.models.qr_code import QRCode
from app.services.plan_catalog import PLAN_GRATUIT_ID
from app.models.recommandation import Recommandation
from app.services.ai.sentiment import analyser_sentiment
from app.services.kpi.engine import (
    calculer_tel_reclamations_facturation,
    calculer_tel_reclamations_recharge_forfait,
    calculer_tel_reclamations_reseau,
)

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))
import seed_feedbacks_reclamations_demo as seed  # noqa: E402

NOW = datetime.now(timezone.utc)
CLES_TELECOM = ["accueil", "service_client", "carte_sim_numero", "forfaits_recharge",
                "internet_reseau_mobile", "facturation_paiement", "equipements_boutique"]
AGENCES = sorted({p.agence for p in seed.PLAN} | {"Agence Orange Ouaga 2000"})


@pytest.fixture()
def ctx(monkeypatch):
    engine = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def _fk_on(dbapi_conn, _record):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    db = Session()

    db.add(Plan(id=PLAN_GRATUIT_ID, code="gratuit", nom="Gratuit"))  # forfait par défaut d'Organisation
    db.flush()
    org = Organisation(id=uuid.uuid4(), nom="Orange Burkina Faso", active=True, secteur_code="telecom")
    autre_org = Organisation(id=uuid.uuid4(), nom="Autre opérateur", active=True, secteur_code="telecom")
    db.add_all([org, autre_org])
    db.flush()
    categories = {}
    for i, nom in enumerate(AGENCES):
        agence = Agence(id=uuid.uuid4(), organisation_id=org.id, nom=nom, active=True)
        db.add(agence)
        db.flush()
        db.add(QRCode(id=uuid.uuid4(), agence_id=agence.id, code=f"QR-{i}", url="http://t", actif=True))
        for j, cle in enumerate(CLES_TELECOM):
            c = Categorie(id=uuid.uuid4(), agence_id=agence.id, nom=f"Catégorie {i}-{j}", active=True, cle=cle)
            db.add(c)
            categories[(nom, cle)] = c.id
        db.add(Categorie(id=uuid.uuid4(), agence_id=agence.id, nom="Internet & Réseau Mobile", active=True, cle=None))
    db.flush()

    # Feedback préexistant (avec analyse et historique) : ne doit jamais être modifié ni supprimé.
    bobo = "Agence Orange Bobo-Dioulasso"
    qr_bobo = db.query(QRCode).join(Agence).filter(Agence.nom == bobo).one()
    existant = Feedback(id=uuid.uuid4(), qr_code_id=qr_bobo.id, categorie_id=categories[(bobo, "internet_reseau_mobile")],
                        note=1, commentaire="Ancien avis", statut_traitement="nouveau", date_soumission=NOW - timedelta(days=3))
    db.add(existant)
    db.flush()
    db.add(AnalyseIA(id=uuid.uuid4(), feedback_id=existant.id, sentiment=SentimentType.NEGATIF,
                     criticite=CriticiteType.FAIBLE, score_sentiment=0.1))
    db.add(HistoriqueFeedback(feedback_id=existant.id, agence_id=qr_bobo.agence_id, auteur_nom="Client",
                              auteur_role="client", type_evenement="soumission"))
    db.commit()
    ids = dict(org=org.id, autre_org=autre_org.id, existant=existant.id)
    db.close()

    monkeypatch.setattr(seed, "SessionLocal", Session)

    class Ctx:
        pass
    c = Ctx()
    c.Session, c.ids = Session, ids
    return c


def _marques(db, org_id):
    return [r.feedback_id for r in db.query(HistoriqueFeedback.feedback_id).join(Agence, HistoriqueFeedback.agence_id == Agence.id)
            .filter(Agence.organisation_id == org_id, HistoriqueFeedback.type_evenement == seed.MARQUEUR).all()]


# ── Plan (pur, sans base) ──────────────────────────────────────────────────────

@pytest.mark.parametrize("cle,total,negatifs", [
    ("internet_reseau_mobile", 12, 11), ("forfaits_recharge", 8, 5), ("facturation_paiement", 6, 5),
])
def test_plan_comptes_par_cle(cle, total, negatifs):
    lot = [p for p in seed.PLAN if p.cle == cle]
    assert len(lot) == total
    assert sum(1 for p in lot if p.sentiment_attendu == SentimentType.NEGATIF) == negatifs
    assert len({p.agence for p in lot}) >= 3


def test_plan_reparti_hors_ouaga_2000_et_cles_seulement():
    assert {p.cle for p in seed.PLAN} == {"internet_reseau_mobile", "forfaits_recharge", "facturation_paiement"}
    assert "Agence Orange Ouaga 2000" not in {p.agence for p in seed.PLAN}
    assert not any("Digital Center" in p.agence for p in seed.PLAN)
    assert len({p.agence for p in seed.PLAN}) >= 8


@pytest.mark.parametrize("p", seed.PLAN, ids=lambda p: p.commentaire[:30])
def test_commentaire_classe_par_le_texte_pas_par_la_note(p):
    """Sentiment attendu obtenu par le signal lexical lui-même, jamais par le filet de
    secours sur la note (scores 0.4 / 0.6 de analyser_sentiment)."""
    sentiment, score = analyser_sentiment(p.commentaire, p.note)
    assert sentiment == p.sentiment_attendu
    assert score not in (0.4, 0.6)
    assert 1 <= p.note <= 2 if p.sentiment_attendu == SentimentType.NEGATIF else p.note >= 4


# ── Exécution sur base ─────────────────────────────────────────────────────────

def test_seed_cree_26_feedbacks_via_le_pipeline_et_lanalyse_reelle(ctx):
    seed.main([])
    db = ctx.Session()
    ids = _marques(db, ctx.ids["org"])
    assert len(ids) == len(seed.PLAN) == 26
    attendus = sorted((p.cle, p.commentaire, p.sentiment_attendu) for p in seed.PLAN)
    obtenus = []
    for fid in ids:
        fb = db.get(Feedback, fid)
        analyse = db.query(AnalyseIA).filter(AnalyseIA.feedback_id == fid).one()
        cat = db.get(Categorie, fb.categorie_id)
        obtenus.append((cat.cle, fb.commentaire, analyse.sentiment))
        assert cat.nom.startswith("Catégorie ")  # jamais la catégorie leurre sans clé
        date = fb.date_soumission.replace(tzinfo=timezone.utc) if fb.date_soumission.tzinfo is None else fb.date_soumission
        assert NOW - timedelta(days=27) <= date <= NOW - timedelta(hours=12)
        assert fb.issue_id is None and fb.nps_note is None
    assert sorted(obtenus) == attendus
    # Recommandations réellement générées pour au moins une partie des feedbacks négatifs.
    assert db.query(Recommandation).join(AnalyseIA).filter(AnalyseIA.feedback_id.in_(ids)).count() > 0
    db.close()


def test_feedback_preexistant_intact(ctx):
    db = ctx.Session()
    avant = db.get(Feedback, ctx.ids["existant"])
    snapshot = (avant.note, avant.commentaire, avant.categorie_id, avant.date_soumission, avant.statut_traitement)
    db.close()
    seed.main([])
    seed.main(["--supprimer"])
    db = ctx.Session()
    apres = db.get(Feedback, ctx.ids["existant"])
    assert (apres.note, apres.commentaire, apres.categorie_id, apres.date_soumission, apres.statut_traitement) == snapshot
    assert db.query(AnalyseIA).filter(AnalyseIA.feedback_id == ctx.ids["existant"]).count() == 1
    db.close()


def test_kpis_apres_seed_cas_calcules_a_la_main(ctx):
    """Base de test : 1 feedback préexistant (réseau, NEGATIF) + 26 du seed = 27.
    Réseau 12/27 = 44.4 ; recharge 5/27 = 18.5 ; facturation 5/27 = 18.5."""
    seed.main([])
    db = ctx.Session()
    org = ctx.ids["org"]
    assert (calculer_tel_reclamations_reseau(db, org).value, calculer_tel_reclamations_reseau(db, org).denominator) == (44.4, 27)
    assert calculer_tel_reclamations_recharge_forfait(db, org).value == 18.5
    assert calculer_tel_reclamations_facturation(db, org).value == 18.5
    # Isolation : rien n'est écrit pour une autre organisation.
    assert calculer_tel_reclamations_reseau(db, ctx.ids["autre_org"]).denominator == 0
    db.close()


def test_idempotent_refuse_sans_force(ctx, capsys):
    seed.main([])
    seed.main([])
    assert "[REFUS]" in capsys.readouterr().out
    db = ctx.Session()
    assert len(_marques(db, ctx.ids["org"])) == 26
    assert db.query(Feedback).count() == 27
    db.close()


def test_force_cree_un_second_lot(ctx):
    seed.main([])
    seed.main(["--force"])
    db = ctx.Session()
    assert len(_marques(db, ctx.ids["org"])) == 52
    db.close()


def test_supprimer_ne_retire_que_ce_lot_avec_ses_dependances(ctx):
    seed.main([])
    db = ctx.Session()
    ids = _marques(db, ctx.ids["org"])
    db.close()
    seed.main(["--supprimer"])
    db = ctx.Session()
    assert _marques(db, ctx.ids["org"]) == []
    assert db.query(Feedback).count() == 1
    assert db.query(Feedback).filter(Feedback.id.in_(ids)).count() == 0
    assert db.query(AnalyseIA).filter(AnalyseIA.feedback_id.in_(ids)).count() == 0
    assert db.query(HistoriqueFeedback).filter(HistoriqueFeedback.feedback_id.in_(ids)).count() == 0
    assert db.query(Recommandation).count() == 0  # le préexistant n'en avait pas
    assert db.query(AnalyseIA).count() == 1
    db.close()


def test_cle_manquante_arrete_avant_toute_ecriture(ctx):
    db = ctx.Session()
    agence = db.query(Agence).filter(Agence.nom == "Agence Orange Pissy").one()
    cat = db.query(Categorie).filter(Categorie.agence_id == agence.id, Categorie.cle == "facturation_paiement").one()
    cat.active = False
    db.commit()
    db.close()
    with pytest.raises(SystemExit, match="facturation_paiement"):
        seed.main([])
    db = ctx.Session()
    assert db.query(Feedback).count() == 1
    db.close()


def test_analyse_absente_arrete_et_reste_supprimable(ctx, monkeypatch):
    """Si l'analyse IA n'a pas tourné, le script s'arrête — et le feedback déjà créé porte
    le marqueur, donc --supprimer le retire."""
    monkeypatch.setattr(feedbacks_endpoint, "analyser_feedback", lambda feedback_id, db: None)
    with pytest.raises(RuntimeError, match="aucune analyse"):
        seed.main([])
    db = ctx.Session()
    assert len(_marques(db, ctx.ids["org"])) == 1
    db.close()
    seed.main(["--supprimer"])
    db = ctx.Session()
    assert db.query(Feedback).count() == 1
    db.close()


def test_organisation_non_telecom_refusee(ctx):
    db = ctx.Session()
    db.get(Organisation, ctx.ids["org"]).secteur_code = "banque"
    db.commit()
    db.close()
    with pytest.raises(SystemExit, match="telecom"):
        seed.main([])
