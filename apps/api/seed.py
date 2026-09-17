"""
Script d'initialisation (Seed) de la base de données IKAN AI.
Permet d'injecter des données de démonstration réalistes pour les tests et la présentation.

Utilisation :
    python seed.py
"""
import sys
import uuid
import logging
from datetime import datetime, timedelta, timezone

# S'assurer que le package 'app' est accessible
sys.path.append(".")

from app.db.session import SessionLocal, engine
from app.db.session import Base
from app.models.enums import UserRole, IdeaStatus
from app.models.organisation import Organisation
from app.models.agence import Agence
from app.models.utilisateur import Utilisateur
from app.models.qr_code import QRCode
from app.models.feedback import Feedback
from app.models.suggestion import Suggestion
from app.models.demande_contact import DemandeContact
from app.core.security import get_password_hash
from app.core.config import settings
from app.services.ai.analyse_service import analyser_feedback

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("seed")


def seed_database():
    logger.info("=== Début du Seeding de la base de données IKAN AI ===")
    
    # Créer les tables si elles n'existent pas
    Base.metadata.create_all(bind=engine)
    
    db = SessionLocal()

    try:
        # 1. Nettoyage si des données existent déjà
        existing_org = db.query(Organisation).first()
        if existing_org:
            logger.info("Des données existent déjà. Nettoyage de la base de données...")
            db.query(DemandeContact).delete()
            db.query(Suggestion).delete()
            db.query(Feedback).delete()
            db.query(QRCode).delete()
            db.query(Utilisateur).delete()
            db.query(Agence).delete()
            db.query(Organisation).delete()
            db.commit()

        # 2. Création de l'Organisation principale
        logger.info("Création de l'organisation exemple 'Orange Tunisie'...")
        admin_id = uuid.uuid4()
        org_id = uuid.uuid4()

        org = Organisation(
            id=org_id,
            nom="Orange Tunisie",
            logo="https://upload.wikimedia.org/wikipedia/commons/c/c8/Orange_logo.svg",
            secteur_activite="Télécommunications",
            pays_region="Tunisie / Afrique du Nord",
            email_pro="contact@orange.tn",
            created_by_id=None,
            active=True
        )
        db.add(org)
        db.flush()

        # 3. Création des Agences
        logger.info("Création des agences...")
        agences_data = [
            {
                "nom": "Agence Tunis Bourguiba",
                "adresse": "Avenue Habib Bourguiba, Tunis",
                "ville": "Tunis",
                "latitude": 36.8002,
                "longitude": 10.1860,
                "seuil_alerte": 80.0
            },
            {
                "nom": "Agence Sousse Les Oliviers",
                "adresse": "Boulevard 14 Janvier, Sousse",
                "ville": "Sousse",
                "latitude": 35.8256,
                "longitude": 10.6369,
                "seuil_alerte": 75.0
            },
            {
                "nom": "Agence Sfax Ville",
                "adresse": "Avenue Hedi Chaker, Sfax",
                "ville": "Sfax",
                "latitude": 34.7406,
                "longitude": 10.7603,
                "seuil_alerte": 80.0
            }
        ]

        agences = []
        for a_data in agences_data:
            ag = Agence(
                id=uuid.uuid4(),
                organisation_id=org.id,
                nom=a_data["nom"],
                adresse=a_data["adresse"],
                ville=a_data["ville"],
                latitude=a_data["latitude"],
                longitude=a_data["longitude"],
                seuil_alerte=a_data["seuil_alerte"],
                active=True
            )
            db.add(ag)
            agences.append(ag)
        
        db.flush()

        # 4. Création des Utilisateurs
        logger.info("Création des comptes utilisateurs...")
        password_hash = get_password_hash("Password123!")

        users_data = [
            {
                "id": admin_id,
                "nom": "Admin",
                "prenom": "Système",
                "email": "admin@ikanai.app",
                "role": UserRole.ADMIN,
                "agence_id": None,
                "created_by_id": None,
            },
            {
                "id": uuid.uuid4(),
                "nom": "Ben Ali",
                "prenom": "Sami",
                "email": "cx@orange.tn",
                "role": UserRole.CX_MANAGER,
                "agence_id": None,
                "created_by_id": admin_id,
            },
            {
                "id": uuid.uuid4(),
                "nom": "Mansour",
                "prenom": "Leila",
                "email": "manager.tunis@orange.tn",
                "role": UserRole.AGENCY_MANAGER,
                "agence_id": agences[0].id,
                "created_by_id": None,
            },
            {
                "id": uuid.uuid4(),
                "nom": "Trabelsi",
                "prenom": "Karim",
                "email": "manager.sousse@orange.tn",
                "role": UserRole.AGENCY_MANAGER,
                "agence_id": agences[1].id,
                "created_by_id": None,
            }
        ]

        for u_data in users_data:
            user = Utilisateur(
                id=u_data["id"],
                organisation_id=org.id,
                agence_id=u_data["agence_id"],
                nom=u_data["nom"],
                prenom=u_data["prenom"],
                email=u_data["email"],
                mot_de_passe_hash=password_hash,
                role=u_data["role"],
                created_by_id=u_data.get("created_by_id"),
                active=True
            )
            db.add(user)

        db.flush()
        # Assigner l'admin comme créateur de l'organisation
        org.created_by_id = admin_id
        db.flush()

        # 5. Création des QR Codes
        logger.info("Création des QR Codes d'agences...")
        qr_codes = []
        for idx, ag in enumerate(agences):
            code_str = f"QR-ORANGE-{ag.ville.upper()}-01"
            url_val = f"{settings.PUBLIC_CLIENT_URL.rstrip('/')}/feedback/{code_str}"
            qr = QRCode(
                id=uuid.uuid4(),
                agence_id=ag.id,
                code=code_str,
                url=url_val,
                label=f"Borne Accueil - {ag.nom}",
                actif=True
            )
            db.add(qr)
            qr_codes.append(qr)

        db.flush()

        # 6. Création des Feedbacks réalistes et déclenchement de l'IA
        logger.info("Génération de 18 feedbacks de démonstration et analyse IA...")
        now = datetime.now(timezone.utc)

        feedbacks_samples = [
            # Agence Tunis
            {
                "qr_code": qr_codes[0],
                "note": 5,
                "commentaire": "Accueil chaleureux et professionnel. Mon problème de carte SIM a été résolu en 5 minutes !",
                "days_ago": 1,
                "suggestion": None
            },
            {
                "qr_code": qr_codes[0],
                "note": 1,
                "commentaire": "Temps d'attente inadmissible ! Plus de 50 minutes d'attente pour payer une facture, seulement 2 guichets ouverts.",
                "days_ago": 2,
                "suggestion": "Ouvrir plus de guichets aux heures de pointe (12h-14h)."
            },
            {
                "qr_code": qr_codes[0],
                "note": 4,
                "commentaire": "Personnel très poli et serviable. La climatisation était cependant un peu trop forte.",
                "days_ago": 3,
                "suggestion": None
            },
            {
                "qr_code": qr_codes[0],
                "note": 2,
                "commentaire": "Application mobile en panne et l'agent sur place ne savait pas comment m'aider.",
                "days_ago": 5,
                "suggestion": "Former les agents aux problèmes du service digital et de l'application."
            },
            {
                "qr_code": qr_codes[0],
                "note": 1,
                "commentaire": "Service très décevant, aucun sourire, agent impoli.",
                "days_ago": 7,
                "suggestion": None,
                "contact": {"nom": "Mohamed Gharbi", "telephone": "+216 98 123 456", "email": "m.gharbi@gmail.com"}
            },
            {
                "qr_code": qr_codes[0],
                "note": 5,
                "commentaire": "Super expérience client. Passage fluide et explications claires sur la nouvelle offre fibre !",
                "days_ago": 10,
                "suggestion": None
            },
            {
                "qr_code": qr_codes[0],
                "note": 5,
                "commentaire": "Service lamentable et désastreux !", # Discordance volontaire: Note 5 mais commentaire très négatif
                "days_ago": 12,
                "suggestion": None
            },

            # Agence Sousse
            {
                "qr_code": qr_codes[1],
                "note": 5,
                "commentaire": "Excellente agence ! Très bien entretenue et équipe réactive.",
                "days_ago": 1,
                "suggestion": None
            },
            {
                "qr_code": qr_codes[1],
                "note": 2,
                "commentaire": "File d'attente mal organisée. Le système de tickets ne fonctionnait pas.",
                "days_ago": 3,
                "suggestion": "Remplacer la borne de tickets défectueuse."
            },
            {
                "qr_code": qr_codes[1],
                "note": 4,
                "commentaire": "Bonne prise en charge globale. Explications claires.",
                "days_ago": 4,
                "suggestion": None
            },
            {
                "qr_code": qr_codes[1],
                "note": 1,
                "commentaire": "Espace d'attente trop petit, pas assez de sièges. Attente debout très désagréable.",
                "days_ago": 6,
                "suggestion": "Ajouter des chaises ou un espace d'attente confortable."
            },
            {
                "qr_code": qr_codes[1],
                "note": 3,
                "commentaire": "Moyen. Temps d'attente correct mais le conseiller était pressé.",
                "days_ago": 9,
                "suggestion": None
            },
            {
                "qr_code": qr_codes[1],
                "note": 5,
                "commentaire": "Conseiller très à l'écoute, il a pris le temps de m'expliquer toutes les options.",
                "days_ago": 14,
                "suggestion": None
            },

            # Agence Sfax
            {
                "qr_code": qr_codes[2],
                "note": 4,
                "commentaire": "Agence propre, accueil correct.",
                "days_ago": 2,
                "suggestion": None
            },
            {
                "qr_code": qr_codes[2],
                "note": 1,
                "commentaire": "Réseau ADSL coupé depuis 3 jours et l'agence n'a pas pu me donner de délai de résolution !",
                "days_ago": 4,
                "suggestion": None,
                "contact": {"nom": "Salma Karray", "telephone": "+216 22 987 654", "email": "salma.karray@yahoo.fr"}
            },
            {
                "qr_code": qr_codes[2],
                "note": 2,
                "commentaire": "Attente de plus de 40 minutes à Sfax.",
                "days_ago": 8,
                "suggestion": "Mettre en place un système de rendez-vous en ligne."
            },
            {
                "qr_code": qr_codes[2],
                "note": 5,
                "commentaire": "Parfait comme d'habitude. Équipe au top.",
                "days_ago": 11,
                "suggestion": None
            },
            {
                "qr_code": qr_codes[2],
                "note": 3,
                "commentaire": "Service correct mais processus de renouvellement de contrat un peu lourd.",
                "days_ago": 15,
                "suggestion": "Numériser la signature des contrats en agence."
            }
        ]

        for sample in feedbacks_samples:
            sub_date = now - timedelta(days=sample["days_ago"])
            fb = Feedback(
                id=uuid.uuid4(),
                qr_code_id=sample["qr_code"].id,
                note=sample["note"],
                commentaire=sample["commentaire"],
                date_soumission=sub_date
            )
            db.add(fb)
            db.flush()

            # Suggestion rattachée
            if sample.get("suggestion"):
                sug = Suggestion(
                    id=uuid.uuid4(),
                    feedback_id=fb.id,
                    contenu=sample["suggestion"],
                    statut=IdeaStatus.NOUVEAU,
                    date_soumission=sub_date
                )
                db.add(sug)

            # Demande de contact
            if sample.get("contact"):
                ct = sample["contact"]
                dc = DemandeContact(
                    id=uuid.uuid4(),
                    feedback_id=fb.id,
                    nom=ct["nom"],
                    telephone=ct["telephone"],
                    email=ct["email"],
                    souhaite_etre_rappele=True,
                    traitee=False
                )
                db.add(dc)

            # Déclencher l'analyse IA déterministe
            analyser_feedback(fb.id, db)

        db.commit()
        logger.info("=== Seeding terminé avec succès ! ===")
        logger.info("Comptes de démonstration prêts :")
        logger.info("  - Admin : admin@ikanai.app / Password123!")
        logger.info("  - CX Manager : cx@orange.tn / Password123!")
        logger.info("  - Agency Manager (Tunis) : manager.tunis@orange.tn / Password123!")
        logger.info("  - Agency Manager (Sousse) : manager.sousse@orange.tn / Password123!")

    except Exception as e:
        logger.error(f"Erreur durant le seeding : {e}")
        db.rollback()
        raise e
    finally:
        db.close()


if __name__ == "__main__":
    seed_database()
