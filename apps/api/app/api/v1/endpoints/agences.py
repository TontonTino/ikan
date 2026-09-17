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
from app.models.enums import UserRole
from app.schemas.agence import AgenceCreate, AgenceUpdate, AgenceResponse

router = APIRouter()


def _check_agence_access(agence: Agence, current_user: Utilisateur):
    if current_user.role == UserRole.CX_MANAGER and agence.organisation_id == current_user.organisation_id:
        return
    if current_user.role == UserRole.AGENCY_MANAGER and agence.id == current_user.agence_id:
        return
    raise HTTPException(status_code=403, detail="Accès refusé à cette agence. La gestion des agences est réservée au CX Manager.")


def _enrich_agence_qr(agence: Agence, db: Session) -> AgenceResponse:
    """Attache le token QR et l'URL du QR Code actif à la réponse Agence."""
    res = AgenceResponse.model_validate(agence)
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
