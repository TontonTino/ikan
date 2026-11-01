"""
Migration 033 (journal d'audit) sur une base PostgreSQL JETABLE (TEST_DATABASE_URL, jamais celle de .env, jamais ikanai-prod ni
ikanai-dev) : table, colonnes, index, absence de clés étrangères, contrainte CHECK, VRAI déclencheur d'ajout seul (UPDATE, DELETE,
TRUNCATE refusés), idempotence, retour arrière, parité modèle / migration, tête Alembic unique. Se skippe sans TEST_DATABASE_URL.
"""
import os
import subprocess
import sys
import uuid
from pathlib import Path

import pytest

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-journal-audit-pg-0123456789")

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "")
if not TEST_DATABASE_URL:
    pytest.skip("TEST_DATABASE_URL non défini : base Postgres jetable requise (jamais la base de .env).", allow_module_level=True)

import sqlalchemy as sa
from alembic.config import Config
from alembic.script import ScriptDirectory

from app.core.garde_production import est_base_de_production

API_DIR = Path(__file__).resolve().parents[1]
FICHIER = API_DIR / "alembic" / "versions" / "033_journal_audit.py"
REV, REV_PRECEDENTE = "033_journal_audit", "032_demande_contact_traitement"

assert not est_base_de_production(TEST_DATABASE_URL), "TEST_DATABASE_URL vise la production : tests arrêtés"
assert "localhost" in TEST_DATABASE_URL or "127.0.0.1" in TEST_DATABASE_URL, "TEST_DATABASE_URL doit être une base LOCALE jetable"


def alembic(*args):
    env = {**os.environ, "DATABASE_URL": TEST_DATABASE_URL, "SECRET_KEY": os.environ["SECRET_KEY"]}
    return subprocess.run([sys.executable, "-m", "alembic", *args], cwd=str(API_DIR), env=env, capture_output=True, text=True, timeout=300)


@pytest.fixture()
def pg():
    r = alembic("upgrade", "head")
    assert r.returncode == 0, r.stdout + r.stderr
    moteur = sa.create_engine(TEST_DATABASE_URL)
    yield moteur
    moteur.dispose()
    alembic("upgrade", "head")                          # laisse la base à la tête, quoi qu'ait fait le test


def ligne_sql(action="compte.cree", resultat="succes"):
    return sa.text("INSERT INTO journal_audit (id, acteur_role, action, resultat, details) VALUES (:i, 'admin', :a, :r, CAST(:d AS jsonb))"), \
        {"i": uuid.uuid4(), "a": action, "r": resultat, "d": '{"champs": ["role"]}'}


def test_la_tete_alembic_est_unique_et_c_est_la_033():
    scripts = ScriptDirectory.from_config(Config(str(API_DIR / "alembic.ini")))
    assert scripts.get_heads() == [REV]
    assert scripts.get_revision(REV).down_revision == REV_PRECEDENTE


def test_table_colonnes_index_et_aucune_cle_etrangere(pg):
    insp = sa.inspect(pg)
    colonnes = {c["name"]: c for c in insp.get_columns("journal_audit")}
    assert list(colonnes) == ["id", "date_action", "acteur_id", "acteur_role", "acteur_email", "action", "cible_type", "cible_id",
                              "cible_libelle", "organisation_id", "resultat", "details", "adresse_ip"]
    assert {n for n, c in colonnes.items() if not c["nullable"]} == {"id", "date_action", "acteur_role", "action", "resultat"}
    assert insp.get_foreign_keys("journal_audit") == []
    assert {i["name"] for i in insp.get_indexes("journal_audit")} == {"ix_journal_audit_date_action", "ix_journal_audit_acteur", "ix_journal_audit_action", "ix_journal_audit_organisation"}
    assert str(colonnes["details"]["type"]).upper() == "JSONB"
    assert str(colonnes["date_action"]["type"]).upper().startswith("TIMESTAMP") and colonnes["date_action"]["type"].timezone is True


def test_parite_modele_et_migration(pg):
    from app.models.journal_audit import JournalAudit

    insp = sa.inspect(pg)
    base = {c["name"]: c for c in insp.get_columns("journal_audit")}
    modele = {c.name: c for c in JournalAudit.__table__.columns}
    assert set(base) == set(modele)
    for nom, colonne in modele.items():
        assert base[nom]["nullable"] == colonne.nullable, nom
        assert type(base[nom]["type"]).__name__.upper().split("(")[0] in {"UUID", "TIMESTAMP", "VARCHAR", "JSONB"}, nom
        longueur = getattr(colonne.type, "length", None)
        if longueur:
            assert base[nom]["type"].length == longueur, nom
    assert {i.name for i in JournalAudit.__table__.indexes} == {i["name"] for i in insp.get_indexes("journal_audit")}
    with pg.connect() as c:
        controles = c.execute(sa.text("SELECT conname FROM pg_constraint WHERE conrelid = 'journal_audit'::regclass AND contype = 'c'")).scalars().all()
    assert controles == ["ck_journal_audit_resultat"]


def test_la_contrainte_de_resultat_refuse_toute_autre_valeur(pg):
    with pytest.raises(sa.exc.IntegrityError):
        with pg.begin() as c:
            c.execute(*ligne_sql(resultat="peut-etre"))


def test_insertion_et_lecture_avec_le_modele(pg):
    from sqlalchemy.orm import Session

    from app.models.journal_audit import JournalAudit
    from app.models.utilisateur import Utilisateur
    from app.services import journal_audit as journal

    class Acteur:
        id, email = uuid.uuid4(), "admin@test.io"
        role = type("R", (), {"value": "admin"})()

    with Session(pg) as s:
        journal.journaliser(s, action=journal.COMPTE_CREE, acteur=Acteur(), cible_type="utilisateur", cible_id="x", details={"champs": ["role"], "password": "SECRET"})
        s.commit()
        ligne = s.query(JournalAudit).filter(JournalAudit.cible_id == "x").one()
        assert ligne.details == {"champs": ["role"]} and ligne.resultat == "succes" and ligne.date_action.tzinfo is not None


def test_le_vrai_declencheur_refuse_update_delete_et_truncate(pg):
    with pg.begin() as c:
        c.execute(*ligne_sql("declencheur.essai"))
    for instruction in ("UPDATE journal_audit SET action = 'x' WHERE action = 'declencheur.essai'", "DELETE FROM journal_audit WHERE action = 'declencheur.essai'",
                        "TRUNCATE journal_audit"):
        with pytest.raises(sa.exc.DBAPIError) as erreur:
            with pg.begin() as c:
                c.execute(sa.text(instruction))
        assert "journal_audit est en ajout seul" in str(erreur.value.orig), instruction
        assert getattr(erreur.value.orig, "sqlstate", None) in (None, "42501")
    with pg.connect() as c:
        assert c.execute(sa.text("SELECT count(*) FROM journal_audit WHERE action = 'declencheur.essai'")).scalar() == 1      # la ligne n'a pas bougé
        assert c.execute(sa.text("SELECT action FROM journal_audit WHERE action = 'declencheur.essai'")).scalar() == "declencheur.essai"


def test_le_declencheur_refuse_aussi_une_suppression_en_masse_et_un_update_sans_filtre(pg):
    with pg.begin() as c:
        c.execute(*ligne_sql("declencheur.masse"))
    for instruction in ("DELETE FROM journal_audit", "UPDATE journal_audit SET acteur_role = 'x'"):
        with pytest.raises(sa.exc.DBAPIError):
            with pg.begin() as c:
                c.execute(sa.text(instruction))


def test_triggers_presents_et_limites_a_cette_table(pg):
    with pg.connect() as c:
        triggers = c.execute(sa.text("SELECT tgname, tgrelid::regclass::text FROM pg_trigger WHERE tgname LIKE 'trg_journal_audit%' AND NOT tgisinternal ORDER BY 1")).all()
    assert triggers == [("trg_journal_audit_append_only", "journal_audit"), ("trg_journal_audit_no_truncate", "journal_audit")]


def test_idempotence_rejouer_la_migration_ne_change_rien_et_ne_casse_pas_le_declencheur(pg):
    import importlib.util

    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    spec = importlib.util.spec_from_file_location("migration_033", FICHIER)
    migration = importlib.util.module_from_spec(spec); spec.loader.exec_module(migration)
    with pg.begin() as c:
        c.execute(*ligne_sql("idempotence.essai"))
    with pg.begin() as connexion:                                         # upgrade() exécutée DEUX FOIS de suite, sans erreur
        with Operations.context(MigrationContext.configure(connexion)):
            migration.upgrade()
            migration.upgrade()
    with pg.connect() as c:
        assert c.execute(sa.text("SELECT count(*) FROM journal_audit WHERE action = 'idempotence.essai'")).scalar() == 1      # aucune donnée perdue
        assert c.execute(sa.text("SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg_journal_audit%' AND NOT tgisinternal")).scalar() == 2
    with pytest.raises(sa.exc.DBAPIError):
        with pg.begin() as c:
            c.execute(sa.text("DELETE FROM journal_audit"))
    r = alembic("upgrade", "head")                                        # et la commande elle-même est rejouable
    assert r.returncode == 0, r.stdout + r.stderr


def test_depuis_la_version_032_la_migration_n_ajoute_que_cette_table(pg):
    r = alembic("downgrade", REV_PRECEDENTE)
    assert r.returncode == 0, r.stdout + r.stderr
    with pg.connect() as c:
        assert c.execute(sa.text("SELECT version_num FROM alembic_version")).scalar() == REV_PRECEDENTE
        assert c.execute(sa.text("SELECT to_regclass('journal_audit')")).scalar() is None
        avant = c.execute(sa.text("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() ORDER BY 1")).scalars().all()
        colonnes_avant = c.execute(sa.text("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema() ORDER BY 1, 2")).all()
    r = alembic("upgrade", "head")
    assert r.returncode == 0, r.stdout + r.stderr
    with pg.connect() as c:
        apres = c.execute(sa.text("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() ORDER BY 1")).scalars().all()
        colonnes_apres = c.execute(sa.text("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema() ORDER BY 1, 2")).all()
        assert c.execute(sa.text("SELECT version_num FROM alembic_version")).scalar() == REV
    assert sorted(set(apres) - set(avant)) == ["journal_audit"]                                 # une seule table nouvelle
    assert [x for x in colonnes_apres if x[0] != "journal_audit"] == colonnes_avant              # aucune autre table modifiée


def test_la_migration_pose_le_delai_de_verrou_de_5_secondes():
    code = FICHIER.read_text(encoding="utf8").split("def upgrade", 1)[1]
    assert code.count("op.execute(\"SET LOCAL lock_timeout = '5s'\")") == 2                      # upgrade et downgrade
    assert "CREATE TABLE IF NOT EXISTS" in code and "IF NOT EXISTS (SELECT 1 FROM pg_trigger" in code and "CREATE OR REPLACE FUNCTION" in code
    avant_downgrade = code.split("def downgrade")[0]
    for interdit in ("REFERENCES", "FOREIGN KEY", "ON DELETE", "ALTER TABLE"):
        assert interdit not in avant_downgrade, interdit                                            # table nouvelle seulement, aucune clé étrangère


def test_le_declencheur_n_empeche_pas_le_retour_arriere_volontaire(pg):
    with pg.begin() as c:
        c.execute(*ligne_sql("retour.arriere"))
    r = alembic("downgrade", REV_PRECEDENTE)
    assert r.returncode == 0, r.stdout + r.stderr                       # DROP TABLE n'est pas bloqué par les déclencheurs de lignes
    r = alembic("upgrade", "head")
    assert r.returncode == 0, r.stdout + r.stderr
