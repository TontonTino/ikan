"""
Migration 031 (suggestions sans feedback) sur une base Postgres JETABLE (TEST_DATABASE_URL, jamais celle de .env) :
colonnes et contraintes, CHECK, cascade, idempotence (deux exécutions), et REFUS explicite du downgrade s'il existe
des suggestions sans feedback. Se skippe sans TEST_DATABASE_URL.
"""
import importlib.util
import os
import subprocess
import sys
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-migration-031-0123456789")

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "")
if not TEST_DATABASE_URL:
    pytest.skip("TEST_DATABASE_URL non défini : base Postgres jetable requise (jamais la base de .env).",
                allow_module_level=True)

import sqlalchemy as sa

API_DIR = Path(__file__).resolve().parents[1]
FICHIER_031 = API_DIR / "alembic" / "versions" / "031_suggestion_sans_feedback.py"
# La 031 n'est plus la tête (032 la suit) : on descend explicitement jusqu'à sa révision parente, pas d'un cran.
REV_030 = "030_demande_contact_consentement"
REV_TETE = "032_demande_contact_traitement"


def alembic(*args):
    env = {**os.environ, "DATABASE_URL": TEST_DATABASE_URL, "SECRET_KEY": os.environ["SECRET_KEY"]}
    return subprocess.run([sys.executable, "-m", "alembic", *args], cwd=str(API_DIR), env=env,
                          capture_output=True, text=True, timeout=180)


@pytest.fixture()
def pg():
    r = alembic("upgrade", "head")
    assert r.returncode == 0, r.stdout + r.stderr
    engine = sa.create_engine(TEST_DATABASE_URL)
    yield engine
    with engine.begin() as c:
        c.execute(sa.text("DELETE FROM suggestions"))
        c.execute(sa.text("DELETE FROM agences WHERE nom LIKE 'MIG031-%'"))
        c.execute(sa.text("DELETE FROM organisations WHERE nom LIKE 'MIG031-%'"))
    engine.dispose()
    alembic("upgrade", "head")


def _agence(conn) -> uuid.UUID:
    org, ag = uuid.uuid4(), uuid.uuid4()
    conn.execute(sa.text("INSERT INTO organisations (id, nom, secteur_activite, active, email_pro) VALUES (:i, :n, 'x', true, 'mig031@test.io')"),
                 {"i": org, "n": f"MIG031-{org.hex[:6]}"})
    conn.execute(sa.text("INSERT INTO agences (id, organisation_id, nom, active, seuil_alerte) VALUES (:i, :o, :n, true, 70)"),
                 {"i": ag, "o": org, "n": f"MIG031-{ag.hex[:6]}"})
    return ag


def _suggestion_sans_feedback(conn, agence) -> uuid.UUID:
    sid = uuid.uuid4()
    conn.execute(sa.text("INSERT INTO suggestions (id, agence_id, contenu, statut) VALUES (:i, :a, 'idée', 'NOUVEAU')"),
                 {"i": sid, "a": agence})
    return sid


def test_schema_apres_la_migration(pg):
    insp = sa.inspect(pg)
    colonnes = {c["name"]: c for c in insp.get_columns("suggestions")}
    assert colonnes["feedback_id"]["nullable"] is True
    assert colonnes["agence_id"]["nullable"] is True
    assert any(i["column_names"] == ["agence_id"] for i in insp.get_indexes("suggestions"))
    with pg.connect() as c:
        regle = c.execute(sa.text("SELECT confdeltype FROM pg_constraint WHERE conname = 'fk_suggestions_agence_id'")).scalar()
        assert regle == "c"  # ON DELETE CASCADE
        assert c.execute(sa.text("SELECT 1 FROM pg_constraint WHERE conname = 'ck_suggestions_feedback_ou_agence'")).scalar() == 1


def test_check_refuse_une_suggestion_sans_feedback_ni_agence_et_la_cascade_supprime_celle_d_une_agence(pg):
    with pg.begin() as c:
        ag = _agence(c)
        _suggestion_sans_feedback(c, ag)
    with pytest.raises(sa.exc.IntegrityError):
        with pg.begin() as c:
            c.execute(sa.text("INSERT INTO suggestions (id, contenu, statut) VALUES (:i, 'orpheline', 'NOUVEAU')"), {"i": uuid.uuid4()})
    with pg.begin() as c:
        c.execute(sa.text("DELETE FROM agences WHERE id = :a"), {"a": ag})
        assert c.execute(sa.text("SELECT count(*) FROM suggestions")).scalar() == 0   # supprimée avec son agence


def test_le_downgrade_refuse_de_detruire_des_suggestions_sans_feedback(pg):
    with pg.begin() as c:
        sid = _suggestion_sans_feedback(c, _agence(c))
    r = alembic("downgrade", REV_030)
    assert r.returncode != 0
    assert "Downgrade 031 refusé" in (r.stdout + r.stderr) and "1 suggestion(s) sans feedback" in (r.stdout + r.stderr)
    # rien n'a changé (la descente est une seule transaction : le downgrade 032, exécuté avant, est annulé avec le refus) :
    # colonne et ligne toujours là, révision inchangée
    with pg.connect() as c:
        assert c.execute(sa.text("SELECT count(*) FROM suggestions WHERE id = :i"), {"i": sid}).scalar() == 1
        assert c.execute(sa.text("SELECT version_num FROM alembic_version")).scalar() == REV_TETE
    assert "agence_id" in {col["name"] for col in sa.inspect(pg).get_columns("suggestions")}
    assert "date_traitement" in {col["name"] for col in sa.inspect(pg).get_columns("demandes_contact")}


def test_downgrade_puis_upgrade_sans_suggestion_orpheline(pg):
    r = alembic("downgrade", REV_030)
    assert r.returncode == 0, r.stdout + r.stderr
    insp = sa.inspect(pg)
    colonnes = {c["name"]: c for c in insp.get_columns("suggestions")}
    assert "agence_id" not in colonnes and colonnes["feedback_id"]["nullable"] is False
    r = alembic("upgrade", "head")
    assert r.returncode == 0, r.stdout + r.stderr
    assert "agence_id" in {c["name"] for c in sa.inspect(pg).get_columns("suggestions")}


def test_la_migration_s_execute_deux_fois_sans_erreur(pg):
    spec = importlib.util.spec_from_file_location("migration_031", FICHIER_031)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with pg.begin() as conn:
        module.op = SimpleNamespace(execute=lambda sql: conn.exec_driver_sql(str(sql)), get_bind=lambda: conn)
        module.upgrade()   # déjà appliquée par alembic : une 2e et une 3e exécution ne doivent rien casser
        module.upgrade()
    assert "agence_id" in {c["name"] for c in sa.inspect(pg).get_columns("suggestions")}
