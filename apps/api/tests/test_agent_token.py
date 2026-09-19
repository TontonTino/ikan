"""Jeton d'accès pour l'agent YAM : réservé CX Manager / Agency Manager, jamais l'Admin."""
import os
from types import SimpleNamespace
from uuid import uuid4

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-agent-token-tests-0123456789")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.deps import get_current_active_user
from app.api.v1.endpoints import auth
from app.core.config import settings
from app.core.security import decode_token
from app.models.enums import UserRole


def _client(role):
    app = FastAPI()
    app.include_router(auth.router, prefix="/auth")
    user = SimpleNamespace(id=uuid4(), role=role, active=True)
    app.dependency_overrides[get_current_active_user] = lambda: user
    return TestClient(app), user


@pytest.mark.parametrize("role", [UserRole.CX_MANAGER, UserRole.AGENCY_MANAGER])
def test_agent_token_delivre_pour_les_roles_yam(role):
    client, user = _client(role)
    r = client.get("/auth/agent-token")
    assert r.status_code == 200
    corps = r.json()
    assert corps["token_type"] == "bearer"
    assert corps["expires_in"] == settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    claims = decode_token(corps["access_token"])
    assert claims["type"] == "access" and claims["sub"] == str(user.id)


def test_agent_token_refuse_a_l_admin():
    client, _ = _client(UserRole.ADMIN)
    assert client.get("/auth/agent-token").status_code == 403


def test_agent_token_exige_une_session():
    app = FastAPI()
    app.include_router(auth.router, prefix="/auth")
    # sans override : pas de cookie ni de Bearer -> 401 (avant tout accès base de données utile)
    app.dependency_overrides = {}
    from app.db.session import get_db
    app.dependency_overrides[get_db] = lambda: None
    assert TestClient(app).get("/auth/agent-token").status_code == 401
