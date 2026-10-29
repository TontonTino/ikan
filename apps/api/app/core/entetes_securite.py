"""
En-têtes de sécurité HTTP de l'API (SD-11), posés sur TOUTES les réponses, erreurs comprises (401, 403, 404, 422, 429, 500).

Le middleware enveloppe la pile complète (voir installer_entetes_securite) : les réponses 500 produites par le gestionnaire
d'exceptions global, qui sort des middlewares ordinaires, portent donc elles aussi les en-têtes.

* Strict-Transport-Security : 6 mois, ni includeSubDomains ni preload, SEULEMENT si APP_ENV=production (jamais en local ni en test).
* Cache-Control: no-store sur les réponses authentifiées (requête portant un en-tête Authorization ou le cookie access_token) et sur
  celles qui posent un cookie ; jamais sur une route publique, et jamais par-dessus un Cache-Control déjà posé par la route.
* Les autres en-têtes ne remplacent jamais une valeur déjà posée par la route.
"""
from http.cookies import SimpleCookie

from fastapi import FastAPI

from app.core.config import settings

HSTS_MAX_AGE_SECONDES = 15_552_000  # 180 jours

EN_TETES_FIXES: dict[bytes, bytes] = {
    b"x-content-type-options": b"nosniff",
    b"referrer-policy": b"strict-origin-when-cross-origin",
    b"x-frame-options": b"DENY",
    # L'API n'a besoin d'aucune fonction du navigateur.
    b"permissions-policy": b"camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
}


def _entete_requete(scope, nom: bytes) -> bool:
    return any(cle == nom and valeur for cle, valeur in scope["headers"])


def _requete_authentifiee(scope) -> bool:
    if _entete_requete(scope, b"authorization"):
        return True
    for cle, valeur in scope["headers"]:
        if cle == b"cookie":
            try:
                jar = SimpleCookie()
                jar.load(valeur.decode("latin-1"))
                return "access_token" in jar
            except Exception:  # noqa: BLE001 — cookie illisible : traité comme absent
                return b"access_token=" in valeur
    return False


class EntetesSecurite:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        authentifiee = _requete_authentifiee(scope)

        async def envoyer(message):
            if message["type"] == "http.response.start":
                entetes = list(message.get("headers", []))
                presents = {cle.lower() for cle, _ in entetes}
                for cle, valeur in EN_TETES_FIXES.items():
                    if cle not in presents:
                        entetes.append((cle, valeur))
                if settings.APP_ENV == "production" and b"strict-transport-security" not in presents:
                    entetes.append((b"strict-transport-security", f"max-age={HSTS_MAX_AGE_SECONDES}".encode()))
                if b"cache-control" not in presents and (authentifiee or b"set-cookie" in presents):
                    entetes.append((b"cache-control", b"no-store"))
                message = {**message, "headers": entetes}
            await send(message)

        await self.app(scope, receive, envoyer)


def installer_entetes_securite(app: FastAPI) -> None:
    """Enveloppe la pile COMPLÈTE de l'application (y compris le gestionnaire des erreurs 500)."""
    construire = app.build_middleware_stack
    app.build_middleware_stack = lambda: EntetesSecurite(construire())
