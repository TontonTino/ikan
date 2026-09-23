"""
Endpoints Agences — gestion par l'Administrateur et le CX Manager.
Isolation multi-tenant : chaque utilisateur ne voit et ne gère que les agences de son périmètre.
"""
import uuid
from uuid import UUID
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session

from app.core.config import settings
from app.api.deps import get_cx_or_admin, get_current_active_user, get_db
from app.models.utilisateur import Utilisateur
from app.models.agence import Agence
from app.models.qr_code import QRCode
from app.models.categorie import Categorie
from app.models.feedback import Feedback
from app.models.suggestion import Suggestion, HistoriqueSuggestion
from app.models.historique_feedback import HistoriqueFeedback
from app.models.enums import UserRole
from app.schemas.agence import AgenceCreate, AgenceUpdate, AgenceResponse, ActiviteAgenceItem
from app.schemas.categorie import CategorieCreate, CategorieUpdate, CategorieResponse
from app.services.plan_catalog import FEATURE_CATEGORIES
from app.services.plan_service import organisation_a_la_fonctionnalite

router = APIRouter()


def _exiger_categories_personnalisees(agence: Agence, db: Session) -> None:
    """Gestion des catégories = fonctionnalité Starter+ (fail-open : jamais bloquant sur erreur)."""
    if not organisation_a_la_fonctionnalite(agence.organisation_id, FEATURE_CATEGORIES, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Les catégories personnalisées sont disponibles à partir du forfait Starter. "
                   "Votre formulaire utilise la catégorie « Général » par défaut.",
        )


def _check_cx_owns_agence(agence: Agence, current_user: Utilisateur) -> None:
    """Vérifie que l'utilisateur est le CX Manager propriétaire de l'organisation de cette agence."""
    if current_user.role != UserRole.CX_MANAGER or agence.organisation_id != current_user.organisation_id:
        raise HTTPException(
            status_code=403,
            detail="Accès refusé. Cette action est réservée au CX Manager propriétaire de cette agence.",
        )


def _check_can_create_categorie(agence: Agence, current_user: Utilisateur) -> None:
    """
    Création d'une catégorie : le CX Manager de l'organisation, ou l'Agency Manager
    de SA PROPRE agence uniquement (jamais celle d'une autre agence).
    """
    if current_user.role == UserRole.CX_MANAGER and agence.organisation_id == current_user.organisation_id:
        return
    if current_user.role == UserRole.AGENCY_MANAGER and agence.id == current_user.agence_id:
        return
    raise HTTPException(
        status_code=403,
        detail="Accès refusé. Seuls le CX Manager de votre organisation et l'Agency Manager de cette agence "
               "peuvent créer une catégorie.",
    )


def _check_can_modify_categorie(agence: Agence, categorie: Categorie, current_user: Utilisateur) -> None:
    """
    Modification/désactivation d'une catégorie : le CX Manager garde tous les droits sur les
    agences de son organisation (catégories créées par lui ou par un Agency Manager, sans
    régression). L'Agency Manager ne peut agir QUE sur les catégories qu'il a lui-même créées,
    sur sa propre agence — jamais sur celles créées par le CX Manager.
    """
    if current_user.role == UserRole.CX_MANAGER and agence.organisation_id == current_user.organisation_id:
        return
    if (
        current_user.role == UserRole.AGENCY_MANAGER
        and agence.id == current_user.agence_id
        and categorie.cree_par_id == current_user.id
    ):
        return
    raise HTTPException(
        status_code=403,
        detail="Accès refusé. Vous ne pouvez modifier ou désactiver que les catégories que vous avez créées.",
    )


def _check_agence_access(agence: Agence, current_user: Utilisateur):
    if current_user.role == UserRole.CX_MANAGER and agence.organisation_id == current_user.organisation_id:
        return
    if current_user.role == UserRole.AGENCY_MANAGER and agence.id == current_user.agence_id:
        return
    raise HTTPException(status_code=403, detail="Accès refusé à cette agence. La gestion des agences est réservée au CX Manager.")


def _get_manager_nom(agence: Agence, db: Session) -> Optional[str]:
    """
    Nom du (premier) Agency Manager rattaché à cette agence, ou None si aucun
    n'est assigné (rien n'empêche plusieurs comptes agency_manager sur la même
    agence : on prend le plus anciennement assigné, cas le plus courant restant
    un seul manager par agence).
    """
    manager = (
        db.query(Utilisateur)
        .filter(Utilisateur.agence_id == agence.id, Utilisateur.role == UserRole.AGENCY_MANAGER)
        .order_by(Utilisateur.date_creation.asc())
        .first()
    )
    return f"{manager.prenom} {manager.nom}" if manager else None


def _enrich_agence_qr(agence: Agence, db: Session) -> AgenceResponse:
    """Attache le token QR, l'URL du QR Code actif et le nom du manager à la réponse Agence."""
    res = AgenceResponse.model_validate(agence)
    res.manager_nom = _get_manager_nom(agence, db)
    qr = db.query(QRCode).filter(
        QRCode.agence_id == agence.id,
        QRCode.actif == True,
    ).first()
    base_url = settings.PUBLIC_CLIENT_URL.rstrip("/")
    if not qr:
        clean_name = agence.nom.upper().replace(" ", "-")[:12]
        code_str = f"QR-{clean_name}-{uuid.uuid4().hex[:6].upper()}"
        qr = QRCode(
            id=uuid.uuid4(),
            agence_id=agence.id,
            code=code_str,
            url=f"{base_url}/feedback/{code_str}",
            label=f"Borne Accueil - {agence.nom}",
            actif=True
        )
        db.add(qr)
        db.commit()

    res.qr_code_token = qr.code
    res.qr_code_url = f"{base_url}/feedback/{qr.code}"
    return res


@router.get("/", response_model=List[AgenceResponse])
def list_agences(
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_current_active_user),
):
    """
    Liste les agences selon le rôle :
    - CX Manager : toutes les agences de son organisation
    - Agency Manager : seulement son agence rattachée
    - Admin : gestion directe désactivée
    """
    if current_user.role == UserRole.ADMIN:
        return []
    elif current_user.role == UserRole.CX_MANAGER:
        agences = db.query(Agence).filter(
            Agence.organisation_id == current_user.organisation_id
        ).all()
    else:
        agences = db.query(Agence).filter(Agence.id == current_user.agence_id).all()

    return [_enrich_agence_qr(a, db) for a in agences]


@router.post("/", response_model=AgenceResponse, status_code=status.HTTP_201_CREATED)
def create_agence(
    data: AgenceCreate,
    org_id: Optional[UUID] = Query(None),
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_admin),
):
    """
    Crée une nouvelle agence (réservé au rôle CX Manager).
    Génère automatiquement le QR Code associé à l'agence.
    """
    if current_user.role == UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="L'Administrateur ne gère pas directement les agences. Cette action est réservée au CX Manager.")

    target_org_id = current_user.organisation_id

    agence = Agence(organisation_id=target_org_id, **data.model_dump())
    db.add(agence)
    db.flush()

    base_url = settings.PUBLIC_CLIENT_URL.rstrip("/")
    clean_name = agence.nom.upper().replace(" ", "-")[:12]
    code_str = f"QR-{clean_name}-{uuid.uuid4().hex[:6].upper()}"
    qr = QRCode(
        id=uuid.uuid4(),
        agence_id=agence.id,
        code=code_str,
        url=f"{base_url}/feedback/{code_str}",
        label=f"Borne Accueil - {agence.nom}",
        actif=True
    )
    db.add(qr)

    db.commit()
    db.refresh(agence)
    return _enrich_agence_qr(agence, db)


@router.get("/{agence_id}", response_model=AgenceResponse)
def get_agence(
    agence_id: UUID,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_current_active_user),
):
    agence = db.query(Agence).filter(Agence.id == agence_id).first()
    if not agence:
        raise HTTPException(status_code=404, detail="Agence introuvable")
    _check_agence_access(agence, current_user)
    return _enrich_agence_qr(agence, db)


@router.patch("/{agence_id}", response_model=AgenceResponse)
def update_agence(
    agence_id: UUID,
    data: AgenceUpdate,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_admin),
):
    agence = db.query(Agence).filter(Agence.id == agence_id).first()
    if not agence:
        raise HTTPException(status_code=404, detail="Agence introuvable")

    _check_agence_access(agence, current_user)

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(agence, field, value)

    db.commit()
    db.refresh(agence)
    return _enrich_agence_qr(agence, db)


@router.delete("/{agence_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_agence(
    agence_id: UUID,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_admin),
):
    agence = db.query(Agence).filter(Agence.id == agence_id).first()
    if not agence:
        raise HTTPException(status_code=404, detail="Agence introuvable")

    _check_agence_access(agence, current_user)

    db.delete(agence)
    db.commit()


# ============================================================================
# Catégories de feedback (par agence) — définies par le CX Manager.
# Remplacent la classification thématique IA : le client choisit lui-même
# sa catégorie sur le formulaire, parmi celles actives de son agence.
# ============================================================================

@router.get("/{agence_id}/categories", response_model=List[CategorieResponse])
def list_categories(
    agence_id: UUID,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_current_active_user),
):
    """
    Liste les catégories d'une agence.
    - CX Manager propriétaire : toutes (actives et désactivées), pour la gestion.
    - Agency Manager : LECTURE SEULE, uniquement les catégories ACTIVES de SA propre
      agence (les créations/modifications/désactivations restent exclusivement CX Manager).
    """
    agence = db.query(Agence).filter(Agence.id == agence_id).first()
    if not agence:
        raise HTTPException(status_code=404, detail="Agence introuvable")

    requete = db.query(Categorie).filter(Categorie.agence_id == agence_id)

    if current_user.role == UserRole.AGENCY_MANAGER:
        if agence.id != current_user.agence_id:
            raise HTTPException(
                status_code=403,
                detail="Accès refusé : vous ne pouvez consulter que les catégories de votre agence.",
            )
        requete = requete.filter(Categorie.active == True)  # noqa: E712
    else:
        _check_cx_owns_agence(agence, current_user)

    return requete.order_by(Categorie.created_at.asc()).all()


@router.post("/{agence_id}/categories", response_model=CategorieResponse, status_code=status.HTTP_201_CREATED)
def create_categorie(
    agence_id: UUID,
    data: CategorieCreate,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_current_active_user),
):
    """
    Crée une catégorie pour une agence.
    - CX Manager : sur n'importe quelle agence de son organisation.
    - Agency Manager : uniquement sur SA PROPRE agence.
    """
    agence = db.query(Agence).filter(Agence.id == agence_id).first()
    if not agence:
        raise HTTPException(status_code=404, detail="Agence introuvable")

    _check_can_create_categorie(agence, current_user)
    _exiger_categories_personnalisees(agence, db)

    categorie = Categorie(
        agence_id=agence_id,
        nom=data.nom.strip(),
        active=True,
        est_categorie_suggestion=data.est_categorie_suggestion,
        cree_par_id=current_user.id,
        cree_par_role=current_user.role.value,
    )
    db.add(categorie)
    db.commit()
    db.refresh(categorie)
    return categorie


@router.patch("/{agence_id}/categories/{categorie_id}", response_model=CategorieResponse)
def update_categorie(
    agence_id: UUID,
    categorie_id: UUID,
    data: CategorieUpdate,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_current_active_user),
):
    """
    Modifie ou désactive une catégorie.
    - CX Manager : toutes les catégories des agences de son organisation, quel que soit le créateur.
    - Agency Manager : uniquement les catégories qu'il a lui-même créées, sur sa propre agence.
    """
    agence = db.query(Agence).filter(Agence.id == agence_id).first()
    if not agence:
        raise HTTPException(status_code=404, detail="Agence introuvable")

    categorie = db.query(Categorie).filter(
        Categorie.id == categorie_id, Categorie.agence_id == agence_id
    ).first()
    if not categorie:
        raise HTTPException(status_code=404, detail="Catégorie introuvable")

    _check_can_modify_categorie(agence, categorie, current_user)
    _exiger_categories_personnalisees(agence, db)

    updates = data.model_dump(exclude_unset=True)
    if "nom" in updates and updates["nom"]:
        updates["nom"] = updates["nom"].strip()
    for field, value in updates.items():
        setattr(categorie, field, value)

    db.commit()
    db.refresh(categorie)
    return categorie


@router.delete("/{agence_id}/categories/{categorie_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_categorie(
    agence_id: UUID,
    categorie_id: UUID,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_current_active_user),
):
    """
    Désactive une catégorie (soft delete).
    - CX Manager : toutes les catégories des agences de son organisation, quel que soit le créateur.
    - Agency Manager : uniquement les catégories qu'il a lui-même créées, sur sa propre agence.
    """
    agence = db.query(Agence).filter(Agence.id == agence_id).first()
    if not agence:
        raise HTTPException(status_code=404, detail="Agence introuvable")

    categorie = db.query(Categorie).filter(
        Categorie.id == categorie_id, Categorie.agence_id == agence_id
    ).first()
    if not categorie:
        raise HTTPException(status_code=404, detail="Catégorie introuvable")

    _check_can_modify_categorie(agence, categorie, current_user)

    categorie.active = False
    db.commit()


# ============================================================================
# Activité (page agence unifiée) — fusionne HistoriqueFeedback et
# HistoriqueSuggestion, sans nouvelle table ni logique de calcul dupliquée.
# ============================================================================

@router.get("/{agence_id}/activite", response_model=List[ActiviteAgenceItem])
def get_activite_agence(
    agence_id: UUID,
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_current_active_user),
):
    """
    Fil d'activité chronologique d'une agence : transitions de feedback
    (HistoriqueFeedback, filtré par agence_id dénormalisé) fusionnées avec les
    changements de statut de suggestions (HistoriqueSuggestion, atteint via
    Suggestion.feedback_id -> Feedback -> QRCode.agence_id).
    """
    agence = db.query(Agence).filter(Agence.id == agence_id).first()
    if not agence:
        raise HTTPException(status_code=404, detail="Agence introuvable")
    _check_agence_access(agence, current_user)

    evenements: list[ActiviteAgenceItem] = []

    historiques = (
        db.query(HistoriqueFeedback)
        .filter(HistoriqueFeedback.agence_id == agence_id)
        .order_by(HistoriqueFeedback.date_evenement.desc())
        .limit(limit)
        .all()
    )
    for h in historiques:
        evenements.append(ActiviteAgenceItem(
            id=h.id,
            date=h.date_evenement,
            type_evenement=h.type_evenement,
            auteur_nom=h.auteur_nom,
            auteur_role=h.auteur_role,
            details=h.details,
        ))

    historiques_suggestions = (
        db.query(HistoriqueSuggestion)
        .join(Suggestion, HistoriqueSuggestion.suggestion_id == Suggestion.id)
        .join(Feedback, Suggestion.feedback_id == Feedback.id)
        .join(QRCode, Feedback.qr_code_id == QRCode.id)
        .filter(QRCode.agence_id == agence_id)
        .order_by(HistoriqueSuggestion.date_action.desc())
        .limit(limit)
        .all()
    )
    auteurs_ids = {hs.utilisateur_id for hs in historiques_suggestions if hs.utilisateur_id}
    auteurs = (
        {u.id: f"{u.prenom} {u.nom}" for u in db.query(Utilisateur).filter(Utilisateur.id.in_(auteurs_ids)).all()}
        if auteurs_ids else {}
    )
    for hs in historiques_suggestions:
        evenements.append(ActiviteAgenceItem(
            id=hs.id,
            date=hs.date_action,
            type_evenement=f"suggestion_{hs.nouveau_statut.value}",
            auteur_nom=auteurs.get(hs.utilisateur_id, "Système"),
            auteur_role=None,
            details=hs.commentaire,
        ))

    evenements.sort(key=lambda e: e.date, reverse=True)
    return evenements[:limit]
