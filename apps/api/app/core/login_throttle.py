"""
Limitation des tentatives de connexion (SD-08).

Deux compteurs d'ÉCHECS sur une fenêtre glissante (LOGIN_FENETRE_SECONDES) : un par couple (IP réelle, e-mail normalisé), un par IP seule.
Au dépassement, /auth/login répond 429 AVANT toute vérification du mot de passe, avec le même message que le compte existe ou non (un
compte inconnu compte comme un compte connu : aucune fuite d'existence). Un succès remet à zéro le couple, jamais le compteur par IP.
Aucun verrouillage du compte : seul le couple (IP, e-mail) est ralenti, un tiers ne peut donc pas bloquer un vrai utilisateur
depuis une autre adresse. Compteurs en mémoire d'un seul processus : voir app/core/rate_limit.py.
"""
import json
import logging
from datetime import datetime, timezone

from fastapi import HTTPException, Request, status

from app.core.config import settings
from app.core.rate_limit import adresse_ip_client, limiteur
from app.services.comptes import normaliser_email
from app.utils.masquage import masquer_contacts

MESSAGE_TROP_DE_TENTATIVES = "Trop de tentatives de connexion. Veuillez patienter quelques minutes puis réessayer."

journal = logging.getLogger("ikan.security.access_denied")


def _cles(request: Request, email: str) -> tuple[str, str]:
    ip = adresse_ip_client(request)
    return f"login-couple:{ip}|{normaliser_email(email)}", f"login-ip:{ip}"


def verifier_avant_connexion(request: Request, email: str) -> None:
    """Lève 429 (Retry-After) si le couple ou l'IP a trop échoué récemment. N'enregistre rien."""
    cle_couple, cle_ip = _cles(request, email)
    fenetre = settings.LOGIN_FENETRE_SECONDES
    for cle, limite, portee in ((cle_couple, settings.LOGIN_MAX_ECHECS_PAR_COUPLE, "couple"),
                                (cle_ip, settings.LOGIN_MAX_ECHECS_PAR_IP, "ip")):
        if limite <= 0:
            continue
        nombre, attente = limiteur.echecs(cle, fenetre)
        if nombre >= limite:
            _journaliser(request, email, portee)
            raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=MESSAGE_TROP_DE_TENTATIVES,
                                headers={"Retry-After": str(attente)})


def noter_echec(request: Request, email: str) -> None:
    cle_couple, cle_ip = _cles(request, email)
    limiteur.noter(cle_couple, settings.LOGIN_FENETRE_SECONDES)
    limiteur.noter(cle_ip, settings.LOGIN_FENETRE_SECONDES)


def noter_succes(request: Request, email: str) -> None:
    """Remet à zéro le couple (IP, e-mail) ; le compteur par IP n'est pas remis à zéro (un succès n'efface pas les essais sur d'autres comptes)."""
    limiteur.oublier(_cles(request, email)[0])


def _journaliser(request: Request, email: str, portee: str) -> None:
    try:
        journal.warning("%s", json.dumps({
            "evenement": "connexion_limitee",
            "horodatage": datetime.now(timezone.utc).isoformat(),
            "methode": request.method,
            "route": request.url.path,
            "ip": adresse_ip_client(request),
            "code": 429,
            "portee": portee,
            "email": masquer_contacts(normaliser_email(email)),
        }, ensure_ascii=False))
    except Exception:  # noqa: BLE001 — le journal ne doit jamais changer la réponse envoyée
        pass
