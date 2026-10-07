"""
get_current_user (app/api/deps.py) doit rejeter tout jeton dont `type` n'est pas "access"
— en particulier un jeton NPS (app/core/security.py::create_nps_token, type "nps", émis
par POST /feedbacks). Aucun jeton NPS ne doit authentifier quoi que ce soit côté API
principale. Voir tests_unit/test_nps_token_rejected.py côté apps/agent pour l'équivalent.
"""
import os
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-nps-rejection-api-0123456789")

import pytest
from fastapi import HTTPException

from app.api.deps import get_current_user
from app.core.security import create_access_token, create_nps_token, create_refresh_token


class _RequeteJamaisAppelee:
    """db : lève si interrogée — un jeton de type non-"access" doit être rejeté avant
    toute requête SQL."""
    def query(self, *a, **k):
        raise AssertionError("get_current_user a interrogé la base alors que le jeton n'est pas de type 'access'")


def _auth(token):
    return SimpleNamespace(credentials=token)


def test_jeton_nps_rejete_sans_interroger_la_base():
    token = create_nps_token(uuid.uuid4())
    with pytest.raises(HTTPException) as exc:
        get_current_user(auth_header=_auth(token), access_token=None, db=_RequeteJamaisAppelee())
    assert exc.value.status_code == 401


def test_jeton_refresh_rejete_sans_interroger_la_base():
    token = create_refresh_token(uuid.uuid4())
    with pytest.raises(HTTPException) as exc:
        get_current_user(auth_header=_auth(token), access_token=None, db=_RequeteJamaisAppelee())
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

    token = create_access_token(uuid.uuid4())
    with pytest.raises(HTTPException) as exc:
        get_current_user(auth_header=_auth(token), access_token=None, db=_DbUtilisateurIntrouvable())
    assert exc.value.status_code == 401  # utilisateur introuvable, pas un rejet de type


def test_jeton_nps_passe_aussi_par_le_cookie_access_token_rejete():
    """Même vérification quand le jeton arrive par le cookie access_token plutôt que
    l'en-tête Authorization (voir get_current_user)."""
    token = create_nps_token(uuid.uuid4())
    with pytest.raises(HTTPException) as exc:
        get_current_user(auth_header=None, access_token=token, db=_RequeteJamaisAppelee())
    assert exc.value.status_code == 401
