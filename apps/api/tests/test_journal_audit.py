"""
Journal d'audit (AD-08, SD-13, AD-03) : chaque action sensible écrit UNE ligne aux bons champs, dans la même transaction ; les refus et
les échecs de connexion sont tracés sans jamais gêner la réponse ; aucune donnée sensible ; lecture réservée à l'administrateur ;
aucune route de modification ni de suppression.

Vrai routeur, vrai JWT, SQLite en mémoire (type de base vérifié) — aucune base réelle. Écriture différée désactivée par défaut dans
ces tests (déterministe) ; un test dédié vérifie l'écriture différée et qu'elle ne retarde pas la réponse.
"""
import os
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-journal-audit-0123456789")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select, text
from sqlalchemy.exc import DatabaseError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.endpoints import agences, auth, journal as route_journal, organisations, qr_codes, system, utilisateurs
from app.core.config import settings
from app.core.security import create_access_token, get_password_hash
from app.db.session import Base, get_db
from app.models.agence import Agence
from app.models.changement_plan import ChangementPlan
from app.models.demande_contact import DemandeContact
from app.models.enums import UserRole
from app.models.feedback import Feedback
from app.models.journal_audit import JournalAudit
from app.models.organisation import Organisation
from app.models.plan import Plan
from app.models.qr_code import QRCode
from app.models.utilisateur import Utilisateur
from app.services import journal_audit as journal
from app.services.administrateurs import MESSAGE_AUTO_PROTECTION, MESSAGE_DERNIER_ADMIN

MDP = "Motdepasse-123"
HACHAGE = get_password_hash(MDP)                  # un seul hachage (argon2 est lent) réutilisé pour tous les comptes de test
PIEGE_MDP = "Piege-MotDePasse-Secret-9!"
PIEGE_NOUVEAU_MDP = "Autre-Piege-Secret-77!"
PIEGE_TEL = "0612345678"
PIEGE_AVIS = "TEXTE-AVIS-PIEGE-NE-DOIT-JAMAIS-APPARAITRE"
PLAN_A, PLAN_B = uuid.uuid4(), uuid.uuid4()


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
    for prefixe, module in (("/organisations", organisations), ("/utilisateurs", utilisateurs), ("/agences", agences), ("/qr-codes", qr_codes),
                            ("/system", system), ("/auth", auth), ("/admin", route_journal)):
        app.include_router(module.router, prefix=prefixe)
    app.dependency_overrides[get_db] = base

    db = Session()
    db.add_all([Plan(id=PLAN_A, code="gratuit", nom="Gratuit"), Plan(id=PLAN_B, code="pro", nom="Pro", ordre=3)])
    org_p = Organisation(id=uuid.uuid4(), nom="Plateforme", active=True, plan_id=PLAN_A)
    org_x = Organisation(id=uuid.uuid4(), nom="Client X", active=True, secteur_code="telecom", plan_id=PLAN_A)
    db.add_all([org_p, org_x]); db.flush()
    ag_x1 = Agence(id=uuid.uuid4(), organisation_id=org_x.id, nom="Agence X1", ville="Lyon", active=True)
    ag_x2 = Agence(id=uuid.uuid4(), organisation_id=org_x.id, nom="Agence X2", ville="Lille", active=True)
    db.add_all([ag_x1, ag_x2]); db.flush()
    qr = QRCode(id=uuid.uuid4(), agence_id=ag_x1.id, code="QR-X1", url="http://t/x1", label="Borne X1", actif=True)
    db.add(qr); db.flush()

    def user(role, org, email, agence=None):
        u = Utilisateur(id=uuid.uuid4(), organisation_id=org.id, agence_id=agence.id if agence else None, nom="N", prenom="P", email=email,
                        mot_de_passe_hash=HACHAGE, role=role, active=True, created_by_id=None)
        db.add(u); db.flush()
        return u

    acteurs = SimpleNamespace(
        admin_p=user(UserRole.ADMIN, org_p, "admin.p@test.io"), admin_q=user(UserRole.ADMIN, org_p, "admin.q@test.io"),
        cx_x=user(UserRole.CX_MANAGER, org_x, "cx.x@test.io"), am_x1=user(UserRole.AGENCY_MANAGER, org_x, "am.x1@test.io", ag_x1),
    )
    # Données clients « piège » : ne doivent jamais se retrouver dans le journal.
    fb = Feedback(id=uuid.uuid4(), qr_code_id=qr.id, note=1, commentaire=PIEGE_AVIS, statut_traitement="nouveau")
    db.add(fb); db.flush()
    db.add(DemandeContact(id=uuid.uuid4(), feedback_id=fb.id, nom="Client Piege", telephone=PIEGE_TEL, email="client.piege@exemple.org", souhaite_etre_rappele=True))
    db.commit()
    ids = SimpleNamespace(**{k: v.id for k, v in vars(acteurs).items()}, org_p=org_p.id, org_x=org_x.id, ag_x1=ag_x1.id, ag_x2=ag_x2.id, qr=qr.id)
    mails = SimpleNamespace(**{k: v.email for k, v in vars(acteurs).items()})
    db.close()
    c = SimpleNamespace(client=TestClient(app), moteur=moteur, Session=Session, ids=ids, mails=mails, app=app,
                        H=lambda uid: {"Authorization": f"Bearer {create_access_token(uid)}"})
    return c


def lignes(ctx, **filtres):
    db = ctx.Session()
    try:
        requete = select(JournalAudit).order_by(JournalAudit.date_action, JournalAudit.id)
        for cle, valeur in filtres.items():
            requete = requete.where(getattr(JournalAudit, cle) == valeur)
        return list(db.scalars(requete))
    finally:
        db.close()


def une(ctx, action, **filtres):
    trouvees = lignes(ctx, action=action, **filtres)
    assert len(trouvees) == 1, f"{action} : {len(trouvees)} ligne(s)"
    return trouvees[0]


def compter_insertions(ctx):
    """Compte les INSERT dans journal_audit émis pendant le bloc."""
    class Compteur:
        n = 0
    c = Compteur()

    def ecouteur(conn, cursor, statement, *a):
        if statement.lstrip().upper().startswith("INSERT INTO JOURNAL_AUDIT"):
            c.n += 1

    event.listen(ctx.moteur, "before_cursor_execute", ecouteur)
    return c, lambda: event.remove(ctx.moteur, "before_cursor_execute", ecouteur)


# ───────────────────────── organisations et forfaits ─────────────────────────

def test_creation_d_organisation(ctx):
    r = ctx.client.post("/organisations/", headers=ctx.H(ctx.ids.admin_p),
                        json={"nom": "Nouvelle Org", "secteur_code": "telecom", "pays_region": "Burkina Faso", "email_pro": "contact@nouvelle.io"})
    assert r.status_code == 201, r.text
    org_id = r.json()["id"]
    ligne = une(ctx, journal.ORGANISATION_CREEE)
    assert (ligne.acteur_id, ligne.acteur_role, ligne.acteur_email) == (ctx.ids.admin_p, "admin", ctx.mails.admin_p)
    assert (ligne.cible_type, ligne.cible_id, ligne.cible_libelle, str(ligne.organisation_id).replace("-", "")) == ("organisation", org_id, "Nouvelle Org", org_id.replace("-", ""))
    assert ligne.resultat == "succes" and ligne.details == {"secteur_code": "telecom"}


def test_modification_desactivation_et_reactivation_d_organisation(ctx):
    h = ctx.H(ctx.ids.admin_p)
    assert ctx.client.patch(f"/organisations/{ctx.ids.org_x}", headers=h, json={"nom": "Client X renommé"}).status_code == 200
    modif = une(ctx, journal.ORGANISATION_MODIFIEE)
    assert modif.details == {"champs": ["nom"], "avant": {"nom": "Client X"}, "apres": {"nom": "Client X renommé"}} and modif.cible_libelle == "Client X renommé"

    assert ctx.client.patch(f"/organisations/{ctx.ids.org_x}", headers=h, json={"active": False}).status_code == 200
    desactivee = une(ctx, journal.ORGANISATION_DESACTIVEE)
    assert desactivee.details == {"avant": {"active": True}, "apres": {"active": False}}
    assert desactivee.organisation_id == ctx.ids.org_x and desactivee.acteur_role == "admin"

    assert ctx.client.patch(f"/organisations/{ctx.ids.org_x}", headers=h, json={"active": True}).status_code == 200
    reactivee = une(ctx, journal.ORGANISATION_REACTIVEE)
    assert reactivee.details == {"avant": {"active": False}, "apres": {"active": True}}
    assert len(lignes(ctx, action=journal.ORGANISATION_MODIFIEE)) == 1                 # activer / désactiver n'est pas une « modification »


def test_un_patch_qui_ne_change_rien_d_actif_n_ecrit_pas_de_desactivation(ctx):
    assert ctx.client.patch(f"/organisations/{ctx.ids.org_x}", headers=ctx.H(ctx.ids.admin_p), json={"active": True}).status_code == 200
    assert lignes(ctx, action=journal.ORGANISATION_DESACTIVEE) == [] and lignes(ctx, action=journal.ORGANISATION_REACTIVEE) == []


def test_changement_de_forfait_trace_dans_le_journal_et_toujours_dans_changements_plan(ctx):
    r = ctx.client.patch(f"/organisations/{ctx.ids.org_x}/plan", headers=ctx.H(ctx.ids.admin_p),
                         json={"plan_id": str(PLAN_B), "raison": "Partenariat négocié avec le client"})
    assert r.status_code == 200, r.text
    ligne = une(ctx, journal.FORFAIT_MODIFIE)
    assert ligne.details == {"avant": {"plan_id": str(PLAN_A)}, "apres": {"plan_id": str(PLAN_B)}, "source": "admin_override"}
    assert ligne.organisation_id == ctx.ids.org_x and ligne.cible_libelle == "Client X"
    db = ctx.Session()
    try:
        assert db.query(ChangementPlan).filter(ChangementPlan.source == "admin_override").count() == 1        # l'existant est conservé
    finally:
        db.close()
    # même forfait : rien ne change, rien n'est écrit
    ctx.client.patch(f"/organisations/{ctx.ids.org_x}/plan", headers=ctx.H(ctx.ids.admin_p), json={"plan_id": str(PLAN_B), "raison": "Même forfait, aucun effet"})
    assert len(lignes(ctx, action=journal.FORFAIT_MODIFIE)) == 1


# ───────────────────────── comptes ─────────────────────────

def test_creation_de_compte_par_l_admin_et_par_le_cx(ctx):
    r = ctx.client.post("/utilisateurs/", headers=ctx.H(ctx.ids.admin_p), json={
        "nom": "Dupont", "prenom": "Awa", "email": "nouveau.cx@test.io", "password": PIEGE_MDP, "role": "cx_manager", "organisation_id": str(ctx.ids.org_x)})
    assert r.status_code == 201, r.text
    ligne = une(ctx, journal.COMPTE_CREE, acteur_role="admin")
    assert (ligne.cible_type, ligne.cible_id, ligne.cible_libelle, ligne.organisation_id) == ("utilisateur", r.json()["id"], "nouveau.cx@test.io", ctx.ids.org_x)
    assert ligne.details == {"role": "cx_manager", "agence_id": None} and ligne.resultat == "succes" and ligne.acteur_id == ctx.ids.admin_p

    r2 = ctx.client.post("/utilisateurs/", headers=ctx.H(ctx.ids.cx_x), json={
        "nom": "Traore", "prenom": "Ali", "email": "nouveau.am@test.io", "password": PIEGE_MDP, "role": "agency_manager", "agence_id": str(ctx.ids.ag_x2)})
    assert r2.status_code == 201, r2.text
    ligne_cx = une(ctx, journal.COMPTE_CREE, acteur_role="cx_manager")
    assert (ligne_cx.acteur_email, ligne_cx.cible_libelle, ligne_cx.details) == (ctx.mails.cx_x, "nouveau.am@test.io", {"role": "agency_manager", "agence_id": str(ctx.ids.ag_x2)})


def test_modification_de_compte_avant_apres_sans_secret(ctx):
    r = ctx.client.patch(f"/utilisateurs/{ctx.ids.am_x1}", headers=ctx.H(ctx.ids.cx_x),
                         json={"agence_id": str(ctx.ids.ag_x2), "password": PIEGE_NOUVEAU_MDP, "nom": "Autre Nom"})
    assert r.status_code == 200, r.text
    ligne = une(ctx, journal.COMPTE_MODIFIE)
    assert ligne.details["champs"] == ["agence_id", "mot_de_passe", "nom"]                     # le NOM du champ mot de passe, jamais sa valeur
    assert ligne.details["avant"] == {"agence_id": str(ctx.ids.ag_x1)} and ligne.details["apres"] == {"agence_id": str(ctx.ids.ag_x2)}
    assert ligne.acteur_role == "cx_manager" and ligne.cible_libelle == ctx.mails.am_x1 and ligne.organisation_id == ctx.ids.org_x
    assert PIEGE_NOUVEAU_MDP not in str(ligne.details) and "argon2" not in str(ligne.details)


def test_changement_d_e_mail_de_compte_du_personnel_avant_apres(ctx):
    ctx.client.patch(f"/utilisateurs/{ctx.ids.am_x1}", headers=ctx.H(ctx.ids.cx_x), json={"email": "NOUVEAU.am.x1@test.io"})
    ligne = une(ctx, journal.COMPTE_MODIFIE)
    assert ligne.details["avant"] == {"email": ctx.mails.am_x1} and ligne.details["apres"] == {"email": "nouveau.am.x1@test.io"}


def test_suspension_par_patch_et_par_suppression(ctx):
    assert ctx.client.patch(f"/utilisateurs/{ctx.ids.am_x1}", headers=ctx.H(ctx.ids.cx_x), json={"active": False}).status_code == 200
    par_patch = une(ctx, journal.COMPTE_SUSPENDU)
    assert par_patch.details["avant"] == {"active": True} and par_patch.details["apres"] == {"active": False}
    assert lignes(ctx, action=journal.COMPTE_MODIFIE) == []

    r = ctx.client.delete(f"/utilisateurs/{ctx.ids.cx_x}", headers=ctx.H(ctx.ids.admin_p))
    assert r.status_code == 204
    suspendu = lignes(ctx, action=journal.COMPTE_SUSPENDU, cible_id=str(ctx.ids.cx_x))
    assert len(suspendu) == 1 and suspendu[0].acteur_role == "admin" and suspendu[0].details == {"avant": {"active": True}, "apres": {"active": False}}
    db = ctx.Session()
    try:
        assert db.get(Utilisateur, ctx.ids.cx_x).active is False                                # historique conservé : suspension, pas suppression
    finally:
        db.close()


def test_creation_d_administrateur_par_la_commande(ctx):
    from scripts.creer_admin import creer_admin

    db = ctx.Session()
    try:
        email = creer_admin(db, "Nouvel.Admin@Test.io", PIEGE_MDP, PIEGE_MDP, ajouter=True)
    finally:
        db.close()
    ligne = une(ctx, journal.COMPTE_ADMIN_CREE)
    assert (ligne.acteur_id, ligne.acteur_role, ligne.acteur_email) == (None, "systeme", None)
    assert ligne.cible_libelle == email == "nouvel.admin@test.io" and ligne.organisation_id == ctx.ids.org_p
    assert ligne.details == {"role": "admin", "ajout": True, "origine": "commande"}
    assert PIEGE_MDP not in str(ligne.details)


# ───────────────────────── agences, QR codes, paramètres ─────────────────────────

def test_agences_creation_modification_photo_et_suppression(ctx):
    h = ctx.H(ctx.ids.cx_x)
    r = ctx.client.post("/agences/", headers=h, json={"nom": "Agence Neuve", "ville": "Nice"})
    assert r.status_code == 201, r.text
    agence_id = r.json()["id"]
    creee = une(ctx, journal.AGENCE_CREEE)
    assert (creee.cible_type, creee.cible_id, creee.cible_libelle, creee.organisation_id, creee.acteur_role) == ("agence", agence_id, "Agence Neuve", ctx.ids.org_x, "cx_manager")

    assert ctx.client.patch(f"/agences/{agence_id}", headers=h, json={"ville": "Marseille", "active": False}).status_code == 200
    modif = une(ctx, journal.AGENCE_MODIFIEE)
    assert modif.details == {"champs": ["active", "ville"], "avant": {"ville": "Nice", "active": True}, "apres": {"ville": "Marseille", "active": False}}

    assert ctx.client.patch(f"/agences/{agence_id}/photo", headers=h, json={"photo": "data:image/png;base64,AAAA"}).status_code == 200
    photos = [l for l in lignes(ctx, action=journal.AGENCE_MODIFIEE) if l.details == {"champs": ["photo"]}]
    assert len(photos) == 1 and "AAAA" not in str(photos[0].details)                                # jamais le contenu de la photo

    assert ctx.client.delete(f"/agences/{agence_id}", headers=h).status_code == 204
    supprimee = une(ctx, journal.AGENCE_SUPPRIMEE)
    assert (supprimee.cible_id, supprimee.cible_libelle, supprimee.organisation_id) == (agence_id, "Agence Neuve", ctx.ids.org_x)


def test_suppression_d_agence_refusee_car_elle_a_des_avis_n_ecrit_pas_de_suppression(ctx):
    r = ctx.client.delete(f"/agences/{ctx.ids.ag_x1}", headers=ctx.H(ctx.ids.cx_x))
    assert r.status_code == 409
    assert lignes(ctx, action=journal.AGENCE_SUPPRIMEE) == []


def test_suppression_de_qr_code_par_l_admin(ctx):
    assert ctx.client.delete(f"/qr-codes/{ctx.ids.qr}", headers=ctx.H(ctx.ids.admin_p)).status_code == 204
    ligne = une(ctx, journal.QR_SUPPRIME)
    assert (ligne.cible_type, ligne.cible_id, ligne.cible_libelle, ligne.organisation_id, ligne.acteur_role) == ("qr_code", str(ctx.ids.qr), "Borne X1", ctx.ids.org_x, "admin")
    assert ligne.details == {"agence_id": str(ctx.ids.ag_x1), "actif": True}


def test_parametres_systeme(ctx):
    r = ctx.client.patch("/system/settings", headers=ctx.H(ctx.ids.admin_p), json={"retention_mois": 18, "notifications_email_actives": False})
    assert r.status_code == 200, r.text
    ligne = une(ctx, journal.PARAMETRES_MODIFIES)
    assert ligne.details["champs"] == ["notifications_email_actives", "retention_mois"] and ligne.details["apres"] == {"retention_mois": 18, "notifications_email_actives": False}
    assert ligne.details["avant"]["retention_mois"] != 18 and ligne.acteur_role == "admin" and ligne.cible_type == "parametres"
    assert ctx.client.patch("/system/settings", headers=ctx.H(ctx.ids.admin_p), json={}).status_code == 200
    assert len(lignes(ctx, action=journal.PARAMETRES_MODIFIES)) == 1                                      # une requête vide ne trace rien


# ───────────────────────── refus de la règle « dernier administrateur » ─────────────────────────

def test_refus_auto_protection_trace_et_reponse_inchangee(ctx):
    r2 = ctx.client.patch(f"/organisations/{ctx.ids.org_p}", headers=ctx.H(ctx.ids.admin_p), json={"active": False})
    assert r2.status_code == 409 and r2.json()["detail"] == MESSAGE_AUTO_PROTECTION
    refus = une(ctx, journal.REFUS_DERNIER_ADMIN)
    assert (refus.resultat, refus.acteur_id, refus.acteur_role, refus.cible_type, refus.cible_id) == ("refus", ctx.ids.admin_p, "admin", "organisation", str(ctx.ids.org_p))
    assert refus.details == {"motif": "auto_protection"} and refus.organisation_id == ctx.ids.org_p
    assert lignes(ctx, action=journal.ORGANISATION_DESACTIVEE) == []                                       # l'action refusée n'écrit pas de succès
    db = ctx.Session()
    try:
        assert db.get(Organisation, ctx.ids.org_p).active is True                                          # rien n'a changé
    finally:
        db.close()


def test_refus_dernier_administrateur_par_les_voies_de_la_regle(ctx):
    from fastapi import HTTPException
    from app.services import administrateurs

    db = ctx.Session()
    try:
        db.query(Utilisateur).filter(Utilisateur.id == ctx.ids.admin_q).delete(); db.commit()
        acteur = db.get(Utilisateur, ctx.ids.cx_x)
        cible = db.get(Utilisateur, ctx.ids.admin_p)
        with pytest.raises(HTTPException) as refus:
            administrateurs.controler_retrait_compte(db, cible, acteur)
        assert refus.value.status_code == 409 and refus.value.detail == MESSAGE_DERNIER_ADMIN
    finally:
        db.close()
    ligne = une(ctx, journal.REFUS_DERNIER_ADMIN)
    assert ligne.details == {"motif": "dernier_administrateur"} and ligne.cible_libelle == ctx.mails.admin_p and ligne.acteur_role == "cx_manager"


def test_le_refus_est_trace_meme_si_le_journal_est_indisponible_et_la_reponse_ne_change_pas(ctx):
    with ctx.moteur.begin() as c:
        c.execute(text("DROP TABLE journal_audit"))
    r = ctx.client.patch(f"/organisations/{ctx.ids.org_p}", headers=ctx.H(ctx.ids.admin_p), json={"active": False})
    assert r.status_code == 409 and r.json()["detail"] == MESSAGE_AUTO_PROTECTION


# ───────────────────────── connexions échouées et limitées ─────────────────────────

def connexion(ctx, email, mdp="Mauvais-Mdp-123", entetes=None):
    return ctx.client.post("/auth/login", json={"email": email, "password": mdp}, headers=entetes or {})


def test_echec_de_connexion_sur_un_compte_existant(ctx):
    r = connexion(ctx, ctx.mails.cx_x.upper())
    assert r.status_code == 401 and r.json() == {"detail": "Email ou mot de passe incorrect"}
    ligne = une(ctx, journal.CONNEXION_ECHOUEE)
    assert (ligne.resultat, ligne.acteur_id, ligne.acteur_role, ligne.acteur_email) == ("refus", None, "anonyme", None)
    assert (ligne.cible_type, ligne.cible_id, ligne.cible_libelle, ligne.organisation_id) == ("utilisateur", str(ctx.ids.cx_x), ctx.mails.cx_x, ctx.ids.org_x)


def test_echec_sur_un_compte_inconnu_n_enregistre_ni_la_valeur_saisie_ni_son_hachage(ctx):
    saisie = "inconnu.vraiment@test.io"
    assert connexion(ctx, saisie).status_code == 401
    ligne = une(ctx, journal.CONNEXION_ECHOUEE)
    assert (ligne.cible_type, ligne.cible_id, ligne.cible_libelle, ligne.organisation_id) == (None, None, "compte inconnu", None)
    assert saisie.split("@")[0] not in repr(vars(ligne))


def test_valeur_piege_ressemblant_a_un_mot_de_passe_colle_dans_le_champ_e_mail(ctx):
    piege = f"{PIEGE_MDP}@piege.io"                        # un mot de passe collé à la place de l'e-mail (forme valide pour être acceptée)
    assert connexion(ctx, piege, mdp=PIEGE_MDP).status_code == 401
    ligne = une(ctx, journal.CONNEXION_ECHOUEE)
    assert ligne.cible_libelle == "compte inconnu"
    tout = repr(lignes(ctx)[0].__dict__) + str([vars(l) for l in lignes(ctx)])
    for interdit in (PIEGE_MDP, PIEGE_MDP.lower(), "piege.io", "Piege-MotDePasse"):
        assert interdit.lower() not in tout.lower(), interdit
    # même chose si le champ ne contient aucun « @ » : refusé par la validation (422), rien n'est écrit
    assert ctx.client.post("/auth/login", json={"email": PIEGE_MDP, "password": PIEGE_MDP}).status_code == 422
    assert len(lignes(ctx)) == 1


def test_une_seule_ligne_par_adresse_compte_et_fenetre_de_15_minutes(ctx):
    for _ in range(4):
        assert connexion(ctx, ctx.mails.cx_x).status_code in (401, 429)
    assert len(lignes(ctx, action=journal.CONNEXION_ECHOUEE)) == 1                                     # pas une ligne par essai
    for _ in range(3):
        connexion(ctx, "inconnu.a@test.io")
    assert len(lignes(ctx, action=journal.CONNEXION_ECHOUEE, cible_libelle="compte inconnu")) == 1     # idem pour les comptes inconnus
    connexion(ctx, ctx.mails.am_x1)
    assert len(lignes(ctx, action=journal.CONNEXION_ECHOUEE)) == 3                                     # un autre compte : une nouvelle ligne


def test_une_nouvelle_ligne_apres_la_fenetre(ctx, monkeypatch):
    connexion(ctx, ctx.mails.cx_x)
    monkeypatch.setattr(journal, "FENETRE_CONNEXION", timedelta(seconds=0))
    time.sleep(0.01)
    connexion(ctx, ctx.mails.cx_x)
    assert len(lignes(ctx, action=journal.CONNEXION_ECHOUEE, cible_id=str(ctx.ids.cx_x))) == 2


def test_adresses_differentes_lignes_differentes_et_adresse_tronquee(ctx, monkeypatch):
    monkeypatch.setattr(settings, "SSR_FORWARD_SECRET", "secret-de-test-journal")
    for ip in ("203.0.113.77", "203.0.113.200", "198.51.100.5", "2001:db8:abcd:12::99"):
        r = connexion(ctx, ctx.mails.cx_x, entetes={"x-ikan-ssr-secret": "secret-de-test-journal", "x-ikan-client-ip": ip})
        assert r.status_code == 401
    adresses = sorted(l.adresse_ip for l in lignes(ctx, action=journal.CONNEXION_ECHOUEE))
    assert adresses == sorted(["203.0.113.0", "198.51.100.0", "2001:db8:abcd::"])
    assert len(adresses) == 3                                           # 203.0.113.77 et .200 partagent le même /24 : une seule ligne


def test_connexion_limitee_apres_le_seuil_de_la_pr_37(ctx, monkeypatch):
    monkeypatch.setattr(settings, "LOGIN_MAX_ECHECS_PAR_COUPLE", 2)
    assert connexion(ctx, ctx.mails.cx_x).status_code == 401
    assert connexion(ctx, ctx.mails.cx_x).status_code == 401
    r = connexion(ctx, ctx.mails.cx_x)
    assert r.status_code == 429 and "Retry-After" in r.headers
    limitee = une(ctx, journal.CONNEXION_LIMITEE)
    assert (limitee.resultat, limitee.cible_libelle, limitee.cible_id) == ("refus", ctx.mails.cx_x, str(ctx.ids.cx_x))
    connexion(ctx, ctx.mails.cx_x)
    assert len(lignes(ctx, action=journal.CONNEXION_LIMITEE)) == 1                                       # dédoublonnée aussi
    assert len(lignes(ctx, action=journal.CONNEXION_ECHOUEE)) == 1


def test_connexion_limitee_sur_un_compte_inconnu_ne_garde_pas_la_valeur(ctx, monkeypatch):
    monkeypatch.setattr(settings, "LOGIN_MAX_ECHECS_PAR_COUPLE", 1)
    connexion(ctx, "fantome.secret@test.io"); connexion(ctx, "fantome.secret@test.io")
    limitee = une(ctx, journal.CONNEXION_LIMITEE)
    assert limitee.cible_libelle == "compte inconnu" and "fantome" not in str(vars(limitee))


def test_une_connexion_reussie_n_ecrit_rien(ctx):
    r = connexion(ctx, ctx.mails.cx_x, mdp=MDP)
    assert r.status_code == 200
    assert lignes(ctx) == []


def test_si_le_journal_est_indisponible_la_reponse_401_est_inchangee(ctx, caplog):
    avant = connexion(ctx, ctx.mails.cx_x)
    with ctx.moteur.begin() as c:
        c.execute(text("DROP TABLE journal_audit"))
    with caplog.at_level("ERROR", logger="ikan.journal_audit"):
        apres = connexion(ctx, "autre.compte@test.io")
    assert (apres.status_code, apres.json()) == (avant.status_code, avant.json()) == (401, {"detail": "Email ou mot de passe incorrect"})
    assert any("Écriture du journal d'audit impossible" in r.getMessage() for r in caplog.records)
    assert "autre.compte" not in " ".join(r.getMessage() for r in caplog.records)                         # le journal technique ne contient pas la saisie


def test_ecriture_differee_ne_retarde_pas_la_reponse(ctx, monkeypatch):
    monkeypatch.setattr(journal, "EXECUTION_DIFFEREE", True)
    ecrites = []
    vraie = journal._ecrire

    def lente(bind, ligne, dedoublonner, email=None):
        time.sleep(1.0)
        ecrites.append(1)
        return vraie(bind, ligne, dedoublonner, email)

    monkeypatch.setattr(journal, "_ecrire", lente)
    debut = time.perf_counter()
    r = connexion(ctx, ctx.mails.cx_x)
    duree = time.perf_counter() - debut
    assert r.status_code == 401
    assert duree < 0.6, f"la réponse a attendu l'écriture du journal ({duree:.2f} s)"
    for _ in range(50):                                                 # la ligne finit par être écrite, en arrière-plan
        if lignes(ctx, action=journal.CONNEXION_ECHOUEE):
            break
        time.sleep(0.1)
    assert len(lignes(ctx, action=journal.CONNEXION_ECHOUEE)) == 1 and ecrites == [1]


def test_file_d_ecriture_saturee_abandonne_sans_gener_la_reponse(ctx, monkeypatch, caplog):
    monkeypatch.setattr(journal, "EXECUTION_DIFFEREE", True)
    monkeypatch.setattr(journal, "_EN_ATTENTE", threading.BoundedSemaphore(0))
    with caplog.at_level("ERROR", logger="ikan.journal_audit"):
        assert connexion(ctx, ctx.mails.cx_x).status_code == 401
    assert lignes(ctx) == [] and any("saturé" in r.getMessage() for r in caplog.records)


# ───────────────────────── transaction, volume SQL, rollback ─────────────────────────

def test_une_seule_insertion_par_action(ctx):
    h = ctx.H(ctx.ids.admin_p)
    actions = [
        lambda: ctx.client.patch(f"/organisations/{ctx.ids.org_x}", headers=h, json={"active": False}),
        lambda: ctx.client.patch(f"/organisations/{ctx.ids.org_x}", headers=h, json={"active": True}),
        lambda: ctx.client.patch(f"/organisations/{ctx.ids.org_x}/plan", headers=h, json={"plan_id": str(PLAN_B), "raison": "Partenariat négocié ok"}),
        lambda: ctx.client.patch(f"/utilisateurs/{ctx.ids.cx_x}", headers=h, json={"active": True}),
        lambda: ctx.client.delete(f"/qr-codes/{ctx.ids.qr}", headers=h),
        lambda: ctx.client.patch("/system/settings", headers=h, json={"retention_mois": 20}),
        lambda: ctx.client.post("/agences/", headers=ctx.H(ctx.ids.cx_x), json={"nom": "Une Agence"}),
    ]
    for action in actions:
        compteur, retirer = compter_insertions(ctx)
        try:
            assert action().status_code < 300
        finally:
            retirer()
        assert compteur.n == 1


def test_une_action_annulee_ne_laisse_aucune_ligne_de_succes(ctx, monkeypatch):
    """Course sur l'e-mail : la vérification passe, la contrainte d'unicité refuse à l'enregistrement : le compte ET sa ligne de journal sont annulés."""
    monkeypatch.setattr(utilisateurs, "_email_deja_pris", lambda *a, **k: False)
    r = ctx.client.post("/utilisateurs/", headers=ctx.H(ctx.ids.cx_x), json={
        "nom": "Doublon", "prenom": "X", "email": ctx.mails.am_x1, "password": PIEGE_MDP, "role": "agency_manager", "agence_id": str(ctx.ids.ag_x1)})
    assert r.status_code in (400, 409)
    assert lignes(ctx, action=journal.COMPTE_CREE) == []
    db = ctx.Session()
    try:
        assert db.query(Utilisateur).filter(Utilisateur.nom == "Doublon").count() == 0
    finally:
        db.close()


def test_la_ligne_de_succes_est_dans_la_meme_transaction_que_l_action(ctx):
    """Sans journal, une action de succès ne se fait PAS : l'écriture est atomique avec elle (la table manque = l'action échoue entièrement)."""
    with ctx.moteur.begin() as c:
        c.execute(text("DROP TABLE journal_audit"))
    with pytest.raises(Exception):
        ctx.client.patch(f"/organisations/{ctx.ids.org_x}", headers=ctx.H(ctx.ids.admin_p), json={"nom": "Ne doit pas être enregistré"})
    db = ctx.Session()
    try:
        assert db.get(Organisation, ctx.ids.org_x).nom == "Client X"
    finally:
        db.close()


def test_journaliser_n_a_pas_de_commit_il_suit_le_sort_de_la_session(ctx):
    db = ctx.Session()
    journal.journaliser(db, action=journal.PARAMETRES_MODIFIES, acteur=db.get(Utilisateur, ctx.ids.admin_p), cible_type="parametres")
    db.flush()
    db.rollback(); db.close()
    assert lignes(ctx) == []


# ───────────────────────── aucune donnée sensible ─────────────────────────

def test_aucune_donnee_sensible_dans_tout_le_journal_apres_toutes_les_actions(ctx):
    h = ctx.H(ctx.ids.admin_p)
    ctx.client.post("/utilisateurs/", headers=h, json={"nom": "A", "prenom": "B", "email": "piege.compte@test.io", "password": PIEGE_MDP, "role": "cx_manager", "organisation_id": str(ctx.ids.org_x)})
    ctx.client.patch(f"/utilisateurs/{ctx.ids.am_x1}", headers=ctx.H(ctx.ids.cx_x), json={"password": PIEGE_NOUVEAU_MDP})
    ctx.client.patch(f"/organisations/{ctx.ids.org_x}", headers=h, json={"nom": "Org Piège", "active": False})
    ctx.client.delete(f"/qr-codes/{ctx.ids.qr}", headers=h)
    ctx.client.patch("/system/settings", headers=h, json={"nom_application": "IKAN"})
    ctx.client.delete(f"/agences/{ctx.ids.ag_x2}", headers=ctx.H(ctx.ids.cx_x))
    connexion(ctx, ctx.mails.admin_p, mdp=PIEGE_MDP)
    connexion(ctx, f"{PIEGE_MDP}@x.io", mdp=PIEGE_NOUVEAU_MDP)
    reussie = connexion(ctx, ctx.mails.admin_q, mdp=MDP)
    jeton = reussie.json()["access_token"]
    ctx.client.get("/admin/journal", headers=h)
    brut = " ".join(repr(l.__dict__) for l in lignes(ctx)) + " " + ctx.client.get("/admin/journal", headers=h, params={"limit": 200}).text
    assert len(lignes(ctx)) >= 7
    for interdit in (PIEGE_MDP, PIEGE_NOUVEAU_MDP, HACHAGE[:25], "$argon2", PIEGE_AVIS, PIEGE_TEL, "client.piege@exemple.org", "Client Piege", jeton, jeton[:40],
                     "Bearer", "access_token", "refresh_token", "mot_de_passe_hash", "password"):
        assert interdit not in brut, interdit


@pytest.mark.parametrize("cle", ["password", "mot_de_passe", "mot_de_passe_hash", "hash", "token", "access_token", "jeton", "secret", "telephone", "phone",
                                 "commentaire", "contact_email", "texte_avis", "message", "authorization", "cookie"])
def test_assainir_details_supprime_toute_cle_sensible(cle):
    assert journal.assainir_details({cle: "VALEUR-SENSIBLE", "champs": ["role"]}) == {"champs": ["role"]}
    assert journal.assainir_details({"avant": {cle: "VALEUR-SENSIBLE", "role": "admin"}}) == {"avant": {"role": "admin"}}


def test_assainir_details_types_simples_taille_bornee_et_objets_inconnus():
    class Inconnu:
        def __repr__(self):
            return "OBJET-SECRET"

    resultat = journal.assainir_details({"x": Inconnu(), "n": 3, "ok": True, "id": uuid.UUID(int=5), "role": UserRole.ADMIN, "long": "a" * 1000, "liste": list(range(80))})
    assert resultat["x"] is None and "OBJET-SECRET" not in str(resultat)
    assert resultat["n"] == 3 and resultat["ok"] is True and resultat["id"] == str(uuid.UUID(int=5)) and resultat["role"] == "admin"
    assert len(resultat["long"]) == 200 and len(resultat["liste"]) == 50
    assert journal.assainir_details({f"cle{i}": "x" * 190 for i in range(30)}) == {"tronque": True}
    assert journal.assainir_details(None) is None and journal.assainir_details({}) is None


@pytest.mark.parametrize("adresse,attendu", [
    ("203.0.113.77", "203.0.113.0"), ("10.1.2.3", "10.1.2.0"), ("2001:db8:abcd:12::99", "2001:db8:abcd::"), ("::ffff:198.51.100.9", "198.51.100.0"),
    ("pas une adresse", None), ("testclient", None), ("", None), (None, None), ("inconnue", None),
])
def test_tronquer_ip(adresse, attendu):
    assert journal.tronquer_ip(adresse) == attendu


def test_x_forwarded_for_n_est_jamais_cru_pour_l_adresse_du_journal(ctx):
    connexion(ctx, ctx.mails.cx_x, entetes={"x-forwarded-for": "198.51.100.99"})
    assert une(ctx, journal.CONNEXION_ECHOUEE).adresse_ip is None                                 # l'adresse du socket de test est illisible : rien d'inventé


# ───────────────────────── lecture : rôles, pagination, filtres, volume ─────────────────────────

def ajouter_lignes(ctx, n=120):
    db = ctx.Session()
    base = datetime.now(timezone.utc) - timedelta(days=10)
    acteurs = [(ctx.ids.admin_p, "admin", ctx.mails.admin_p), (ctx.ids.admin_q, "admin", ctx.mails.admin_q), (ctx.ids.cx_x, "cx_manager", ctx.mails.cx_x)]
    actions = [journal.COMPTE_CREE, journal.ORGANISATION_MODIFIEE, journal.AGENCE_CREEE]
    for i in range(n):
        aid, role, mail = acteurs[i % 3]
        db.add(JournalAudit(id=uuid.uuid4(), date_action=base + timedelta(hours=i * 2), acteur_id=aid, acteur_role=role, acteur_email=mail,
                            action=actions[i % 3], cible_type="x", cible_id=str(i), organisation_id=ctx.ids.org_x if i % 2 == 0 else ctx.ids.org_p,
                            resultat="refus" if i % 5 == 0 else "succes", details={"i": i}))
    db.commit(); db.close()


def lire(ctx, acteur="admin_p", **params):
    return ctx.client.get("/admin/journal", headers=ctx.H(getattr(ctx.ids, acteur)), params=params)


@pytest.mark.parametrize("acteur,code", [("cx_x", 403), ("am_x1", 403)])
def test_acces_par_role(ctx, acteur, code):
    refus = lire(ctx, acteur)
    assert refus.status_code == code and refus.json() == {"detail": "Accès réservé aux administrateurs"}
    assert ctx.client.get("/admin/journal").status_code == 401
    assert lire(ctx, "admin_p").status_code == 200


def test_pagination_total_tri_et_limite_de_taille(ctx):
    ajouter_lignes(ctx)
    r = lire(ctx, limit=50)
    assert r.status_code == 200 and int(r.headers["X-Total-Count"]) == 120 and len(r.json()) == 50
    dates = [l["date_action"] for l in r.json()]
    assert dates == sorted(dates, reverse=True)
    vus = []
    for offset in range(0, 140, 50):
        page = lire(ctx, limit=50, offset=offset)
        assert int(page.headers["X-Total-Count"]) == 120
        vus += [l["id"] for l in page.json()]
    assert len(vus) == len(set(vus)) == 120
    assert lire(ctx, limit=50, offset=500).json() == []
    assert lire(ctx, limit=201).status_code == 422 and lire(ctx, limit=0).status_code == 422 and lire(ctx, offset=-1).status_code == 422
    assert len(lire(ctx, limit=200).json()) == 120


def test_filtres_periode_acteur_action_organisation_resultat(ctx):
    ajouter_lignes(ctx)
    assert int(lire(ctx, resultat="refus").headers["X-Total-Count"]) == 24                             # i multiple de 5
    assert int(lire(ctx, resultat="succes").headers["X-Total-Count"]) == 96
    assert int(lire(ctx, action=journal.COMPTE_CREE).headers["X-Total-Count"]) == 40
    assert int(lire(ctx, acteur_id=str(ctx.ids.cx_x)).headers["X-Total-Count"]) == 40
    assert int(lire(ctx, acteur_email=ctx.mails.admin_q.upper()).headers["X-Total-Count"]) == 40
    assert int(lire(ctx, organisation_id=str(ctx.ids.org_x)).headers["X-Total-Count"]) == 60
    debut = (datetime.now(timezone.utc) - timedelta(days=5)).isoformat()
    fin = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
    recent = lire(ctx, date_debut=debut)
    assert 0 < int(recent.headers["X-Total-Count"]) < 120 and all(l["date_action"] >= debut[:19] for l in recent.json())
    fenetre = lire(ctx, date_debut=debut, date_fin=fin)
    assert 0 < int(fenetre.headers["X-Total-Count"]) < int(recent.headers["X-Total-Count"])
    # combinaison en ET
    combine = lire(ctx, action=journal.COMPTE_CREE, resultat="refus", organisation_id=str(ctx.ids.org_x))
    assert all(l["action"] == journal.COMPTE_CREE and l["resultat"] == "refus" and l["organisation_id"].replace("-", "") == str(ctx.ids.org_x).replace("-", "") for l in combine.json())
    assert lire(ctx, resultat="inconnu").status_code == 422
    assert lire(ctx, action="n.existe.pas").json() == []


def test_nombre_de_requetes_sql_constant(ctx):
    def requetes(n_lignes):
        compteur = []

        def ecouteur(conn, cursor, statement, *a):
            compteur.append(statement)

        event.listen(ctx.moteur, "before_cursor_execute", ecouteur)
        try:
            assert lire(ctx, limit=50).status_code == 200
        finally:
            event.remove(ctx.moteur, "before_cursor_execute", ecouteur)
        return len(compteur)

    ajouter_lignes(ctx, 5)
    petit = requetes(5)
    ajouter_lignes(ctx, 200)
    grand = requetes(205)
    assert petit == grand
    assert petit == grand == 3                         # authentification, comptage, page : constant


def test_le_journal_ne_devoile_aucun_contact_ni_avis(ctx):
    ajouter_lignes(ctx, 10)
    ctx.client.delete(f"/qr-codes/{ctx.ids.qr}", headers=ctx.H(ctx.ids.admin_p))
    corps = lire(ctx).text
    for interdit in (PIEGE_TEL, PIEGE_AVIS, "client.piege@exemple.org", "Client Piege"):
        assert interdit not in corps


# ───────────────────────── ajout seul ─────────────────────────

def test_aucune_route_de_modification_ni_de_suppression_du_journal():
    from app.main import app

    chemins = {chemin: set(methodes) for chemin, methodes in app.openapi()["paths"].items() if "journal" in chemin.lower()}
    assert chemins == {"/api/v1/admin/journal": {"get"}}
    for route in app.routes:
        for sous in getattr(route, "routes", [route]):
            chemin = getattr(sous, "path", "")
            if "journal" in chemin.lower() and "acces" not in chemin.lower():
                assert set(getattr(sous, "methods", set())) <= {"GET", "HEAD"}, chemin


def test_le_module_de_lecture_ne_definit_aucune_route_d_ecriture():
    assert [(r.path, sorted(r.methods)) for r in route_journal.router.routes] == [("/journal", ["GET"])]


def test_ajout_seul_au_niveau_de_la_base_sqlite_de_test(ctx):
    db = ctx.Session()
    try:
        journal.journaliser(db, action=journal.PARAMETRES_MODIFIES, acteur=db.get(Utilisateur, ctx.ids.admin_p)); db.commit()
        with pytest.raises(DatabaseError):
            db.execute(text("UPDATE journal_audit SET action = 'x'")); db.commit()
        db.rollback()
        with pytest.raises(DatabaseError):
            db.execute(text("DELETE FROM journal_audit")); db.commit()
        db.rollback()
        assert db.query(JournalAudit).count() == 1
    finally:
        db.close()


def test_supprimer_un_compte_ou_une_organisation_ne_touche_pas_au_journal(ctx):
    h = ctx.H(ctx.ids.admin_p)
    ctx.client.patch(f"/utilisateurs/{ctx.ids.am_x1}", headers=ctx.H(ctx.ids.cx_x), json={"nom": "Nom"})
    avant = len(lignes(ctx))
    db = ctx.Session()
    try:
        db.query(Utilisateur).filter(Utilisateur.id == ctx.ids.am_x1).delete(); db.commit()      # suppression physique du compte cible
    finally:
        db.close()
    assert len(lignes(ctx)) == avant == 1                                                          # aucune clé étrangère : le journal survit
    assert lignes(ctx)[0].cible_libelle == ctx.mails.am_x1                                         # l'instantané reste lisible


def test_le_modele_n_a_aucune_cle_etrangere_ni_relation():
    assert JournalAudit.__table__.foreign_keys == set()
    assert not hasattr(JournalAudit, "utilisateur") and not hasattr(JournalAudit, "organisation")
    assert {i.name for i in JournalAudit.__table__.indexes} == {"ix_journal_audit_date_action", "ix_journal_audit_acteur", "ix_journal_audit_action", "ix_journal_audit_organisation"}


def test_codes_d_action_stables_et_uniques():
    assert len(journal.CODES_ACTION) == len(set(journal.CODES_ACTION)) == 17
    assert all(code == code.lower() and "." in code and len(code) <= 60 for code in journal.CODES_ACTION)
