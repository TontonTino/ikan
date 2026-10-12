"""Filtrage serveur des thèmes avant le calcul du total et la pagination."""
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import get_feedback_viewer_user, get_db
from app.api.v1.endpoints import feedbacks
from app.db.session import Base
from app.models.agence import Agence
from app.models.analyse_ia import AnalyseIA
from app.models.categorie import Categorie
from app.models.demande_contact import DemandeContact
from app.models.enums import CriticiteType, SentimentType, UserRole
from app.models.feedback import Feedback
from app.models.historique_feedback import HistoriqueFeedback
from app.models.organisation import Organisation
from app.models.qr_code import QRCode
from app.models.reponse_client import ReponseClient
from app.models.recommandation import Recommandation
from app.models.suggestion import Suggestion
from app.models.utilisateur import Utilisateur


def test_theme_filtre_avant_pagination_et_catalogue_complet_par_organisation():
    engine = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine, tables=[
        Organisation.__table__, Agence.__table__, Utilisateur.__table__, QRCode.__table__,
        Categorie.__table__, Feedback.__table__, AnalyseIA.__table__, Recommandation.__table__,
        DemandeContact.__table__, Suggestion.__table__, HistoriqueFeedback.__table__, ReponseClient.__table__,
    ])
    db = sessionmaker(bind=engine)()
    org = Organisation(id=uuid4(), nom="org", active=True)
    db.add(org)
    db.flush()
    agence = Agence(id=uuid4(), organisation_id=org.id, nom="agence", active=True)
    db.add(agence)
    db.flush()
    qr = QRCode(id=uuid4(), agence_id=agence.id, code="q", url="https://example.invalid", actif=True)
    db.add(qr)
    db.flush()
    user = Utilisateur(id=uuid4(), organisation_id=org.id, agence_id=None, nom="N", prenom="P", email="test@example.invalid", mot_de_passe_hash="unused", role=UserRole.CX_MANAGER, active=True)
    db.add(user)

    autre_org = Organisation(id=uuid4(), nom="autre org", active=True)
    db.add(autre_org)
    db.flush()
    autre_agence = Agence(id=uuid4(), organisation_id=autre_org.id, nom="autre agence", active=True)
    db.add(autre_agence)
    db.flush()
    autre_qr = QRCode(id=uuid4(), agence_id=autre_agence.id, code="autre-q", url="https://example.invalid", actif=True)
    db.add(autre_qr)
    autre_user = Utilisateur(id=uuid4(), organisation_id=autre_org.id, agence_id=None, nom="N2", prenom="P2", email="autre@example.invalid", mot_de_passe_hash="unused", role=UserRole.CX_MANAGER, active=True)
    db.add_all([autre_qr, autre_user])

    now = datetime.now(timezone.utc)
    oldest = None
    for index in range(61):
        feedback = Feedback(id=uuid4(), qr_code_id=qr.id, note=4, statut_traitement="nouveau", date_soumission=now - timedelta(minutes=index))
        db.add(feedback)
        db.flush()
        if index == 60:
            oldest = feedback
            analysis = AnalyseIA(feedback_id=feedback.id, sentiment=SentimentType.POSITIF, criticite=CriticiteType.FAIBLE, theme_principal="qualite_produit")
            db.add(analysis)
        elif index == 0:
            db.add(AnalyseIA(feedback_id=feedback.id, sentiment=SentimentType.POSITIF, criticite=CriticiteType.FAIBLE, theme_principal="accueil"))
    feedback_autre_org = Feedback(id=uuid4(), qr_code_id=autre_qr.id, note=4, statut_traitement="nouveau", date_soumission=now)
    db.add(feedback_autre_org)
    db.flush()
    db.add(AnalyseIA(feedback_id=feedback_autre_org.id, sentiment=SentimentType.POSITIF, criticite=CriticiteType.FAIBLE, theme_principal="facturation"))
    db.commit()

    actor = {"user": user}
    app = FastAPI()
    app.include_router(feedbacks.router, prefix="/feedbacks")

    def _db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_feedback_viewer_user] = lambda: actor["user"]
    client = TestClient(app)

    params = {"theme": "qualite_produit", "limit": 50, "offset": 0}
    response = client.get("/feedbacks/", params=params)
    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [str(oldest.id)]
    assert response.headers["x-total-count"] == "1"
    assert "qualite_produit" in client.get("/feedbacks/themes").json()
    assert "non_categorise" in client.get("/feedbacks/themes").json()
    assert "facturation" not in client.get("/feedbacks/themes").json()
    assert client.get("/feedbacks/", params={**params, "theme": "theme_inconnu"}).json() == []
    assert client.get("/feedbacks/", params={**params, "offset": 1}).json() == []
    assert client.get("/feedbacks/", params={**params, "theme": "facturation", "agence_id": str(autre_agence.id)}).json() == []
    date_response = client.get("/feedbacks/", params={**params, "date_debut": (now - timedelta(minutes=30)).isoformat()})
    assert date_response.json() == []
    assert date_response.headers["x-total-count"] == "0"
    uncategorised_response = client.get("/feedbacks/", params={**params, "theme": "non_categorise"})
    assert len(uncategorised_response.json()) == 50
    assert uncategorised_response.headers["x-total-count"] == "59"

    actor["user"] = autre_user
    assert "facturation" in client.get("/feedbacks/themes").json()
    assert "qualite_produit" not in client.get("/feedbacks/themes").json()
    assert "non_categorise" not in client.get("/feedbacks/themes").json()
    assert client.get("/feedbacks/", params=params).json() == []

    db.close()
    engine.dispose()
