"""
Épisodes d'alerte de seuil (PR 2/5) sur une base PostgreSQL JETABLE (TEST_DATABASE_URL, jamais celle de .env, jamais ikanai-prod ni ikanai-dev) :
migration 034 (table, colonnes, index unique partiel, contraintes, parité modèle / migration, upgrade / downgrade / re-upgrade AVEC données, aucune
autre table touchée) et CONCURRENCE réelle (plusieurs lectures simultanées de GET /alertes/ créent exactement UN épisode ouvert par agence, sans erreur).
Se skippe sans TEST_DATABASE_URL.
"""
import logging
import os
import subprocess
import sys
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-alertes-episodes-pg-0123456789")

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "")
if not TEST_DATABASE_URL:
    pytest.skip("TEST_DATABASE_URL non défini : base Postgres jetable requise (jamais la base de .env).", allow_module_level=True)

import sqlalchemy as sa
from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

import app.models  # noqa: F401
from app.api.v1.endpoints import alertes
from app.core.garde_production import est_base_de_production
from app.core.security import create_access_token, get_password_hash
from app.db.session import get_db
from app.models.agence import Agence
from app.models.alerte_episode import AlerteEpisode
from app.models.enums import UserRole
from app.models.feedback import Feedback
from app.models.journal_audit import JournalAudit
from app.models.organisation import Organisation
from app.models.qr_code import QRCode
from app.models.utilisateur import Utilisateur
from app.services import alertes_episodes as ep
from app.services import journal_audit as journal

assert not est_base_de_production(TEST_DATABASE_URL), "TEST_DATABASE_URL vise la production : tests arrêtés"
assert "localhost" in TEST_DATABASE_URL or "127.0.0.1" in TEST_DATABASE_URL, "TEST_DATABASE_URL doit être une base LOCALE jetable"

API_DIR = Path(__file__).resolve().parents[1]
REV, REV_PRECEDENTE = "034_alerte_episodes", "033_journal_audit"
UTC = timezone.utc
NB_LECTURES = 12
NB_AGENCES = 5


def alembic(*args):
    env = {**os.environ, "DATABASE_URL": TEST_DATABASE_URL, "SECRET_KEY": os.environ["SECRET_KEY"]}
    return subprocess.run([sys.executable, "-m", "alembic", *args], cwd=str(API_DIR), env=env, capture_output=True, text=True, timeout=300)


@pytest.fixture()
def pg():
    r = alembic("upgrade", "head")
    assert r.returncode == 0, r.stdout + r.stderr
    moteur = sa.create_engine(TEST_DATABASE_URL, pool_size=30, max_overflow=30)
    yield moteur
    moteur.dispose()
    alembic("upgrade", "head")                          # laisse la base à la tête, quoi qu'ait fait le test


@pytest.fixture()
def donnees(pg):
    """Deux organisations ; l'organisation A a NB_AGENCES agences sous leur seuil (4 mauvais avis récents chacune), la B une seule."""
    marque = uuid.uuid4().hex[:8]
    maintenant = datetime.now(UTC)
    ids = {"agences_a": [], "users": {}}
    with Session(pg) as s:
        org_a, org_b = (Organisation(id=uuid.uuid4(), nom=f"Org {n} {marque}", active=True, secteur_activite="Services", email_pro=f"org-{n.lower()}-{marque}@test.io") for n in ("A", "B"))
        s.add_all([org_a, org_b]); s.flush()
        agences = []
        for i, org in [(i, org_a) for i in range(NB_AGENCES)] + [(99, org_b)]:
            ag = Agence(id=uuid.uuid4(), organisation_id=org.id, nom=f"Agence {i} {marque}", ville="V", active=True, seuil_alerte=70)
            s.add(ag); s.flush()
            qr = QRCode(id=uuid.uuid4(), agence_id=ag.id, code=f"QR-{marque}-{i}", url=f"http://t/{marque}/{i}", actif=True)
            s.add(qr); s.flush()
            for h in (40, 30, 20, 10):
                s.add(Feedback(id=uuid.uuid4(), qr_code_id=qr.id, note=1, commentaire="TEXTE-SECRET-CLIENT", statut_traitement="nouveau",
                               date_soumission=maintenant - timedelta(hours=h)))
            agences.append((ag, qr))

        def user(role, org, agence=None):
            u = Utilisateur(id=uuid.uuid4(), organisation_id=org.id, agence_id=agence.id if agence else None, nom="N", prenom="P",
                            email=f"{uuid.uuid4().hex[:10]}@test.io", mot_de_passe_hash=get_password_hash("Motdepasse-123"), role=role, active=True)
            s.add(u)
            return u

        users = dict(cx_a=user(UserRole.CX_MANAGER, org_a), cx_b=user(UserRole.CX_MANAGER, org_b), am_a0=user(UserRole.AGENCY_MANAGER, org_a, agences[0][0]))
        s.commit()
        ids.update(org_a=org_a.id, org_b=org_b.id, agences_a=[a.id for a, _ in agences[:NB_AGENCES]], agence_b=agences[-1][0].id,
                   qr_a=[q.id for _, q in agences[:NB_AGENCES]], users={k: v.id for k, v in users.items()}, marque=marque)
    yield ids
    with Session(pg) as s:                              # nettoyage : épisodes et agences partent en cascade avec leur organisation
        s.query(Utilisateur).filter(Utilisateur.id.in_(list(ids["users"].values()))).delete(synchronize_session=False)
        s.query(Organisation).filter(Organisation.id.in_([ids["org_a"], ids["org_b"]])).delete(synchronize_session=False)
        s.commit()


@pytest.fixture()
def application(pg, monkeypatch):
    monkeypatch.setattr(alertes, "organisation_a_la_fonctionnalite", lambda *a, **k: True)

    def override_db():
        db = Session(pg)
        try:
            yield db
        finally:
            db.close()

    app = FastAPI()
    app.include_router(alertes.router, prefix="/alertes")
    app.dependency_overrides[get_db] = override_db
    return app


def lire(application, utilisateur_id):
    with TestClient(application) as client:
        return client.get("/alertes/", headers={"Authorization": f"Bearer {create_access_token(utilisateur_id)}"})


def en_parallele(n, fonction):
    """Lance `n` appels en même temps (barrière) et retourne leurs résultats ; une exception est remontée telle quelle."""
    barriere = threading.Barrier(n)
    resultats, erreurs = [None] * n, []

    def travail(i):
        try:
            barriere.wait(timeout=30)
            resultats[i] = fonction(i)
        except BaseException as e:  # noqa: BLE001
            erreurs.append(e)

    fils = [threading.Thread(target=travail, args=(i,)) for i in range(n)]
    for f in fils:
        f.start()
    for f in fils:
        f.join(timeout=120)
    assert not erreurs, erreurs
    return resultats


def ouverts(pg, agence_ids):
    with Session(pg) as s:
        return s.query(AlerteEpisode).filter(AlerteEpisode.agence_id.in_(agence_ids), AlerteEpisode.statut != "terminee").all()


def tous(pg, agence_ids):
    with Session(pg) as s:
        return s.query(AlerteEpisode).filter(AlerteEpisode.agence_id.in_(agence_ids)).all()


# ── Migration ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

def test_la_tete_alembic_est_unique_et_c_est_la_034():
    scripts = ScriptDirectory.from_config(Config(str(API_DIR / "alembic.ini")))
    assert scripts.get_heads() == [REV]
    assert scripts.get_revision(REV).down_revision == REV_PRECEDENTE


def test_table_colonnes_types_et_cles(pg):
    insp = sa.inspect(pg)
    colonnes = {c["name"]: c for c in insp.get_columns("alerte_episodes")}
    assert list(colonnes) == ["id", "organisation_id", "agence_id", "type", "statut", "debut_condition", "debut_approximatif", "debut_remontee_limitee",
                              "detecte_le", "taux_ouverture", "seuil_ouverture", "gravite_ouverture", "pris_en_charge_le", "pris_en_charge_par_id",
                              "pris_en_charge_par_nom", "commentaire_prise_en_charge", "fin_condition", "terminee_le", "fin_cause", "taux_fermeture",
                              "seuil_fermeture", "created_at", "updated_at"]
    assert {n for n, c in colonnes.items() if not c["nullable"]} == {"id", "organisation_id", "agence_id", "type", "statut", "debut_condition",
        "debut_approximatif", "debut_remontee_limitee", "detecte_le", "taux_ouverture", "seuil_ouverture", "created_at", "updated_at"}
    for nom in ("debut_condition", "detecte_le", "pris_en_charge_le", "fin_condition", "terminee_le", "created_at", "updated_at"):
        assert colonnes[nom]["type"].timezone is True, f"{nom} doit être un timestamptz (UTC)"
    cles = {(fk["constrained_columns"][0], fk["referred_table"], fk["options"].get("ondelete")) for fk in insp.get_foreign_keys("alerte_episodes")}
    assert cles == {("organisation_id", "organisations", "CASCADE"), ("agence_id", "agences", "CASCADE"), ("pris_en_charge_par_id", "utilisateurs", "SET NULL")}


def test_index_dont_l_unique_partiel(pg):
    with pg.connect() as c:
        defs = dict(c.execute(sa.text("SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'alerte_episodes'")).all())
    assert set(defs) == {"alerte_episodes_pkey", "uq_alerte_episode_ouvert", "ix_alerte_episodes_agence_debut", "ix_alerte_episodes_organisation_debut"}
    unique = defs["uq_alerte_episode_ouvert"]
    assert "UNIQUE" in unique and "(agence_id, type)" in unique and "WHERE" in unique and "terminee" in unique
    assert "debut_condition DESC" in defs["ix_alerte_episodes_agence_debut"] and "debut_condition DESC" in defs["ix_alerte_episodes_organisation_debut"]


def test_parite_modele_et_migration(pg):
    insp = sa.inspect(pg)
    base = {c["name"]: c for c in insp.get_columns("alerte_episodes")}
    modele = {c.name: c for c in AlerteEpisode.__table__.columns}
    assert set(base) == set(modele)
    for nom, colonne in modele.items():
        assert base[nom]["nullable"] == colonne.nullable, nom
        longueur = getattr(colonne.type, "length", None)
        if longueur:
            assert base[nom]["type"].length == longueur, nom
    with pg.connect() as c:
        controles = set(c.execute(sa.text("SELECT conname FROM pg_constraint WHERE conrelid = 'alerte_episodes'::regclass AND contype = 'c'")).scalars().all())
        index = set(c.execute(sa.text("SELECT indexname FROM pg_indexes WHERE tablename = 'alerte_episodes'")).scalars().all())
    assert controles == {c.name for c in AlerteEpisode.__table__.constraints if c.__class__.__name__ == "CheckConstraint"}
    assert index - {"alerte_episodes_pkey"} == {i.name for i in AlerteEpisode.__table__.indexes}


def _nouvel_episode(donnees, i=0, **extra):
    maintenant = datetime.now(UTC)
    valeurs = dict(id=uuid.uuid4(), organisation_id=donnees["org_a"], agence_id=donnees["agences_a"][i], debut_condition=maintenant - timedelta(hours=2),
                   taux_ouverture=40.0, seuil_ouverture=70.0)
    valeurs.update(extra)
    return AlerteEpisode(**valeurs)


def test_index_unique_partiel_refuse_deux_episodes_ouverts_et_accepte_les_termines(pg, donnees):
    fin = datetime.now(UTC)
    with Session(pg) as s:
        s.add(_nouvel_episode(donnees)); s.commit()
    with pytest.raises(sa.exc.IntegrityError):
        with Session(pg) as s:
            s.add(_nouvel_episode(donnees, statut="prise_en_charge", pris_en_charge_le=fin, pris_en_charge_par_nom="X")); s.commit()
    with Session(pg) as s:
        for _ in range(3):
            s.add(_nouvel_episode(donnees, statut="terminee", fin_condition=fin, terminee_le=fin, fin_cause="retablie"))
        s.commit()
    assert len(tous(pg, [donnees["agences_a"][0]])) == 4 and len(ouverts(pg, [donnees["agences_a"][0]])) == 1


@pytest.mark.parametrize("extra", [
    dict(statut="terminee"),                                                                       # terminé sans fin ni cause
    dict(statut="detectee", fin_cause="retablie"),                                                 # cause de fin sans être terminé
    dict(statut="detectee", pris_en_charge_le=datetime.now(UTC)),                                  # détecté mais déjà pris en charge
    dict(statut="prise_en_charge"),                                                                # pris en charge sans date
    dict(statut="inconnu"),
    dict(type="autre_type"),
    dict(statut="terminee", fin_cause="inventee", fin_condition=datetime.now(UTC), terminee_le=datetime.now(UTC)),
    dict(statut="terminee", fin_cause="retablie", terminee_le=datetime.now(UTC), fin_condition=datetime.now(UTC) - timedelta(days=9)),   # fin avant le début
])
def test_les_contraintes_refusent_les_etats_impossibles(pg, donnees, extra):
    with pytest.raises(sa.exc.IntegrityError):
        with Session(pg) as s:
            s.add(_nouvel_episode(donnees, **extra)); s.commit()


def test_supprimer_une_agence_supprime_ses_episodes(pg, donnees):
    with Session(pg) as s:
        s.add(_nouvel_episode(donnees, 1)); s.commit()
    with Session(pg) as s:
        s.query(Agence).filter(Agence.id == donnees["agences_a"][1]).delete(synchronize_session=False); s.commit()
    assert tous(pg, [donnees["agences_a"][1]]) == []


def _schema_hors_episodes(pg):
    with pg.connect() as c:
        colonnes = c.execute(sa.text(
            "SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name <> 'alerte_episodes' ORDER BY 1, 2")).all()
        index = c.execute(sa.text("SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename <> 'alerte_episodes' ORDER BY 1, 2")).all()
        contraintes = c.execute(sa.text(
            "SELECT conrelid::regclass::text, conname FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND conrelid <> 'alerte_episodes'::regclass "
            "ORDER BY 1, 2")).all() if _existe(c) else None
    return colonnes, index, contraintes


def _existe(c):
    return c.execute(sa.text("SELECT to_regclass('public.alerte_episodes')")).scalar() is not None


def test_upgrade_downgrade_re_upgrade_avec_donnees_et_aucune_autre_table_touchee(pg, donnees):
    def comptes():
        with pg.connect() as c:
            return tuple(c.execute(sa.text(f"SELECT count(*) FROM {t}")).scalar() for t in ("organisations", "agences", "feedbacks", "utilisateurs", "journal_audit"))

    with Session(pg) as s:
        s.add(_nouvel_episode(donnees)); s.commit()
    avant_comptes = comptes()

    r = alembic("downgrade", REV_PRECEDENTE)                               # ── retour arrière, avec des données présentes
    assert r.returncode == 0, r.stdout + r.stderr
    with pg.connect() as c:
        assert not _existe(c), "la table doit avoir disparu"
    assert comptes() == (avant_comptes[0], avant_comptes[1], avant_comptes[2], avant_comptes[3], avant_comptes[4]), "aucune donnée existante ne doit bouger"
    schema_033 = _schema_hors_episodes(pg)

    r = alembic("upgrade", "head")                                         # ── re-upgrade
    assert r.returncode == 0, r.stdout + r.stderr
    with pg.connect() as c:
        assert _existe(c)
        assert c.execute(sa.text("SELECT count(*) FROM alerte_episodes")).scalar() == 0, "la table naît VIDE : aucun passé fabriqué"
    assert comptes() == avant_comptes
    assert _schema_hors_episodes(pg)[:2] == schema_033[:2], "la migration est additive : colonnes et index des autres tables inchangés"
    with Session(pg) as s:                                                  # ré-utilisable après le cycle complet
        s.add(_nouvel_episode(donnees, 2)); s.commit()
    assert len(ouverts(pg, [donnees["agences_a"][2]])) == 1

    r = alembic("upgrade", "head")                                         # rejouer la tête est sans effet
    assert r.returncode == 0, r.stdout + r.stderr


def test_la_migration_est_rejouable_sans_erreur_if_not_exists(pg, donnees):
    """Exécute DEUX FOIS le SQL de `upgrade()` sur la base déjà migrée : IF NOT EXISTS, aucune erreur, aucune donnée perdue."""
    import importlib.util

    spec = importlib.util.spec_from_file_location("m034", API_DIR / "alembic" / "versions" / "034_alerte_episodes.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with Session(pg) as s:
        s.add(_nouvel_episode(donnees)); s.commit()
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    with pg.begin() as c:
        with Operations.context(MigrationContext.configure(c)):
            module.upgrade()
            module.upgrade()
    assert len(ouverts(pg, [donnees["agences_a"][0]])) == 1


# ── Concurrence réelle ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

def test_lectures_simultanees_un_seul_episode_actif_par_agence_sans_erreur(pg, donnees, application, caplog):
    """12 lectures simultanées (CX Manager et Agency Manager) de GET /alertes/ ; 5 agences en dépassement = 5 courses indépendantes."""
    acteurs = [donnees["users"]["cx_a"] if i % 2 == 0 else donnees["users"]["am_a0"] for i in range(NB_LECTURES)]
    with caplog.at_level(logging.ERROR, logger="ikan.alertes_episodes"):
        reponses = en_parallele(NB_LECTURES, lambda i: lire(application, acteurs[i]))
    assert [r.status_code for r in reponses] == [200] * NB_LECTURES
    assert "impossible" not in caplog.text, f"une réconciliation a échoué : {caplog.text}"        # aucune erreur absorbée en silence
    assert len({str(r.json()["alertes_seuil"]) for i, r in enumerate(reponses) if acteurs[i] == donnees["users"]["cx_a"]}) == 1      # même réponse pour tous les CX
    for agence_id in donnees["agences_a"]:
        assert len(ouverts(pg, [agence_id])) == 1, "exactement UN épisode actif par agence"
        assert len(tous(pg, [agence_id])) == 1
    assert ouverts(pg, [donnees["agence_b"]]) == [], "l'organisation B n'a pas été lue : aucun de ses épisodes n'existe"
    with Session(pg) as s:
        lignes = s.query(JournalAudit).filter(JournalAudit.action == journal.ALERTE_EPISODE_OUVERT, JournalAudit.organisation_id == donnees["org_a"]).all()
    assert len(lignes) == NB_AGENCES, "une seule ligne de journal par épisode (les perdants de la course n'écrivent rien)"


def test_reconciliations_directes_simultanees_aucune_ne_retourne_d_erreur(pg, donnees):
    """Appels directs (sans HTTP) : chaque appel retourne un résultat (jamais None = erreur) et le total des ouvertures est exactement le nombre d'agences."""
    with Session(pg) as s:
        cx = s.get(Utilisateur, donnees["users"]["cx_a"])
        s.expunge(cx)
    resultats = en_parallele(NB_LECTURES, lambda i: ep.reconcilier_episodes(Session(pg), cx))
    assert all(r is not None for r in resultats), "une réconciliation a échoué (None)"
    assert sum(r.ouverts for r in resultats) == NB_AGENCES and sum(r.termines for r in resultats) == 0
    assert all(len(ouverts(pg, [a])) == 1 for a in donnees["agences_a"])


def test_fins_simultanees_un_seul_evenement_de_fin_par_episode(pg, donnees, application, caplog):
    reponse = lire(application, donnees["users"]["cx_a"])
    assert reponse.status_code == 200 and len(ouverts(pg, donnees["agences_a"])) == NB_AGENCES
    with Session(pg) as s:                                              # les données remontent : 12 bons avis récents par agence
        for qr_id in donnees["qr_a"]:
            for i in range(12):
                s.add(Feedback(id=uuid.uuid4(), qr_code_id=qr_id, note=5, statut_traitement="nouveau", date_soumission=datetime.now(UTC) - timedelta(hours=1 + i / 100)))
        s.commit()
    with caplog.at_level(logging.ERROR, logger="ikan.alertes_episodes"):
        reponses = en_parallele(NB_LECTURES, lambda i: lire(application, donnees["users"]["cx_a"]))
    assert [r.status_code for r in reponses] == [200] * NB_LECTURES and "impossible" not in caplog.text
    assert ouverts(pg, donnees["agences_a"]) == []
    for e in tous(pg, donnees["agences_a"]):
        assert e.statut == "terminee" and e.fin_cause == "retablie" and e.terminee_le.tzinfo is not None
    with Session(pg) as s:
        fins = s.query(JournalAudit).filter(JournalAudit.action == journal.ALERTE_EPISODE_TERMINE, JournalAudit.organisation_id == donnees["org_a"]).all()
    assert len(fins) == NB_AGENCES


def test_regime_stable_aucune_ecriture_sur_postgres(pg, donnees, application):
    lire(application, donnees["users"]["cx_a"])
    ecritures = []

    @sa.event.listens_for(pg, "before_cursor_execute")
    def compter(conn, cursor, statement, parameters, context, executemany):
        if statement.lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE")):
            ecritures.append(statement[:60])

    for _ in range(3):
        assert lire(application, donnees["users"]["cx_a"]).status_code == 200
    assert ecritures == []


def test_les_dates_lues_depuis_postgres_ont_un_fuseau(pg, donnees, application):
    lire(application, donnees["users"]["am_a0"])
    (e,) = ouverts(pg, [donnees["agences_a"][0]])
    for nom in ("debut_condition", "detecte_le", "created_at", "updated_at"):
        assert getattr(e, nom).tzinfo is not None and getattr(e, nom).utcoffset() == timedelta(0), nom
    assert e.debut_condition < e.detecte_le and e.debut_approximatif is True
