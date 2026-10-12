"""Configuration commune des tests de l'API."""
import os

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-tests-0123456789abcdef")

import pytest


@pytest.fixture(autouse=True)
def _compteurs_de_debit_vierges():
    """Les compteurs de limitation de débit sont en mémoire et globaux au processus : sans remise à zéro, les envois
    d'un test compteraient pour le suivant (même adresse « testclient »)."""
    from app.core.rate_limit import limiteur

    limiteur.reinitialiser()
    yield
    limiteur.reinitialiser()
