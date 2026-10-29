"""
Ordre des middlewares de app.main : les en-têtes de sécurité (SD-11) enveloppent TOUTE la pile, y compris les refus 403 du contrôle d'origine
(SD-08, CSRF) et les 429 de la limitation de connexion. Test sur le vrai point d'entrée.
"""
import os
from types import SimpleNamespace

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-middleware-order-0123456789")

import pytest
from fastapi.testclient import TestClient

from app.core import login_throttle
from app.core.config import settings
from app.core.csrf import MESSAGE_ORIGINE_REFUSEE
from app.core.rate_limit import limiteur
from app.main import app as application

ATTENDUS = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
}


def verifier(r):
    for nom, valeur in ATTENDUS.items():
        assert r.headers.get(nom) == valeur, nom


@pytest.fixture()
def client():
    limiteur.reinitialiser()
    yield TestClient(application, raise_server_exceptions=False)
    limiteur.reinitialiser()


def test_le_middleware_d_en_tetes_est_le_plus_exterieur_de_la_pile():
    noms = []
    pile = application.build_middleware_stack()
    while pile is not None and len(noms) < 12:
        noms.append(type(pile).__name__)
        pile = getattr(pile, "app", None)
    assert noms[0] == "EntetesSecurite"
    assert noms.index("EntetesSecurite") < noms.index("ProtectionCSRF") < noms.index("ExceptionMiddleware")


def test_un_403_csrf_porte_les_en_tetes_de_securite(client, monkeypatch):
    monkeypatch.setattr(settings, "APP_ENV", "production")
    r = client.patch("/api/v1/auth/me", json={"nom": "X"}, headers={"Cookie": "access_token=nimporte", "Origin": "https://evil.example.com"})
    assert r.status_code == 403 and r.json() == {"detail": MESSAGE_ORIGINE_REFUSEE}
    verifier(r)
    assert r.headers["strict-transport-security"] == "max-age=15552000"
    assert r.headers["cache-control"] == "no-store"


def test_un_429_de_connexion_porte_les_en_tetes_de_securite(client, monkeypatch):
    monkeypatch.setattr(settings, "APP_ENV", "production")
    requete = SimpleNamespace(client=SimpleNamespace(host="testclient"), headers={})
    for _ in range(settings.LOGIN_MAX_ECHECS_PAR_COUPLE):
        login_throttle.noter_echec(requete, "a@exemple.io")
    r = client.post("/api/v1/auth/login", json={"email": "a@exemple.io", "password": "mauvais"})
    assert r.status_code == 429 and "retry-after" in r.headers
    assert r.json() == {"detail": login_throttle.MESSAGE_TROP_DE_TENTATIVES}
    verifier(r)
    assert r.headers["strict-transport-security"] == "max-age=15552000"
