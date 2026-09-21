"""
Endpoints CRUD Organisations — réservés exclusivement au rôle Administrateur (RBAC).
"""
from uuid import UUID
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_admin_user, get_cx_manager, get_db
from app.core.config import settings
from app.models.changement_plan import ChangementPlan
from app.models.plan import Plan
from app.models.utilisateur import Utilisateur
from app.models.organisation import Organisation
from app.schemas.organisation import (
    OrganisationCreate, OrganisationUpdate, OrganisationRead, UtilisationOrganisation,
    UpgradeCheckoutRequest, UpgradeCheckoutResponse, ChangementPlanRequest,
)
from app.services.plan_catalog import STRIPE_PRICE_IDS
from app.services.plan_service import utilisation_organisation

router = APIRouter()


@router.get("/moi/utilisation", response_model=UtilisationOrganisation)
def utilisation_mon_organisation(
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_manager),
):
    """Forfait, quotas en temps réel et fonctionnalités de l'organisation du CX Manager connecté.
    Purement informatif : ne bloque jamais la création d'une agence, d'un compte ou d'un feedback."""
    if not current_user.organisation_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Aucune organisation rattachée")
    return utilisation_organisation(db, current_user.organisation_id)


@router.post("/moi/upgrade-checkout", response_model=UpgradeCheckoutResponse)
def creer_session_checkout(
    data: UpgradeCheckoutRequest,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_manager),
):
    """
    Crée une session Stripe Checkout en libre-service pour passer au forfait Starter ou Pro
    (Entreprise reste sur devis manuel, non exposé ici). Récupère ou crée le Customer Stripe
    de l'organisation au passage. Ne modifie jamais plan_id directement — c'est le webhook
    Stripe (Phase 2) qui le fera après confirmation réelle du paiement.
    """
    if not current_user.organisation_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Aucune organisation rattachée")

    price_id = STRIPE_PRICE_IDS.get(data.plan_code)
    if not settings.STRIPE_SECRET_KEY or not price_id:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Le paiement en ligne n'est pas configuré pour le moment. Contactez le support.",
        )

    org = db.query(Organisation).filter(Organisation.id == current_user.organisation_id).first()
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organisation introuvable")

    import stripe
    stripe.api_key = settings.STRIPE_SECRET_KEY

    try:
        if not org.stripe_customer_id:
            customer = stripe.Customer.create(
                email=org.email_pro,
                name=org.nom,
                metadata={"organisation_id": str(org.id)},
            )
            org.stripe_customer_id = customer.id
            db.commit()

        session = stripe.checkout.Session.create(
            mode="subscription",
            customer=org.stripe_customer_id,
            line_items=[{"price": price_id, "quantity": 1}],
            success_url=f"{settings.PUBLIC_DASHBOARD_URL}/?checkout=success",
            cancel_url=f"{settings.PUBLIC_DASHBOARD_URL}/?checkout=cancel",
            metadata={"organisation_id": str(org.id), "plan_code": data.plan_code},
        )
    except stripe.error.StripeError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Erreur Stripe : {getattr(exc, 'user_message', None) or str(exc)}",
        )

    return {"checkout_url": session.url}


@router.get("/", response_model=List[OrganisationRead])
def list_organisations(
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_admin_user),
):
    """Liste les organisations créées par l'Admin connecté."""
    try:
        return (
            db.query(Organisation)
            .filter((Organisation.created_by_id == current_user.id) | (Organisation.created_by_id.is_(None)))
            .order_by(Organisation.created_at.desc())
            .all()
        )
    except Exception:
        return (
            db.query(Organisation)
            .filter((Organisation.created_by_id == current_user.id) | (Organisation.created_by_id.is_(None)))
            .all()
        )


@router.post("/", response_model=OrganisationRead, status_code=status.HTTP_201_CREATED)
def create_organisation(
    data: OrganisationCreate,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_admin_user),
):
    """Crée une nouvelle organisation (Réservé au rôle Admin)."""
    # Vérification de l'unicité de l'email professionnel
    existing = db.query(Organisation).filter(
        (Organisation.email_pro == data.email_pro) | (Organisation.email == data.email_pro)
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Une organisation avec l'email professionnel '{data.email_pro}' existe déjà."
        )

    org_data = data.model_dump()
    org_data["email"] = data.email_pro
    org_data["secteur"] = data.secteur_activite
    org_data["created_by_id"] = current_user.id

    org = Organisation(**org_data)
    db.add(org)
    db.commit()
    db.refresh(org)
    return org


@router.get("/{org_id}", response_model=OrganisationRead)
def get_organisation(
    org_id: UUID,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_admin_user),
):
    """Obtient le détail d'une organisation par son ID (Réservé au rôle Admin créateur)."""
    org = db.query(Organisation).filter(
        Organisation.id == org_id,
        (Organisation.created_by_id == current_user.id) | (Organisation.created_by_id.is_(None))
    ).first()
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organisation introuvable")
    return org


@router.patch("/{org_id}", response_model=OrganisationRead)
def update_organisation(
    org_id: UUID,
    data: OrganisationUpdate,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_admin_user),
):
    """Met à jour partiellement une organisation (Réservé au rôle Admin créateur)."""
    org = db.query(Organisation).filter(
        Organisation.id == org_id,
        (Organisation.created_by_id == current_user.id) | (Organisation.created_by_id.is_(None))
    ).first()
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organisation introuvable")

    # Si l'email pro est modifié, vérifier qu'il reste unique
    if data.email_pro and data.email_pro != org.email_pro:
        dup = db.query(Organisation).filter(
            (Organisation.email_pro == data.email_pro) | (Organisation.email == data.email_pro),
            Organisation.id != org_id
        ).first()
        if dup:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"L'email professionnel '{data.email_pro}' est déjà utilisé par une autre organisation."
            )

    update_dict = data.model_dump(exclude_unset=True)
    if "email_pro" in update_dict:
        update_dict["email"] = update_dict["email_pro"]
    if "secteur_activite" in update_dict:
        update_dict["secteur"] = update_dict["secteur_activite"]

    for field, value in update_dict.items():
        setattr(org, field, value)

    db.commit()
    db.refresh(org)
    return org


@router.patch("/{org_id}/plan", response_model=OrganisationRead)
def changer_plan_organisation(
    org_id: UUID,
    data: ChangementPlanRequest,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_admin_user),
):
    """
    Override manuel du forfait (Réservé au rôle Admin créateur, réservé aux cas
    exceptionnels — partenariat négocié, etc.). Raison obligatoire (min. 10
    caractères), tracée dans changements_plan avec source="admin_override" et
    l'identité de l'Admin qui a fait le changement.
    """
    org = db.query(Organisation).filter(
        Organisation.id == org_id,
        (Organisation.created_by_id == current_user.id) | (Organisation.created_by_id.is_(None))
    ).first()
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organisation introuvable")

    plan = db.query(Plan).filter(Plan.id == data.plan_id).first()
    if not plan:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Forfait introuvable")

    ancien_plan_id = org.plan_id
    org.plan_id = data.plan_id

    if ancien_plan_id != data.plan_id:
        db.add(ChangementPlan(
            organisation_id=org.id,
            ancien_plan_id=ancien_plan_id,
            nouveau_plan_id=data.plan_id,
            raison=data.raison,
            modifie_par_id=current_user.id,
            source="admin_override",
        ))

    db.commit()
    db.refresh(org)
    return org


@router.delete("/{org_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_organisation(
    org_id: UUID,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_admin_user),
):
    """Supprime une organisation (Réservé au rôle Admin créateur)."""
    org = db.query(Organisation).filter(
        Organisation.id == org_id,
        (Organisation.created_by_id == current_user.id) | (Organisation.created_by_id.is_(None))
    ).first()
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organisation introuvable")
    
    db.delete(org)
    db.commit()
