"""
Service d'intégration du microservice IKAN AI Veille (port 8002).
Permet à l'API principale de piloter le scraping Facebook / Réseaux sociaux
et d'ingérer les mentions extraites dans la table mentions_veille (jamais dans
feedbacks : ces avis n'ont pas de note client réelle, voir ingest_mentions).
"""
import hashlib
import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import quote, urlsplit
from uuid import UUID

import httpx
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.enums import SentimentType
from app.models.mention_veille import MentionVeille
from app.services.ai.classification_service import classify

logger = logging.getLogger(__name__)

# Identité renvoyée par le VRAI microservice de veille (apps/veille/scraping_service/api.py,
# HealthResponse.service) : un autre service qui répondrait 200 sur le même port/host par
# coïncidence (ex. une instance égarée d'apps/api, dont /health renvoie juste {"status":"ok"})
# ne doit jamais être rapporté comme "online".
VEILLE_SERVICE_IDENTITY = "IKAN AI - Service de Veille"


def _get_headers() -> Dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if settings.VEILLE_API_KEY:
        headers["X-API-Key"] = settings.VEILLE_API_KEY
    return headers


async def check_veille_service() -> Dict[str, Any]:
    """Vérifie si le microservice de veille est actif et joignable — et que c'est bien LUI."""
    if not settings.VEILLE_SERVICE_URL:
        return {"status": "disabled", "message": "VEILLE_SERVICE_URL non configuré"}

    url = f"{settings.VEILLE_SERVICE_URL.rstrip('/')}/health"
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            res = await client.get(url)
            if res.status_code != 200:
                return {"status": "error", "code": res.status_code, "detail": res.text}
            data = res.json()
            if data.get("service") != VEILLE_SERVICE_IDENTITY:
                return {
                    "status": "error",
                    "detail": "Réponse HTTP 200 reçue, mais ce n'est pas le microservice de veille "
                              "(identité absente ou différente — un autre service répond peut-être sur ce port)",
                    "details": data,
                }
            return {"status": "online", "details": data}
    except Exception as e:
        logger.warning(f"Microservice de veille injoignable sur {url}: {e}")
        return {"status": "offline", "error": str(e)}


class VeilleServiceError(Exception):
    """Échec d'un appel au microservice de veille ; `message` est affichable tel quel."""

    def __init__(self, message: str, status_code: Optional[int] = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


# Champs d'une Page connectée exposés au dashboard — liste blanche : rien d'autre ne sort
# de /pages (ni jeton, ni client_id, ni scopes, ni erreur brute de Meta).
_CHAMPS_PAGE_EXPOSES = ("id", "page_id", "page_name", "status", "expires_at", "data_access_expires_at", "needs_attention", "last_sync_at")


def _page_publique(page: Dict[str, Any]) -> Dict[str, Any]:
    return {champ: page.get(champ) for champ in _CHAMPS_PAGE_EXPOSES}


def _base_url() -> str:
    return settings.VEILLE_SERVICE_URL.rstrip("/")


async def list_connected_pages(client_id: str) -> List[Dict[str, Any]]:
    """Pages Facebook connectées pour l'organisation `client_id`, filtrées par liste blanche."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            res = await client.get(f"{_base_url()}/pages", params={"client_id": client_id}, headers=_get_headers())
    except httpx.HTTPError as e:
        logger.warning(f"Lecture des Pages connectées impossible : {e}")
        raise VeilleServiceError("Le service de veille est injoignable.") from e
    if res.status_code != 200:
        logger.warning(f"Lecture des Pages connectées refusée ({res.status_code})")
        raise VeilleServiceError("Lecture des Pages connectées impossible.", res.status_code)
    pages = res.json().get("pages", [])
    return [_page_publique(page) for page in pages if isinstance(page, dict) and page.get("client_id") == client_id]


async def get_session_status(client_id: str) -> Dict[str, Any]:
    """Récupère les Pages Facebook connectées pour l'organisation."""
    try:
        pages = await list_connected_pages(client_id)
    except VeilleServiceError as e:
        return {"valid": False, "error": e.message}
    return {"valid": any(page.get("status") == "active" for page in pages), "pages": pages}


def _est_url_facebook_https(url: Any, *, hotes: tuple[str, ...]) -> bool:
    if not isinstance(url, str):
        return False
    try:
        parsed = urlsplit(url.strip())
    except ValueError:
        return False
    hote = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port not in (None, 443):
        return False
    return any(hote == h or hote.endswith(f".{h}") for h in hotes)


async def start_facebook_connection(client_id: str, return_to: str) -> str:
    """Démarre l'OAuth Facebook pour `client_id` ; renvoie l'URL d'autorisation, uniquement si
    elle pointe vers facebook.com (jamais une redirection arbitraire vers le navigateur)."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.post(
                f"{_base_url()}/connect/facebook/start",
                json={"client_id": client_id, "return_to": return_to},
                headers=_get_headers(),
            )
    except httpx.HTTPError as e:
        logger.warning(f"Démarrage de la connexion Facebook impossible : {e}")
        raise VeilleServiceError("Le service de veille est injoignable.") from e
    if res.status_code != 200:
        logger.warning(f"Démarrage de la connexion Facebook refusé ({res.status_code})")
        raise VeilleServiceError("La connexion Facebook est momentanément indisponible.", res.status_code)
    authorize_url = res.json().get("authorize_url")
    if not _est_url_facebook_https(authorize_url, hotes=("facebook.com",)):
        logger.error("URL d'autorisation hors facebook.com renvoyée par le service de veille : refusée")
        raise VeilleServiceError("Réponse inattendue du service de veille.")
    return authorize_url


async def sync_connected_page(page_uuid: str, client_id: str) -> Dict[str, Any]:
    """Collecte une Page connectée avec SON jeton (stocké côté microservice) ; le microservice
    vérifie lui aussi que la Page appartient à `client_id`."""
    try:
        async with httpx.AsyncClient(timeout=180.0) as client:
            res = await client.post(
                f"{_base_url()}/pages/{quote(page_uuid, safe='')}/sync",
                params={"client_id": client_id},
                headers=_get_headers(),
            )
    except httpx.HTTPError as e:
        logger.warning(f"Collecte Facebook impossible : {e}")
        raise VeilleServiceError("Le service de veille est injoignable.") from e
    if res.status_code != 200:
        logger.warning(f"Collecte Facebook refusée ({res.status_code})")
        raise VeilleServiceError("La collecte Facebook a échoué.", res.status_code)
    return res.json()


# Plafond de lecture du stock du microservice par collecte (pages de 200 items).
_MAX_PAGES_FEEDBACK = 50


async def fetch_collected_items(client_id: str) -> List[Dict[str, Any]]:
    """Lit les commentaires déjà collectés pour `client_id` (la déduplication à l'ingestion
    évite tout doublon lors des relectures)."""
    items: List[Dict[str, Any]] = []
    cursor: Optional[int] = 0
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            for _ in range(_MAX_PAGES_FEEDBACK):
                res = await client.get(
                    f"{_base_url()}/feedback",
                    params={"client_id": client_id, "limit": 200, "cursor": cursor},
                    headers=_get_headers(),
                )
                if res.status_code != 200:
                    logger.warning(f"Lecture des commentaires collectés refusée ({res.status_code})")
                    raise VeilleServiceError("Lecture des commentaires collectés impossible.", res.status_code)
                data = res.json()
                items.extend(item for item in data.get("items", []) if isinstance(item, dict))
                cursor = data.get("next_cursor")
                if cursor is None:
                    break
    except httpx.HTTPError as e:
        logger.warning(f"Lecture des commentaires collectés impossible : {e}")
        raise VeilleServiceError("Le service de veille est injoignable.") from e
    return items


def url_source_sure(url: Any, source_id: Optional[str] = None) -> Optional[str]:
    """Lien « Voir la source » : uniquement une URL https sur facebook.com ou fb.com, sinon None.
    Le collecteur remplace un permalink_url absent par https://www.facebook.com/<source_id> :
    ce lien reconstruit n'est pas le permalink réel du commentaire, il est donc écarté."""
    if not _est_url_facebook_https(url, hotes=("facebook.com", "fb.com")):
        return None
    url = url.strip()
    if source_id and url.rstrip("/") == f"https://www.facebook.com/{source_id}":
        return None
    return url


_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
# Préfixe pays optionnel (+226, +33, ...) puis une séquence de 8 chiffres ou plus,
# les chiffres pouvant être séparés par des espaces, points ou tirets.
_TELEPHONE_CANDIDAT_RE = re.compile(r"(?:\+\d{1,4}[\s.\-]?)?(?:\d[\s.\-]?){7,}\d")


def _masquer_donnees_personnelles(texte: str) -> str:
    """Masque e-mails et numéros de téléphone AVANT calcul de l'empreinte et stockage —
    ces mentions publiques ne doivent jamais faire fuiter de coordonnées personnelles."""
    texte = _EMAIL_RE.sub("[email]", texte)

    def _remplacer_si_telephone(match: "re.Match[str]") -> str:
        chiffres = re.sub(r"\D", "", match.group(0))
        return "[téléphone]" if len(chiffres) >= 8 else match.group(0)

    return _TELEPHONE_CANDIDAT_RE.sub(_remplacer_si_telephone, texte)


def _normaliser_texte(texte: str) -> str:
    """Minuscules, espaces multiples réduits — pour une empreinte stable face aux
    variations mineures de formatage d'une ré-extraction du même contenu."""
    return " ".join(texte.strip().lower().split())


def _parser_date_publication(valeur: Any) -> Optional[datetime]:
    if not valeur:
        return None
    if isinstance(valeur, datetime):
        return valeur
    try:
        return datetime.fromisoformat(str(valeur).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def _calculer_empreinte(plateforme: str, texte_normalise: str, date_publication: Optional[datetime], url_source: Optional[str]) -> str:
    brut = f"{plateforme}|{texte_normalise}|{date_publication.isoformat() if date_publication else ''}|{url_source or ''}"
    return hashlib.sha256(brut.encode("utf-8")).hexdigest()


def ingest_mentions(
    items: List[Dict[str, Any]],
    organisation_id: UUID,
    agence_id: Optional[UUID],
    db: Session,
) -> Dict[str, Any]:
    """
    Ingère des mentions réseaux sociaux dans `mentions_veille` — jamais dans `feedbacks`
    (pas de note client réelle sur ces avis, voir docstring du modèle). Pour chaque item :
    ignore les textes vides, masque e-mails/téléphones AVANT calcul de l'empreinte et
    stockage, déduplique par empreinte au sein de l'organisation, calcule le sentiment
    immédiatement (analyser_sentiment, pas de tâche de fond).

    NE STOCKE JAMAIS l'identité de l'auteur (nom, identifiant, profil), même si le
    microservice la renvoie dans `item` : ces champs sont simplement ignorés ci-dessous.
    """
    ingested_count = 0
    duplicate_count = 0
    ignored_empty_count = 0

    for item in items:
        raw_text = item.get("text") or item.get("raw_text") or ""
        texte = raw_text.strip()[:2000]
        if not texte:
            ignored_empty_count += 1
            continue
        texte = _masquer_donnees_personnelles(texte)

        plateforme = (item.get("plateforme") or item.get("platform") or "facebook").strip().lower() or "facebook"
        type_contenu = item.get("type_contenu") or item.get("type") or "avis"
        date_publication = _parser_date_publication(
            item.get("date_publication") or item.get("published_at") or item.get("date")
        )
        external_id_value = item.get("external_id") or item.get("source_id")
        external_id = external_id_value.strip() if isinstance(external_id_value, str) else None
        if not external_id or len(external_id) > 255:
            external_id = None
        # `permalink` = lien du commentaire renvoyé par le collecteur (FeedbackItem).
        url_source = url_source_sure(item.get("permalink") or item.get("url_source") or item.get("url"), external_id)

        if external_id is not None:
            deja_present = (
                db.query(MentionVeille)
                .filter(
                    MentionVeille.organisation_id == organisation_id,
                    MentionVeille.plateforme == plateforme,
                    MentionVeille.external_id == external_id,
                )
                .first()
            )
            if deja_present:
                duplicate_count += 1
                continue

        empreinte = _calculer_empreinte(plateforme, _normaliser_texte(texte), date_publication, url_source)

        deja_present = (
            db.query(MentionVeille)
            .filter(MentionVeille.organisation_id == organisation_id, MentionVeille.empreinte == empreinte)
            .first()
        )
        if deja_present:
            duplicate_count += 1
            continue

        classification = classify(texte, note=None)
        sentiment = {
            "positive": SentimentType.POSITIF,
            "positif": SentimentType.POSITIF,
            "negative": SentimentType.NEGATIF,
            "negatif": SentimentType.NEGATIF,
            "neutral": SentimentType.NEUTRE,
            "neutre": SentimentType.NEUTRE,
        }.get(str(classification.get("sentiment", "")).lower(), SentimentType.NEUTRE)

        mention = MentionVeille(
            organisation_id=organisation_id,
            agence_id=agence_id,
            plateforme=plateforme,
            type_contenu=type_contenu,
            texte=texte,
            url_source=url_source,
            date_publication=date_publication,
            external_id=external_id,
            sentiment=sentiment,
            score_sentiment=float(classification.get("score_sentiment", 0.5)),
            theme_principal=classification.get("theme") if classification.get("theme_matched", False) else None,
            theme_confidence=classification.get("theme_confidence") if classification.get("theme_matched", False) else None,
            date_analyse=datetime.now(timezone.utc),
            empreinte=empreinte,
        )
        db.add(mention)
        db.flush()
        ingested_count += 1

    db.commit()

    return {
        "ingested_count": ingested_count,
        "duplicate_count": duplicate_count,
        "ignored_empty_count": ignored_empty_count,
    }
