"""
Script de seeding démo — organisation « RESTAURANT LE PRESTIGE » (secteur restauration).

Crée, en passant UNIQUEMENT par les fonctions réelles de l'application (endpoints appelés
directement, comme seed_feedbacks_demo.py / seed_issues_demo.py) :
- l'organisation (create_organisation, par un Admin existant), passée au forfait Pro par
  l'override Admin tracé (changer_plan_organisation — le forfait Gratuit n'autorise
  qu'une agence et 20 feedbacks/mois) ;
- son CX Manager (create_utilisateur, par l'Admin) ;
- 3 points de vente à Ouagadougou (create_agence, par le CX Manager) — les 7 catégories
  de départ restauration sont créées par create_agence lui-même (creer_categories_depart) ;
- un chef d'agence (create_utilisateur, par le CX Manager) ;
- 45 feedbacks sur les 30 derniers jours (submit_feedback : analyse IA réelle comprise),
  dont des demandes de rappel, traitées par une vraie réponse au client
  (envoyer_reponse_client) ou par le marquage manuel (marquer_demande_contact_traitee) ;
- 11 Issues dont 3 récurrentes (creer_issue, creer_action_corrective,
  terminer_action_corrective, verifier_issue).
Aucun INSERT brut ne contourne un service : seules les dates sont antidatées après coup
(soumission, analyse, demande de contact, réponses, historiques, cycle des Issues).

Rattachement : catégories résolues par leur clé stable (categories_agence.cle), jamais par
leur nom. Après chaque soumission, le script vérifie que l'AnalyseIA existe avec le
sentiment attendu, et s'arrête sinon.

Marquage : l'organisation est identifiée par son email professionnel ; chaque feedback
reçoit un événement d'historique type_evenement="restauration_demo_seed" ; chaque Issue
porte le suffixe de titre MARQUEUR_TITRE.

Idempotent : refuse de s'exécuter si l'organisation existe déjà, sauf --force (ajoute
alors un second lot de feedbacks et d'Issues à l'organisation existante, sans recréer
comptes ni agences). --supprimer retire l'organisation et tout ce qu'elle contient
(delete_organisation, ON DELETE CASCADE) — UNIQUEMENT si tout son contenu vient de ce
script (sinon refus détaillé, rien n'est supprimé).

Usage :
    cd apps/api
    python scripts/seed_restauration_demo.py              # crée l'organisation de démo
    python scripts/seed_restauration_demo.py --force      # ajoute un second lot
    python scripts/seed_restauration_demo.py --supprimer  # retire l'organisation de démo
"""
import io
import os
import random
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

if __name__ == "__main__":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

from fastapi import BackgroundTasks
from sqlalchemy import or_

from app.db.session import SessionLocal
from app.models.action_corrective import ActionCorrective
from app.models.agence import Agence
from app.models.analyse_ia import AnalyseIA
from app.models.categorie import Categorie
from app.models.demande_contact import DemandeContact
from app.models.enums import CriticiteType, SentimentType, UserRole
from app.models.feedback import Feedback
from app.models.historique_feedback import HistoriqueFeedback
from app.models.historique_issue import HistoriqueIssue
from app.models.issue import Issue
from app.models.issue_escalation import IssueEscalation
from app.models.mention_veille import MentionVeille
from app.models.organisation import Organisation
from app.models.qr_code import QRCode
from app.models.reponse_client import ReponseClient
from app.models.utilisateur import Utilisateur
from app.schemas.agence import AgenceCreate
from app.schemas.feedback import FeedbackCreate, ReponseClientCreate
from app.schemas.issue import ActionCorrectiveCreate, IssueCreate
from app.schemas.organisation import ChangementPlanRequest, OrganisationCreate
from app.schemas.utilisateur import UtilisateurCreate
from app.services.ai.sentiment import analyser_sentiment
from app.services.plan_catalog import PLAN_PRO_ID
from app.api.v1.endpoints.agences import create_agence
from app.api.v1.endpoints.feedbacks import envoyer_reponse_client, marquer_demande_contact_traitee, submit_feedback
from app.api.v1.endpoints.issues import creer_action_corrective, creer_issue, terminer_action_corrective, verifier_issue
from app.api.v1.endpoints.organisations import changer_plan_organisation, create_organisation, delete_organisation
from app.api.v1.endpoints.utilisateurs import create_utilisateur

ORGANISATION_NOM = "RESTAURANT LE PRESTIGE"
EMAIL_PRO = "contact@leprestige-demo.bf"
MARQUEUR = "restauration_demo_seed"
MARQUEUR_TITRE = " [Démo restauration]"
MOT_DE_PASSE_DEMO = "Demo2026!"  # même convention que seed_feedbacks_demo.py

CX = dict(prenom="Awa", nom="Sawadogo", email="cx@leprestige-demo.bf")
CHEF = dict(prenom="Issouf", nom="Traoré", email="chef.ouaga2000@leprestige-demo.bf")

O2000, KOULOUBA, BOIS = "Le Prestige Ouaga 2000", "Le Prestige Koulouba", "Le Prestige Zone du Bois"
AGENCES = [
    AgenceCreate(nom=O2000, ville="Ouagadougou", adresse="Boulevard Mouammar Kadhafi, Ouaga 2000"),
    AgenceCreate(nom=KOULOUBA, ville="Ouagadougou", adresse="Avenue de l'Indépendance, Koulouba"),
    AgenceCreate(nom=BOIS, ville="Ouagadougou", adresse="Rue 13.31, Zone du Bois"),
]
AGENCE_DU_CHEF = O2000

NEG, POS, NEU = SentimentType.NEGATIF, SentimentType.POSITIF, SentimentType.NEUTRE


# ============================================================================
# 1. JEU DE DONNÉES
# ============================================================================

@dataclass(frozen=True)
class Contact:
    genre: str            # "rappel" | "email"
    traitement: str = ""  # "" (non traitée) | "reponse" (envoyer_reponse_client) | "marquage"
    canal: str = "telephone"
    reponse: str = ""


@dataclass(frozen=True)
class FeedbackPlan:
    agence: str
    cle: str
    note: int
    commentaire: str
    sentiment_attendu: SentimentType
    jours: int
    contact: Contact | None = None
    ref: str = ""


def rappel(traitement="", canal="telephone", reponse=""):
    return Contact("rappel", traitement, canal, reponse)


R_APPEL = "Bonjour, nous vous avons rappelé pour nous excuser et vous proposer un repas offert lors de votre prochaine visite."

PLAN_FEEDBACKS: list[FeedbackPlan] = [
    # ── Négatifs (16) ──────────────────────────────────────────────────────────
    FeedbackPlan(O2000, "qualite_plats", 1, "Poulet braisé servi froid et trop salé, très déçu pour ce prix.", NEG, 25,
                 rappel("reponse", reponse=R_APPEL), ref="o2000-plats-1"),
    FeedbackPlan(O2000, "qualite_plats", 2, "Le riz gras était mauvais ce midi, plat froid et sans goût.", NEG, 10,
                 rappel(), ref="o2000-plats-2"),
    FeedbackPlan(O2000, "livraison_emporter", 1, "Livraison arrivée avec une heure de retard et la commande incomplète. Inacceptable.", NEG, 20,
                 rappel("reponse", reponse=R_APPEL), ref="o2000-livraison-1"),
    FeedbackPlan(O2000, "rapidite_attente", 2, "Attente beaucoup trop longue au déjeuner, 50 minutes pour un plat du jour.", NEG, 3,
                 ref="o2000-attente-1"),
    FeedbackPlan(O2000, "rapidite_attente", 2, "Service lent le vendredi soir, on a dû attendre longtemps pour l'addition.", NEG, 4),
    FeedbackPlan(O2000, "accueil_service_salle", 1, "Serveur impoli et désagréable avec ma famille, très mauvaise expérience.", NEG, 8),
    FeedbackPlan(KOULOUBA, "rapidite_attente", 1, "Attente interminable, commande oubliée en cuisine. Inadmissible.", NEG, 24,
                 rappel("reponse", reponse=R_APPEL), ref="koulouba-attente-1"),
    FeedbackPlan(KOULOUBA, "rapidite_attente", 2, "Encore une longue attente aujourd'hui, le même problème que le mois dernier.", NEG, 6,
                 rappel(), ref="koulouba-attente-2"),
    FeedbackPlan(KOULOUBA, "addition_paiement", 1, "Erreur sur l'addition, deux plats facturés en trop. Je suis mécontent.", NEG, 18,
                 rappel("marquage"), ref="koulouba-addition-1"),
    FeedbackPlan(KOULOUBA, "qualite_plats", 2, "Viande trop dure et sauce trop salée, je suis déçu, mauvais plat.", NEG, 12,
                 Contact("email"), ref="koulouba-plats-1"),
    FeedbackPlan(KOULOUBA, "accueil_service_salle", 2, "Personnel désagréable à l'accueil, on nous a laissés debout dix minutes. Déçu.", NEG, 9),
    FeedbackPlan(BOIS, "proprete_cadre", 1, "Tables sales et toilettes mal entretenues, c'est honteux pour un restaurant.", NEG, 22,
                 rappel("reponse", reponse=R_APPEL), ref="bois-proprete-1"),
    FeedbackPlan(BOIS, "proprete_cadre", 2, "Salle encore sale ce soir, poussière sur les chaises. Décevant.", NEG, 2,
                 rappel(), ref="bois-proprete-2"),
    FeedbackPlan(BOIS, "accueil_service_salle", 2, "Service désagréable, le serveur a refusé de changer notre table. Mécontent.", NEG, 15,
                 rappel("reponse", canal="whatsapp", reponse="Bonjour, merci pour votre retour, le responsable de salle va vous recontacter."),
                 ref="bois-accueil-1"),
    FeedbackPlan(BOIS, "qualite_plats", 1, "Poisson braisé pas frais, plat catastrophique ce midi.", NEG, 13),
    FeedbackPlan(BOIS, "livraison_emporter", 2, "Commande à emporter incomplète et frites froides, très déçu, mauvais service.", NEG, 7),

    # ── Neutres (4) ────────────────────────────────────────────────────────────
    FeedbackPlan(O2000, "addition_paiement", 3, "Paiement par mobile money possible, il faudrait aussi accepter la carte.", NEU, 16,
                 rappel("marquage")),
    FeedbackPlan(KOULOUBA, "livraison_emporter", 3, "Commande à emporter correcte, emballage à revoir.", NEU, 11),
    FeedbackPlan(BOIS, "rapidite_attente", 3, "Service dans la moyenne pour un samedi soir.", NEU, 5, rappel()),
    FeedbackPlan(KOULOUBA, "proprete_cadre", 3, "Salle correcte, la musique est un peu forte.", NEU, 19),

    # ── Positifs (25) ──────────────────────────────────────────────────────────
    FeedbackPlan(O2000, "qualite_plats", 5, "Excellent poulet bicyclette, très bonne sauce arachide. Bravo au chef.", POS, 27),
    FeedbackPlan(O2000, "qualite_plats", 5, "Le tô sauce gombo était parfait, je recommande.", POS, 14),
    FeedbackPlan(O2000, "accueil_service_salle", 5, "Serveurs très aimables et souriants, accueil chaleureux.", POS, 21),
    FeedbackPlan(O2000, "accueil_service_salle", 4, "Bon accueil, personnel attentionné.", POS, 9),
    FeedbackPlan(O2000, "proprete_cadre", 5, "Cadre très agréable et salle très propre, super terrasse.", POS, 17),
    FeedbackPlan(O2000, "rapidite_attente", 4, "Service rapide à midi, efficace.", POS, 12),
    FeedbackPlan(O2000, "suggestion_compliment", 5, "Merci pour l'anniversaire de ma fille, équipe au top !", POS, 6,
                 rappel("reponse", reponse="Merci pour votre message, nous serons ravis de vous accueillir à nouveau.")),
    FeedbackPlan(O2000, "suggestion_compliment", 4, "Très bonne adresse, bonne continuation à toute l'équipe.", POS, 1),
    FeedbackPlan(O2000, "livraison_emporter", 4, "Livraison rapide et plats bien emballés, merci.", POS, 23),
    FeedbackPlan(O2000, "addition_paiement", 5, "Prix abordables et paiement mobile money pratique.", POS, 26),
    FeedbackPlan(O2000, "qualite_plats", 4, "Très bonne cuisine, plats copieux, merci.", POS, 2),
    FeedbackPlan(KOULOUBA, "qualite_plats", 5, "Brochettes excellentes et attiéké parfait.", POS, 28),
    FeedbackPlan(KOULOUBA, "accueil_service_salle", 5, "Accueil très chaleureux, serveuse aimable et professionnelle.", POS, 16),
    FeedbackPlan(KOULOUBA, "suggestion_compliment", 5, "Super soirée, merci à toute l'équipe, continuez ainsi.", POS, 4,
                 rappel()),
    FeedbackPlan(KOULOUBA, "proprete_cadre", 4, "Salle propre et climatisée, très agréable.", POS, 20),
    FeedbackPlan(KOULOUBA, "rapidite_attente", 4, "Service rapide et efficace ce midi.", POS, 14),
    FeedbackPlan(KOULOUBA, "livraison_emporter", 5, "Commande à emporter prête rapidement, parfait.", POS, 8),
    FeedbackPlan(BOIS, "qualite_plats", 5, "Le meilleur riz sauce de la ville, excellent !", POS, 26),
    FeedbackPlan(BOIS, "qualite_plats", 4, "Plats savoureux et très bonne présentation, bravo.", POS, 10),
    FeedbackPlan(BOIS, "accueil_service_salle", 5, "Personnel très accueillant et efficace, bravo.", POS, 23),
    FeedbackPlan(BOIS, "suggestion_compliment", 4, "Bonne ambiance le week-end, merci.", POS, 18,
                 Contact("email")),
    FeedbackPlan(BOIS, "addition_paiement", 4, "Addition claire et prix abordables, très satisfait.", POS, 12),
    FeedbackPlan(BOIS, "rapidite_attente", 5, "Service super rapide, parfait pour la pause déjeuner.", POS, 3),
    FeedbackPlan(BOIS, "livraison_emporter", 4, "Livraison rapide et livreur poli.", POS, 20),
    FeedbackPlan(BOIS, "proprete_cadre", 5, "Cadre magnifique et très propre, top.", POS, 1),
]


@dataclass(frozen=True)
class IssuePlan:
    ref: str
    agence: str
    cle: str
    titre: str
    statut: str            # "ouverte" | "action_en_cours" | "resolue" | "verifiee"
    jours: int
    severite: CriticiteType = CriticiteType.MOYENNE
    origine: str = ""      # ref de l'Issue d'origine (récurrence)
    feedbacks: tuple = field(default_factory=tuple)  # refs de feedbacks à rattacher


PLAN_ISSUES: list[IssuePlan] = [
    IssuePlan("I1", O2000, "qualite_plats", "Plats servis froids au service du midi", "resolue", 25,
              CriticiteType.CRITIQUE, feedbacks=("o2000-plats-1",)),
    IssuePlan("I2", KOULOUBA, "rapidite_attente", "Temps d'attente excessif en salle", "verifiee", 24,
              feedbacks=("koulouba-attente-1",)),
    IssuePlan("I3", BOIS, "proprete_cadre", "Propreté des tables et des sanitaires", "resolue", 22,
              CriticiteType.CRITIQUE, feedbacks=("bois-proprete-1",)),
    IssuePlan("I4", O2000, "livraison_emporter", "Retards et commandes incomplètes en livraison", "verifiee", 20,
              feedbacks=("o2000-livraison-1",)),
    IssuePlan("I5", KOULOUBA, "addition_paiement", "Erreurs de facturation sur l'addition", "resolue", 18,
              feedbacks=("koulouba-addition-1",)),
    IssuePlan("I6", BOIS, "accueil_service_salle", "Attitude du personnel de salle", "verifiee", 15,
              feedbacks=("bois-accueil-1",)),
    IssuePlan("I7", KOULOUBA, "qualite_plats", "Cuisson et assaisonnement de la viande", "resolue", 12,
              feedbacks=("koulouba-plats-1",)),
    IssuePlan("I8", O2000, "rapidite_attente", "Attente au déjeuner en semaine", "ouverte", 3,
              feedbacks=("o2000-attente-1",)),
    IssuePlan("R1", O2000, "qualite_plats", "Plats servis froids — récidive", "resolue", 10,
              CriticiteType.CRITIQUE, origine="I1", feedbacks=("o2000-plats-2",)),
    IssuePlan("R2", KOULOUBA, "rapidite_attente", "Temps d'attente excessif — récidive", "action_en_cours", 6,
              origine="I2", feedbacks=("koulouba-attente-2",)),
    IssuePlan("R3", BOIS, "proprete_cadre", "Propreté de la salle — récidive", "ouverte", 2,
              CriticiteType.CRITIQUE, origine="I3", feedbacks=("bois-proprete-2",)),
]


# ============================================================================
# 2. GARDE-FOUS (lecture seule, AVANT toute écriture)
# ============================================================================

def verifier_plan() -> None:
    erreurs = []
    for p in PLAN_FEEDBACKS:
        obtenu, _ = analyser_sentiment(p.commentaire, p.note)
        if obtenu != p.sentiment_attendu:
            erreurs.append(f"  attendu {p.sentiment_attendu.value}, obtenu {obtenu.value} : {p.commentaire}")
        if not 1 <= p.jours <= 28:
            erreurs.append(f"  date hors fenêtre (J-{p.jours}) : {p.commentaire}")
    refs = {p.ref for p in PLAN_FEEDBACKS if p.ref}
    issues = {i.ref: i for i in PLAN_ISSUES}
    for i in PLAN_ISSUES:
        for r in i.feedbacks:
            if r not in refs:
                erreurs.append(f"  {i.ref} : feedback inconnu {r}")
        if i.origine:
            o = issues.get(i.origine)
            if o is None or o.statut not in ("resolue", "verifiee") or o.jours <= i.jours or o.origine:
                erreurs.append(f"  {i.ref} : origine {i.origine} invalide")
            elif (o.agence, o.cle) != (i.agence, i.cle):
                erreurs.append(f"  {i.ref} : origine {i.origine} sur une autre agence/catégorie")
    if erreurs:
        raise SystemExit("[ERREUR] Plan de données invalide, rien n'a été écrit :\n" + "\n".join(erreurs))


def trouver_admin(db) -> Utilisateur:
    admin = (
        db.query(Utilisateur)
        .filter(Utilisateur.role == UserRole.ADMIN, Utilisateur.active == True)  # noqa: E712
        .order_by(Utilisateur.date_creation.asc())
        .first()
    )
    if admin is None:
        raise SystemExit("[ERREUR] Aucun Administrateur actif : impossible de créer l'organisation par le flux réel.")
    return admin


# ============================================================================
# 3. CRÉATION DE L'ORGANISATION (flux réel Admin -> CX Manager)
# ============================================================================

def creer_organisation(db, admin: Utilisateur) -> Organisation:
    org_reponse = create_organisation(
        data=OrganisationCreate(nom=ORGANISATION_NOM, secteur_code="restauration",
                                pays_region="Burkina Faso", email_pro=EMAIL_PRO),
        db=db, current_user=admin,
    )
    changer_plan_organisation(
        org_id=org_reponse.id,
        data=ChangementPlanRequest(plan_id=PLAN_PRO_ID, raison="Organisation de démonstration du pack restauration (3 points de vente)"),
        db=db, current_user=admin,
    )
    cx = create_utilisateur(
        data=UtilisateurCreate(**CX, password=MOT_DE_PASSE_DEMO, role=UserRole.CX_MANAGER, organisation_id=org_reponse.id),
        db=db, current_user=admin,
    )
    cx = db.get(Utilisateur, cx.id)
    for agence_data in AGENCES:
        create_agence(data=agence_data, org_id=None, db=db, current_user=cx)
    agence_chef = db.query(Agence).filter(Agence.organisation_id == org_reponse.id, Agence.nom == AGENCE_DU_CHEF).one()
    create_utilisateur(
        data=UtilisateurCreate(**CHEF, password=MOT_DE_PASSE_DEMO, role=UserRole.AGENCY_MANAGER, agence_id=agence_chef.id),
        db=db, current_user=cx,
    )
    return db.get(Organisation, org_reponse.id)


def charger_cibles(db, org: Organisation) -> dict:
    """{agence_nom: (agence, qr_code, {cle: categorie_id})} — catégories par clé uniquement."""
    cibles = {}
    for agence_data in AGENCES:
        agence = db.query(Agence).filter(Agence.organisation_id == org.id, Agence.nom == agence_data.nom).one()
        qr = db.query(QRCode).filter(QRCode.agence_id == agence.id, QRCode.actif == True).first()  # noqa: E712
        cats = {c.cle: c.id for c in db.query(Categorie).filter(
            Categorie.agence_id == agence.id, Categorie.active == True, Categorie.cle.isnot(None)).all()}  # noqa: E712
        manquantes = {p.cle for p in PLAN_FEEDBACKS if p.agence == agence.nom} - set(cats)
        if qr is None or manquantes:
            raise SystemExit(f"[ERREUR] {agence.nom} : QR actif={qr is not None}, clés manquantes={sorted(manquantes)}")
        cibles[agence.nom] = (agence, qr, cats)
    return cibles


# ============================================================================
# 4. FEEDBACKS, DEMANDES DE CONTACT ET RÉPONSES (pipeline réel + antidatage)
# ============================================================================

def _date(rng: random.Random, now: datetime, jours: int) -> datetime:
    d = now - timedelta(days=jours)
    return d.replace(hour=rng.randint(11, 21), minute=rng.randint(0, 59), second=rng.randint(0, 59), microsecond=0)


def _antidater_historique_feedback(db, feedback_id, depuis: datetime, date: datetime, type_evenement: str | None = None) -> None:
    q = db.query(HistoriqueFeedback).filter(HistoriqueFeedback.feedback_id == feedback_id,
                                            HistoriqueFeedback.date_evenement >= depuis)
    if type_evenement:
        q = q.filter(HistoriqueFeedback.type_evenement == type_evenement)
    q.update({"date_evenement": date}, synchronize_session=False)


def creer_feedback(db, p: FeedbackPlan, cibles: dict, cx: Utilisateur, date: datetime, rng: random.Random) -> Feedback:
    agence, qr, cats = cibles[p.agence]
    debut = datetime.now(timezone.utc) - timedelta(seconds=1)
    payload = FeedbackCreate(categorie_id=cats[p.cle], note=p.note, commentaire=p.commentaire)
    if p.contact and p.contact.genre == "rappel":
        payload.souhaite_etre_rappele = True
        payload.contact_nom = "Client Le Prestige"
        payload.contact_telephone = f"+226 70 {rng.randint(10, 99)} {rng.randint(10, 99)} {rng.randint(10, 99)}"
    elif p.contact and p.contact.genre == "email":
        payload.contact_email = f"client{rng.randint(100, 999)}@example.com"
    reponse = submit_feedback(qr_code=qr.code, data=payload, background_tasks=BackgroundTasks(), db=db)

    # Marqueur AVANT toute vérification : --supprimer retrouve ce feedback quoi qu'il arrive.
    db.add(HistoriqueFeedback(
        feedback_id=reponse.id, agence_id=agence.id, auteur_nom="Script seed_restauration_demo",
        auteur_role="system", type_evenement=MARQUEUR, details=f"Jeu de données de démo restauration (clé {p.cle})",
    ))
    db.commit()

    analyse = db.query(AnalyseIA).filter(AnalyseIA.feedback_id == reponse.id).first()
    if analyse is None or analyse.sentiment != p.sentiment_attendu:
        obtenu = analyse.sentiment.value if analyse else "aucune analyse"
        raise RuntimeError(f"Analyse IA inattendue pour le feedback {reponse.id} : attendu "
                           f"{p.sentiment_attendu.value}, obtenu {obtenu}. Arrêt — retirer avec --supprimer.")

    feedback = db.get(Feedback, reponse.id)
    feedback.date_soumission = date
    analyse.date_analyse = date
    if feedback.demande_contact is not None:
        feedback.demande_contact.date_demande = date
    _antidater_historique_feedback(db, feedback.id, debut, date)
    db.commit()

    if p.contact and p.contact.traitement:
        date_traitement = date + timedelta(hours=rng.randint(2, 30))
        debut_traitement = datetime.now(timezone.utc) - timedelta(seconds=1)
        if p.contact.traitement == "reponse":
            envoyer_reponse_client(feedback_id=feedback.id, data=ReponseClientCreate(contenu=p.contact.reponse, canal=p.contact.canal),
                                   db=db, current_user=cx)
            db.query(ReponseClient).filter(ReponseClient.feedback_id == feedback.id, ReponseClient.date_envoi >= debut_traitement) \
                .update({"date_envoi": date_traitement}, synchronize_session=False)
            _antidater_historique_feedback(db, feedback.id, debut_traitement, date_traitement, "reponse_client")
        else:
            marquer_demande_contact_traitee(contact_id=feedback.demande_contact.id, db=db, current_user=cx)
        db.commit()
    return feedback


# ============================================================================
# 5. ISSUES (pipeline réel + antidatage, comme seed_issues_demo.py)
# ============================================================================

def _antidater_historique_issue(db, issue_id, type_evenement: str, date: datetime) -> None:
    db.query(HistoriqueIssue).filter(HistoriqueIssue.issue_id == issue_id, HistoriqueIssue.type_evenement == type_evenement) \
        .update({"date_evenement": date}, synchronize_session=False)


def creer_une_issue(db, i: IssuePlan, cibles: dict, cx: Utilisateur, feedbacks_par_ref: dict, issues_par_ref: dict,
                    date: datetime, rng: random.Random) -> Issue:
    agence, _qr, cats = cibles[i.agence]
    debut = datetime.now(timezone.utc) - timedelta(seconds=1)
    feedback_ids = [feedbacks_par_ref[r].id for r in i.feedbacks]
    reponse = creer_issue(
        data=IssueCreate(titre=i.titre + MARQUEUR_TITRE, agence_id=agence.id, categorie_id=cats[i.cle], severite=i.severite,
                         issue_origine_id=issues_par_ref[i.origine].id if i.origine else None, feedback_ids=feedback_ids),
        db=db, current_user=cx,
    )
    issue = db.get(Issue, reponse.id)
    issue.premiere_detection = date
    issue.derniere_detection = date
    db.flush()
    for evt in ("creation", "feedback_rattache"):
        _antidater_historique_issue(db, issue.id, evt, date)
    for fid in feedback_ids:
        _antidater_historique_feedback(db, fid, debut, date)
    if i.statut == "ouverte":
        db.commit()
        return issue

    action_date = date + timedelta(hours=rng.randint(2, 20))
    action_rep = creer_action_corrective(issue_id=issue.id, data=ActionCorrectiveCreate(titre=f"Plan d'action — {i.titre}"[:200]),
                                         db=db, current_user=cx)
    action = db.get(ActionCorrective, action_rep.id)
    action.created_at = action.updated_at = action_date
    db.flush()
    _antidater_historique_issue(db, issue.id, "action_creee", action_date)
    if i.statut == "action_en_cours":
        db.commit()
        return issue

    now = datetime.now(timezone.utc)
    completion = min(action_date + timedelta(hours=rng.randint(12, 72)), now - timedelta(minutes=10))
    terminer_action_corrective(issue_id=issue.id, action_id=action.id, db=db, current_user=cx)
    action = db.get(ActionCorrective, action.id)
    action.date_completion = action.updated_at = completion
    issue.date_resolution = completion
    db.flush()
    _antidater_historique_issue(db, issue.id, "action_terminee", completion)
    _antidater_historique_issue(db, issue.id, "issue_resolue", completion)
    if i.statut == "verifiee":
        verification = min(completion + timedelta(hours=rng.randint(4, 48)), now - timedelta(minutes=5))
        verifier_issue(issue_id=issue.id, db=db, current_user=cx)
        issue.date_verification = verification
        db.flush()
        _antidater_historique_issue(db, issue.id, "issue_verifiee", verification)
    db.commit()
    db.refresh(issue)
    if issue.statut != i.statut:
        raise RuntimeError(f"Issue {i.ref} : statut {issue.statut}, attendu {i.statut}. Arrêt — retirer avec --supprimer.")
    return issue


# ============================================================================
# 6. SUPPRESSION (--supprimer)
# ============================================================================

def contenu_etranger(db, org: Organisation) -> list[str]:
    """Tout ce qui, dans l'organisation, ne vient pas de ce script (liste vide = sûr)."""
    problemes = []
    emails = {u.email for u in db.query(Utilisateur).filter(Utilisateur.organisation_id == org.id).all()}
    if emails - {CX["email"], CHEF["email"]}:
        problemes.append(f"utilisateurs non créés par le script : {sorted(emails - {CX['email'], CHEF['email']})}")
    noms = {a.nom for a in db.query(Agence).filter(Agence.organisation_id == org.id).all()}
    if noms - {a.nom for a in AGENCES}:
        problemes.append(f"agences non créées par le script : {sorted(noms - {a.nom for a in AGENCES})}")
    non_marques = (
        db.query(Feedback.id).join(QRCode, Feedback.qr_code_id == QRCode.id).join(Agence, QRCode.agence_id == Agence.id)
        .filter(Agence.organisation_id == org.id)
        .filter(~db.query(HistoriqueFeedback.id).filter(HistoriqueFeedback.feedback_id == Feedback.id,
                                                         HistoriqueFeedback.type_evenement == MARQUEUR).exists())
        .count()
    )
    if non_marques:
        problemes.append(f"{non_marques} feedback(s) sans marqueur {MARQUEUR}")
    issues_etrangeres = db.query(Issue).filter(Issue.organisation_id == org.id, ~Issue.titre.like(f"%{MARQUEUR_TITRE}")).count()
    if issues_etrangeres:
        problemes.append(f"{issues_etrangeres} Issue(s) sans marqueur de titre")
    escalades = db.query(IssueEscalation).join(Issue, IssueEscalation.issue_id == Issue.id).filter(Issue.organisation_id == org.id).count()
    if escalades:
        problemes.append(f"{escalades} escalade(s) d'Issue")
    mentions = db.query(MentionVeille).filter(MentionVeille.organisation_id == org.id).count()
    if mentions:
        problemes.append(f"{mentions} mention(s) de veille")
    return problemes


def supprimer(db, org: Organisation, admin_par_defaut: Utilisateur) -> None:
    problemes = contenu_etranger(db, org)
    if problemes:
        raise SystemExit("[REFUS] L'organisation contient des données qui ne viennent pas de ce script, rien n'est "
                         "supprimé :\n  " + "\n  ".join(problemes))
    createur = db.get(Utilisateur, org.created_by_id) if org.created_by_id else None
    admin = createur if createur is not None and createur.role == UserRole.ADMIN else admin_par_defaut
    delete_organisation(org_id=org.id, db=db, current_user=admin)


# ============================================================================
# 7. MAIN
# ============================================================================

def organisation_de_demo(db) -> Organisation | None:
    org = db.query(Organisation).filter(or_(Organisation.email_pro == EMAIL_PRO, Organisation.nom == ORGANISATION_NOM)).first()
    if org is not None and (org.email_pro != EMAIL_PRO or org.nom != ORGANISATION_NOM):
        raise SystemExit(f"[REFUS] Une organisation « {org.nom} » ({org.email_pro}) existe mais n'est pas celle de ce "
                         f"script : rien n'est modifié.")
    return org


def main(argv: list[str] | None = None) -> None:
    argv = sys.argv[1:] if argv is None else argv
    db = SessionLocal()
    try:
        org = organisation_de_demo(db)

        if "--supprimer" in argv:
            if org is None:
                print("[OK] Rien à supprimer : organisation de démo absente.")
                return
            supprimer(db, org, trouver_admin(db))
            print(f"[OK] Organisation « {ORGANISATION_NOM} » supprimée avec tout son contenu de démo.")
            return

        if org is not None and "--force" not in argv:
            print(f"[REFUS] L'organisation « {ORGANISATION_NOM} » existe déjà. Relancer avec --force pour ajouter un "
                  f"second lot, ou --supprimer pour la retirer.")
            return

        verifier_plan()
        admin = trouver_admin(db)
        if org is None:
            org = creer_organisation(db, admin)
        cx = db.query(Utilisateur).filter(Utilisateur.organisation_id == org.id, Utilisateur.email == CX["email"]).one()
        cibles = charger_cibles(db, org)

        rng = random.Random(2026)
        now = datetime.now(timezone.utc)
        feedbacks_par_ref = {}
        for p in PLAN_FEEDBACKS:
            fb = creer_feedback(db, p, cibles, cx, _date(rng, now, p.jours), rng)
            if p.ref:
                feedbacks_par_ref[p.ref] = fb

        issues_par_ref = {}
        for i in PLAN_ISSUES:
            issues_par_ref[i.ref] = creer_une_issue(db, i, cibles, cx, feedbacks_par_ref, issues_par_ref,
                                                    _date(rng, now, i.jours), rng)

        n_rappels = sum(1 for p in PLAN_FEEDBACKS if p.contact and p.contact.genre == "rappel")
        n_traites = sum(1 for p in PLAN_FEEDBACKS if p.contact and p.contact.genre == "rappel" and p.contact.traitement)
        print("\n" + "=" * 70)
        print(f"RÉCAPITULATIF — {ORGANISATION_NOM}")
        print("=" * 70)
        print(f"Points de vente : {', '.join(a.nom for a in AGENCES)}")
        print(f"Feedbacks créés : {len(PLAN_FEEDBACKS)} (négatifs : {sum(1 for p in PLAN_FEEDBACKS if p.sentiment_attendu == NEG)})")
        print(f"Demandes de rappel : {n_rappels}, traitées : {n_traites}")
        print(f"Issues créées : {len(PLAN_ISSUES)} (récurrentes : {sum(1 for i in PLAN_ISSUES if i.origine)})")
        print(f"CX Manager : {CX['email']} / {MOT_DE_PASSE_DEMO}")
        print(f"Chef d'agence ({AGENCE_DU_CHEF}) : {CHEF['email']} / {MOT_DE_PASSE_DEMO}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
