"""
Endpoints Feedbacks — soumission par les clients (anonyme) et workflow de traitement Closed-Loop (RBAC strict).
"""
import logging
import uuid
from uuid import UUID
from typing import List, Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status, Query, BackgroundTasks
from sqlalchemy.orm import Session, joinedload

logger = logging.getLogger(__name__)

from app.api.deps import (
    get_current_active_user,
    get_cx_or_agency_manager,
    get_feedback_viewer_user,
    get_db,
)
from app.models.utilisateur import Utilisateur
from app.models.feedback import Feedback
from app.models.qr_code import QRCode
from app.models.agence import Agence
from app.models.suggestion import Suggestion
from app.models.demande_contact import DemandeContact
from app.models.historique_feedback import HistoriqueFeedback
from app.models.reponse_client import ReponseClient
from app.models.enums import UserRole
from app.schemas.feedback import (
    FeedbackCreate,
    FeedbackResponse,
    HistoriqueFeedbackResponse,
    ReponseClientResponse,
    NoteInterneCreate,
    SuggestionAgenceCreate,
    ActionCXCreate,
    ReponseClientCreate,
)
from app.services.ai.analyse_service import analyser_feedback
from app.core.config import settings

router = APIRouter()


def _format_feedback_response(f: Feedback) -> FeedbackResponse:
    """Transforme une entité Feedback SQLAlchemy en schéma Pydantic FeedbackResponse complet."""
    res = FeedbackResponse.model_validate(f)
    if f.qr_code and f.qr_code.agence:
        res.agence_id = f.qr_code.agence_id
        res.agence_nom = f.qr_code.agence.nom
    if f.assigne_a:
        res.assigne_a_nom = f"{f.assigne_a.prenom} {f.assigne_a.nom}"
    return res


def _check_feedback_access(feedback: Feedback, user: Utilisateur) -> None:
    """Vérifie que l'utilisateur a accès au feedback selon son périmètre RBAC."""
    if not feedback.qr_code:
        return
    if user.role == UserRole.AGENCY_MANAGER:
        if feedback.qr_code.agence_id != user.agence_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accès refusé à ce feedback hors de votre agence")
    elif user.role == UserRole.CX_MANAGER:
        if user.organisation_id and feedback.qr_code.agence:
            if feedback.qr_code.agence.organisation_id != user.organisation_id:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accès refusé à ce feedback hors de votre organisation")


@router.post("/", response_model=FeedbackResponse, status_code=status.HTTP_201_CREATED)
def submit_feedback(
    qr_code: str,
    data: FeedbackCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """
    Soumet un feedback client — endpoint PUBLIC (pas d'authentification requise).
    Déclenche l'analyse IA synchrone.
    """
    from sqlalchemy import func
    clean_code = qr_code.strip()
    qr = db.query(QRCode).filter(
        func.lower(QRCode.code) == clean_code.lower(),
        QRCode.actif == True,
    ).first()

    if not qr:
        try:
            possible_uuid = UUID(clean_code)
            agence = db.query(Agence).filter(Agence.id == possible_uuid).first()
            if agence:
                qr = db.query(QRCode).filter(QRCode.agence_id == agence.id, QRCode.actif == True).first()
                if not qr:
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
                    db.refresh(qr)
        except ValueError:
            pass
        if not qr:
            agence = db.query(Agence).filter(
                (func.lower(Agence.nom).ilike(f"%{clean_code.lower()}%")) |
                (func.lower(Agence.ville).ilike(f"%{clean_code.lower()}%"))
            ).first()
            if agence:
                qr = db.query(QRCode).filter(QRCode.agence_id == agence.id, QRCode.actif == True).first()

        if not qr:
            raise HTTPException(status_code=404, detail=f"QR Code ou Agence '{clean_code}' invalide ou inactif")

    try:
        note_val = data.note
        if note_val is None:
            if data.sentiment:
                s = data.sentiment.lower().strip()
                if "negatif" in s or "negative" in s:
                    note_val = 1
                elif "positif" in s or "positive" in s:
                    note_val = 5
                else:
                    note_val = 3
            else:
                note_val = 3

        feedback = Feedback(
            qr_code_id=qr.id,
            note=note_val,
            commentaire=data.commentaire,
            statut_traitement="nouveau",
        )
        db.add(feedback)
        db.flush()

        if data.suggestion:
            suggestion = Suggestion(
                feedback_id=feedback.id,
                contenu=data.suggestion,
            )
            db.add(suggestion)

        if data.souhaite_etre_rappele or data.contact_email:
            contact = DemandeContact(
                feedback_id=feedback.id,
                nom=data.contact_nom,
                telephone=data.contact_telephone,
                email=data.contact_email,
                souhaite_etre_rappele=data.souhaite_etre_rappele,
            )
            db.add(contact)

        # Événement initial d'historique
        hist_init = HistoriqueFeedback(
            feedback_id=feedback.id,
            auteur_nom="Client (Borne)",
            auteur_role="client",
            agence_nom=qr.agence.nom if qr.agence else None,
            type_evenement="soumission",
            ancien_statut=None,
            nouveau_statut="nouveau",
            details=f"Feedback soumis (Note {note_val}/5)",
        )
        db.add(hist_init)

        db.commit()
        db.refresh(feedback)

        # Analyse IA synchrone
        try:
            analyser_feedback(feedback.id, db)
            db.expire_all()
            db.refresh(feedback)
        except Exception as ai_err:
            logger.error(f"Erreur lors de l'analyse IA synchrone du feedback {feedback.id}: {ai_err}")

        return _format_feedback_response(feedback)
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        logger.error(f"Erreur submit_feedback: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Erreur serveur submit_feedback: {str(e)}"
        )


@router.get("/", response_model=List[FeedbackResponse])
def list_feedbacks(
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_feedback_viewer_user),
    agence_id: Optional[UUID] = Query(None),
    statut: Optional[str] = Query(None),
    date_debut: Optional[datetime] = Query(None),
    date_fin: Optional[datetime] = Query(None),
    limit: int = Query(250, le=1000),
    offset: int = Query(0),
):
    """
    Liste les feedbacks pour CX Manager et Agency Manager.
    Périmètre filtré strictement côté backend selon le RBAC.
    """
    query = (
        db.query(Feedback)
        .options(
            joinedload(Feedback.analyse_ia),
            joinedload(Feedback.demande_contact),
            joinedload(Feedback.suggestion),
            joinedload(Feedback.assigne_a),
            joinedload(Feedback.qr_code).joinedload(QRCode.agence),
        )
        .join(QRCode, Feedback.qr_code_id == QRCode.id)
    )

    if current_user.role == UserRole.AGENCY_MANAGER:
        query = query.filter(QRCode.agence_id == current_user.agence_id)
    elif current_user.role == UserRole.CX_MANAGER:
        if current_user.organisation_id:
            query = query.join(Agence, QRCode.agence_id == Agence.id).filter(
                Agence.organisation_id == current_user.organisation_id
            )
        if agence_id:
            query = query.filter(QRCode.agence_id == agence_id)

    if statut:
        query = query.filter(Feedback.statut_traitement == statut)
    if date_debut:
        query = query.filter(Feedback.date_soumission >= date_debut)
    if date_fin:
        query = query.filter(Feedback.date_soumission <= date_fin)

    feedbacks = query.order_by(Feedback.date_soumission.desc()).offset(offset).limit(limit).all()

    return [_format_feedback_response(f) for f in feedbacks]


@router.get("/{feedback_id}", response_model=FeedbackResponse)
def get_feedback(
    feedback_id: UUID,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_feedback_viewer_user),
):
    """Obtient le détail d'un feedback avec son statut et ses relations."""
    feedback = (
        db.query(Feedback)
        .options(
            joinedload(Feedback.analyse_ia),
            joinedload(Feedback.demande_contact),
            joinedload(Feedback.suggestion),
            joinedload(Feedback.assigne_a),
            joinedload(Feedback.qr_code).joinedload(QRCode.agence),
        )
        .filter(Feedback.id == feedback_id)
        .first()
    )
    if not feedback:
        raise HTTPException(status_code=404, detail="Feedback introuvable")

    _check_feedback_access(feedback, current_user)

    if not feedback.analyse_ia:
        try:
            analyser_feedback(feedback.id, db)
            db.refresh(feedback)
        except Exception as e:
            logger.warning(f"Auto-analyse fallback pour feedback {feedback.id}: {e}")

    return _format_feedback_response(feedback)


@router.post("/{feedback_id}/open", response_model=FeedbackResponse)
def open_feedback(
    feedback_id: UUID,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
):
    """
    Action automatique lors de l'ouverture du feedback dans la modale :
    Si le statut est 'nouveau', passe automatiquement à 'en_traitement',
    assigne le feedback à l'utilisateur connecté et enregistre l'événement dans l'historique.
    """
    feedback = (
        db.query(Feedback)
        .options(
            joinedload(Feedback.analyse_ia),
            joinedload(Feedback.demande_contact),
            joinedload(Feedback.qr_code).joinedload(QRCode.agence),
            joinedload(Feedback.assigne_a),
        )
        .filter(Feedback.id == feedback_id)
        .first()
    )
    if not feedback:
        raise HTTPException(status_code=404, detail="Feedback introuvable")

    _check_feedback_access(feedback, current_user)

    # Transition automatique Nouveau -> En traitement
    if feedback.statut_traitement == "nouveau":
        feedback.statut_traitement = "en_traitement"
        feedback.assigne_a_id = current_user.id
        feedback.date_assignation = datetime.now()

        hist = HistoriqueFeedback(
            feedback_id=feedback.id,
            utilisateur_id=current_user.id,
            auteur_nom=f"{current_user.prenom} {current_user.nom}",
            auteur_role=current_user.role.value,
            agence_nom=feedback.qr_code.agence.nom if (feedback.qr_code and feedback.qr_code.agence) else None,
            type_evenement="ouverture",
            ancien_statut="nouveau",
            nouveau_statut="en_traitement",
            details="Feedback ouvert pour prise en charge",
        )
        db.add(hist)
        db.commit()
        db.refresh(feedback)

    return _format_feedback_response(feedback)


@router.post("/{feedback_id}/notes", response_model=FeedbackResponse)
def add_note_interne(
    feedback_id: UUID,
    data: NoteInterneCreate,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
):
    """
    Ajoute un commentaire / note interne confidentielle.
    Enregistré dans l'historique d'audit horodaté.
    """
    feedback = db.query(Feedback).filter(Feedback.id == feedback_id).first()
    if not feedback:
        raise HTTPException(status_code=404, detail="Feedback introuvable")

    _check_feedback_access(feedback, current_user)

    hist = HistoriqueFeedback(
        feedback_id=feedback.id,
        utilisateur_id=current_user.id,
        auteur_nom=f"{current_user.prenom} {current_user.nom}",
        auteur_role=current_user.role.value,
        agence_nom=feedback.qr_code.agence.nom if (feedback.qr_code and feedback.qr_code.agence) else None,
        type_evenement="note_interne",
        ancien_statut=feedback.statut_traitement,
        nouveau_statut=feedback.statut_traitement,
        details=data.texte.strip(),
    )
    db.add(hist)
    db.commit()
    db.refresh(feedback)

    return _format_feedback_response(feedback)


@router.post("/{feedback_id}/suggestion-agence", response_model=FeedbackResponse)
def envoyer_suggestion_agence(
    feedback_id: UUID,
    data: SuggestionAgenceCreate,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
):
    """
    Agency Manager : Propose une solution / suggestion d'amélioration au CX Manager.
    Le statut reste 'en_traitement' et l'événement est tracé dans l'historique.
    """
    if current_user.role != UserRole.AGENCY_MANAGER and current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Seul un Agency Manager peut soumettre une suggestion au CX")

    feedback = db.query(Feedback).filter(Feedback.id == feedback_id).first()
    if not feedback:
        raise HTTPException(status_code=404, detail="Feedback introuvable")

    _check_feedback_access(feedback, current_user)

    now = datetime.now()
    auteur = f"{current_user.prenom} {current_user.nom}"
    feedback.suggestion_agence = data.suggestion.strip()
    feedback.suggestion_agence_auteur = auteur
    feedback.suggestion_agence_date = now

    hist = HistoriqueFeedback(
        feedback_id=feedback.id,
        utilisateur_id=current_user.id,
        auteur_nom=auteur,
        auteur_role=current_user.role.value,
        agence_nom=feedback.qr_code.agence.nom if (feedback.qr_code and feedback.qr_code.agence) else None,
        type_evenement="suggestion_envoyee",
        ancien_statut=feedback.statut_traitement,
        nouveau_statut=feedback.statut_traitement,
        details=data.suggestion.strip(),
    )
    db.add(hist)
    db.commit()
    db.refresh(feedback)

    return _format_feedback_response(feedback)


@router.post("/{feedback_id}/action-cx", response_model=FeedbackResponse)
def definir_action_cx(
    feedback_id: UUID,
    data: ActionCXCreate,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
):
    """
    CX Manager uniquement : Définit l'action corrective à entreprendre.
    Transition automatique du statut : En traitement -> En cours.
    Trace l'action dans l'historique.
    """
    if current_user.role != UserRole.CX_MANAGER and current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Seul le CX Manager peut définir une Action à prendre")

    feedback = db.query(Feedback).filter(Feedback.id == feedback_id).first()
    if not feedback:
        raise HTTPException(status_code=404, detail="Feedback introuvable")

    _check_feedback_access(feedback, current_user)

    ancien_statut = feedback.statut_traitement
    feedback.action_a_prendre = data.action.strip()
    feedback.action_realisee = False
    feedback.statut_traitement = "en_cours"

    hist = HistoriqueFeedback(
        feedback_id=feedback.id,
        utilisateur_id=current_user.id,
        auteur_nom=f"{current_user.prenom} {current_user.nom}",
        auteur_role=current_user.role.value,
        agence_nom=feedback.qr_code.agence.nom if (feedback.qr_code and feedback.qr_code.agence) else None,
        type_evenement="action_definie",
        ancien_statut=ancien_statut,
        nouveau_statut="en_cours",
        details=data.action.strip(),
    )
    db.add(hist)
    db.commit()
    db.refresh(feedback)

    return _format_feedback_response(feedback)


@router.post("/{feedback_id}/confirmer-action", response_model=FeedbackResponse)
def confirmer_action_realisee(
    feedback_id: UUID,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
):
    """
    CX Manager uniquement : Confirme que l'action a été réalisée sur le terrain.
    Transition automatique du statut : En cours -> Résolu.
    Trace la résolution dans l'historique.
    """
    if current_user.role != UserRole.CX_MANAGER and current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Seul le CX Manager peut confirmer une action et résoudre un feedback")

    feedback = db.query(Feedback).filter(Feedback.id == feedback_id).first()
    if not feedback:
        raise HTTPException(status_code=404, detail="Feedback introuvable")

    _check_feedback_access(feedback, current_user)

    ancien_statut = feedback.statut_traitement
    feedback.action_realisee = True
    feedback.statut_traitement = "resolu"
    feedback.date_resolution = datetime.now()

    hist = HistoriqueFeedback(
        feedback_id=feedback.id,
        utilisateur_id=current_user.id,
        auteur_nom=f"{current_user.prenom} {current_user.nom}",
        auteur_role=current_user.role.value,
        agence_nom=feedback.qr_code.agence.nom if (feedback.qr_code and feedback.qr_code.agence) else None,
        type_evenement="action_realisee",
        ancien_statut=ancien_statut,
        nouveau_statut="resolu",
        details=feedback.action_a_prendre or "Action corrective réalisée sur le terrain",
    )
    db.add(hist)
    db.commit()
    db.refresh(feedback)

    return _format_feedback_response(feedback)


@router.post("/{feedback_id}/reponses-client", response_model=List[ReponseClientResponse])
def envoyer_reponse_client(
    feedback_id: UUID,
    data: ReponseClientCreate,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
):
    """
    Enregistre une réponse adressée au client (Téléphone, Email, WhatsApp, SMS).
    Inscrit la réponse dans le fil de conversation et dans l'historique d'audit.
    """
    feedback = db.query(Feedback).filter(Feedback.id == feedback_id).first()
    if not feedback:
        raise HTTPException(status_code=404, detail="Feedback introuvable")

    _check_feedback_access(feedback, current_user)

    auteur = f"{current_user.prenom} {current_user.nom}"
    reponse = ReponseClient(
        feedback_id=feedback.id,
        utilisateur_id=current_user.id,
        auteur_nom=auteur,
        auteur_role=current_user.role.value,
        canal=data.canal,
        contenu=data.contenu.strip(),
    )
    db.add(reponse)

    # Si c'était une demande de rappel, marquer comme traitée
    if feedback.demande_contact:
        feedback.demande_contact.traitee = True

    # Ajouter à l'historique d'audit
    hist = HistoriqueFeedback(
        feedback_id=feedback.id,
        utilisateur_id=current_user.id,
        auteur_nom=auteur,
        auteur_role=current_user.role.value,
        agence_nom=feedback.qr_code.agence.nom if (feedback.qr_code and feedback.qr_code.agence) else None,
        type_evenement="reponse_client",
        ancien_statut=feedback.statut_traitement,
        nouveau_statut=feedback.statut_traitement,
        details=f"[{data.canal.upper()}] {data.contenu.strip()}",
    )
    db.add(hist)

    db.commit()

    all_reponses = (
        db.query(ReponseClient)
        .filter(ReponseClient.feedback_id == feedback_id)
        .order_by(ReponseClient.date_envoi.asc())
        .all()
    )
    return all_reponses


@router.post("/{feedback_id}/reouvrir", response_model=FeedbackResponse)
def reouvrir_feedback(
    feedback_id: UUID,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
):
    """
    Réouverture d'un feedback résolu suite à un nouveau signalement client.
    Transition : Résolu -> En traitement (conserve l'intégralité de l'historique).
    """
    feedback = db.query(Feedback).filter(Feedback.id == feedback_id).first()
    if not feedback:
        raise HTTPException(status_code=404, detail="Feedback introuvable")

    _check_feedback_access(feedback, current_user)

    ancien_statut = feedback.statut_traitement
    feedback.statut_traitement = "en_traitement"
    feedback.action_realisee = False
    feedback.date_resolution = None

    hist = HistoriqueFeedback(
        feedback_id=feedback.id,
        utilisateur_id=current_user.id,
        auteur_nom=f"{current_user.prenom} {current_user.nom}",
        auteur_role=current_user.role.value,
        agence_nom=feedback.qr_code.agence.nom if (feedback.qr_code and feedback.qr_code.agence) else None,
        type_evenement="reouverture",
        ancien_statut=ancien_statut,
        nouveau_statut="en_traitement",
        details="Feedback rouvert suite à un nouveau signalement client",
    )
    db.add(hist)
    db.commit()
    db.refresh(feedback)

    return _format_feedback_response(feedback)


@router.get("/{feedback_id}/historique", response_model=List[HistoriqueFeedbackResponse])
def get_historique(
    feedback_id: UUID,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_feedback_viewer_user),
):
    """Retourne l'historique complet et horodaté des actions et transitions de statut."""
    feedback = db.query(Feedback).filter(Feedback.id == feedback_id).first()
    if not feedback:
        raise HTTPException(status_code=404, detail="Feedback introuvable")

    _check_feedback_access(feedback, current_user)

    historique = (
        db.query(HistoriqueFeedback)
        .filter(HistoriqueFeedback.feedback_id == feedback_id)
        .order_by(HistoriqueFeedback.date_evenement.desc())
        .all()
    )
    return historique


@router.get("/{feedback_id}/reponses", response_model=List[ReponseClientResponse])
def get_reponses(
    feedback_id: UUID,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_feedback_viewer_user),
):
    """Retourne la conversation / réponses adressées au client."""
    feedback = db.query(Feedback).filter(Feedback.id == feedback_id).first()
    if not feedback:
        raise HTTPException(status_code=404, detail="Feedback introuvable")

    _check_feedback_access(feedback, current_user)

    reponses = (
        db.query(ReponseClient)
        .filter(ReponseClient.feedback_id == feedback_id)
        .order_by(ReponseClient.date_envoi.asc())
        .all()
    )
    return reponses


@router.patch("/demandes-contact/{contact_id}/traiter")
def marquer_demande_contact_traitee(
    contact_id: UUID,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
):
    """Marque une demande de contact client comme traitée."""
    dc = db.query(DemandeContact).filter(DemandeContact.id == contact_id).first()
    if not dc:
        raise HTTPException(status_code=404, detail="Demande de contact introuvable")
    dc.traitee = True
    db.commit()
    return {"message": "Demande de contact marquée comme traitée"}
