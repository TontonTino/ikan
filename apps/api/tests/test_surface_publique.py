"""
Surface publique de l'API : seules les routes nécessaires au parcours client QR et à l'authentification
sont accessibles sans identifiants. Toute NOUVELLE route non authentifiée fait échouer ce test : elle doit
être ajoutée volontairement à la liste ci-dessous.

Régression : /qr-codes/validate-test/{code} (route de débogage publique) renvoyait le nombre total de QR codes de
la plateforme et, en cas d'erreur, une trace d'exécution complète. Elle a été supprimée.
"""
import os
import re
import uuid

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-surface-publique-0123456789")

import pytest
from fastapi.testclient import TestClient

from app.main import app

ROUTES_PUBLIQUES = {
    ("POST", "/api/v1/auth/login"),
    ("POST", "/api/v1/auth/logout"),
    ("POST", "/api/v1/auth/refresh"),
    ("POST", "/api/v1/feedbacks/"),
    ("POST", "/api/v1/feedbacks/{feedback_id}/nps"),
    ("GET", "/api/v1/qr-codes/ping"),
    ("GET", "/api/v1/qr-codes/{code}/validate"),
    ("GET", "/api/v1/qr-codes/{code}/categories"),
    ("POST", "/api/v1/qr-codes/{code}/suggestions"),
}

METHODES = ("get", "post", "put", "patch", "delete")


def _operations():
    chemins = app.openapi()["paths"]
    return [(m.upper(), chemin) for chemin, ops in chemins.items() for m in ops if m in METHODES and chemin.startswith("/api/v1")]


def _instancier(chemin: str) -> str:
    return re.sub(r"\{[^}]+\}", lambda m: "QR-TEST-01" if m.group(0) == "{code}" else str(uuid.uuid4()), chemin)


def test_les_routes_publiques_declarees_existent_toujours():
    existantes = set(_operations())
    assert ROUTES_PUBLIQUES <= existantes, ROUTES_PUBLIQUES - existantes


def test_la_route_de_debogage_publique_n_existe_plus():
    chemins = {chemin for _, chemin in _operations()}
    assert not any("validate-test" in c for c in chemins)
    client = TestClient(app)
    r = client.get("/api/v1/qr-codes/validate-test/QR-TEST-01")
    assert r.status_code in (404, 405)
    assert "db_qr_count" not in r.text and "trace" not in r.text.lower()


def test_toute_autre_route_exige_une_authentification():
    client = TestClient(app, raise_server_exceptions=False)
    ouvertes = []
    for methode, chemin in _operations():
        if (methode, chemin) in ROUTES_PUBLIQUES:
            continue
        r = client.request(methode, _instancier(chemin), json={} if methode != "GET" else None)
        if r.status_code not in (401, 403):
            ouvertes.append((methode, chemin, r.status_code))
    assert not ouvertes, f"routes accessibles sans identifiants : {ouvertes}"
