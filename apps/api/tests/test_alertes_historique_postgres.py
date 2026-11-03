"""
Historique des épisodes (PR 4/5) sur une base PostgreSQL JETABLE (TEST_DATABASE_URL, jamais celle de .env, jamais ikanai-prod ni ikanai-dev) :
plans d'exécution (EXPLAIN) des requêtes de GET /alertes/episodes sur quelques milliers d'épisodes, règle des 48 h et pagination en SQL réel.
Aucun index n'est créé par ce test : il vérifie que les index EXISTANTS (migration 034) servent. Se skippe sans TEST_DATABASE_URL.
"""
import json
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-alertes-historique-pg-0123456789")

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "")
if not TEST_DATABASE_URL:
    pytest.skip("TEST_DATABASE_URL non défini : base Postgres jetable requise (jamais la base de .env).", allow_module_level=True)

import sqlalchemy as sa
from sqlalchemy import event
from sqlalchemy.orm import Session

from app.models.agence import Agence
from app.models.alerte_episode import AlerteEpisode
from app.models.enums import UserRole
from app.models.organisation import Organisation
from app.models.utilisateur import Utilisateur
from app.services import alertes_episodes as ep

from tests.test_alertes_episodes_postgres import pg  # noqa: F401  (migrations à la tête, base jetable)

UTC = timezone.utc
NB_ORGANISATIONS = 40
AGENCES_PAR_ORGANISATION = 5
EPISODES_PAR_AGENCE = 20            # 40 × 5 × 20 = 4 000 épisodes


@pytest.fixture()
def volume(pg):  # noqa: F811
    """4 000 épisodes TERMINÉS ou ouverts, répartis sur 40 organisations de 5 agences (un seul ouvert par agence : index unique partiel)."""
    marque = uuid.uuid4().hex[:8]
    maintenant = datetime.now(UTC)
    organisations, agences, lignes = [], [], []
    with Session(pg) as s:
        for i in range(NB_ORGANISATIONS):
            org = Organisation(id=uuid.uuid4(), nom=f"Org {i} {marque}", active=True, secteur_activite="Services", email_pro=f"org-{i}-{marque}@test.io")
            s.add(org); s.flush()
            organisations.append(org.id)
            for j in range(AGENCES_PAR_ORGANISATION):
                ag = Agence(id=uuid.uuid4(), organisation_id=org.id, nom=f"Agence {i}-{j}", ville="V", active=True, seuil_alerte=70)
                s.add(ag); s.flush()
                agences.append((org.id, ag.id))
        cx = Utilisateur(id=uuid.uuid4(), organisation_id=organisations[0], agence_id=None, nom="N", prenom="P", email=f"cx-{marque}@test.io", mot_de_passe_hash="x",
                         role=UserRole.CX_MANAGER, active=True)
        am = Utilisateur(id=uuid.uuid4(), organisation_id=agences[0][0], agence_id=agences[0][1], nom="N", prenom="P", email=f"am-{marque}@test.io",
                         mot_de_passe_hash="x", role=UserRole.AGENCY_MANAGER, active=True)
        s.add_all([cx, am]); s.commit()
        for n, (org_id, ag_id) in enumerate(agences):
            for k in range(EPISODES_PAR_AGENCE):
                debut = maintenant - timedelta(hours=60 * (k + 1) + n % 7)
                ouvert = k == 0
                valeurs = dict(id=uuid.uuid4(), organisation_id=org_id, agence_id=ag_id, debut_condition=debut, detecte_le=debut + timedelta(minutes=5),
                               taux_ouverture=40.0, seuil_ouverture=70.0)
                if not ouvert:
                    fin = debut + timedelta(hours=20 + 5 * k)      # de 25 h à 115 h : environ la moitié franchit les 48 h
                    valeurs.update(statut="terminee", fin_condition=fin, terminee_le=fin, fin_cause="retablie", taux_fermeture=80.0, seuil_fermeture=70.0)
                lignes.append(valeurs)
        s.execute(sa.insert(AlerteEpisode), lignes)
        s.commit()
        s.execute(sa.text("ANALYZE alerte_episodes"))
        s.commit()
        cx_id, am_id = cx.id, am.id
    yield dict(cx=cx_id, am=am_id, org=organisations[0], agence=agences[0][1], autre_agence=agences[1][1], marque=marque, nb=len(lignes))
    with Session(pg) as s:
        s.query(Utilisateur).filter(Utilisateur.id.in_([cx_id, am_id])).delete(synchronize_session=False)
        s.query(Organisation).filter(Organisation.id.in_(organisations)).delete(synchronize_session=False)
        s.commit()


def plans(moteur, appeler):
    """Exécute `appeler()` et retourne, pour chaque requête sur alerte_episodes qu'elle a émise, son plan EXPLAIN (JSON)."""
    capturees = []

    def ecoute(conn, cursor, statement, parameters, context, executemany):
        if " alerte_episodes" in statement and statement.lstrip().upper().startswith("SELECT"):
            capturees.append((statement, parameters))

    event.listen(moteur, "before_cursor_execute", ecoute)
    try:
        appeler()
    finally:
        event.remove(moteur, "before_cursor_execute", ecoute)
    resultat = []
    with moteur.connect() as conn:
        for statement, parametres in capturees:
            brut = conn.exec_driver_sql("EXPLAIN (FORMAT JSON) " + statement, parametres).scalar()
            resultat.append((statement, brut if isinstance(brut, list) else json.loads(brut)))
    return resultat


def index_utilises(plan):
    return sorted({n["Index Name"] for n in noeuds(plan) if n.get("Index Name")})


def noeuds(plan):
    pile = [plan[0]["Plan"]]
    while pile:
        n = pile.pop()
        yield n
        pile.extend(n.get("Plans", []))


def balayages(plan):
    return [(n["Node Type"], n.get("Index Name"), n.get("Relation Name")) for n in noeuds(plan) if n["Node Type"].endswith("Scan")]


def test_les_requetes_de_l_historique_utilisent_les_index_existants(pg, volume):  # noqa: F811
    assert volume["nb"] == 4000
    with Session(pg) as s:
        cx, am = s.get(Utilisateur, volume["cx"]), s.get(Utilisateur, volume["am"])
        s.expunge_all()
    scenarios = {
        "AM, première page": lambda: _lister(pg, am),
        "AM, filtre statut": lambda: _lister(pg, am, statuts=["terminee"]),
        "AM, période": lambda: _lister(pg, am, du=datetime.now(UTC) - timedelta(days=60), au=datetime.now(UTC) - timedelta(days=10)),
        "CX, première page (règle des 48 h)": lambda: _lister(pg, cx),
        "CX, filtre agence": lambda: _lister(pg, cx, agence_id=volume["agence"]),
        "CX, statut actifs + période": lambda: _lister(pg, cx, statuts=["detectee", "prise_en_charge"], du=datetime.now(UTC) - timedelta(days=90)),
    }
    for nom, appeler in scenarios.items():
        for statement, plan in plans(pg, appeler):
            if "FROM alerte_episodes" not in statement or "count(" in statement.lower():
                continue
            utilises = index_utilises(plan)
            print(f"[{nom}] noeuds : {sorted({n['Node Type'] for n in noeuds(plan)})} ; index : {utilises} ; coût {plan[0]['Plan']['Total Cost']:.1f} ; lignes estimées {plan[0]['Plan']['Plan Rows']}")
            assert ("Seq Scan", None, "alerte_episodes") not in balayages(plan), f"{nom} : balayage séquentiel de alerte_episodes"
            assert any(x.startswith(("ix_alerte_episodes_", "uq_alerte_episode_ouvert")) for x in utilises), f"{nom} : aucun index d'alerte_episodes utilisé"


def test_le_detail_utilise_la_cle_primaire(pg, volume):  # noqa: F811
    with Session(pg) as s:
        am = s.get(Utilisateur, volume["am"])
        un = s.query(AlerteEpisode.id).filter(AlerteEpisode.agence_id == volume["agence"]).first()[0]
        s.expunge_all()
    for statement, plan in plans(pg, lambda: _lire(pg, am, un)):
        if "FROM alerte_episodes" in statement:
            scans = [x for x in balayages(plan) if x[2] == "alerte_episodes"]
            print("\n[détail]", scans)
            assert scans and all(x[0] != "Seq Scan" for x in scans), scans


def test_resultats_identiques_sur_postgres_regle_des_48h_et_pagination(pg, volume):  # noqa: F811
    with Session(pg) as s:
        cx, am = s.get(Utilisateur, volume["cx"]), s.get(Utilisateur, volume["am"])
        s.expunge_all()
    maintenant = datetime.now(UTC)
    with Session(pg) as s:
        tout, curseur, pages = [], None, 0
        while True:
            page, curseur = ep.lister_historique(s, cx, limite=20, curseur=curseur, maintenant=maintenant)
            tout += page
            pages += 1
            if curseur is None:
                break
        assert len(tout) == len({e.id for e, _ in tout}) and pages > 1
        assert all(e.organisation_id == volume["org"] for e, _ in tout), "aucun épisode d'une autre organisation"
        debuts = [e.debut_condition for e, _ in tout]
        assert debuts == sorted(debuts, reverse=True)
        for e, _ in tout:                                                      # règle des 48 h appliquée par PostgreSQL
            if e.statut == "terminee":
                assert e.fin_condition - e.debut_condition >= timedelta(hours=48)
            else:
                assert e.debut_condition <= maintenant - timedelta(hours=48)
        attendu_terminees = s.query(AlerteEpisode).filter(
            AlerteEpisode.organisation_id == volume["org"], AlerteEpisode.statut == "terminee",
            AlerteEpisode.fin_condition - AlerteEpisode.debut_condition >= timedelta(hours=48)).count()
        assert sum(1 for e, _ in tout if e.statut == "terminee") == attendu_terminees
        ouverts_am, _ = ep.lister_historique(s, am, limite=100, maintenant=maintenant)
        assert len(ouverts_am) == EPISODES_PAR_AGENCE and all(e.agence_id == volume["agence"] for e, _ in ouverts_am), "l'Agency Manager voit tout, de sa seule agence"


def _lister(moteur, utilisateur, **kw):
    with Session(moteur) as s:
        return ep.lister_historique(s, utilisateur, limite=20, **kw)


def _lire(moteur, utilisateur, episode_id):
    with Session(moteur) as s:
        return ep.lire_episode(s, utilisateur, episode_id)
