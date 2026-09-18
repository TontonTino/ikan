"""
Script de seeding démo — Orange Burkina Faso.

Crée les catégories réelles par agence (remplace/désactive le fallback "Général"
et tout résidu de test), puis génère un jeu de feedbacks réalistes réparti sur
45 jours, en passant CHAQUE feedback par le pipeline réel de soumission
(app.api.v1.endpoints.feedbacks.submit_feedback) pour que l'analyse de
sentiment, la criticité, la discordance et les recommandations IA soient
calculées exactement comme en production — seule la date de soumission est
repoussée dans le passé après coup, pour obtenir une vraie répartition
temporelle (le calcul de l'analyse, lui, reste 100% réel).

Usage :
    cd apps/api
    python scripts/seed_feedbacks_demo.py               # Orange Burkina Faso (Entreprise)
    python scripts/seed_feedbacks_demo.py --plans-demo  # 3 organisations de démo :
                                                        # Gratuit / Starter / Pro
"""
import os
import sys
import random
import uuid
import io
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Force stdout en UTF-8 (la console Windows par défaut est en cp1252 et ne
# supporte pas les accents/emoji imprimés par ce script).
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

from fastapi import BackgroundTasks

from app.db.session import SessionLocal
from app.models.agence import Agence
from app.models.categorie import Categorie
from app.models.qr_code import QRCode
from app.models.feedback import Feedback
from app.models.historique_feedback import HistoriqueFeedback
from app.models.analyse_ia import AnalyseIA
from app.models.recommandation import Recommandation
from app.models.demande_contact import DemandeContact
from app.models.enums import CriticiteType, UserRole
from app.models.organisation import Organisation
from app.models.utilisateur import Utilisateur
from app.core.config import settings
from app.core.security import get_password_hash
from app.services.categorie_service import get_or_create_categories_actives
from app.services.plan_catalog import PLAN_GRATUIT_ID, PLAN_STARTER_ID, PLAN_PRO_ID
from app.schemas.feedback import FeedbackCreate
from app.api.v1.endpoints.feedbacks import submit_feedback

random.seed(42)  # reproductible si on doit relancer avant la démo

# ============================================================================
# 1. PÉRIMÈTRE : agences, catégories cibles
# ============================================================================

AGENCES_STANDARD = [
    "Agence Orange Siège (Koulouba)",
    "Agence Orange Ouaga 2000",
    "Agence Premium Centre Commercial Ouaga 2000",
    "Agence Orange Tanghin",
    "Agence Orange Saaba",
    "Agence Premium Super U Zad",
    "Agence Orange Pissy",
    "Agence Orange Bobo-Dioulasso",
    "Agence Orange Koupéla",
    "Agence Ouahigouya",
]
AGENCE_DIGITAL_CENTER = "Orange Digital Center (Cissin)"

CATEGORIES_STANDARD = [
    "Accueil",
    "Service Client",
    "Carte SIM & Numéro",
    "Forfaits & Recharge",
    "Internet & Réseau Mobile",
    "Facturation & Paiement",
    "Équipements & Boutique",
]
CATEGORIES_DIGITAL_CENTER = ["Accueil", "Formation", "Propreté"]

# Notes explicites par agence (pas de tirage aléatoire pur : on garantit un
# niveau de satisfaction réaliste et contrôlé par agence, cf. seuils d'alerte).
# Agences "saines" (>= 80% de notes 4-5) vs. agences "à problème" (nettement
# sous le seuil), pour que les alertes et recommandations se déclenchent
# vraiment sur des agences précises et identifiables en démo.
NOTES_PAR_AGENCE = {
    "Agence Orange Siège (Koulouba)": [5, 5, 4, 5, 5, 4, 3, 5, 5, 4, 5, 5],
    "Agence Orange Ouaga 2000": [5, 4, 5, 5, 3, 5, 4, 5, 5, 4, 5],
    "Agence Premium Centre Commercial Ouaga 2000": [5, 5, 4, 5, 3, 5, 4, 5, 5],
    "Orange Digital Center (Cissin)": [5, 5, 4, 5, 5, 4, 3, 5],
    "Agence Orange Bobo-Dioulasso": [4, 5, 5, 3, 5, 4, 5, 5],
    "Agence Premium Super U Zad": [5, 4, 5, 3, 5, 4],
    "Agence Orange Saaba": [5, 4, 5, 4],
    # Agences à problème (satisfaction sous le seuil de 80%)
    "Agence Orange Pissy": [2, 1, 4, 2, 3, 5, 2],
    "Agence Orange Tanghin": [1, 2, 3, 2, 4, 5],
    "Agence Orange Koupéla": [2, 1, 3, 4],
    # Ajoutée après coup (découverte en cours de seeding) : agence saine,
    # on a déjà 3 agences en alerte (Pissy/Tanghin/Koupéla), pas besoin d'une 4e.
    "Agence Ouahigouya": [5, 5, 4, 5, 5, 3, 5],
}

AGENCES_PROBLEME = {"Agence Orange Pissy", "Agence Orange Tanghin", "Agence Orange Koupéla"}

# ============================================================================
# 2. BANQUE DE COMMENTAIRES (variés, en français, cohérents catégorie/note)
# ============================================================================

COMMENTAIRES = {
    "Accueil": {
        "pos": [
            "Accueil très chaleureux, l'agent a pris le temps de m'expliquer les offres.",
            "Bon accueil, personnel souriant et à l'écoute.",
            "Très satisfait de l'accueil, rapide et courtois.",
            "L'hôtesse était vraiment aimable, je recommande cette agence.",
        ],
        "neu": [
            "Accueil correct, quelques minutes d'attente avant d'être pris en charge.",
            "Rien de particulier à signaler sur l'accueil, c'est passable.",
        ],
        "neg": [
            "Accueil très froid, le conseiller n'était pas du tout aimable.",
            "Personnel impoli, j'ai attendu longtemps sans excuse.",
        ],
    },
    "Service Client": {
        "pos": [
            "Le conseiller a résolu mon problème rapidement, merci.",
            "Service client efficace, j'ai eu une réponse claire à ma question.",
            "Très bonne prise en charge, on m'a bien orienté.",
            "Le personnel a été patient et professionnel, rien à redire.",
        ],
        "neu": [
            "Service correct mais rien d'exceptionnel non plus.",
            "Prise en charge un peu lente mais le problème a fini par être traité.",
        ],
        "neg": [
            "Le service client n'a pas résolu mon problème, je suis très déçu.",
            "Mauvaise prise en charge, on m'a mal renseigné.",
        ],
    },
    "Carte SIM & Numéro": {
        "pos": [
            "Remplacement de ma carte SIM effectué en quelques minutes seulement.",
            "Activation de mon nouveau numéro sans souci, service rapide.",
            "Récupération de ma carte SIM après perte, tout s'est bien passé.",
        ],
        "neu": [
            "La procédure pour ma carte SIM a pris un peu de temps mais ça s'est fait.",
        ],
        "neg": [
            "Ma carte SIM ne fonctionne toujours pas après le remplacement, c'est inadmissible.",
            "Problème avec mon numéro depuis plusieurs jours, aucune solution proposée.",
        ],
    },
    "Forfaits & Recharge": {
        "pos": [
            "Le conseiller m'a proposé un forfait mieux adapté à mes besoins, satisfait.",
            "Recharge effectuée immédiatement, aucun problème.",
            "Bonne explication des différentes formules de forfaits disponibles.",
        ],
        "neu": [
            "Le forfait proposé est correct sans être le plus avantageux.",
        ],
        "neg": [
            "Ma recharge n'a pas été créditée, très mauvaise expérience.",
            "Le forfait vendu ne correspond pas à ce qui était promis, c'est une arnaque.",
        ],
    },
    "Internet & Réseau Mobile": {
        "pos": [
            "Bonne couverture réseau dans le quartier, connexion stable.",
            "Le débit internet s'est nettement amélioré ces derniers temps.",
            "Pas de coupure de réseau, je suis satisfait de la 4G ici.",
        ],
        "neu": [
            "Le réseau est correct mais un peu instable aux heures de pointe.",
        ],
        "neg": [
            "Le réseau internet est très lent depuis plusieurs jours, difficile de faire mes transactions.",
            "Coupures de réseau permanentes, c'est catastrophique pour mon travail.",
            "Aucune connexion 4G dans le quartier depuis une semaine, inacceptable.",
        ],
    },
    "Facturation & Paiement": {
        "pos": [
            "Facture claire et détaillée, aucune contestation à faire.",
            "Paiement de ma facture rapide, plusieurs options disponibles.",
            "Explication précise sur les frais prélevés, merci à l'agent.",
        ],
        "neu": [
            "Facturation dans la norme, rien à signaler de particulier.",
        ],
        "neg": [
            "Facturation incompréhensible, on m'a prélevé un montant injustifié.",
            "Double prélèvement sur ma facture, personne ne peut m'expliquer pourquoi.",
        ],
    },
    "Équipements & Boutique": {
        "pos": [
            "Bon choix de téléphones et accessoires disponibles en boutique.",
            "L'agent m'a bien conseillé pour le choix de mon nouveau téléphone.",
            "Boutique bien approvisionnée, service rapide à l'achat.",
        ],
        "neu": [
            "Le choix en boutique est limité mais correct.",
        ],
        "neg": [
            "Téléphone acheté en panne après deux jours, très mauvaise qualité.",
            "Peu de choix en boutique et matériel visiblement défectueux.",
        ],
    },
    "Formation": {
        "pos": [
            "Formation très enrichissante, formateur compétent et disponible.",
            "J'ai beaucoup appris sur le numérique, merci à l'équipe du centre.",
            "Excellent atelier, les explications étaient claires et pratiques.",
        ],
        "neu": [
            "Formation correcte mais un peu trop théorique à mon goût.",
        ],
        "neg": [
            "Formation mal organisée, le formateur n'était pas préparé.",
        ],
    },
    "Propreté": {
        "pos": [
            "Locaux propres et bien entretenus, cadre agréable pour travailler.",
            "Espace de travail impeccable, très bonne hygiène générale.",
        ],
        "neu": [
            "Propreté correcte dans l'ensemble.",
        ],
        "neg": [
            "Locaux sales, poubelles pleines, c'est décevant pour un centre numérique.",
        ],
    },
}


COMMENTAIRES_GENERIQUES = {
    "pos": [
        "Très bon accueil et service rapide, je recommande.",
        "Personnel compétent et à l'écoute, tout s'est bien passé.",
        "Expérience agréable, merci à toute l'équipe.",
        "Efficace et courtois, je reviendrai avec plaisir.",
    ],
    "neu": [
        "Service correct, sans plus.",
        "Un peu d'attente mais le résultat est acceptable.",
    ],
    "neg": [
        "Très déçu, mon problème n'a pas été résolu.",
        "Attente interminable et personnel peu aimable.",
    ],
}

# Commentaire clairement négatif : associé à une note 5/5 il provoque une
# discordance (note haute + sentiment négatif) — détectée uniquement pour Pro+.
COMMENTAIRE_DISCORDANT = "Service catastrophique, personnel impoli, très déçu et en colère."


def pick_comment(categorie_nom: str, note: int) -> str:
    bank = COMMENTAIRES.get(categorie_nom, COMMENTAIRES_GENERIQUES)
    polarite = "pos" if note >= 4 else "neg" if note <= 2 else "neu"
    return random.choice(bank[polarite])


# ============================================================================
# 3. CONTACTS FICTIFS (format burkinabè) pour les demandes de rappel
# ============================================================================

PRENOMS = ["Aminata", "Boubacar", "Fatimata", "Issouf", "Mariam", "Ousmane", "Rasmata", "Seydou"]
NOMS = ["Ouédraogo", "Kaboré", "Compaoré", "Sawadogo", "Zongo", "Traoré", "Kiénou", "Nikièma"]


def contact_fictif():
    prenom = random.choice(PRENOMS)
    nom = random.choice(NOMS)
    prefixe = random.choice(["70", "71", "72", "74", "75", "76", "77", "78"])
    numero = f"+226 {prefixe} {random.randint(10,99)} {random.randint(10,99)} {random.randint(10,99)}"
    email = f"{prenom.lower()}.{nom.lower()}@gmail.com"
    return f"{prenom} {nom}", numero, email


# ============================================================================
# 4. CATÉGORIES : création / nettoyage des résidus
# ============================================================================

def ensure_categories(db, agence: Agence, target_names: list[str]) -> dict:
    existing = db.query(Categorie).filter(Categorie.agence_id == agence.id).all()
    existing_by_name = {c.nom.strip().lower(): c for c in existing}
    target_keys = {n.strip().lower() for n in target_names}

    created, reactivated, deactivated = [], [], []

    for name in target_names:
        key = name.strip().lower()
        if key in existing_by_name:
            cat = existing_by_name[key]
            if not cat.active:
                cat.active = True
                reactivated.append(cat.nom)
        else:
            cat = Categorie(id=uuid.uuid4(), agence_id=agence.id, nom=name, active=True)
            db.add(cat)
            db.flush()
            created.append(cat.nom)

    for c in existing:
        if c.nom.strip().lower() not in target_keys and c.active:
            c.active = False
            deactivated.append(c.nom)

    db.commit()

    cats = (
        db.query(Categorie)
        .filter(Categorie.agence_id == agence.id, Categorie.active == True)
        .all()
    )
    return {
        "created": created,
        "reactivated": reactivated,
        "deactivated": deactivated,
        "categories": cats,
    }


# ============================================================================
# 5. DATES : répartition sur 45 jours, ~3 tranches de 15 jours
# ============================================================================

def random_dates(n: int, now: datetime) -> list[datetime]:
    buckets = [0, 1, 2] * (n // 3 + 1)
    buckets = buckets[:n]
    random.shuffle(buckets)
    dates = []
    for b in buckets:
        jour_offset = b * 15 + random.randint(0, 14)
        heure = random.randint(8, 19)
        minute = random.randint(0, 59)
        d = now - timedelta(days=jour_offset)
        d = d.replace(hour=heure, minute=minute, second=random.randint(0, 59), microsecond=0)
        dates.append(d)
    return dates


# ============================================================================
# 6. GÉNÉRATION DES FEEDBACKS via le pipeline réel
# ============================================================================

def generer_feedbacks_agence(db, agence: Agence, categories: list[Categorie], notes: list[int], now: datetime, is_problem: bool,
                             dates: list[datetime] | None = None, commentaires_forces: dict[int, str] | None = None) -> list[dict]:
    qr = db.query(QRCode).filter(QRCode.agence_id == agence.id, QRCode.actif == True).first()
    if not qr:
        raise RuntimeError(f"Aucun QR code actif pour {agence.nom}")

    if dates is None:
        dates = random_dates(len(notes), now)
    commentaires_forces = commentaires_forces or {}
    resultats = []

    # ~15-20% des notes basses (1-2) avec une demande de rappel
    indices_basses = [i for i, n in enumerate(notes) if n <= 2]
    n_recontact = max(1, round(len(indices_basses) * 0.18)) if indices_basses else 0
    indices_recontact = set(random.sample(indices_basses, min(n_recontact, len(indices_basses)))) if indices_basses else set()

    for i, note in enumerate(notes):
        categorie = random.choice(categories)
        commentaire = commentaires_forces.get(i) or pick_comment(categorie.nom, note)

        payload = FeedbackCreate(
            categorie_id=categorie.id,
            note=note,
            commentaire=commentaire,
            souhaite_etre_rappele=i in indices_recontact,
        )
        if i in indices_recontact:
            nom, tel, email = contact_fictif()
            payload.contact_nom = nom
            payload.contact_telephone = tel
            payload.contact_email = email

        response = submit_feedback(
            qr_code=qr.code,
            data=payload,
            background_tasks=BackgroundTasks(),
            db=db,
        )

        # Repousse la date de soumission dans le passé (seule étape non "temps réel" :
        # tout le calcul d'analyse IA ci-dessus a déjà tourné pour de vrai).
        target_date = dates[i]
        feedback_row = db.query(Feedback).filter(Feedback.id == response.id).first()
        feedback_row.date_soumission = target_date
        db.query(HistoriqueFeedback).filter(HistoriqueFeedback.feedback_id == response.id).update(
            {"date_evenement": target_date}
        )
        db.query(AnalyseIA).filter(AnalyseIA.feedback_id == response.id).update(
            {"date_analyse": target_date}
        )
        db.commit()

        analyse = db.query(AnalyseIA).filter(AnalyseIA.feedback_id == response.id).first()
        reco = db.query(Recommandation).filter(Recommandation.analyse_ia_id == analyse.id).first() if analyse else None

        resultats.append({
            "note": note,
            "categorie": categorie.nom,
            "date": target_date,
            "sentiment": analyse.sentiment.value if analyse else None,
            "discordance": analyse.discordance_detectee if analyse else None,
            "criticite": analyse.criticite.value if analyse else None,
            "recontact": i in indices_recontact,
            "recommandation": reco.contenu if reco else None,
        })

    return resultats


# ============================================================================
# 7. MAIN
# ============================================================================

def feedbacks_existants(db, agence: Agence) -> int:
    return (
        db.query(Feedback)
        .join(QRCode, Feedback.qr_code_id == QRCode.id)
        .filter(QRCode.agence_id == agence.id)
        .count()
    )


# ============================================================================
# 8. ORGANISATIONS DE DÉMO PAR FORFAIT (Gratuit / Starter / Pro)
# ============================================================================

MOT_DE_PASSE_DEMO = "Demo2026!"

DEMO_ORGS = [
    {
        "nom": "Pharmacie Wend-Panga", "plan_id": PLAN_GRATUIT_ID, "plan": "Gratuit",
        "secteur": "Santé / Pharmacie", "email_pro": "contact@wendpanga-demo.bf",
        "cx": ("Aïcha", "Ouédraogo", "cx@wendpanga-demo.bf"),
        # (nom_agence, ville, lat, lng)
        "agences": [("Pharmacie Wend-Panga - Ouaga 2000", "Ouagadougou", 12.3320, -1.4930)],
        # Gratuit : pas de catégories personnalisées -> catégorie "Général" auto-créée.
        "categories": None,
        # 9 avis ce mois-ci (< 20). Le dernier est le cas de discordance.
        "notes": {0: [5, 4, 5, 3, 5, 2, 4, 5, 5]},
        "discordants": {0: [8]},
    },
    {
        "nom": "Sahel Distribution", "plan_id": PLAN_STARTER_ID, "plan": "Starter",
        "secteur": "Commerce / Distribution", "email_pro": "contact@sahel-demo.bf",
        "cx": ("Moussa", "Kaboré", "cx@sahel-demo.bf"),
        "agences": [
            ("Sahel Distribution - Ouaga Centre", "Ouagadougou", 12.3714, -1.5197),
            ("Sahel Distribution - Bobo-Dioulasso", "Bobo-Dioulasso", 11.1771, -4.2979),
            ("Sahel Distribution - Koudougou", "Koudougou", 12.2530, -2.3627),
        ],
        "categories": ["Accueil", "Rayons & Produits", "Caisse & Attente", "Propreté"],
        "notes": {
            0: [5, 4, 5, 5, 3, 4, 5, 2, 5],
            1: [4, 5, 3, 5, 4, 5, 1, 5],
            2: [5, 5, 4, 3, 5, 2, 4],
        },
        "discordants": {0: [8]},
    },
    {
        "nom": "Banque Horizon Faso", "plan_id": PLAN_PRO_ID, "plan": "Pro",
        "secteur": "Banque / Finance", "email_pro": "contact@horizon-demo.bf",
        "cx": ("Salif", "Compaoré", "cx@horizon-demo.bf"),
        "agences": [
            ("Horizon - Ouaga 2000", "Ouagadougou", 12.3300, -1.4900),
            ("Horizon - Zone du Bois", "Ouagadougou", 12.3520, -1.5060),
            ("Horizon - Tanghin", "Ouagadougou", 12.4080, -1.5010),
            ("Horizon - Bobo-Dioulasso", "Bobo-Dioulasso", 11.1850, -4.2900),
            ("Horizon - Koudougou", "Koudougou", 12.2600, -2.3600),
            ("Horizon - Ouahigouya", "Ouahigouya", 13.5800, -2.4200),
            ("Horizon - Banfora", "Banfora", 10.6300, -4.7600),
            ("Horizon - Fada N'Gourma", "Fada N'Gourma", 12.0600, 0.3500),
        ],
        "categories": ["Accueil", "Ouverture de compte", "Guichet & Attente", "Crédit", "Application mobile"],
        "notes": {
            0: [5, 4, 5, 5, 3, 4, 5, 5],
            1: [5, 4, 4, 5, 3, 5],
            2: [4, 5, 2, 5, 3, 4],
            3: [5, 5, 4, 3, 5, 4, 5],
            4: [4, 5, 5, 3, 4],
            5: [5, 4, 5, 2, 5],
            6: [4, 5, 5, 4, 3],
            7: [5, 4, 5, 5],
        },
        "discordants": {0: [7], 3: [6]},
    },
]


def dates_mois_courant(n: int, now: datetime) -> list[datetime]:
    """n dates dans le mois calendaire courant (jamais dans le futur), pour que le
    quota mensuel du forfait Gratuit reflète bien ces feedbacks."""
    jours_max = max(now.day - 1, 0)
    dates = []
    for _ in range(n):
        offset = random.randint(1, jours_max) if jours_max >= 1 else 0
        d = now - timedelta(days=offset)
        heure = random.randint(8, 19) if offset >= 1 else max(0, min(now.hour - 1, 19))
        dates.append(d.replace(hour=heure, minute=random.randint(0, 59), second=random.randint(0, 59), microsecond=0))
    return dates


def creer_agence_avec_qr(db, org: Organisation, nom: str, ville: str, lat: float, lng: float) -> Agence:
    """Même logique que POST /agences : agence + QR code actif."""
    agence = Agence(organisation_id=org.id, nom=nom, ville=ville, adresse=ville, latitude=lat, longitude=lng, active=True)
    db.add(agence)
    db.flush()
    base_url = settings.PUBLIC_CLIENT_URL.rstrip("/")
    clean_name = agence.nom.upper().replace(" ", "-")[:12]
    code = f"QR-{clean_name}-{uuid.uuid4().hex[:6].upper()}"
    db.add(QRCode(id=uuid.uuid4(), agence_id=agence.id, code=code, url=f"{base_url}/feedback/{code}",
                  label=f"Borne Accueil - {agence.nom}", actif=True))
    db.commit()
    db.refresh(agence)
    return agence


def seed_plans_demo():
    """Crée les organisations de démo Gratuit / Starter / Pro (Entreprise = Orange Burkina Faso).
    Chaque feedback passe par le pipeline réel (submit_feedback). Idempotent par organisation."""
    db = SessionLocal()
    now = datetime.now(timezone.utc)
    random.seed(2026)
    resume = []
    try:
        for cfg in DEMO_ORGS:
            if db.query(Organisation).filter(Organisation.nom == cfg["nom"]).first():
                print(f"[SKIP] {cfg['nom']} existe déjà.")
                continue

            org = Organisation(nom=cfg["nom"], secteur_activite=cfg["secteur"], pays_region="Burkina Faso",
                               email_pro=cfg["email_pro"], plan_id=cfg["plan_id"])
            db.add(org)
            db.flush()
            prenom, nom, email = cfg["cx"]
            db.add(Utilisateur(organisation_id=org.id, nom=nom, prenom=prenom, email=email,
                               mot_de_passe_hash=get_password_hash(MOT_DE_PASSE_DEMO),
                               role=UserRole.CX_MANAGER, active=True))
            db.commit()
            db.refresh(org)

            total, discordances = 0, 0
            for idx, (nom_ag, ville, lat, lng) in enumerate(cfg["agences"]):
                agence = creer_agence_avec_qr(db, org, nom_ag, ville, lat, lng)
                if cfg["categories"]:
                    categories = ensure_categories(db, agence, cfg["categories"])["categories"]
                else:
                    categories = get_or_create_categories_actives(agence.id, db)  # "Général"
                notes = list(cfg["notes"][idx])
                forces = {i: COMMENTAIRE_DISCORDANT for i in cfg["discordants"].get(idx, [])}
                for i in forces:
                    notes[i] = 5  # note 5/5 + commentaire négatif
                res = generer_feedbacks_agence(db, agence, categories, notes, now, False,
                                               dates=dates_mois_courant(len(notes), now),
                                               commentaires_forces=forces)
                total += len(res)
                discordances += sum(1 for r in res if r["discordance"])
            resume.append((cfg["nom"], cfg["plan"], len(cfg["agences"]), total, discordances, email))
            print(f"[OK] {cfg['nom']} ({cfg['plan']}) : {len(cfg['agences'])} agence(s), {total} feedbacks, "
                  f"{discordances} discordance(s) détectée(s)")
    finally:
        db.close()

    print("\n" + "=" * 70)
    print("ORGANISATIONS DE DÉMO CRÉÉES")
    print("=" * 70)
    for nom, plan, nb_ag, nb_fb, nb_d, email in resume:
        print(f"{nom} | {plan} | {nb_ag} agence(s) | {nb_fb} feedbacks | discordances: {nb_d} | {email} / {MOT_DE_PASSE_DEMO}")


def main():
    if "--plans-demo" in sys.argv:
        seed_plans_demo()
        return

    db = SessionLocal()
    now = datetime.now(timezone.utc)
    force = "--force" in sys.argv

    # Garde-fou : ce script n'est pas idempotent côté feedbacks (contrairement aux
    # catégories) — le relancer sans nettoyer produirait des doublons. Vérifié
    # PAR AGENCE (pas globalement) : une agence déjà peuplée est ignorée sans
    # bloquer le traitement des autres — utile pour rattraper une agence ajoutée
    # après coup sans retoucher aux données déjà générées ailleurs.
    # --force ignore cette vérification et régénère tout (y compris les
    # agences déjà peuplées, au risque de créer des doublons).

    rapport = {"categories": {}, "feedbacks": {}}

    try:
        toutes_agences = AGENCES_STANDARD + [AGENCE_DIGITAL_CENTER]
        for nom_agence in toutes_agences:
            agence = db.query(Agence).filter(Agence.nom == nom_agence).first()
            if not agence:
                print(f"[IGNOREE] Agence introuvable : {nom_agence}")
                continue

            if not force:
                existing = feedbacks_existants(db, agence)
                if existing > 0:
                    print(f"[SKIP] {nom_agence} : {existing} feedback(s) déjà présent(s), agence ignorée "
                          f"(relancer avec --force pour régénérer quand même).")
                    continue

            target = CATEGORIES_DIGITAL_CENTER if nom_agence == AGENCE_DIGITAL_CENTER else CATEGORIES_STANDARD
            cat_result = ensure_categories(db, agence, target)
            rapport["categories"][nom_agence] = cat_result

            notes = NOTES_PAR_AGENCE[nom_agence]
            is_problem = nom_agence in AGENCES_PROBLEME
            feedbacks = generer_feedbacks_agence(db, agence, cat_result["categories"], notes, now, is_problem)
            rapport["feedbacks"][nom_agence] = feedbacks

            print(f"[OK] {nom_agence} : {len(feedbacks)} feedbacks générés "
                  f"({cat_result['created'].__len__()} catégories créées, "
                  f"{cat_result['deactivated'].__len__()} désactivées)")

    finally:
        db.close()

    # ---- Récapitulatif final ----
    print("\n" + "=" * 70)
    print("RÉCAPITULATIF")
    print("=" * 70)

    total_fb = 0
    total_reco = 0
    total_recontact = 0
    note_counts = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
    agences_sous_seuil = []

    for nom_agence, feedbacks in rapport["feedbacks"].items():
        n = len(feedbacks)
        total_fb += n
        satisf = sum(1 for f in feedbacks if f["note"] >= 4)
        taux = round(satisf / n * 100, 1) if n else 0.0
        recos = sum(1 for f in feedbacks if f["recommandation"])
        recontacts = sum(1 for f in feedbacks if f["recontact"])
        total_reco += recos
        total_recontact += recontacts
        for f in feedbacks:
            note_counts[f["note"]] += 1
        sous_seuil = taux < 80.0
        if sous_seuil:
            agences_sous_seuil.append((nom_agence, taux))

        print(f"\n{nom_agence}")
        print(f"  Feedbacks: {n} | Satisfaction: {taux}% {'[SOUS SEUIL 80%]' if sous_seuil else ''}")
        print(f"  Recommandations générées: {recos} | Demandes de rappel: {recontacts}")

    print("\n" + "-" * 70)
    print(f"TOTAL feedbacks: {total_fb}")
    print(f"Répartition des notes: {note_counts}")
    print(f"TOTAL recommandations générées: {total_reco}")
    print(f"TOTAL demandes de rappel: {total_recontact}")
    print(f"Agences sous le seuil d'alerte (80%): {agences_sous_seuil}")


if __name__ == "__main__":
    main()
