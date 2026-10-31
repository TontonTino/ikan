"""
IA-01 — reprise automatique de l'analyse d'un avis dont l'analyse a échoué.

Aucun service externe : le moteur de sentiment est simulé (échec / succès / espion d'arguments), le temps est simulé (paramètre
`maintenant`, jamais de sleep), la base est SQLite en mémoire. Aucune base réelle n'est touchée.
"""
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-reprise-analyse-0123456789")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.endpoints import agences, feedbacks
from app.core.security import create_access_token, get_password_hash
from app.db.session import Base, get_db
from app.models.agence import Agence
from app.models.analyse_ia import AnalyseIA
from app.models.categorie import Categorie
from app.models.demande_contact import DemandeContact
from app.models.enums import SentimentType, UserRole
from app.models.feedback import Feedback
from app.models.historique_feedback import HistoriqueFeedback
from app.models.organisation import Organisation
from app.models.qr_code import QRCode
from app.models.recommandation import Recommandation
from app.models.utilisateur import Utilisateur
from app.services.ai import analyse_service, reprise_analyse
from app.services.ai.reprise_analyse import (
    DELAI_INDISPONIBLE, MAX_TENTATIVES, TYPE_ECHEC_REPRISE, ETAT_DISPONIBLE, ETAT_EN_ATTENTE, ETAT_INDISPONIBLE,
    delai_avant_tentative, etat_analyse, reprendre_analyses,
)

T0 = datetime(2026, 10, 1, 12, 0, 0, tzinfo=timezone.utc)
CONTACT_NOM, CONTACT_TEL, CONTACT_EMAIL = "Awa Traore-SECRET", "70123456", "awa.secret@example.org"
COMMENTAIRE_A = "Accueil NEG-A très lent"
COMMENTAIRE_B = "Service POS-B excellent"


class Moteur:
    """Double du moteur de sentiment : bascule échec/succès et espionne les arguments."""

    def __init__(self):
        self.echoue = False
        self.echoue_pour = set()          # textes pour lesquels il échoue même quand `echoue` est faux
        self.appels = []                  # (args, kwargs)
        self.vrai = analyse_service.analyser_sentiment

    def __call__(self, *args, **kwargs):
        self.appels.append((args, kwargs))
        if self.echoue or (args and args[0] in self.echoue_pour):
            raise RuntimeError("moteur indisponible")
        return self.vrai(*args, **kwargs)


@pytest.fixture()
def moteur(monkeypatch):
    m = Moteur()
    monkeypatch.setattr(analyse_service, "analyser_sentiment", m)
    return m


@pytest.fixture()
def ctx(moteur):
    engine = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    for table in Base.metadata.sorted_tables:
        try:
            table.create(engine, checkfirst=True)
        except Exception:  # noqa: BLE001 — tables propres à PostgreSQL
            pass
    Session = sessionmaker(bind=engine)

    def override_db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app = FastAPI()
    app.include_router(feedbacks.router, prefix="/feedbacks")
    app.include_router(agences.router, prefix="/agences")
    app.dependency_overrides[get_db] = override_db

    db = Session()
    org_a, org_b = Organisation(id=uuid4(), nom="Client A", active=True), Organisation(id=uuid4(), nom="Client B", active=True)
    db.add_all([org_a, org_b]); db.flush()
    ag = {}
    for cle, org in (("a", org_a), ("b", org_b)):
        agence = Agence(id=uuid4(), organisation_id=org.id, nom=f"Agence {cle}", ville="Ouaga", active=True)
        db.add(agence); db.flush()
        qr = QRCode(id=uuid4(), agence_id=agence.id, code=f"QR-{cle}", url=f"http://t/{cle}", actif=True)
        cat = Categorie(id=uuid4(), agence_id=agence.id, nom="Accueil", active=True)
        db.add_all([qr, cat]); db.flush()
        ag[cle] = SimpleNamespace(agence=agence.id, qr=qr.id, cat=cat.id, code=qr.code, org=org.id)
    cx_a = Utilisateur(id=uuid4(), organisation_id=org_a.id, nom="N", prenom="P", email="cx-a@test.io",
                       mot_de_passe_hash=get_password_hash("Motdepasse-123"), role=UserRole.CX_MANAGER, active=True)
    db.add(cx_a); db.commit()
    cx_a_id = cx_a.id
    db.close()

    def avis(cle, commentaire, note=1, age=timedelta(0), contact=False):
        s = Session()
        fb = Feedback(id=uuid4(), qr_code_id=ag[cle].qr, categorie_id=ag[cle].cat, note=note, commentaire=commentaire,
                      statut_traitement="nouveau", date_soumission=T0 - age)
        s.add(fb); s.flush()
        if contact:
            s.add(DemandeContact(id=uuid4(), feedback_id=fb.id, nom=CONTACT_NOM, telephone=CONTACT_TEL, email=CONTACT_EMAIL,
                                 souhaite_etre_rappele=True))
        s.commit(); fid = fb.id; s.close()
        return fid

    def job(maintenant, db=None):
        s = db or Session()
        try:
            return reprendre_analyses(s, maintenant)
        finally:
            if db is None:
                s.close()

    def requete(modele_colonne, *conds):
        s = Session()
        try:
            return s.execute(select(modele_colonne).where(*conds)).all()
        finally:
            s.close()

    def nb(modele, *conds):
        s = Session()
        try:
            return s.execute(select(func.count()).select_from(modele).where(*conds)).scalar()
        finally:
            s.close()

    def definir_active(cle, active):
        s = Session()
        s.query(Organisation).filter(Organisation.id == ag[cle].org).update({"active": active}); s.commit(); s.close()

    return SimpleNamespace(client=TestClient(app), app=app, Session=Session, engine=engine, ag=ag, avis=avis, job=job, nb=nb,
                           requete=requete, definir_active=definir_active, cx_a=cx_a_id,
                           H=lambda uid: {"Authorization": f"Bearer {create_access_token(uid)}"})


def minutes(n):
    return T0 + timedelta(minutes=n)


# ─────────────────────────── reprise : échec puis succès ───────────────────────────

def test_echec_puis_succes_a_la_reprise(ctx, moteur):
    fid = ctx.avis("a", COMMENTAIRE_A)
    moteur.echoue = True
    bilan = ctx.job(minutes(6))
    assert bilan == {"selectionnes": 1, "reussis": 0, "echecs": 1, "abandonnes": 0}
    assert ctx.nb(AnalyseIA, AnalyseIA.feedback_id == fid) == 0
    assert ctx.nb(HistoriqueFeedback, HistoriqueFeedback.feedback_id == fid, HistoriqueFeedback.type_evenement == TYPE_ECHEC_REPRISE) == 1

    moteur.echoue = False
    assert ctx.job(minutes(6 + 9))["selectionnes"] == 0          # le délai croissant (10 min) n'est pas écoulé
    bilan = ctx.job(minutes(6 + 10))
    assert bilan["reussis"] == 1 and bilan["echecs"] == 0
    analyse = ctx.requete(AnalyseIA.sentiment, AnalyseIA.feedback_id == fid)
    assert analyse and analyse[0][0] == SentimentType.NEGATIF


def test_un_avis_sans_commentaire_est_analyse_a_la_reprise_avec_la_note(ctx, moteur):
    fid = ctx.avis("a", None, note=5)
    assert ctx.job(minutes(5))["reussis"] == 1
    assert ctx.requete(AnalyseIA.sentiment, AnalyseIA.feedback_id == fid)[0][0] == SentimentType.POSITIF


def test_un_avis_trop_recent_n_est_pas_repris(ctx):
    ctx.avis("a", COMMENTAIRE_A)
    assert ctx.job(minutes(4))["selectionnes"] == 0


# ─────────────────────────── plafond et délai croissant ───────────────────────────

def test_delais_croissants_et_plafond_respectes_en_temps_simule(ctx, moteur):
    fid = ctx.avis("a", COMMENTAIRE_A)
    moteur.echoue = True
    tentatives = []
    for minute in range(0, 24 * 60):                             # une exécution de job par minute simulée pendant 24 h
        if ctx.job(minutes(minute))["selectionnes"]:
            tentatives.append(minute)
    assert tentatives == [5, 15, 35, 75, 155]                    # +5, +10, +20, +40, +80 minutes après chaque échec
    assert [delai_avant_tentative(n) for n in range(MAX_TENTATIVES)] == [timedelta(minutes=m) for m in (5, 10, 20, 40, 80)]
    assert len(tentatives) == MAX_TENTATIVES
    assert ctx.nb(HistoriqueFeedback, HistoriqueFeedback.feedback_id == fid, HistoriqueFeedback.type_evenement == TYPE_ECHEC_REPRISE) == MAX_TENTATIVES


def test_apres_le_plafond_l_avis_n_est_plus_repris_meme_si_le_moteur_revient(ctx, moteur):
    fid = ctx.avis("a", COMMENTAIRE_A)
    moteur.echoue = True
    instant = 0
    for _ in range(MAX_TENTATIVES):
        instant += 24 * 60                                       # chaque exécution espacée de plus que n'importe quel délai
        assert ctx.job(minutes(instant))["echecs"] == 1
    moteur.echoue = False
    appels_avant = len(moteur.appels)
    assert ctx.job(minutes(instant + 10 * 24 * 60))["selectionnes"] == 0
    assert len(moteur.appels) == appels_avant
    assert ctx.nb(AnalyseIA, AnalyseIA.feedback_id == fid) == 0


def test_echec_definitif_journalise_sans_texte_ni_contact(ctx, moteur, caplog):
    fid = ctx.avis("a", COMMENTAIRE_A, contact=True)
    moteur.echoue = True
    with caplog.at_level(logging.DEBUG):
        for i in range(1, MAX_TENTATIVES + 1):
            ctx.job(minutes(i * 24 * 60))
    lignes = [r for r in caplog.records if r.name == "ikan.analyse_ia"]
    assert len(lignes) == 1 and lignes[0].levelno == logging.ERROR
    donnees = json.loads(lignes[0].getMessage())
    assert donnees["evenement"] == "analyse_ia_abandonnee" and donnees["feedback_id"] == str(fid) and donnees["tentatives"] == MAX_TENTATIVES
    tout = " ".join(r.getMessage() for r in caplog.records)
    for interdit in (COMMENTAIRE_A, "NEG-A", CONTACT_NOM, CONTACT_TEL, CONTACT_EMAIL, "moteur indisponible"):
        assert interdit not in tout, interdit


# ─────────────────────────── l'avis n'est jamais perdu ───────────────────────────

def test_l_avis_reste_intact_et_visible_apres_l_abandon(ctx, moteur):
    fid = ctx.avis("a", COMMENTAIRE_A, note=2, contact=True)
    moteur.echoue = True
    for i in range(1, MAX_TENTATIVES + 1):
        ctx.job(minutes(i * 24 * 60))
    ligne = ctx.requete(Feedback.note, Feedback.id == fid)
    assert ligne and ligne[0][0] == 2
    assert ctx.requete(Feedback.commentaire, Feedback.id == fid)[0][0] == COMMENTAIRE_A
    assert ctx.nb(DemandeContact, DemandeContact.feedback_id == fid) == 1
    r = ctx.client.get("/feedbacks/", headers=ctx.H(ctx.cx_a))
    assert r.status_code == 200
    avis_visibles = [f for f in r.json() if f["id"] == str(fid)]
    assert avis_visibles and avis_visibles[0]["note"] == 2 and avis_visibles[0]["commentaire"] == COMMENTAIRE_A
    assert avis_visibles[0]["analyse_ia"] is None


def test_un_echec_technique_sur_un_avis_n_empeche_pas_les_suivants(ctx, moteur):
    ctx.avis("a", COMMENTAIRE_A)
    bon = ctx.avis("a", "Autre avis tranquille", note=5)
    moteur.echoue_pour = {COMMENTAIRE_A}
    bilan = ctx.job(minutes(6))
    assert bilan["selectionnes"] == 2 and bilan["reussis"] == 1 and bilan["echecs"] == 1
    assert ctx.nb(AnalyseIA, AnalyseIA.feedback_id == bon) == 1


# ─────────────────────────── état d'analyse (sans requête) ───────────────────────────

def test_etat_analyse_disponible_en_attente_indisponible():
    sans_analyse = SimpleNamespace(analyse_ia=None, date_soumission=T0)
    avec = SimpleNamespace(analyse_ia=object(), date_soumission=T0 - timedelta(days=30))
    assert etat_analyse(avec, T0 + timedelta(days=1)) == ETAT_DISPONIBLE
    assert etat_analyse(sans_analyse, T0 + timedelta(seconds=1)) == ETAT_EN_ATTENTE
    assert etat_analyse(sans_analyse, T0 + DELAI_INDISPONIBLE - timedelta(seconds=1)) == ETAT_EN_ATTENTE
    assert etat_analyse(sans_analyse, T0 + DELAI_INDISPONIBLE) == ETAT_INDISPONIBLE
    naif = SimpleNamespace(analyse_ia=None, date_soumission=T0.replace(tzinfo=None))
    assert etat_analyse(naif, T0 + DELAI_INDISPONIBLE) == ETAT_INDISPONIBLE


def test_le_delai_indisponible_couvre_toutes_les_reprises():
    assert DELAI_INDISPONIBLE > sum((delai_avant_tentative(n) for n in range(MAX_TENTATIVES)), timedelta())


def test_l_api_expose_analyse_statut_en_liste(ctx, moteur):
    ancien = ctx.avis("a", COMMENTAIRE_A, age=timedelta(days=2))
    recent = ctx.avis("a", "Avis récent", age=timedelta(0))
    # la date de référence de l'API est l'heure réelle : on rend les avis relatifs à elle
    s = ctx.Session()
    maintenant = datetime.now(timezone.utc)
    s.query(Feedback).filter(Feedback.id == ancien).update({"date_soumission": maintenant - timedelta(days=2)})
    s.query(Feedback).filter(Feedback.id == recent).update({"date_soumission": maintenant - timedelta(seconds=30)})
    s.commit(); s.close()
    r = ctx.client.get("/feedbacks/", headers=ctx.H(ctx.cx_a))
    statuts = {f["id"]: f["analyse_statut"] for f in r.json()}
    assert statuts[str(ancien)] == ETAT_INDISPONIBLE
    assert statuts[str(recent)] == ETAT_EN_ATTENTE


# ─────────────────────────── le formulaire client est inchangé ───────────────────────────

def _soumettre(ctx, cle, **extra):
    return ctx.client.post("/feedbacks/", params={"qr_code": ctx.ag[cle].code}, json={"categorie_id": str(ctx.ag[cle].cat), "note": 3, **extra})


def test_le_formulaire_repond_normalement_meme_si_le_moteur_echoue(ctx, moteur):
    moteur.echoue = True
    r = _soumettre(ctx, "a", commentaire="Un avis pendant la panne")
    assert r.status_code == 201, r.text
    assert ctx.nb(Feedback) == 1 and ctx.nb(AnalyseIA) == 0
    assert ctx.nb(HistoriqueFeedback, HistoriqueFeedback.type_evenement == TYPE_ECHEC_REPRISE) == 0     # le formulaire n'écrit aucun événement de reprise
    assert "analyse_statut" not in r.json() or r.json()["analyse_statut"] is None


def test_le_formulaire_analyse_toujours_comme_avant_quand_le_moteur_marche(ctx, moteur):
    r = _soumettre(ctx, "a", commentaire="Très bon accueil")
    assert r.status_code == 201, r.text
    assert ctx.nb(AnalyseIA) == 1 and ctx.nb(Recommandation) >= 0


def test_un_avis_du_formulaire_en_panne_est_repris_ensuite(ctx, moteur):
    moteur.echoue = True
    r = _soumettre(ctx, "a", commentaire="Un avis pendant la panne")
    assert r.status_code == 201
    moteur.echoue = False
    # l'avis vient d'être créé avec l'heure réelle : on se place 10 minutes après lui
    assert ctx.job(datetime.now(timezone.utc) + timedelta(minutes=10))["reussis"] == 1
    assert ctx.nb(AnalyseIA) == 1


# ─────────────────────────── organisation désactivée, isolation, données personnelles ───────────────────────────

def test_les_avis_d_une_organisation_desactivee_ne_sont_pas_repris(ctx, moteur):
    fid = ctx.avis("a", COMMENTAIRE_A)
    ctx.definir_active("a", False)
    appels = len(moteur.appels)
    assert ctx.job(minutes(30))["selectionnes"] == 0
    assert len(moteur.appels) == appels and ctx.nb(AnalyseIA, AnalyseIA.feedback_id == fid) == 0
    assert ctx.nb(HistoriqueFeedback, HistoriqueFeedback.type_evenement == TYPE_ECHEC_REPRISE) == 0
    ctx.definir_active("a", True)                                # réactivée : l'avis est repris
    assert ctx.job(minutes(30))["reussis"] == 1


def test_aucune_donnee_personnelle_n_est_transmise_au_moteur(ctx, moteur):
    ctx.avis("a", COMMENTAIRE_A, note=2, contact=True)
    moteur.echoue = True
    ctx.job(minutes(6))
    moteur.echoue = False
    ctx.job(minutes(30))
    assert len(moteur.appels) == 2
    for args, kwargs in moteur.appels:
        assert args == (COMMENTAIRE_A, 2) and kwargs == {}                    # le texte de l'avis et la note, rien d'autre
        vu = repr((args, kwargs))
        for interdit in (CONTACT_NOM, CONTACT_TEL, CONTACT_EMAIL, "Awa", "SECRET"):
            assert interdit not in vu


def test_la_criticite_et_les_recommandations_ne_recoivent_aucune_donnee_personnelle(ctx, moteur, monkeypatch):
    vus = []
    vrai_crit, vrai_reco = analyse_service.compute_criticite, analyse_service.generer_recommandations
    monkeypatch.setattr(analyse_service, "compute_criticite", lambda *a, **k: (vus.append(repr((a, k))), vrai_crit(*a, **k))[1])
    monkeypatch.setattr(analyse_service, "generer_recommandations", lambda *a, **k: (vus.append(repr((a, k))), vrai_reco(*a, **k))[1])
    ctx.avis("a", COMMENTAIRE_A, note=1, contact=True)
    assert ctx.job(minutes(6))["reussis"] == 1
    assert vus and not any(x in " ".join(vus) for x in (CONTACT_NOM, CONTACT_TEL, CONTACT_EMAIL, "Awa"))


def test_isolation_entre_deux_organisations(ctx, moteur):
    a = ctx.avis("a", COMMENTAIRE_A, note=5)       # note haute mais texte NEG : le sentiment dépend bien du TEXTE DE CET AVIS
    b = ctx.avis("b", COMMENTAIRE_B, note=1)
    assert ctx.job(minutes(6))["reussis"] == 2
    sa = ctx.requete(AnalyseIA.sentiment, AnalyseIA.feedback_id == a)[0][0]
    sb = ctx.requete(AnalyseIA.sentiment, AnalyseIA.feedback_id == b)[0][0]
    assert sa == moteur.vrai(COMMENTAIRE_A, 5)[0] and sb == moteur.vrai(COMMENTAIRE_B, 1)[0]
    # chaque appel du moteur ne reçoit que le texte d'un avis, jamais un mélange
    for args, _ in moteur.appels:
        assert args[0] in (COMMENTAIRE_A, COMMENTAIRE_B)
    assert sorted(a[0] for a, _ in moteur.appels) == sorted([COMMENTAIRE_A, COMMENTAIRE_B])
    # chaque analyse est rattachée à l'avis de sa propre organisation
    s = ctx.Session()
    try:
        orgs = dict(s.execute(select(Feedback.id, Agence.organisation_id).join(QRCode, QRCode.id == Feedback.qr_code_id)
                              .join(Agence, Agence.id == QRCode.agence_id)).all())
        analyses = s.execute(select(AnalyseIA.feedback_id)).scalars().all()
    finally:
        s.close()
    assert orgs[a] == ctx.ag["a"].org and orgs[b] == ctx.ag["b"].org and set(analyses) == {a, b}


# ─────────────────────────── idempotence ───────────────────────────

def test_le_job_est_idempotent_apres_succes(ctx, moteur):
    fid = ctx.avis("a", COMMENTAIRE_A)
    assert ctx.job(minutes(6))["reussis"] == 1
    reco_avant = ctx.nb(Recommandation)
    appels = len(moteur.appels)
    second = ctx.job(minutes(6))
    assert second == {"selectionnes": 0, "reussis": 0, "echecs": 0, "abandonnes": 0}
    assert ctx.nb(AnalyseIA, AnalyseIA.feedback_id == fid) == 1 and ctx.nb(Recommandation) == reco_avant and len(moteur.appels) == appels


def test_le_job_est_idempotent_apres_echec_dans_le_meme_instant(ctx, moteur):
    ctx.avis("a", COMMENTAIRE_A)
    moteur.echoue = True
    assert ctx.job(minutes(6))["echecs"] == 1
    assert ctx.job(minutes(6))["selectionnes"] == 0               # deux exécutions de suite : un seul échec compté
    assert ctx.nb(HistoriqueFeedback, HistoriqueFeedback.type_evenement == TYPE_ECHEC_REPRISE) == 1


def test_un_avis_deja_analyse_n_est_jamais_selectionne(ctx, moteur):
    fid = ctx.avis("a", COMMENTAIRE_A)
    s = ctx.Session()
    from app.models.enums import CriticiteType
    s.add(AnalyseIA(id=uuid4(), feedback_id=fid, sentiment=SentimentType.POSITIF, criticite=CriticiteType.FAIBLE, score_sentiment=0.9))
    s.commit(); s.close()
    assert ctx.job(minutes(60))["selectionnes"] == 0 and len(moteur.appels) == 0


# ─────────────────────────── aucune lecture n'écrit ───────────────────────────

def test_aucune_route_de_lecture_ne_declenche_la_reprise(ctx, moteur, monkeypatch):
    fid = ctx.avis("a", COMMENTAIRE_A, age=timedelta(days=3))
    moteur.echoue = True

    def interdit(*a, **k):
        raise AssertionError("la reprise ne doit être appelée par aucune lecture")

    monkeypatch.setattr(reprise_analyse, "reprendre_analyses", interdit)
    monkeypatch.setattr(reprise_analyse, "_selection", interdit)
    s = ctx.Session()
    agence_a = ctx.ag["a"].agence
    s.close()
    h = ctx.H(ctx.cx_a)
    assert ctx.client.get("/feedbacks/", headers=h).status_code == 200
    assert ctx.client.get(f"/feedbacks/{fid}/historique", headers=h).status_code == 200
    assert ctx.client.get(f"/agences/{agence_a}/activite", headers=h).status_code == 200
    assert ctx.client.get(f"/feedbacks/{fid}", headers=h).status_code == 200      # lecture avec l'ancien filet existant : sans reprise
    assert ctx.nb(HistoriqueFeedback, HistoriqueFeedback.type_evenement == TYPE_ECHEC_REPRISE) == 0


def test_les_lectures_de_liste_et_d_historique_ne_creent_aucune_analyse(ctx, moteur):
    fid = ctx.avis("a", COMMENTAIRE_A, age=timedelta(days=3))
    h = ctx.H(ctx.cx_a)
    ctx.client.get("/feedbacks/", headers=h)
    ctx.client.get(f"/feedbacks/{fid}/historique", headers=h)
    assert ctx.nb(AnalyseIA) == 0 and len(moteur.appels) == 0


def test_les_evenements_techniques_n_apparaissent_ni_dans_l_historique_ni_dans_l_activite(ctx, moteur):
    fid = ctx.avis("a", COMMENTAIRE_A)
    moteur.echoue = True
    ctx.job(minutes(6))
    assert ctx.nb(HistoriqueFeedback, HistoriqueFeedback.type_evenement == TYPE_ECHEC_REPRISE) == 1
    h = ctx.H(ctx.cx_a)
    historique = ctx.client.get(f"/feedbacks/{fid}/historique", headers=h)
    assert historique.status_code == 200 and all(e["type_evenement"] != TYPE_ECHEC_REPRISE for e in historique.json())
    activite = ctx.client.get(f"/agences/{ctx.ag['a'].agence}/activite", headers=h)
    assert activite.status_code == 200 and TYPE_ECHEC_REPRISE not in json.dumps(activite.json())


# ─────────────────────────── requêtes SQL ───────────────────────────

def _compter(engine, fonction):
    requetes = []

    def ecouteur(conn, cursor, statement, *a):
        requetes.append(statement)

    event.listen(engine, "before_cursor_execute", ecouteur)
    try:
        fonction()
    finally:
        event.remove(engine, "before_cursor_execute", ecouteur)
    return requetes


@pytest.mark.parametrize("n", [1, 3, 30])
def test_la_selection_est_une_seule_requete_quel_que_soit_le_nombre_d_avis(ctx, n):
    for i in range(n):
        ctx.avis("a" if i % 2 else "b", f"Avis {i}")
    s = ctx.Session()
    requetes = _compter(ctx.engine, lambda: reprise_analyse._selection(s, minutes(30)))
    s.close()
    assert len(requetes) == 1 and requetes[0].lstrip().upper().startswith("SELECT")


@pytest.mark.parametrize("n", [1, 3, 30])
def test_la_phase_de_selection_du_job_reste_a_une_requete_avant_la_premiere_analyse(ctx, monkeypatch, n):
    """Mesure sur le job entier : avant que le premier avis soit analysé, une seule requête a été émise, quel que soit le nombre d'avis."""
    for i in range(n):
        ctx.avis("a" if i % 2 else "b", f"Avis {i}")
    avant_premiere_analyse = []
    requetes = []

    def ecouteur(conn, cursor, statement, *a):
        requetes.append(statement)

    def analyse_espionne(feedback_id, db):
        if not avant_premiere_analyse:
            avant_premiere_analyse.append(len(requetes))

    monkeypatch.setattr(reprise_analyse, "analyser_feedback", analyse_espionne)
    event.listen(ctx.engine, "before_cursor_execute", ecouteur)
    try:
        ctx.job(minutes(30))
    finally:
        event.remove(ctx.engine, "before_cursor_execute", ecouteur)
    assert avant_premiere_analyse == [1]


def test_un_passage_a_vide_ne_fait_qu_une_requete_de_lecture(ctx):
    requetes = _compter(ctx.engine, lambda: ctx.job(minutes(30)))
    assert len(requetes) == 1 and requetes[0].lstrip().upper().startswith("SELECT")


def test_le_lot_est_plafonne(ctx, monkeypatch):
    monkeypatch.setattr(reprise_analyse, "TAILLE_LOT", 4)
    for i in range(10):
        ctx.avis("a", f"Avis {i}", note=5)
    assert ctx.job(minutes(30))["selectionnes"] == 4
    assert ctx.job(minutes(30))["selectionnes"] == 4
    assert ctx.job(minutes(30))["selectionnes"] == 2


# ─────────────────────────── planification ───────────────────────────

def test_le_job_est_planifie_au_demarrage_toutes_les_5_minutes(monkeypatch):
    from apscheduler.triggers.interval import IntervalTrigger

    from app.main import app, scheduler

    with TestClient(app):
        job = scheduler.get_job("reprise_analyses_ia")
        assert job is not None and isinstance(job.trigger, IntervalTrigger)
        assert job.trigger.interval == timedelta(minutes=reprise_analyse.INTERVALLE_JOB_MINUTES) == timedelta(minutes=5)
        assert job.max_instances == 1 and job.func is reprise_analyse.reprendre_analyses
