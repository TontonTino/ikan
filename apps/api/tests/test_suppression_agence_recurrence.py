"""
DELETE /agences/{id} sur une agence dont une Issue racine est référencée par une occurrence
d'une AUTRE agence de la même organisation (issue_origine_id, FK NO ACTION différée).

Sans correction, le commit échoue en 23503 et l'API renvoie un 500 générique. Attendu :
un 409 explicite en français, et aucune suppression partielle (la transaction est annulée).

Test de bout en bout sur une vraie base Postgres JETABLE (TEST_DATABASE_URL) : il se skippe
sans cette variable. Ne touche JAMAIS à la base de apps/api/.env.
"""
import os
import uuid
from types import SimpleNamespace

import pytest

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-suppression-agence-tests-0123456789")

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "")

if not TEST_DATABASE_URL:
    pytest.skip(
        "TEST_DATABASE_URL non défini : test de suppression d'agence (récurrence) nécessite une base "
        "Postgres jetable.",
        allow_module_level=True,
    )

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, delete
from sqlalchemy.orm import sessionmaker

from app.api.deps import get_cx_or_admin
from app.db.session import get_db
from app.main import app
from app.models.agence import Agence
from app.models.enums import UserRole
from app.models.issue import Issue
from app.models.organisation import Organisation

_engine = create_engine(TEST_DATABASE_URL, pool_pre_ping=True)
_SessionTest = sessionmaker(bind=_engine)


def _override_get_db():
    db = _SessionTest()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture()
def donnees():
    """Org avec agences X (racine) et Y (occurrence), plus une agence Z sans lien (suppression libre)."""
    org, ag_x, ag_y, ag_z = uuid.uuid4(), uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    racine, occurrence = uuid.uuid4(), uuid.uuid4()
    tag = uuid.uuid4().hex[:8]
    db = _SessionTest()
    # secteur_activite explicite : la vraie base Postgres jetable a encore la contrainte
    # NOT NULL posée par la migration 002 (secteur_code, lui, a un server_default="autre"
    # depuis la migration 023 — pas besoin de le préciser ici, hors sujet pour ce test).
    db.add(Organisation(
        id=org, nom=f"org-del-{tag}", active=True, email_pro=f"del-{tag}@test.invalid",
        secteur_activite="Non renseigné",
    ))
    db.flush()
    db.add_all([
        Agence(id=ag_x, organisation_id=org, nom="X", active=True, seuil_alerte=1),
        Agence(id=ag_y, organisation_id=org, nom="Y", active=True, seuil_alerte=1),
        Agence(id=ag_z, organisation_id=org, nom="Z", active=True, seuil_alerte=1),
    ])
    db.flush()
    db.add(Issue(id=racine, organisation_id=org, agence_id=ag_x, titre="Racine", statut="resolue"))
    db.flush()
    db.add(Issue(id=occurrence, organisation_id=org, agence_id=ag_y, titre="Occurrence",
                 statut="ouverte", issue_origine_id=racine))
    db.commit()
    db.close()

    cx = SimpleNamespace(id=uuid.uuid4(), role=UserRole.CX_MANAGER, active=True,
                         agence_id=None, organisation_id=org)
    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_cx_or_admin] = lambda: cx
    try:
        yield SimpleNamespace(org=org, agence_x=ag_x, agence_z=ag_z, racine=racine, occurrence=occurrence)
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_cx_or_admin, None)
        nettoyage = _SessionTest()
        nettoyage.execute(delete(Issue).where(Issue.organisation_id == org))
        nettoyage.execute(delete(Agence).where(Agence.organisation_id == org))
        nettoyage.execute(delete(Organisation).where(Organisation.id == org))
        nettoyage.commit()
        nettoyage.close()


def _existe(model, obj_id) -> bool:
    db = _SessionTest()
    try:
        return db.get(model, obj_id) is not None
    finally:
        db.close()


def test_suppression_agence_dont_racine_est_referencee_renvoie_409_sans_suppression_partielle(donnees):
    client = TestClient(app, raise_server_exceptions=False)

    r = client.delete(f"/api/v1/agences/{donnees.agence_x}")

    assert r.status_code == 409, r.text
    detail = r.json()["detail"].lower()
    assert "occurrences" in detail and "autre agence" in detail
    # Aucune suppression partielle : agence, racine et occurrence sont toutes intactes.
    assert _existe(Agence, donnees.agence_x)
    assert _existe(Issue, donnees.racine)
    assert _existe(Issue, donnees.occurrence)


def test_suppression_agence_sans_lien_de_recurrence_reste_possible(donnees):
    client = TestClient(app, raise_server_exceptions=False)

    r = client.delete(f"/api/v1/agences/{donnees.agence_z}")

    assert r.status_code == 204, r.text
    assert not _existe(Agence, donnees.agence_z)
