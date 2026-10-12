"""
Endpoints QR Codes — génération et gestion.
"""
import uuid
from uuid import UUID
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
import io
import logging

from app.api.deps import get_admin_user, get_db
from app.models.utilisateur import Utilisateur
from app.models.qr_code import QRCode
from app.models.agence import Agence
from app.core.config import settings
from app.schemas.categorie import CategoriePublicResponse
from app.models.categorie import Categorie
from app.models.system_settings import SystemSettings, RETENTION_MOIS_DEFAUT
from app.core.rate_limit import limiter_ip_public, limiter_suggestion
from app.models.enums import IdeaStatus
from app.models.suggestion import Suggestion
from app.schemas.suggestion import SuggestionCreate, SuggestionSoumiseResponse

logger = logging.getLogger(__name__)

router = APIRouter()

CLIENT_BASE_URL = settings.PUBLIC_CLIENT_URL.rstrip("/")


def _resolve_qr(clean_code: str, db: Session) -> QRCode | None:
    """
    Résout un code QR à partir d'un code exact ou de l'UUID d'une agence. LECTURE SEULE : ne crée jamais de QR code
    (un lien par UUID vers une agence sans QR répond 404 ; le QR est créé par une action authentifiée, voir
    agences._enrich_agence_qr). Le QR doit être actif ET son agence aussi, sur toutes les voies (code et UUID).
    Logique partagée par /validate, /categories et POST /feedbacks.
    """
    from sqlalchemy import func

    qr = (
        db.query(QRCode)
        .join(Agence, Agence.id == QRCode.agence_id)
        .filter(
            func.lower(QRCode.code) == clean_code.lower(),
            QRCode.actif == True,  # noqa: E712
            Agence.active == True,  # noqa: E712
        )
        .first()
    )
    if qr:
        return qr

    # Repli par UUID d'agence : légitime (liens générés par le dashboard sous la forme
    # /feedback/{qr_code_token || agence.id}) et non énumérable (UUID aléatoire).
    try:
        possible_uuid = UUID(clean_code)
    except ValueError:
        possible_uuid = None
    if possible_uuid is not None:
        return (
            db.query(QRCode)
            .join(Agence, Agence.id == QRCode.agence_id)
            .filter(
                Agence.id == possible_uuid,
                Agence.active == True,  # noqa: E712
                QRCode.actif == True,  # noqa: E712
            )
            .first()
        )

    # SÉCURITÉ (5B-1) : plus de résolution par nom ou ville d'agence (recherche ILIKE sur
    # TOUTES les organisations). Elle permettait à un anonyme d'énumérer les agences de
    # tous les clients et d'obtenir leurs catégories pour leur soumettre des feedbacks.
    # Aucun lien généré par l'application n'utilise ce format.
    return None


@router.get("/ping")
def ping_qr_codes():
    return {"status": "pong"}


@router.get("/public-agences")
def list_public_agences(
    db: Session = Depends(get_db),
    _: Utilisateur = Depends(get_admin_user),
):
    """
    Liste des agences actives et de leurs QR Codes — RÉSERVÉE À L'ADMIN (5B-1).

    Anciennement publique : elle exposait sans authentification les agences (et leurs
    UUID) de toutes les organisations. Aucun consommateur dans l'application (le parcours
    client résout un seul QR via /qr-codes/{code}/validate). Conservée pour l'Admin, qui
    a déjà une vue structurelle de toutes les organisations.
    """
    agences = db.query(Agence).filter(Agence.active == True).all()
    result = []
    base_url = settings.PUBLIC_CLIENT_URL.rstrip("/")
    for a in agences:
        qr = db.query(QRCode).filter(QRCode.agence_id == a.id, QRCode.actif == True).first()
        if not qr:
            clean_name = a.nom.upper().replace(" ", "-")[:12]
            code_str = f"QR-{clean_name}-{uuid.uuid4().hex[:6].upper()}"
            qr = QRCode(
                id=uuid.uuid4(),
                agence_id=a.id,
                code=code_str,
                url=f"{base_url}/feedback/{code_str}",
                label=f"Borne Accueil - {a.nom}",
                actif=True
            )
            db.add(qr)
            db.commit()
            db.refresh(qr)
        result.append({
            "id": str(a.id),
            "nom": a.nom,
            "ville": a.ville,
            "qr_code": qr.code,
            "url": f"{base_url}/feedback/{qr.code}",
        })
    return result



class QRCodeResponse(BaseModel):
    id: uuid.UUID
    agence_id: uuid.UUID
    code: str
    url: str
    label: str | None
    actif: bool

    model_config = {"from_attributes": True}


class QRCodeCreate(BaseModel):
    label: str | None = None


@router.post("/agences/{agence_id}", response_model=QRCodeResponse, status_code=201)
def create_qr_code(
    agence_id: UUID,
    data: QRCodeCreate,
    db: Session = Depends(get_db),
    _: Utilisateur = Depends(get_admin_user),
):
    """Génère un QR Code pour une agence."""
    agence = db.query(Agence).filter(Agence.id == agence_id).first()
    if not agence:
        raise HTTPException(status_code=404, detail="Agence introuvable")

    code = str(uuid.uuid4()).replace("-", "")[:16].upper()
    url = f"{CLIENT_BASE_URL}/feedback/{code}"

    qr = QRCode(
        agence_id=agence_id,
        code=code,
        url=url,
        label=data.label,
    )
    db.add(qr)
    db.commit()
    db.refresh(qr)
    return qr


@router.get("/agences/{agence_id}", response_model=List[QRCodeResponse])
def list_qr_codes(
    agence_id: UUID,
    db: Session = Depends(get_db),
    _: Utilisateur = Depends(get_admin_user),
):
    return db.query(QRCode).filter(QRCode.agence_id == agence_id).all()


def _retention_mois(db: Session) -> int:
    """Durée de conservation configurée (SystemSettings.retention_mois), lue sans jamais écrire : sans ligne de
    configuration, valeur par défaut du modèle."""
    ligne = db.query(SystemSettings).first()
    if ligne is not None and ligne.retention_mois:
        return ligne.retention_mois
    return RETENTION_MOIS_DEFAUT


@router.get("/{code}/validate", dependencies=[Depends(limiter_ip_public)])
def validate_qr_code(
    code: str,
    db: Session = Depends(get_db),
):
    """
    Valide un code QR et retourne les infos de l'agence. LECTURE SEULE (aucune écriture en base).
    Endpoint public — appelé par la page Astro client. 404 si le QR est inconnu, inactif, ou si son agence est désactivée.
    `retention_mois` : durée de conservation affichée dans la case de consentement du formulaire.
    """
    try:
        clean_code = code.strip()
        qr = _resolve_qr(clean_code, db)

        if not qr:
            raise HTTPException(status_code=404, detail="QR Code ou agence introuvable ou inactif")

        agence_nom = qr.agence.nom if (qr and qr.agence) else "Agence"
        ville = qr.agence.ville if (qr and qr.agence) else None

        return {
            "qr_code_id": str(qr.id),
            "agence_id": str(qr.agence_id),
            "agence_nom": agence_nom,
            "ville": ville,
            "label": qr.label,
            "retention_mois": _retention_mois(db),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Erreur validate_qr_code (%s)", type(e).__name__)
        raise HTTPException(status_code=500, detail="Erreur serveur lors de la validation du QR code.")


@router.get("/{code}/categories", response_model=List[CategoriePublicResponse], dependencies=[Depends(limiter_ip_public)])
def get_categories_for_qr(
    code: str,
    db: Session = Depends(get_db),
):
    """
    Retourne les catégories actives de l'agence rattachée à ce QR Code. LECTURE SEULE.
    Endpoint public — appelé par le formulaire de feedback client (aucune authentification).
    La catégorie « Général » n'est plus créée ici : elle l'est à la création de l'agence ou à la consultation
    authentifiée de ses catégories (voir categorie_service.get_or_create_categories_actives).
    """
    clean_code = code.strip()
    qr = _resolve_qr(clean_code, db)
    if not qr:
        raise HTTPException(status_code=404, detail="QR Code ou agence introuvable ou inactif")

    return (
        db.query(Categorie)
        .filter(Categorie.agence_id == qr.agence_id, Categorie.active == True)  # noqa: E712
        .order_by(Categorie.created_at.asc())
        .all()
    )


@router.post(
    "/{code}/suggestions",
    response_model=SuggestionSoumiseResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(limiter_suggestion)],
)
def soumettre_suggestion(
    code: str,
    data: SuggestionCreate,
    db: Session = Depends(get_db),
):
    """
    « Partager une idée » — endpoint PUBLIC (aucune authentification, aucun contact demandé).

    La suggestion est rattachée DIRECTEMENT à l'agence du QR scanné (statut « Nouveau ») et ne crée AUCUN feedback :
    ni note fictive, ni analyse IA, ni ligne dans le CSAT, FEEDBACK_VOLUME ou le quota mensuel du forfait.
    Mêmes protections que l'envoi d'un avis : limitation de débit par IP et par QR (avant toute lecture en base),
    champ piège, plafond du corps, 404 si le QR est inconnu/inactif ou si l'agence est désactivée.
    Pas de clé d'idempotence : le bouton du formulaire est verrouillé pendant l'envoi.
    """
    # Champ piège : réponse de succès identique, rien n'est enregistré.
    if data.website and data.website.strip():
        return SuggestionSoumiseResponse()

    qr = _resolve_qr(code.strip(), db)
    if not qr:
        raise HTTPException(status_code=404, detail="QR Code ou agence introuvable ou inactif")

    try:
        db.add(Suggestion(agence_id=qr.agence_id, feedback_id=None, contenu=data.contenu, statut=IdeaStatus.NOUVEAU))
        db.commit()
    except Exception as e:
        db.rollback()
        # Ni l'objet exception ni le texte de l'idée dans les journaux.
        logger.error("Erreur soumettre_suggestion (qr=%s, %s)", qr.id, type(e).__name__)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Votre idée n'a pas pu être enregistrée. Veuillez réessayer.",
        )
    return SuggestionSoumiseResponse()


@router.delete("/{qr_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_qr_code(
    qr_id: UUID,
    db: Session = Depends(get_db),
    _: Utilisateur = Depends(get_admin_user),
):
    qr = db.query(QRCode).filter(QRCode.id == qr_id).first()
    if not qr:
        raise HTTPException(status_code=404, detail="QR Code introuvable")
    db.delete(qr)
    db.commit()
