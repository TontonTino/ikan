"""Fixture partagée : vrai routeur, vrai JWT, SQLite en mémoire, 2 organisations (A, B), 2 agences dans A (A1, A2)."""
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.endpoints import agences, alertes, dashboard, feedbacks, issues, recommandations
from app.core.journal_acces import installer_journal_acces
from app.core.security import create_access_token, get_password_hash
from app.db.session import Base, get_db
from app.models.agence import Agence
from app.models.analyse_ia import AnalyseIA
from app.models.demande_contact import DemandeContact
from app.models.enums import CriticiteType, PriorityLevel, SentimentType, UserRole
from app.models.feedback import Feedback
from app.models.historique_feedback import HistoriqueFeedback
from app.models.issue import Issue
from app.models.organisation import Organisation
from app.models.qr_code import QRCode
from app.models.recommandation import Recommandation
from app.models.utilisateur import Utilisateur

SECRET_A2 = "SECRET-AGENCE-A2-ne-doit-jamais-fuiter"
TEL_A2 = "0611111111"


def construire_contexte():
    engine = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    for table in Base.metadata.sorted_tables:
        try:
            table.create(engine, checkfirst=True)
        except Exception:  # noqa: BLE001 — tables propres à PostgreSQL
            pass
    Session = sessionmaker(bind=engine)

    def override_db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app = FastAPI()
    installer_journal_acces(app)
    for prefixe, module in [("/feedbacks", feedbacks), ("/dashboard", dashboard), ("/recommandations", recommandations),
                            ("/agences", agences), ("/issues", issues), ("/alertes", alertes)]:
        app.include_router(module.router, prefix=prefixe)
    app.dependency_overrides[get_db] = override_db

    db = Session()
    now = datetime.now(timezone.utc)
    org_a, org_b = (Organisation(id=uuid4(), nom=n, active=True) for n in ("Client A", "Client B"))
    db.add_all([org_a, org_b]); db.flush()
    a1 = Agence(id=uuid4(), organisation_id=org_a.id, nom="Agence A1", ville="Lyon", active=True, seuil_alerte=70)
    a2 = Agence(id=uuid4(), organisation_id=org_a.id, nom="Agence A2", ville="Lille", active=True, seuil_alerte=70)
    b1 = Agence(id=uuid4(), organisation_id=org_b.id, nom="Agence B1", ville="Paris", active=True, seuil_alerte=70)
    db.add_all([a1, a2, b1]); db.flush()
    qr = {c: QRCode(id=uuid4(), agence_id=ag.id, code=c, url=f"http://t/{c}", actif=True)
          for c, ag in [("QR-A1", a1), ("QR-A2", a2), ("QR-B1", b1)]}
    db.add_all(qr.values()); db.flush()

    def avis(code, commentaire, agence):
        fb = Feedback(id=uuid4(), qr_code_id=qr[code].id, note=1, commentaire=commentaire,
                      statut_traitement="nouveau", date_soumission=now)
        db.add(fb); db.flush()
        analyse = AnalyseIA(id=uuid4(), feedback_id=fb.id, sentiment=SentimentType.NEGATIF,
                            criticite=CriticiteType.CRITIQUE, score_sentiment=0.1, theme_principal="attente")
        db.add(analyse); db.flush()
        reco = Recommandation(id=uuid4(), analyse_ia_id=analyse.id, contenu=f"RECO-{agence.nom}", priorite=PriorityLevel.CRITICAL)
        db.add(reco)
        db.add(HistoriqueFeedback(id=uuid4(), feedback_id=fb.id, agence_id=agence.id, auteur_nom="Auteur", auteur_role="agency_manager",
                                  agence_nom=agence.nom, type_evenement="note_interne", details=f"EVT-{agence.nom}"))
        return fb, reco

    fb_a1, reco_a1 = avis("QR-A1", "avis A1", a1)
    fb_a2, reco_a2 = avis("QR-A2", SECRET_A2, a2)
    db.add(DemandeContact(id=uuid4(), feedback_id=fb_a2.id, nom="Client A2", telephone=TEL_A2, email="a2@example.com", souhaite_etre_rappele=True))

    def issue(agence):
        i = Issue(id=uuid4(), organisation_id=agence.organisation_id, agence_id=agence.id, titre=f"Issue {agence.nom}",
                  statut="ouverte", severite=CriticiteType.ELEVEE, necessite_action=True, premiere_detection=now)
        db.add(i)
        return i

    issue_a1, issue_a2 = issue(a1), issue(a2)

    def user(role, org, agence=None):
        u = Utilisateur(id=uuid4(), organisation_id=org.id, agence_id=agence.id if agence else None, nom="N", prenom="P",
                        email=f"{uuid4().hex[:10]}@test.io", mot_de_passe_hash=get_password_hash("Motdepasse-123"), role=role, active=True)
        db.add(u)
        return u

    users = dict(am_a1=user(UserRole.AGENCY_MANAGER, org_a, a1), am_a2=user(UserRole.AGENCY_MANAGER, org_a, a2),
                 am_b1=user(UserRole.AGENCY_MANAGER, org_b, b1))
    db.commit()
    ids = SimpleNamespace(**{k: v.id for k, v in dict(users, a1=a1, a2=a2, b1=b1, fb_a1=fb_a1, fb_a2=fb_a2, reco_a1=reco_a1,
                                                      reco_a2=reco_a2, issue_a1=issue_a1, issue_a2=issue_a2).items()})
    db.close()
    return SimpleNamespace(client=TestClient(app), Session=Session, app=app,
                           jeton=lambda uid: create_access_token(uid),
                           H=lambda uid: {"Authorization": f"Bearer {create_access_token(uid)}"}, **vars(ids))
