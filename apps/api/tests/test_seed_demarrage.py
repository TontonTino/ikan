"""
Le démarrage de l'API ne seede plus jamais ; le seed explicite (apps/api/seed.py) est protégé.

- le démarrage (app.main.on_startup) ne crée ni ne supprime d'utilisateurs, agences ou organisations ;
- le seed refuse hors développement (APP_ENV) quel que soit le paramètre, et refuse sur une base qui contient déjà des données
  sauf --confirmer-ecrasement ; ses messages ne contiennent jamais le mot de passe de démonstration.

SÉCURITÉ DES TESTS : tout tourne sur SQLite en mémoire. La fixture `memoire` remplace le moteur et la session de TOUS les
modules concernés et vérifie qu'ils pointent bien sur SQLite avant chaque test : la base réelle n'est jamais ouverte.
"""
import os
import sys
import uuid
from types import SimpleNamespace

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-seed-demarrage-0123456789")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.main as application
import app.services.ai.analyse_service as analyse_service
import seed
from app.core.config import settings
from app.core.security import get_password_hash
from app.db import session as session_module
from app.db.session import Base
from app.models.agence import Agence
from app.models.enums import UserRole
from app.models.organisation import Organisation
from app.models.plan import Plan
from app.models.qr_code import QRCode
from app.models.utilisateur import Utilisateur
from app.services.plan_catalog import PLAN_GRATUIT_ID

CHEMIN_MAIN = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app", "main.py")


@pytest.fixture()
def memoire(monkeypatch):
    moteur = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    for table in Base.metadata.sorted_tables:
        try:
            table.create(moteur, checkfirst=True)
        except Exception:  # noqa: BLE001 — tables propres à PostgreSQL
            pass
    fabrique = sessionmaker(bind=moteur)
    for module in (seed, application, session_module, analyse_service):
        monkeypatch.setattr(module, "engine", moteur, raising=False)
        monkeypatch.setattr(module, "SessionLocal", fabrique, raising=False)
    # Aucun scheduler réel, aucun envoi : le démarrage est appelé directement.
    monkeypatch.setattr(application, "scheduler", SimpleNamespace(running=False, add_job=lambda *a, **k: None, start=lambda: None, shutdown=lambda **k: None))
    # plan_service ouvre sa propre connexion (incompatible avec la connexion unique de SQLite en mémoire) : forfait connu.
    monkeypatch.setattr(analyse_service, "organisation_a_la_fonctionnalite", lambda *a, **k: True)
    monkeypatch.setattr(settings, "APP_ENV", "development")
    for module in (seed, application):
        assert module.engine.url.get_backend_name() == "sqlite"       # jamais la vraie base
    return SimpleNamespace(engine=moteur, Session=fabrique)


def peupler(memoire, emails=("existant@client.io", "autre@client.io"), avec_qr=False):
    db = memoire.Session()
    db.add(Plan(id=PLAN_GRATUIT_ID, code="gratuit", nom="Gratuit", ordre=0))
    db.flush()
    org = Organisation(id=uuid.uuid4(), nom="Client réel", active=True)
    db.add(org); db.flush()
    agence = Agence(id=uuid.uuid4(), organisation_id=org.id, nom="Agence réelle", ville="V", active=True, seuil_alerte=70)
    db.add(agence); db.flush()
    for email in emails:
        db.add(Utilisateur(id=uuid.uuid4(), organisation_id=org.id, nom="N", prenom="P", email=email, role=UserRole.CX_MANAGER,
                           mot_de_passe_hash=get_password_hash("Un-vrai-mot-de-passe-1"), active=True))
    if avec_qr:
        db.add(QRCode(id=uuid.uuid4(), agence_id=agence.id, code="QR-REEL", url="http://t/QR-REEL", actif=True))
    db.commit()
    db.close()


def compter(memoire):
    with memoire.engine.connect() as c:
        return {
            "utilisateurs": c.execute(select(func.count()).select_from(Utilisateur.__table__)).scalar(),
            "agences": c.execute(select(func.count()).select_from(Agence.__table__)).scalar(),
            "organisations": c.execute(select(func.count()).select_from(Organisation.__table__)).scalar(),
            "emails": sorted(r[0] for r in c.execute(select(Utilisateur.__table__.c.email))),
        }


# ── Le démarrage ne seede plus ─────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("environnement", ["development", "production"])
def test_demarrage_sur_base_vide_ne_cree_aucun_compte(memoire, monkeypatch, environnement):
    monkeypatch.setattr(settings, "APP_ENV", environnement)
    application.on_startup()
    assert compter(memoire) == {"utilisateurs": 0, "agences": 0, "organisations": 0, "emails": []}


@pytest.mark.parametrize("environnement", ["development", "production"])
def test_demarrage_sans_qr_code_mais_avec_utilisateurs_ne_supprime_rien(memoire, monkeypatch, environnement):
    peupler(memoire, avec_qr=False)                                  # utilisateurs, mais AUCUN QR code
    avant = compter(memoire)
    assert avant["utilisateurs"] == 2
    monkeypatch.setattr(settings, "APP_ENV", environnement)
    application.on_startup()
    assert compter(memoire) == avant


def test_le_code_de_demarrage_ne_reference_plus_le_seed():
    source = open(CHEMIN_MAIN, encoding="utf-8").read()
    assert "seed_database" not in source and "import seed" not in source and "from seed" not in source


# ── Le seed explicite est protégé ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize("environnement", ["production", "Production", " production ", "staging", "prod", ""])
@pytest.mark.parametrize("confirmation", [False, True])
def test_seed_refuse_hors_developpement_quel_que_soit_le_parametre(memoire, monkeypatch, environnement, confirmation):
    monkeypatch.setattr(settings, "APP_ENV", environnement)
    with pytest.raises(seed.SeedRefuse) as refus:
        seed.seed_database(confirmer_ecrasement=confirmation)
    assert "développement" in str(refus.value)
    assert compter(memoire)["utilisateurs"] == 0                       # base vide : rien n'a été créé


def test_seed_refuse_en_production_sur_une_base_remplie_et_ne_touche_a_rien(memoire, monkeypatch):
    peupler(memoire)
    avant = compter(memoire)
    monkeypatch.setattr(settings, "APP_ENV", "production")
    with pytest.raises(seed.SeedRefuse):
        seed.seed_database(confirmer_ecrasement=True)
    assert compter(memoire) == avant


def test_seed_refuse_si_des_utilisateurs_existent_sans_confirmation(memoire):
    peupler(memoire)
    avant = compter(memoire)
    with pytest.raises(seed.SeedRefuse) as refus:
        seed.seed_database()
    message = str(refus.value)
    assert "--confirmer-ecrasement" in message and "2 utilisateur(s)" in message
    assert compter(memoire) == avant


def test_seed_refuse_si_seules_des_organisations_existent(memoire):
    db = memoire.Session()
    db.add(Plan(id=PLAN_GRATUIT_ID, code="gratuit", nom="Gratuit", ordre=0)); db.flush()
    db.add(Organisation(id=uuid.uuid4(), nom="Client", active=True)); db.commit(); db.close()
    with pytest.raises(seed.SeedRefuse):
        seed.seed_database()
    assert compter(memoire)["organisations"] == 1


def test_seed_fonctionne_en_developpement_sur_base_vide(memoire, caplog, capsys):
    caplog.set_level("DEBUG")
    seed.seed_database()
    donnees = compter(memoire)
    assert donnees["utilisateurs"] == 4 and "admin@ikanai.app" in donnees["emails"]
    sortie = caplog.text + capsys.readouterr().out
    assert seed.MOT_DE_PASSE_DEMO not in sortie and "Password123" not in sortie    # jamais journalisé ni affiché


def test_seed_avec_confirmation_en_developpement_remplace_les_donnees(memoire):
    peupler(memoire)
    seed.seed_database(confirmer_ecrasement=True)
    donnees = compter(memoire)
    assert donnees["utilisateurs"] == 4
    assert "existant@client.io" not in donnees["emails"]


def test_les_messages_de_refus_ne_contiennent_ni_mot_de_passe_ni_donnee_sensible(memoire, monkeypatch):
    peupler(memoire)
    messages = []
    with pytest.raises(seed.SeedRefuse) as r1:
        seed.seed_database()
    messages.append(str(r1.value))
    monkeypatch.setattr(settings, "APP_ENV", "production")
    with pytest.raises(seed.SeedRefuse) as r2:
        seed.seed_database(confirmer_ecrasement=True)
    messages.append(str(r2.value))
    for message in messages:
        assert seed.MOT_DE_PASSE_DEMO not in message and "Password123" not in message
        assert "existant@client.io" not in message and "argon2" not in message and "postgresql" not in message


def test_ligne_de_commande_refus_code_1_et_message_sur_stderr(memoire, capsys, monkeypatch):
    peupler(memoire)
    assert seed.main([]) == 1
    erreur = capsys.readouterr().err
    assert "Seed refusé" in erreur and "Password123" not in erreur
    assert compter(memoire)["utilisateurs"] == 2
    monkeypatch.setattr(settings, "APP_ENV", "production")
    assert seed.main(["--confirmer-ecrasement"]) == 1
    assert compter(memoire)["utilisateurs"] == 2
