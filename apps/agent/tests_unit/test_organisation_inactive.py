"""
get_current_user (app/api/deps.py) refuse un compte dont l'ORGANISATION est désactivée (même règle que apps/api) :
YAM n'est plus utilisable, et un jeton déjà émis cesse d'être accepté. SQLite en mémoire (jamais de vraie base).

  python -m pytest tests_unit
"""
import os
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@127.0.0.1:1/ikanai_test_unit")
os.environ.setdefault("SECRET_KEY", "test-secret-key-for-org-inactive-0123456789")
os.environ.setdefault("WEBHOOK_SECRET", "test-webhook-secret-org-inactive")

import pytest
from fastapi import HTTPException
from jose import jwt
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_current_user
from app.config.settings import settings
from app.models.enums import UserRole
from app.models.readonly import Organisation, ReadOnlyBase, Utilisateur


@pytest.fixture()
def db():
    moteur = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    assert moteur.url.get_backend_name() == "sqlite"
    ReadOnlyBase.metadata.create_all(moteur, tables=[Organisation.__table__, Utilisateur.__table__])
    session = sessionmaker(bind=moteur)()
    yield session
    session.close()


def _compte(db, org_active):
    org = Organisation(id=uuid.uuid4(), nom="Org", active=org_active)
    db.add(org); db.flush()
    u = Utilisateur(id=uuid.uuid4(), organisation_id=org.id, nom="N", prenom="P", email="a@b.io", mot_de_passe_hash="hash", role=UserRole.CX_MANAGER, active=True)
    db.add(u); db.commit()
    return u.id


def _jeton(uid):
    return jwt.encode({"sub": str(uid), "type": "access", "exp": datetime.now(timezone.utc) + timedelta(minutes=30)},
                      settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def _appel(db, uid):
    return get_current_user(request=SimpleNamespace(cookies={}), auth_header=SimpleNamespace(credentials=_jeton(uid)), db=db)


def test_organisation_active_accepte_le_jeton(db):
    uid = _compte(db, True)
    assert _appel(db, uid).id == uid


def test_organisation_inactive_refuse_le_jeton_deja_emis(db):
    uid = _compte(db, False)
    with pytest.raises(HTTPException) as refus:
        _appel(db, uid)
    assert refus.value.status_code == 401


def test_reactivation_retablit_l_acces(db):
    uid = _compte(db, False)
    db.query(Organisation).update({"active": True}); db.commit()
    assert _appel(db, uid).id == uid
