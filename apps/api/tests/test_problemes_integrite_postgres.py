"""
Intégrité des actions d'un problème (PR 3/10) sur une base PostgreSQL JETABLE (TEST_DATABASE_URL, jamais celle de .env, jamais ikanai-prod ni ikanai-dev) :
 - CONCURRENCE réelle : 10 appels simultanés pour terminer la même action = une seule fin ; deux actions terminées en même temps = le problème est bien « Résolu » ;
 - fuseau : les cinq dates écrites par issues.py sont des instants UTC même quand la session PostgreSQL est réglée sur Asia/Tokyo (une date naïve serait décalée de 9 h).
Se skippe sans TEST_DATABASE_URL.
"""
import os
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import pytest

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-integrite-problemes-pg-0123456789")

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "")
if not TEST_DATABASE_URL:
    pytest.skip("TEST_DATABASE_URL non défini : base Postgres jetable requise (jamais la base de .env).", allow_module_level=True)

from sqlalchemy.orm import Session

from app.models.action_corrective import ActionCorrective
from app.models.feedback import Feedback
from app.models.historique_issue import HistoriqueIssue
from app.models.issue import Issue
from app.models.qr_code import QRCode

from tests.test_alertes_episodes_postgres import donnees, pg  # noqa: F401  (même jeu de données, même base jetable)
from tests.test_alertes_prise_en_charge_postgres import appeler, reelle  # noqa: F401
from tests.test_dates_utc_postgres import _est_maintenant_utc, session_tokyo  # noqa: F401

UTC = timezone.utc
NB_APPELS = 10


def _nouvel_issue(app, donnees, titre="Problème de test"):
    r = appeler(app, "POST", "/api/v1/issues/", donnees["users"]["cx_a"], {"titre": titre, "agence_id": str(donnees["agences_a"][0])})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _nouvelle_action(app, donnees, iid, titre="Action de test", responsable=None):
    r = appeler(app, "POST", f"/api/v1/issues/{iid}/actions", donnees["users"]["cx_a"], {"titre": titre, **({"responsable_id": str(responsable)} if responsable else {})})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _evenements(pg, iid, type_evenement):  # noqa: F811
    with Session(pg) as s:
        return s.query(HistoriqueIssue).filter(HistoriqueIssue.issue_id == uuid.UUID(iid), HistoriqueIssue.type_evenement == type_evenement).count()


def _en_parallele(app, appels):
    """Lance tous les appels au même instant (barrière) et renvoie leurs réponses."""
    barriere = threading.Barrier(len(appels))

    def lancer(appel):
        barriere.wait()
        return appel()

    with ThreadPoolExecutor(max_workers=len(appels)) as pool:
        return list(pool.map(lancer, appels))


def test_dix_appels_simultanes_pour_terminer_une_action_donnent_une_seule_fin(pg, donnees, reelle):  # noqa: F811
    iid = _nouvel_issue(reelle, donnees)
    aid = _nouvelle_action(reelle, donnees, iid, responsable=donnees["users"]["am_a0"])         # PR 6b : le responsable et le CX Manager terminent, en concurrence
    cx, am = donnees["users"]["cx_a"], donnees["users"]["am_a0"]
    appels = [lambda u=(cx if i % 2 else am): appeler(reelle, "POST", f"/api/v1/issues/{iid}/actions/{aid}/terminer", u) for i in range(NB_APPELS)]
    reponses = _en_parallele(reelle, appels)

    assert [r.status_code for r in reponses] == [200] * NB_APPELS, [(r.status_code, r.text[:100]) for r in reponses]
    assert len({r.json()["date_completion"] for r in reponses}) == 1, "tous les appels voient la MÊME date de fin"
    assert _evenements(pg, iid, "action_terminee") == 1, "une seule fin dans l'historique"
    assert _evenements(pg, iid, "issue_resolue") == 1, "une seule résolution du problème"
    with Session(pg) as s:
        action = s.get(ActionCorrective, uuid.UUID(aid))
        issue = s.get(Issue, uuid.UUID(iid))
        assert action.statut == "terminee" and issue.statut == "resolue"
        premiere_resolution = issue.date_resolution
    # un appel tardif ne réécrit rien
    assert appeler(reelle, "POST", f"/api/v1/issues/{iid}/actions/{aid}/terminer", cx).status_code == 200
    with Session(pg) as s:
        assert s.get(Issue, uuid.UUID(iid)).date_resolution == premiere_resolution
    assert _evenements(pg, iid, "action_terminee") == 1


def test_deux_actions_terminees_en_meme_temps_le_probleme_est_bien_resolu(pg, donnees, reelle):  # noqa: F811
    """Sans le verrou de ligne sur l'Issue, chacune verrait l'autre « à faire » et personne ne résoudrait le problème (résolution perdue)."""
    for _ in range(5):
        iid = _nouvel_issue(reelle, donnees)
        a1, a2 = _nouvelle_action(reelle, donnees, iid, "Action 1"), _nouvelle_action(reelle, donnees, iid, "Action 2")
        cx = donnees["users"]["cx_a"]
        reponses = _en_parallele(reelle, [lambda a=a: appeler(reelle, "POST", f"/api/v1/issues/{iid}/actions/{a}/terminer", cx) for a in (a1, a2)])
        assert [r.status_code for r in reponses] == [200, 200]
        with Session(pg) as s:
            assert s.get(Issue, uuid.UUID(iid)).statut == "resolue"
        assert _evenements(pg, iid, "issue_resolue") == 1


def test_une_action_annulee_ne_bloque_pas_la_resolution_sur_postgres(pg, donnees, reelle):  # noqa: F811
    iid = _nouvel_issue(reelle, donnees)
    a1, a2 = _nouvelle_action(reelle, donnees, iid, "Action 1"), _nouvelle_action(reelle, donnees, iid, "Action 2")
    with Session(pg) as s:
        s.query(ActionCorrective).filter(ActionCorrective.id == uuid.UUID(a2)).update({"statut": "annulee"})
        s.commit()
    assert appeler(reelle, "POST", f"/api/v1/issues/{iid}/actions/{a1}/terminer", donnees["users"]["cx_a"]).status_code == 200
    with Session(pg) as s:
        assert s.get(Issue, uuid.UUID(iid)).statut == "resolue"


# ── Dates : session PostgreSQL en Asia/Tokyo ─────────────────────────────────────────────────────────────────────────────────

def _avis_de_l_agence(pg, donnees):  # noqa: F811
    with Session(pg) as s:
        qr = s.query(QRCode).filter(QRCode.agence_id == donnees["agences_a"][0]).one().id
        return [f.id for f in s.query(Feedback).filter(Feedback.qr_code_id == qr).order_by(Feedback.date_soumission).all()]


def _issue(pg, iid):  # noqa: F811
    with Session(pg) as s:
        return s.get(Issue, uuid.UUID(iid))


def test_derniere_detection_a_la_creation_en_utc_meme_si_la_session_est_en_tokyo(pg, donnees, session_tokyo):  # noqa: F811
    avis = _avis_de_l_agence(pg, donnees)
    avant = datetime.now(UTC)
    r = appeler(session_tokyo, "POST", "/api/v1/issues/", donnees["users"]["cx_a"], {"titre": "Avec avis", "agence_id": str(donnees["agences_a"][0]), "feedback_ids": [str(avis[0])]})
    assert r.status_code == 201, r.text
    _est_maintenant_utc(_issue(pg, r.json()["id"]).derniere_detection, avant)


def test_derniere_detection_au_rattachement_en_utc_meme_si_la_session_est_en_tokyo(pg, donnees, session_tokyo):  # noqa: F811
    avis = _avis_de_l_agence(pg, donnees)
    iid = _nouvel_issue(session_tokyo, donnees)
    avant = datetime.now(UTC)
    r = appeler(session_tokyo, "PATCH", f"/api/v1/issues/{iid}/rattacher-feedback/{avis[1]}", donnees["users"]["cx_a"])
    assert r.status_code == 200, r.text
    _est_maintenant_utc(_issue(pg, iid).derniere_detection, avant)


def test_date_completion_et_date_resolution_en_utc_meme_si_la_session_est_en_tokyo(pg, donnees, session_tokyo):  # noqa: F811
    iid = _nouvel_issue(session_tokyo, donnees)
    aid = _nouvelle_action(session_tokyo, donnees, iid)
    avant = datetime.now(UTC)
    assert appeler(session_tokyo, "POST", f"/api/v1/issues/{iid}/actions/{aid}/terminer", donnees["users"]["cx_a"]).status_code == 200
    with Session(pg) as s:
        _est_maintenant_utc(s.get(ActionCorrective, uuid.UUID(aid)).date_completion, avant)
    _est_maintenant_utc(_issue(pg, iid).date_resolution, avant)


def test_date_verification_en_utc_meme_si_la_session_est_en_tokyo(pg, donnees, session_tokyo):  # noqa: F811
    iid = _nouvel_issue(session_tokyo, donnees)
    aid = _nouvelle_action(session_tokyo, donnees, iid)
    cx = donnees["users"]["cx_a"]
    assert appeler(session_tokyo, "POST", f"/api/v1/issues/{iid}/actions/{aid}/terminer", cx).status_code == 200
    avant = datetime.now(UTC)
    assert appeler(session_tokyo, "POST", f"/api/v1/issues/{iid}/verifier", cx).status_code == 200
    _est_maintenant_utc(_issue(pg, iid).date_verification, avant)
