"""Règles partagées des comptes utilisateurs (création par l'API et par la commande scripts/creer_admin.py)."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.organisation import Organisation
from app.models.utilisateur import Utilisateur


def requete_comptes_utilisables(db: Session):
    """Comptes qui peuvent se connecter et utiliser l'API : compte actif ET organisation active. Aucune requête supplémentaire
    (sous-requête dans la requête utilisateur). Une organisation inactive désactive d'un coup tous ses comptes, sans toucher à leurs données ;
    la réactiver les rétablit. Une ligne d'organisation absente (impossible en base réelle, clé étrangère) ne bloque pas."""
    return db.query(Utilisateur).filter(
        Utilisateur.active == True,  # noqa: E712
        Utilisateur.organisation_id.not_in(select(Organisation.id).where(Organisation.active.is_(False))),
    )


def normaliser_email(email: str) -> str:
    """Forme canonique d'une adresse e-mail : sans espaces de début ni de fin, en minuscules (la connexion se fait sans casse)."""
    return email.strip().lower()
