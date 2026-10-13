"""
Isolation d'un Agency Manager entre deux agences d'une MÊME organisation (AM de A1 face à A2), et face à une autre
organisation. Vrai routeur, vrai JWT, SQLite en mémoire. Chaque refus est jumelé à un cas positif (l'AM accède bien à SA
agence), pour ne jamais valider un refus généralisé par erreur. Un refus ne doit ni fuiter ni modifier la base.
"""
import pytest

from app.models.historique_feedback import HistoriqueFeedback
from app.models.action_corrective import ActionCorrective
from app.models.recommandation import Recommandation
from tests._fixture_deux_agences import SECRET_A2, TEL_A2, construire_contexte

REFUS = {403, 404}


@pytest.fixture()
def ctx():
    return construire_contexte()


def _sans_fuite(r):
    for interdit in (SECRET_A2, TEL_A2, "RECO-Agence A2", "EVT-Agence A2", "Agence A2", "Issue Agence A2"):
        assert interdit not in r.text, f"fuite : {interdit}"


def _empreinte(c):
    db = c.Session()
    try:
        return (
            sorted((str(r.id), r.traitee) for r in db.query(Recommandation).all()),
            db.query(ActionCorrective).count(),
            db.query(HistoriqueFeedback).count(),
        )
    finally:
        db.close()


@pytest.mark.parametrize("acteur", ["am_a1", "am_b1"])
def test_statistiques_agence_refusees_pour_une_autre_agence(ctx, acteur):
    avant = _empreinte(ctx)
    r = ctx.client.get(f"/dashboard/statistics/agency?agence_id={ctx.a2}", headers=ctx.H(getattr(ctx, acteur)))
    assert r.status_code in REFUS
    _sans_fuite(r)
    assert _empreinte(ctx) == avant


def test_statistiques_agence_accessibles_pour_sa_propre_agence(ctx):
    for chemin in ("/dashboard/statistics/agency", f"/dashboard/statistics/agency?agence_id={ctx.a1}"):
        r = ctx.client.get(chemin, headers=ctx.H(ctx.am_a1))
        assert r.status_code == 200, chemin
        assert r.json()["agence_nom"] == "Agence A1"
        _sans_fuite(r)


def test_recommandations_organisation_limitees_a_son_agence(ctx):
    r = ctx.client.get("/recommandations/organisation", headers=ctx.H(ctx.am_a1))
    assert r.status_code == 200
    assert {x["id"] for x in r.json()} == {str(ctx.reco_a1)}          # cas positif : la sienne est bien là
    _sans_fuite(r)
    r2 = ctx.client.get("/recommandations/organisation", headers=ctx.H(ctx.am_a2))
    assert {x["id"] for x in r2.json()} == {str(ctx.reco_a2)}          # et symétriquement pour A2
    assert r2.json()[0]["agence_nom"] == "Agence A2"
    r3 = ctx.client.get("/recommandations/organisation", headers=ctx.H(ctx.am_b1))
    assert r3.status_code == 200 and r3.json() == []                    # autre organisation : rien


@pytest.mark.parametrize("acteur", ["am_a1", "am_b1"])
def test_marquer_traitee_la_recommandation_d_une_autre_agence_est_refuse(ctx, acteur):
    avant = _empreinte(ctx)
    r = ctx.client.patch(f"/recommandations/{ctx.reco_a2}/traiter", headers=ctx.H(getattr(ctx, acteur)))
    assert r.status_code in REFUS
    _sans_fuite(r)
    assert _empreinte(ctx) == avant


def test_marquer_traitee_sa_propre_recommandation_fonctionne(ctx):
    r = ctx.client.patch(f"/recommandations/{ctx.reco_a1}/traiter", headers=ctx.H(ctx.am_a1))
    assert r.status_code == 200
    db = ctx.Session()
    try:
        assert db.get(Recommandation, ctx.reco_a1).traitee is True
        assert db.get(Recommandation, ctx.reco_a2).traitee is False
    finally:
        db.close()


@pytest.mark.parametrize("acteur", ["am_a1", "am_b1"])
def test_activite_d_une_autre_agence_refusee(ctx, acteur):
    r = ctx.client.get(f"/agences/{ctx.a2}/activite", headers=ctx.H(getattr(ctx, acteur)))
    assert r.status_code in REFUS
    _sans_fuite(r)


def test_activite_de_sa_propre_agence_accessible(ctx):
    r = ctx.client.get(f"/agences/{ctx.a1}/activite", headers=ctx.H(ctx.am_a1))
    assert r.status_code == 200
    assert [e["details"] for e in r.json()] == ["EVT-Agence A1"]
    _sans_fuite(r)


@pytest.mark.parametrize("acteur", ["am_a1", "am_b1"])
def test_creer_une_action_sur_le_probleme_d_une_autre_agence_est_refuse(ctx, acteur):
    avant = _empreinte(ctx)
    r = ctx.client.post(f"/issues/{ctx.issue_a2}/actions", headers=ctx.H(getattr(ctx, acteur)), json={"titre": "Action intruse"})
    assert r.status_code in REFUS
    _sans_fuite(r)
    assert _empreinte(ctx) == avant


def test_creer_une_action_sur_son_propre_probleme_fonctionne(ctx):
    r = ctx.client.post(f"/issues/{ctx.issue_a1}/actions", headers=ctx.H(ctx.am_a1), json={"titre": "Action légitime"})
    assert r.status_code == 201
    assert _empreinte(ctx)[1] == 1
