"""
Endpoints Suggestions/Idées — gestion du statut (BF-11).
"""
from uuid import UUID
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session, joinedload
from datetime import datetime, timezone

from app.api.deps import get_cx_or_agency_manager, get_db
from app.models.utilisateur import Utilisateur
from app.models.suggestion import Suggestion, HistoriqueSuggestion
from app.models.enums import UserRole, IdeaStatus
from app.schemas.suggestion import HistoriqueSuggestionResponse, SuggestionResponse, SuggestionStatusUpdate
from app.services.acces_agence import verifier_acces_agence
from app.services.historique_suggestions import (
    MESSAGE_RETOUR_A_NOUVEAU, dernier_changement_par_suggestion, historiques_par_suggestion, transition_interdite,
)
from app.services.suggestions_scope import agence_effective, agence_id_de_la_suggestion, filtrer_par_perimetre

router = APIRouter()


def _avec_dernier_changement(suggestion: Suggestion, dernier) -> SuggestionResponse:
    return SuggestionResponse.model_validate(suggestion).model_copy(update={"dernier_changement": dernier})


def _suggestion_autorisee(db: Session, current_user: Utilisateur, suggestion_id: UUID, *, verrou: bool = False) -> Suggestion:
    """La suggestion, ou 404 si elle n'existe pas, ou 403 hors du périmètre du rôle (agence effective : suggestions sans feedback
    comprises, voir suggestions_scope.py). UNE seule porte d'entrée pour le détail, l'historique et le changement de statut."""
    requete = db.query(Suggestion).filter(Suggestion.id == suggestion_id)
    suggestion = (requete.with_for_update() if verrou else requete).first()
    if not suggestion:
        raise HTTPException(status_code=404, detail="Suggestion introuvable")
    verifier_acces_agence(db, current_user, agence_id_de_la_suggestion(db, suggestion))
    return suggestion


@router.get("/", response_model=List[SuggestionResponse])
def list_suggestions(
    response: Response,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
    agence_id: Optional[UUID] = Query(None, description="Restreint à une agence. Ne s'ajoute qu'au périmètre du rôle : jamais une autorisation."),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """Liste les suggestions (CX Manager / Agency Manager uniquement, Admin exclu), y compris celles envoyées sans
    feedback (« Partager une idée »). Périmètre : voir app/services/suggestions_scope.py."""
    query = filtrer_par_perimetre(db.query(Suggestion), current_user)

    # Le filtre agence s'ajoute (ET) au périmètre du rôle : une agence étrangère donne une liste vide.
    if agence_id is not None:
        query = query.filter(agence_effective() == agence_id)

    response.headers["X-Total-Count"] = str(query.order_by(None).count())
    suggestions = query.order_by(Suggestion.date_soumission.desc()).offset(offset).limit(limit).all()
    derniers = dernier_changement_par_suggestion(db, [s.id for s in suggestions])      # une requête pour toute la page
    return [_avec_dernier_changement(s, derniers.get(s.id)) for s in suggestions]


@router.get("/{suggestion_id}", response_model=SuggestionResponse)
def get_suggestion(
    suggestion_id: UUID,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
):
    suggestion = _suggestion_autorisee(db, current_user, suggestion_id)
    return _avec_dernier_changement(suggestion, dernier_changement_par_suggestion(db, [suggestion.id]).get(suggestion.id))


@router.get("/{suggestion_id}/historique", response_model=List[HistoriqueSuggestionResponse])
def historique_suggestion(
    suggestion_id: UUID,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
):
    """Historique complet des changements de statut, du plus ancien au plus récent. Même périmètre que la suggestion (403 hors
    périmètre, 404 si elle n'existe pas). Aucune donnée de contact du client."""
    suggestion = _suggestion_autorisee(db, current_user, suggestion_id)
    return historiques_par_suggestion(db, [suggestion.id]).get(suggestion.id, [])


@router.patch("/{suggestion_id}/statut", response_model=SuggestionResponse)
def update_suggestion_statut(
    suggestion_id: UUID,
    data: SuggestionStatusUpdate,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
):
    """
    Met à jour le statut d'une suggestion — tracé dans l'historique d'audit (BNF-09), avec l'auteur, la date et un commentaire facultatif.
    - Retour à « Nouveau » depuis un autre statut : 409. Tout le reste est permis (rouvrir une suggestion traitée ou rejetée : « En cours »).
    - Même statut : aucun changement, aucune entrée d'historique.
    La ligne est verrouillée (PostgreSQL) : deux changements simultanés ne s'écrasent pas et n'écrivent pas deux entrées identiques.
    """
    suggestion = _suggestion_autorisee(db, current_user, suggestion_id, verrou=True)

    ancien_statut = suggestion.statut

    if data.statut == ancien_statut:
        # Pas une transition : ni entrée d'historique, ni date modifiée. Les notes internes, si fournies, restent enregistrées.
        if data.notes_internes:
            suggestion.notes_internes = data.notes_internes
            db.commit()
            db.refresh(suggestion)
        return _avec_dernier_changement(suggestion, dernier_changement_par_suggestion(db, [suggestion.id]).get(suggestion.id))

    if transition_interdite(ancien_statut, data.statut):
        raise HTTPException(status_code=409, detail=MESSAGE_RETOUR_A_NOUVEAU)

    # Créer l'entrée d'historique
    historique = HistoriqueSuggestion(
        suggestion_id=suggestion.id,
        ancien_statut=ancien_statut,
        nouveau_statut=data.statut,
        commentaire=data.commentaire,
        utilisateur_id=current_user.id,
        date_action=datetime.now(timezone.utc),   # explicite (microsecondes) : l'ordre chronologique de l'historique reste déterministe
    )
    db.add(historique)

    # Mettre à jour le statut
    suggestion.statut = data.statut
    if data.notes_internes:
        suggestion.notes_internes = data.notes_internes
    if data.statut in (IdeaStatus.TRAITE, IdeaStatus.REJETE):
        suggestion.date_traitement = datetime.now(timezone.utc)
    elif data.statut == IdeaStatus.EN_COURS:
        suggestion.date_traitement = None      # rouverte : plus « traitée » ; la date reste dans l'historique

    db.commit()
    db.refresh(suggestion)
    return _avec_dernier_changement(suggestion, dernier_changement_par_suggestion(db, [suggestion.id]).get(suggestion.id))
