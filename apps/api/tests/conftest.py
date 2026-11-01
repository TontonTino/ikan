"""Configuration commune des tests de l'API."""
import os

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-tests-0123456789abcdef")

import pytest
from sqlalchemy import event
from sqlalchemy.engine import Engine

from app.db.session import Base
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.ext.compiler import compiles


# SD-02 : les tests tournent sur SQLite en mémoire et ne doivent JAMAIS toucher la base de production. Deux protections :
# (1) la session échoue d'emblée si une adresse de base de la configuration (.env compris) est celle de la production ;
# (2) toute connexion réelle vers une adresse protégée est refusée avant d'être ouverte (même si un test crée son propre moteur).
from app.core.config import settings as _reglages  # noqa: E402
from app.core.garde_production import est_base_de_production  # noqa: E402

for _nom, _adresse in (("DATABASE_URL (configuration ou .env)", _reglages.DATABASE_URL),
                       ("DATABASE_URL (environnement)", os.environ.get("DATABASE_URL", "")),
                       ("TEST_DATABASE_URL", os.environ.get("TEST_DATABASE_URL", ""))):
    if est_base_de_production(_adresse):
        raise pytest.UsageError(
            f"Tests arrêtés : {_nom} pointe vers la base de PRODUCTION (SD-02). Aucune connexion n'a été ouverte. "
            "Repointez-la vers une base de développement ou retirez-la : les tests n'en ont pas besoin (SQLite en mémoire)."
        )


@event.listens_for(Engine, "do_connect")
def _refuser_connexion_a_la_production(dialect, conn_rec, cargs, cparams):
    if est_base_de_production(f"{cargs} {cparams}"):
        raise AssertionError("Un test a tenté de se connecter à la base de PRODUCTION (SD-02) : connexion refusée avant son ouverture.")


# Journal d'audit (AD-08, SD-13) : les actions tracées écrivent une ligne dans `journal_audit`. Beaucoup de tests ne créent qu'UNE LISTE de
# tables ; après toute création de tables (même partielle), on crée donc aussi celle du journal, sans modifier ces tests.
@event.listens_for(Base.metadata, "after_create")
def _creer_aussi_le_journal_d_audit(metadata, connection, **kw):
    from app.models.journal_audit import JournalAudit

    JournalAudit.__table__.create(bind=connection, checkfirst=True)


@compiles(PG_UUID, "sqlite")
def _uuid_en_texte_sur_sqlite(type_, compiler, **kw):
    """Les modèles déclarent postgresql.UUID, rendu « UUID » sur SQLite : un nom inconnu lui donne l'affinité NUMERIC, et un
    identifiant dont l'écriture hexadécimale ressemble à un nombre (32 chiffres, ou chiffres avec un seul « e ») revient
    converti en flottant. SQLAlchemy stocke l'UUID en 32 caractères hexadécimaux sans tirets : CHAR(32) = affinité texte.
    Ne concerne que les tests (PostgreSQL, utilisé en production, garde son vrai type UUID)."""
    return "CHAR(32)"


@pytest.fixture(autouse=True)
def _compteurs_de_debit_vierges():
    """Les compteurs de limitation de débit sont en mémoire et globaux au processus : sans remise à zéro, les envois
    d'un test compteraient pour le suivant (même adresse « testclient »)."""
    from app.core.rate_limit import limiteur

    limiteur.reinitialiser()
    yield
    limiteur.reinitialiser()
