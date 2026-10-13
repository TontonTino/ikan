"""Configuration commune des tests de l'API."""
import os

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-tests-0123456789abcdef")

import pytest
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.ext.compiler import compiles


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
