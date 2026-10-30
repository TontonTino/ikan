"""
SD-03 — le démarrage de l'API ne modifie JAMAIS la structure de la base : aucun ALTER, CREATE, DROP, aucun create_all(), aucune
connexion à la base. Le schéma ne vient que de `alembic upgrade head`, lancé avant le démarrage (render.yaml).
Aucune base n'est touchée : le moteur est espionné, et toute tentative de connexion serait enregistrée (puis échouerait).
"""
import os
import re
from pathlib import Path

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-startup-schema-0123456789")

from fastapi.testclient import TestClient
from sqlalchemy import event

from app.db.session import Base, engine

FICHIER_MAIN = Path(__file__).resolve().parents[1] / "app" / "main.py"
INTERDITS = re.compile(r"\b(ALTER|CREATE|DROP|TRUNCATE)\s+(TABLE|INDEX|COLUMN|SCHEMA|EXTENSION|UNIQUE)|create_all|drop_all|"
                       r"appliquer_schema|_bootstrap|engine\.begin|engine\.connect|ADD COLUMN", re.IGNORECASE)


def test_main_ne_contient_aucune_instruction_de_schema():
    source = FICHIER_MAIN.read_text(encoding="utf8")
    trouves = INTERDITS.findall(source)
    assert not trouves, f"instruction de schéma dans app/main.py : {trouves}"


def test_le_demarrage_n_ouvre_aucune_connexion_et_n_emet_aucune_instruction(monkeypatch):
    connexions, instructions = [], []
    event.listen(engine, "do_connect", lambda dialect, conn_rec, cargs, cparams: connexions.append(1))
    event.listen(engine, "before_cursor_execute", lambda conn, cur, statement, *a: instructions.append(statement))

    def interdit(*a, **k):
        raise AssertionError("Base.metadata.create_all() appelé au démarrage")

    monkeypatch.setattr(Base.metadata, "create_all", interdit)
    monkeypatch.setattr(Base.metadata, "drop_all", interdit)
    from app.main import app as application

    for env in ("development", "production", "staging"):
        monkeypatch.setattr("app.core.config.settings.APP_ENV", env)
        with TestClient(application):          # exécute les évènements startup puis shutdown
            pass
    assert connexions == [] and instructions == [], (connexions, instructions)


def test_les_modules_bootstrap_ne_sont_plus_importes_par_le_demarrage():
    source = FICHIER_MAIN.read_text(encoding="utf8")
    for nom in ("plan_bootstrap", "stripe_billing_bootstrap", "quota_alert_bootstrap"):
        assert nom not in source
