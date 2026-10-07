"""
get_current_user (app/api/deps.py) doit rejeter tout jeton dont `type` n'est pas "access"
— en particulier un jeton NPS (apps/api/app/core/security.py::create_nps_token, type
"nps", émis par POST /feedbacks). Aucun jeton NPS ne doit authentifier quoi que ce soit
ici, qui vérifie les mêmes tokens que le backend principal avec la même SECRET_KEY.

Tests UNITAIRES sans base de données : la session DB n'est jamais interrogée pour un
jeton de type "nps" — le rejet intervient avant toute requête (voir l'assertion dédiée).

  python -m pytest tests_unit
"""
import os
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@127.0.0.1:1/ikanai_test_unit")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-nps-rejection-0123456789")
os.environ.setdefault("WEBHOOK_SECRET", "test-webhook-secret-nps-rejection")

import pytest
from fastapi import HTTPException
from jose import jwt

from app.api.deps import get_current_user
from app.config.settings import settings

SECRET_KEY = settings.SECRET_KEY
ALGORITHM = settings.ALGORITHM


class _RequeteJamaisAppelee:
    """db : lève si interrogée — un jeton de type non-"access" doit être rejeté avant
    toute requête SQL (voir la docstring du module)."""
    def query(self, *a, **k):
        raise AssertionError("get_current_user a interrogé la base alors que le jeton n'est pas de type 'access'")


def _token(type_: str, sub=None, exp_delta=timedelta(minutes=30)):
    payload = {"sub": str(sub or uuid.uuid4()), "type": type_, "exp": datetime.now(timezone.utc) + exp_delta}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def _auth(token):
    return SimpleNamespace(credentials=token)


def test_jeton_nps_rejete_sans_interroger_la_base():
    token = _token("nps")
    with pytest.raises(HTTPException) as exc:
        get_current_user(request=SimpleNamespace(cookies={}), auth_header=_auth(token), db=_RequeteJamaisAppelee())
    assert exc.value.status_code == 401


def test_jeton_access_valide_le_format_est_accepte_jusqua_la_requete_db():
    """Contrôle négatif : un vrai jeton "access" passe la vérification de type (la levée
    vient ensuite de l'utilisateur introuvable dans ce faux db, pas du type du jeton)."""
    class _DbUtilisateurIntrouvable:
        def query(self, *a, **k):
            return self

        def filter(self, *a, **k):
            return self

        def first(self):
            return None

    token = _token("access")
    with pytest.raises(HTTPException) as exc:
        get_current_user(request=SimpleNamespace(cookies={}), auth_header=_auth(token), db=_DbUtilisateurIntrouvable())
    assert exc.value.status_code == 401  # utilisateur introuvable, pas un rejet de type


def test_jeton_refresh_rejete_sans_interroger_la_base():
    token = _token("refresh")
    with pytest.raises(HTTPException) as exc:
        get_current_user(request=SimpleNamespace(cookies={}), auth_header=_auth(token), db=_RequeteJamaisAppelee())
    assert exc.value.status_code == 401
