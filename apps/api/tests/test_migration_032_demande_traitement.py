"""
Migration 032 (date et auteur du traitement d'une demande de rappel) sur une base Postgres JETABLE (TEST_DATABASE_URL, jamais celle
de .env) : colonnes, clé étrangère ON DELETE SET NULL, upgrade / downgrade / upgrade, idempotence, ligne traitée antérieure inchangée,
suppression de l'auteur => NULL, tête Alembic unique, et comportement de `SET LOCAL lock_timeout` (échec rapide si la table est
verrouillée, sans effet durable sur la session). Se skippe sans TEST_DATABASE_URL.
"""
import importlib.util
import os
import subprocess
import sys
import time
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-migration-032-0123456789")

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "")
if not TEST_DATABASE_URL:
    pytest.skip("TEST_DATABASE_URL non défini : base Postgres jetable requise (jamais la base de .env).", allow_module_level=True)

import sqlalchemy as sa
from alembic.config import Config
from alembic.script import ScriptDirectory

API_DIR = Path(__file__).resolve().parents[1]
FICHIER_032 = API_DIR / "alembic" / "versions" / "032_demande_contact_traitement.py"
REV_032, REV_031 = "032_demande_contact_traitement", "031_suggestion_sans_feedback"


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
        c.execute(sa.text("DELETE FROM utilisateurs WHERE nom LIKE 'MIG032-%'"))
        c.execute(sa.text("DELETE FROM agences WHERE nom LIKE 'MIG032-%'"))
        c.execute(sa.text("DELETE FROM organisations WHERE nom LIKE 'MIG032-%'"))
    engine.dispose()
    alembic("upgrade", "head")


def _demande(conn, traitee=False):
    """Organisation -> agence -> QR -> avis -> demande (+ un utilisateur). Retourne (demande, utilisateur)."""
    org, ag, qr, fb, dc, us = (uuid.uuid4() for _ in range(6))
    conn.execute(sa.text("INSERT INTO organisations (id, nom, secteur_activite, active, email_pro) VALUES (:i, :n, 'x', true, 'mig032@test.io')"),
                 {"i": org, "n": f"MIG032-{org.hex[:6]}"})
    conn.execute(sa.text("INSERT INTO agences (id, organisation_id, nom, active, seuil_alerte) VALUES (:i, :o, :n, true, 70)"),
                 {"i": ag, "o": org, "n": f"MIG032-{ag.hex[:6]}"})
    conn.execute(sa.text("INSERT INTO qr_codes (id, agence_id, code, url, actif) VALUES (:i, :a, :c, 'http://t', true)"),
                 {"i": qr, "a": ag, "c": f"MIG032-{qr.hex[:8]}"})
    conn.execute(sa.text("INSERT INTO feedbacks (id, qr_code_id, note, statut_traitement) VALUES (:i, :q, 3, 'nouveau')"), {"i": fb, "q": qr})
    conn.execute(sa.text("INSERT INTO demandes_contact (id, feedback_id, nom, telephone, souhaite_etre_rappele, traitee) "
                         "VALUES (:i, :f, 'Client', '0600000000', true, :t)"), {"i": dc, "f": fb, "t": traitee})
    conn.execute(sa.text("INSERT INTO utilisateurs (id, organisation_id, nom, prenom, email, mot_de_passe_hash, role, active) "
                         "VALUES (:i, :o, :n, 'P', :e, 'x', 'CX_MANAGER', true)"),
                 {"i": us, "o": org, "n": f"MIG032-{us.hex[:6]}", "e": f"{us.hex[:8]}@mig032.io"})
    return dc, us


def test_la_tete_alembic_est_unique_et_c_est_la_032():
    scripts = ScriptDirectory.from_config(Config(str(API_DIR / "alembic.ini")))
    assert scripts.get_heads() == [REV_032]
    assert scripts.get_revision(REV_032).down_revision == REV_031


def test_schema_apres_la_migration(pg):
    colonnes = {c["name"]: c for c in sa.inspect(pg).get_columns("demandes_contact")}
    for nom in ("date_traitement", "traitee_par_id"):
        assert colonnes[nom]["nullable"] is True and colonnes[nom]["default"] is None, nom
    assert str(colonnes["date_traitement"]["type"]).startswith("TIMESTAMP") and colonnes["date_traitement"]["type"].timezone is True
    assert str(colonnes["traitee_par_id"]["type"]) == "UUID"
    with pg.connect() as c:
        definition = c.execute(sa.text("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'fk_demandes_contact_traitee_par_id'")).scalar()
    assert "FOREIGN KEY (traitee_par_id) REFERENCES utilisateurs(id) ON DELETE SET NULL" in definition


def test_une_demande_traitee_avant_la_migration_est_inchangee(pg):
    r = alembic("downgrade", "-1")
    assert r.returncode == 0, r.stdout + r.stderr
    with pg.begin() as c:
        dc, _ = _demande(c, traitee=True)
    r = alembic("upgrade", "head")
    assert r.returncode == 0, r.stdout + r.stderr
    with pg.connect() as c:
        ligne = c.execute(sa.text("SELECT traitee, date_traitement, traitee_par_id, telephone FROM demandes_contact WHERE id = :i"), {"i": dc}).one()
    assert tuple(ligne) == (True, None, None, "0600000000")        # aucun remplissage, rien d'altéré


def test_downgrade_puis_upgrade(pg):
    r = alembic("downgrade", "-1")
    assert r.returncode == 0, r.stdout + r.stderr
    assert not {"date_traitement", "traitee_par_id"} & {c["name"] for c in sa.inspect(pg).get_columns("demandes_contact")}
    with pg.connect() as c:
        assert c.execute(sa.text("SELECT version_num FROM alembic_version")).scalar() == REV_031
        assert c.execute(sa.text("SELECT count(*) FROM pg_constraint WHERE conname = 'fk_demandes_contact_traitee_par_id'")).scalar() == 0
    r = alembic("upgrade", "head")
    assert r.returncode == 0, r.stdout + r.stderr
    assert {"date_traitement", "traitee_par_id"} <= {c["name"] for c in sa.inspect(pg).get_columns("demandes_contact")}


def test_la_migration_s_execute_deux_fois_sans_erreur(pg):
    spec = importlib.util.spec_from_file_location("migration_032", FICHIER_032)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with pg.begin() as conn:
        module.op = SimpleNamespace(execute=lambda sql: conn.exec_driver_sql(str(sql)), get_bind=lambda: conn)
        module.upgrade()   # déjà appliquée par alembic : une 2e et une 3e exécution ne doivent rien casser
        module.upgrade()
    with pg.connect() as c:
        assert c.execute(sa.text("SELECT count(*) FROM pg_constraint WHERE conname = 'fk_demandes_contact_traitee_par_id'")).scalar() == 1


def test_supprimer_l_auteur_du_traitement_met_la_colonne_a_null_sans_supprimer_la_demande(pg):
    with pg.begin() as c:
        dc, us = _demande(c, traitee=True)
        c.execute(sa.text("UPDATE demandes_contact SET date_traitement = now(), traitee_par_id = :u WHERE id = :d"), {"u": us, "d": dc})
    with pg.begin() as c:
        c.execute(sa.text("DELETE FROM utilisateurs WHERE id = :u"), {"u": us})
    with pg.connect() as c:
        ligne = c.execute(sa.text("SELECT traitee, traitee_par_id, date_traitement IS NOT NULL FROM demandes_contact WHERE id = :i"), {"i": dc}).one()
    assert tuple(ligne) == (True, None, True)


def test_lock_timeout_fait_echouer_vite_la_migration_si_la_table_est_verrouillee(pg):
    """Même mécanisme à l'upgrade (ici via le downgrade, qui pose aussi le délai) : un verrou tenu par une autre session ne met
    pas le trafic en file d'attente derrière la migration, elle échoue au bout de ~5 s et ne change rien."""
    bloqueur = pg.connect()
    transaction = bloqueur.begin()
    try:
        bloqueur.execute(sa.text("LOCK TABLE demandes_contact IN ACCESS EXCLUSIVE MODE"))
        debut = time.monotonic()
        r = alembic("downgrade", "-1")
        duree = time.monotonic() - debut
        assert r.returncode != 0 and "lock timeout" in (r.stdout + r.stderr).lower()
        assert 4 <= duree < 40, f"échec attendu après ~5 s, obtenu après {duree:.1f} s"
    finally:
        transaction.rollback()
        bloqueur.close()
    with pg.connect() as c:                                   # rien n'a changé : toujours en 032, colonnes présentes
        assert c.execute(sa.text("SELECT version_num FROM alembic_version")).scalar() == REV_032
    assert {"date_traitement", "traitee_par_id"} <= {c["name"] for c in sa.inspect(pg).get_columns("demandes_contact")}
    r = alembic("downgrade", "-1")                           # une fois le verrou levé, la migration passe
    assert r.returncode == 0, r.stdout + r.stderr


def test_lock_timeout_fait_echouer_vite_l_upgrade_si_la_table_est_verrouillee(pg):
    """Le cas du déploiement : la table `demandes_contact` est verrouillée par une session longue au moment de `upgrade head`."""
    r = alembic("downgrade", "-1")
    assert r.returncode == 0, r.stdout + r.stderr
    bloqueur = pg.connect()
    transaction = bloqueur.begin()
    try:
        bloqueur.execute(sa.text("LOCK TABLE demandes_contact IN ACCESS EXCLUSIVE MODE"))
        debut = time.monotonic()
        r = alembic("upgrade", "head")
        duree = time.monotonic() - debut
        assert r.returncode != 0 and "lock timeout" in (r.stdout + r.stderr).lower()
        assert 4 <= duree < 40, f"échec attendu après ~5 s, obtenu après {duree:.1f} s"
    finally:
        transaction.rollback()
        bloqueur.close()
    with pg.connect() as c:                                   # échec propre : toujours en 031, aucune colonne ajoutée
        assert c.execute(sa.text("SELECT version_num FROM alembic_version")).scalar() == REV_031
    assert not {"date_traitement", "traitee_par_id"} & {c["name"] for c in sa.inspect(pg).get_columns("demandes_contact")}
    r = alembic("upgrade", "head")                           # verrou levé : la migration passe
    assert r.returncode == 0, r.stdout + r.stderr
    assert {"date_traitement", "traitee_par_id"} <= {c["name"] for c in sa.inspect(pg).get_columns("demandes_contact")}


def test_set_local_ne_laisse_aucun_delai_sur_la_session_apres_la_migration(pg):
    alembic("downgrade", "-1")
    r = alembic("upgrade", "head")
    assert r.returncode == 0, r.stdout + r.stderr
    with pg.connect() as c:
        assert c.execute(sa.text("SHOW lock_timeout")).scalar() in ("0", "0ms")
