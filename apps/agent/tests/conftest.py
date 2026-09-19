"""
Fixtures des tests d'isolation multi-organisation.

Ces tests tournent sur une VRAIE base PostgreSQL de test (jamais la prod) :
  TEST_DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/ikanai_test pytest

Garde-fous : la base doit être sur localhost/127.0.0.1 ET son nom doit
contenir « test » — sinon la session de tests est refusée. Le schéma `public`
de cette base est entièrement recréé au début de la session (DROP SCHEMA
CASCADE) : ne JAMAIS la faire pointer vers une base qui contient des données.

Le LLM (Groq) et WhatsApp sont remplacés par des faux : ces tests vérifient
l'isolation des DONNÉES, pas la qualité de rédaction. Le faux LLM enregistre
tout ce qui lui est envoyé, ce qui permet de prouver qu'aucune donnée d'une
autre organisation n'atteint jamais le prompt.
"""
from __future__ import annotations

import os
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from urllib.parse import urlparse

import pytest

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "")

if not TEST_DATABASE_URL:
    pytest.skip(
        "TEST_DATABASE_URL non défini — tests d'isolation ignorés (base Postgres de test requise)",
        allow_module_level=True,
    )

_parsed = urlparse(TEST_DATABASE_URL)
if _parsed.hostname not in {"localhost", "127.0.0.1"} or "test" not in (_parsed.path or "").lower():
    raise RuntimeError(
        "TEST_DATABASE_URL refusée : la base de test doit être locale (localhost/127.0.0.1) "
        "et son nom doit contenir « test »."
    )

# Doit être fait AVANT tout import de app.* (settings lus à l'import).
os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ["SECRET_KEY"] = "test-secret-key-for-isolation-tests-only-0123456789"
os.environ["ALGORITHM"] = "HS256"
os.environ["WEBHOOK_SECRET"] = "test-webhook-secret"
os.environ["GROQ_API_KEY"] = "test-key-never-used-llm-is-faked"

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from jose import jwt  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.db import session as db_session  # noqa: E402
from app.main import app  # noqa: E402
from app.models import action_agent as _aa, conversation as _conv  # noqa: E402,F401
from app.models.action_agent import ActionAgent  # noqa: E402
from app.models.conversation import Conversation, ConversationTurn  # noqa: E402
from app.models.enums import (  # noqa: E402
    CriticiteType, SentimentType, StatutActionAgent, TypeActionAgent, UserRole,
)
from app.models.readonly import (  # noqa: E402
    Agence, AnalyseIA, DemandeContact, Feedback, Organisation, QRCode, ReadOnlyBase, Utilisateur,
)
from app.providers import llm_provider, whatsapp_provider  # noqa: E402

_AGENT_DIR = os.path.join(os.path.dirname(__file__), "..")


# --------------------------------------------------------------------------- schéma

@pytest.fixture(scope="session", autouse=True)
def schema():
    engine = db_session.engine
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    # Tables du backend principal (normalement créées par apps/api)…
    ReadOnlyBase.metadata.create_all(engine)
    # …puis les tables propres à l'agent, via les VRAIES migrations Alembic.
    cfg = Config(os.path.join(_AGENT_DIR, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(_AGENT_DIR, "alembic"))
    command.upgrade(cfg, "head")
    yield


@pytest.fixture()
def db(schema):
    session = db_session.SessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


# --------------------------------------------------------------------------- données

def _mk_user(db, org, role, prenom, agence=None):
    user = Utilisateur(
        id=uuid.uuid4(), organisation_id=org.id, agence_id=agence.id if agence else None,
        nom="Test", prenom=prenom, email=f"{prenom.lower()}-{uuid.uuid4().hex[:6]}@test.local",
        mot_de_passe_hash="x", role=role, active=True,
    )
    db.add(user)
    return user


def _mk_feedbacks(db, agence, tag, theme, specs):
    """specs : liste de (jours_avant, note, criticite, sentiment, score, discordance)."""
    qr = QRCode(id=uuid.uuid4(), agence_id=agence.id, code=f"QR-{tag}-{uuid.uuid4().hex[:6]}",
                url=f"https://x.test/{tag}", actif=True)
    db.add(qr)
    db.flush()
    feedbacks = []
    now = datetime.now(timezone.utc)
    for i, (jours, note, crit, sent, score, disc) in enumerate(specs):
        fb = Feedback(
            id=uuid.uuid4(), qr_code_id=qr.id, note=note,
            commentaire=f"{tag.upper()}-SECRET-{i} problème {theme}",
            date_soumission=now - timedelta(days=jours, hours=1),
        )
        db.add(fb)
        db.flush()
        db.add(AnalyseIA(
            id=uuid.uuid4(), feedback_id=fb.id, sentiment=sent, criticite=crit,
            theme_principal=theme, discordance_detectee=disc, score_sentiment=score,
        ))
        db.add(DemandeContact(
            id=uuid.uuid4(), feedback_id=fb.id, nom=f"Client {tag}", telephone=f"+22670{i:06d}",
            souhaite_etre_rappele=True, traitee=False,
        ))
        feedbacks.append(fb)
    db.flush()
    return feedbacks


_SPECS = [
    (1, 1, CriticiteType.CRITIQUE, SentimentType.NEGATIF, 0.05, False),
    (1, 2, CriticiteType.ELEVEE, SentimentType.NEGATIF, 0.15, True),
    (2, 1, CriticiteType.CRITIQUE, SentimentType.NEGATIF, 0.10, False),
    (2, 5, CriticiteType.FAIBLE, SentimentType.POSITIF, 0.90, False),
    (3, 3, CriticiteType.MOYENNE, SentimentType.NEUTRE, 0.50, False),
    (3, 2, CriticiteType.ELEVEE, SentimentType.NEGATIF, 0.20, False),
    (9, 4, CriticiteType.FAIBLE, SentimentType.POSITIF, 0.80, False),
    (10, 5, CriticiteType.FAIBLE, SentimentType.POSITIF, 0.85, False),
    (11, 4, CriticiteType.FAIBLE, SentimentType.POSITIF, 0.80, False),
]


def _build_org(db, tag, nom):
    org = Organisation(id=uuid.uuid4(), nom=nom, active=True)
    db.add(org)
    db.flush()
    ag1 = Agence(id=uuid.uuid4(), organisation_id=org.id, nom=f"Agence {tag.upper()}-Centre",
                 active=True, seuil_alerte=2.5)
    ag2 = Agence(id=uuid.uuid4(), organisation_id=org.id, nom=f"Agence {tag.upper()}-Nord",
                 active=True, seuil_alerte=2.5)
    db.add_all([ag1, ag2])
    db.flush()
    fb1 = _mk_feedbacks(db, ag1, tag, f"reseau_{tag}", _SPECS)
    fb2 = _mk_feedbacks(db, ag2, tag, f"accueil_{tag}", _SPECS[:6])
    cx = _mk_user(db, org, UserRole.CX_MANAGER, f"Cx{tag}")
    cx2 = _mk_user(db, org, UserRole.CX_MANAGER, f"CxBis{tag}")
    admin = _mk_user(db, org, UserRole.ADMIN, f"Admin{tag}")
    # Agency Manager rattaché à l'agence « Centre » (ag1), et un autre sans agence rattachée
    am = _mk_user(db, org, UserRole.AGENCY_MANAGER, f"Am{tag}", agence=ag1)
    am_sans_agence = _mk_user(db, org, UserRole.AGENCY_MANAGER, f"AmSans{tag}")
    db.flush()

    # Brouillons préexistants rattachés à un feedback de l'organisation
    actions = []
    for fb in (fb1[0], fb1[1], fb2[0]):
        a = ActionAgent(
            id=uuid.uuid4(), feedback_id=fb.id, type_action=TypeActionAgent.REPONSE_CLIENT,
            contenu_genere=f"BROUILLON-{tag.upper()}-SECRET pour {fb.id}",
            statut=StatutActionAgent.EN_ATTENTE,
        )
        db.add(a)
        actions.append(a)

    # Conversation existante du CX, avec un tour contenant du contenu « secret »
    conv = Conversation(
        id=uuid.uuid4(), utilisateur_id=cx.id, agence_id=ag1.id,
        contexte_actif={"agence_nom": ag1.nom, "intention_precedente": "alertes_critiques",
                        "sujet_actif": f"reseau_{tag}"},
    )
    db.add(conv)
    db.flush()
    db.add(ConversationTurn(
        id=uuid.uuid4(), conversation_id=conv.id, tour_numero=1,
        question=f"Question secrète {tag.upper()}", intention="alertes_critiques",
        reponse=f"Réponse historique {tag.upper()}-SECRET-HISTORIQUE", donnees_resumees=None,
    ))
    db.commit()
    return SimpleNamespace(
        tag=tag, org=org, agences=[ag1, ag2], feedbacks=fb1 + fb2, fb_centre=fb1, fb_nord=fb2,
        cx=cx, cx2=cx2, admin=admin, am=am, am_sans_agence=am_sans_agence,
        actions=actions, conversation=conv,
    )


@pytest.fixture()
def orgs(schema):
    """Deux organisations factices aux données distinctes ; base remise à zéro à chaque test."""
    with db_session.engine.begin() as conn:
        conn.execute(text(
            "TRUNCATE conversation_turns, conversations, actions_agent, demandes_contact, analyses_ia, "
            "feedbacks, qr_codes, utilisateurs, agences, organisations CASCADE"
        ))
    session = db_session.SessionLocal(expire_on_commit=False)
    try:
        a = _build_org(session, "alpha", "Opérateur Alpha")
        b = _build_org(session, "bravo", "Opérateur Bravo")
        session.expunge_all()  # objets détachés (ids conservés, plus de lien avec la session)
    finally:
        session.close()
    return SimpleNamespace(a=a, b=b)


# --------------------------------------------------------------------------- outils de test

def token_for(user) -> dict:
    tok = jwt.encode({"sub": str(user.id), "type": "access"}, os.environ["SECRET_KEY"], algorithm="HS256")
    return {"Authorization": f"Bearer {tok}"}


class FakeLLM:
    """Remplace llm_provider.generate_text : renvoie le prompt reçu (donc les données) et l'enregistre."""

    def __init__(self):
        self.calls: list[dict] = []

    def __call__(self, system_prompt, user_prompt, *, messages_history=None, max_tokens=400):
        self.calls.append({
            "system": system_prompt, "user": user_prompt,
            "messages": messages_history, "max_tokens": max_tokens,
        })
        return f"[FAKE-LLM] {user_prompt}"

    def everything_sent(self) -> str:
        """Tout le texte transmis au LLM, tous appels confondus (historique de messages inclus)."""
        parts = []
        for c in self.calls:
            parts += [c["system"], c["user"]]
            for m in c["messages"] or []:
                parts.append(m["content"])
        return "\n".join(parts)


@pytest.fixture()
def fake_llm(monkeypatch):
    fake = FakeLLM()
    monkeypatch.setattr(llm_provider, "generate_text", fake)
    return fake


@pytest.fixture()
def whatsapp_sent(monkeypatch):
    sent = []

    def _fake(**kwargs):
        sent.append(kwargs)
        return {"messages": [{"id": "wamid.FAKE"}]}

    monkeypatch.setattr(whatsapp_provider, "envoyer_message_template", _fake)
    return sent


@pytest.fixture()
def client(schema):
    return TestClient(app)
