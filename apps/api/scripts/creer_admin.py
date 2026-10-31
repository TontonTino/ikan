"""
Crée le compte Administrateur de la plateforme (premier administrateur d'une base neuve, ou administrateur supplémentaire).

Usage, depuis apps/api (une seule fois, en interactif) :
    python scripts/creer_admin.py --email prenom.nom@exemple.org
    python scripts/creer_admin.py --email autre.admin@exemple.org --ajouter     # un administrateur existe déjà

Le mot de passe est demandé deux fois, sans affichage. Il n'est JAMAIS accepté en argument ni en variable d'environnement
(historique du shell, configuration visible). Hors terminal interactif, la commande refuse.

La commande ne dépend PAS de APP_ENV (elle est faite pour la production) mais elle ne s'exécute jamais à l'import ni au démarrage
de l'API. Elle écrit dans UNE transaction : l'utilisateur administrateur, et — seulement s'il n'existe aucun administrateur et
aucune organisation « Plateforme IKAN AI » — cette organisation technique, car un compte doit être rattaché à une organisation
(`utilisateurs.organisation_id` est obligatoire). Elle ne supprime ni ne modifie jamais aucune autre ligne.

Elle n'affiche jamais le mot de passe ni son hachage (ni message d'erreur, ni trace d'exception) : code 0 = créé, 1 = refus.
"""
import argparse
import getpass
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pydantic import EmailStr, TypeAdapter  # noqa: E402

from app.api.v1.endpoints.utilisateurs import _email_deja_pris  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.core.garde_production import avertir_si_production  # noqa: E402
from app.core.security import get_password_hash  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
from app.models.enums import UserRole  # noqa: E402
from app.models.organisation import Organisation  # noqa: E402
from app.models.utilisateur import Utilisateur  # noqa: E402
from app.schemas.mot_de_passe import verifier_mot_de_passe  # noqa: E402
from app.services.comptes import normaliser_email  # noqa: E402

NOM_ORGANISATION_PLATEFORME = "Plateforme IKAN AI"


class Refus(Exception):
    """Refus de créer le compte ; le message est destiné à l'utilisateur (en français, sans mot de passe ni hachage)."""


def creer_admin(db, email_saisi: str, mot_de_passe: str, confirmation: str, *, ajouter: bool = False,
                nom: str = "Admin", prenom: str = "Système") -> str:
    """Crée l'administrateur et retourne son e-mail normalisé. Lève Refus sans rien écrire si une règle n'est pas respectée."""
    email = normaliser_email(email_saisi)
    try:
        TypeAdapter(EmailStr).validate_python(email)
    except Exception:  # noqa: BLE001 — le message de validation reprendrait la valeur saisie
        raise Refus("Adresse e-mail invalide.") from None
    if mot_de_passe != confirmation:
        raise Refus("Les deux saisies du mot de passe sont différentes. Aucun compte n'a été créé.")
    try:
        mot_de_passe_propre = verifier_mot_de_passe(mot_de_passe, email)
    except ValueError as erreur:
        raise Refus(f"{erreur} Aucun compte n'a été créé.") from None
    if _email_deja_pris(db, email):
        raise Refus("Un compte utilise déjà cette adresse e-mail. Aucun compte n'a été créé ni modifié.")
    administrateur_existant = db.query(Utilisateur).filter(Utilisateur.role == UserRole.ADMIN).first()
    if administrateur_existant is not None and not ajouter:
        raise Refus("Un administrateur existe déjà. Pour en ajouter un autre, relancez avec --ajouter. Aucun compte n'a été créé.")

    if administrateur_existant is not None:
        organisation_id = administrateur_existant.organisation_id
    else:
        organisation = db.query(Organisation).filter(Organisation.nom == NOM_ORGANISATION_PLATEFORME).first()
        if organisation is None:
            organisation = Organisation(id=uuid.uuid4(), nom=NOM_ORGANISATION_PLATEFORME, pays_region=None, active=True)
            db.add(organisation)
            db.flush()
        organisation_id = organisation.id

    db.add(Utilisateur(
        id=uuid.uuid4(), organisation_id=organisation_id, nom=nom, prenom=prenom, email=email,
        mot_de_passe_hash=get_password_hash(mot_de_passe_propre), role=UserRole.ADMIN, active=True,
    ))
    try:
        db.commit()
    except Exception:  # noqa: BLE001 — une erreur SQL reprendrait les paramètres de la requête (dont le hachage)
        db.rollback()
        raise Refus("Création impossible (erreur technique à l'enregistrement). Aucun compte n'a été créé.") from None
    return email


def main(argv=None, *, saisir=getpass.getpass, interactif=None) -> int:
    parseur = argparse.ArgumentParser(description="Crée un compte Administrateur (mot de passe demandé de façon interactive).")
    parseur.add_argument("--email", required=True, help="Adresse e-mail de connexion du nouvel administrateur.")
    parseur.add_argument("--ajouter", action="store_true", help="Autorise la création alors qu'un administrateur existe déjà.")
    arguments = parseur.parse_args(argv)

    # Cette commande est faite pour la production : elle n'est PAS bloquée par la garde SD-02, mais l'avertissement est explicite.
    avertir_si_production(settings.DATABASE_URL, "création d'un compte administrateur")

    if interactif is None:
        interactif = sys.stdin.isatty()
    if not interactif:
        print("Refusé : cette commande demande le mot de passe de façon interactive (terminal). "
              "Il ne peut pas être fourni en argument, en variable d'environnement ni par un flux. Aucun compte n'a été créé.", file=sys.stderr)
        return 1

    db = None
    try:
        mot_de_passe = saisir("Mot de passe du nouvel administrateur : ")
        confirmation = saisir("Confirmez le mot de passe : ")
        db = SessionLocal()
        email = creer_admin(db, arguments.email, mot_de_passe, confirmation, ajouter=arguments.ajouter)
    except Refus as refus:
        print(str(refus), file=sys.stderr)
        return 1
    except Exception as erreur:  # noqa: BLE001 — jamais de trace ni de message d'exception (ils pourraient contenir des données saisies)
        print(f"Échec de la création (erreur technique : {type(erreur).__name__}). Aucun compte n'a été créé.", file=sys.stderr)
        return 1
    finally:
        if db is not None:
            db.close()
    print(f"Compte administrateur créé : {email}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
