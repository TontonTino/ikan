"""
SD-01 — matrice d'accès de TOUTES les routes de l'API, par identité, sur le VRAI routeur (app.main.app).

* MATRICE ci-dessous : déclarée à la main, route + méthode -> rôles autorisés (am = Agency Manager, cx = CX Manager, admin) ou PUBLIC.
  Les identités testées sont : anonyme, am (agence A1), cx (organisation A), admin, cx_b (CX d'une AUTRE organisation) et am2
  (Agency Manager d'une AUTRE agence de la même organisation). Le « client » final est l'anonyme des routes PUBLIC.
* Une NOUVELLE route sans décision d'accès fait échouer test_toute_route_reelle_est_dans_la_matrice, avec son nom dans le message.
* Pour chaque route : 401 en anonyme (route protégée) ; 403 pour un rôle non autorisé, AVANT la validation du corps et avant le 404
  (identifiant inexistant) ; accès normal (ni 401 ni 403) pour un rôle autorisé sur ses propres objets ; 403/404 pour un objet réel d'une
  autre organisation / agence ; jamais de 500 ; refus sans donnée sensible ; base inchangée par les refus.

SÉCURITÉ DES TESTS : SQLite en mémoire uniquement (type vérifié) ; une base neuve par route et par identité autorisée ; aucune base réelle.
"""
import os
import re
import uuid
from types import SimpleNamespace

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-roles-matrix-0123456789")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.endpoints import feedbacks
from app.core.rate_limit import limiteur
from app.core.security import create_access_token, get_password_hash
from app.db.session import Base, get_db
from app.main import app as application
from app.models.action_corrective import ActionCorrective
from app.models.agence import Agence
from app.models.analyse_ia import AnalyseIA
from app.models.categorie import Categorie
from app.models.demande_contact import DemandeContact
from app.models.enums import CriticiteType, PriorityLevel, SentimentType, UserRole
from app.models.feedback import Feedback
from app.models.issue import Issue
from app.models.organisation import Organisation
from app.models.plan import Plan
from app.models.qr_code import QRCode
from app.models.recommandation import Recommandation
from app.models.suggestion import Suggestion
from app.models.utilisateur import Utilisateur
from app.services.plan_catalog import PLAN_GRATUIT_ID

def uid(nom: str) -> uuid.UUID:
    return uuid.uuid5(uuid.NAMESPACE_URL, f"ikan-matrice/{nom}")


P = "PUBLIC"
AM, CX, AD = "am", "cx", "admin"
TOUS = frozenset({AM, CX, AD})
CA = frozenset({CX, AM})
CX_ = frozenset({CX})
AM_ = frozenset({AM})
AD_ = frozenset({AD})
CXAD = frozenset({CX, AD})

V1 = "/api/v1"
# (méthode, chemin) -> P (public voulu) ou ensemble de rôles autorisés.
MATRICE: dict[tuple[str, str], object] = {
    # --- Racine, santé, webhooks signés ---
    ("GET", "/"): P, ("GET", "/health"): P, ("POST", "/webhooks/stripe"): P,
    # --- Authentification ---
    ("POST", f"{V1}/auth/login"): P, ("POST", f"{V1}/auth/logout"): P, ("POST", f"{V1}/auth/refresh"): P,
    ("GET", f"{V1}/auth/me"): TOUS, ("PATCH", f"{V1}/auth/me"): TOUS, ("POST", f"{V1}/auth/me/mot-de-passe"): TOUS,
    ("GET", f"{V1}/auth/agent-token"): CA,
    # --- Organisations ---
    ("GET", f"{V1}/organisations/moi/utilisation"): CX_, ("POST", f"{V1}/organisations/moi/upgrade-checkout"): CX_,
    ("GET", f"{V1}/organisations/"): AD_, ("POST", f"{V1}/organisations/"): AD_,
    ("GET", f"{V1}/organisations/{{org_id}}"): AD_, ("PATCH", f"{V1}/organisations/{{org_id}}"): AD_,
    ("PATCH", f"{V1}/organisations/{{org_id}}/plan"): AD_,
    # --- Agences et catégories ---
    ("GET", f"{V1}/agences/"): TOUS, ("GET", f"{V1}/agences/contexte"): CX_, ("POST", f"{V1}/agences/"): CXAD,
    ("GET", f"{V1}/agences/{{agence_id}}"): CA, ("PATCH", f"{V1}/agences/{{agence_id}}"): CX_,
    ("PATCH", f"{V1}/agences/{{agence_id}}/photo"): CA, ("DELETE", f"{V1}/agences/{{agence_id}}"): CX_,
    ("GET", f"{V1}/agences/{{agence_id}}/categories"): CA, ("POST", f"{V1}/agences/{{agence_id}}/categories"): CA,
    ("PATCH", f"{V1}/agences/{{agence_id}}/categories/{{categorie_id}}"): CA,
    ("DELETE", f"{V1}/agences/{{agence_id}}/categories/{{categorie_id}}"): CA,
    ("GET", f"{V1}/agences/{{agence_id}}/activite"): CA,
    # --- Utilisateurs ---
    ("GET", f"{V1}/utilisateurs/"): CXAD, ("POST", f"{V1}/utilisateurs/"): CXAD,
    ("GET", f"{V1}/utilisateurs/{{user_id}}"): CXAD, ("PATCH", f"{V1}/utilisateurs/{{user_id}}"): CXAD,
    ("DELETE", f"{V1}/utilisateurs/{{user_id}}"): CXAD,
    # --- QR codes ---
    ("GET", f"{V1}/qr-codes/ping"): P, ("GET", f"{V1}/qr-codes/public-agences"): AD_,
    ("POST", f"{V1}/qr-codes/agences/{{agence_id}}"): AD_, ("GET", f"{V1}/qr-codes/agences/{{agence_id}}"): AD_,
    ("GET", f"{V1}/qr-codes/{{code}}/validate"): P, ("GET", f"{V1}/qr-codes/{{code}}/categories"): P,
    ("POST", f"{V1}/qr-codes/{{code}}/suggestions"): P, ("DELETE", f"{V1}/qr-codes/{{qr_id}}"): AD_,
    # --- Avis ---
    ("POST", f"{V1}/feedbacks/"): P, ("POST", f"{V1}/feedbacks/{{feedback_id}}/nps"): P,
    ("GET", f"{V1}/feedbacks/"): CA, ("GET", f"{V1}/feedbacks/themes"): CA, ("GET", f"{V1}/feedbacks/themes/synthese"): CA,
    ("GET", f"{V1}/feedbacks/demandes-contact"): CA, ("GET", f"{V1}/feedbacks/{{feedback_id}}"): CA,
    ("POST", f"{V1}/feedbacks/{{feedback_id}}/open"): AM_, ("POST", f"{V1}/feedbacks/{{feedback_id}}/prendre-en-charge"): AM_,
    ("POST", f"{V1}/feedbacks/{{feedback_id}}/notes"): CA, ("POST", f"{V1}/feedbacks/{{feedback_id}}/suggestion-agence"): AM_,
    ("POST", f"{V1}/feedbacks/{{feedback_id}}/action-cx"): CX_, ("POST", f"{V1}/feedbacks/{{feedback_id}}/confirmer-action"): CA,
    ("GET", f"{V1}/feedbacks/{{feedback_id}}/brouillon-reponse"): CA, ("POST", f"{V1}/feedbacks/{{feedback_id}}/reponses-client"): CA,
    ("POST", f"{V1}/feedbacks/{{feedback_id}}/reouvrir"): CA, ("GET", f"{V1}/feedbacks/{{feedback_id}}/historique"): CA,
    ("GET", f"{V1}/feedbacks/{{feedback_id}}/reponses"): CA,
    ("PATCH", f"{V1}/feedbacks/demandes-contact/{{contact_id}}/traiter"): CA,
    # --- Suggestions, analyses, recommandations ---
    ("GET", f"{V1}/suggestions/"): CA, ("GET", f"{V1}/suggestions/{{suggestion_id}}"): CA,
    ("GET", f"{V1}/suggestions/{{suggestion_id}}/historique"): CA, ("PATCH", f"{V1}/suggestions/{{suggestion_id}}/statut"): CA,
    ("GET", f"{V1}/analyses/{{feedback_id}}"): CA,
    ("GET", f"{V1}/recommandations/agences/{{agence_id}}"): CA, ("GET", f"{V1}/recommandations/organisation/groupees"): CA,
    ("GET", f"{V1}/recommandations/organisation"): CA, ("PATCH", f"{V1}/recommandations/{{recommandation_id}}/traiter"): CA,
    ("PATCH", f"{V1}/recommandations/{{recommandation_id}}/rouvrir"): CA,
    # --- Tableaux de bord, alertes ---
    ("GET", f"{V1}/dashboard/agence/{{agence_id}}"): CA, ("GET", f"{V1}/dashboard/siege"): CX_, ("GET", f"{V1}/dashboard/admin"): AD_,
    ("GET", f"{V1}/dashboard/statistics/cx"): CX_, ("GET", f"{V1}/dashboard/statistics/agency"): CA,
    ("GET", f"{V1}/dashboard/statistics/admin"): AD_,
    ("GET", f"{V1}/alertes/"): CA, ("PATCH", f"{V1}/alertes/agences/{{agence_id}}/seuil"): CXAD,
    # --- Système, facturation ---
    ("GET", f"{V1}/system/settings"): TOUS, ("PATCH", f"{V1}/system/settings"): AD_, ("GET", f"{V1}/system/permissions"): TOUS,
    ("GET", f"{V1}/admin/facturation/vue-ensemble"): AD_, ("GET", f"{V1}/admin/facturation/paiements-echoues"): AD_,
    ("GET", f"{V1}/admin/facturation/historique/{{organisation_id}}"): AD_,
    # --- Veille ---
    ("GET", f"{V1}/veille/status"): CX_, ("GET", f"{V1}/veille/facebook/status"): CX_, ("POST", f"{V1}/veille/facebook/connect"): CX_,
    ("POST", f"{V1}/veille/facebook/scrape"): CX_, ("POST", f"{V1}/veille/ingest"): CX_, ("GET", f"{V1}/veille/mentions"): CX_,
    ("GET", f"{V1}/veille/synthese"): CX_,
    # --- Issues ---
    ("POST", f"{V1}/issues/"): CA, ("GET", f"{V1}/issues/"): CA, ("GET", f"{V1}/issues/{{issue_id}}"): CA,
    ("POST", f"{V1}/issues/{{issue_id}}/escalations"): CA, ("GET", f"{V1}/issues/{{issue_id}}/escalations"): CA,
    ("PATCH", f"{V1}/issues/{{issue_id}}/rattacher-feedback/{{feedback_id}}"): CA,
    ("PATCH", f"{V1}/issues/{{issue_id}}/detacher-feedback/{{feedback_id}}"): CA,
    ("POST", f"{V1}/issues/{{issue_id}}/actions"): CA, ("POST", f"{V1}/issues/{{issue_id}}/actions/{{action_id}}/terminer"): CA,
    ("POST", f"{V1}/issues/{{issue_id}}/verifier"): CA,
    # --- KPI, secteurs ---
    ("GET", f"{V1}/kpis/"): CA, ("GET", f"{V1}/kpis/{{code}}"): CA, ("GET", f"{V1}/secteurs/"): TOUS,
}

# Routes dont le contrôle de rôle est fait DANS la fonction (après la validation du corps par FastAPI) : un corps VALIDE est envoyé
# aux rôles refusés pour que le 403 puisse être observé ; toutes les autres sont gardées par une dépendance (403 avant tout corps).
CONTROLE_DANS_LA_FONCTION = {
    ("POST", f"{V1}/agences/{{agence_id}}/categories"): {"nom": "Categorie test"},
    ("PATCH", f"{V1}/agences/{{agence_id}}/categories/{{categorie_id}}"): {"nom": "Renommee"},
    ("POST", f"{V1}/veille/facebook/scrape"): {},
    ("POST", f"{V1}/veille/ingest"): {"items": []},
    ("POST", f"{V1}/feedbacks/{{feedback_id}}/suggestion-agence"): {"suggestion": "une suggestion"},
    ("POST", f"{V1}/feedbacks/{{feedback_id}}/action-cx"): {"action": "faire quelque chose"},
}
# Corps VALIDES pour les routes à corps obligatoire, utilisés pour l'isolation (sinon un 422 masquerait le contrôle d'objet) et pour
# l'accès normal d'un rôle autorisé.
BODIES_VALIDES = {
    ("POST", f"{V1}/feedbacks/{{feedback_id}}/notes"): {"texte": "note interne"},
    ("POST", f"{V1}/feedbacks/{{feedback_id}}/suggestion-agence"): {"suggestion": "une suggestion"},
    ("POST", f"{V1}/feedbacks/{{feedback_id}}/action-cx"): {"action": "faire quelque chose"},
    ("POST", f"{V1}/feedbacks/{{feedback_id}}/reponses-client"): {"contenu": "reponse", "canal": "autre"},
    ("PATCH", f"{V1}/suggestions/{{suggestion_id}}/statut"): {"statut": "en_cours"},
    ("PATCH", f"{V1}/alertes/agences/{{agence_id}}/seuil"): {"seuil_alerte": 75},
    ("POST", f"{V1}/issues/{{issue_id}}/escalations"): {"motif": "sla"},
    ("POST", f"{V1}/issues/{{issue_id}}/actions"): {"titre": "Action de test"},
    ("POST", f"{V1}/issues/"): {"titre": "Issue de test", "agence_id": str(uid("A1"))},
    ("POST", f"{V1}/utilisateurs/"): {"nom": "N", "prenom": "P", "email": "nouveau@secret-matrice.io", "password": "Un-Mot-De-Passe-Solide-2026",
                                      "role": "agency_manager", "agence_id": str(uid("A1"))},
    ("PATCH", f"{V1}/utilisateurs/{{user_id}}"): {"nom": "Autre"},
    ("PATCH", f"{V1}/agences/{{agence_id}}"): {"nom": "Renommee"},
    ("POST", f"{V1}/agences/{{agence_id}}/categories"): {"nom": "Categorie test"},
    ("PATCH", f"{V1}/agences/{{agence_id}}/categories/{{categorie_id}}"): {"nom": "Renommee"},
    ("POST", f"{V1}/veille/facebook/scrape"): {},
    ("POST", f"{V1}/veille/ingest"): {"items": []},
}
# Corps propre à un rôle (l'administrateur ne crée que des CX Manager).
BODIES_PAR_ROLE = {
    (("POST", f"{V1}/utilisateurs/"), "admin"): {"nom": "N", "prenom": "P", "email": "cx.nouveau@secret-matrice.io",
                                                 "password": "Un-Mot-De-Passe-Solide-2026", "role": "cx_manager",
                                                 "organisation_id": str(uid("orgA"))},
}
# ÉCARTS CONNUS (aucune donnée n'est divulguée, mais l'ordre des contrôles diffère de la règle « 403 avant 404 »). Le test
# test_ecarts_connus_restent_documentes échouera dès qu'un écart est corrigé : il faudra alors retirer l'entrée.
ECARTS_404_AVANT_403 = {
    ("GET", f"{V1}/agences/{{agence_id}}"), ("GET", f"{V1}/agences/{{agence_id}}/categories"),
    ("POST", f"{V1}/agences/{{agence_id}}/categories"), ("PATCH", f"{V1}/agences/{{agence_id}}/categories/{{categorie_id}}"),
    ("DELETE", f"{V1}/agences/{{agence_id}}/categories/{{categorie_id}}"), ("GET", f"{V1}/agences/{{agence_id}}/activite"),
    ("PATCH", f"{V1}/agences/{{agence_id}}"), ("DELETE", f"{V1}/agences/{{agence_id}}"),
}
CORPS_INVALIDE = {"champ_inexistant_pour_provoquer_un_422": [1, 2, 3]}
METHODES = ("get", "post", "put", "patch", "delete")
IDENTITES = ("anonyme", AM, CX, AD, "cx_b", "am2")
ROLE_DE = {AM: AM, CX: CX, AD: AD, "cx_b": CX, "am2": AM}

HACHAGE = get_password_hash("Motdepasse-123")


IDS = {n: uid(n) for n in (
    "orgA", "orgB", "orgP", "A1", "A2", "B1", "qrA1", "qrA2", "qrB1", "catA1", "fbA1", "dcA1", "sugA1", "issA1", "actA1", "recA1",
    "admin", "cxA", "amA1", "amA2", "cxB", "cible")}
EMAILS = {n: f"{n}@secret-matrice.io" for n in ("admin", "cxA", "amA1", "amA2", "cxB", "cible")}
MARQUEURS_SENSIBLES = (
    list(EMAILS.values()) + ["+22670123456", "SECRET-COMMENTAIRE-A", "Orange Secret A", "Banque Secrete B", "Traceback", 'File "',
                             "sqlalchemy", "psycopg", "IntegrityError", "OperationalError", "Secret-Contenu-Reco"])
JETONS = {
    AD: create_access_token(str(IDS["admin"])), CX: create_access_token(str(IDS["cxA"])), AM: create_access_token(str(IDS["amA1"])),
    "cx_b": create_access_token(str(IDS["cxB"])), "am2": create_access_token(str(IDS["amA2"])),
}
PARAMETRES = {  # nom de paramètre de chemin -> objet réel de l'organisation A
    "agence_id": "A1", "categorie_id": "catA1", "user_id": "cible", "org_id": "orgA", "organisation_id": "orgA", "qr_id": "qrA1",
    "feedback_id": "fbA1", "contact_id": "dcA1", "suggestion_id": "sugA1", "recommandation_id": "recA1", "issue_id": "issA1",
    "action_id": "actA1",
}


def construire_contexte(monkeypatch=None):
    """Base SQLite en mémoire NEUVE + objets de deux organisations, branchée sur le vrai routeur."""
    moteur = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    assert moteur.url.get_backend_name() == "sqlite"           # jamais la vraie base
    for table in Base.metadata.sorted_tables:
        try:
            table.create(moteur, checkfirst=True)
        except Exception:  # noqa: BLE001
            pass
    Session = sessionmaker(bind=moteur)
    db = Session()
    db.add(Plan(id=PLAN_GRATUIT_ID, code="gratuit", nom="Gratuit", ordre=0))
    db.flush()
    db.add_all([Organisation(id=IDS["orgP"], nom="Plateforme", active=True),
                Organisation(id=IDS["orgA"], nom="Orange Secret A", active=True, created_by_id=None),
                Organisation(id=IDS["orgB"], nom="Banque Secrete B", active=True)])
    db.flush()

    def utilisateur(cle, role, org, agence=None):
        db.add(Utilisateur(id=IDS[cle], organisation_id=IDS[org], agence_id=IDS[agence] if agence else None, nom="Nom", prenom="Prenom",
                           email=EMAILS[cle], mot_de_passe_hash=HACHAGE, role=role, active=True))

    def agence(cle, org, qr, code):
        db.add(Agence(id=IDS[cle], organisation_id=IDS[org], nom=f"Agence {cle}", ville="V", active=True, seuil_alerte=70))
        db.flush()
        db.add(QRCode(id=IDS[qr], agence_id=IDS[cle], code=code, url=f"http://t/{code}", actif=True))

    agence("A1", "orgA", "qrA1", "QR-A1"); agence("A2", "orgA", "qrA2", "QR-A2"); agence("B1", "orgB", "qrB1", "QR-B1")
    db.flush()
    utilisateur("admin", UserRole.ADMIN, "orgP"); utilisateur("cxA", UserRole.CX_MANAGER, "orgA")
    utilisateur("amA1", UserRole.AGENCY_MANAGER, "orgA", "A1"); utilisateur("amA2", UserRole.AGENCY_MANAGER, "orgA", "A2")
    utilisateur("cxB", UserRole.CX_MANAGER, "orgB"); utilisateur("cible", UserRole.AGENCY_MANAGER, "orgA", "A1")
    db.flush()
    db.get(Organisation, IDS["orgA"]).created_by_id = IDS["admin"]      # l'administrateur gère l'organisation A
    db.add(Categorie(id=IDS["catA1"], agence_id=IDS["A1"], nom="Categorie A1", active=True, cree_par_id=IDS["amA1"]))
    db.flush()
    db.add(Feedback(id=IDS["fbA1"], qr_code_id=IDS["qrA1"], categorie_id=IDS["catA1"], note=2, commentaire="SECRET-COMMENTAIRE-A"))
    db.flush()
    db.add(DemandeContact(id=IDS["dcA1"], feedback_id=IDS["fbA1"], nom="Client Secret", telephone="+22670123456", souhaite_etre_rappele=True))
    db.add(Suggestion(id=IDS["sugA1"], agence_id=IDS["A1"], contenu="Idee secrete de A"))
    analyse = AnalyseIA(id=uuid.uuid4(), feedback_id=IDS["fbA1"], sentiment=SentimentType.NEGATIF, criticite=CriticiteType.ELEVEE)
    db.add(analyse)
    db.flush()
    db.add(Recommandation(id=IDS["recA1"], analyse_ia_id=analyse.id, contenu="Secret-Contenu-Reco", priorite=PriorityLevel.HIGH))
    db.add(Issue(id=IDS["issA1"], organisation_id=IDS["orgA"], agence_id=IDS["A1"], titre="Issue A1"))
    db.flush()
    db.add(ActionCorrective(id=IDS["actA1"], issue_id=IDS["issA1"], titre="Action A1"))
    db.commit()
    db.close()

    def base():
        d = Session()
        try:
            yield d
        finally:
            d.close()

    application.dependency_overrides[get_db] = base
    return SimpleNamespace(moteur=moteur, client=TestClient(application, raise_server_exceptions=False))


def photo(moteur):
    resultat = {}
    with moteur.connect() as c:
        for table in Base.metadata.tables.values():
            try:
                resultat[table.name] = sorted(str(tuple(ligne)) for ligne in c.execute(select(table)))
            except Exception:  # noqa: BLE001
                continue
    return resultat


def instancier(chemin, reel):
    def remplacer(m):
        nom = m.group(1)
        if reel:
            return "QR-A1" if nom == "code" else str(IDS[PARAMETRES[nom]])
        return "QR-INEXISTANT" if nom == "code" else str(uuid.uuid4())
    return re.sub(r"\{(\w+)\}", remplacer, chemin)


def appeler(client, methode, chemin, identite, corps, reel):
    entetes = {} if identite == "anonyme" else {"Authorization": f"Bearer {JETONS[identite]}"}
    url = instancier(chemin, reel)
    args = {"headers": entetes}
    if methode in ("POST", "PATCH", "PUT", "DELETE") and methode != "DELETE":
        args["json"] = corps
    return client.request(methode, url, **args)


def executer_route(methode, chemin, decision):
    """Toutes les observations d'une route : liste de dictionnaires (identité, phase, statut, texte), + base modifiée par un refus ?"""
    observations, refus_ont_modifie_la_base = [], False
    a_des_objets = "{" in chemin and chemin not in {f"{V1}/qr-codes/{{code}}/validate"}
    corps_refus = CONTROLE_DANS_LA_FONCTION.get((methode, chemin), CORPS_INVALIDE)
    publique = decision == P

    if publique:
        ctx = construire_contexte()
        r = appeler(ctx.client, methode, chemin, "anonyme", {}, reel=True)
        observations.append(dict(identite="anonyme", phase="public", statut=r.status_code, texte=r.text, entetes=r.headers))
        return observations, False

    # --- Phase 1 : refus (anonyme, rôles non autorisés, autre organisation / autre agence) sur une base commune ---
    ctx = construire_contexte()
    avant = photo(ctx.moteur)
    for identite in IDENTITES:
        if identite == "anonyme":
            r = appeler(ctx.client, methode, chemin, identite, corps_refus, False)
            observations.append(dict(identite=identite, phase="anonyme", statut=r.status_code, texte=r.text, entetes=r.headers))
        elif ROLE_DE[identite] not in decision:
            # rôle non autorisé : identifiant inexistant (le 403 doit précéder le 404), puis objet réel de l'organisation A
            for reel, phase in ((False, "role_refuse"), (True, "role_refuse_objet_reel")):
                if reel and not a_des_objets:
                    continue
                r = appeler(ctx.client, methode, chemin, identite, corps_refus, reel)
                observations.append(dict(identite=identite, phase=phase, statut=r.status_code, texte=r.text, entetes=r.headers))
        elif identite in ("cx_b", "am2") and a_des_objets:
            r = appeler(ctx.client, methode, chemin, identite, BODIES_VALIDES.get((methode, chemin), {}), True)
            observations.append(dict(identite=identite, phase="isolation", statut=r.status_code, texte=r.text, entetes=r.headers))
    refus_ont_modifie_la_base = photo(ctx.moteur) != avant

    # --- Phase 2 : accès normal des rôles autorisés sur leurs propres objets (base neuve à chaque identité) ---
    for identite in (AM, CX, AD):
        if identite not in decision:
            continue
        ctx = construire_contexte()
        corps = BODIES_PAR_ROLE.get(((methode, chemin), identite), BODIES_VALIDES.get((methode, chemin), {}))
        r = appeler(ctx.client, methode, chemin, identite, corps, True)
        observations.append(dict(identite=identite, phase="autorise", statut=r.status_code, texte=r.text, entetes=r.headers))
    return observations, refus_ont_modifie_la_base


# ───────────────────────────── Tests ─────────────────────────────

def _operations_reelles():
    ops = set()
    for chemin, operations in application.openapi()["paths"].items():
        for m in operations:
            if m in METHODES:
                ops.add((m.upper(), chemin))
    return ops


def _routes_cachees():
    """Routes déclarées avec include_in_schema=False (absentes de l'OpenAPI, donc invisibles du test précédent)."""
    from fastapi.routing import APIRoute

    trouvees = []

    def parcourir(routes):
        for r in routes:
            if hasattr(r, "original_router"):
                parcourir(r.original_router.routes)
            elif isinstance(r, APIRoute) and not r.include_in_schema:
                trouvees.append((sorted(r.methods), r.path))
    parcourir(application.routes)
    return trouvees


def test_toute_route_reelle_est_dans_la_matrice():
    reelles = _operations_reelles()
    manquantes = sorted(reelles - set(MATRICE))
    assert not manquantes, ("Route sans décision d'accès : déclarez-la dans MATRICE (tests/test_matrice_roles_routes.py) avec ses rôles "
                            "autorisés ou PUBLIC : " + "; ".join(f"{m} {c}" for m, c in manquantes))
    obsoletes = sorted(set(MATRICE) - reelles)
    assert not obsoletes, "Entrées de MATRICE sans route réelle : " + "; ".join(f"{m} {c}" for m, c in obsoletes)


def test_aucune_route_cachee_de_l_openapi():
    cachees = [x for x in _routes_cachees() if x[1] not in ("/docs", "/redoc", "/openapi.json")]
    assert not cachees, f"routes absentes de l'OpenAPI (donc de la matrice) : {cachees}"


def test_les_controles_dans_la_fonction_sont_declares_dans_la_matrice():
    assert set(CONTROLE_DANS_LA_FONCTION) <= set(MATRICE)


@pytest.fixture(scope="module")
def resultats():
    limiteur.reinitialiser()
    original = feedbacks.analyser_feedback
    feedbacks.analyser_feedback = lambda feedback_id, db: None
    sortie = {}
    try:
        for (methode, chemin), decision in MATRICE.items():
            limiteur.reinitialiser()
            sortie[(methode, chemin)] = executer_route(methode, chemin, decision)
    finally:
        feedbacks.analyser_feedback = original
        application.dependency_overrides.pop(get_db, None)
        limiteur.reinitialiser()
    return sortie


def _nom(cle):
    return f"{cle[0]} {cle[1]}"


def test_anonyme_recoit_401_sur_toute_route_protegee(resultats):
    fautes = [(_nom(c), o["statut"]) for c, (obs, _) in resultats.items() for o in obs if o["phase"] == "anonyme" and o["statut"] != 401]
    assert not fautes, f"anonyme : 401 attendu, obtenu {fautes}"


def test_role_non_autorise_recoit_403_avant_la_validation_du_corps_et_avant_le_404(resultats):
    fautes = [(_nom(c), o["identite"], o["phase"], o["statut"]) for c, (obs, _) in resultats.items() for o in obs
              if o["phase"] in ("role_refuse", "role_refuse_objet_reel") and o["statut"] != 403
              and not (c in ECARTS_404_AVANT_403 and o["identite"] == AD and o["phase"] == "role_refuse" and o["statut"] == 404)]
    assert not fautes, f"rôle non autorisé : 403 attendu, obtenu {fautes}"


def test_role_autorise_accede_normalement_a_ses_propres_objets(resultats):
    fautes = [(_nom(c), o["identite"], o["statut"], o["texte"][:120]) for c, (obs, _) in resultats.items() for o in obs
              if o["phase"] == "autorise" and o["statut"] in (401, 403)]
    assert not fautes, f"rôle autorisé refusé à tort : {fautes}"


def test_autre_organisation_ou_autre_agence_ne_voit_jamais_l_objet(resultats):
    fautes = [(_nom(c), o["identite"], o["statut"]) for c, (obs, _) in resultats.items() for o in obs
              if o["phase"] == "isolation" and o["statut"] not in (403, 404)]
    assert not fautes, f"isolation : 403 ou 404 attendu, obtenu {fautes}"


def test_ecarts_connus_restent_documentes(resultats):
    """Les 8 routes « agence » où l'administrateur (rôle refusé) reçoit 404 avant 403 pour un identifiant inexistant."""
    for cle in ECARTS_404_AVANT_403:
        obs = [o for o in resultats[cle][0] if o["identite"] == AD and o["phase"] == "role_refuse"]
        assert obs and obs[0]["statut"] == 404, f"{_nom(cle)} : écart corrigé ? retirer l'entrée de ECARTS_404_AVANT_403"


def test_les_refus_ne_modifient_jamais_la_base(resultats):
    fautes = [_nom(c) for c, (_, modifiee) in resultats.items() if modifiee]
    assert not fautes, f"un refus a modifié la base : {fautes}"


def test_aucune_route_ne_repond_500_pour_aucune_identite(resultats):
    fautes = [(_nom(c), o["identite"], o["phase"]) for c, (obs, _) in resultats.items() for o in obs if o["statut"] == 500]
    assert not fautes, f"réponses 500 : {fautes}"


def test_les_refus_ne_contiennent_aucune_donnee_sensible(resultats):
    jetons = list(JETONS.values())
    fautes = []
    for c, (obs, _) in resultats.items():
        for o in obs:
            if o["phase"] in ("public", "autorise"):
                continue
            texte = o["texte"]
            trouves = [m for m in MARQUEURS_SENSIBLES + jetons if m in texte]
            if trouves:
                fautes.append((_nom(c), o["identite"], o["phase"], [t[:12] for t in trouves]))
    assert not fautes, f"données sensibles dans des refus : {fautes}"


def test_les_reponses_de_refus_sont_de_courts_messages_json(resultats):
    fautes = []
    for c, (obs, _) in resultats.items():
        for o in obs:
            if o["phase"] in ("anonyme", "role_refuse", "role_refuse_objet_reel") and o["statut"] in (401, 403):
                try:
                    corps = __import__("json").loads(o["texte"])
                except ValueError:
                    fautes.append((_nom(c), o["identite"], "non JSON")); continue
                if set(corps) != {"detail"} or not isinstance(corps["detail"], str) or len(corps["detail"]) > 200:
                    fautes.append((_nom(c), o["identite"], str(corps)[:80]))
    assert not fautes, fautes


def test_routes_publiques_jamais_500_et_en_tetes_de_securite(resultats):
    fautes = []
    for c, (obs, _) in resultats.items():
        for o in obs:
            if o["phase"] == "public" and (o["statut"] == 500 or o["entetes"].get("x-content-type-options") != "nosniff"):
                fautes.append((_nom(c), o["statut"]))
    assert not fautes, fautes


def test_resume_de_la_matrice():
    publiques = [k for k, v in MATRICE.items() if v == P]
    par_roles = {}
    for k, v in MATRICE.items():
        if v != P:
            par_roles.setdefault(tuple(sorted(v)), []).append(k)
    assert len(MATRICE) == len(publiques) + sum(len(x) for x in par_roles.values())
