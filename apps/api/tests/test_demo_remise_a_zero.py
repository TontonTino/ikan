"""Remise à zéro nocturne de la démonstration (scripts/demo_remettre_a_zero.py) : garde-fous et décalage des dates. Aucune connexion."""
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-demo-remise-0123456789")

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import demo_remettre_a_zero as remise  # noqa: E402

from app.core.config import settings  # noqa: E402

PRODUCTION = "postgresql://postgres.slynbxonwureptrmuskn:secret@aws-0-eu-west-2.pooler.supabase.com:6543/postgres"


def test_refuse_hors_configuration_de_demo(monkeypatch):
    monkeypatch.setattr(settings, "DEMO_MODE", "non")
    with pytest.raises(remise.RemiseRefusee, match="DEMO_MODE"):
        remise.verifier_cible("postgresql://postgres@127.0.0.1/demo")


def test_refuse_toujours_la_production_meme_avec_l_autorisation_explicite(monkeypatch):
    monkeypatch.setattr(settings, "DEMO_MODE", "oui")
    monkeypatch.setenv("IKAN_AUTORISER_PRODUCTION", "oui")
    with pytest.raises(remise.RemiseRefusee) as refus:
        remise.verifier_cible(PRODUCTION)
    assert "PRODUCTION" in str(refus.value) and "secret" not in str(refus.value)


def test_adresse_sqlalchemy_convertie_pour_pg_dump(monkeypatch):
    monkeypatch.setattr(settings, "DEMO_MODE", "oui")
    assert remise.verifier_cible("postgresql+psycopg2://u:p@127.0.0.1:5432/demo") == "postgresql://u:p@127.0.0.1:5432/demo"
    with pytest.raises(remise.RemiseRefusee):
        remise.verifier_cible("sqlite:///demo.db")


def test_jours_ecoules_depuis_la_capture(tmp_path):
    fichier = tmp_path / "reference.dump"
    remise.fichier_date(fichier).write_text(json.dumps({"capture": "2026-11-13T21:00:00+00:00"}))
    assert remise.jours_ecoules(fichier, datetime(2026, 11, 23, 22, 0, tzinfo=timezone.utc)) == 10
    assert remise.jours_ecoules(fichier, datetime(2026, 11, 13, 22, 0, tzinfo=timezone.utc)) == 0
    assert remise.jours_ecoules(fichier, datetime(2026, 11, 1, tzinfo=timezone.utc)) == 0      # horloge en arrière : jamais de recul


def test_une_requete_par_table_en_jours_entiers():
    requetes = remise.requetes_decalage([("feedbacks", "date_soumission"), ("feedbacks", "updated_at"), ("agences", "created_at")], 7)
    assert requetes == [
        'UPDATE "public"."agences" SET "created_at" = "created_at" + interval \'7 days\'',
        'UPDATE "public"."feedbacks" SET "date_soumission" = "date_soumission" + interval \'7 days\', '
        '"updated_at" = "updated_at" + interval \'7 days\'',
    ]


def test_le_journal_d_audit_ajout_seul_n_est_jamais_modifie():
    assert remise.requetes_decalage([("journal_audit", "date_action")], 7) == []
