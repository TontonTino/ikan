"""
Jeu de données FIXE construit à la main pour les tests d'indicateurs (CX-01, AM-02) : chaque avis est écrit en clair avec son âge en
jours, sa note, son ton, sa gravité, son thème et sa discordance. Les valeurs attendues des tests sont calculées À LA MAIN à partir de
ce tableau (voir les commentaires), jamais recalculées par du code applicatif.

Vrai routeur, vrai JWT, SQLite en mémoire. Organisation A (agences A1 et A2 actives, A3 DÉSACTIVÉE), organisation B (agence B1),
organisation D (agence D1, avis SANS analyse). Les âges sont relatifs à « maintenant » mais jamais proches d'une frontière de période
(à plus de 12 h d'écart), donc stables quelle que soit l'heure du test.
"""
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.endpoints import dashboard, feedbacks
from app.core.security import create_access_token, get_password_hash
from app.db.session import Base, get_db
from app.models.agence import Agence
from app.models.analyse_ia import AnalyseIA
from app.models.demande_contact import DemandeContact
from app.models.enums import CriticiteType as C, SentimentType as S, UserRole
from app.models.feedback import Feedback
from app.models.organisation import Organisation
from app.models.qr_code import QRCode
from app.models.utilisateur import Utilisateur

POS, NEU, NEG = S.POSITIF, S.NEUTRE, S.NEGATIF
FAIBLE, MOYENNE, ELEVEE, CRITIQUE = C.FAIBLE, C.MOYENNE, C.ELEVEE, C.CRITIQUE


@dataclass(frozen=True)
class Avis:
    agence: str            # A1, A2, A3, B1, D1
    jours: float           # âge de l'avis en jours
    note: int
    sentiment: S | None = None      # None = avis SANS analyse
    gravite: C = FAIBLE
    theme: str = "attente"
    discordance: bool = False
    statut: str = "nouveau"
    texte: str = ""


# ── Organisation A ───────────────────────────────────────────────────────────────────────────
#  Période courante = 30 derniers jours ; précédente = jours 30 à 60.
AVIS = [
    # A1, période courante (6 avis)
    Avis("A1", 5,  5, POS, FAIBLE,   "accueil",  texte="a1-01"),
    Avis("A1", 10, 4, POS, FAIBLE,   "accueil",  statut="en_cours", texte="a1-02"),
    Avis("A1", 12, 3, NEU, MOYENNE,  "attente",  statut="resolu", texte="a1-03"),
    Avis("A1", 3,  2, NEG, CRITIQUE, "attente",  texte="a1-04"),
    Avis("A1", 20, 1, NEG, CRITIQUE, "facturation", texte="a1-05"),
    Avis("A1", 25, 5, NEG, ELEVEE,   "attente",  discordance=True, texte="a1-06"),            # 5 étoiles mais ton négatif
    # A2, période courante (2 avis)
    Avis("A2", 8,  4, POS, FAIBLE,   "accueil",  texte="a2-01"),
    Avis("A2", 29, 2, NEG, ELEVEE,   "attente",  texte="a2-02"),                              # 29 j : dans la période
    # A3 (agence DÉSACTIVÉE de A) : ne doit jamais compter
    Avis("A3", 5.5, 1, NEG, CRITIQUE, "attente", texte="a3-01"),
    # Période précédente (jours 30 à 60) : 4 avis
    Avis("A1", 31, 5, POS, FAIBLE,   "accueil",  texte="a1-p1"),                              # 31 j : période précédente
    Avis("A1", 40, 4, POS, FAIBLE,   "accueil",  texte="a1-p2"),
    Avis("A1", 50, 2, NEG, CRITIQUE, "attente",  texte="a1-p3"),
    Avis("A2", 45, 5, POS, FAIBLE,   "accueil",  texte="a2-p1"),
    # Hors des deux périodes (plus de 60 jours)
    Avis("A1", 70, 1, NEG, CRITIQUE, "attente",  texte="a1-ancien"),
    # Avis SANS analyse (ancien : hors des périodes de 7 à 90 jours et de leurs périodes précédentes) : sert à vérifier que « sans discordance » et « gravité non évaluée » le gardent
    Avis("A2", 200, 3, None, texte="a2-sans-analyse"),
    # Organisation B : ne doit JAMAIS apparaître chez A
    Avis("B1", 2,  1, NEG, CRITIQUE, "attente",  texte="b1-01"),
    Avis("B1", 4,  5, POS, FAIBLE,   "accueil",  texte="b1-02"),
    # Organisation D : avis SANS analyse (le ton se déduit alors de la note)
    Avis("D1", 3,  5, None, texte="d1-01"),
    Avis("D1", 6,  3, None, texte="d1-02"),
    Avis("D1", 9,  1, None, texte="d1-03"),
]

#  Valeurs attendues (calculées à la main) pour l'organisation A, jours = 30 :
#   courant  : A1 (a1-01…a1-06) + A2 (a2-01, a2-02)  -> 8 avis ; notes ≥ 4 : a1-01, a1-02, a1-06, a2-01 -> 4  => CSAT 50,0 %
#   précédent: a1-p1, a1-p2, a1-p3, a2-p1            -> 4 avis ; notes ≥ 4 : a1-p1, a1-p2, a2-p1 -> 3     => CSAT 75,0 %
#   critiques: courant a1-04, a1-05 = 2 ; précédent a1-p3 = 1
#   ton (analyses courantes) : positif a1-01, a1-02, a2-01 = 3 ; neutre a1-03 = 1 ; négatif a1-04, a1-05, a1-06, a2-02 = 4


def construire():
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
    app.include_router(dashboard.router, prefix="/dashboard")
    app.include_router(feedbacks.router, prefix="/feedbacks")
    app.dependency_overrides[get_db] = override_db

    db = Session()
    maintenant = datetime.now(timezone.utc)
    orgs = {k: Organisation(id=uuid4(), nom=f"Organisation {k}", active=True) for k in ("A", "B", "D")}
    db.add_all(orgs.values()); db.flush()
    agences = {
        "A1": Agence(id=uuid4(), organisation_id=orgs["A"].id, nom="Agence A1", ville="Lyon", active=True, seuil_alerte=70),
        "A2": Agence(id=uuid4(), organisation_id=orgs["A"].id, nom="Agence A2", ville="Lille", active=True, seuil_alerte=70),
        "A3": Agence(id=uuid4(), organisation_id=orgs["A"].id, nom="Agence A3 fermée", ville="Nîmes", active=False, seuil_alerte=70),
        "B1": Agence(id=uuid4(), organisation_id=orgs["B"].id, nom="Agence B1", ville="Paris", active=True, seuil_alerte=70),
        "D1": Agence(id=uuid4(), organisation_id=orgs["D"].id, nom="Agence D1", ville="Nice", active=True, seuil_alerte=70),
    }
    db.add_all(agences.values()); db.flush()
    qrs = {k: QRCode(id=uuid4(), agence_id=a.id, code=f"QR-{k}", url=f"http://t/{k}", actif=True) for k, a in agences.items()}
    db.add_all(qrs.values()); db.flush()

    ids_avis = {}
    for a in AVIS:
        fb = Feedback(id=uuid4(), qr_code_id=qrs[a.agence].id, note=a.note, commentaire=a.texte, statut_traitement=a.statut,
                      date_soumission=maintenant - timedelta(days=a.jours))
        db.add(fb); db.flush()
        ids_avis[a.texte] = fb.id
        if a.sentiment is not None:
            db.add(AnalyseIA(id=uuid4(), feedback_id=fb.id, sentiment=a.sentiment, criticite=a.gravite, score_sentiment=0.5,
                             theme_principal=a.theme, discordance_detectee=a.discordance))

    def user(role, org, agence=None):
        u = Utilisateur(id=uuid4(), organisation_id=orgs[org].id, agence_id=agences[agence].id if agence else None, nom="N", prenom="P",
                        email=f"{uuid4().hex[:10]}@test.io", mot_de_passe_hash=get_password_hash("Motdepasse-123"), role=role, active=True)
        db.add(u); db.flush()
        return u.id

    acteurs = dict(
        cx_a=user(UserRole.CX_MANAGER, "A"), cx_b=user(UserRole.CX_MANAGER, "B"), cx_d=user(UserRole.CX_MANAGER, "D"),
        am_a1=user(UserRole.AGENCY_MANAGER, "A", "A1"), am_a2=user(UserRole.AGENCY_MANAGER, "A", "A2"),
        am_b1=user(UserRole.AGENCY_MANAGER, "B", "B1"), admin=user(UserRole.ADMIN, "A"),
    )
    db.commit()
    ids = SimpleNamespace(**{f"ag_{k}": a.id for k, a in agences.items()}, **{f"org_{k}": o.id for k, o in orgs.items()}, **acteurs)
    db.close()
    return SimpleNamespace(client=TestClient(app), Session=Session, ids=ids, avis=ids_avis,
                           H=lambda uid: {"Authorization": f"Bearer {create_access_token(uid)}"}, maintenant=maintenant)
