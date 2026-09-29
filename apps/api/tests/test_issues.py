"""
Issues (fondation V1 manuelle) : quand une nouvelle ActionCorrective est créée sur une
Issue déjà 'verifiee', celle-ci ne doit jamais rester 'verifiee' avec une action encore
ouverte — elle repasse par 'reouverte' (date_verification remise à NULL) avant la
transition normale vers 'action_en_cours', même sémantique que le rattachement d'un
feedback après vérification. Base SQLite en mémoire (comme test_veille_mentions.py).
"""
import os
from types import SimpleNamespace
from uuid import uuid4

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-issues-tests-0123456789")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_current_active_user
from app.api.v1.endpoints import issues
from app.db.session import Base, get_db
from app.models.action_corrective import ActionCorrective
from app.models.agence import Agence
from app.models.enums import CriticiteType, UserRole
from app.models.historique_issue import HistoriqueIssue
from app.models.issue import Issue
from app.models.organisation import Organisation
from app.models.plan import Plan
from app.models.utilisateur import Utilisateur


@pytest.fixture()
def ctx():
    engine = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(
        engine,
        tables=[Plan.__table__, Organisation.__table__, Agence.__table__, Utilisateur.__table__, Issue.__table__, ActionCorrective.__table__, HistoriqueIssue.__table__],
    )
    Session = sessionmaker(bind=engine)
    db = Session()

    org = Organisation(id=uuid4(), nom="Org Test", active=True)
    db.add(org)
    db.flush()

    agence = Agence(id=uuid4(), organisation_id=org.id, nom="Agence Test", active=True)
    db.add(agence)
    db.flush()

    cx = Utilisateur(id=uuid4(), organisation_id=org.id, nom="N", prenom="CX", email="cx@test.bf",
                      mot_de_passe_hash="x", role=UserRole.CX_MANAGER, active=True)
    db.add(cx)
    db.commit()

    org_id, agence_id, cx_id = org.id, agence.id, cx.id
    db.close()

    def _db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app = FastAPI()
    app.include_router(issues.router, prefix="/issues")
    app.dependency_overrides[get_db] = _db

    def client_pour(role, user_id, organisation_id, agence_id=None):
        user = SimpleNamespace(
            id=user_id, role=role, active=True, agence_id=agence_id, organisation_id=organisation_id,
            nom="Test", prenom="Utilisateur",
        )
        app.dependency_overrides[get_current_active_user] = lambda: user
        return TestClient(app)

    return SimpleNamespace(Session=Session, client_pour=client_pour, org=org_id, agence=agence_id, cx=cx_id)


def test_action_creee_sur_issue_verifiee_repasse_par_reouverte(ctx):
    db = ctx.Session()
    issue = Issue(
        id=uuid4(),
        organisation_id=ctx.org,
        agence_id=ctx.agence,
        titre="Attente trop longue au guichet",
        statut="verifiee",
        severite=CriticiteType.ELEVEE,
        date_resolution=None,
        date_verification=None,
    )
    # date_verification est fixée séparément (colonne server_default absente sur SQLite ici) —
    # simule l'état réel d'une Issue déjà vérifiée.
    from datetime import datetime, timezone
    issue.date_resolution = datetime.now(timezone.utc)
    issue.date_verification = datetime.now(timezone.utc)
    db.add(issue)
    db.commit()
    issue_id = issue.id
    db.close()

    client = ctx.client_pour(UserRole.CX_MANAGER, ctx.cx, ctx.org)
    r = client.post(f"/issues/{issue_id}/actions", json={"titre": "Ajouter un second guichet"})
    assert r.status_code == 201, r.text

    db = ctx.Session()
    issue_apres = db.query(Issue).filter(Issue.id == issue_id).first()
    assert issue_apres.statut == "action_en_cours"
    assert issue_apres.date_verification is None

    evenements = (
        db.query(HistoriqueIssue)
        .filter(HistoriqueIssue.issue_id == issue_id)
        .order_by(HistoriqueIssue.date_evenement.asc(), HistoriqueIssue.id.asc())
        .all()
    )
    types_et_statuts = [(e.type_evenement, e.ancien_statut, e.nouveau_statut) for e in evenements]
    assert ("action_creee", "verifiee", "reouverte") in types_et_statuts
    assert ("action_creee", "reouverte", "action_en_cours") in types_et_statuts
    db.close()


def test_action_creee_sur_issue_resolue_reste_inchangee(ctx):
    """Non-régression : une Issue 'resolue' (mais pas 'verifiee') repasse directement à
    'action_en_cours', comportement déjà correct avant ce correctif."""
    db = ctx.Session()
    issue = Issue(
        id=uuid4(),
        organisation_id=ctx.org,
        agence_id=ctx.agence,
        titre="Probleme recurrent",
        statut="resolue",
        severite=CriticiteType.MOYENNE,
    )
    from datetime import datetime, timezone
    issue.date_resolution = datetime.now(timezone.utc)
    db.add(issue)
    db.commit()
    issue_id = issue.id
    db.close()

    client = ctx.client_pour(UserRole.CX_MANAGER, ctx.cx, ctx.org)
    r = client.post(f"/issues/{issue_id}/actions", json={"titre": "Nouvelle action"})
    assert r.status_code == 201, r.text

    db = ctx.Session()
    issue_apres = db.query(Issue).filter(Issue.id == issue_id).first()
    assert issue_apres.statut == "action_en_cours"
    assert issue_apres.date_verification is None  # n'a jamais été définie ici
    db.close()
