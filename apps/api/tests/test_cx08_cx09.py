"""
CX-08 — l'action à mener du CX Manager n'est possible que sur un avis critique ou négatif, jugé par le SERVEUR (en base).
CX-09 — recommandations IA regroupées par agence, statut « à traiter » / « traitée » réversible, historique conservé.

Vrai routeur, vrai JWT, SQLite en mémoire, deux organisations (A : agences A1 et A2, B : agence B1).
"""
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from sqlalchemy import event

from app.api.v1.endpoints import recommandations
from app.core.erreurs_validation import installer_erreurs_validation
from app.models.agence import Agence
from app.models.analyse_ia import AnalyseIA
from app.models.enums import CriticiteType, PriorityLevel, SentimentType
from app.models.feedback import Feedback
from app.models.historique_feedback import HistoriqueFeedback
from app.models.recommandation import Recommandation
from tests.test_cycle_traitement_avis import ctx as _ctx  # noqa: F401  (fixture de base)

ACTION = "Former l'équipe d'accueil aux heures de pointe"


@pytest.fixture()
def ctx(_ctx):
    _ctx.client.app.include_router(recommandations.router, prefix="/recommandations")
    installer_erreurs_validation(_ctx.client.app)
    return _ctx


def creer_avis(ctx, code="QR-A1", note=1, sentiment=SentimentType.NEGATIF, criticite=CriticiteType.FAIBLE, statut="en_traitement", analyse=True):
    db = ctx.Session()
    fb = Feedback(id=uuid4(), qr_code_id=ctx.qr[code], note=note, commentaire="avis", statut_traitement=statut,
                  date_soumission=datetime.now(timezone.utc) - timedelta(hours=2))
    db.add(fb); db.flush()
    if analyse:
        db.add(AnalyseIA(id=uuid4(), feedback_id=fb.id, sentiment=sentiment, criticite=criticite, score_sentiment=0.5, theme_principal="accueil"))
    db.commit()
    fid = fb.id
    db.close()
    return fid


def lire(ctx, fid):
    db = ctx.Session()
    try:
        fb = db.get(Feedback, fid)
        return fb.statut_traitement, fb.action_a_prendre, db.query(HistoriqueFeedback).filter(HistoriqueFeedback.feedback_id == fid).count()
    finally:
        db.close()


def action(ctx, acteur, fid, corps=None):
    return ctx.client.post(f"/feedbacks/{fid}/action-cx", json=corps if corps is not None else {"action": ACTION}, headers=ctx.H(getattr(ctx, acteur)))


# ── CX-08 ──────────────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("note,sentiment,criticite", [
    (1, SentimentType.POSITIF, CriticiteType.FAIBLE),     # négatif par la note
    (4, SentimentType.NEGATIF, CriticiteType.FAIBLE),     # négatif par le ton
    (5, SentimentType.POSITIF, CriticiteType.CRITIQUE),   # critique malgré une bonne note
    (3, SentimentType.NEUTRE, CriticiteType.ELEVEE),      # gravité élevée
    (2, SentimentType.NEUTRE, CriticiteType.FAIBLE),      # limite : note 2
])
def test_avis_critique_ou_negatif_accepte(ctx, note, sentiment, criticite):
    fid = creer_avis(ctx, note=note, sentiment=sentiment, criticite=criticite)
    r = action(ctx, "cx_a", fid)
    assert r.status_code == 200, r.text
    assert lire(ctx, fid)[:2] == ("en_cours", ACTION)


def test_avis_negatif_sans_analyse_accepte_par_la_note(ctx):
    fid = creer_avis(ctx, note=1, analyse=False)
    assert action(ctx, "cx_a", fid).status_code == 200


@pytest.mark.parametrize("note,sentiment,criticite", [
    (3, SentimentType.NEUTRE, CriticiteType.MOYENNE),     # limite : note 3, gravité moyenne
    (5, SentimentType.POSITIF, CriticiteType.FAIBLE),
])
def test_avis_ordinaire_refuse_avec_message_clair_et_base_inchangee(ctx, note, sentiment, criticite):
    fid = creer_avis(ctx, note=note, sentiment=sentiment, criticite=criticite)
    avant = lire(ctx, fid)
    r = action(ctx, "cx_a", fid)
    assert r.status_code == 409
    assert "ni critique ni négatif" in r.json()["detail"]
    assert lire(ctx, fid) == avant == ("en_traitement", None, 0)


def test_avis_ordinaire_sans_analyse_refuse(ctx):
    fid = creer_avis(ctx, note=5, analyse=False)
    assert action(ctx, "cx_a", fid).status_code == 409


def test_indicateur_falsifie_par_le_navigateur_est_ignore(ctx):
    ordinaire = creer_avis(ctx, note=5, sentiment=SentimentType.POSITIF, criticite=CriticiteType.FAIBLE)
    corps = {"action": ACTION, "critique": True, "negatif": True, "est_negatif": True, "criticite": "critique", "sentiment": "negatif", "note": 1}
    r = action(ctx, "cx_a", ordinaire, corps)
    assert r.status_code == 409 and lire(ctx, ordinaire) == ("en_traitement", None, 0)
    # Sur un avis réellement critique, les mêmes champs n'ont aucun effet non plus (ils sont ignorés, pas appliqués).
    vrai = creer_avis(ctx, note=1)
    assert action(ctx, "cx_a", vrai, {"action": ACTION, "criticite": "faible", "note": 5, "est_negatif": False}).status_code == 200
    db = ctx.Session()
    assert db.get(Feedback, vrai).note == 1
    db.close()


def test_avis_d_une_autre_organisation_refuse_base_inchangee(ctx):
    fid = creer_avis(ctx, "QR-A1")
    avant = lire(ctx, fid)
    r = action(ctx, "cx_b", fid)
    assert r.status_code == 403
    assert lire(ctx, fid) == avant
    fid_b = creer_avis(ctx, "QR-B1")
    assert action(ctx, "cx_a", fid_b).status_code == 403 and lire(ctx, fid_b) == ("en_traitement", None, 0)
    assert action(ctx, "cx_a", uuid4()).status_code == 404


def test_valeur_invalide_422_sans_echo(ctx):
    fid = creer_avis(ctx)
    for corps in ({"action": "ab"}, {"action": "x" * 2001}, {}):
        r = action(ctx, "cx_a", fid, corps)
        assert r.status_code == 422
    r = action(ctx, "cx_a", fid, {"action": ["SECRET-ECHO-42"]})
    assert r.status_code == 422
    assert "SECRET" not in r.text
    r = ctx.client.post(f"/feedbacks/pas-un-uuid-SECRET-42/action-cx", json={"action": ACTION}, headers=ctx.H(ctx.cx_a))
    assert r.status_code == 422 and "SECRET-42" not in r.text
    assert lire(ctx, fid) == ("en_traitement", None, 0)


def test_regles_existantes_conservees(ctx):
    nouveau = creer_avis(ctx, statut="nouveau")
    r = action(ctx, "cx_a", nouveau)
    assert r.status_code == 409 and "pas encore été pris en charge" in r.json()["detail"]
    assert action(ctx, "am_a1", creer_avis(ctx)).status_code == 403          # le Responsable d'agence ne définit pas l'action
    fid = creer_avis(ctx)
    assert action(ctx, "cx_a", fid).status_code == 200
    assert action(ctx, "cx_a", fid).status_code == 200                        # même texte : sans effet
    assert action(ctx, "cx_a", fid, {"action": "Autre texte différent"}).status_code == 409


# ── CX-09 : recommandations groupées par agence ────────────────────────────────────────────────


def creer_reco(ctx, code="QR-A1", traitee=False, jours=1.0, priorite=PriorityLevel.HIGH):
    db = ctx.Session()
    fb = Feedback(id=uuid4(), qr_code_id=ctx.qr[code], note=1, commentaire="avis", statut_traitement="nouveau",
                  date_soumission=datetime.now(timezone.utc) - timedelta(days=jours))
    db.add(fb); db.flush()
    analyse = AnalyseIA(id=uuid4(), feedback_id=fb.id, sentiment=SentimentType.NEGATIF, criticite=CriticiteType.CRITIQUE, score_sentiment=0.1, theme_principal="attente")
    db.add(analyse); db.flush()
    reco = Recommandation(id=uuid4(), analyse_ia_id=analyse.id, contenu=f"reco {code} {jours}", priorite=priorite, traitee=traitee,
                          date_generation=datetime.now(timezone.utc) - timedelta(days=jours))
    db.add(reco)
    db.commit()
    rid, fid = reco.id, fb.id
    db.close()
    return rid, fid


def groupees(ctx, acteur="cx_a", extra=""):
    r = ctx.client.get(f"/recommandations/organisation/groupees{extra}", headers=ctx.H(getattr(ctx, acteur)))
    assert r.status_code == 200, r.text
    return r.json()


def test_regroupement_par_agence_tri_et_agence_sans_reco_a_traiter_absente(ctx):
    for jours in (5, 3, 1):
        creer_reco(ctx, "QR-A1", jours=jours)
    creer_reco(ctx, "QR-A2", jours=9)
    creer_reco(ctx, "QR-A2", traitee=True, jours=20)                  # traitée : ne compte pas dans « à traiter »
    donnees = groupees(ctx)
    assert [(g["agence_nom"], g["nombre"]) for g in donnees["groupes"]] == [("Agence A1", 3), ("Agence A2", 1)]
    assert donnees["total"] == 4
    a1 = donnees["groupes"][0]
    assert len(a1["recommandations"]) == 3 and a1["plus_ancienne"].startswith((datetime.now(timezone.utc) - timedelta(days=5)).strftime("%Y-%m-%d"))
    assert donnees["groupes"][1]["plus_ancienne"].startswith((datetime.now(timezone.utc) - timedelta(days=9)).strftime("%Y-%m-%d"))
    assert all(not r["traitee"] for g in donnees["groupes"] for r in g["recommandations"])


def test_agence_sans_reco_a_traiter_absente(ctx):
    creer_reco(ctx, "QR-A1")
    creer_reco(ctx, "QR-A2", traitee=True)
    assert [g["agence_nom"] for g in groupees(ctx)["groupes"]] == ["Agence A1"]
    assert [g["agence_nom"] for g in groupees(ctx, extra="?traitee=true")["groupes"]] == ["Agence A2"]


def test_egalite_de_nombre_la_plus_ancienne_en_attente_d_abord(ctx):
    creer_reco(ctx, "QR-A1", jours=2)
    creer_reco(ctx, "QR-A2", jours=8)
    assert [g["agence_nom"] for g in groupees(ctx)["groupes"]] == ["Agence A2", "Agence A1"]


def test_vue_a_plat_existante_conservee(ctx):
    creer_reco(ctx, "QR-A1")
    creer_reco(ctx, "QR-A2", traitee=True)
    plat = ctx.client.get("/recommandations/organisation", headers=ctx.H(ctx.cx_a))
    assert plat.status_code == 200 and len(plat.json()) == 1 and plat.json()[0]["agence_nom"] == "Agence A1"
    assert plat.headers["x-total-count"] == "1"
    traitees = ctx.client.get("/recommandations/organisation?traitee=true", headers=ctx.H(ctx.cx_a)).json()
    assert [r["agence_nom"] for r in traitees] == ["Agence A2"]


def test_filtre_par_agence_et_plafond_par_groupe(ctx):
    creer_reco(ctx, "QR-A2")
    for i in range(25):
        creer_reco(ctx, "QR-A1", jours=1 + i / 100)
    assert [g["agence_nom"] for g in groupees(ctx, extra=f"?agence_id={ctx.a2}")["groupes"]] == ["Agence A2"]
    a1 = groupees(ctx)["groupes"][0]
    assert a1["nombre"] == 25 and len(a1["recommandations"]) == recommandations.NB_PAR_GROUPE


def test_isolation_du_regroupement_entre_organisations(ctx):
    creer_reco(ctx, "QR-A1")
    creer_reco(ctx, "QR-B1")
    assert [g["agence_nom"] for g in groupees(ctx, "cx_a")["groupes"]] == ["Agence A1"]
    assert [g["agence_nom"] for g in groupees(ctx, "cx_b")["groupes"]] == ["Agence B1"]
    assert groupees(ctx, "cx_a", extra=f"?agence_id={ctx.b1}") == {"groupes": [], "total": 0}      # agence d'une autre organisation
    assert [g["agence_nom"] for g in groupees(ctx, "am_a1")["groupes"]] == ["Agence A1"]
    assert groupees(ctx, "am_a2") == {"groupes": [], "total": 0}


def test_agence_inactive_exclue(ctx):
    creer_reco(ctx, "QR-A1")
    creer_reco(ctx, "QR-A2")
    db = ctx.Session()
    db.get(Agence, ctx.a2).active = False
    db.commit(); db.close()
    assert [g["agence_nom"] for g in groupees(ctx)["groupes"]] == ["Agence A1"]


def test_nombre_de_requetes_constant(ctx):
    engine = ctx.Session.kw["bind"]
    compteur = {"n": 0}

    def compter(*_):
        compteur["n"] += 1

    def mesurer():
        compteur["n"] = 0
        event.listen(engine, "before_cursor_execute", compter)
        try:
            groupees(ctx)
        finally:
            event.remove(engine, "before_cursor_execute", compter)
        return compteur["n"]

    creer_reco(ctx, "QR-A1")
    un = mesurer()
    for _ in range(5):
        creer_reco(ctx, "QR-A1")
        creer_reco(ctx, "QR-A2")
    assert mesurer() == un == 3                          # 1 lecture de l'utilisateur + agrégat par agence + extraits


def reouvrir(ctx, acteur, rid):
    return ctx.client.patch(f"/recommandations/{rid}/rouvrir", headers=ctx.H(getattr(ctx, acteur)))


def traiter(ctx, acteur, rid):
    return ctx.client.patch(f"/recommandations/{rid}/traiter", headers=ctx.H(getattr(ctx, acteur)))


def etat(ctx, rid, fid):
    db = ctx.Session()
    try:
        evenements = [(h.type_evenement, h.ancien_statut, h.nouveau_statut, h.auteur_nom, h.auteur_role, h.date_evenement is not None)
                      for h in db.query(HistoriqueFeedback).filter(HistoriqueFeedback.feedback_id == fid).order_by(HistoriqueFeedback.date_evenement).all()]
        return db.get(Recommandation, rid).traitee, evenements
    finally:
        db.close()


def test_remise_a_traiter_depuis_traitee_avec_historique(ctx):
    rid, fid = creer_reco(ctx, traitee=True)
    r = reouvrir(ctx, "cx_a", rid)
    assert r.status_code == 200
    traitee, evenements = etat(ctx, rid, fid)
    assert traitee is False
    assert evenements == [("recommandation_rouverte", "traitee", "a_traiter", "P N", "cx_manager", True)]
    assert [g["agence_nom"] for g in groupees(ctx)["groupes"]] == ["Agence A1"]


def test_cycle_complet_traiter_puis_rouvrir_historique_conserve(ctx):
    rid, fid = creer_reco(ctx)
    assert traiter(ctx, "cx_a", rid).status_code == 200
    assert traiter(ctx, "cx_a", rid).status_code == 200            # répété : sans effet, sans doublon d'historique
    assert reouvrir(ctx, "cx_a", rid).status_code == 200
    traitee, evenements = etat(ctx, rid, fid)
    assert traitee is False
    assert [e[0] for e in evenements] == ["recommandation_traitee", "recommandation_rouverte"]


def test_remise_a_traiter_refusee_si_deja_a_traiter(ctx):
    rid, fid = creer_reco(ctx, traitee=False)
    r = reouvrir(ctx, "cx_a", rid)
    assert r.status_code == 409 and "déjà à traiter" in r.json()["detail"]
    assert etat(ctx, rid, fid) == (False, [])
    assert reouvrir(ctx, "cx_a", uuid4()).status_code == 404


def test_remise_a_traiter_d_une_autre_organisation_refusee_base_inchangee(ctx):
    rid, fid = creer_reco(ctx, "QR-A1", traitee=True)
    assert reouvrir(ctx, "cx_b", rid).status_code == 403
    assert etat(ctx, rid, fid) == (True, [])
    assert reouvrir(ctx, "am_a2", rid).status_code == 403          # autre agence de la même organisation
    assert etat(ctx, rid, fid) == (True, [])
    assert reouvrir(ctx, "am_a1", rid).status_code == 200          # le Responsable de l'agence concernée garde ce droit
