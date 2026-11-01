"""
Mot de passe (AD-04, partie 1) : journal d'audit dédié par voie, aucune donnée sensible dans le journal ni dans les réponses,
Cache-Control: no-store + Pragma: no-cache sur succès ET erreurs, refus d'un nouveau mot de passe identique au mot de passe actuel.

Vrai routeur, vrai JWT, vrais en-têtes de sécurité (middleware installé), SQLite en mémoire (type vérifié) — aucune base réelle.
"""
import os
import uuid
from types import SimpleNamespace

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-mot-de-passe-audit-0123456789")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.endpoints import auth, utilisateurs
from app.core.entetes_securite import installer_entetes_securite
from app.core.erreurs_validation import installer_erreurs_validation
from app.core.security import create_access_token, get_password_hash, verify_password
from app.db.session import Base, get_db
from app.models.agence import Agence
from app.models.enums import UserRole
from app.models.journal_audit import JournalAudit
from app.models.organisation import Organisation
from app.models.plan import Plan
from app.models.utilisateur import Utilisateur
from app.schemas.mot_de_passe import MESSAGE_MOT_DE_PASSE_IDENTIQUE
from app.services import journal_audit as journal

ACTUEL = "Mot-de-passe-actuel-77"
NOUVEAU = "Mot-de-passe-nouveau-88"
PIEGE = "Piege-Secret-Ne-Doit-Jamais-Sortir-55"
HACHAGE = get_password_hash(ACTUEL)              # un seul hachage argon2 (lent) pour tous les comptes
PLAN = uuid.uuid4()
CODES_MDP = (journal.COMPTE_MOT_DE_PASSE_REINITIALISE, journal.COMPTE_MOT_DE_PASSE_MODIFIE)


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
    app.include_router(auth.router, prefix="/auth")
    app.include_router(utilisateurs.router, prefix="/utilisateurs")
    installer_erreurs_validation(app)
    installer_entetes_securite(app)
    app.dependency_overrides[get_db] = base

    db = Session()
    db.add(Plan(id=PLAN, code="gratuit", nom="Gratuit"))
    org_p = Organisation(id=uuid.uuid4(), nom="Plateforme", active=True, plan_id=PLAN)
    org_x = Organisation(id=uuid.uuid4(), nom="Client X", active=True, plan_id=PLAN)
    org_y = Organisation(id=uuid.uuid4(), nom="Client Y", active=True, plan_id=PLAN)
    db.add_all([org_p, org_x, org_y]); db.flush()
    ag_x1 = Agence(id=uuid.uuid4(), organisation_id=org_x.id, nom="X1", ville="Lyon", active=True)
    db.add(ag_x1); db.flush()

    def user(role, org, email, agence=None):
        u = Utilisateur(id=uuid.uuid4(), organisation_id=org.id, agence_id=agence.id if agence else None, nom="N", prenom="P", email=email,
                        mot_de_passe_hash=HACHAGE, role=role, active=True, created_by_id=None)
        db.add(u); db.flush()
        return u

    comptes = SimpleNamespace(admin=user(UserRole.ADMIN, org_p, "admin@t.io"), cx_x=user(UserRole.CX_MANAGER, org_x, "cx.x@t.io"),
                              cx_y=user(UserRole.CX_MANAGER, org_y, "cx.y@t.io"), am_x1=user(UserRole.AGENCY_MANAGER, org_x, "am.x1@t.io", ag_x1))
    ids = SimpleNamespace(**{k: v.id for k, v in vars(comptes).items()}, org_x=org_x.id, org_y=org_y.id, ag_x1=ag_x1.id)
    db.commit(); db.close()
    return SimpleNamespace(client=TestClient(app), Session=Session, ids=ids, H=lambda uid: {"Authorization": f"Bearer {create_access_token(uid)}"})


def lignes(ctx, *actions):
    db = ctx.Session()
    try:
        requete = select(JournalAudit).order_by(JournalAudit.date_action, JournalAudit.id)
        if actions:
            requete = requete.where(JournalAudit.action.in_(actions))
        return list(db.scalars(requete))
    finally:
        db.close()


def mot_de_passe_actuel_valide(ctx, uid, valeur):
    db = ctx.Session()
    try:
        return verify_password(valeur, db.get(Utilisateur, uid).mot_de_passe_hash)
    finally:
        db.close()


def patch(ctx, cible, corps, acteur):
    return ctx.client.patch(f"/utilisateurs/{cible}", headers=ctx.H(acteur), json=corps)


def changer(ctx, acteur, ancien, nouveau):
    return ctx.client.post("/auth/me/mot-de-passe", headers=ctx.H(acteur), json={"ancien_mot_de_passe": ancien, "nouveau_mot_de_passe": nouveau})


# ───────────────────────── journal : une action dédiée par voie ─────────────────────────

def test_admin_reinitialise_le_mot_de_passe_d_un_cx_manager(ctx):
    r = patch(ctx, ctx.ids.cx_x, {"password": NOUVEAU}, ctx.ids.admin)
    assert r.status_code == 200, r.text
    (ligne,) = lignes(ctx)                                            # UNE seule ligne : pas de doublon « compte.modifie »
    assert ligne.action == journal.COMPTE_MOT_DE_PASSE_REINITIALISE and ligne.resultat == "succes"
    assert (ligne.acteur_role, ligne.acteur_email, ligne.acteur_id) == ("admin", "admin@t.io", ctx.ids.admin)
    assert (ligne.cible_type, ligne.cible_id, ligne.cible_libelle, ligne.organisation_id) == ("utilisateur", str(ctx.ids.cx_x), "cx.x@t.io", ctx.ids.org_x)
    assert ligne.details == {"changement": "oui"}
    assert mot_de_passe_actuel_valide(ctx, ctx.ids.cx_x, NOUVEAU)


def test_cx_manager_reinitialise_le_mot_de_passe_d_un_agency_manager(ctx):
    assert patch(ctx, ctx.ids.am_x1, {"password": NOUVEAU}, ctx.ids.cx_x).status_code == 200
    (ligne,) = lignes(ctx)
    assert ligne.action == journal.COMPTE_MOT_DE_PASSE_REINITIALISE and ligne.acteur_role == "cx_manager"
    assert ligne.cible_libelle == "am.x1@t.io" and ligne.organisation_id == ctx.ids.org_x and ligne.details == {"changement": "oui"}


def test_mot_de_passe_et_autres_champs_deux_lignes_utiles_sans_valeur(ctx):
    assert patch(ctx, ctx.ids.am_x1, {"password": NOUVEAU, "nom": "Autre Nom"}, ctx.ids.cx_x).status_code == 200
    modifie, reinit = lignes(ctx, journal.COMPTE_MODIFIE)[0], lignes(ctx, journal.COMPTE_MOT_DE_PASSE_REINITIALISE)[0]
    assert modifie.details["champs"] == ["mot_de_passe", "nom"]               # l'historique des champs reste complet
    assert reinit.details == {"changement": "oui"}                             # et l'événement de sécurité existe à part (filtrable)
    assert len(lignes(ctx)) == 2


def test_mot_de_passe_et_suspension(ctx):
    assert patch(ctx, ctx.ids.am_x1, {"password": NOUVEAU, "active": False}, ctx.ids.cx_x).status_code == 200
    assert sorted(l.action for l in lignes(ctx)) == [journal.COMPTE_MOT_DE_PASSE_REINITIALISE, journal.COMPTE_SUSPENDU]


def test_modification_sans_mot_de_passe_n_ecrit_pas_la_ligne_dediee(ctx):
    assert patch(ctx, ctx.ids.am_x1, {"nom": "Autre Nom"}, ctx.ids.cx_x).status_code == 200
    assert [l.action for l in lignes(ctx)] == [journal.COMPTE_MODIFIE]


def test_l_utilisateur_change_son_propre_mot_de_passe(ctx):
    r = changer(ctx, ctx.ids.am_x1, ACTUEL, NOUVEAU)
    assert r.status_code == 200, r.text
    (ligne,) = lignes(ctx)
    assert ligne.action == journal.COMPTE_MOT_DE_PASSE_MODIFIE and ligne.resultat == "succes"
    assert (ligne.acteur_role, ligne.acteur_email, ligne.acteur_id) == ("agency_manager", "am.x1@t.io", ctx.ids.am_x1)
    assert (ligne.cible_type, ligne.cible_id, ligne.cible_libelle, ligne.organisation_id) == ("utilisateur", str(ctx.ids.am_x1), "am.x1@t.io", ctx.ids.org_x)
    assert ligne.details == {"changement": "oui"}
    assert mot_de_passe_actuel_valide(ctx, ctx.ids.am_x1, NOUVEAU)


def test_la_ligne_suit_le_sort_de_la_transaction(ctx, monkeypatch):
    """Écrite dans la MÊME transaction : si le commit échoue, ni le nouveau mot de passe ni la ligne n'existent."""
    from sqlalchemy.orm import Session as SessionORM
    reel = SessionORM.commit

    def commit_en_echec(self):
        self.rollback()
        raise RuntimeError("panne simulée")

    monkeypatch.setattr(SessionORM, "commit", commit_en_echec)
    with pytest.raises(RuntimeError):
        changer(ctx, ctx.ids.am_x1, ACTUEL, NOUVEAU)
    monkeypatch.setattr(SessionORM, "commit", reel)
    assert lignes(ctx) == []
    assert mot_de_passe_actuel_valide(ctx, ctx.ids.am_x1, ACTUEL)


@pytest.mark.parametrize("appel", [
    lambda c: changer(c, c.ids.am_x1, "Mauvais-Ancien-123", NOUVEAU),               # ancien incorrect (400)
    lambda c: changer(c, c.ids.am_x1, ACTUEL, "court"),                             # trop court (422)
    lambda c: changer(c, c.ids.am_x1, ACTUEL, ACTUEL),                              # identique (422)
    lambda c: patch(c, c.ids.am_x1, {"password": ACTUEL}, c.ids.cx_x),             # identique par un tiers (422)
    lambda c: patch(c, c.ids.am_x1, {"password": "court"}, c.ids.cx_x),            # trop court (422)
    lambda c: patch(c, c.ids.am_x1, {"password": NOUVEAU}, c.ids.cx_y),            # autre organisation (404)
    lambda c: patch(c, c.ids.am_x1, {"password": NOUVEAU}, c.ids.am_x1),           # rôle non autorisé (403)
])
def test_un_refus_n_ecrit_aucune_ligne_de_succes_et_ne_change_rien(ctx, appel):
    assert appel(ctx).status_code in (400, 403, 404, 422)
    assert lignes(ctx, *CODES_MDP) == []
    assert mot_de_passe_actuel_valide(ctx, ctx.ids.am_x1, ACTUEL)


# ───────────────────────── isolation et rôles ─────────────────────────

def test_un_cx_manager_ne_reinitialise_pas_le_compte_d_une_autre_organisation(ctx):
    r = patch(ctx, ctx.ids.am_x1, {"password": NOUVEAU}, ctx.ids.cx_y)
    assert r.status_code == 404
    assert lignes(ctx) == [] and mot_de_passe_actuel_valide(ctx, ctx.ids.am_x1, ACTUEL)


def test_un_cx_manager_ne_reinitialise_ni_un_cx_ni_un_admin_et_un_admin_pas_un_admin(ctx):
    assert patch(ctx, ctx.ids.cx_y, {"password": NOUVEAU}, ctx.ids.cx_x).status_code == 404
    assert patch(ctx, ctx.ids.admin, {"password": NOUVEAU}, ctx.ids.cx_x).status_code == 404
    assert patch(ctx, ctx.ids.admin, {"password": NOUVEAU}, ctx.ids.admin).status_code == 404
    assert lignes(ctx) == []


def test_roles_inchanges_sur_la_modification(ctx):
    assert ctx.client.patch(f"/utilisateurs/{ctx.ids.am_x1}", json={"password": NOUVEAU}).status_code == 401
    assert patch(ctx, ctx.ids.am_x1, {"password": NOUVEAU}, ctx.ids.am_x1).status_code == 403
    assert ctx.client.post("/auth/me/mot-de-passe", json={"ancien_mot_de_passe": ACTUEL, "nouveau_mot_de_passe": NOUVEAU}).status_code == 401


# ───────────────────────── aucune donnée sensible ─────────────────────────

def test_aucun_mot_de_passe_ni_hachage_dans_le_journal_ni_dans_les_reponses(ctx):
    reponses = [
        ctx.client.post("/utilisateurs/", headers=ctx.H(ctx.ids.cx_x), json={"nom": "N", "prenom": "P", "email": "nouveau@t.io", "password": PIEGE,
                                                                             "role": "agency_manager", "agence_id": str(ctx.ids.ag_x1)}),
        patch(ctx, ctx.ids.am_x1, {"password": PIEGE + "-2", "nom": "Zed"}, ctx.ids.cx_x),
        changer(ctx, ctx.ids.cx_x, ACTUEL, PIEGE + "-3"),
        changer(ctx, ctx.ids.cx_x, "Mauvais-Ancien-123", PIEGE + "-4"),
        patch(ctx, ctx.ids.am_x1, {"password": PIEGE + "-2"}, ctx.ids.cx_x),                  # identique (refus)
        patch(ctx, ctx.ids.am_x1, {"password": "x"}, ctx.ids.cx_x),
    ]
    assert [r.status_code for r in reponses][:3] == [201, 200, 200]
    for r in reponses:
        assert PIEGE not in r.text and "argon2" not in r.text and "mot_de_passe_hash" not in r.text and "$argon2" not in r.text
    toutes = " ".join(str(l.details) + str(l.cible_libelle) + str(l.cible_id) for l in lignes(ctx))
    assert PIEGE not in toutes and "argon2" not in toutes
    assert all(l.details in (None, {"changement": "oui"}) or "mot_de_passe" not in l.details for l in lignes(ctx, *CODES_MDP))


# ───────────────────────── Cache-Control / Pragma ─────────────────────────

def _no_store(r):
    return r.headers.get("cache-control") == "no-store" and r.headers.get("pragma") == "no-cache"


def test_no_store_et_pragma_sur_succes_et_erreurs_de_chaque_route(ctx):
    reponses = {
        "me 200": changer(ctx, ctx.ids.am_x1, ACTUEL, NOUVEAU),
        "me 400 ancien": changer(ctx, ctx.ids.am_x1, "Mauvais-Ancien-123", "Autre-Mdp-12345"),
        "me 422 court": changer(ctx, ctx.ids.am_x1, NOUVEAU, "court"),
        "me 422 identique": changer(ctx, ctx.ids.am_x1, NOUVEAU, NOUVEAU),
        "me 401 anonyme": ctx.client.post("/auth/me/mot-de-passe", json={"ancien_mot_de_passe": "a", "nouveau_mot_de_passe": "b"}),
        "patch 200": patch(ctx, ctx.ids.cx_x, {"password": NOUVEAU}, ctx.ids.admin),
        "patch 422 identique": patch(ctx, ctx.ids.cx_x, {"password": NOUVEAU}, ctx.ids.admin),
        "patch 422 court": patch(ctx, ctx.ids.cx_x, {"password": "c"}, ctx.ids.admin),
        "patch 404": patch(ctx, uuid.uuid4(), {"password": NOUVEAU}, ctx.ids.admin),
        "patch 403": patch(ctx, ctx.ids.cx_x, {"password": NOUVEAU}, ctx.ids.am_x1),
        "patch 401 anonyme": ctx.client.patch(f"/utilisateurs/{ctx.ids.cx_x}", json={"password": NOUVEAU}),
        "post 201": ctx.client.post("/utilisateurs/", headers=ctx.H(ctx.ids.cx_x), json={"nom": "N", "prenom": "P", "email": "n1@t.io", "password": NOUVEAU,
                                                                                         "role": "agency_manager", "agence_id": str(ctx.ids.ag_x1)}),
        "post 422": ctx.client.post("/utilisateurs/", headers=ctx.H(ctx.ids.cx_x), json={"nom": "N"}),
        "post 401 anonyme": ctx.client.post("/utilisateurs/", json={"nom": "N"}),
    }
    attendus = {"me 200": 200, "me 400 ancien": 400, "me 422 court": 422, "me 422 identique": 422, "me 401 anonyme": 401, "patch 200": 200,
                "patch 422 identique": 422, "patch 422 court": 422, "patch 404": 404, "patch 403": 403, "patch 401 anonyme": 401, "post 201": 201,
                "post 422": 422, "post 401 anonyme": 401}
    for nom, r in reponses.items():
        assert r.status_code == attendus[nom], (nom, r.status_code, r.text)
        assert _no_store(r), (nom, dict(r.headers))


def test_les_autres_routes_gardent_leur_comportement(ctx):
    anonyme = ctx.client.get("/auth/me")
    assert anonyme.status_code == 401 and "pragma" not in anonyme.headers          # route publique/anonyme : pas d'en-tête ajouté
    connecte = ctx.client.get("/auth/me", headers=ctx.H(ctx.ids.am_x1))
    assert connecte.headers.get("cache-control") == "no-store"                      # garanti déjà par #38 pour les requêtes authentifiées
    assert "pragma" not in connecte.headers
    assert "pragma" not in ctx.client.get("/utilisateurs/", headers=ctx.H(ctx.ids.cx_x)).headers


# ───────────────────────── refus d'un mot de passe identique ─────────────────────────

def test_identique_refuse_sur_le_changement_personnel_message_francais_sans_echo(ctx):
    r = changer(ctx, ctx.ids.am_x1, ACTUEL, ACTUEL)
    assert r.status_code == 422 and r.json()["detail"] == MESSAGE_MOT_DE_PASSE_IDENTIQUE
    assert ACTUEL not in r.text and mot_de_passe_actuel_valide(ctx, ctx.ids.am_x1, ACTUEL)


def test_identique_refuse_sur_la_modification_par_un_tiers(ctx):
    r = patch(ctx, ctx.ids.am_x1, {"password": ACTUEL}, ctx.ids.cx_x)
    assert r.status_code == 422 and r.json()["detail"] == MESSAGE_MOT_DE_PASSE_IDENTIQUE and ACTUEL not in r.text


@pytest.mark.parametrize("variante", [f"  {ACTUEL}", f"{ACTUEL}   ", f"\t{ACTUEL}\n"])
def test_espaces_de_bord_ignores_comme_a_la_connexion(ctx, variante):
    """Règle de normalisation existante : les espaces de début et de fin sont retirés (login.strip()) ; un mot de passe qui n'en
    diffère que par eux est donc IDENTIQUE et refusé."""
    assert changer(ctx, ctx.ids.am_x1, ACTUEL, variante).status_code == 422
    assert patch(ctx, ctx.ids.am_x1, {"password": variante}, ctx.ids.cx_x).status_code == 422


def test_une_autre_casse_est_un_autre_mot_de_passe(ctx):
    assert changer(ctx, ctx.ids.am_x1, ACTUEL, ACTUEL.upper()).status_code == 200
    assert patch(ctx, ctx.ids.cx_x, {"password": ACTUEL.lower()}, ctx.ids.admin).status_code == 200


def test_un_mot_de_passe_different_passe(ctx):
    assert changer(ctx, ctx.ids.am_x1, ACTUEL, NOUVEAU).status_code == 200
    assert patch(ctx, ctx.ids.cx_x, {"password": NOUVEAU}, ctx.ids.admin).status_code == 200
    assert ctx.client.post("/auth/login", json={"email": "am.x1@t.io", "password": NOUVEAU}).status_code == 200


def test_pas_d_oracle_avec_un_ancien_mot_de_passe_faux(ctx):
    """Un ancien mot de passe incorrect donne 400 AVANT toute comparaison d'identité : on ne peut pas tester des essais du mot de passe actuel."""
    r = changer(ctx, ctx.ids.am_x1, "Mauvais-Ancien-123", ACTUEL)
    assert r.status_code == 400 and r.json()["detail"] != MESSAGE_MOT_DE_PASSE_IDENTIQUE


def test_une_requete_sans_mot_de_passe_n_est_pas_concernee(ctx):
    assert patch(ctx, ctx.ids.am_x1, {"nom": "Autre Nom"}, ctx.ids.cx_x).status_code == 200
    assert mot_de_passe_actuel_valide(ctx, ctx.ids.am_x1, ACTUEL)


def test_la_creation_de_compte_n_est_pas_soumise_au_refus_d_identite(ctx):
    r = ctx.client.post("/utilisateurs/", headers=ctx.H(ctx.ids.cx_x), json={"nom": "N", "prenom": "P", "email": "n2@t.io", "password": ACTUEL,
                                                                             "role": "agency_manager", "agence_id": str(ctx.ids.ag_x1)})
    assert r.status_code == 201


# ───────────────────────── codes d'action ─────────────────────────

def test_codes_d_action_stables_et_uniques():
    assert journal.COMPTE_MOT_DE_PASSE_REINITIALISE == "compte.mot_de_passe_reinitialise"
    assert journal.COMPTE_MOT_DE_PASSE_MODIFIE == "compte.mot_de_passe_modifie"
    assert len(journal.CODES_ACTION) == len(set(journal.CODES_ACTION)) == 19
