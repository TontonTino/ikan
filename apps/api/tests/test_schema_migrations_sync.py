"""
Synchronisation modèles SQLAlchemy <-> migrations Alembic : après application de TOUTES
les migrations sur une base vide, le schéma obtenu doit correspondre exactement à ce que
déclarent les modèles (Base.metadata) — sinon un modèle a été modifié sans migration
correspondante (ou l'inverse). Isolé du process courant via un subprocess `alembic upgrade
head` avec DATABASE_URL surchargée par variable d'environnement : c'est le SEUL moyen de
rediriger réellement Alembic, car alembic/env.py relit `settings.DATABASE_URL` (donc le
.env réel) et ignore tout `Config.set_main_option("sqlalchemy.url", ...)` passé par du code
appelant — piège découvert pendant cette tâche, voir le rapport.

NE TOUCHE JAMAIS à la base pointée par apps/api/.env : chaque run utilise sa propre base
jetable (Postgres via TEST_DATABASE_URL si fourni, sinon SQLite en fichier temporaire).

Limite connue (voir le rapport) : plusieurs migrations historiques (ex. 002) exécutent du
SQL brut spécifique à PostgreSQL (`ALTER COLUMN ... SET NOT NULL`, syntaxe absente de
SQLite) — la relecture complète de l'historique échoue donc sur SQLite. Sans Postgres
jetable disponible dans cet environnement, le test réel (Postgres) est marqué "skipped" et
signalé comme tel plutôt que simulé.
"""
import os
import subprocess
import sys
import uuid
from pathlib import Path

import pytest
import sqlalchemy as sa

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-schema-sync-tests-0123456789")

from app.db.session import Base
from app.models import *  # noqa — assure l'enregistrement de tous les modèles dans Base.metadata

API_DIR = Path(__file__).resolve().parents[1]


def _schema_attendu_par_les_modeles() -> dict[str, set[str]]:
    return {table.name: {col.name for col in table.columns} for table in Base.metadata.sorted_tables}


def _executer_migrations_et_lire_le_schema(database_url: str) -> dict[str, set[str]]:
    """Lance `alembic upgrade head` dans un PROCESSUS SÉPARÉ avec DATABASE_URL surchargée
    (seul moyen fiable : voir la docstring du module), puis reflète le schéma obtenu."""
    env = {**os.environ, "DATABASE_URL": database_url, "SECRET_KEY": os.environ["SECRET_KEY"]}
    resultat = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=str(API_DIR),
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )
    if resultat.returncode != 0:
        raise RuntimeError(f"alembic upgrade head a échoué :\n{resultat.stdout}\n{resultat.stderr}")

    engine = sa.create_engine(database_url)
    insp = sa.inspect(engine)
    schema = {table: {col["name"] for col in insp.get_columns(table)} for table in insp.get_table_names()}
    engine.dispose()
    return schema


def _comparer(attendu: dict[str, set[str]], obtenu: dict[str, set[str]]) -> list[str]:
    ecarts = []
    tables_manquantes = set(attendu) - set(obtenu) - {"alembic_version"}
    tables_en_trop = set(obtenu) - set(attendu) - {"alembic_version"}
    if tables_manquantes:
        ecarts.append(f"tables déclarées par les modèles mais absentes après migration : {sorted(tables_manquantes)}")
    if tables_en_trop:
        ecarts.append(f"tables créées par les migrations mais absentes des modèles : {sorted(tables_en_trop)}")

    for table in sorted(set(attendu) & set(obtenu)):
        cols_manquantes = attendu[table] - obtenu[table]
        cols_en_trop = obtenu[table] - attendu[table]
        if cols_manquantes:
            ecarts.append(f"{table} : colonnes du modèle absentes après migration : {sorted(cols_manquantes)}")
        if cols_en_trop:
            ecarts.append(f"{table} : colonnes créées par migration mais absentes du modèle : {sorted(cols_en_trop)}")
    return ecarts


def test_migrations_head_correspondent_aux_modeles_postgres():
    """Le vrai test : une base Postgres JETABLE (jamais celle de .env), fournie via
    TEST_DATABASE_URL. Skip explicite si aucune n'est disponible dans cet environnement."""
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip(
            "TEST_DATABASE_URL non fourni : aucune base Postgres jetable disponible dans cet "
            "environnement (ni psql, ni docker). Voir README (section Tests) pour la commande "
            "à lancer localement avec un Postgres jetable. Le test équivalent sur SQLite "
            "(test_migrations_head_sqlite_limite_connue ci-dessous) documente la limite."
        )
    obtenu = _executer_migrations_et_lire_le_schema(url)
    ecarts = _comparer(_schema_attendu_par_les_modeles(), obtenu)
    assert not ecarts, "Écart modèles <-> migrations :\n" + "\n".join(ecarts)


def test_migrations_head_sqlite_limite_connue():
    """Sur SQLite, la relecture complète échoue à la migration 002 (ALTER COLUMN ... SET NOT
    NULL, syntaxe PostgreSQL absente de SQLite) : limite connue et acceptée (voir docstring
    du module), pas un écart modèles/migrations. Le test documente cet échec précis plutôt
    que de le laisser remonter comme une erreur non expliquée, et échouerait si le message
    changeait (signe que la cause a changé et mérite d'être ré-examinée)."""
    chemin_db = Path(os.environ.get("TEMP", "/tmp")) / f"ikan_schema_sync_{uuid.uuid4().hex}.db"
    url = f"sqlite:///{chemin_db.as_posix()}"
    try:
        with pytest.raises(RuntimeError, match=r"ALTER COLUMN|syntax error"):
            _executer_migrations_et_lire_le_schema(url)
    finally:
        chemin_db.unlink(missing_ok=True)
