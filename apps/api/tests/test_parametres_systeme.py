"""
Paramètres système (AD-05) : validation serveur stricte (bornes incluses/exclues, types, null, clés inconnues), aucun écho de la valeur
saisie, mise à jour partielle, valeurs historiques hors bornes ni corrigées ni supprimées (et jamais montrées au client), rôles,
journal d'audit (avant/après, aucun succès sur un refus 422).

Vrai routeur, vrai JWT, SQLite en mémoire (type vérifié) — aucune base réelle.
"""
import os
import uuid
from types import SimpleNamespace

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-parametres-systeme-0123456789")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.endpoints import feedbacks, qr_codes, system
from app.core.erreurs_validation import installer_erreurs_validation
from app.core.security import create_access_token, get_password_hash
from app.db.session import Base, get_db
from app.models.agence import Agence
from app.models.enums import UserRole
from app.models.journal_audit import JournalAudit
from app.models.organisation import Organisation
from app.models.plan import Plan
from app.models.qr_code import QRCode
from app.models.system_settings import RETENTION_MOIS_DEFAUT, SystemSettings
from app.models.utilisateur import Utilisateur
from app.services import journal_audit as journal
from app.services import parametres_systeme as limites

HACHAGE = get_password_hash("Motdepasse-123")
PLAN = uuid.uuid4()
URL = "/system/settings"
ENORME = 10 ** 30


@pytest.fixture(autouse=True)
def _ecriture_synchrone(monkeypatch):
    monkeypatch.setattr(journal, "EXECUTION_DIFFEREE", False)


@pytest.fixture()
def ctx():
    moteur = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    assert moteur.url.get_backend_name() == "sqlite"
    for table in Base.metadata.sorted_tables:
        try:
            table.create(moteur, checkfirst=True)
        except Exception:  # noqa: BLE001 — tables propres à PostgreSQL
            pass
    Session = sessionmaker(bind=moteur)

    def base():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app = FastAPI()
    app.include_router(system.router, prefix="/system")
    app.include_router(qr_codes.router, prefix="/qr-codes")
    installer_erreurs_validation(app)
    app.dependency_overrides[get_db] = base

    db = Session()
    db.add(Plan(id=PLAN, code="gratuit", nom="Gratuit"))
    org = Organisation(id=uuid.uuid4(), nom="Client X", active=True, plan_id=PLAN)
    db.add(org); db.flush()
    agence = Agence(id=uuid.uuid4(), organisation_id=org.id, nom="Agence X1", ville="Lyon", active=True)
    db.add(agence); db.flush()
    db.add(QRCode(id=uuid.uuid4(), agence_id=agence.id, code="QR-X1", url="http://t/x1", label="Borne", actif=True))

    def user(role, email, agence_id=None):
        u = Utilisateur(id=uuid.uuid4(), organisation_id=org.id, agence_id=agence_id, nom="N", prenom="P", email=email,
                        mot_de_passe_hash=HACHAGE, role=role, active=True, created_by_id=None)
        db.add(u); db.flush()
        return u.id

    ids = SimpleNamespace(admin=user(UserRole.ADMIN, "admin@test.io"), cx=user(UserRole.CX_MANAGER, "cx@test.io"),
                          am=user(UserRole.AGENCY_MANAGER, "am@test.io", agence.id))
    db.commit()
    db.close()
    return SimpleNamespace(client=TestClient(app), Session=Session, ids=ids, H=lambda uid: {"Authorization": f"Bearer {create_access_token(uid)}"})


def patch(ctx, corps, role="admin"):
    return ctx.client.patch(URL, headers=ctx.H(getattr(ctx.ids, role)), json=corps)


def lire(ctx):
    r = ctx.client.get(URL, headers=ctx.H(ctx.ids.admin))
    assert r.status_code == 200, r.text
    return r.json()


def poser_en_base(ctx, **valeurs):
    """Écrit des valeurs HISTORIQUES directement en base (contourne la validation, comme d'anciennes données)."""
    db = ctx.Session()
    ligne = db.query(SystemSettings).first() or SystemSettings()
    for cle, valeur in valeurs.items():
        setattr(ligne, cle, valeur)
    db.add(ligne); db.commit(); db.close()


def lignes_journal(ctx):
    db = ctx.Session()
    try:
        return list(db.scalars(select(JournalAudit).where(JournalAudit.action == journal.PARAMETRES_MODIFIES)))
    finally:
        db.close()


# ───────────────────────── bornes : limite incluse, juste en dessous, juste au-dessus ─────────────────────────

@pytest.mark.parametrize("valeur,code", [(1, 200), (120, 200), (24, 200), (0, 422), (121, 422), (-1, 422), (-5, 422), (ENORME, 422)])
def test_bornes_de_la_duree_de_conservation(ctx, valeur, code):
    r = patch(ctx, {"retention_mois": valeur})
    assert r.status_code == code, r.text
    assert lire(ctx)["retention_mois"] == (valeur if code == 200 else RETENTION_MOIS_DEFAUT)


@pytest.mark.parametrize("valeur,code", [(0, 200), (100, 200), (0.5, 200), (99.99, 200), (-0.01, 422), (100.01, 422), (-1, 422), (1e308, 422)])
def test_bornes_du_seuil_par_defaut(ctx, valeur, code):
    assert patch(ctx, {"seuil_alerte_defaut": valeur}).status_code == code


@pytest.mark.parametrize("valeur", [24.5, 24.0, "24", "vingt", "", True, False, None, [24], {"a": 1}, 1e30])
def test_types_invalides_pour_la_duree(ctx, valeur):
    assert patch(ctx, {"retention_mois": valeur}).status_code == 422


@pytest.mark.parametrize("valeur", ["80", "quatre-vingts", "", True, None, [80], {"a": 1}])
def test_types_invalides_pour_le_seuil(ctx, valeur):
    assert patch(ctx, {"seuil_alerte_defaut": valeur}).status_code == 422


@pytest.mark.parametrize("valeur,code", [("deterministique", 200), ("hybride", 200), ("Hybride", 422), ("gpt", 422), ("", 422), (1, 422), (None, 422), (True, 422)])
def test_mode_ia_liste_fermee(ctx, valeur, code):
    assert patch(ctx, {"mode_ia": valeur}).status_code == code


@pytest.mark.parametrize("valeur", ["oui", "non", "true", "false", "True", 1, 0, "1", None, [True]])
def test_booleen_strict_pour_les_notifications(ctx, valeur):
    assert patch(ctx, {"notifications_email_actives": valeur}).status_code == 422


@pytest.mark.parametrize("valeur", [True, False])
def test_booleen_vrai_ou_faux_accepte(ctx, valeur):
    assert patch(ctx, {"notifications_email_actives": valeur}).status_code == 200
    assert lire(ctx)["notifications_email_actives"] is valeur


@pytest.mark.parametrize("valeur,code", [("A", 200), ("A" * 255, 200), ("  Nom  ", 200), ("A" * 256, 422), ("", 422), ("   ", 422), (None, 422), (12, 422), (["x"], 422)])
def test_nom_de_l_application(ctx, valeur, code):
    r = patch(ctx, {"nom_application": valeur})
    assert r.status_code == code, r.text
    if code == 200:
        assert lire(ctx)["nom_application"] == valeur.strip()


@pytest.mark.parametrize("corps", [{"inconnu": 1}, {"retention_mois": 24, "role": "admin"}, {"id": str(uuid.uuid4())}, {"date_modification": "2020-01-01"}])
def test_cles_inconnues_refusees_et_rien_n_est_modifie(ctx, corps):
    avant = lire(ctx)
    r = patch(ctx, corps)
    assert r.status_code == 422
    assert lire(ctx) == avant


# ───────────────────────── aucun écho de la valeur saisie ─────────────────────────

@pytest.mark.parametrize("corps", [
    {"retention_mois": -987654},
    {"retention_mois": "VALEUR-PIEGE-123"},
    {"seuil_alerte_defaut": "VALEUR-PIEGE-123"},
    {"mode_ia": "VALEUR-PIEGE-123"},
    {"notifications_email_actives": "VALEUR-PIEGE-123"},
    {"nom_application": "A" * 300},
    {"CLE-PIEGE-123": "VALEUR-PIEGE-123"},
])
def test_aucun_echo_de_la_valeur_dans_l_erreur(ctx, corps):
    r = patch(ctx, corps)
    assert r.status_code == 422
    texte = r.text
    for piege in ("VALEUR-PIEGE-123", "987654", "CLE-PIEGE-123", "A" * 50):
        assert piege not in texte
    assert "input" not in r.json()["detail"][0] and "ctx" not in r.json()["detail"][0]


def test_messages_clairs_en_francais(ctx):
    for corps, extrait in (({"retention_mois": -5}, "de 1 à 120"), ({"seuil_alerte_defaut": 101}, "entre 0 et 100"),
                           ({"mode_ia": "x"}, "deterministique, hybride"), ({"notifications_email_actives": "oui"}, "vrai ou faux"),
                           ({"inconnu": 1}, "Paramètre inconnu")):
        msg = patch(ctx, corps).json()["detail"][0]["msg"]
        assert extrait in msg and not msg.startswith("Value error")


# ───────────────────────── mise à jour partielle ─────────────────────────

def test_modifier_un_parametre_ne_change_pas_les_autres(ctx):
    poser_en_base(ctx, nom_application="Nom d'origine", seuil_alerte_defaut=65.0, retention_mois=36, mode_ia="hybride", notifications_email_actives=False)
    avant = lire(ctx)
    assert patch(ctx, {"retention_mois": 12}).status_code == 200
    apres = lire(ctx)
    assert apres["retention_mois"] == 12
    for cle in ("nom_application", "seuil_alerte_defaut", "mode_ia", "notifications_email_actives", "id"):
        assert apres[cle] == avant[cle], cle


def test_un_refus_ne_modifie_aucun_autre_champ_meme_envoye_dans_la_meme_requete(ctx):
    avant = lire(ctx)
    assert patch(ctx, {"nom_application": "Nouveau nom", "retention_mois": -5}).status_code == 422
    assert lire(ctx) == avant


def test_requete_vide_acceptee_sans_changement(ctx):
    avant = lire(ctx)
    assert patch(ctx, {}).status_code == 200
    assert lire(ctx) == avant


# ───────────────────────── valeurs historiques hors bornes ─────────────────────────

def test_valeurs_historiques_hors_bornes_renvoyees_telles_quelles_et_signalees(ctx):
    poser_en_base(ctx, retention_mois=-5, seuil_alerte_defaut=250.0, mode_ia="ancien-mode")
    lu = lire(ctx)
    assert (lu["retention_mois"], lu["seuil_alerte_defaut"], lu["mode_ia"]) == (-5, 250.0, "ancien-mode")
    assert lu["valeurs_hors_bornes"] == ["retention_mois", "seuil_alerte_defaut", "mode_ia"]


def test_modifier_un_autre_champ_ne_corrige_pas_en_silence_une_valeur_hors_bornes(ctx):
    poser_en_base(ctx, retention_mois=-5)
    assert patch(ctx, {"nom_application": "Autre nom"}).status_code == 200
    lu = lire(ctx)
    assert lu["retention_mois"] == -5 and lu["valeurs_hors_bornes"] == ["retention_mois"]
    assert patch(ctx, {"retention_mois": 12}).status_code == 200            # seule une correction explicite la remplace
    assert lire(ctx)["valeurs_hors_bornes"] == []


def test_les_valeurs_dans_les_bornes_ne_sont_pas_signalees(ctx):
    assert lire(ctx)["valeurs_hors_bornes"] == []


# ───────────────────────── affichage client : jamais de durée aberrante ─────────────────────────

@pytest.mark.parametrize("stocke,affiche", [(24, 24), (1, 1), (120, 120), (18, 18), (-5, 24), (0, 24), (121, 24), (10 ** 9, 24)])
def test_duree_de_conservation_montree_au_client_final(ctx, stocke, affiche):
    poser_en_base(ctx, retention_mois=stocke)
    r = ctx.client.get("/qr-codes/QR-X1/validate")
    assert r.status_code == 200, r.text
    assert r.json()["retention_mois"] == affiche
    db = ctx.Session()
    try:
        assert feedbacks._retention_mois_configuree(db) == affiche                  # même règle pour la durée enregistrée avec la demande
        assert db.query(SystemSettings).first().retention_mois == stocke             # la lecture ne corrige ni n'écrit rien
    finally:
        db.close()


def test_sans_ligne_de_configuration_la_valeur_par_defaut_est_montree(ctx):
    assert ctx.client.get("/qr-codes/QR-X1/validate").json()["retention_mois"] == RETENTION_MOIS_DEFAUT


# ───────────────────────── rôles ─────────────────────────

def test_ecriture_reservee_a_l_administrateur(ctx):
    assert ctx.client.patch(URL, json={"retention_mois": 12}).status_code == 401
    for role in ("cx", "am"):
        assert patch(ctx, {"retention_mois": 12}, role).status_code == 403
        assert patch(ctx, {"retention_mois": -5}, role).status_code == 403          # le rôle est contrôlé AVANT la validation du corps
    assert lire(ctx)["retention_mois"] == RETENTION_MOIS_DEFAUT


def test_lecture_inchangee_pour_tout_utilisateur_connecte_et_refusee_en_anonyme(ctx):
    assert ctx.client.get(URL).status_code == 401
    for role in ("admin", "cx", "am"):
        assert ctx.client.get(URL, headers=ctx.H(getattr(ctx.ids, role))).status_code == 200


def test_la_reponse_garde_tous_ses_champs(ctx):
    lu = lire(ctx)
    for cle in ("id", "nom_application", "seuil_alerte_defaut", "retention_mois", "mode_ia", "notifications_email_actives", "date_modification"):
        assert cle in lu
    assert lu["bornes"]["retention_mois"] == {"min": limites.RETENTION_MOIS_MIN, "max": limites.RETENTION_MOIS_MAX}
    assert lu["bornes"]["seuil_alerte_defaut"] == {"min": 0, "max": 100}
    assert lu["bornes"]["mode_ia"]["valeurs"] == ["deterministique", "hybride"]


# ───────────────────────── journal d'audit ─────────────────────────

def test_journal_avant_apres_et_aucun_succes_sur_un_refus(ctx):
    poser_en_base(ctx, retention_mois=24)
    assert patch(ctx, {"retention_mois": -5}).status_code == 422
    assert patch(ctx, {"mode_ia": "x", "retention_mois": 12}).status_code == 422
    assert lignes_journal(ctx) == []                                                # un refus de validation n'écrit aucune ligne de succès
    assert patch(ctx, {"retention_mois": 12, "mode_ia": "hybride"}).status_code == 200
    (ligne,) = lignes_journal(ctx)
    assert ligne.resultat == "succes" and ligne.acteur_role == "admin"
    assert ligne.details["champs"] == ["mode_ia", "retention_mois"]
    assert ligne.details["avant"] == {"retention_mois": 24, "mode_ia": "deterministique"}
    assert ligne.details["apres"] == {"retention_mois": 12, "mode_ia": "hybride"}
