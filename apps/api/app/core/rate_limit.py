"""
Limitation de débit des endpoints PUBLICS (formulaire client) et adresse IP réelle du demandeur.

Compteurs EN MÉMOIRE, fenêtre glissante : suffisant pour UNE instance de l'API. Avec plusieurs instances, chacune
compte pour elle seule (la limite réelle devient N x seuil) ; il faudra alors un compteur partagé (Redis, ou une table
Postgres) ou une limite posée en amont (proxy / WAF). Voir la note de la PR.
"""
import hmac
import ipaddress
import logging
import threading
import time
from collections import deque
from typing import Callable, Optional

from fastapi import HTTPException, Query, Request, status

from app.core.config import settings

logger = logging.getLogger(__name__)

MESSAGE_TROP_DE_DEMANDES = "Trop de demandes en peu de temps. Veuillez patienter une minute puis réessayer."

# Plafond du nombre de clés suivies (un attaquant qui varie les codes QR ne doit pas gonfler la mémoire sans limite).
MAX_CLES_SUIVIES = 20_000


class LimiteurFenetre:
    """Fenêtre glissante : au plus `limite` événements par clé sur `fenetre_s` secondes."""

    def __init__(self, fenetre_s: float = 60.0, horloge: Callable[[], float] = time.monotonic):
        self._fenetre = fenetre_s
        self._horloge = horloge
        self._evenements: dict[str, deque] = {}
        self._verrou = threading.Lock()

    def reinitialiser(self) -> None:
        with self._verrou:
            self._evenements.clear()

    def tenter(self, cle: str, limite: int) -> tuple[bool, int]:
        """Enregistre une tentative. Retourne (autorisee, secondes_avant_nouvel_essai). limite <= 0 : jamais bloqué."""
        if limite <= 0:
            return True, 0
        maintenant = self._horloge()
        seuil = maintenant - self._fenetre
        with self._verrou:
            file = self._evenements.get(cle)
            if file is None:
                if len(self._evenements) >= MAX_CLES_SUIVIES:
                    self._purger(seuil)
                file = self._evenements[cle] = deque()
            while file and file[0] <= seuil:
                file.popleft()
            if len(file) >= limite:
                attente = int(file[0] + self._fenetre - maintenant) + 1
                return False, max(attente, 1)
            file.append(maintenant)
            return True, 0

    def _purger(self, seuil: float) -> None:
        for cle in [c for c, f in self._evenements.items() if not f or f[-1] <= seuil]:
            del self._evenements[cle]
        # Toujours plein de clés actives : on sacrifie les plus anciennement créées plutôt que de croître sans fin.
        while len(self._evenements) >= MAX_CLES_SUIVIES:
            del self._evenements[next(iter(self._evenements))]


limiteur = LimiteurFenetre()
_avertissement_ip_prive_emis = False


def adresse_ip_client(request: Request) -> str:
    """Adresse IP du demandeur. X-Forwarded-For n'est JAMAIS lu tel quel : seule l'entrée posée par NOTRE proxy
    (la N-ième depuis la droite, N = TRUSTED_PROXY_HOPS) est retenue ; avec N = 0, seule l'adresse du socket compte."""
    global _avertissement_ip_prive_emis

    secret = settings.SSR_FORWARD_SECRET
    if secret:
        fourni = request.headers.get("x-ikan-ssr-secret", "")
        transmise = request.headers.get("x-ikan-client-ip", "").strip()
        if transmise and hmac.compare_digest(fourni.encode(), secret.encode()):
            return transmise[:64]

    ip: Optional[str] = request.client.host if request.client else None
    sauts = settings.TRUSTED_PROXY_HOPS
    if sauts > 0:
        morceaux = [m.strip() for m in request.headers.get("x-forwarded-for", "").split(",") if m.strip()]
        if len(morceaux) >= sauts:
            ip = morceaux[-sauts]
    if ip is None:
        return "inconnue"
    if not _avertissement_ip_prive_emis:
        try:
            adresse = ipaddress.ip_address(ip)
        except ValueError:
            adresse = None
        if adresse is not None and (adresse.is_private or adresse.is_loopback) and settings.APP_ENV != "development":
            _avertissement_ip_prive_emis = True
            logger.warning(
                "Limitation de débit : adresse client privée vue en %s. Si l'API est derrière un proxy, vérifier "
                "TRUSTED_PROXY_HOPS : sinon tous les visiteurs partagent le même compteur.", settings.APP_ENV,
            )
    return ip


def _refuser(attente: int) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail=MESSAGE_TROP_DE_DEMANDES,
        headers={"Retry-After": str(attente)},
    )


def limiter_ip_public(request: Request) -> None:
    """Dépendance : /nps, /validate, /categories — une limite par adresse IP."""
    ok, attente = limiteur.tenter(f"public:{adresse_ip_client(request)}", settings.RATE_LIMIT_PUBLIC_PAR_IP)
    if not ok:
        raise _refuser(attente)


def limiter_soumission(request: Request, qr_code: str = Query(..., max_length=200)) -> None:
    """Dépendance de POST /feedbacks : limite par IP, puis par code QR. Exécutée AVANT toute lecture en base : un envoi
    refusé ne crée ni feedback, ni analyse IA, ni consommation de quota. Tout envoi compte, valide ou non."""
    ok, attente = limiteur.tenter(f"fb-ip:{adresse_ip_client(request)}", settings.RATE_LIMIT_FEEDBACK_PAR_IP)
    if not ok:
        raise _refuser(attente)
    ok, attente = limiteur.tenter(f"fb-qr:{qr_code.strip().lower()}", settings.RATE_LIMIT_FEEDBACK_PAR_QR)
    if not ok:
        raise _refuser(attente)
