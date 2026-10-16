"""
Désactivation réelle d'une organisation (AD-01) et retrait de la suppression définitive.

Une organisation inactive ne peut plus être utilisée : connexion, refresh, jetons déjà émis et formulaires publics sont refusés ; les
données sont conservées intégralement ; la réactivation rétablit tout. Désactiver une organisation qui contient le dernier administrateur
actif, ou celle de l'administrateur connecté, est refusé (409). Les administrateurs d'une organisation inactive ne comptent plus.

SÉCURITÉ DES TESTS : SQLite en mémoire uniquement (type de base vérifié avant chaque test).
"""
import os
import uuid
from types import SimpleNamespace

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-desactivation-org-0123456789")

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.endpoints import agences, auth, feedbacks, organisations, qr_codes, utilisateurs
from app.core.erreurs_validation import installer_erreurs_validation
from app.core.security import create_access_token, create_refresh_token, get_password_hash
from app.db.session import Base, get_db
from app.models.agence import Agence
from app.models.categorie import Categorie
from app.models.enums import UserRole
from app.models.feedback import Feedback
from app.models.organisation import Organisation
from app.models.plan import Plan
from app.models.qr_code import QRCode
from app.models.utilisateur import Utilisateur
from app.services import administrateurs
from app.services.administrateurs import MESSAGE_AUTO_PROTECTION, MESSAGE_DERNIER_ADMIN
from app.services.plan_catalog import PLAN_GRATUIT_ID

MDP = "Motdepasse-123"
MESSAGE_PUBLIC = "Ce service est momentanément indisponible."


@pytest.fixture()
def ctx(monkeypatch):
    monkeypatch.setattr(feedbacks, "analyser_feedback", lambda feedback_id, db: None)
    moteur = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    assert moteur.url.get_backend_name() == "sqlite"                  # jamais la vraie base

    @event.listens_for(moteur, "connect")
    def _cles_etrangeres(connexion, _):
        connexion.execute("PRAGMA foreign_keys=ON")

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
    for prefixe, module in (("/auth", auth), ("/organisations", organisations), ("/utilisateurs", utilisateurs), ("/agences", agences),
                            ("/qr-codes", qr_codes), ("/feedbacks", feedbacks)):
        app.include_router(module.router, prefix=prefixe)
    app.dependency_overrides[get_db] = base
    installer_erreurs_validation(app)

    db = Session()
    db.add(Plan(id=PLAN_GRATUIT_ID, code="gratuit", nom="Gratuit", ordre=0)); db.flush()
    noms = {"p": "Plateforme", "q": "Seconde plateforme", "a": "Orange Secret A", "b": "Banque Secrete B"}
    orgs = {k: Organisation(id=uuid.uuid4(), nom=n, active=True) for k, n in noms.items()}
    db.add_all(orgs.values()); db.flush()

    def user(role, org, agence=None, actif=True):
        u = Utilisateur(id=uuid.uuid4(), organisation_id=org.id, agence_id=agence.id if agence else None, nom="N", prenom="P",
                        email=f"{uuid.uuid4().hex[:8]}@exemple.io", mot_de_passe_hash=get_password_hash(MDP), role=role, active=actif)
        db.add(u)
        return u

    def agence(org, nom, code):
        a = Agence(id=uuid.uuid4(), organisation_id=org.id, nom=nom, ville="V", active=True, seuil_alerte=70)
        db.add(a); db.flush()
        qr = QRCode(id=uuid.uuid4(), agence_id=a.id, code=code, url=f"http://t/{code}", actif=True)
        cat = Categorie(id=uuid.uuid4(), agence_id=a.id, nom=f"Cat {nom}", active=True)
        db.add_all([qr, cat]); db.flush()
        return a, qr, cat

    ag_a, qr_a, cat_a = agence(orgs["a"], "Agence A1", "QR-A1")
    ag_b, qr_b, cat_b = agence(orgs["b"], "Agence B1", "QR-B1")
    comptes = dict(admin_p=user(UserRole.ADMIN, orgs["p"]), admin_q=user(UserRole.ADMIN, orgs["q"]),
                   cx_a=user(UserRole.CX_MANAGER, orgs["a"]), am_a=user(UserRole.AGENCY_MANAGER, orgs["a"], ag_a),
                   cx_b=user(UserRole.CX_MANAGER, orgs["b"]))
    db.commit()
    ids = {k: v.id for k, v in comptes.items()}
    emails = {k: v.email for k, v in comptes.items()}
    info = SimpleNamespace(org={k: v.id for k, v in orgs.items()}, cat_a=cat_a.id, cat_b=cat_b.id, noms=noms)
    db.close()
    return SimpleNamespace(client=TestClient(app), Session=Session, moteur=moteur, ids=ids, emails=emails, info=info,
                           H=lambda uid: {"Authorization": "Bearer " + create_access_token(str(uid))})


def photo(ctx, sauf=()):
    resultat = {}
    with ctx.moteur.connect() as c:
        for table in Base.metadata.tables.values():
            if table.name in sauf:
                continue
            try:
                resultat[table.name] = sorted(str(tuple(ligne)) for ligne in c.execute(select(table)))
            except Exception:  # noqa: BLE001
                continue
    return resultat


def basculer(ctx, acteur, org, active):
    return ctx.client.patch(f"/organisations/{ctx.info.org[org]}", headers=ctx.H(ctx.ids[acteur]), json={"active": active})


def connexion(ctx, compte, mdp=MDP):
    return ctx.client.post("/auth/login", json={"email": ctx.emails[compte], "password": mdp})


def envoyer_avis(ctx, code="QR-A1", categorie="cat_a"):
    return ctx.client.post("/feedbacks/", params={"qr_code": code}, json={"categorie_id": str(getattr(ctx.info, categorie)), "note": 4})


def nb_avis(ctx):
    db = ctx.Session()
    try:
        return db.query(Feedback).count()
    finally:
        db.close()


# ── Connexion, refresh, jetons ─────────────────────────────────────────────────────────────────


def test_connexion_refusee_pour_une_organisation_inactive_comme_un_compte_desactive(ctx):
    assert connexion(ctx, "cx_a").status_code == 200
    assert basculer(ctx, "admin_p", "a", False).status_code == 200
    refus = connexion(ctx, "cx_a")
    mauvais = connexion(ctx, "cx_a", mdp="mauvais-mot-de-passe")
    assert refus.status_code == 401 and refus.json() == mauvais.json()      # message identique : rien n'est révélé
    assert connexion(ctx, "am_a").status_code == 401


def test_refresh_refuse_sans_jamais_repondre_500(ctx):
    jeton = create_refresh_token(str(ctx.ids["cx_a"]))
    assert ctx.client.post("/auth/refresh", params={"refresh_token": jeton}).status_code == 200
    basculer(ctx, "admin_p", "a", False)
    assert ctx.client.post("/auth/refresh", params={"refresh_token": jeton}).status_code == 401


def test_refresh_d_un_compte_desactive_repond_401_et_non_500(ctx):
    """Constat de l'audit : 500 (SQLite) car l'identifiant du jeton, une chaîne, était comparé à une colonne UUID."""
    db = ctx.Session(); db.get(Utilisateur, ctx.ids["cx_b"]).active = False; db.commit(); db.close()
    jeton = create_refresh_token(str(ctx.ids["cx_b"]))
    assert ctx.client.post("/auth/refresh", params={"refresh_token": jeton}).status_code == 401


@pytest.mark.parametrize("sujet", ["pas-un-uuid", "", str(uuid.uuid4())])
def test_refresh_avec_identifiant_invalide_ou_inconnu_repond_401(ctx, sujet):
    assert ctx.client.post("/auth/refresh", params={"refresh_token": create_refresh_token(sujet)}).status_code == 401


def test_jeton_deja_emis_refuse_des_la_requete_suivante(ctx):
    for compte in ("cx_a", "am_a"):
        assert ctx.client.get("/auth/me", headers=ctx.H(ctx.ids[compte])).status_code == 200
    assert ctx.client.get("/agences/", headers=ctx.H(ctx.ids["cx_a"])).status_code == 200
    basculer(ctx, "admin_p", "a", False)
    for compte in ("cx_a", "am_a"):
        assert ctx.client.get("/auth/me", headers=ctx.H(ctx.ids[compte])).status_code == 401
    assert ctx.client.get("/agences/", headers=ctx.H(ctx.ids["cx_a"])).status_code == 401


def test_isolation_desactiver_a_n_affecte_pas_b(ctx):
    basculer(ctx, "admin_p", "a", False)
    assert connexion(ctx, "cx_b").status_code == 200
    assert ctx.client.get("/auth/me", headers=ctx.H(ctx.ids["cx_b"])).status_code == 200
    assert envoyer_avis(ctx, "QR-B1", "cat_b").status_code == 201
    assert ctx.client.get("/qr-codes/QR-B1/validate").status_code == 200


# ── Formulaire public ──────────────────────────────────────────────────────────────────────────


def test_formulaire_public_refuse_avec_message_neutre_sans_nom_d_organisation(ctx):
    assert envoyer_avis(ctx).status_code == 201
    basculer(ctx, "admin_p", "a", False)
    avant = nb_avis(ctx)
    reponses = [
        envoyer_avis(ctx),
        ctx.client.get("/qr-codes/QR-A1/validate"),
        ctx.client.get("/qr-codes/QR-A1/categories"),
        ctx.client.post("/qr-codes/QR-A1/suggestions", json={"contenu": "Une idée utile pour l'agence"}),
    ]
    for r in reponses:
        assert r.status_code == 503 and r.json() == {"detail": MESSAGE_PUBLIC}, r.text
        for secret in ("Orange", "Secret", "Agence A1", "inactive", "désactiv"):
            assert secret not in r.text
    assert nb_avis(ctx) == avant                                           # rien n'est enregistré


def test_formulaire_inconnu_reste_un_404_et_ne_revele_pas_l_etat_d_une_organisation(ctx):
    assert ctx.client.get("/qr-codes/QR-INCONNU/validate").status_code == 404


# ── Données conservées, réactivation ───────────────────────────────────────────────────────────


def test_donnees_conservees_et_reactivation_retablit_tout(ctx):
    assert envoyer_avis(ctx).status_code == 201
    avant = photo(ctx, sauf=("organisations",))
    org_avant = photo(ctx)["organisations"]
    assert basculer(ctx, "admin_p", "a", False).status_code == 200
    assert photo(ctx, sauf=("organisations",)) == avant                    # aucune ligne ailleurs n'est touchée
    org_inactive = photo(ctx)["organisations"]
    assert len(org_inactive) == len(org_avant) and org_inactive != org_avant       # seule la ligne de l'organisation change (drapeau)
    assert basculer(ctx, "admin_p", "a", True).status_code == 200
    assert photo(ctx)["organisations"] == org_avant
    assert connexion(ctx, "cx_a").status_code == 200
    assert ctx.client.get("/auth/me", headers=ctx.H(ctx.ids["cx_a"])).status_code == 200
    assert ctx.client.get("/qr-codes/QR-A1/validate").status_code == 200
    assert envoyer_avis(ctx).status_code == 201
    assert nb_avis(ctx) == 2


# ── Rôles et suppression retirée ───────────────────────────────────────────────────────────────


def test_cx_agency_manager_et_anonyme_ne_peuvent_pas_desactiver(ctx):
    avant = photo(ctx)
    for acteur in ("cx_a", "am_a"):
        assert basculer(ctx, acteur, "a", False).status_code == 403
        assert basculer(ctx, acteur, "b", False).status_code == 403
    assert ctx.client.patch(f"/organisations/{ctx.info.org['a']}", json={"active": False}).status_code == 401
    assert photo(ctx) == avant


def test_la_suppression_definitive_d_une_organisation_n_existe_plus(ctx):
    avant = photo(ctx)
    for org in ("a", "p", "q"):
        r = ctx.client.delete(f"/organisations/{ctx.info.org[org]}", headers=ctx.H(ctx.ids["admin_p"]))
        assert r.status_code == 405
    assert photo(ctx) == avant
    assert not [r for r in ctx.client.app.routes if getattr(r, "path", "") == "/organisations/{org_id}" and "DELETE" in getattr(r, "methods", ())]


# ── Garde du dernier administrateur ────────────────────────────────────────────────────────────


def test_desactiver_sa_propre_organisation_refuse_meme_avec_un_autre_admin(ctx):
    avant = photo(ctx)
    r = basculer(ctx, "admin_p", "p", False)
    assert r.status_code == 409 and r.json()["detail"] == MESSAGE_AUTO_PROTECTION
    assert photo(ctx) == avant
    assert ctx.client.get("/auth/me", headers=ctx.H(ctx.ids["admin_p"])).status_code == 200


def test_desactiver_l_organisation_d_un_autre_admin_autorise_tant_qu_un_admin_actif_reste(ctx):
    assert basculer(ctx, "admin_p", "q", False).status_code == 200
    assert connexion(ctx, "admin_q").status_code == 401                       # ses comptes ne se connectent plus
    r = basculer(ctx, "admin_p", "p", False)                                  # et il n'y a plus d'autre admin actif
    assert r.status_code == 409


def test_les_administrateurs_d_une_organisation_inactive_ne_comptent_plus(ctx):
    basculer(ctx, "admin_p", "q", False)
    db = ctx.Session()
    acteur_tiers = db.get(Utilisateur, ctx.ids["cx_a"])                        # acteur différent des comptes visés
    with pytest.raises(HTTPException) as refus:
        administrateurs.controler_desactivation_organisation(db, ctx.info.org["p"], acteur_tiers)
    db.close()
    assert refus.value.status_code == 409 and refus.value.detail == MESSAGE_DERNIER_ADMIN


def test_la_seule_organisation_avec_un_admin_actif_ne_peut_pas_etre_desactivee(ctx):
    db = ctx.Session()
    acteur_tiers = db.get(Utilisateur, ctx.ids["cx_a"])
    db.get(Utilisateur, ctx.ids["admin_q"]).active = False; db.commit()
    with pytest.raises(HTTPException) as refus:
        administrateurs.controler_desactivation_organisation(db, ctx.info.org["p"], acteur_tiers)
    assert refus.value.detail == MESSAGE_DERNIER_ADMIN
    administrateurs.controler_desactivation_organisation(db, ctx.info.org["a"], acteur_tiers)    # sans admin : autorisée
    db.close()


def test_reactiver_ou_modifier_n_est_jamais_bloque_par_la_garde(ctx):
    basculer(ctx, "admin_p", "q", False)
    assert basculer(ctx, "admin_p", "q", True).status_code == 200
    assert basculer(ctx, "admin_p", "q", True).status_code == 200
    assert ctx.client.patch(f"/organisations/{ctx.info.org['p']}", headers=ctx.H(ctx.ids["admin_p"]), json={"nom": "Plateforme renommée"}).status_code == 200


def test_desactiver_une_organisation_deja_inactive_ne_declenche_pas_la_garde(ctx):
    assert basculer(ctx, "admin_p", "a", False).status_code == 200
    assert basculer(ctx, "admin_p", "a", False).status_code == 200


def test_messages_de_refus_sans_echo_de_donnees(ctx):
    r = basculer(ctx, "admin_p", "p", False)
    for secret in (ctx.emails["admin_p"], str(ctx.ids["admin_p"]), str(ctx.info.org["p"]), "Plateforme"):
        assert secret not in r.text


# ── Coût ───────────────────────────────────────────────────────────────────────────────────────


def test_la_verification_de_l_organisation_n_ajoute_aucune_requete_a_l_authentification(ctx):
    """Route sonde qui ne fait QUE s'authentifier : une seule requête SQL (utilisateur, organisation vérifiée dans la même requête)."""
    from fastapi import Depends

    from app.api.deps import get_current_user

    sonde = FastAPI()
    sonde.dependency_overrides[get_db] = ctx.client.app.dependency_overrides[get_db]

    @sonde.get("/sonde")
    def route(utilisateur=Depends(get_current_user)):
        return {"ok": True}

    compteur = {"n": 0}

    def compter(*_):
        compteur["n"] += 1

    event.listen(ctx.moteur, "before_cursor_execute", compter)
    try:
        assert TestClient(sonde).get("/sonde", headers=ctx.H(ctx.ids["admin_p"])).status_code == 200
    finally:
        event.remove(ctx.moteur, "before_cursor_execute", compter)
    assert compteur["n"] == 1
