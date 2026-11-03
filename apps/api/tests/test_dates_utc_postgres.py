"""
Dates avec fuseau en UTC (hygiène) sur une base PostgreSQL JETABLE (TEST_DATABASE_URL, jamais celle de .env, jamais ikanai-prod ni ikanai-dev) :
`suggestion_agence_date` et `date_resolution`, écrites par une session PostgreSQL réglée sur Asia/Tokyo. Une date naïve serait décalée de 9 h ;
l'instant UTC explicite, jamais. Se skippe sans TEST_DATABASE_URL.
"""
import os
from datetime import datetime, timedelta, timezone

import pytest

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-dates-utc-pg-0123456789")

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "")
if not TEST_DATABASE_URL:
    pytest.skip("TEST_DATABASE_URL non défini : base Postgres jetable requise (jamais la base de .env).", allow_module_level=True)

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.feedback import Feedback
from app.models.qr_code import QRCode

from tests.test_alertes_episodes_postgres import donnees, pg  # noqa: F401  (même jeu de données, même base jetable)
from tests.test_alertes_prise_en_charge_postgres import appeler

UTC = timezone.utc


@pytest.fixture()
def session_tokyo(pg):  # noqa: F811
    """Le vrai routeur de l'application, dont chaque requête ouvre une session PostgreSQL en Asia/Tokyo."""
    from app.main import app

    moteur = sa.create_engine(TEST_DATABASE_URL, connect_args={"options": "-c timezone=Asia/Tokyo"})

    def override_db():
        db = Session(moteur)
        try:
            yield db
        finally:
            db.close()

    precedent = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = override_db
    yield app
    app.dependency_overrides[get_db] = precedent
    moteur.dispose()


def _un_avis(pg, donnees):  # noqa: F811
    with Session(pg) as s:
        qr = s.query(QRCode).filter(QRCode.agence_id == donnees["agences_a"][0]).one().id
        return s.query(Feedback).filter(Feedback.qr_code_id == qr).first().id


def _colonne(pg, fid, nom):  # noqa: F811
    with Session(pg) as s:
        return getattr(s.get(Feedback, fid), nom)


def _est_maintenant_utc(valeur, avant):
    assert valeur.tzinfo is not None
    assert avant - timedelta(seconds=30) <= valeur <= datetime.now(UTC) + timedelta(seconds=30), f"date décalée : {valeur} (maintenant {avant})"


def test_suggestion_agence_date_en_utc_meme_si_la_session_n_est_pas_en_utc(pg, donnees, session_tokyo):  # noqa: F811
    fid = _un_avis(pg, donnees)
    avant = datetime.now(UTC)
    r = appeler(session_tokyo, "POST", f"/api/v1/feedbacks/{fid}/suggestion-agence", donnees["users"]["am_a0"], {"suggestion": "Prévoir un renfort le vendredi soir"})
    assert r.status_code == 200, r.text
    _est_maintenant_utc(_colonne(pg, fid, "suggestion_agence_date"), avant)


def test_date_resolution_en_utc_meme_si_la_session_n_est_pas_en_utc(pg, donnees, session_tokyo):  # noqa: F811
    fid = _un_avis(pg, donnees)
    with Session(pg) as s:
        s.query(Feedback).filter(Feedback.id == fid).update({"statut_traitement": "en_cours", "action_a_prendre": "Rappeler le client"})
        s.commit()
    avant = datetime.now(UTC)
    r = appeler(session_tokyo, "POST", f"/api/v1/feedbacks/{fid}/confirmer-action", donnees["users"]["am_a0"])
    assert r.status_code == 200, r.text
    assert r.json()["statut_traitement"] == "resolu"
    _est_maintenant_utc(_colonne(pg, fid, "date_resolution"), avant)
