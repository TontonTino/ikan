"""
Lecture enrichie de `GET /issues/` (PR 4/10) sur une base PostgreSQL JETABLE (TEST_DATABASE_URL, jamais celle de .env, jamais ikanai-prod ni ikanai-dev), avec plusieurs milliers
de lignes : les requêtes RÉELLEMENT émises par l'endpoint sont capturées puis passées à EXPLAIN (ANALYZE).
 - Preuve ASSERTÉE : avec `enable_seqscan = off`, aucune requête ne retombe sur un parcours séquentiel : les index de la migration 016 (idx_issues_organisation_id,
   idx_issues_agence_id_statut, idx_feedbacks_issue_id, idx_actions_correctives_issue_id) existent et servent bien ces requêtes. Un index manquant ferait échouer le test.
 - Plan NATUREL : affiché seulement. Sur des tables de quelques milliers de lignes le planificateur hésite entre index et parcours séquentiel (coûts proches, moins de 2 ms
   dans les deux cas) ; ce choix dépend des statistiques et n'est donc pas asserté.
Se skippe sans TEST_DATABASE_URL.
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-lecture-problemes-pg-0123456789")

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "")
if not TEST_DATABASE_URL:
    pytest.skip("TEST_DATABASE_URL non défini : base Postgres jetable requise (jamais la base de .env).", allow_module_level=True)

import sqlalchemy as sa
from sqlalchemy import event
from sqlalchemy.orm import Session

from app.core.security import get_password_hash
from app.models.action_corrective import ActionCorrective
from app.models.agence import Agence
from app.models.enums import CriticiteType, UserRole
from app.models.feedback import Feedback
from app.models.issue import Issue
from app.models.organisation import Organisation
from app.models.qr_code import QRCode
from app.models.utilisateur import Utilisateur

from tests.test_alertes_episodes_postgres import pg  # noqa: F401  (même base jetable, migrée à la tête)
from tests.test_alertes_prise_en_charge_postgres import appeler, reelle  # noqa: F401

UTC = timezone.utc
NB_ORGS, AGENCES_PAR_ORG, ISSUES_PAR_AGENCE = 12, 3, 180          # 12 × 3 × 180 = 6 480 problèmes
TABLES_INDEXEES = {"actions_correctives", "feedbacks", "issues"}


@pytest.fixture()
def volume(pg):  # noqa: F811
    """12 organisations, 36 agences, 6 480 problèmes (statuts, délais variés), 2 actions et 1 avis chacun ; un CX Manager et un Agency Manager dans l'organisation 0."""
    marque = uuid.uuid4().hex[:8]
    maintenant = datetime.now(UTC)
    orgs, agences, qrs, utilisateurs = [], [], [], {}
    with Session(pg) as s:
        for o in range(NB_ORGS):
            org = Organisation(id=uuid.uuid4(), nom=f"Org vol {o} {marque}", active=True, secteur_activite="Services", email_pro=f"vol-{o}-{marque}@test.io")
            s.add(org); orgs.append(org.id)
        s.flush()
        for o, org_id in enumerate(orgs):
            for a in range(AGENCES_PAR_ORG):
                ag = Agence(id=uuid.uuid4(), organisation_id=org_id, nom=f"Agence vol {o}-{a} {marque}", ville="V", active=True, seuil_alerte=70)
                s.add(ag); s.flush()
                qr = QRCode(id=uuid.uuid4(), agence_id=ag.id, code=f"QRV-{marque}-{o}-{a}", url=f"http://t/{marque}/{o}/{a}", actif=True)
                s.add(qr); agences.append((org_id, ag.id)); qrs.append(qr.id)
        s.flush()
        for idx, (org_id, ag_id) in enumerate(agences):
            lignes_i, lignes_a, lignes_f = [], [], []
            for n in range(ISSUES_PAR_AGENCE):
                iid = uuid.uuid4()
                statut = ("ouverte", "action_en_cours", "resolue", "verifiee", "reouverte")[n % 5]
                lignes_i.append(dict(id=iid, organisation_id=org_id, agence_id=ag_id, titre=f"Problème {idx}-{n}", statut=statut, severite=CriticiteType.MOYENNE,
                                     necessite_action=False, premiere_detection=maintenant - timedelta(hours=n * 7),
                                     date_limite_sla=(maintenant + timedelta(days=(n % 9) - 4)) if n % 3 else None))
                for k in range(2):
                    lignes_a.append(dict(id=uuid.uuid4(), issue_id=iid, titre=f"Action {k}", statut=("creee", "terminee")[k], echeance=maintenant + timedelta(days=n % 11)))
                lignes_f.append(dict(id=uuid.uuid4(), qr_code_id=qrs[idx], note=2, commentaire="Avis", statut_traitement="nouveau", issue_id=iid, date_soumission=maintenant))
            s.execute(sa.insert(Issue), lignes_i)
            s.execute(sa.insert(ActionCorrective), lignes_a)
            s.execute(sa.insert(Feedback), lignes_f)

        def user(role, agence_id=None):
            u = Utilisateur(id=uuid.uuid4(), organisation_id=orgs[0], agence_id=agence_id, nom="N", prenom="P", email=f"{uuid.uuid4().hex[:10]}@test.io",
                            mot_de_passe_hash=get_password_hash("Motdepasse-123"), role=role, active=True)
            s.add(u); return u.id

        utilisateurs = dict(cx=user(UserRole.CX_MANAGER), am=user(UserRole.AGENCY_MANAGER, agences[0][1]))
        s.commit()
    # VACUUM ANALYZE (hors transaction) : l'état stable d'une base entretenue. Sans lui, les lignes mortes laissées par les tests précédents sur la même base
    # faussent les statistiques et le planificateur choisit un parcours séquentiel sur ces petites tables, ce qui ne dit rien des index.
    with pg.connect().execution_options(isolation_level="AUTOCOMMIT") as c:
        for table in ("issues", "actions_correctives", "feedbacks"):
            c.execute(sa.text(f"VACUUM (ANALYZE) {table}"))
    yield dict(orgs=orgs, agences=agences, users=utilisateurs, total=NB_ORGS * AGENCES_PAR_ORG * ISSUES_PAR_AGENCE)
    with Session(pg) as s:
        s.query(Utilisateur).filter(Utilisateur.id.in_(list(utilisateurs.values()))).delete(synchronize_session=False)
        s.query(Organisation).filter(Organisation.id.in_(orgs)).delete(synchronize_session=False)
        s.commit()


def _noeuds(plan):
    yield plan
    for enfant in plan.get("Plans", []):
        yield from _noeuds(enfant)


def _expliquer(pg, appel):  # noqa: F811
    """Capture les SELECT émis par `appel()` puis renvoie, pour chacun, (début de la requête, plan EXPLAIN ANALYZE)."""
    captures = []

    def ecouteur(conn, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            captures.append((statement, parameters))

    event.listen(pg, "before_cursor_execute", ecouteur)
    try:
        reponse = appel()
    finally:
        event.remove(pg, "before_cursor_execute", ecouteur)
    assert reponse.status_code == 200, reponse.text
    plans = []
    with pg.connect() as c:
        for statement, parameters in captures:
            if "issues" not in statement and "actions_correctives" not in statement and "feedbacks" not in statement:
                continue
            naturel = c.exec_driver_sql("EXPLAIN (ANALYZE, FORMAT JSON) " + statement, parameters).scalar()[0]
            with c.begin_nested():
                c.exec_driver_sql("SET LOCAL enable_seqscan = off")
                sans_seq = c.exec_driver_sql("EXPLAIN (FORMAT JSON) " + statement, parameters).scalar()[0]["Plan"]
            plans.append((" ".join(statement.split())[:110], naturel["Plan"], naturel["Execution Time"], sans_seq))
    return reponse, plans


def _sequentiels(plans):
    """Parcours séquentiels sur les trois tables du problème : il ne doit y en avoir aucun."""
    return [(requete, n["Relation Name"]) for requete, _, _, sans_seq in plans for n in _noeuds(sans_seq)
            if n["Node Type"] == "Seq Scan" and n.get("Relation Name") in TABLES_INDEXEES]


def _rapport(titre, plans):
    print(f"\n=== EXPLAIN : {titre}")
    for requete, plan, temps, sans_seq in plans:
        noeuds = [n['Node Type'] + (f" ({n['Relation Name']})" if 'Relation Name' in n else '') + (f" [{n['Index Name']}]" if 'Index Name' in n else '') for n in _noeuds(plan)]
        print(f"  {temps:7.2f} ms | {requete}\n             {' > '.join(noeuds)}")


def test_liste_du_cx_manager_sur_plusieurs_milliers_de_lignes_utilise_les_index(pg, volume, reelle):  # noqa: F811
    cx = volume["users"]["cx"]
    reponse, plans = _expliquer(pg, lambda: appeler(reelle, "GET", "/api/v1/issues/?limit=50", cx))
    _rapport("CX Manager, page de 50", plans)
    assert len(reponse.json()) == 50 and reponse.headers["x-total-count"] == str(AGENCES_PAR_ORG * ISSUES_PAR_AGENCE)
    assert not _sequentiels(plans), f"index manquant ou inutilisable : {_sequentiels(plans)}"
    ligne = reponse.json()[0]
    assert ligne["nb_actions"] == 2 and ligne["nb_actions_a_faire"] == 1 and ligne["nb_avis"] == 1


def test_liste_de_l_agency_manager_utilise_les_index(pg, volume, reelle):  # noqa: F811
    am = volume["users"]["am"]
    reponse, plans = _expliquer(pg, lambda: appeler(reelle, "GET", "/api/v1/issues/?limit=50", am))
    _rapport("Agency Manager, page de 50", plans)
    assert reponse.headers["x-total-count"] == str(ISSUES_PAR_AGENCE)
    assert not _sequentiels(plans), f"index manquant ou inutilisable : {_sequentiels(plans)}"


def test_filtres_en_retard_et_dates_utilisent_les_index(pg, volume, reelle):  # noqa: F811
    cx = volume["users"]["cx"]
    debut = (datetime.now(UTC) - timedelta(days=30)).isoformat().replace("+00:00", "Z")
    reponse, plans = _expliquer(pg, lambda: appeler(reelle, "GET", f"/api/v1/issues/?limit=50&en_retard=true&date_debut={debut}&tri=ancien", cx))
    _rapport("CX Manager, en_retard + date_debut", plans)
    assert not _sequentiels(plans), f"index manquant ou inutilisable : {_sequentiels(plans)}"
    assert all(i["en_retard"] is True for i in reponse.json())


def test_les_resultats_sont_coherents_avec_le_volume(pg, volume, reelle):  # noqa: F811
    """Chiffres exacts sur 1 620 problèmes d'une organisation : le filtre et le compteur disent la même chose que la base."""
    cx = volume["users"]["cx"]
    r = appeler(reelle, "GET", "/api/v1/issues/?limit=200&en_retard=true", cx)
    with Session(pg) as s:
        attendu = s.query(Issue).filter(Issue.organisation_id == volume["orgs"][0], Issue.date_limite_sla.isnot(None), Issue.date_limite_sla < datetime.now(UTC),
                                        Issue.statut.notin_(("resolue", "verifiee"))).count()
    assert int(r.headers["x-total-count"]) == attendu and attendu > 0
