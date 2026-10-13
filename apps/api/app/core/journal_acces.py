"""
Journal des accès refusés (SD-10, AM-01) — UN SEUL point pour toute l'API.

Chaque réponse 401 ou 403 levée par une HTTPException produit un événement unique sur le logger
« ikan.security.access_denied » (niveau WARNING), au format JSON sur une ligne : date (UTC), utilisateur et rôle s'ils
sont authentifiés, méthode, route, adresse IP, code HTTP, motif.

Jamais journalisés : jeton, mot de passe, corps de requête, query string, URL avec identifiants réels (on enregistre le
MODÈLE de route), texte d'avis, téléphone, e-mail (le motif est tronqué et passé par `masquer_contacts`).
Les 404 ne sont pas journalisés (bruit sans valeur de sécurité).
"""
import json
import logging
from datetime import datetime, timezone

from fastapi import FastAPI, Request
from fastapi.exception_handlers import http_exception_handler
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.rate_limit import adresse_ip_client
from app.utils.masquage import masquer_contacts

journal = logging.getLogger("ikan.security.access_denied")

CODES_JOURNALISES = (401, 403)
LONGUEUR_MAX_MOTIF = 200


def _modele_de_route(request: Request) -> str:
    """Chemin SANS query string, dont chaque identifiant de route est remplacé par son nom (« /feedbacks/{feedback_id} »).
    Reconstruit depuis le chemin réel : `route.path` ne porte pas toujours le préfixe selon la version de FastAPI."""
    chemin = request.url.path
    for nom, valeur in (request.scope.get("path_params") or {}).items():
        chemin = chemin.replace(str(valeur), "{" + nom + "}")
    return chemin


def evenement_acces_refuse(request: Request, code: int, motif: object) -> dict:
    etat = request.state
    return {
        "evenement": "acces_refuse",
        "horodatage": datetime.now(timezone.utc).isoformat(),
        "utilisateur_id": getattr(etat, "acteur_id", None),
        "role": getattr(etat, "acteur_role", None),
        "methode": request.method,
        "route": _modele_de_route(request),
        "ip": adresse_ip_client(request),
        "code": code,
        "motif": masquer_contacts(str(motif))[:LONGUEUR_MAX_MOTIF],
    }


async def _gestionnaire_http(request: Request, exc: StarletteHTTPException):
    if exc.status_code in CODES_JOURNALISES:
        try:
            journal.warning("%s", json.dumps(evenement_acces_refuse(request, exc.status_code, exc.detail), ensure_ascii=False))
        except Exception:  # noqa: BLE001 — le journal ne doit jamais changer la réponse envoyée
            pass
    return await http_exception_handler(request, exc)


def installer_journal_acces(app: FastAPI) -> None:
    """Enregistre le gestionnaire ; la réponse renvoyée au client reste celle de FastAPI, inchangée."""
    app.add_exception_handler(StarletteHTTPException, _gestionnaire_http)
