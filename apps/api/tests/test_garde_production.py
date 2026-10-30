"""
SD-02 — la base de PRODUCTION ne sert jamais au développement ni aux tests.

Aucune base n'est touchée : les adresses utilisées ici sont fictives (le seul élément réel est l'identifiant public du projet de
production, volontairement écrit en clair dans ce test pour qu'un retrait de la liste protégée fasse échouer la suite), et
chaque script est appelé avec une session piégée qui échoue si la garde ne l'a pas arrêté avant.
"""
import importlib.util
import re
import sys
from pathlib import Path

import pytest

from app.core import garde_production as garde
from app.core.config import settings
from app.core.garde_production import (
    ProductionProtegee,
    avertir_si_production,
    est_base_de_production,
    refuser_si_production,
)

RACINE_API = Path(__file__).resolve().parents[1]
RACINE_AGENT = RACINE_API.parent / "agent"

ID_PROD = "slynbxonwureptrmuskn"          # identifiant public du projet de production (aucun secret)
MOT_DE_PASSE = "Motdepasse-Tres-Secret-42"
HOTE_POOLER = "aws-0-eu-west-2.pooler.supabase.com"

URL_PROD_POOLER = f"postgresql://postgres.{ID_PROD}:{MOT_DE_PASSE}@{HOTE_POOLER}:5432/postgres"
URL_PROD_TRANSACTION = f"postgresql+psycopg://postgres.{ID_PROD}:{MOT_DE_PASSE}@{HOTE_POOLER}:6543/postgres"
URL_PROD_DIRECTE = f"postgresql://postgres:{MOT_DE_PASSE}@db.{ID_PROD}.supabase.co:5432/postgres?sslmode=require"
URLS_PROD = [URL_PROD_POOLER, URL_PROD_TRANSACTION, URL_PROD_DIRECTE, URL_PROD_POOLER.upper()]

URLS_DEV = [
    f"postgresql://postgres.abcdefghijklmnopqrst:{MOT_DE_PASSE}@{HOTE_POOLER}:5432/postgres",   # autre projet Supabase (ikanai-dev)
    f"postgresql://postgres:{MOT_DE_PASSE}@db.abcdefghijklmnopqrst.supabase.co:5432/postgres",
    "postgresql://postgres:password@localhost:5432/ikanai",
    "postgresql+psycopg://postgres@localhost:54330/test",
    "sqlite://", "sqlite:///:memory:", "", None,
]


@pytest.fixture(autouse=True)
def _sans_autorisation(monkeypatch):
    monkeypatch.delenv(garde.VARIABLE_AUTORISATION, raising=False)


def _message(url, **kw):
    with pytest.raises(ProductionProtegee) as erreur:
        refuser_si_production(url, "opération de test", **kw)
    return str(erreur.value)


# ------------------------------------------------------------------ la garde elle-même

@pytest.mark.parametrize("url", URLS_PROD)
def test_adresse_de_production_refusee(url):
    assert est_base_de_production(url)
    message = _message(url)
    assert "PRODUCTION" in message and "opération de test" in message


@pytest.mark.parametrize("url", URLS_PROD)
def test_le_message_ne_contient_ni_mot_de_passe_ni_adresse_ni_identifiant(url):
    message = _message(url).lower()
    for interdit in (MOT_DE_PASSE, ID_PROD, "supabase", "pooler", "postgres", "5432", "6543", "@", "://"):
        assert interdit.lower() not in message, interdit
    # le message indique en revanche le contournement volontaire
    assert garde.VARIABLE_AUTORISATION.lower() in message


@pytest.mark.parametrize("url", URLS_DEV)
def test_adresse_de_developpement_acceptee(url):
    assert not est_base_de_production(url)
    refuser_si_production(url, "opération de test")


def test_l_identifiant_de_production_est_dans_la_liste_protegee():
    assert ID_PROD in garde.IDENTIFIANTS_PROJETS_PRODUCTION


def test_autorisation_explicite_exactement_oui(monkeypatch):
    monkeypatch.setenv(garde.VARIABLE_AUTORISATION, "oui")
    refuser_si_production(URL_PROD_POOLER, "opération de test")
    assert garde.autorisation_explicite()


@pytest.mark.parametrize("valeur", ["1", "true", "True", "yes", "OUI", "Oui", " oui", "oui ", "ouiii", "non", "", "0", "*", "production"])
def test_autorisation_etroite_aucune_autre_valeur_ne_suffit(monkeypatch, valeur):
    monkeypatch.setenv(garde.VARIABLE_AUTORISATION, valeur)
    assert not garde.autorisation_explicite()
    _message(URL_PROD_POOLER)


def test_la_variable_d_autorisation_porte_un_nom_sans_ambiguite():
    assert garde.VARIABLE_AUTORISATION == "IKAN_AUTORISER_PRODUCTION" and garde.VALEUR_AUTORISATION == "oui"


@pytest.mark.parametrize("app_env", ["production", "Production", " PRODUCTION "])
@pytest.mark.parametrize("url", URLS_PROD)
def test_app_env_production_n_est_jamais_bloque(url, app_env):
    refuser_si_production(url, "démarrage", app_env=app_env)


@pytest.mark.parametrize("app_env", ["development", "staging", "test", "prod", "", None])
def test_aucune_autre_valeur_de_app_env_n_exempte(app_env):
    _message(URL_PROD_POOLER, app_env=app_env)


@pytest.mark.parametrize("nom,valeur", [("RENDER", "true"), ("RENDER", "1"), ("RENDER_SERVICE_ID", "srv-x"), ("CI", "true"), ("ENV", "production"),
                                        ("NODE_ENV", "production"), ("PRODUCTION", "1"), ("APP_ENV", "production"), ("DEBUG", "false")])
def test_aucune_variable_d_environnement_ordinaire_n_exempte(monkeypatch, nom, valeur):
    """Pas d'exception cachée : seules IKAN_AUTORISER_PRODUCTION=oui ou le paramètre app_env=production (démarrage/Alembic) exemptent."""
    monkeypatch.setenv(nom, valeur)
    _message(URL_PROD_POOLER)


def test_sans_app_env_fourni_aucune_exemption_meme_si_la_configuration_dit_production(monkeypatch):
    """Les scripts n'envoient pas app_env : un .env local avec APP_ENV=production ne les rend pas capables d'écrire en production."""
    monkeypatch.setattr(settings, "APP_ENV", "production")
    _message(URL_PROD_POOLER)


def test_avertissement_pour_creer_admin_sans_blocage(capsys):
    assert avertir_si_production(URL_PROD_POOLER, "création d'un compte administrateur") is True
    ecrit = capsys.readouterr().err
    assert "PRODUCTION" in ecrit and MOT_DE_PASSE not in ecrit and ID_PROD not in ecrit and "supabase" not in ecrit
    assert avertir_si_production(URLS_DEV[0], "création d'un compte administrateur") is False
    assert capsys.readouterr().err == ""


# ------------------------------------------------------------------ démarrage de l'API

def test_l_api_refuse_de_demarrer_en_developpement_contre_la_production(monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import app

    monkeypatch.setattr(settings, "DATABASE_URL", URL_PROD_POOLER)
    monkeypatch.setattr(settings, "APP_ENV", "development")
    with pytest.raises(ProductionProtegee) as erreur:
        with TestClient(app):
            pass
    assert MOT_DE_PASSE not in str(erreur.value) and ID_PROD not in str(erreur.value)


@pytest.mark.parametrize("env", ["staging", "test", ""])
def test_l_api_refuse_aussi_hors_developpement_si_ce_n_est_pas_production(monkeypatch, env):
    from fastapi.testclient import TestClient

    from app.main import app

    monkeypatch.setattr(settings, "DATABASE_URL", URL_PROD_POOLER)
    monkeypatch.setattr(settings, "APP_ENV", env)
    with pytest.raises(ProductionProtegee):
        with TestClient(app):
            pass


def test_l_api_demarre_normalement_en_production_sur_la_base_de_production(monkeypatch):
    """Render : APP_ENV=production et DATABASE_URL de production -> jamais bloqué (et le démarrage n'ouvre aucune connexion)."""
    from fastapi.testclient import TestClient

    from app.main import app

    monkeypatch.setattr(settings, "DATABASE_URL", URL_PROD_POOLER)
    monkeypatch.setattr(settings, "APP_ENV", "production")
    with TestClient(app) as client:
        assert client.get("/health").status_code in (200, 404)


def test_l_api_demarre_en_developpement_sur_une_base_de_developpement(monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import app

    monkeypatch.setattr(settings, "DATABASE_URL", URLS_DEV[0])
    monkeypatch.setattr(settings, "APP_ENV", "development")
    with TestClient(app):
        pass


def test_l_autorisation_explicite_permet_le_demarrage_local_volontaire(monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import app

    monkeypatch.setattr(settings, "DATABASE_URL", URL_PROD_POOLER)
    monkeypatch.setattr(settings, "APP_ENV", "development")
    monkeypatch.setenv(garde.VARIABLE_AUTORISATION, "oui")
    with TestClient(app):
        pass


# ------------------------------------------------------------------ chaque script d'écriture appelle la garde

# Fichiers qui n'écrivent PAS en base ou qui sont faits pour la production : décision explicite, justifiée, jamais implicite.
SANS_GARDE_BLOQUANTE = {
    "scripts/create_stripe_products.py": "n'ouvre aucune connexion à la base (écrit uniquement dans Stripe)",
    "scripts/creer_admin.py": "faite pour la production : avertissement explicite (avertir_si_production) au lieu d'un blocage",
}
AVEC_AVERTISSEMENT = {"scripts/creer_admin.py"}


def _scripts_ecrivant_en_base():
    chemins = ["seed.py"] + sorted(f"scripts/{p.name}" for p in (RACINE_API / "scripts").glob("*.py") if p.name != "__init__.py")
    return chemins


def test_tous_les_scripts_prennent_une_decision_explicite():
    for chemin in _scripts_ecrivant_en_base():
        source = (RACINE_API / chemin).read_text(encoding="utf8")
        if chemin in SANS_GARDE_BLOQUANTE:
            continue
        assert "refuser_si_production(" in source, f"{chemin} : aucune garde SD-02 (refuser_si_production) — ajoutez-la ou justifiez dans SANS_GARDE_BLOQUANTE"


def test_creer_admin_avertit_et_les_exceptions_sont_connues():
    assert "avertir_si_production(" in (RACINE_API / "scripts/creer_admin.py").read_text(encoding="utf8")
    sans_connexion = (RACINE_API / "scripts/create_stripe_products.py").read_text(encoding="utf8")
    assert "SessionLocal" not in sans_connexion and "app.db" not in sans_connexion


@pytest.mark.parametrize("chemin", ["alembic/env.py", "app/main.py"])
def test_alembic_et_le_demarrage_de_l_api_appellent_la_garde_avec_app_env(chemin):
    source = (RACINE_API / chemin).read_text(encoding="utf8")
    assert re.search(r"refuser_si_production\([^)]*app_env=settings\.APP_ENV\)", source), chemin


@pytest.mark.parametrize("chemin", ["alembic/env.py", "app/main.py"])
def test_alembic_et_le_demarrage_de_l_agent_appellent_la_garde_avec_app_env(chemin):
    source = (RACINE_AGENT / chemin).read_text(encoding="utf8")
    assert re.search(r"refuser_si_production\([^)]*app_env=settings\.APP_ENV\)", source), f"agent/{chemin}"


_ENVELOPPES_GARDEES = []


def _charger(chemin, nom):
    spec = importlib.util.spec_from_file_location(nom, RACINE_API / chemin)
    module = importlib.util.module_from_spec(spec)
    sys.modules[nom] = module
    sortie, erreurs = sys.stdout, sys.stderr          # plusieurs scripts remplacent sys.stdout à l'import (UTF-8) : on le rend à pytest
    try:
        spec.loader.exec_module(module)
    finally:
        _ENVELOPPES_GARDEES.append(sys.stdout)        # sinon le ramasse-miettes ferme le tampon d'origine avec l'enveloppe
        sys.stdout, sys.stderr = sortie, erreurs
    return module


def _session_piegee(*a, **k):
    raise AssertionError("la garde n'a pas arrêté le script avant l'ouverture d'une session de base")


# (fichier, fonction d'entrée) — chacun doit lever ProductionProtegee AVANT toute session.
ENTREES = [
    ("seed.py", "seed_database"),
    ("scripts/seed_feedbacks_demo.py", "main"),
    ("scripts/seed_feedbacks_reclamations_demo.py", "main"),
    ("scripts/seed_issues_demo.py", "main"),
    ("scripts/seed_restauration_demo.py", "main"),
    ("scripts/seed_mentions_veille_demo.py", "main"),
    ("scripts/clear_demo_veille_urls.py", "main"),
]


def test_la_liste_des_entrees_couvre_tous_les_scripts_gardes():
    gardes = [c for c in _scripts_ecrivant_en_base() if c not in SANS_GARDE_BLOQUANTE]
    assert sorted(gardes) == sorted(c for c, _ in ENTREES)


@pytest.mark.parametrize("chemin,fonction", ENTREES)
def test_chaque_script_refuse_la_production_avant_toute_session(monkeypatch, chemin, fonction):
    module = _charger(chemin, "garde_" + re.sub(r"\W", "_", chemin))
    monkeypatch.setattr(settings, "DATABASE_URL", URL_PROD_POOLER)
    monkeypatch.setattr(settings, "APP_ENV", "development")
    monkeypatch.setattr(sys, "argv", [chemin, "--apply", "--force"])
    for nom in ("SessionLocal", "engine"):
        if hasattr(module, nom):
            monkeypatch.setattr(module, nom, _session_piegee)
    with pytest.raises(ProductionProtegee) as erreur:
        getattr(module, fonction)()
    assert MOT_DE_PASSE not in str(erreur.value) and ID_PROD not in str(erreur.value)


@pytest.mark.parametrize("chemin,fonction", ENTREES)
def test_un_script_n_est_pas_exempte_par_app_env_production_local(monkeypatch, chemin, fonction):
    module = _charger(chemin, "garde2_" + re.sub(r"\W", "_", chemin))
    monkeypatch.setattr(settings, "DATABASE_URL", URL_PROD_POOLER)
    monkeypatch.setattr(settings, "APP_ENV", "production")
    monkeypatch.setattr(sys, "argv", [chemin])
    for nom in ("SessionLocal", "engine"):
        if hasattr(module, nom):
            monkeypatch.setattr(module, nom, _session_piegee)
    with pytest.raises(ProductionProtegee):
        getattr(module, fonction)()


def test_creer_admin_reste_utilisable_contre_la_production_mais_avertit(monkeypatch, capsys):
    module = _charger("scripts/creer_admin.py", "garde_creer_admin")
    monkeypatch.setattr(settings, "DATABASE_URL", URL_PROD_POOLER)
    monkeypatch.setattr(settings, "APP_ENV", "development")

    class Atteinte(Exception):
        pass

    def session_factice():
        raise Atteinte("la commande est allée jusqu'à la session : elle n'est pas bloquée")

    monkeypatch.setattr(module, "SessionLocal", session_factice)
    code = module.main(["--email", "admin@example.com"], saisir=lambda invite: "Mdp-Valide-12345!", interactif=True)
    ecrit = capsys.readouterr().err
    assert code == 1                                             # échec technique volontaire de ma session factice, pas un refus de la garde
    assert "ATTENTION" in ecrit and "PRODUCTION" in ecrit
    assert "Atteinte" in ecrit                                   # la commande a bien continué après l'avertissement
    assert MOT_DE_PASSE not in ecrit and ID_PROD not in ecrit


# ------------------------------------------------------------------ les tests eux-mêmes ne touchent jamais la production

def _moteur_postgres(url):
    import sqlalchemy as sa

    for pilote in ("postgresql", "postgresql+psycopg"):
        try:
            return sa.create_engine(url.replace("postgresql://", pilote + "://", 1))
        except ImportError:
            continue
    pytest.skip("aucun pilote PostgreSQL importable ici")


def test_une_connexion_de_test_vers_la_production_est_refusee_avant_son_ouverture():
    moteur = _moteur_postgres(URL_PROD_DIRECTE)
    with pytest.raises(AssertionError) as erreur:
        moteur.connect()
    assert "PRODUCTION" in str(erreur.value) and MOT_DE_PASSE not in str(erreur.value) and ID_PROD not in str(erreur.value)


def test_une_connexion_de_test_vers_le_pooler_de_production_est_refusee_aussi():
    moteur = _moteur_postgres(URL_PROD_POOLER)
    with pytest.raises(AssertionError):
        moteur.connect()


def test_sqlite_en_memoire_reste_utilisable_dans_les_tests():
    import sqlalchemy as sa

    with sa.create_engine("sqlite://").connect() as c:
        assert c.execute(sa.text("select 1")).scalar() == 1


# ------------------------------------------------------------------ l'agent a le même module

def _code(chemin):
    source = Path(chemin).read_text(encoding="utf8").replace("\r\n", "\n")
    return source.split('"""\nimport os', 1)[1]


def test_les_modules_de_l_api_et_de_l_agent_ont_le_meme_code():
    assert _code(RACINE_API / "app/core/garde_production.py") == _code(RACINE_AGENT / "app/config/garde_production.py")
