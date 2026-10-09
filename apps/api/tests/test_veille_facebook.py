"""
Connexion de la Page Facebook (routes /veille/facebook/*) : réservées au CX Manager,
organisation et page de retour imposées par le serveur, aucun jeton renvoyé, URL
d'autorisation hors facebook.com refusée, Page d'une autre organisation refusée, lien
« Voir la source » limité aux URL https facebook.com / fb.com. Le microservice de veille
est simulé par un httpx.MockTransport : aucun appel réseau réel, aucune base partagée.
"""
import json
import os
from types import SimpleNamespace
from uuid import uuid4

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-veille-facebook-tests-0123456789")

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.deps import get_current_active_user
from app.api.v1.endpoints import veille
from app.core.config import settings
from app.db.session import get_db
from app.models.enums import UserRole
from app.services import veille_service
from app.services.veille_service import url_source_sure

SERVICE = "http://veille.test"
JETON = "EAAG-jeton-secret-de-page"


class _DbInterdite:
    def __getattr__(self, nom):
        raise AssertionError(f"Accès base de données ({nom}) inattendu")


def _user(role, org_id=None):
    return SimpleNamespace(id=uuid4(), role=role, active=True, agence_id=None, organisation_id=org_id or uuid4())


def _client(user, db=None):
    app = FastAPI()
    app.include_router(veille.router, prefix="/veille")
    app.dependency_overrides[get_current_active_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: db if db is not None else _DbInterdite()
    return TestClient(app)


def _page(client_id, page_id="111", status="active", **extra):
    return {
        "id": str(uuid4()), "client_id": client_id, "page_id": page_id, "page_name": f"Page {page_id}",
        "category": "Télécom", "status": status, "scopes": ["pages_read_engagement"], "token_type": "PAGE",
        "is_valid": True, "expires_at": 0, "data_access_expires_at": 1893456000, "reauth_reason": None,
        "needs_attention": False, "reason": None, "connected_at": "2026-10-01T00:00:00Z",
        "token_checked_at": None, "last_sync_at": None, "last_error": None, **extra,
    }


class FauxMicroservice:
    """Microservice de veille simulé ; enregistre chaque requête reçue."""

    def __init__(self, pages=None, authorize_url="https://www.facebook.com/v25.0/dialog/oauth?state=x",
                 sync_status="success", feedback=None):
        self.pages = pages or []
        self.authorize_url = authorize_url
        self.sync_status = sync_status
        self.feedback = feedback or []
        self.requetes: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requetes.append(request)
        path = request.url.path
        if path == "/health":
            return httpx.Response(200, json={"status": "ok", "service": veille_service.VEILLE_SERVICE_IDENTITY})
        if path == "/pages":
            client_id = request.url.params.get("client_id")
            # Le vrai microservice filtre déjà par client_id ; on renvoie TOUT ici pour prouver
            # que l'API refiltre elle aussi (défense en profondeur).
            return httpx.Response(200, json={"pages": self.pages, "_client_id": client_id})
        if path == "/connect/facebook/start":
            return httpx.Response(200, json={"authorize_url": self.authorize_url})
        if path.startswith("/pages/") and path.endswith("/sync"):
            return httpx.Response(200, json={"status": self.sync_status, "count": len(self.feedback), "errors": []})
        if path == "/feedback":
            return httpx.Response(200, json={"items": self.feedback, "next_cursor": None})
        return httpx.Response(404, json={"detail": "inconnu"})

    def requetes_vers(self, suffixe):
        return [r for r in self.requetes if r.url.path.endswith(suffixe)]


@pytest.fixture()
def micro(monkeypatch):
    def installer(**kwargs):
        faux = FauxMicroservice(**kwargs)
        vrai_async_client = httpx.AsyncClient
        monkeypatch.setattr(settings, "VEILLE_SERVICE_URL", SERVICE)
        monkeypatch.setattr(settings, "VEILLE_API_KEY", "cle-serveur")
        monkeypatch.setattr(settings, "PUBLIC_DASHBOARD_URL", "https://dashboard.ikan.test/")
        monkeypatch.setattr(
            veille_service.httpx, "AsyncClient",
            lambda **kw: vrai_async_client(transport=httpx.MockTransport(faux), **kw),
        )
        return faux
    return installer


# ── Accès : CX Manager uniquement, refus AVANT tout appel au microservice ─────

@pytest.mark.parametrize("role", [UserRole.AGENCY_MANAGER, UserRole.ADMIN])
@pytest.mark.parametrize("methode,chemin,corps", [
    ("get", "/veille/facebook/status", None),
    ("post", "/veille/facebook/connect", None),
    ("post", "/veille/facebook/scrape", {"auto_ingest": True}),
])
def test_routes_facebook_refusees_hors_cx_manager(micro, role, methode, chemin, corps):
    faux = micro()
    client = _client(_user(role))
    res = client.get(chemin) if methode == "get" else client.post(chemin, json=corps)
    assert res.status_code == 403
    assert res.json()["detail"] == "Accès réservé aux CX Managers"
    assert faux.requetes == []


# ── Organisation impossible à falsifier, return_url imposée ─────────────────

def test_connect_impose_organisation_et_url_de_retour(micro):
    org = uuid4()
    faux = micro()
    client = _client(_user(UserRole.CX_MANAGER, org))
    res = client.post(
        "/veille/facebook/connect",
        params={"client_id": "autre-org", "return_to": "https://pirate.test/vol"},
        json={"client_id": "autre-org", "return_to": "https://pirate.test/vol", "return_url": "https://pirate.test"},
    )
    assert res.status_code == 200, res.text
    assert res.json() == {"authorize_url": faux.authorize_url}

    [requete] = faux.requetes_vers("/connect/facebook/start")
    corps = json.loads(requete.content)
    assert corps == {"client_id": str(org), "return_to": "https://dashboard.ikan.test/veille"}
    assert requete.headers["X-API-Key"] == "cle-serveur"


def test_status_et_scrape_utilisent_l_organisation_authentifiee(micro):
    org = uuid4()
    page = _page(str(org))
    faux = micro(pages=[page])
    client = _client(_user(UserRole.CX_MANAGER, org))

    assert client.get("/veille/facebook/status", params={"client_id": "autre-org"}).status_code == 200
    res = client.post("/veille/facebook/scrape", params={"client_id": "autre-org"}, json={})
    assert res.status_code == 200, res.text

    for requete in faux.requetes_vers("/pages") + faux.requetes_vers("/sync"):
        assert requete.url.params["client_id"] == str(org)
    [sync] = faux.requetes_vers("/sync")
    assert sync.url.path == f"/pages/{page['id']}/sync"


def test_scrape_refuse_client_id_ou_target_dans_le_corps(micro):
    faux = micro(pages=[])
    client = _client(_user(UserRole.CX_MANAGER))
    for corps in ({"client_id": "autre-org"}, {"target": "https://facebook.com/autre"}):
        res = client.post("/veille/facebook/scrape", json=corps)
        assert res.status_code == 422
    assert faux.requetes == []


# ── Aucun jeton dans les réponses ───────────────────────────────────────────

def test_status_ne_renvoie_jamais_de_jeton(micro):
    org = uuid4()
    page = _page(str(org), access_token=JETON, page_token_encrypted=f"chiffre:{JETON}", last_error="détail Meta brut")
    micro(pages=[page])
    client = _client(_user(UserRole.CX_MANAGER, org))

    res = client.get("/veille/facebook/status")
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["service"] == "online"
    assert data["pages_disponibles"] is True
    assert data["pages"] == [{
        "id": page["id"], "page_id": "111", "page_name": "Page 111", "status": "active",
        "expires_at": 0, "data_access_expires_at": 1893456000, "needs_attention": False, "last_sync_at": None,
    }]
    assert JETON not in res.text
    assert "token" not in json.dumps(data["pages"])
    assert "cle-serveur" not in res.text

    ancien = client.get("/veille/status")
    assert JETON not in ancien.text and "page_token" not in ancien.text


def test_status_service_hors_ligne(monkeypatch):
    async def hors_ligne():
        return {"status": "offline", "error": "Connection refused"}

    monkeypatch.setattr(veille, "check_veille_service", hors_ligne)
    res = _client(_user(UserRole.CX_MANAGER)).get("/veille/facebook/status")
    assert res.status_code == 200
    assert res.json() == {"service": "offline", "pages_disponibles": False, "pages": []}


# ── URL d'autorisation : facebook.com en https uniquement ───────────────────

@pytest.mark.parametrize("url", [
    "https://pirate.test/dialog/oauth",
    "https://facebook.com.pirate.test/dialog/oauth",
    "https://pirate-facebook.com/dialog/oauth",
    "http://www.facebook.com/v25.0/dialog/oauth",
    "https://user@www.facebook.com/dialog/oauth",
    "javascript:alert(1)//facebook.com",
    None,
])
def test_connect_refuse_url_non_facebook(micro, url):
    micro(authorize_url=url)
    res = _client(_user(UserRole.CX_MANAGER)).post("/veille/facebook/connect")
    assert res.status_code == 502
    assert "authorize_url" not in res.json()
    if url:
        assert url not in res.text


# ── Page d'une autre organisation refusée ───────────────────────────────────

def test_scrape_refuse_page_d_une_autre_organisation(micro):
    org = uuid4()
    page_autre_org = _page(str(uuid4()), page_id="999")
    faux = micro(pages=[_page(str(org), page_id="111"), page_autre_org])
    client = _client(_user(UserRole.CX_MANAGER, org))

    res = client.post("/veille/facebook/scrape", json={"page_id": "999", "auto_ingest": True})
    assert res.status_code == 404
    assert faux.requetes_vers("/sync") == []
    assert faux.requetes_vers("/feedback") == []

    # Même filtrée par le microservice, une Page d'une autre organisation n'apparaît jamais.
    statut = client.get("/veille/facebook/status").json()
    assert [p["page_id"] for p in statut["pages"]] == ["111"]


def test_scrape_sans_page_connectee(micro):
    micro(pages=[])
    res = _client(_user(UserRole.CX_MANAGER)).post("/veille/facebook/scrape", json={})
    assert res.status_code == 409
    assert res.json()["detail"] == "Aucune Page Facebook n'est connectée."


def test_scrape_session_a_renouveler(micro):
    org = uuid4()
    micro(pages=[_page(str(org), status="reauth_required")])
    res = _client(_user(UserRole.CX_MANAGER, org)).post("/veille/facebook/scrape", json={})
    assert res.status_code == 409
    assert "renouveler" in res.json()["detail"]


def test_scrape_auto_ingest_transmet_les_items_de_la_page_avec_leur_permalink(micro, monkeypatch):
    org = uuid4()
    commentaire = {
        "source": "facebook", "source_id": "111_222", "target_url": "https://www.facebook.com/111",
        "text": "Réseau très lent ce soir", "published_at": "2026-10-08T10:00:00+00:00",
        "permalink": "https://www.facebook.com/111/posts/333?comment_id=222",
    }
    autre_page = {**commentaire, "source_id": "555_1", "target_url": "https://www.facebook.com/555"}
    micro(pages=[_page(str(org), page_id="111")], feedback=[commentaire, autre_page])

    recu = {}

    def faux_ingest(items, organisation_id, agence_id, db):
        recu.update(items=items, organisation_id=organisation_id)
        return {"ingested_count": len(items), "duplicate_count": 0, "ignored_empty_count": 0}

    monkeypatch.setattr(veille, "ingest_mentions", faux_ingest)
    res = _client(_user(UserRole.CX_MANAGER, org)).post("/veille/facebook/scrape", json={"auto_ingest": True})
    assert res.status_code == 200, res.text
    assert res.json()["ingestion"]["ingested_count"] == 1
    assert recu["organisation_id"] == org
    assert [item["source_id"] for item in recu["items"]] == ["111_222"]


# ── Lien source : https sur facebook.com / fb.com, sinon null ───────────────

@pytest.mark.parametrize("url,attendu", [
    ("https://www.facebook.com/111/posts/333?comment_id=222", "https://www.facebook.com/111/posts/333?comment_id=222"),
    ("https://m.facebook.com/story.php?id=1", "https://m.facebook.com/story.php?id=1"),
    ("https://fb.com/111/posts/333", "https://fb.com/111/posts/333"),
    ("http://www.facebook.com/111/posts/333", None),
    ("https://facebook.com.pirate.test/x", None),
    ("https://pirate.test/?u=facebook.com", None),
    ("javascript:alert(1)", None),
    ("", None),
    (None, None),
])
def test_url_source_sure(url, attendu):
    assert url_source_sure(url) == attendu


def test_url_source_reconstruite_par_le_collecteur_ecartee():
    # Repli du collecteur quand Graph ne renvoie pas permalink_url : pas le lien réel.
    assert url_source_sure("https://www.facebook.com/111_222", "111_222") is None
