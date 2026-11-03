"""
Écritures de dates avec fuseau en UTC explicite (hygiène) : `Feedback.suggestion_agence_date` (POST /feedbacks/{id}/suggestion-agence) et
`Feedback.date_resolution` (POST /feedbacks/{id}/confirmer-action) étaient écrites avec un `datetime.now()` naïf (heure locale du serveur, sans fuseau).
Ces colonnes sont `DateTime(timezone=True)` : elles reçoivent désormais `datetime.now(timezone.utc)`.

SQLite en mémoire : le `now` du module est espionné (l'argument de fuseau reçu est vérifié, et la valeur écrite est comparée à l'heure UTC).
Le décalage réel de fuseau (session PostgreSQL non UTC) est dans test_dates_utc_postgres.py. Les données existantes ne sont pas modifiées.
"""
import os
from datetime import datetime, timedelta, timezone

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-dates-utc-0123456789")

import pytest

from app.api.v1.endpoints import feedbacks
from app.models.feedback import Feedback

from tests.test_cycle_traitement_avis import _avis, ctx  # noqa: F401  (même jeu de données : deux organisations, Responsables d'agence)

UTC = timezone.utc


@pytest.fixture()
def espion(monkeypatch):
    """Remplace `datetime` du module des endpoints par une sous-classe dont `now` consigne le fuseau demandé (None = heure locale naïve)."""
    appels = []

    class DatetimeEspion(datetime):
        @classmethod
        def now(cls, tz=None):
            appels.append(tz)
            return datetime.now(tz)

    monkeypatch.setattr(feedbacks, "datetime", DatetimeEspion)
    return appels


def _colonne(ctx, fid, nom):
    db = ctx.Session()
    try:
        return getattr(db.get(Feedback, fid), nom)
    finally:
        db.close()


def _proche_de_maintenant_utc(valeur):
    """SQLite ne garde pas le fuseau : la valeur relue est naïve ; elle doit représenter l'instant UTC (et non l'heure locale du serveur)."""
    lue = valeur if valeur.tzinfo else valeur.replace(tzinfo=UTC)
    return abs(datetime.now(UTC) - lue) < timedelta(seconds=60)


def test_suggestion_agence_date_est_ecrite_en_utc(ctx, espion):
    fid = _avis(ctx, statut="en_traitement")
    r = ctx.client.post(f"/feedbacks/{fid}/suggestion-agence", json={"suggestion": "Prévoir un renfort le vendredi soir"}, headers=ctx.H(ctx.am_a1))
    assert r.status_code == 200, r.text
    assert espion == [UTC], f"datetime.now doit recevoir le fuseau UTC, reçu : {espion}"
    assert _proche_de_maintenant_utc(_colonne(ctx, fid, "suggestion_agence_date"))


def test_date_resolution_est_ecrite_en_utc(ctx, espion):
    fid = _avis(ctx, statut="en_cours")
    r = ctx.client.post(f"/feedbacks/{fid}/confirmer-action", headers=ctx.H(ctx.am_a1))
    assert r.status_code == 200, r.text
    assert r.json()["statut_traitement"] == "resolu"
    assert UTC in espion and None not in espion, f"datetime.now doit recevoir le fuseau UTC, reçu : {espion}"
    assert _proche_de_maintenant_utc(_colonne(ctx, fid, "date_resolution"))


def test_le_fichier_des_endpoints_n_ecrit_plus_ces_deux_dates_en_heure_locale():
    source = open(feedbacks.__file__, encoding="utf8").read()
    assert "suggestion_agence_date = now" in source and "now = datetime.now(timezone.utc)" in source
    assert "Feedback.date_resolution: datetime.now(timezone.utc)" in source
    assert "datetime.now()" not in source, "plus aucun datetime.now() naïf dans feedbacks.py"


def test_une_confirmation_repetee_n_ecrase_pas_la_date_de_resolution(ctx):
    fid = _avis(ctx, statut="en_cours")
    assert ctx.client.post(f"/feedbacks/{fid}/confirmer-action", headers=ctx.H(ctx.am_a1)).status_code == 200
    premiere = _colonne(ctx, fid, "date_resolution")
    assert ctx.client.post(f"/feedbacks/{fid}/confirmer-action", headers=ctx.H(ctx.am_a1)).status_code == 200
    assert _colonne(ctx, fid, "date_resolution") == premiere
