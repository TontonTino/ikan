"""
GET /admin/journal — lecture du journal d'audit (AD-08). Administrateur UNIQUEMENT (401 anonyme, 403 CX Manager et Agency Manager).

Lecture seule : ce module ne définit AUCUNE route d'écriture, de modification ni de suppression (un test parcourt les routes pour
le garantir). Les filtres s'ajoutent en ET. Le nombre de requêtes SQL est constant : un comptage et une page (plus l'authentification),
quel que soit le nombre de lignes. Tri : date décroissante puis identifiant décroissant (ordre stable pour la pagination).
"""
from datetime import datetime
from typing import List, Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_admin_user, get_db
from app.models.journal_audit import JournalAudit
from app.models.utilisateur import Utilisateur
from app.schemas.journal_audit import JournalAuditItem

router = APIRouter()

TAILLE_PAGE_MAX = 200


@router.get("/journal", response_model=List[JournalAuditItem])
def lire_journal(
    response: Response,
    db: Session = Depends(get_db),
    _admin: Utilisateur = Depends(get_admin_user),
    date_debut: Optional[datetime] = Query(None, description="Inclus."),
    date_fin: Optional[datetime] = Query(None, description="Inclus."),
    acteur_id: Optional[UUID] = Query(None),
    acteur_email: Optional[str] = Query(None, max_length=255, description="E-mail exact de l'acteur (casse ignorée)."),
    action: Optional[str] = Query(None, min_length=1, max_length=60, description="Code d'action exact, ex. compte.cree."),
    organisation_id: Optional[UUID] = Query(None),
    resultat: Optional[Literal["succes", "refus"]] = Query(None),
    limit: int = Query(50, ge=1, le=TAILLE_PAGE_MAX),
    offset: int = Query(0, ge=0),
):
    requete = db.query(JournalAudit)
    if date_debut is not None:
        requete = requete.filter(JournalAudit.date_action >= date_debut)
    if date_fin is not None:
        requete = requete.filter(JournalAudit.date_action <= date_fin)
    if acteur_id is not None:
        requete = requete.filter(JournalAudit.acteur_id == acteur_id)
    if acteur_email:
        requete = requete.filter(func.lower(JournalAudit.acteur_email) == acteur_email.strip().lower())
    if action:
        requete = requete.filter(JournalAudit.action == action)
    if organisation_id is not None:
        requete = requete.filter(JournalAudit.organisation_id == organisation_id)
    if resultat:
        requete = requete.filter(JournalAudit.resultat == resultat)

    response.headers["X-Total-Count"] = str(requete.order_by(None).count())
    return requete.order_by(JournalAudit.date_action.desc(), JournalAudit.id.desc()).offset(offset).limit(limit).all()
