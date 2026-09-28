"""
Service d'intégration du microservice IKAN AI Veille (port 8002).
Permet à l'API principale de piloter le scraping Facebook / Réseaux sociaux
et d'ingérer les mentions extraites dans la table mentions_veille (jamais dans
feedbacks : ces avis n'ont pas de note client réelle, voir ingest_mentions).
"""
import hashlib
import logging
import re
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

import httpx
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.mention_veille import MentionVeille
from app.services.ai.sentiment import analyser_sentiment

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


async def get_session_status() -> Dict[str, Any]:
    """Récupère l'état de la session Facebook enregistrée dans le microservice."""
    url = f"{settings.VEILLE_SERVICE_URL.rstrip('/')}/session/facebook/status"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            res = await client.get(url, headers=_get_headers())
            if res.status_code == 200:
                return res.json()
            return {"valid": False, "error": f"Erreur {res.status_code}: {res.text}"}
    except Exception as e:
        return {"valid": False, "error": str(e)}


async def trigger_facebook_scrape(target: str, max_items: int = 20) -> Dict[str, Any]:
    """Déclenche une extraction de publications/avis Facebook via le microservice."""
    url = f"{settings.VEILLE_SERVICE_URL.rstrip('/')}/scrape/facebook"
    payload = {"target": target, "max_items": max_items}
    async with httpx.AsyncClient(timeout=120.0) as client:
        res = await client.post(url, json=payload, headers=_get_headers())
        if res.status_code != 200:
            logger.error(f"Échec du scraping veille ({res.status_code}): {res.text}")
            return {
                "success": False,
                "status_code": res.status_code,
                "error": res.text,
                "items": [],
            }
        data = res.json()
        return {"success": True, "data": data}


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
        url_source = item.get("url_source") or item.get("url") or None
        date_publication = _parser_date_publication(item.get("date_publication") or item.get("date"))

        empreinte = _calculer_empreinte(plateforme, _normaliser_texte(texte), date_publication, url_source)

        deja_present = (
            db.query(MentionVeille)
            .filter(MentionVeille.organisation_id == organisation_id, MentionVeille.empreinte == empreinte)
            .first()
        )
        if deja_present:
            duplicate_count += 1
            continue

        sentiment, score = analyser_sentiment(texte)

        mention = MentionVeille(
            organisation_id=organisation_id,
            agence_id=agence_id,
            plateforme=plateforme,
            type_contenu=type_contenu,
            texte=texte,
            url_source=url_source,
            date_publication=date_publication,
            sentiment=sentiment,
            score_sentiment=score,
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
