"""Règles partagées des comptes utilisateurs (création par l'API et par la commande scripts/creer_admin.py)."""


def normaliser_email(email: str) -> str:
    """Forme canonique d'une adresse e-mail : sans espaces de début ni de fin, en minuscules (la connexion se fait sans casse)."""
    return email.strip().lower()
