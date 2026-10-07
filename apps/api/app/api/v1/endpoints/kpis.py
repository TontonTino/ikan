"""
Endpoints KPI API — expose le moteur KPI (app/services/kpi/) au frontend. Aucune logique
métier ici : cette couche résout organisation_id/agence_id depuis l'utilisateur
authentifié, vérifie le périmètre RBAC, restreint aux codes visibles pour le secteur et
le forfait de l'organisation (app/services/kpi/packs.py), puis appelle KPI_FUNCTIONS.

Le secteur est TOUJOURS lu en base (Organisation.secteur_code de l'utilisateur connecté),
jamais pris dans la requête : il n'y a pas de paramètre secteur sur ces endpoints.
"""
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_cx_or_agency_manager, get_db
from app.models.agence import Agence
from app.models.enums import UserRole
from app.models.organisation import Organisation
from app.models.utilisateur import Utilisateur
from app.schemas.kpi import KPICollectionResponse, KPIResult
from app.services.kpi.definitions import KPI_DEFINITIONS
from app.services.kpi.engine import KPI_FUNCTIONS
from app.services.kpi.packs import PACKS, kpis_visibles

router = APIRouter()


def _organisation_de(db: Session, current_user: Utilisateur) -> Optional[Organisation]:
    """Requête explicite plutôt que la relation current_user.organisation : current_user
    est parfois un simple porteur de organisation_id/role/agence_id (tests RBAC via
    SimpleNamespace, voir test_kpis_api.py) sans session SQLAlchemy attachée."""
    if current_user.organisation_id is None:
        return None
    return db.query(Organisation).filter(Organisation.id == current_user.organisation_id).first()


def _secteur_et_codes_visibles(db: Session, current_user: Utilisateur) -> tuple[Optional[str], tuple[str, ...]]:
    """(secteur_code, codes KPI visibles) pour l'organisation de current_user — secteur_code
    et forfait lus en base (jamais depuis un paramètre de requête). Un seul endroit pour
    cette résolution, partagé par les deux endpoints ci-dessous."""
    organisation = _organisation_de(db, current_user)
    secteur_code = organisation.secteur_code if organisation else None
    plan_code = organisation.plan.code if organisation and organisation.plan else None
    return secteur_code, kpis_visibles(secteur_code, plan_code)


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
    """Les KPI visibles pour l'organisation de l'utilisateur authentifié (communs, plus le
    pack de son secteur s'il en a un) en une seule requête, scopés à cette organisation
    (jamais un paramètre public) et, pour un Agency Manager, forcés à sa seule agence."""
    agence_id_effectif = _resoudre_perimetre(db, current_user, agence_id)
    secteur_code, codes_visibles = _secteur_et_codes_visibles(db, current_user)
    resultats = []
    for code in codes_visibles:
        fonction = KPI_FUNCTIONS.get(code)
        if fonction is None:
            continue  # code du registre de packs sans fonction de calcul : pas encore implémenté
        resultat = fonction(db, current_user.organisation_id, agence_id=agence_id_effectif, jours=jours)
        resultat.famille = KPI_DEFINITIONS[code].famille
        resultats.append(resultat)

    return KPICollectionResponse(
        organisation_id=current_user.organisation_id,
        agence_id=agence_id_effectif,
        jours=jours,
        kpis=resultats,
        secteur_code=secteur_code,
        pack_disponible=bool(PACKS.get(secteur_code)) if secteur_code else False,
    )


@router.get("/{code}", response_model=KPIResult)
def obtenir_kpi(
    code: str,
    jours: int = Query(30, ge=1, le=365),
    agence_id: Optional[UUID] = Query(None),
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
):
    """Un seul KPI par son code (ex. CSAT), pour rafraîchir un widget sans recharger la
    collection. Un code hors du périmètre de l'organisation (secteur/forfait) répond 404,
    identique à un code totalement inconnu — jamais un 403 qui révélerait son existence."""
    code = code.upper()
    _secteur_code, codes_visibles = _secteur_et_codes_visibles(db, current_user)
    fonction = KPI_FUNCTIONS.get(code)
    if fonction is None or code not in codes_visibles:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"KPI inconnu : '{code}'. Codes valides : {sorted(codes_visibles)}",
        )
    agence_id_effectif = _resoudre_perimetre(db, current_user, agence_id)
    resultat = fonction(db, current_user.organisation_id, agence_id=agence_id_effectif, jours=jours)
    resultat.famille = KPI_DEFINITIONS[code].famille
    return resultat
