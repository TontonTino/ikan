"""
Protection CSRF (SD-08) par vérification de l'origine.

Le cookie d'authentification circule entre domaines (SameSite=None en production) : un site tiers pourrait faire émettre par le
navigateur d'un utilisateur connecté une requête qui modifie des données. Les navigateurs envoient TOUJOURS l'en-tête Origin sur
POST/PATCH/PUT/DELETE ; on le compare donc à ALLOWED_ORIGINS (à défaut, l'origine du Referer).

Ne s'applique QU'AUX requêtes de changement d'état authentifiées par COOKIE (cookie access_token présent, aucun en-tête
Authorization : un site tiers ne peut pas poser cet en-tête sans autorisation CORS). Jamais bloqués : GET/HEAD/OPTIONS, les requêtes à
en-tête Bearer, les requêtes sans cookie d'authentification (formulaire public, appels serveur à serveur), le webhook Stripe signé.
Refus : 403, message fixe, aucune donnée de la requête renvoyée ni lue (le corps n'est pas consommé).
"""
import json
import logging
import re
from datetime import datetime, timezone
from http.cookies import SimpleCookie
from urllib.parse import urlsplit

from app.core.config import settings

MESSAGE_ORIGINE_REFUSEE = "Requête refusée : son origine n'est pas autorisée."
METHODES_SURES = frozenset({"GET", "HEAD", "OPTIONS"})
NOM_COOKIE = "access_token"

# Routes publiques écrites sans compte (déjà protégées par limitation de débit / signature), listées explicitement et testées.
CHEMINS_PUBLICS = (
    re.compile(r"^/webhooks/stripe/?$"),                      # authentifié par la signature Stripe
    re.compile(r"^/api/v1/feedbacks/?$"),                      # POST du formulaire client
    re.compile(r"^/api/v1/feedbacks/[^/]+/nps/?$"),            # NPS facultatif (jeton NPS)
    re.compile(r"^/api/v1/qr-codes/[^/]+/suggestions/?$"),     # « Partager une idée »
)
_UUID = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F-]{27}")
journal = logging.getLogger("ikan.security.access_denied")


def _entete(scope, nom: bytes) -> str:
    for cle, valeur in scope["headers"]:
        if cle == nom:
            return valeur.decode("latin-1")
    return ""


def _origine_du_referer(referer: str) -> str:
    morceaux = urlsplit(referer)
    return f"{morceaux.scheme}://{morceaux.netloc}" if morceaux.scheme and morceaux.netloc else ""


def _authentifie_par_cookie(scope) -> bool:
    if _entete(scope, b"authorization"):
        return False
    brut = _entete(scope, b"cookie")
    if not brut:
        return False
    try:
        jar = SimpleCookie()
        jar.load(brut)
    except Exception:  # noqa: BLE001 — cookie illisible : par prudence on contrôle si le nom apparaît
        return NOM_COOKIE + "=" in brut
    return NOM_COOKIE in jar


def origine_autorisee(scope) -> bool:
    origine = _entete(scope, b"origin").strip()
    if not origine:
        origine = _origine_du_referer(_entete(scope, b"referer").strip())
    if not origine or origine == "null":
        return False
    return origine.rstrip("/") in settings.allowed_origins_list


class ProtectionCSRF:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if (scope["type"] != "http" or scope["method"] in METHODES_SURES
                or any(m.match(scope["path"]) for m in CHEMINS_PUBLICS)
                or not _authentifie_par_cookie(scope) or origine_autorisee(scope)):
            return await self.app(scope, receive, send)
        self._journaliser(scope)
        corps = json.dumps({"detail": MESSAGE_ORIGINE_REFUSEE}, ensure_ascii=False).encode()
        await send({"type": "http.response.start", "status": 403,
                    "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(corps)).encode())]})
        await send({"type": "http.response.body", "body": corps})

    @staticmethod
    def _journaliser(scope) -> None:
        try:
            journal.warning("%s", json.dumps({
                "evenement": "csrf_refuse",
                "horodatage": datetime.now(timezone.utc).isoformat(),
                "methode": scope["method"],
                "route": _UUID.sub("{id}", scope["path"]),
                "code": 403,
                "motif": "origine absente ou non autorisée",
            }, ensure_ascii=False))
        except Exception:  # noqa: BLE001
            pass
