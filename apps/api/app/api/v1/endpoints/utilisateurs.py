"""
Endpoints Utilisateurs — gestion par l'Administrateur et le CX Manager.
"""
import uuid
from uuid import UUID
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status, Query
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_cx_or_admin, get_current_active_user, get_db
from app.core.security import get_password_hash
from app.models.utilisateur import Utilisateur
from app.models.enums import UserRole
from app.schemas.mot_de_passe import exiger_mot_de_passe_acceptable
from app.services import journal_audit as journal
from app.services.administrateurs import controler_modification_compte, controler_retrait_compte
from app.services.comptes import normaliser_email
from app.schemas.utilisateur import UtilisateurCreate, UtilisateurUpdate, UtilisateurResponse
from app.services.acces_agence import verifier_agence_dans_organisation

router = APIRouter()

# Champs dont l'avant/après est écrit dans le journal d'audit (jamais le mot de passe ni son hachage).
CHAMPS_COMPTE_JOURNALISES = ("role", "active", "agence_id", "email")

MESSAGE_EMAIL_UTILISE = "Email déjà utilisé"
MESSAGE_AGENCE_OBLIGATOIRE = "Un compte responsable d'agence doit être rattaché à une agence de votre organisation."
MESSAGE_EMAIL_VIDE = "L'adresse e-mail ne peut pas être vide."
MESSAGE_DETACHEMENT_REFUSE = (
    "Un responsable d'agence ne peut pas être détaché de son agence : choisissez une autre agence de votre organisation."
)


def _email_deja_pris(db: Session, email: str, sauf_id=None) -> bool:
    """`email` déjà normalisé (sans espaces, en minuscules). Comparaison sans différence de casse, toutes organisations
    confondues (la connexion se fait par e-mail seul, sans casse : deux comptes ne peuvent pas ne différer que par la casse)."""
    requete = db.query(Utilisateur.id).filter(func.lower(Utilisateur.email) == email)
    if sauf_id is not None:
        requete = requete.filter(Utilisateur.id != sauf_id)
    return requete.first() is not None


def _enregistrer_compte(db: Session) -> None:
    """Commit ; une collision d'e-mail simultanée (contrainte d'unicité) donne la même erreur 400 que le contrôle préalable."""
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail=MESSAGE_EMAIL_UTILISE) from None


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
    request: Request = None,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_admin),
):
    """
    Crée un nouvel utilisateur :
    - Admin : peut uniquement créer des CX_MANAGER pour ses organisations.
    - CX Manager : peut uniquement créer des AGENCY_MANAGER pour son organisation.
    """
    email = normaliser_email(data.email)
    exiger_mot_de_passe_acceptable(data.password, email)
    if _email_deja_pris(db, email):
        raise HTTPException(status_code=400, detail=MESSAGE_EMAIL_UTILISE)

    # Vérification des rôles et organisation
    if current_user.role == UserRole.CX_MANAGER:
        if data.role != UserRole.AGENCY_MANAGER:
            raise HTTPException(status_code=403, detail="Un CX Manager ne peut créer que des comptes de responsable d'agence")
        target_org_id = current_user.organisation_id
        target_agence_id = data.agence_id
        # Un responsable d'agence sans agence n'accède à aucune donnée (403 partout) : rattachement obligatoire dès la création.
        if target_agence_id is None:
            raise HTTPException(status_code=422, detail=MESSAGE_AGENCE_OBLIGATOIRE)
        # Isolation : l'agence doit appartenir à l'organisation du CX Manager (jamais un
        # agence_id d'une autre organisation, même valide).
        verifier_agence_dans_organisation(db, target_agence_id, target_org_id)
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
        # L'Admin peut rattacher l'utilisateur à une agence, uniquement de l'organisation cible.
        target_agence_id = data.agence_id
        if target_agence_id is not None:
            verifier_agence_dans_organisation(db, target_agence_id, target_org_id)

    user = Utilisateur(
        id=uuid.uuid4(),
        organisation_id=target_org_id,
        nom=data.nom,
        prenom=data.prenom,
        email=email,
        mot_de_passe_hash=get_password_hash(data.password),
        role=data.role,
        agence_id=target_agence_id,
        created_by_id=current_user.id,
        active=True
    )
    db.add(user)
    # Journal d'audit : même transaction que la création (annulée avec elle si l'e-mail est déjà pris au moment de l'enregistrement).
    journal.journaliser(
        db, action=journal.COMPTE_CREE, acteur=current_user, cible_type="utilisateur", cible_id=user.id, cible_libelle=user.email,
        organisation_id=target_org_id, details={"role": data.role, "agence_id": target_agence_id}, requete=request,
    )
    _enregistrer_compte(db)
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
    request: Request = None,
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
    controler_modification_compte(db, user, updates, current_user, requete=request)   # après l'existence et l'appartenance
    if "email" in updates:
        if updates["email"] is None:
            raise HTTPException(status_code=422, detail=MESSAGE_EMAIL_VIDE)
        updates["email"] = normaliser_email(updates["email"])
        if _email_deja_pris(db, updates["email"], sauf_id=user.id):
            raise HTTPException(status_code=400, detail=MESSAGE_EMAIL_UTILISE)
    if updates.get("password") is not None:
        exiger_mot_de_passe_acceptable(updates["password"], updates.get("email") or user.email)
    if user.role == UserRole.AGENCY_MANAGER and "agence_id" in updates and updates["agence_id"] is None:
        raise HTTPException(status_code=422, detail=MESSAGE_DETACHEMENT_REFUSE)
    if "role" in updates:
        if current_user.role == UserRole.ADMIN and updates["role"] != UserRole.CX_MANAGER:
            raise HTTPException(status_code=403, detail="Modification de rôle non autorisée")
        elif current_user.role == UserRole.CX_MANAGER and updates["role"] != UserRole.AGENCY_MANAGER:
            raise HTTPException(status_code=403, detail="Modification de rôle non autorisée")
    # Isolation : réaffectation uniquement vers une agence de l'organisation de l'utilisateur
    # modifié (None = désaffectation, autorisée). L'organisation n'est jamais modifiable ici.
    if updates.get("agence_id") is not None:
        verifier_agence_dans_organisation(db, updates["agence_id"], user.organisation_id)
    if "password" in updates and updates["password"]:
        updates["mot_de_passe_hash"] = get_password_hash(updates.pop("password"))

    # Avant/après des seuls champs non secrets ; un mot de passe modifié n'est jamais écrit (seul le NOM du champ l'est).
    champs_modifies = sorted({"mot_de_passe" if c == "mot_de_passe_hash" else c for c in updates})
    avant = {c: getattr(user, c, None) for c in CHAMPS_COMPTE_JOURNALISES if c in updates}
    for field, value in updates.items():
        setattr(user, field, value)

    if champs_modifies:
        suspension = updates.get("active") is False
        journal.journaliser(
            db, action=journal.COMPTE_SUSPENDU if suspension else journal.COMPTE_MODIFIE, acteur=current_user, cible_type="utilisateur",
            cible_id=user.id, cible_libelle=user.email, organisation_id=user.organisation_id,
            details={"champs": champs_modifies, "avant": avant, "apres": {c: updates[c] for c in avant}}, requete=request,
        )
    _enregistrer_compte(db)
    db.refresh(user)
    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_utilisateur(
    user_id: UUID,
    request: Request = None,
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

    controler_retrait_compte(db, user, current_user, requete=request)   # après l'existence et l'appartenance
    avant_active = user.active
    user.active = False
    journal.journaliser(
        db, action=journal.COMPTE_SUSPENDU, acteur=current_user, cible_type="utilisateur", cible_id=user.id, cible_libelle=user.email,
        organisation_id=user.organisation_id, details={"avant": {"active": avant_active}, "apres": {"active": False}}, requete=request,
    )
    db.commit()
