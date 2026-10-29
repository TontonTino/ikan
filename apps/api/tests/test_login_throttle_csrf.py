"""
SD-08 — limitation des tentatives de connexion et protection CSRF par vérification de l'origine.

SÉCURITÉ DES TESTS : SQLite en mémoire uniquement (type de base vérifié). Le temps est simulé (aucun sleep).
"""
import json
import logging
import os
import uuid
from types import SimpleNamespace

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-login-throttle-0123456789")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api import webhooks_stripe
from app.api.v1.endpoints import auth, feedbacks, qr_codes
from app.core import login_throttle
from app.core.config import settings
from app.core.csrf import MESSAGE_ORIGINE_REFUSEE, ProtectionCSRF
from app.core.erreurs_validation import installer_erreurs_validation
from app.core.rate_limit import limiteur
from app.core.security import create_access_token, get_password_hash
from app.db.session import Base, get_db
from app.models.enums import UserRole
from app.models.organisation import Organisation
from app.models.plan import Plan
from app.models.utilisateur import Utilisateur
from app.services.plan_catalog import PLAN_GRATUIT_ID

MDP = "Motdepasse-123"
ORIGINE_OK = "https://ikanai-dashboard-fixs.onrender.com"
ORIGINE_ETRANGERE = "https://evil.example.com"
MSG = login_throttle.MESSAGE_TROP_DE_TENTATIVES


class Horloge:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


@pytest.fixture()
def ctx(monkeypatch):
    horloge = Horloge()
    monkeypatch.setattr(limiteur, "_horloge", horloge)
    monkeypatch.setattr(settings, "ALLOWED_ORIGINS", f"{ORIGINE_OK},https://ikan-1.onrender.com")
    monkeypatch.setattr(settings, "TRUSTED_PROXY_HOPS", 1)   # l'adresse du client = dernière entrée de X-Forwarded-For
    moteur = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    assert moteur.url.get_backend_name() == "sqlite"
    for table in Base.metadata.sorted_tables:
        try:
            table.create(moteur, checkfirst=True)
        except Exception:  # noqa: BLE001
            pass
    Session = sessionmaker(bind=moteur)

    def base():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app = FastAPI()
    app.add_middleware(ProtectionCSRF)
    app.include_router(auth.router, prefix="/api/v1/auth")
    app.include_router(feedbacks.router, prefix="/api/v1/feedbacks")
    app.include_router(qr_codes.router, prefix="/api/v1/qr-codes")
    app.include_router(webhooks_stripe.router, prefix="/webhooks")
    app.dependency_overrides[get_db] = base
    installer_erreurs_validation(app)

    db = Session()
    db.add(Plan(id=PLAN_GRATUIT_ID, code="gratuit", nom="Gratuit", ordre=0))
    db.flush()
    org = Organisation(id=uuid.uuid4(), nom="Org", active=True)
    db.add(org)
    db.flush()
    comptes = {}
    for cle in ("a", "b"):
        u = Utilisateur(id=uuid.uuid4(), organisation_id=org.id, nom="Nom", prenom="P", email=f"{cle}@exemple.io",
                        mot_de_passe_hash=get_password_hash(MDP), role=UserRole.CX_MANAGER, active=True)
        db.add(u)
        comptes[cle] = u
    db.commit()
    ids = {k: v.id for k, v in comptes.items()}
    db.close()

    def tentative(email, mdp="mauvais", ip="1.1.1.1"):
        r = c.post("/api/v1/auth/login", json={"email": email, "password": mdp}, headers={"X-Forwarded-For": ip})
        c.cookies.clear()          # les tests de connexion n'envoient pas le cookie posé par la réponse précédente
        return r

    c = TestClient(app)
    return SimpleNamespace(client=c, tentative=tentative, horloge=horloge, Session=Session, ids=ids)


# ─────────────────────────────── Connexion ───────────────────────────────

def test_au_dela_du_seuil_par_couple_429_avec_retry_after_et_message_neutre(ctx):
    for _ in range(5):
        assert ctx.tentative("a@exemple.io").status_code == 401
    r = ctx.tentative("a@exemple.io")
    assert r.status_code == 429 and r.json() == {"detail": MSG}
    assert int(r.headers["Retry-After"]) == 901          # le plus ancien échec expire dans toute la fenêtre (arrondi à la seconde supérieure)
    ctx.horloge.t += 300
    assert int(ctx.tentative("a@exemple.io").headers["Retry-After"]) == 601


def test_meme_reponse_que_le_compte_existe_ou_non(ctx):
    for email in ("a@exemple.io", "inconnu@exemple.io"):
        for _ in range(5):
            ctx.tentative(email)
    r1, r2 = ctx.tentative("a@exemple.io"), ctx.tentative("inconnu@exemple.io")
    assert r1.status_code == r2.status_code == 429
    assert r1.json() == r2.json() and r1.headers["Retry-After"] == r2.headers["Retry-After"]


def test_le_bon_mot_de_passe_est_aussi_refuse_pendant_le_blocage_sans_etre_verifie(ctx, monkeypatch):
    for _ in range(5):
        ctx.tentative("a@exemple.io")
    appels = []
    monkeypatch.setattr(auth, "verify_password", lambda *a, **k: appels.append(1) or True)
    r = ctx.tentative("a@exemple.io", MDP)
    assert r.status_code == 429 and appels == []


def test_casse_et_espaces_de_l_email_comptent_comme_le_meme_email(ctx):
    for email in ("A@Exemple.IO", " a@exemple.io ", "a@EXEMPLE.io", "  A@exemple.io", "a@exemple.io  "):
        assert ctx.tentative(email).status_code == 401
    assert ctx.tentative("a@exemple.io").status_code == 429


def test_les_cles_de_compteur_normalisent_l_email_independamment_de_la_route(ctx):
    """La route normalise déjà l'e-mail ; le module le fait aussi (défense en profondeur, testé seul)."""
    requete = SimpleNamespace(client=SimpleNamespace(host="9.9.9.9"), headers={})
    assert login_throttle._cles(requete, "  A@Exemple.IO ") == login_throttle._cles(requete, "a@exemple.io")
    assert login_throttle._cles(requete, "a@exemple.io") != login_throttle._cles(requete, "b@exemple.io")


def test_un_succes_remet_le_couple_a_zero(ctx):
    for _ in range(4):
        ctx.tentative("a@exemple.io")
    assert ctx.tentative("a@exemple.io", MDP).status_code == 200
    for _ in range(4):
        assert ctx.tentative("a@exemple.io").status_code == 401
    assert ctx.tentative("a@exemple.io", MDP).status_code == 200     # sans remise à zéro : 8 échecs cumulés, donc 429


def test_un_autre_email_depuis_la_meme_ip_n_est_pas_bloque_par_le_compteur_du_couple(ctx):
    for _ in range(5):
        ctx.tentative("a@exemple.io")
    assert ctx.tentative("a@exemple.io").status_code == 429
    assert ctx.tentative("b@exemple.io", MDP).status_code == 200


def test_limite_par_ip_seule(ctx):
    for i in range(30):
        assert ctx.tentative(f"inconnu{i}@exemple.io").status_code == 401     # 30 couples distincts, jamais 5 sur un seul
    r = ctx.tentative("b@exemple.io", MDP)
    assert r.status_code == 429 and r.json() == {"detail": MSG}
    assert ctx.tentative("b@exemple.io", MDP, ip="2.2.2.2").status_code == 200   # une autre IP n'est pas touchée


def test_la_fenetre_expire_avec_le_temps_simule(ctx):
    for _ in range(5):
        ctx.tentative("a@exemple.io")
    assert ctx.tentative("a@exemple.io", MDP).status_code == 429
    ctx.horloge.t += 899
    assert ctx.tentative("a@exemple.io", MDP).status_code == 429
    ctx.horloge.t += 2
    assert ctx.tentative("a@exemple.io", MDP).status_code == 200


def test_le_compte_n_est_jamais_verrouille(ctx):
    for _ in range(5):
        ctx.tentative("a@exemple.io", ip="1.1.1.1")
    assert ctx.tentative("a@exemple.io", MDP, ip="1.1.1.1").status_code == 429
    assert ctx.tentative("a@exemple.io", MDP, ip="3.3.3.3").status_code == 200     # le vrai utilisateur, ailleurs, se connecte
    db = ctx.Session()
    try:
        assert db.get(Utilisateur, ctx.ids["a"]).active is True
    finally:
        db.close()


def test_le_depassement_est_journalise_sans_mot_de_passe_et_avec_email_masque(ctx, caplog):
    secret = "Secr3t-Distinctif-9"
    with caplog.at_level(logging.WARNING, logger="ikan.security.access_denied"):
        for _ in range(5):
            ctx.tentative("a@exemple.io", secret)
        ctx.tentative("a@exemple.io", secret)
    evenements = [json.loads(r.getMessage()) for r in caplog.records if '"connexion_limitee"' in r.getMessage()]
    assert len(evenements) == 1 and evenements[0]["code"] == 429 and evenements[0]["portee"] == "couple"
    assert evenements[0]["email"] == "[e-mail masqué]" and evenements[0]["ip"] == "1.1.1.1"
    texte = " ".join(r.getMessage() for r in caplog.records)
    assert secret not in texte and "a@exemple.io" not in texte.replace("[e-mail masqué]", "")


def test_les_compteurs_expires_sont_nettoyes(ctx):
    for i in range(300):
        limiteur.noter(f"login-couple:x|{i}", 900)
    assert len(limiteur._evenements) == 300
    ctx.horloge.t += 901
    for i in range(256):
        limiteur.noter(f"login-ip:{i}", 900)
    assert len(limiteur._evenements) <= 256            # les 300 clés expirées ont disparu
    assert not any(k.startswith("login-couple:x|") for k in limiteur._evenements)


def test_limites_a_zero_desactivent_la_limitation(ctx, monkeypatch):
    monkeypatch.setattr(settings, "LOGIN_MAX_ECHECS_PAR_COUPLE", 0)
    monkeypatch.setattr(settings, "LOGIN_MAX_ECHECS_PAR_IP", 0)
    for _ in range(40):
        assert ctx.tentative("a@exemple.io").status_code == 401


def test_requetes_invalides_ne_comptent_pas(ctx):
    for _ in range(10):
        assert ctx.client.post("/api/v1/auth/login", json={"email": "", "password": ""}).status_code in (400, 422)
    assert ctx.tentative("a@exemple.io", MDP).status_code == 200


# ─────────────────────────────── CSRF ───────────────────────────────

def cookie(ctx, compte="a"):
    return {"Cookie": f"access_token={create_access_token(str(ctx.ids[compte]))}"}


def nom_en_base(ctx):
    db = ctx.Session()
    try:
        return db.get(Utilisateur, ctx.ids["a"]).nom
    finally:
        db.close()


def renommer(ctx, headers):
    return ctx.client.patch("/api/v1/auth/me", json={"nom": "Modifie"}, headers=headers)


def test_origine_autorisee_acceptee(ctx):
    r = renommer(ctx, {**cookie(ctx), "Origin": ORIGINE_OK})
    assert r.status_code == 200 and nom_en_base(ctx) == "Modifie"


def test_origine_etrangere_refusee_403_sans_ecriture_ni_echo(ctx):
    r = renommer(ctx, {**cookie(ctx), "Origin": ORIGINE_ETRANGERE})
    assert r.status_code == 403 and r.json() == {"detail": MESSAGE_ORIGINE_REFUSEE}
    assert "Modifie" not in r.text and ORIGINE_ETRANGERE not in r.text and nom_en_base(ctx) == "Nom"


def test_origine_nulle_refusee(ctx):
    assert renommer(ctx, {**cookie(ctx), "Origin": "null"}).status_code == 403


def test_sans_origine_ni_referer_refuse(ctx):
    r = renommer(ctx, cookie(ctx))
    assert r.status_code == 403 and nom_en_base(ctx) == "Nom"


def test_sans_origine_le_referer_decide(ctx):
    assert renommer(ctx, {**cookie(ctx), "Referer": ORIGINE_OK + "/parametres?x=1"}).status_code == 200
    assert renommer(ctx, {**cookie(ctx), "Referer": ORIGINE_ETRANGERE + "/page"}).status_code == 403


def test_origine_avec_barre_finale_ou_prefixe_trompeur(ctx):
    assert renommer(ctx, {**cookie(ctx), "Origin": ORIGINE_OK + "/"}).status_code == 200
    assert renommer(ctx, {**cookie(ctx), "Origin": ORIGINE_OK + ".evil.example.com"}).status_code == 403


@pytest.mark.parametrize("methode,chemin", [("post", "/api/v1/auth/me/mot-de-passe"), ("post", "/api/v1/auth/logout"),
                                            ("delete", "/api/v1/utilisateurs/x"), ("post", "/api/v1/feedbacks/x/open")])
def test_toutes_les_methodes_de_changement_d_etat_sont_controlees(ctx, methode, chemin):
    r = getattr(ctx.client, methode)(chemin, headers={**cookie(ctx), "Origin": ORIGINE_ETRANGERE})
    assert r.status_code == 403 and r.json() == {"detail": MESSAGE_ORIGINE_REFUSEE}


def test_get_jamais_bloque(ctx):
    r = ctx.client.get("/api/v1/auth/me", headers={**cookie(ctx), "Origin": ORIGINE_ETRANGERE})
    assert r.status_code == 200
    assert ctx.client.options("/api/v1/auth/me", headers={**cookie(ctx), "Origin": ORIGINE_ETRANGERE}).status_code != 403


def test_requete_a_en_tete_bearer_non_concernee(ctx):
    bearer = {"Authorization": "Bearer " + create_access_token(str(ctx.ids["a"])), "Origin": ORIGINE_ETRANGERE}
    assert renommer(ctx, bearer).status_code == 200
    # un cookie en plus d'un Bearer : c'est le Bearer qui fait foi, un site tiers ne peut pas le poser
    assert renommer(ctx, {**bearer, **cookie(ctx)}).status_code == 200


def test_requete_sans_cookie_d_authentification_non_concernee(ctx):
    r = ctx.client.post("/api/v1/auth/login", json={"email": "a@exemple.io", "password": MDP},
                        headers={"Origin": ORIGINE_ETRANGERE})
    assert r.status_code == 200
    r = ctx.client.post("/api/v1/auth/login", json={"email": "a@exemple.io", "password": MDP},
                        headers={"Cookie": "autre=1", "Origin": ORIGINE_ETRANGERE})
    assert r.status_code == 200


@pytest.mark.parametrize("chemin,corps", [
    ("/api/v1/feedbacks/", {"categorie_id": str(uuid.uuid4()), "note": 4}),
    ("/api/v1/feedbacks/" + str(uuid.uuid4()) + "/nps", {"nps": 9}),
    ("/api/v1/qr-codes/QR-X/suggestions", {"texte": "Une idée pour l'agence"}),
    ("/webhooks/stripe", {}),
])
def test_routes_publiques_et_webhooks_inchanges_meme_avec_cookie_et_origine_etrangere(ctx, chemin, corps):
    r = ctx.client.post(chemin, params={"qr_code": "QR-X"}, json=corps, headers={**cookie(ctx), "Origin": ORIGINE_ETRANGERE})
    assert r.status_code != 403 or r.json().get("detail") != MESSAGE_ORIGINE_REFUSEE
    # la route a bien été atteinte (elle répond par sa propre logique : 401/404/422/400, jamais le refus d'origine)
    assert r.json().get("detail") != MESSAGE_ORIGINE_REFUSEE


def test_le_vrai_point_d_entree_installe_la_protection():
    from app.main import app as application
    c = TestClient(application)
    entetes = {"Cookie": "access_token=nimporte", "Origin": ORIGINE_ETRANGERE}
    r = c.patch("/api/v1/auth/me", json={"nom": "X"}, headers=entetes)
    assert r.status_code == 403 and r.json() == {"detail": MESSAGE_ORIGINE_REFUSEE}
    # origine autorisée : la requête atteint l'authentification (jeton invalide → 401, pas 403)
    r = c.patch("/api/v1/auth/me", json={"nom": "X"}, headers={"Cookie": "access_token=nimporte", "Origin": settings.allowed_origins_list[0]})
    assert r.status_code == 401
    # pas de cookie : le comportement existant est inchangé
    assert c.post("/api/v1/auth/logout", headers={"Origin": ORIGINE_ETRANGERE}).status_code == 200


def test_le_refus_est_journalise_sans_donnee(ctx, caplog):
    with caplog.at_level(logging.WARNING, logger="ikan.security.access_denied"):
        renommer(ctx, {**cookie(ctx), "Origin": ORIGINE_ETRANGERE})
    messages = [r.getMessage() for r in caplog.records if "csrf_refuse" in r.getMessage()]
    assert len(messages) == 1 and "access_token" not in messages[0] and ORIGINE_ETRANGERE not in messages[0]
