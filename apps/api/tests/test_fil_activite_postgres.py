"""
Fil d'activité `GET /issues/{id}/historique` (PR 7/10) sur une base PostgreSQL JETABLE (TEST_DATABASE_URL, jamais celle de .env, jamais ikanai-prod ni ikanai-dev), avec plusieurs
milliers d'événements (6 480 problèmes × 3 événements + un problème à 3 000 événements). Les requêtes RÉELLEMENT émises sont capturées puis passées à EXPLAIN (ANALYZE) ; preuve assertée :
avec `enable_seqscan = off`, aucune requête ne retombe sur un parcours séquentiel de `historique_issues` ou `issues` (l'index idx_historique_issues_issue_id existe et sert). Le plan naturel
est affiché, pas asserté. Se skippe sans TEST_DATABASE_URL.
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-fil-activite-pg-0123456789")

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "")
if not TEST_DATABASE_URL:
    pytest.skip("TEST_DATABASE_URL non défini : base Postgres jetable requise (jamais la base de .env).", allow_module_level=True)

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.models.historique_issue import HistoriqueIssue
from app.models.issue import Issue
from app.models.utilisateur import Utilisateur

from tests.test_alertes_episodes_postgres import pg  # noqa: F401
from tests.test_alertes_prise_en_charge_postgres import appeler, reelle  # noqa: F401
from tests.test_problemes_lecture_postgres import ISSUES_PAR_AGENCE, _expliquer, _noeuds, _rapport, volume  # noqa: F401

UTC = timezone.utc
EVENEMENTS_PROBLEME_CHAUD = 3000
RELATIONS = {"historique_issues", "issues"}


@pytest.fixture()
def avec_historique(pg, volume):  # noqa: F811
    """Trois événements par problème ; un problème (organisation du CX) et un problème de l'agence de l'Agency Manager qui en ont 3 000 chacun."""
    maintenant = datetime.now(UTC)
    with Session(pg) as s:
        ids = [i.id for i in s.query(Issue).filter(Issue.organisation_id.in_(volume["orgs"])).all()]
        am = s.get(Utilisateur, volume["users"]["am"])
        chaud_agence_am = s.query(Issue.id).filter(Issue.agence_id == am.agence_id).first()[0]
        chaud_org = s.query(Issue.id).filter(Issue.organisation_id == volume["orgs"][0], Issue.agence_id != am.agence_id).first()[0]      # une AUTRE agence que celle de l'Agency Manager

        def evenement(iid, type_evenement, details, quand):
            return dict(id=uuid.uuid4(), issue_id=iid, auteur_nom="Awa Sawadogo", auteur_role="cx_manager", type_evenement=type_evenement, details=details, date_evenement=quand)

        lignes = [evenement(iid, t, f"Action {n}" if k else None, maintenant - timedelta(minutes=n + k))
                  for n, iid in enumerate(ids) for k, t in enumerate(("creation", "action_creee", "action_terminee"))]
        for cible in (chaud_org, chaud_agence_am):
            lignes += [evenement(cible, "feedback_rattache", None, maintenant - timedelta(seconds=k)) for k in range(EVENEMENTS_PROBLEME_CHAUD)]
        for debut in range(0, len(lignes), 5000):
            s.execute(sa.insert(HistoriqueIssue), lignes[debut:debut + 5000])
        s.commit()
    with pg.connect().execution_options(isolation_level="AUTOCOMMIT") as c:
        c.execute(sa.text("VACUUM (ANALYZE) historique_issues"))
    yield dict(volume, chaud_org=chaud_org, chaud_agence_am=chaud_agence_am)
    # nettoyage : les événements partent en cascade avec leurs problèmes (suppression des organisations par la fixture `volume`)


def _sequentiels(plans):
    return [(requete, n["Relation Name"]) for requete, _, _, sans_seq in plans for n in _noeuds(sans_seq) if n["Node Type"] == "Seq Scan" and n.get("Relation Name") in RELATIONS]


def test_fil_d_un_probleme_charge_utilise_l_index_pour_le_cx_manager(pg, avec_historique, reelle):  # noqa: F811
    cx = avec_historique["users"]["cx"]
    reponse, plans = _expliquer(pg, lambda: appeler(reelle, "GET", f"/api/v1/issues/{avec_historique['chaud_org']}/historique?limit=20", cx))
    _rapport("Fil, CX Manager, problème à 3 000 événements, page de 20", plans)
    assert len(reponse.json()) == 20 and int(reponse.headers["x-total-count"]) == EVENEMENTS_PROBLEME_CHAUD + 3
    assert not _sequentiels(plans), f"index manquant ou inutilisable : {_sequentiels(plans)}"
    dates = [e["date_evenement"] for e in reponse.json()]
    assert dates == sorted(dates, reverse=True)


def test_fil_d_un_probleme_charge_utilise_l_index_pour_l_agency_manager(pg, avec_historique, reelle):  # noqa: F811
    am = avec_historique["users"]["am"]
    reponse, plans = _expliquer(pg, lambda: appeler(reelle, "GET", f"/api/v1/issues/{avec_historique['chaud_agence_am']}/historique?limit=20&offset=1000", am))
    _rapport("Fil, Agency Manager, problème à 3 000 événements, page de 20 à l'offset 1000", plans)
    assert len(reponse.json()) == 20 and int(reponse.headers["x-total-count"]) >= 3000
    assert not _sequentiels(plans), f"index manquant ou inutilisable : {_sequentiels(plans)}"


def test_deux_requetes_sur_l_historique_quelle_que_soit_la_page(pg, avec_historique, reelle):  # noqa: F811
    cx = avec_historique["users"]["cx"]
    nombres = []
    for limite in (1, 100):
        _, plans = _expliquer(pg, lambda limite=limite: appeler(reelle, "GET", f"/api/v1/issues/{avec_historique['chaud_org']}/historique?limit={limite}", cx))
        nombres.append(sum(1 for requete, *_ in plans if "historique_issues" in requete))
    assert nombres == [2, 2], nombres                              # comptage + page


def test_un_probleme_d_une_autre_organisation_reste_un_404_sur_le_volume(pg, avec_historique, reelle):  # noqa: F811
    with Session(pg) as s:
        autre_org = s.query(Issue.id).filter(Issue.organisation_id == avec_historique["orgs"][1]).first()[0]
    cx = avec_historique["users"]["cx"]
    assert appeler(reelle, "GET", f"/api/v1/issues/{autre_org}/historique", cx).status_code == 404
    assert appeler(reelle, "GET", f"/api/v1/issues/{uuid.uuid4()}/historique", cx).status_code == 404
