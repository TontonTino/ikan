"""
SD-02 — garde contre les écritures sur la base de PRODUCTION depuis un poste de développement.

Un seul module, sans aucun secret : il ne contient que des identifiants de projet Supabase (publics : ils figurent dans l'adresse
du tableau de bord Supabase et ne donnent aucun accès sans mot de passe). Les mots de passe, les adresses complètes et les clés ne
sont jamais lus ici, jamais écrits dans un message, jamais journalisés.

Règles :
 - `refuser_si_production(database_url, nom_operation)` lève `ProductionProtegee` si l'adresse contient un identifiant protégé ;
 - le démarrage de l'API et Alembic passent `app_env=settings.APP_ENV` : APP_ENV=production (Render) n'est JAMAIS bloqué ;
 - les scripts (seeds, démos) ne passent pas `app_env` : aucune exemption, même avec APP_ENV=production dans un .env local ;
 - contournement volontaire : variable d'environnement IKAN_AUTORISER_PRODUCTION=oui (valeur exacte « oui »), posée dans le
   terminal pour une seule commande. Elle n'a AUCUN effet dans un fichier .env (qui n'alimente pas os.environ) : ne jamais l'y mettre.

Ce fichier a un jumeau pour l'agent YAM (apps/agent/app/config/garde_production.py) : un test vérifie qu'ils restent identiques.
"""
import os
import sys

# Identifiants de projet Supabase des bases de production protégées (publics, sans valeur secrète).
IDENTIFIANTS_PROJETS_PRODUCTION = ("slynbxonwureptrmuskn",)

VARIABLE_AUTORISATION = "IKAN_AUTORISER_PRODUCTION"
VALEUR_AUTORISATION = "oui"


class ProductionProtegee(RuntimeError):
    """Refus d'agir sur la base de production ; le message est destiné à l'utilisateur (français, sans adresse ni secret)."""


def est_base_de_production(database_url) -> bool:
    """Vrai si l'adresse contient l'identifiant d'un projet de production protégé (utilisateur du pooler ou hôte direct)."""
    texte = str(database_url or "").lower()
    return any(identifiant in texte for identifiant in IDENTIFIANTS_PROJETS_PRODUCTION)


def autorisation_explicite() -> bool:
    """Vrai seulement si IKAN_AUTORISER_PRODUCTION vaut exactement « oui » (ni « 1 », ni « true », ni « OUI »)."""
    return os.environ.get(VARIABLE_AUTORISATION) == VALEUR_AUTORISATION


def _est_production_deployee(app_env) -> bool:
    return app_env is not None and str(app_env).strip().lower() == "production"


def refuser_si_production(database_url, nom_operation, *, app_env=None) -> None:
    """Lève ProductionProtegee si `database_url` vise la production protégée, sauf APP_ENV=production (si `app_env` est fourni)
    ou autorisation explicite. N'ouvre aucune connexion. Le message ne contient ni l'adresse ni le mot de passe."""
    if not est_base_de_production(database_url):
        return
    if _est_production_deployee(app_env) or autorisation_explicite():
        return
    raise ProductionProtegee(
        f"Opération refusée : « {nom_operation} » viserait la base de PRODUCTION (projet protégé). "
        "Aucune connexion n'a été ouverte et rien n'a été modifié. "
        "Repointez DATABASE_URL vers votre base de développement (README, section « Base de développement »). "
        f"Intervention volontaire en production : {VARIABLE_AUTORISATION}={VALEUR_AUTORISATION}, "
        "posée dans le terminal pour une seule commande, jamais dans un fichier .env."
    )


def avertir_si_production(database_url, nom_operation, sortie=None) -> bool:
    """Pour les commandes faites pour la production (creer_admin) : n'interdit rien mais affiche un avertissement très visible
    quand l'adresse est celle de la production protégée. Retourne True si c'est le cas."""
    if not est_base_de_production(database_url):
        return False
    print(
        f"ATTENTION : « {nom_operation} » va agir sur la base de PRODUCTION (données réelles). "
        "Vérifiez que c'est bien voulu avant de continuer.",
        file=sortie or sys.stderr,
    )
    return True
