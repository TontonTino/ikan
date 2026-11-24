"""
Mode démonstration publique (demo.ikanai.bf).

Une instance de démonstration est une COPIE de l'application, branchée sur sa propre base remplie de données fictives et remise à
zéro chaque nuit (scripts/demo/). Le visiteur y entre sans mot de passe, par un bouton par rôle, et peut tout essayer.

Règles :
 - désactivé par défaut ; DEMO_MODE=oui (valeur exacte) l'active ;
 - le démarrage REFUSE le mode démo contre la base de production protégée (voir `verifier_demarrage`) : un visiteur anonyme ne doit
   jamais pouvoir entrer dans les vraies données ;
 - les comptes d'entrée sont désignés par leur e-mail (DEMO_COMPTE_CX, DEMO_COMPTE_AGENCE), jamais par un mot de passe ;
 - quelques actions qui casseraient la démo pour les visiteurs suivants sont refusées (mot de passe, e-mail ou désactivation d'un
   compte d'entrée, paiement, connexion d'une vraie page Facebook). Tout le reste fonctionne comme en production.
"""
from fastapi import HTTPException, status

from app.core.config import settings
from app.core.garde_production import est_base_de_production
from app.models.enums import UserRole

VALEUR_ACTIVATION = "oui"
MESSAGE_ACTION_DESACTIVEE = "Cette action est désactivée dans la démonstration : elle gênerait les visiteurs suivants."


class DemoMalConfiguree(RuntimeError):
    """Le mode démo est demandé dans une configuration dangereuse ; le message est destiné à l'utilisateur."""


def demo_active() -> bool:
    return (settings.DEMO_MODE or "").strip() == VALEUR_ACTIVATION


def comptes_demo() -> dict:
    """Rôle → e-mail normalisé du compte d'entrée. Un rôle sans e-mail configuré n'a pas de bouton."""
    comptes = {
        UserRole.CX_MANAGER: (settings.DEMO_COMPTE_CX or "").strip().lower(),
        UserRole.AGENCY_MANAGER: (settings.DEMO_COMPTE_AGENCE or "").strip().lower(),
    }
    return {role: email for role, email in comptes.items() if email}


def est_compte_demo(utilisateur) -> bool:
    email = (getattr(utilisateur, "email", "") or "").strip().lower()
    return demo_active() and bool(email) and email in comptes_demo().values()


def refuser_en_demo() -> None:
    """403 si l'instance est une démonstration (paiement, connexion d'un vrai réseau social…)."""
    if demo_active():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=MESSAGE_ACTION_DESACTIVEE)


def refuser_si_compte_demo(utilisateur) -> None:
    """403 si l'on touche à un compte d'entrée de la démo (mot de passe, e-mail, désactivation)."""
    if est_compte_demo(utilisateur):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=MESSAGE_ACTION_DESACTIVEE)


def verifier_demarrage() -> None:
    """Appelé au démarrage de l'API. N'ouvre aucune connexion ; le message ne contient ni adresse ni secret."""
    if not demo_active():
        return
    if est_base_de_production(settings.DATABASE_URL):
        raise DemoMalConfiguree(
            "Démarrage refusé : DEMO_MODE=oui viserait la base de PRODUCTION. Une démonstration publique laisse entrer n'importe qui "
            "sans mot de passe : elle doit avoir sa propre base (voir docs/demo-publique.md)."
        )
    if not comptes_demo():
        raise DemoMalConfiguree(
            "Démarrage refusé : DEMO_MODE=oui sans aucun compte d'entrée. Renseignez DEMO_COMPTE_CX et/ou DEMO_COMPTE_AGENCE."
        )
