"""
Endpoints KPI API — expose le moteur KPI P0 (app/services/kpi/) au frontend. Aucune
logique métier ici : cette couche ne fait que résoudre organisation_id/agence_id depuis
l'utilisateur authentifié, vérifier le périmètre RBAC, puis appeler KPI_FUNCTIONS.
"""
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_cx_or_agency_manager, get_db
from app.models.agence import Agence
from app.models.enums import UserRole
from app.models.utilisateur import Utilisateur
from app.schemas.kpi import KPICollectionResponse, KPIResult
from app.services.kpi.definitions import KPI_DEFINITIONS
from app.services.kpi.engine import KPI_FUNCTIONS

router = APIRouter()


def _resoudre_perimetre(db: Session, current_user: Utilisateur, agence_id: Optional[UUID]) -> Optional[UUID]:
    """Résout l'agence_id RÉELLEMENT appliqué au périmètre RBAC de current_user. Lève 403
    si l'agence_id demandé est hors périmètre — jamais un no_data silencieux pour masquer
    un défaut d'autorisation (no_data signifie : requête autorisée, aucune donnée)."""
    if current_user.role == UserRole.AGENCY_MANAGER:
        # Un Agency Manager sans agence ne doit JAMAIS retomber sur agence_id=None, qui
        # signifie « toute l'organisation » pour le moteur KPI : refus explicite.
        if current_user.agence_id is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Accès refusé : aucune agence n'est rattachée à votre compte",
            )
        if agence_id is not None and agence_id != current_user.agence_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Accès refusé : cette agence n'appartient pas à votre périmètre",
            )
        return current_user.agence_id

    # Refus par défaut : seul le CX Manager voit l'organisation (la dépendance exclut déjà l'Admin).
    if current_user.role != UserRole.CX_MANAGER:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accès refusé")

    if agence_id is not None:
        agence = db.query(Agence).filter(Agence.id == agence_id).first()
        if agence is None or agence.organisation_id != current_user.organisation_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Accès refusé : cette agence n'appartient pas à votre organisation",
            )
    return agence_id


@router.get("/", response_model=KPICollectionResponse)
def lister_kpis(
    jours: int = Query(30, ge=1, le=365),
    agence_id: Optional[UUID] = Query(None),
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
):
    """Les 8 KPI P0 en une seule requête, scopés à l'organisation de l'utilisateur
    authentifié (jamais un paramètre public) et, pour un Agency Manager, forcés à sa
    seule agence."""
    agence_id_effectif = _resoudre_perimetre(db, current_user, agence_id)
    resultats = [
        fonction(db, current_user.organisation_id, agence_id=agence_id_effectif, jours=jours)
        for fonction in KPI_FUNCTIONS.values()
    ]
    return KPICollectionResponse(
        organisation_id=current_user.organisation_id,
        agence_id=agence_id_effectif,
        jours=jours,
        kpis=resultats,
    )


@router.get("/{code}", response_model=KPIResult)
def obtenir_kpi(
    code: str,
    jours: int = Query(30, ge=1, le=365),
    agence_id: Optional[UUID] = Query(None),
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
):
    """Un seul KPI par son code (ex. CSAT), pour rafraîchir un widget sans recharger les 8."""
    fonction = KPI_FUNCTIONS.get(code.upper())
    if fonction is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"KPI inconnu : '{code}'. Codes valides : {sorted(KPI_DEFINITIONS.keys())}",
        )
    agence_id_effectif = _resoudre_perimetre(db, current_user, agence_id)
    return fonction(db, current_user.organisation_id, agence_id=agence_id_effectif, jours=jours)
