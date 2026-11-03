"""
Prise en charge d'une alerte de seuil (PR 3/5) sur une base PostgreSQL JETABLE (TEST_DATABASE_URL, jamais celle de .env, jamais ikanai-prod ni ikanai-dev) :
CONCURRENCE réelle (deux clics simultanés = une seule prise en charge ; prise en charge contre fin automatique) et fuseau de date_assignation.
Se skippe sans TEST_DATABASE_URL.
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-alertes-prise-en-charge-pg-0123456789")

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "")
if not TEST_DATABASE_URL:
    pytest.skip("TEST_DATABASE_URL non défini : base Postgres jetable requise (jamais la base de .env).", allow_module_level=True)

import sqlalchemy as sa
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.v1.endpoints import alertes
from app.core.security import create_access_token
from app.db.session import get_db
from app.models.agence import Agence
from app.models.alerte_episode import AlerteEpisode
from app.models.feedback import Feedback
from app.models.journal_audit import JournalAudit
from app.models.qr_code import QRCode
from app.services import journal_audit as journal

from tests.test_alertes_episodes_postgres import application, donnees, en_parallele, lire, ouverts, pg  # noqa: F401  (même jeu de données, même base jetable)

UTC = timezone.utc
NB_CLICS = 10


@pytest.fixture()
def reelle(pg, monkeypatch):  # noqa: F811
    """Le vrai routeur de l'application (app.main) sur la base jetable : /alertes et /feedbacks, authentification JWT réelle."""
    from app.main import app

    monkeypatch.setattr(alertes, "organisation_a_la_fonctionnalite", lambda *a, **k: True)

    def override_db():
        db = Session(pg)
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_db
    try:
        yield app
    finally:
        app.dependency_overrides.pop(get_db, None)


def appeler(app, methode, url, utilisateur_id, json=None):
    return TestClient(app, raise_server_exceptions=False).request(methode, url, headers={"Authorization": f"Bearer {create_access_token(utilisateur_id)}"},
                                                                  **({"json": json} if json is not None else {}))


def prendre(app, episode_id, utilisateur_id, commentaire=None):
    return appeler(app, "POST", f"/api/v1/alertes/episodes/{episode_id}/prendre-en-charge", utilisateur_id, {"commentaire": commentaire})


def lignes_journal(pg, action, cible_id):
    with Session(pg) as s:
        return s.query(JournalAudit).filter(JournalAudit.action == action, JournalAudit.cible_id == str(cible_id)).all()


def episode(pg, episode_id):
    with Session(pg) as s:
        return s.get(AlerteEpisode, episode_id)


def test_deux_clics_simultanes_une_seule_prise_en_charge_les_autres_recoivent_409(pg, donnees, reelle):
    assert appeler(reelle, "GET", "/api/v1/alertes/", donnees["users"]["cx_a"]).status_code == 200      # la vraie réconciliation ouvre les épisodes
    (ouvert,) = ouverts(pg, [donnees["agences_a"][0]])
    am = donnees["users"]["am_a0"]
    reponses = en_parallele(NB_CLICS, lambda i: prendre(reelle, ouvert.id, am, f"clic-{i}"))
    codes = sorted(r.status_code for r in reponses)
    assert codes == [200] + [409] * (NB_CLICS - 1), codes                                                   # exactement UN succès, les autres 409
    gagnante = next(r for r in reponses if r.status_code == 200).json()
    for r in reponses:
        if r.status_code == 409:
            assert "déjà prise en charge" in r.json()["detail"]
    e = episode(pg, ouvert.id)
    assert e.statut == "prise_en_charge" and e.pris_en_charge_par_id == am and e.pris_en_charge_le.tzinfo is not None
    assert e.commentaire_prise_en_charge == gagnante["commentaire_prise_en_charge"] and e.commentaire_prise_en_charge.startswith("clic-"), "l'état écrit est celui du seul gagnant"
    assert len(lignes_journal(pg, journal.ALERTE_EPISODE_PRIS_EN_CHARGE, ouvert.id)) == 1, "une seule ligne de journal : les perdants n'écrivent rien"
    assert all("clic-" not in str(l.details) for l in lignes_journal(pg, journal.ALERTE_EPISODE_PRIS_EN_CHARGE, ouvert.id)), "jamais le commentaire dans le journal"


def test_prise_en_charge_contre_fin_automatique_un_etat_final_toujours_coherent(pg, donnees, reelle):
    """Les données remontent (l'épisode va se terminer) pendant qu'un clic de prise en charge arrive : quel que soit l'ordre, rien n'est perdu ni incohérent."""
    assert appeler(reelle, "GET", "/api/v1/alertes/", donnees["users"]["cx_a"]).status_code == 200
    agence = donnees["agences_a"][0]
    (ouvert,) = ouverts(pg, [agence])
    am, cx = donnees["users"]["am_a0"], donnees["users"]["cx_a"]
    with Session(pg) as s:
        qr = s.query(QRCode).filter(QRCode.agence_id == agence).one().id
        for i in range(30):
            s.add(Feedback(id=uuid.uuid4(), qr_code_id=qr, note=5, statut_traitement="nouveau", date_soumission=datetime.now(UTC) - timedelta(hours=1 + i / 100)))
        s.commit()

    def travail(i):
        return prendre(reelle, ouvert.id, am, "pendant-la-fin") if i == 0 else appeler(reelle, "GET", "/api/v1/alertes/", cx)

    reponses = en_parallele(6, travail)
    assert all(r.status_code in (200, 409) for r in reponses), [r.status_code for r in reponses]
    e = episode(pg, ouvert.id)
    assert e.statut == "terminee" and e.fin_cause == "retablie", "les données ont montré la fin : elle a toujours lieu"
    lignes = lignes_journal(pg, journal.ALERTE_EPISODE_PRIS_EN_CHARGE, ouvert.id)
    if reponses[0].status_code == 200:       # la prise en charge a eu lieu AVANT la fin : elle est conservée
        assert e.pris_en_charge_le is not None and e.pris_en_charge_par_id == am and e.commentaire_prise_en_charge == "pendant-la-fin" and len(lignes) == 1
    else:                                    # la fin a eu lieu d'abord : 409 « terminée », aucune prise en charge fantôme
        assert "terminée" in reponses[0].json()["detail"] and e.pris_en_charge_le is None and e.pris_en_charge_par_id is None and lignes == []
    assert len(lignes_journal(pg, journal.ALERTE_EPISODE_TERMINE, ouvert.id)) == 1, "une seule fin enregistrée"


def test_date_assignation_ecrite_en_utc_meme_si_la_session_postgres_n_est_pas_en_utc(pg, donnees, reelle):
    """Session Postgres en Asie/Tokyo : une date naïve serait décalée de 9 h ; l'instant UTC explicite, jamais."""
    from app.main import app

    moteur_tokyo = sa.create_engine(TEST_DATABASE_URL, connect_args={"options": "-c timezone=Asia/Tokyo"})

    def override_db():
        db = Session(moteur_tokyo)
        try:
            yield db
        finally:
            db.close()

    precedent = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = override_db
    try:
        with Session(pg) as s:
            qr = s.query(QRCode).filter(QRCode.agence_id == donnees["agences_a"][0]).one().id
            feedback_id = s.query(Feedback).filter(Feedback.qr_code_id == qr).first().id
        avant = datetime.now(UTC)
        r = appeler(app, "POST", f"/api/v1/feedbacks/{feedback_id}/prendre-en-charge", donnees["users"]["am_a0"])
        assert r.status_code == 200, r.text
    finally:
        app.dependency_overrides[get_db] = precedent
        moteur_tokyo.dispose()
    with Session(pg) as s:
        ecrite = s.get(Feedback, feedback_id).date_assignation
    assert ecrite.tzinfo is not None
    assert avant - timedelta(seconds=30) <= ecrite <= datetime.now(UTC) + timedelta(seconds=30), f"date_assignation décalée : {ecrite} (maintenant {avant})"
