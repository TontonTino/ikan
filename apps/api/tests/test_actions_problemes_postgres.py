"""
Liste des actions de problème `GET /issues/actions` (PR 6/10) sur une base PostgreSQL JETABLE (TEST_DATABASE_URL, jamais celle de .env, jamais ikanai-prod ni ikanai-dev),
avec plusieurs milliers de lignes (12 organisations, 36 agences, 6 480 problèmes, 12 960 actions). Les requêtes RÉELLEMENT émises par l'endpoint sont capturées puis passées à
EXPLAIN (ANALYZE). Preuve assertée : avec `enable_seqscan = off`, aucune requête ne retombe sur un parcours séquentiel (les index existent et servent) ; le plan naturel est
affiché, pas asserté (sur de petites tables le planificateur hésite selon les statistiques). Se skippe sans TEST_DATABASE_URL.
"""
import os
from datetime import datetime, timedelta, timezone

import pytest

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-actions-problemes-pg-0123456789")

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "")
if not TEST_DATABASE_URL:
    pytest.skip("TEST_DATABASE_URL non défini : base Postgres jetable requise (jamais la base de .env).", allow_module_level=True)

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.models.action_corrective import ActionCorrective
from app.models.issue import Issue

from tests.test_alertes_episodes_postgres import pg  # noqa: F401
from tests.test_alertes_prise_en_charge_postgres import appeler, reelle  # noqa: F401
from tests.test_problemes_lecture_postgres import AGENCES_PAR_ORG, ISSUES_PAR_AGENCE, _expliquer, _rapport, _sequentiels, volume  # noqa: F401

UTC = timezone.utc
PAR_ORG = AGENCES_PAR_ORG * ISSUES_PAR_AGENCE      # problèmes (et actions « à faire », une par problème) de l'organisation du CX


def test_liste_du_cx_manager_sur_plusieurs_milliers_de_lignes_utilise_les_index(pg, volume, reelle):  # noqa: F811
    cx = volume["users"]["cx"]
    reponse, plans = _expliquer(pg, lambda: appeler(reelle, "GET", "/api/v1/issues/actions?limit=50&etat=a_faire", cx))
    _rapport("Actions, CX Manager, page de 50", plans)
    assert len(reponse.json()) == 50 and reponse.headers["x-total-count"] == str(PAR_ORG)
    assert not _sequentiels(plans), f"index manquant ou inutilisable : {_sequentiels(plans)}"
    ligne = reponse.json()[0]
    assert ligne["issue_titre"].startswith("Problème") and ligne["agence_nom"].startswith("Agence vol")


def test_liste_de_l_agency_manager_utilise_les_index(pg, volume, reelle):  # noqa: F811
    am = volume["users"]["am"]
    reponse, plans = _expliquer(pg, lambda: appeler(reelle, "GET", "/api/v1/issues/actions?limit=50", am))
    _rapport("Actions, Agency Manager, page de 50", plans)
    assert reponse.headers["x-total-count"] == str(2 * ISSUES_PAR_AGENCE)                 # SES actions seulement : une agence
    assert not _sequentiels(plans), f"index manquant ou inutilisable : {_sequentiels(plans)}"


def test_filtres_en_retard_etat_et_periode_utilisent_les_index(pg, volume, reelle):  # noqa: F811
    cx = volume["users"]["cx"]
    debut = (datetime.now(UTC) - timedelta(days=30)).isoformat().replace("+00:00", "Z")
    reponse, plans = _expliquer(pg, lambda: appeler(reelle, "GET", f"/api/v1/issues/actions?limit=50&etat=a_faire&en_retard=true&date_debut={debut}", cx))
    _rapport("Actions, CX Manager, a_faire + en_retard + date_debut", plans)
    assert not _sequentiels(plans), f"index manquant ou inutilisable : {_sequentiels(plans)}"
    assert all(a["en_retard"] is True for a in reponse.json())


def test_trois_requetes_sur_les_actions_quelle_que_soit_la_page(pg, volume, reelle):  # noqa: F811
    """Comptage, page, dernière-à-faire : 3 requêtes sur les actions, que la page compte 1 ou 200 lignes."""
    cx = volume["users"]["cx"]
    nombres = []
    for limite in (1, 200):
        _, plans = _expliquer(pg, lambda limite=limite: appeler(reelle, "GET", f"/api/v1/issues/actions?limit={limite}", cx))
        nombres.append(len(plans))
    assert nombres == [3, 3], nombres


def test_les_chiffres_sont_exacts_sur_le_volume(pg, volume, reelle):  # noqa: F811
    cx = volume["users"]["cx"]
    maintenant = datetime.now(UTC)
    with Session(pg) as s:
        def combien(*filtres):
            return (s.query(ActionCorrective).join(Issue, Issue.id == ActionCorrective.issue_id)
                    .filter(Issue.organisation_id == volume["orgs"][0], *filtres).count())
        attendu = {
            "a_faire": combien(ActionCorrective.statut.notin_(("terminee", "annulee"))),
            "terminee": combien(ActionCorrective.statut == "terminee"),
            "retard": combien(ActionCorrective.statut.notin_(("terminee", "annulee")), ActionCorrective.echeance < maintenant),
        }
    for etat, cle in (("a_faire", "a_faire"), ("terminee", "terminee")):
        assert int(appeler(reelle, "GET", f"/api/v1/issues/actions?limit=1&etat={etat}", cx).headers["x-total-count"]) == attendu[cle]
    assert int(appeler(reelle, "GET", "/api/v1/issues/actions?limit=1&en_retard=true", cx).headers["x-total-count"]) == attendu["retard"]
    assert attendu["a_faire"] == PAR_ORG and attendu["terminee"] == PAR_ORG
