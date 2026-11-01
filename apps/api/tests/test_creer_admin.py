"""
scripts/creer_admin.py — création explicite du premier administrateur (ou d'un administrateur supplémentaire).

SÉCURITÉ DES TESTS : tout tourne sur SQLite en mémoire. La fixture `memoire` remplace le moteur et la session des modules concernés
et vérifie qu'ils pointent bien sur SQLite avant chaque test : la base réelle n'est jamais ouverte.
"""
import importlib.util
import logging
import os
import sys
import uuid
from types import SimpleNamespace

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-creer-admin-0123456789")
RACINE_API = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RACINE_API)
sys.path.insert(0, os.path.join(RACINE_API, "scripts"))

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import creer_admin
from app.api.v1.endpoints import auth
from app.core.security import get_password_hash
from app.db import session as session_module
from app.db.session import Base, get_db
from app.models.enums import UserRole
from app.models.organisation import Organisation
from app.models.plan import Plan
from app.models.utilisateur import Utilisateur
from app.services.plan_catalog import PLAN_GRATUIT_ID

MDP = "Mot-de-passe-solide-42"
EMAIL = "premier.admin@exemple.org"
CHEMIN_SCRIPT = os.path.join(RACINE_API, "scripts", "creer_admin.py")
CHEMIN_MAIN = os.path.join(RACINE_API, "app", "main.py")


@pytest.fixture()
def memoire(monkeypatch):
    moteur = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    for table in Base.metadata.sorted_tables:
        try:
            table.create(moteur, checkfirst=True)
        except Exception:  # noqa: BLE001 — tables propres à PostgreSQL
            pass
    fabrique = sessionmaker(bind=moteur)
    for module in (creer_admin, session_module):
        monkeypatch.setattr(module, "engine", moteur, raising=False)
        monkeypatch.setattr(module, "SessionLocal", fabrique, raising=False)
    assert moteur.url.get_backend_name() == "sqlite"                  # jamais la vraie base
    assert creer_admin.SessionLocal is fabrique
    db = fabrique()
    db.add(Plan(id=PLAN_GRATUIT_ID, code="gratuit", nom="Gratuit", ordre=0))
    db.commit()
    db.close()
    return SimpleNamespace(engine=moteur, Session=fabrique)


def photo(memoire):
    """Contenu complet de toutes les tables, pour comparer avant/après."""
    resultat = {}
    with memoire.engine.connect() as c:
        for table in Base.metadata.tables.values():
            try:
                resultat[table.name] = sorted(str(tuple(ligne)) for ligne in c.execute(select(table)))
            except Exception:  # noqa: BLE001 — table absente en SQLite
                continue
    return resultat


def saisies(*valeurs):
    suite = iter(valeurs)
    return lambda invite: next(suite)


def lancer(memoire, *arguments, mdp=MDP, confirmation=None, interactif=True):
    return creer_admin.main(list(arguments), saisir=saisies(mdp, mdp if confirmation is None else confirmation), interactif=interactif)


def ajouter_utilisateur(memoire, email, role=UserRole.ADMIN, org_nom="Org existante"):
    db = memoire.Session()
    org = db.query(Organisation).filter(Organisation.nom == org_nom).first()
    if org is None:
        org = Organisation(id=uuid.uuid4(), nom=org_nom, active=True)
        db.add(org); db.flush()
    db.add(Utilisateur(id=uuid.uuid4(), organisation_id=org.id, nom="N", prenom="P", email=email, role=role,
                       mot_de_passe_hash=get_password_hash("Un-autre-mot-de-passe-1"), active=True))
    db.commit()
    db.close()


def utilisateurs(memoire):
    db = memoire.Session()
    try:
        return db.query(Utilisateur).all()
    finally:
        db.close()


# ── Création réussie ───────────────────────────────────────────────────────────────────────────


def test_creation_reussie_compte_admin_hache_et_une_seule_ecriture_utile(memoire, capsys, caplog):
    caplog.set_level(logging.DEBUG)
    avant = photo(memoire)
    assert lancer(memoire, "--email", EMAIL) == 0
    sortie = capsys.readouterr()
    assert sortie.out.strip() == f"Compte administrateur créé : {EMAIL}" and sortie.err == ""
    comptes = utilisateurs(memoire)
    assert len(comptes) == 1 and comptes[0].role == UserRole.ADMIN and comptes[0].active and comptes[0].email == EMAIL
    assert comptes[0].mot_de_passe_hash != MDP and comptes[0].mot_de_passe_hash.startswith("$argon2")
    apres = photo(memoire)
    changees = {t for t in avant if avant[t] != apres[t]}
    assert changees == {"utilisateurs", "organisations", "journal_audit"}                  # rien d'autre n'est touché
    assert len(apres["utilisateurs"]) == 1 and len(apres["organisations"]) == 1
    db = memoire.Session()
    assert db.query(Organisation).one().nom == creer_admin.NOM_ORGANISATION_PLATEFORME
    db.close()
    for texte in (sortie.out, sortie.err, caplog.text):
        assert MDP not in texte and comptes[0].mot_de_passe_hash not in texte and "$argon2" not in texte


def test_le_compte_cree_se_connecte_par_la_vraie_route_de_connexion(memoire):
    assert lancer(memoire, "--email", f"  {EMAIL.upper()}  ") == 0
    app = FastAPI()
    app.include_router(auth.router, prefix="/auth")

    def base():
        db = memoire.Session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = base
    client = TestClient(app)
    ok = client.post("/auth/login", json={"email": EMAIL, "password": MDP})
    assert ok.status_code == 200 and ok.json()["user"]["role"] == "admin"
    assert client.post("/auth/login", json={"email": "PREMIER.Admin@Exemple.org", "password": MDP}).status_code == 200
    assert client.post("/auth/login", json={"email": EMAIL, "password": "mauvais-mot-de-passe"}).status_code == 401
    jeton = ok.json()["access_token"]
    me = client.get("/auth/me", headers={"Authorization": f"Bearer {jeton}"})
    assert me.status_code == 200 and me.json()["role"] == "admin"


def test_email_normalise(memoire):
    assert lancer(memoire, "--email", "  NOUVEL.Admin@Exemple.ORG ") == 0
    assert [u.email for u in utilisateurs(memoire)] == ["nouvel.admin@exemple.org"]


# ── Gardes ─────────────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("deja", ["premier.admin@exemple.org", "Premier.Admin@Exemple.ORG"])
def test_email_deja_pris_refuse_meme_avec_une_casse_differente_sans_modifier_le_compte(memoire, capsys, deja):
    ajouter_utilisateur(memoire, deja, role=UserRole.CX_MANAGER)
    avant = photo(memoire)
    assert lancer(memoire, "--email", EMAIL, "--ajouter") == 1
    assert "déjà cette adresse" in capsys.readouterr().err
    assert photo(memoire) == avant


def test_admin_existant_refuse_sans_ajouter(memoire, capsys):
    ajouter_utilisateur(memoire, "ancien.admin@exemple.org")
    avant = photo(memoire)
    assert lancer(memoire, "--email", EMAIL) == 1
    erreur = capsys.readouterr().err
    assert "--ajouter" in erreur and MDP not in erreur
    assert photo(memoire) == avant


def test_admin_existant_accepte_avec_ajouter_dans_la_meme_organisation(memoire):
    ajouter_utilisateur(memoire, "ancien.admin@exemple.org")
    avant = photo(memoire)
    assert lancer(memoire, "--email", EMAIL, "--ajouter") == 0
    apres = photo(memoire)
    assert {t for t in avant if avant[t] != apres[t]} == {"utilisateurs", "journal_audit"}   # aucune organisation créée
    assert len(apres["utilisateurs"]) == 2 and apres["organisations"] == avant["organisations"]
    assert sorted(u.email for u in utilisateurs(memoire)) == ["ancien.admin@exemple.org", EMAIL]


def test_un_cx_manager_existant_n_est_pas_un_administrateur(memoire):
    ajouter_utilisateur(memoire, "cx@exemple.org", role=UserRole.CX_MANAGER)
    assert lancer(memoire, "--email", EMAIL) == 0                         # pas d'administrateur : accepté sans --ajouter


def test_organisation_plateforme_reutilisee_si_elle_existe_deja(memoire):
    ajouter_utilisateur(memoire, "cx@exemple.org", role=UserRole.CX_MANAGER, org_nom=creer_admin.NOM_ORGANISATION_PLATEFORME)
    assert lancer(memoire, "--email", EMAIL) == 0
    db = memoire.Session()
    assert db.query(Organisation).count() == 1
    db.close()


def test_deux_saisies_differentes_refusees_sans_echo(memoire, capsys, caplog):
    avant = photo(memoire)
    assert lancer(memoire, "--email", EMAIL, mdp="Premiere-saisie-AAA-11", confirmation="Seconde-saisie-BBB-22") == 1
    sortie = capsys.readouterr()
    for texte in (sortie.out, sortie.err, caplog.text):
        assert "Premiere-saisie" not in texte and "Seconde-saisie" not in texte
    assert "différentes" in sortie.err
    assert photo(memoire) == avant


@pytest.mark.parametrize("faible,attendu", [
    ("        ", "au moins 8 caractères"),           # 8 espaces
    ("court", "au moins 8 caractères"),
    ("  abc  ", "au moins 8 caractères"),
    (EMAIL, "identique à l'adresse e-mail"),
    (EMAIL.upper(), "identique à l'adresse e-mail"),
])
def test_mot_de_passe_faible_refuse_sans_echo(memoire, capsys, caplog, faible, attendu):
    avant = photo(memoire)
    assert lancer(memoire, "--email", EMAIL, mdp=faible) == 1
    sortie = capsys.readouterr()
    assert attendu in sortie.err
    if faible.strip():
        assert faible.strip() not in sortie.err.replace(EMAIL, "").replace(EMAIL.upper(), "") or faible.strip() in (EMAIL, EMAIL.upper())
    assert photo(memoire) == avant


def test_adresse_email_invalide_refusee(memoire, capsys):
    avant = photo(memoire)
    assert lancer(memoire, "--email", "pas-une-adresse") == 1
    assert "invalide" in capsys.readouterr().err
    assert photo(memoire) == avant


def test_execution_non_interactive_refusee(memoire, capsys):
    avant = photo(memoire)

    def ne_doit_pas_etre_appele(invite):
        raise AssertionError("le mot de passe ne doit pas être demandé hors terminal")

    assert creer_admin.main(["--email", EMAIL], saisir=ne_doit_pas_etre_appele, interactif=False) == 1
    assert "interactive" in capsys.readouterr().err
    # Sans paramètre explicite, le choix suit stdin : sous pytest ce n'est pas un terminal.
    assert creer_admin.main(["--email", EMAIL], saisir=ne_doit_pas_etre_appele) == 1
    assert photo(memoire) == avant


def test_le_mot_de_passe_n_est_pas_une_option_de_la_commande(memoire, capsys):
    with pytest.raises(SystemExit):
        creer_admin.main(["--email", EMAIL, "--password", MDP], saisir=saisies(MDP, MDP), interactif=True)
    capsys.readouterr()
    assert utilisateurs(memoire) == []


def test_erreur_technique_sans_trace_ni_mot_de_passe_ni_hachage(memoire, capsys, caplog, monkeypatch):
    caplog.set_level(logging.DEBUG)

    class Session:
        def __getattr__(self, nom):
            raise RuntimeError(f"détail technique contenant le secret {MDP} et $argon2id$v=19$m=65536")

        def close(self):
            pass

    monkeypatch.setattr(creer_admin, "SessionLocal", lambda: Session())
    assert lancer(memoire, "--email", EMAIL) == 1
    sortie = capsys.readouterr()
    for texte in (sortie.out, sortie.err, caplog.text):
        assert MDP not in texte and "$argon2" not in texte and "Traceback" not in texte
    assert "RuntimeError" in sortie.err


def test_echec_a_l_enregistrement_annule_tout_sans_fuite(memoire, capsys, monkeypatch):
    avant = photo(memoire)
    original = memoire.Session

    def fabrique():
        db = original()
        vrai_commit = db.commit

        def commit_en_echec():
            raise RuntimeError(f"INSERT ... parameters: ('{MDP}', '$argon2id$...')")

        db.commit = commit_en_echec
        return db

    monkeypatch.setattr(creer_admin, "SessionLocal", fabrique)
    assert lancer(memoire, "--email", EMAIL) == 1
    sortie = capsys.readouterr()
    assert MDP not in sortie.err and "$argon2" not in sortie.err and "erreur technique" in sortie.err
    assert photo(memoire) == avant


# ── Import et démarrage ────────────────────────────────────────────────────────────────────────


def test_importer_le_module_n_execute_rien(memoire, monkeypatch):
    appels = []
    monkeypatch.setattr(session_module, "SessionLocal", lambda: appels.append("session") or (_ for _ in ()).throw(AssertionError("ouverture de session")))
    spec = importlib.util.spec_from_file_location("creer_admin_copie", CHEMIN_SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)                                      # __name__ != "__main__" : rien ne s'exécute
    assert appels == [] and utilisateurs(memoire) == []


def test_le_demarrage_de_l_api_ne_reference_pas_la_commande():
    source = open(CHEMIN_MAIN, encoding="utf-8").read()
    assert "creer_admin" not in source


def test_la_commande_ne_depend_pas_de_app_env(memoire, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "APP_ENV", "production")
    assert lancer(memoire, "--email", EMAIL) == 0
