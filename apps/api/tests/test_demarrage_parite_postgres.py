"""
SD-03 — parité migrations / ancien démarrage, sur une base PostgreSQL JETABLE (TEST_DATABASE_URL, jamais celle de .env). Se skippe sans elle.

Avant, app/main.py rejouait à chaque démarrage 11 instructions sur `organisations` et 4 « filets » (plans, Stripe, événements Stripe,
alertes de quota). Ils sont strictement les mêmes que ceux des migrations 002 et 006 à 009. Ce test prouve :
 1. une base créée UNIQUEMENT par `alembic upgrade head` contient déjà tous les objets que le démarrage créait (liste figée ci-dessous) ;
 2. rejouer l'ancien démarrage sur cette base ne change RIEN (colonnes, types, nullité, défauts, index, contraintes, lignes de plans) ;
 3. rejouer `alembic upgrade head` est sans effet.
"""
import os
import subprocess
import sys
from pathlib import Path

import pytest

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-parity-tests-0123456789")

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "")
if not TEST_DATABASE_URL:
    pytest.skip("TEST_DATABASE_URL non défini : base Postgres jetable requise (jamais la base de .env).", allow_module_level=True)

import sqlalchemy as sa

from app.services.plan_bootstrap import appliquer_schema_plans
from app.services.quota_alert_bootstrap import appliquer_schema_alertes_quota
from app.services.stripe_billing_bootstrap import appliquer_schema_stripe, appliquer_schema_webhook_events

API_DIR = Path(__file__).resolve().parents[1]

# Instructions que app/main.py exécutait au démarrage sur `organisations` (liste figée telle qu'elle était avant cette PR).
ANCIEN_DEMARRAGE_ORGANISATIONS = [
    "ALTER TABLE organisations ADD COLUMN IF NOT EXISTS logo TEXT;",
    "ALTER TABLE organisations ADD COLUMN IF NOT EXISTS secteur_activite VARCHAR(100);",
    "ALTER TABLE organisations ADD COLUMN IF NOT EXISTS pays_region VARCHAR(100) DEFAULT 'Tunisie / Afrique du Nord';",
    "ALTER TABLE organisations ADD COLUMN IF NOT EXISTS email_pro VARCHAR(255);",
    "ALTER TABLE organisations ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();",
    "ALTER TABLE organisations ALTER COLUMN logo TYPE TEXT;",
    "ALTER TABLE organisations ALTER COLUMN secteur DROP NOT NULL;",
    "ALTER TABLE organisations ALTER COLUMN email DROP NOT NULL;",
    "UPDATE organisations SET secteur_activite = secteur WHERE secteur_activite IS NULL AND secteur IS NOT NULL;",
    "UPDATE organisations SET email_pro = email WHERE email_pro IS NULL AND email IS NOT NULL;",
    "UPDATE organisations SET created_at = date_creation WHERE created_at IS NULL AND date_creation IS NOT NULL;",
]
ANCIENS_FILETS = (appliquer_schema_plans, appliquer_schema_stripe, appliquer_schema_webhook_events, appliquer_schema_alertes_quota)

# Objets que le démarrage créait ou garantissait (liste figée) : colonnes, tables, index.
COLONNES = [("organisations", c) for c in ("logo", "secteur_activite", "pays_region", "email_pro", "created_at", "plan_id",
                                           "stripe_customer_id", "stripe_subscription_id", "stripe_subscription_status", "payment_failed_at")]
TABLES = ("plans", "plan_features", "changements_plan", "stripe_events_traites", "alertes_quota_envoyees")
INDEX = ("uq_organisations_stripe_customer_id", "uq_organisations_stripe_subscription_id", "ix_changements_plan_organisation_id",
         "ix_alertes_quota_organisation_id")


def alembic(*args):
    env = {**os.environ, "DATABASE_URL": TEST_DATABASE_URL, "SECRET_KEY": os.environ["SECRET_KEY"]}
    return subprocess.run([sys.executable, "-m", "alembic", *args], cwd=str(API_DIR), env=env, capture_output=True, text=True, timeout=300)


def instantane(conn):
    colonnes = conn.execute(sa.text("select table_name,column_name,data_type,is_nullable,coalesce(column_default,'') from information_schema.columns "
                                    "where table_schema=current_schema() order by 1,2")).fetchall()
    index = conn.execute(sa.text("select tablename,indexname,indexdef from pg_indexes where schemaname=current_schema() order by 1,2")).fetchall()
    contraintes = conn.execute(sa.text("select conrelid::regclass::text,conname,pg_get_constraintdef(oid) from pg_constraint "
                                       "where connamespace=current_schema()::regnamespace order by 1,2")).fetchall()
    plans = conn.execute(sa.text("select code,nom,ordre,max_cx_managers,max_agences,max_feedbacks_mois from plans order by 1")).fetchall()
    fonctions = conn.execute(sa.text("select p.code,f.feature_code from plan_features f join plans p on p.id=f.plan_id order by 1,2")).fetchall()
    return [tuple(map(str, x)) for x in (*colonnes, *index, *contraintes, *plans, *fonctions)]


@pytest.fixture(scope="module")
def pg():
    r = alembic("upgrade", "head")
    assert r.returncode == 0, r.stdout + r.stderr
    moteur = sa.create_engine(TEST_DATABASE_URL)
    yield moteur
    moteur.dispose()


def test_la_base_creee_par_les_migrations_contient_tout_ce_que_le_demarrage_creait(pg):
    insp = sa.inspect(pg)
    tables = set(insp.get_table_names())
    for table in TABLES:
        assert table in tables, f"table {table} absente après alembic upgrade head"
    colonnes = {t: {c["name"] for c in insp.get_columns(t)} for t in {t for t, _ in COLONNES}}
    for table, colonne in COLONNES:
        assert colonne in colonnes[table], f"{table}.{colonne} absente après alembic upgrade head"
    noms_index = {i["name"] for t in TABLES + ("organisations",) for i in insp.get_indexes(t)}
    for nom in INDEX:
        assert nom in noms_index, f"index {nom} absent après alembic upgrade head"
    with pg.connect() as c:
        etat = c.execute(sa.text("select is_nullable, column_default from information_schema.columns where table_schema=current_schema() "
                                 "and table_name='organisations' and column_name='plan_id'")).one()
        assert etat.is_nullable == "NO" and "6f1a0000-0000-4000-8000-000000000001" in etat.column_default
        assert c.execute(sa.text("select count(*) from plans")).scalar() == 4


def test_rejouer_l_ancien_demarrage_ne_change_rien(pg):
    with pg.connect() as c:
        avant = instantane(c)
    with pg.begin() as conn:
        for instruction in ANCIEN_DEMARRAGE_ORGANISATIONS:
            conn.execute(sa.text(instruction))
    for filet in ANCIENS_FILETS:
        with pg.begin() as conn:
            filet(conn)
    with pg.connect() as c:
        apres = instantane(c)
    assert avant == apres, f"différences : {sorted(set(apres) ^ set(avant))}"


def test_rejouer_alembic_upgrade_head_est_sans_effet(pg):
    with pg.connect() as c:
        avant = instantane(c)
    r = alembic("upgrade", "head")
    assert r.returncode == 0, r.stdout + r.stderr
    with pg.connect() as c:
        assert instantane(c) == avant
