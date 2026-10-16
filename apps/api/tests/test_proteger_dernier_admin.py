"""
Protection du dernier administrateur et auto-protection (AD-01 / AD-03).

Règle (app/services/administrateurs.py) : une opération est refusée (409) si, une fois exécutée, il ne resterait aucun administrateur
ACTIF ; et un administrateur ne retire jamais son propre accès (suppression, désactivation, rétrogradation de son compte, ou suppression
de l'organisation qui le contient), même s'il en existe d'autres.

SÉCURITÉ DES TESTS : SQLite en mémoire uniquement (type de base vérifié avant chaque test).
Les routes /utilisateurs ne peuvent pas cibler un compte administrateur (le filtre de rôle répond 404) : la règle y est branchée par
des fonctions de service testées directement, et le câblage des routes est vérifié par espion.
"""
import os
import uuid
from types import SimpleNamespace

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-dernier-admin-0123456789")

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.endpoints import organisations, utilisateurs
from app.core.security import create_access_token, get_password_hash
from app.db.session import Base, get_db
from app.models.enums import UserRole
from app.models.organisation import Organisation
from app.models.plan import Plan
from app.models.utilisateur import Utilisateur
from app.services import administrateurs
from app.services.administrateurs import MESSAGE_AUTO_PROTECTION, MESSAGE_DERNIER_ADMIN
from app.services.plan_catalog import PLAN_GRATUIT_ID


@pytest.fixture()
def ctx():
    moteur = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    assert moteur.url.get_backend_name() == "sqlite"                  # jamais la vraie base

    @event.listens_for(moteur, "connect")
    def _cles_etrangeres(connexion, _):                               # les ON DELETE CASCADE s'appliquent comme sur PostgreSQL
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
    app.include_router(organisations.router, prefix="/organisations")
    app.include_router(utilisateurs.router, prefix="/utilisateurs")
    app.dependency_overrides[get_db] = base

    db = Session()
    db.add(Plan(id=PLAN_GRATUIT_ID, code="gratuit", nom="Gratuit", ordre=0)); db.flush()
    org_p, org_q, org_c = (Organisation(id=uuid.uuid4(), nom=n, active=True) for n in ("Plateforme", "Seconde plateforme", "Client"))
    db.add_all([org_p, org_q, org_c]); db.flush()

    def user(role, org, actif=True):
        u = Utilisateur(id=uuid.uuid4(), organisation_id=org.id, nom="N", prenom="P", email=f"{uuid.uuid4().hex[:8]}@secret-exemple.io",
                        mot_de_passe_hash=get_password_hash("Motdepasse-123"), role=role, active=actif)
        db.add(u)
        return u

    comptes = dict(admin_p=user(UserRole.ADMIN, org_p), admin_q=user(UserRole.ADMIN, org_q), cx=user(UserRole.CX_MANAGER, org_c),
                   am=user(UserRole.AGENCY_MANAGER, org_c))
    db.commit()
    ids = {k: v.id for k, v in comptes.items()}
    ids.update(org_p=org_p.id, org_q=org_q.id, org_c=org_c.id)
    db.close()
    return SimpleNamespace(client=TestClient(app), Session=Session, moteur=moteur, app=app, **ids,
                           H=lambda uid: {"Authorization": "Bearer " + create_access_token(str(uid))})


def photo(ctx):
    resultat = {}
    with ctx.moteur.connect() as c:
        for table in Base.metadata.tables.values():
            try:
                resultat[table.name] = sorted(str(tuple(ligne)) for ligne in c.execute(select(table)))
            except Exception:  # noqa: BLE001
                continue
    return resultat


def rendre_inactif(ctx, uid):
    db = ctx.Session()
    db.get(Utilisateur, uid).active = False
    db.commit(); db.close()


def supprimer_org(ctx, acteur, org_id):
    """Depuis la désactivation réelle d'une organisation (la suppression définitive n'existe plus) : même garde, même scénarios."""
    return ctx.client.patch(f"/organisations/{org_id}", headers=ctx.H(acteur), json={"active": False})


def appeler(fonction, ctx, *args):
    db = ctx.Session()
    try:
        fonction(db, *args)
    finally:
        db.close()


def charger(ctx, uid):
    db = ctx.Session()
    u = db.get(Utilisateur, uid)
    db.expunge(u)
    db.close()
    return u


# ── Suppression d'une organisation (route réelle) ──────────────────────────────────────────────


def test_desactiver_sa_propre_organisation_refuse_meme_dernier_admin_base_inchangee(ctx):
    db = ctx.Session(); db.query(Utilisateur).filter(Utilisateur.id == ctx.admin_q).delete(); db.commit(); db.close()   # admin_p est le seul
    avant = photo(ctx)
    r = supprimer_org(ctx, ctx.admin_p, ctx.org_p)
    assert r.status_code == 409 and r.json()["detail"] == MESSAGE_AUTO_PROTECTION
    assert photo(ctx) == avant


def test_desactiver_sa_propre_organisation_refuse_meme_si_un_autre_admin_existe(ctx):
    avant = photo(ctx)
    r = supprimer_org(ctx, ctx.admin_p, ctx.org_p)
    assert r.status_code == 409 and r.json()["detail"] == MESSAGE_AUTO_PROTECTION
    assert photo(ctx) == avant


def test_desactiver_l_organisation_d_un_autre_admin_autorise_si_un_admin_actif_reste(ctx):
    r = supprimer_org(ctx, ctx.admin_p, ctx.org_q)                      # l'organisation est désactivée ; ses comptes sont CONSERVÉS
    assert r.status_code == 200
    db = ctx.Session()
    assert db.get(Organisation, ctx.org_q).active is False and db.get(Utilisateur, ctx.admin_q) is not None
    db.close()


def test_organisation_dont_le_seul_autre_admin_est_inactif_peut_etre_desactivee(ctx):
    rendre_inactif(ctx, ctx.admin_q)                                     # un admin inactif ne compte pas : il ne protège rien
    assert supprimer_org(ctx, ctx.admin_p, ctx.org_q).status_code == 200


def test_organisation_sans_administrateur_desactivee_donnees_conservees(ctx):
    assert supprimer_org(ctx, ctx.admin_p, ctx.org_c).status_code == 200
    db = ctx.Session()
    assert db.get(Organisation, ctx.org_c).active is False and db.get(Utilisateur, ctx.cx) is not None   # données conservées
    db.close()


def test_ordre_des_controles_cx_et_agency_manager_recoivent_403_pas_409(ctx):
    avant = photo(ctx)
    assert supprimer_org(ctx, ctx.cx, ctx.org_p).status_code == 403
    assert supprimer_org(ctx, ctx.am, ctx.org_p).status_code == 403
    assert ctx.client.patch(f"/organisations/{ctx.org_p}", json={"active": False}).status_code == 401
    assert supprimer_org(ctx, ctx.admin_p, uuid.uuid4()).status_code == 404       # existence avant la règle
    assert photo(ctx) == avant


def test_les_messages_de_refus_ne_contiennent_aucune_donnee(ctx):
    r = supprimer_org(ctx, ctx.admin_p, ctx.org_p)
    texte = r.text
    assert "secret-exemple" not in texte and str(ctx.admin_p) not in texte and str(ctx.org_p) not in texte and "Plateforme" not in texte
    for message in (MESSAGE_DERNIER_ADMIN, MESSAGE_AUTO_PROTECTION):
        assert "@" not in message and "uuid" not in message.lower()


# ── Routes /utilisateurs : comportement existant et câblage ────────────────────────────────────


def test_un_admin_reste_invisible_des_routes_utilisateurs_comportement_existant(ctx):
    avant = photo(ctx)
    for acteur in (ctx.admin_p, ctx.admin_q):
        assert ctx.client.delete(f"/utilisateurs/{ctx.admin_q}", headers=ctx.H(acteur)).status_code == 404
        assert ctx.client.patch(f"/utilisateurs/{ctx.admin_q}", headers=ctx.H(acteur), json={"active": False}).status_code == 404
    assert ctx.client.delete(f"/utilisateurs/{ctx.admin_p}", headers=ctx.H(ctx.cx)).status_code == 404
    assert photo(ctx) == avant


def test_un_cx_manager_se_desactive_et_se_modifie_comme_avant(ctx):
    assert ctx.client.delete(f"/utilisateurs/{ctx.cx}", headers=ctx.H(ctx.admin_p)).status_code == 204
    db = ctx.Session()
    assert db.get(Utilisateur, ctx.cx).active is False
    db.close()
    assert ctx.client.patch(f"/utilisateurs/{ctx.cx}", headers=ctx.H(ctx.admin_p), json={"active": True}).status_code == 200
    assert ctx.client.delete(f"/utilisateurs/{ctx.am}", headers=ctx.H(ctx.cx)).status_code == 204


def test_les_routes_utilisateurs_appellent_la_regle_pour_chaque_cible(ctx, monkeypatch):
    appels = []
    monkeypatch.setattr(utilisateurs, "controler_retrait_compte", lambda db, compte, acteur: appels.append(("retrait", compte.id, acteur.id)))
    monkeypatch.setattr(utilisateurs, "controler_modification_compte", lambda db, compte, mods, acteur: appels.append(("modif", compte.id, acteur.id)))
    assert ctx.client.delete(f"/utilisateurs/{ctx.cx}", headers=ctx.H(ctx.admin_p)).status_code == 204
    assert ctx.client.patch(f"/utilisateurs/{ctx.cx}", headers=ctx.H(ctx.admin_p), json={"nom": "Nouveau"}).status_code == 200
    assert ("retrait", ctx.cx, ctx.admin_p) in appels and ("modif", ctx.cx, ctx.admin_p) in appels


# ── La règle elle-même (toutes les voies qui pourraient viser un administrateur) ───────────────


def test_retrait_du_dernier_admin_actif_refuse_par_chaque_voie(ctx):
    db = ctx.Session(); db.query(Utilisateur).filter(Utilisateur.id == ctx.admin_q).delete(); db.commit(); db.close()
    acteur_tiers = charger(ctx, ctx.cx)                                    # acteur différent du compte visé
    cible = charger(ctx, ctx.admin_p)
    avant = photo(ctx)
    for fonction, args in (
        (administrateurs.controler_retrait_compte, (cible, acteur_tiers)),                                      # suppression / désactivation
        (administrateurs.controler_modification_compte, (cible, {"active": False}, acteur_tiers)),              # désactivation par PATCH
        (administrateurs.controler_modification_compte, (cible, {"role": UserRole.CX_MANAGER}, acteur_tiers)),  # rétrogradation
        (administrateurs.controler_desactivation_organisation, (ctx.org_p, acteur_tiers)),                        # cascade d'organisation
    ):
        with pytest.raises(HTTPException) as refus:
            appeler(fonction, ctx, *args)
        assert refus.value.status_code == 409 and refus.value.detail == MESSAGE_DERNIER_ADMIN
    assert photo(ctx) == avant


def test_retrait_autorise_quand_un_autre_admin_actif_reste_et_que_l_acteur_est_un_tiers(ctx):
    acteur_tiers = charger(ctx, ctx.admin_q)
    cible = charger(ctx, ctx.admin_p)
    appeler(administrateurs.controler_retrait_compte, ctx, cible, acteur_tiers)
    appeler(administrateurs.controler_modification_compte, ctx, cible, {"active": False}, acteur_tiers)
    appeler(administrateurs.controler_modification_compte, ctx, cible, {"role": UserRole.CX_MANAGER}, acteur_tiers)
    appeler(administrateurs.controler_desactivation_organisation, ctx, ctx.org_p, acteur_tiers)


def test_auto_protection_refusee_pour_chaque_voie_meme_avec_d_autres_admins(ctx):
    moi = charger(ctx, ctx.admin_p)
    avant = photo(ctx)
    for fonction, args in (
        (administrateurs.controler_retrait_compte, (moi, moi)),
        (administrateurs.controler_modification_compte, (moi, {"active": False}, moi)),
        (administrateurs.controler_modification_compte, (moi, {"role": UserRole.CX_MANAGER}, moi)),
        (administrateurs.controler_desactivation_organisation, (ctx.org_p, moi)),
    ):
        with pytest.raises(HTTPException) as refus:
            appeler(fonction, ctx, *args)
        assert refus.value.status_code == 409 and refus.value.detail == MESSAGE_AUTO_PROTECTION
    assert photo(ctx) == avant


def test_modifications_sans_effet_sur_l_acces_d_un_admin_ne_sont_pas_bloquees(ctx):
    moi = charger(ctx, ctx.admin_p)
    appeler(administrateurs.controler_modification_compte, ctx, moi, {"nom": "Autre", "email": "x@y.io"}, moi)
    appeler(administrateurs.controler_modification_compte, ctx, moi, {"active": True}, moi)
    appeler(administrateurs.controler_modification_compte, ctx, moi, {"role": UserRole.ADMIN}, moi)


def test_un_admin_inactif_ne_compte_pas_comme_admin_actif(ctx):
    rendre_inactif(ctx, ctx.admin_q)
    acteur_tiers = charger(ctx, ctx.cx)
    cible = charger(ctx, ctx.admin_p)
    with pytest.raises(HTTPException) as refus:                          # admin_q est inactif : admin_p est bien le dernier actif
        appeler(administrateurs.controler_retrait_compte, ctx, cible, acteur_tiers)
    assert refus.value.detail == MESSAGE_DERNIER_ADMIN


def test_retirer_un_admin_deja_inactif_ne_touche_pas_l_acces(ctx):
    rendre_inactif(ctx, ctx.admin_q)
    appeler(administrateurs.controler_retrait_compte, ctx, charger(ctx, ctx.admin_q), charger(ctx, ctx.admin_p))


def test_comptes_cx_et_agency_manager_non_concernes(ctx):
    moi = charger(ctx, ctx.admin_p)
    for uid in (ctx.cx, ctx.am):
        appeler(administrateurs.controler_retrait_compte, ctx, charger(ctx, uid), moi)
        appeler(administrateurs.controler_modification_compte, ctx, charger(ctx, uid), {"active": False}, moi)


def test_les_administrateurs_actifs_sont_verrouilles_pour_la_concurrence(ctx):
    db = ctx.Session()
    sql = str(administrateurs.requete_administrateurs_actifs(db).statement.compile(dialect=postgresql.dialect()))
    db.close()
    assert "FOR UPDATE" in sql and "ORDER BY utilisateurs.id" in sql
