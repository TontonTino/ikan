"""
SD-11 — en-têtes de sécurité de l'API : présents sur toutes les réponses (200, 401, 403, 404, 422, 429, 500), HSTS seulement en
production, Cache-Control: no-store sur les réponses authentifiées sans toucher aux routes publiques, CORS inchangé.
"""
import os

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-security-headers-0123456789")

import pytest
from fastapi import Depends, FastAPI, HTTPException, Response
from fastapi.testclient import TestClient
from pydantic import BaseModel

from app.core.config import settings
from app.core.cors import appliquer_cors
from app.core.entetes_securite import EN_TETES_FIXES, installer_entetes_securite

ORIGINE = "https://ikanai-dashboard-fixs.onrender.com"
FIXES = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-frame-options": "DENY",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
}


class Corps(BaseModel):
    nom: str


def fabriquer_app():
    app = FastAPI()
    appliquer_cors(app, [ORIGINE])

    @app.get("/ok")
    def ok():
        return {"ok": True}

    @app.get("/ressource-publique")
    def ressource_publique(reponse: Response):
        reponse.headers["Cache-Control"] = "public, max-age=3600"
        return {"x": 1}

    @app.get("/posede-un-cookie")
    def pose_cookie(reponse: Response):
        reponse.set_cookie("access_token", "v", httponly=True)
        return {"ok": True}

    @app.get("/401")
    def non_authentifie():
        raise HTTPException(status_code=401, detail="Non authentifié")

    @app.get("/403")
    def interdit():
        raise HTTPException(status_code=403, detail="Interdit")

    @app.get("/429")
    def trop_de_demandes():
        raise HTTPException(status_code=429, detail="Trop", headers={"Retry-After": "5"})

    @app.post("/422")
    def valide(corps: Corps):
        return corps

    @app.get("/500")
    def casse():
        raise RuntimeError("boom")

    from fastapi.responses import JSONResponse
    from starlette.requests import Request

    @app.exception_handler(Exception)
    async def gestionnaire(request: Request, exc: Exception):          # même forme que celui d'app.main
        return JSONResponse(status_code=500, content={"detail": "Une erreur interne est survenue."})

    installer_entetes_securite(app)
    return app


@pytest.fixture()
def client():
    return TestClient(fabriquer_app(), raise_server_exceptions=False)


def verifier_fixes(r):
    for nom, valeur in FIXES.items():
        assert r.headers.get(nom) == valeur, (nom, r.status_code)


CAS = [("get", "/ok", 200), ("get", "/401", 401), ("get", "/403", 403), ("get", "/inexistante", 404),
       ("post", "/422", 422), ("get", "/429", 429), ("get", "/500", 500)]


@pytest.mark.parametrize("methode,chemin,code", CAS)
def test_chaque_en_tete_est_present_sur_toutes_les_reponses(client, methode, chemin, code):
    r = getattr(client, methode)(chemin, **({"json": {}} if methode == "post" else {}))
    assert r.status_code == code
    verifier_fixes(r)


@pytest.mark.parametrize("nom", sorted(FIXES))
def test_la_liste_des_en_tetes_fixes_est_complete(nom):
    assert EN_TETES_FIXES[nom.encode()].decode() == FIXES[nom]


@pytest.mark.parametrize("methode,chemin,code", CAS)
def test_hsts_absent_hors_production(client, monkeypatch, methode, chemin, code):
    for env in ("development", "test", "staging"):
        monkeypatch.setattr(settings, "APP_ENV", env)
        r = getattr(client, methode)(chemin, **({"json": {}} if methode == "post" else {}))
        assert "strict-transport-security" not in r.headers


@pytest.mark.parametrize("methode,chemin,code", CAS)
def test_hsts_en_production_six_mois_sans_sous_domaines_ni_preload(client, monkeypatch, methode, chemin, code):
    monkeypatch.setattr(settings, "APP_ENV", "production")
    r = getattr(client, methode)(chemin, **({"json": {}} if methode == "post" else {}))
    assert r.headers["strict-transport-security"] == "max-age=15552000"
    assert "includesubdomains" not in r.headers["strict-transport-security"].lower() and "preload" not in r.headers["strict-transport-security"].lower()


def test_no_store_sur_reponse_authentifiee_par_bearer_ou_cookie(client):
    assert client.get("/ok", headers={"Authorization": "Bearer abc"}).headers["cache-control"] == "no-store"
    assert client.get("/ok", headers={"Cookie": "access_token=abc"}).headers["cache-control"] == "no-store"
    assert client.get("/401", headers={"Authorization": "Bearer faux"}).headers["cache-control"] == "no-store"
    assert client.get("/posede-un-cookie").headers["cache-control"] == "no-store"      # la réponse pose un cookie de session


def test_pas_de_no_store_sur_une_route_publique(client):
    assert "cache-control" not in client.get("/ok").headers
    assert "cache-control" not in client.get("/ok", headers={"Cookie": "autre=1"}).headers


def test_le_cache_control_d_une_route_n_est_jamais_ecrase(client):
    assert client.get("/ressource-publique").headers["cache-control"] == "public, max-age=3600"
    r = client.get("/ressource-publique", headers={"Authorization": "Bearer abc"})
    assert r.headers["cache-control"] == "public, max-age=3600"


def test_cors_inchange(client):
    r = client.get("/ok", headers={"Origin": ORIGINE})
    assert r.headers["access-control-allow-origin"] == ORIGINE and r.headers["access-control-allow-credentials"] == "true"
    pre = client.options("/ok", headers={"Origin": ORIGINE, "Access-Control-Request-Method": "POST"})
    assert pre.status_code == 200 and pre.headers["access-control-allow-origin"] == ORIGINE
    verifier_fixes(pre)
    assert "access-control-allow-origin" not in client.get("/ok", headers={"Origin": "https://evil.example.com"}).headers


def test_cookies_inchanges(client):
    r = client.get("/posede-un-cookie")
    assert "access_token=v" in r.headers["set-cookie"] and "HttpOnly" in r.headers["set-cookie"]


def test_limiteur_reel_429_porte_les_en_tetes():
    from app.core.rate_limit import limiter_ip_public, limiteur
    app = FastAPI()

    @app.get("/public", dependencies=[Depends(limiter_ip_public)])
    def public():
        return {}

    installer_entetes_securite(app)
    limiteur.reinitialiser()
    c = TestClient(app)
    ancien = settings.RATE_LIMIT_PUBLIC_PAR_IP
    settings.RATE_LIMIT_PUBLIC_PAR_IP = 1
    try:
        assert c.get("/public").status_code == 200
        r = c.get("/public")
        assert r.status_code == 429 and "retry-after" in r.headers
        verifier_fixes(r)
    finally:
        settings.RATE_LIMIT_PUBLIC_PAR_IP = ancien
        limiteur.reinitialiser()


def test_le_vrai_point_d_entree_porte_les_en_tetes(monkeypatch):
    from app.main import app as application
    c = TestClient(application, raise_server_exceptions=False)
    for r in (c.get("/health"), c.get("/api/v1/auth/me"), c.get("/introuvable"),
              c.post("/api/v1/auth/login", json={"email": "pas-un-email", "password": "x"})):
        verifier_fixes(r)
    assert [c.get("/health").status_code, c.get("/api/v1/auth/me").status_code, c.get("/introuvable").status_code] == [200, 401, 404]
    assert c.post("/api/v1/auth/login", json={"email": "pas-un-email", "password": "x"}).status_code == 422
    assert "cache-control" not in c.get("/health").headers
    monkeypatch.setattr(settings, "APP_ENV", "production")
    assert c.get("/health").headers["strict-transport-security"] == "max-age=15552000"
    assert c.get("/api/v1/auth/me", headers={"Authorization": "Bearer x"}).headers["cache-control"] == "no-store"
