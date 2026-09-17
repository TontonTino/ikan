"""
Endpoints Utilisateurs — gestion par l'Administrateur et le CX Manager.
"""
from uuid import UUID
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session

from app.api.deps import get_cx_or_admin, get_current_active_user, get_db
from app.core.security import get_password_hash
from app.models.utilisateur import Utilisateur
from app.models.enums import UserRole
from app.schemas.utilisateur import UtilisateurCreate, UtilisateurUpdate, UtilisateurResponse

router = APIRouter()


@router.get("/", response_model=List[UtilisateurResponse])
def list_utilisateurs(
    org_id: Optional[UUID] = None,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_admin),
):
    """
    Liste les utilisateurs selon le rôle :
    - Admin : uniquement les CX Managers qu'il a créés
    - CX Manager : uniquement les Agency Managers (Chefs d'agence) de son organisation
    """
    if current_user.role == UserRole.ADMIN:
        query = db.query(Utilisateur).filter(
            Utilisateur.role == UserRole.CX_MANAGER,
            (Utilisateur.created_by_id == current_user.id) | (Utilisateur.created_by_id.is_(None)),
        )
        if org_id:
            query = query.filter(Utilisateur.organisation_id == org_id)
        return query.all()
    else:
        # CX Manager : uniquement les Agency Managers de son organisation
        return db.query(Utilisateur).filter(
            Utilisateur.organisation_id == current_user.organisation_id,
            Utilisateur.role == UserRole.AGENCY_MANAGER,
        ).all()


@router.post("/", response_model=UtilisateurResponse, status_code=status.HTTP_201_CREATED)
def create_utilisateur(
    data: UtilisateurCreate,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_admin),
):
    """
    Crée un nouvel utilisateur :
    - Admin : peut uniquement créer des CX_MANAGER pour ses organisations.
    - CX Manager : peut uniquement créer des AGENCY_MANAGER pour son organisation.
    """
    existing = db.query(Utilisateur).filter(Utilisateur.email == data.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email déjà utilisé")

    # Vérification des rôles et organisation
    if current_user.role == UserRole.CX_MANAGER:
        if data.role != UserRole.AGENCY_MANAGER:
            raise HTTPException(status_code=403, detail="Un CX Manager ne peut créer que des comptes Agency Manager")
        target_org_id = current_user.organisation_id
        target_agence_id = data.agence_id
    else:
        # Admin
        if data.role != UserRole.CX_MANAGER:
            raise HTTPException(status_code=403, detail="Un Administrateur ne peut créer que des comptes CX Manager")
        if not data.organisation_id:
            raise HTTPException(status_code=400, detail="L'organisation est obligatoire pour créer un CX Manager")
        
        # Vérification que l'organisation a bien été créée par cet admin
        from app.models.organisation import Organisation
        org = db.query(Organisation).filter(
            Organisation.id == data.organisation_id,
            (Organisation.created_by_id == current_user.id) | (Organisation.created_by_id.is_(None))
        ).first()
        if not org:
            raise HTTPException(status_code=404, detail="Organisation introuvable ou non autorisée")
        
        target_org_id = data.organisation_id
        target_agence_id = None

    user = Utilisateur(
        organisation_id=target_org_id,
        nom=data.nom,
        prenom=data.prenom,
        email=data.email,
        mot_de_passe_hash=get_password_hash(data.password),
        role=data.role,
        agence_id=target_agence_id,
        created_by_id=current_user.id,
        active=True
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.get("/{user_id}", response_model=UtilisateurResponse)
def get_utilisateur(
    user_id: UUID,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_admin),
):
    query = db.query(Utilisateur).filter(Utilisateur.id == user_id)
    if current_user.role == UserRole.ADMIN:
        query = query.filter(
            Utilisateur.role == UserRole.CX_MANAGER,
            (Utilisateur.created_by_id == current_user.id) | (Utilisateur.created_by_id.is_(None))
        )
    elif current_user.role == UserRole.CX_MANAGER:
        query = query.filter(
            Utilisateur.organisation_id == current_user.organisation_id,
            Utilisateur.role == UserRole.AGENCY_MANAGER
        )
    
    user = query.first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    return user


@router.patch("/{user_id}", response_model=UtilisateurResponse)
def update_utilisateur(
    user_id: UUID,
    data: UtilisateurUpdate,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_admin),
):
    query = db.query(Utilisateur).filter(Utilisateur.id == user_id)
    if current_user.role == UserRole.ADMIN:
        query = query.filter(
            Utilisateur.role == UserRole.CX_MANAGER,
            (Utilisateur.created_by_id == current_user.id) | (Utilisateur.created_by_id.is_(None))
        )
    elif current_user.role == UserRole.CX_MANAGER:
        query = query.filter(
            Utilisateur.organisation_id == current_user.organisation_id,
            Utilisateur.role == UserRole.AGENCY_MANAGER
        )

    user = query.first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")

    updates = data.model_dump(exclude_unset=True)
    if "role" in updates:
        if current_user.role == UserRole.ADMIN and updates["role"] != UserRole.CX_MANAGER:
            raise HTTPException(status_code=403, detail="Modification de rôle non autorisée")
        elif current_user.role == UserRole.CX_MANAGER and updates["role"] != UserRole.AGENCY_MANAGER:
            raise HTTPException(status_code=403, detail="Modification de rôle non autorisée")
    if "password" in updates and updates["password"]:
        updates["mot_de_passe_hash"] = get_password_hash(updates.pop("password"))

    for field, value in updates.items():
        setattr(user, field, value)

    db.commit()
    db.refresh(user)
    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_utilisateur(
    user_id: UUID,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_admin),
):
    """Désactive un utilisateur (Soft Delete — active = False)."""
    query = db.query(Utilisateur).filter(Utilisateur.id == user_id)
    if current_user.role == UserRole.ADMIN:
        query = query.filter(
            Utilisateur.role == UserRole.CX_MANAGER,
            (Utilisateur.created_by_id == current_user.id) | (Utilisateur.created_by_id.is_(None))
        )
    elif current_user.role == UserRole.CX_MANAGER:
        query = query.filter(
            Utilisateur.organisation_id == current_user.organisation_id,
            Utilisateur.role == UserRole.AGENCY_MANAGER
        )

    user = query.first()
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    
    user.active = False
    db.commit()
