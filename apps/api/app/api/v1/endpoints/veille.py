"""
Endpoints Veille & Réseaux Sociaux — pilotage du microservice de veille, ingestion et
consultation des mentions dans leur flux séparé.
"""
from collections import defaultdict
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user, get_db
from app.models.agence import Agence
from app.models.enums import SentimentType, UserRole
from app.models.mention_veille import MentionVeille
from app.models.utilisateur import Utilisateur
from app.services.acces_agence import verifier_acces_agence
from app.services.veille_service import (
    check_veille_service,
    get_session_status,
    ingest_mentions,
    trigger_facebook_scrape,
)

router = APIRouter()


def _exiger_cx_manager(current_user: Utilisateur) -> None:
    if current_user.role != UserRole.CX_MANAGER:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accès réservé aux CX Managers")


class ScrapeAndIngestRequest(BaseModel):
    target: str = Field(..., description="URL de la page Facebook cible")
    max_items: int = Field(20, ge=1, le=100, description="Nombre max d'items à extraire")
    agence_id: Optional[UUID] = Field(None, description="Agence à laquelle associer les mentions (optionnel)")
    auto_ingest: bool = Field(False, description="Si True, ingère directement les mentions dans mentions_veille")


class IngestBatchRequest(BaseModel):
    agence_id: Optional[UUID] = Field(None, description="Agence à laquelle associer les mentions (optionnel)")
    items: List[Dict[str, Any]] = Field(..., description="Liste des items de veille à ingérer")


@router.get("/status", tags=["Veille & Réseaux"])
async def veille_status(
    current_user: Utilisateur = Depends(get_current_active_user),
) -> Dict[str, Any]:
    """
    Vérifie l'état de santé du microservice de veille et la validité de la session Facebook.
    Réservé aux CX Managers.
    """
    _exiger_cx_manager(current_user)

    health = await check_veille_service()
    session = await get_session_status(str(current_user.organisation_id)) if health.get("status") == "online" else {"valid": False}
    return {
        "service": health,
        "facebook_session": session,
    }


@router.post("/facebook/scrape", tags=["Veille & Réseaux"])
async def scrape_facebook(
    payload: ScrapeAndIngestRequest,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_current_active_user),
) -> Dict[str, Any]:
    """
    Déclenche une extraction Facebook via le microservice de veille.
    Optionnellement, ingère directement les mentions dans mentions_veille.
    """
    _exiger_cx_manager(current_user)

    scrape_result = await trigger_facebook_scrape(payload.target, payload.max_items)
    if not scrape_result.get("success"):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Erreur lors du scraping de veille: {scrape_result.get('error', 'Inconnu')}",
        )

    scraped_data = scrape_result.get("data", {})
    items = scraped_data.get("items", [])

    ingestion_summary = None
    if payload.auto_ingest and items:
        if payload.agence_id is not None:
            verifier_acces_agence(db, current_user, payload.agence_id)
        try:
            ingestion_summary = ingest_mentions(
                items=items,
                organisation_id=current_user.organisation_id,
                agence_id=payload.agence_id,
                db=db,
            )
        except Exception as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    return {
        "status": "success",
        "scraped_count": len(items),
        "target": payload.target,
        "items": items,
        "ingestion": ingestion_summary,
    }


@router.post("/ingest", tags=["Veille & Réseaux"])
def ingest_batch(
    payload: IngestBatchRequest,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_current_active_user),
) -> Dict[str, Any]:
    """
    Ingère manuellement un lot d'items de veille dans mentions_veille.
    """
    _exiger_cx_manager(current_user)

    if payload.agence_id is not None:
        verifier_acces_agence(db, current_user, payload.agence_id)

    try:
        summary = ingest_mentions(
            items=payload.items,
            organisation_id=current_user.organisation_id,
            agence_id=payload.agence_id,
            db=db,
        )
        return {"status": "success", "summary": summary}
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


# ── Consultation des mentions ───────────────────────────────────────────────

class MentionOut(BaseModel):
    id: UUID
    plateforme: str
    type_contenu: str
    texte: str
    sentiment: SentimentType
    score_sentiment: float
    theme_principal: Optional[str]
    theme_confidence: Optional[float]
    date_publication: Optional[datetime]
    date_analyse: Optional[datetime]
    url_source: Optional[str]
    agence_nom: Optional[str]

    model_config = {"from_attributes": True}


class MentionsListResponse(BaseModel):
    total: int
    items: List[MentionOut]


def _appliquer_filtres_periode_agence(query, current_user: Utilisateur, date_debut, date_fin, agence_id):
    query = query.filter(MentionVeille.organisation_id == current_user.organisation_id)
    if date_debut is not None:
        query = query.filter(MentionVeille.date_publication >= date_debut)
    if date_fin is not None:
        query = query.filter(MentionVeille.date_publication <= date_fin)
    if agence_id is not None:
        query = query.filter(MentionVeille.agence_id == agence_id)
    return query


@router.get("/mentions", response_model=MentionsListResponse, tags=["Veille & Réseaux"])
def lister_mentions(
    date_debut: Optional[datetime] = Query(None),
    date_fin: Optional[datetime] = Query(None),
    sentiment: Optional[str] = Query(None, description="positif | neutre | negatif"),
    theme: Optional[str] = Query(None, description="Thème, ou non_classe pour les thèmes absents"),
    plateforme: Optional[str] = Query(None, min_length=1, max_length=30),
    agence_id: Optional[UUID] = Query(None),
    recherche: Optional[str] = Query(None, min_length=1, max_length=200),
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_current_active_user),
) -> MentionsListResponse:
    """Liste les mentions de l'organisation courante (jamais celles d'une autre)."""
    _exiger_cx_manager(current_user)

    sentiment_enum = None
    if sentiment is not None:
        try:
            sentiment_enum = SentimentType(sentiment.strip().lower())
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="sentiment invalide (positif | neutre | negatif)")

    base_query = db.query(MentionVeille).outerjoin(Agence, MentionVeille.agence_id == Agence.id)
    base_query = _appliquer_filtres_periode_agence(base_query, current_user, date_debut, date_fin, agence_id)
    if sentiment_enum is not None:
        base_query = base_query.filter(MentionVeille.sentiment == sentiment_enum)
    if theme is not None:
        theme_normalise = theme.strip().lower().replace("_", " ")
        if theme_normalise in {"non classe", "non classé"}:
            base_query = base_query.filter(MentionVeille.theme_principal.is_(None))
        else:
            base_query = base_query.filter(func.lower(MentionVeille.theme_principal) == theme.strip().lower())
    if plateforme is not None:
        base_query = base_query.filter(func.lower(MentionVeille.plateforme) == plateforme.strip().lower())
    if recherche is not None:
        base_query = base_query.filter(MentionVeille.texte.ilike(f"%{recherche.strip()}%"))

    total = base_query.count()
    rows = (
        base_query.with_entities(MentionVeille, Agence.nom.label("agence_nom"))
        .order_by(MentionVeille.date_publication.desc().nullslast())
        .limit(limit)
        .offset(offset)
        .all()
    )

    items = [
        MentionOut(
            id=mention.id,
            plateforme=mention.plateforme,
            type_contenu=mention.type_contenu,
            texte=mention.texte,
            sentiment=mention.sentiment,
            score_sentiment=mention.score_sentiment,
            theme_principal=mention.theme_principal,
            theme_confidence=mention.theme_confidence,
            date_publication=mention.date_publication,
            date_analyse=mention.date_analyse,
            url_source=mention.url_source,
            agence_nom=agence_nom,
        )
        for mention, agence_nom in rows
    ]
    return MentionsListResponse(total=total, items=items)


class SentimentBucket(BaseModel):
    count: int
    pourcentage: float


class ThemeBucket(BaseModel):
    theme_principal: Optional[str]
    count: int
    pourcentage: float


class SyntheseJour(BaseModel):
    date: str
    positif: int
    neutre: int
    negatif: int


class SyntheseResponse(BaseModel):
    total: int
    par_sentiment: Dict[str, SentimentBucket]
    par_theme: List[ThemeBucket]
    serie_journaliere: List[SyntheseJour]


@router.get("/synthese", response_model=SyntheseResponse, tags=["Veille & Réseaux"])
def synthese_mentions(
    date_debut: Optional[datetime] = Query(None),
    date_fin: Optional[datetime] = Query(None),
    agence_id: Optional[UUID] = Query(None),
    plateforme: Optional[str] = Query(None, min_length=1, max_length=30),
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_current_active_user),
) -> SyntheseResponse:
    """Répartition par sentiment et série journalière, sur l'organisation courante uniquement."""
    _exiger_cx_manager(current_user)

    query = db.query(MentionVeille)
    query = _appliquer_filtres_periode_agence(query, current_user, date_debut, date_fin, agence_id)
    if plateforme is not None:
        query = query.filter(func.lower(MentionVeille.plateforme) == plateforme.strip().lower())
    mentions = query.all()

    total = len(mentions)
    compte_sentiment = {SentimentType.POSITIF: 0, SentimentType.NEUTRE: 0, SentimentType.NEGATIF: 0}
    for m in mentions:
        compte_sentiment[m.sentiment] += 1

    par_sentiment = {
        s.value: SentimentBucket(
            count=compte_sentiment[s],
            pourcentage=round((compte_sentiment[s] / total * 100), 1) if total else 0.0,
        )
        for s in SentimentType
    }

    par_jour: Dict[str, Dict[str, int]] = defaultdict(lambda: {"positif": 0, "neutre": 0, "negatif": 0})
    for m in mentions:
        if m.date_publication is None:
            continue
        jour = m.date_publication.date().isoformat()
        par_jour[jour][m.sentiment.value] += 1

    serie_journaliere = [
        SyntheseJour(date=jour, positif=v["positif"], neutre=v["neutre"], negatif=v["negatif"])
        for jour, v in sorted(par_jour.items())
    ]

    compte_theme: Dict[Optional[str], int] = defaultdict(int)
    for mention in mentions:
        compte_theme[mention.theme_principal] += 1
    par_theme = [
        ThemeBucket(
            theme_principal=theme,
            count=count,
            pourcentage=round(count / total * 100, 1) if total else 0.0,
        )
        for theme, count in sorted(compte_theme.items(), key=lambda item: (item[0] is None, item[0] or ""))
    ]

    return SyntheseResponse(
        total=total,
        par_sentiment=par_sentiment,
        par_theme=par_theme,
        serie_journaliere=serie_journaliere,
    )
