"""
Plafond de taille du corps des requêtes sur les endpoints publics d'envoi (POST /feedbacks, POST /feedbacks/{id}/nps,
POST /qr-codes/{code}/suggestions).
Le corps est lu en entier (borné) AVANT d'atteindre FastAPI : Content-Length menteur ou transfert fragmenté compris.
"""
import json

from app.core.config import settings

MESSAGE_CORPS_TROP_GRAND = "Votre message est trop volumineux. Raccourcissez-le puis réessayez."


def _chemin_public_en_ecriture(methode: str, chemin: str) -> bool:
    if methode != "POST":
        return False
    base = f"{settings.API_V1_STR}/feedbacks"
    chemin = chemin.rstrip("/")
    qr = f"{settings.API_V1_STR}/qr-codes"
    if chemin.startswith(f"{qr}/") and chemin.endswith("/suggestions") and chemin.count("/") == qr.count("/") + 2:
        return True
    if chemin == base:
        return True
    return chemin.startswith(f"{base}/") and chemin.endswith("/nps") and chemin.count("/") == base.count("/") + 2


class LimiteCorpsPublic:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not _chemin_public_en_ecriture(scope["method"], scope["path"]):
            return await self.app(scope, receive, send)

        maximum = settings.PUBLIC_BODY_MAX_OCTETS
        declare = dict(scope["headers"]).get(b"content-length")
        if declare is not None and declare.isdigit() and int(declare) > maximum:
            return await self._refuser(send)

        morceaux, total = [], 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            corps = message.get("body", b"")
            total += len(corps)
            if total > maximum:
                return await self._refuser(send)
            morceaux.append(corps)
            if not message.get("more_body", False):
                break

        contenu = b"".join(morceaux)
        rejoue = False

        async def receive_rejoue():
            nonlocal rejoue
            if not rejoue:
                rejoue = True
                return {"type": "http.request", "body": contenu, "more_body": False}
            return await receive()

        await self.app(scope, receive_rejoue, send)

    @staticmethod
    async def _refuser(send):
        corps = json.dumps({"detail": MESSAGE_CORPS_TROP_GRAND}).encode()
        await send({"type": "http.response.start", "status": 413,
                    "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(corps)).encode())]})
        await send({"type": "http.response.body", "body": corps})
