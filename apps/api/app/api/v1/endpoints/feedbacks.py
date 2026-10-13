"""
Endpoints Feedbacks — soumission par les clients (anonyme) et workflow de traitement Closed-Loop (RBAC strict).
"""
import logging
import uuid
from uuid import UUID
from typing import List, Optional
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status, Query, Response, BackgroundTasks
from sqlalchemy import and_, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

logger = logging.getLogger(__name__)

from app.api.deps import (
    get_current_active_user,
    get_agency_manager,
    get_cx_or_agency_manager,
    get_feedback_viewer_user,
    get_db,
)
from app.api.v1.endpoints.qr_codes import _resolve_qr
from app.models.utilisateur import Utilisateur
from app.models.feedback import Feedback
from app.models.analyse_ia import AnalyseIA
from app.models.qr_code import QRCode
from app.models.agence import Agence
from app.models.categorie import Categorie
from app.models.suggestion import Suggestion
from app.models.demande_contact import DemandeContact
from app.models.historique_feedback import HistoriqueFeedback
from app.models.reponse_client import ReponseClient
from app.models.enums import CriticiteType, SentimentType, UserRole
from app.models.system_settings import SystemSettings, RETENTION_MOIS_DEFAUT
from app.schemas.feedback import (
    FeedbackCreate,
    FeedbackResponse,
    FeedbackSoumisResponse,
    HistoriqueFeedbackResponse,
    ReponseClientResponse,
    NoteInterneCreate,
    SuggestionAgenceCreate,
    ActionCXCreate,
    ReponseClientCreate,
    DemandeContactListItem,
    NPSSubmit,
    NPSSubmitResponse,
)
from app.core.security import create_nps_token, decode_token
from app.core.rate_limit import limiter_ip_public, limiter_soumission
from app.services.ai.analyse_service import analyser_feedback
from app.core.config import settings
from app.services.dashboard_helpers import NOTE_FAIBLE_MAX
from app.services.demandes_contact import marquer_recontactee
from app.utils.phone import normaliser_telephone
from app.utils.recherche_texte import LONGUEUR_MAX_RECHERCHE, condition_recherche, valider_recherche

router = APIRouter()


def _telephone_whatsapp(telephone: Optional[str], user: Optional[Utilisateur]) -> Optional[str]:
    """Numéro normalisé pour wa.me, réservé à l'Agency Manager (seul rôle qui répond au
    client). None pour tout autre rôle, ou si le numéro stocké est absent/invalide."""
    if user is None or user.role != UserRole.AGENCY_MANAGER:
        return None
    return normaliser_telephone(telephone)


def _format_feedback_response(f: Feedback, user: Optional[Utilisateur] = None) -> FeedbackResponse:
    """Transforme une entité Feedback SQLAlchemy en schéma Pydantic FeedbackResponse complet.
    `user` : utilisateur authentifié ; absent (soumission publique) => pas de telephone_whatsapp."""
    res = FeedbackResponse.model_validate(f)
    if res.demande_contact:
        res.demande_contact.telephone_whatsapp = _telephone_whatsapp(res.demande_contact.telephone, user)
    if f.qr_code and f.qr_code.agence:
        res.agence_id = f.qr_code.agence_id
        res.agence_nom = f.qr_code.agence.nom
    if f.categorie:
        res.categorie_nom = f.categorie.nom
    if f.assigne_a:
        res.assigne_a_nom = f"{f.assigne_a.prenom} {f.assigne_a.nom}"
    return res


def _tronquer(texte: Optional[str], max_len: int = 140) -> Optional[str]:
    if not texte:
        return texte
    return texte if len(texte) <= max_len else f"{texte[:max_len]}…"


def _format_demande_contact(dc: DemandeContact, user: Optional[Utilisateur] = None) -> DemandeContactListItem:
    """Transforme une DemandeContact (avec son feedback pré-chargé) en DemandeContactListItem."""
    feedback = dc.feedback
    agence_nom = None
    if feedback and feedback.qr_code and feedback.qr_code.agence:
        agence_nom = feedback.qr_code.agence.nom
    return DemandeContactListItem(
        id=dc.id,
        nom=dc.nom,
        telephone=dc.telephone,
        telephone_whatsapp=_telephone_whatsapp(dc.telephone, user),
        email=dc.email,
        souhaite_etre_rappele=dc.souhaite_etre_rappele,
        traitee=dc.traitee,
        date_traitement=dc.date_traitement,
        traitee_par_nom=dc.traitee_par_nom,
        consentement_contact=dc.consentement_contact,
        consentement_date=dc.consentement_date,
        consentement_retention_mois=dc.consentement_retention_mois,
        feedback_id=dc.feedback_id,
        date_demande=dc.date_demande,
        feedback_commentaire=_tronquer(feedback.commentaire) if feedback else None,
        feedback_note=feedback.note if feedback else 0,
        agence_nom=agence_nom,
    )


def _check_feedback_access(feedback: Feedback, user: Utilisateur) -> None:
    """Vérifie que l'utilisateur a accès au feedback selon son périmètre RBAC."""
    qr_code = feedback.qr_code
    if user.role == UserRole.AGENCY_MANAGER:
        if not user.agence_id or not qr_code or qr_code.agence_id != user.agence_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accès refusé à ce feedback hors de votre agence")
    elif user.role == UserRole.CX_MANAGER:
        # Refus par défaut : sans organisation ou sans agence rattachée, aucun accès (jamais d'accès « par omission »).
        if not user.organisation_id or not qr_code or not qr_code.agence or qr_code.agence.organisation_id != user.organisation_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accès refusé à ce feedback hors de votre organisation")
    else:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accès refusé à ce feedback")


def _feedback_par_cle(db: Session, qr_code_id: UUID, cle: str) -> Optional[Feedback]:
    return (
        db.query(Feedback)
        .filter(Feedback.qr_code_id == qr_code_id, Feedback.cle_idempotence == cle)
        .first()
    )


def _reponse_soumission(feedback: Feedback) -> FeedbackSoumisResponse:
    """Réponse PUBLIQUE de POST /feedbacks : id, nps_token et message, rien d'autre. Le nps_token n'a de sens qu'à la
    soumission (jamais régénéré sur une relecture) ; les endpoints de lecture/workflow ont leur propre schéma."""
    return FeedbackSoumisResponse(id=feedback.id, nps_token=create_nps_token(feedback.id))


def _retention_mois_configuree(db: Session) -> int:
    ligne = db.query(SystemSettings).first()
    return ligne.retention_mois if ligne is not None and ligne.retention_mois else RETENTION_MOIS_DEFAUT


@router.post(
    "/",
    response_model=FeedbackSoumisResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(limiter_soumission)],
)
def submit_feedback(
    qr_code: str,
    data: FeedbackCreate,
    background_tasks: BackgroundTasks,
    response: Response = None,  # injecté par FastAPI ; None quand la fonction est appelée directement (scripts de seed)
    db: Session = Depends(get_db),
):
    """
    Soumet un feedback client — endpoint PUBLIC (pas d'authentification requise).
    Limité en débit (par IP et par QR, voir app/core/rate_limit.py) avant toute lecture en base.
    Déclenche l'analyse IA synchrone.
    """
    # Champ piège : un robot remplit le champ invisible. Réponse identique à un succès, rien n'est enregistré.
    if data.website and data.website.strip():
        return FeedbackSoumisResponse(id=uuid.uuid4(), nps_token=create_nps_token(uuid.uuid4()))

    clean_code = qr_code.strip()
    # Résolution UNIQUE et partagée avec /validate et /categories : code exact, ou UUID d'une agence ACTIVE. Plus de
    # recherche approximative par nom/ville (ILIKE) : un code inconnu, partiel ou contenant « % » rattachait le
    # feedback à la première agence correspondante, toutes organisations confondues.
    qr = _resolve_qr(clean_code, db)
    if not qr:
        raise HTTPException(status_code=404, detail="QR Code ou agence introuvable ou inactif")

    # Idempotence : un renvoi du MÊME envoi (double clic, nouvelle tentative après coupure réseau) ne crée rien.
    cle = data.idempotency_key
    if cle:
        existant = _feedback_par_cle(db, qr.id, cle)
        if existant is not None:
            if response is not None:
                response.status_code = status.HTTP_200_OK
            return _reponse_soumission(existant)

    categorie = db.query(Categorie).filter(
        Categorie.id == data.categorie_id,
        Categorie.agence_id == qr.agence_id,
        Categorie.active == True,
    ).first()
    if not categorie:
        raise HTTPException(status_code=400, detail="Catégorie invalide pour cette agence")

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
            categorie_id=categorie.id,
            note=note_val,
            nps_note=data.nps_note,
            commentaire=data.commentaire,
            cle_idempotence=cle,
            statut_traitement="nouveau",
        )
        db.add(feedback)
        db.flush()

        if data.suggestion:
            suggestion = Suggestion(
                feedback_id=feedback.id,
                agence_id=qr.agence_id,
                contenu=data.suggestion,
            )
            db.add(suggestion)

        if data.souhaite_etre_rappele or data.contact_email:
            # Consentement : exigé par FeedbackCreate dès qu'un numéro est transmis. On enregistre qu'il a été donné, quand,
            # et la durée de conservation affichée au client (lue ici dans la configuration, jamais reprise du client).
            consenti = bool(data.contact_telephone and data.consentement_contact)
            contact = DemandeContact(
                feedback_id=feedback.id,
                nom=data.contact_nom,
                telephone=data.contact_telephone,
                email=data.contact_email,
                souhaite_etre_rappele=data.souhaite_etre_rappele,
                consentement_contact=True if consenti else None,
                consentement_date=datetime.now(timezone.utc) if consenti else None,
                consentement_retention_mois=_retention_mois_configuree(db) if consenti else None,
            )
            db.add(contact)

        # Événement initial d'historique
        hist_init = HistoriqueFeedback(
            feedback_id=feedback.id,
            auteur_nom="Client (Borne)",
            auteur_role="client",
            agence_nom=qr.agence.nom if qr.agence else None,
            agence_id=qr.agence_id,
            type_evenement="soumission",
            ancien_statut=None,
            nouveau_statut="nouveau",
            details=f"Avis reçu (note {note_val}/5)",
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
            # Jamais l'objet exception complet : son message peut reprendre le contenu de l'avis ou des coordonnées.
            logger.error("Erreur lors de l'analyse IA synchrone du feedback %s (%s)", feedback.id, type(ai_err).__name__)

        return _reponse_soumission(feedback)
    except HTTPException:
        raise
    except IntegrityError:
        # Course : deux envois simultanés de la même clé. Le second perd la course et rend le feedback du premier.
        db.rollback()
        existant = _feedback_par_cle(db, qr.id, cle) if cle else None
        if existant is None:
            # Pas de logger.exception : la trace SQL embarque les paramètres de l'INSERT (dont téléphone et e-mail).
            logger.error("Erreur d'intégrité dans submit_feedback (qr=%s)", qr.id)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Erreur serveur : votre avis n'a pas pu être enregistré. Veuillez réessayer.",
            )
        if response is not None:
            response.status_code = status.HTTP_200_OK
        return _reponse_soumission(existant)
    except Exception as e:
        db.rollback()
        logger.error("Erreur submit_feedback (qr=%s, %s)", qr.id, type(e).__name__)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Erreur serveur : votre avis n'a pas pu être enregistré. Veuillez réessayer.",
        )


@router.post("/{feedback_id}/nps", response_model=NPSSubmitResponse, dependencies=[Depends(limiter_ip_public)])
def soumettre_nps(feedback_id: UUID, data: NPSSubmit, db: Session = Depends(get_db)):
    """Réponse NPS facultative — endpoint PUBLIC, affiché après l'écran de remerciement
    (apps/client/src/pages/feedback/[code].astro). Ne modifie AUCUN autre champ du
    feedback. Le jeton est TOUJOURS vérifié ici directement (type, expiration, feedback
    cible) — jamais via get_current_user/get_current_active_user : un jeton nps n'a
    aucune route protégée à authentifier (voir create_nps_token)."""
    jeton_invalide = HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Jeton invalide ou expiré")

    payload = decode_token(data.token)
    if payload is None or payload.get("type") != "nps":
        raise jeton_invalide
    if payload.get("sub") != str(feedback_id):
        raise jeton_invalide

    feedback = db.query(Feedback).filter(Feedback.id == feedback_id).first()
    if not feedback:
        raise jeton_invalide

    if feedback.nps_note is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Réponse NPS déjà enregistrée pour ce feedback")

    feedback.nps_note = data.nps_note
    db.commit()
    return NPSSubmitResponse(nps_note=feedback.nps_note)


@router.get("/", response_model=List[FeedbackResponse])
def list_feedbacks(
    response: Response,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_feedback_viewer_user),
    agence_id: Optional[UUID] = Query(None),
    statut: Optional[str] = Query(None),
    date_debut: Optional[datetime] = Query(None),
    date_fin: Optional[datetime] = Query(None),
    avec_action: Optional[bool] = Query(None),
    action_realisee: Optional[bool] = Query(None),
    theme: Optional[str] = Query(None, min_length=1, max_length=100),
    sentiment: Optional[SentimentType] = Query(None, description="Ton de l'analyse IA : positif, neutre ou negatif."),
    criticite: Optional[str] = Query(None, description="faible, moyenne, elevee, critique, ou non_evaluee (avis sans analyse)."),
    note: Optional[int] = Query(None, ge=1, le=5, description="Note exacte (1 à 5)."),
    a_traiter: Optional[bool] = Query(None, description="true : avis non résolus ou avec une demande de rappel en attente."),
    a_surveiller: Optional[bool] = Query(None, description="true : note de 2 ou moins, ton négatif, gravité élevée/critique ou avis contradictoire."),
    q: Optional[str] = Query(None, max_length=LONGUEUR_MAX_RECHERCHE, description="Recherche dans le texte de l'avis uniquement (casse et accents ignorés)."),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """
    Liste les feedbacks pour CX Manager et Agency Manager.
    Périmètre filtré strictement côté backend selon le RBAC ; tous les filtres s'y ajoutent en ET, jamais en OU.
    `X-Total-Count` = nombre d'avis correspondant à TOUS les filtres (avant limit/offset). Ordre stable : date décroissante puis id.
    """
    recherche = valider_recherche(q)
    if criticite is not None and criticite != "non_evaluee" and criticite not in {c.value for c in CriticiteType}:
        raise HTTPException(status_code=422, detail="Gravité inconnue.")
    query = (
        db.query(Feedback)
        .options(
            joinedload(Feedback.analyse_ia),
            joinedload(Feedback.demande_contact),
            joinedload(Feedback.suggestion),
            joinedload(Feedback.assigne_a),
            joinedload(Feedback.qr_code).joinedload(QRCode.agence),
            joinedload(Feedback.categorie),
        )
        .join(QRCode, Feedback.qr_code_id == QRCode.id)
    )

    if current_user.role == UserRole.AGENCY_MANAGER:
        query = query.filter(QRCode.agence_id == current_user.agence_id)
    elif current_user.role == UserRole.CX_MANAGER:
        # Sans organisation, le périmètre est vide (jamais « toutes les organisations »).
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
    if avec_action is True:
        query = query.filter(Feedback.action_a_prendre.isnot(None))
    elif avec_action is False:
        query = query.filter(Feedback.action_a_prendre.is_(None))
    if action_realisee is not None:
        query = query.filter(Feedback.action_realisee == action_realisee)
    if theme or sentiment or criticite or a_surveiller:
        query = query.outerjoin(AnalyseIA, AnalyseIA.feedback_id == Feedback.id)  # une seule jointure d'analyse pour ces filtres
    if a_traiter:
        query = query.outerjoin(DemandeContact, DemandeContact.feedback_id == Feedback.id)
        query = query.filter(or_(
            Feedback.statut_traitement != "resolu",
            and_(DemandeContact.id.isnot(None), or_(DemandeContact.traitee.is_(None), DemandeContact.traitee.is_(False))),
        ))
    if a_surveiller:
        query = query.filter(or_(
            Feedback.note <= NOTE_FAIBLE_MAX,
            AnalyseIA.sentiment == SentimentType.NEGATIF,
            AnalyseIA.criticite.in_([CriticiteType.ELEVEE, CriticiteType.CRITIQUE]),
            AnalyseIA.discordance_detectee.is_(True),
        ))
    if note is not None:
        query = query.filter(Feedback.note == note)
    if theme:
        if theme == "non_categorise":
            query = query.filter((AnalyseIA.id.is_(None)) | (AnalyseIA.theme_principal.is_(None)) | (AnalyseIA.theme_principal == ""))
        else:
            query = query.filter(AnalyseIA.theme_principal == theme)
    if sentiment:
        query = query.filter(AnalyseIA.sentiment == sentiment)
    if criticite == "non_evaluee":
        query = query.filter(AnalyseIA.id.is_(None))
    elif criticite:
        query = query.filter(AnalyseIA.criticite == CriticiteType(criticite))
    if recherche:
        # Texte de l'avis UNIQUEMENT (jamais nom, téléphone ni e-mail de la demande de contact). Valeur liée en paramètre,
        # jokers et caractères spéciaux neutralisés, casse et accents ignorés (voir app/utils/recherche_texte.py).
        query = query.filter(condition_recherche(db.get_bind().dialect.name, Feedback.commentaire, recherche))

    response.headers["X-Total-Count"] = str(query.order_by(None).count())
    feedbacks = query.order_by(Feedback.date_soumission.desc(), Feedback.id.desc()).offset(offset).limit(limit).all()

    return [_format_feedback_response(f, current_user) for f in feedbacks]


@router.get("/themes", response_model=List[str])
def list_feedback_themes(
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_feedback_viewer_user),
    agence_id: Optional[UUID] = Query(None),
):
    """Catalogue de thèmes distincts dans le périmètre RBAC, indépendant de la pagination."""
    query = db.query(AnalyseIA.theme_principal).join(Feedback, AnalyseIA.feedback_id == Feedback.id).join(
        QRCode, Feedback.qr_code_id == QRCode.id
    ).filter(AnalyseIA.theme_principal.isnot(None), AnalyseIA.theme_principal != "")
    if current_user.role == UserRole.AGENCY_MANAGER:
        query = query.filter(QRCode.agence_id == current_user.agence_id)
    elif current_user.role == UserRole.CX_MANAGER:
        query = query.join(Agence, QRCode.agence_id == Agence.id).filter(Agence.organisation_id == current_user.organisation_id)
        if agence_id:
            query = query.filter(QRCode.agence_id == agence_id)
    themes = {row[0] for row in query.distinct().all()}
    uncategorised = (
        db.query(Feedback.id)
        .join(QRCode, Feedback.qr_code_id == QRCode.id)
        .outerjoin(AnalyseIA, AnalyseIA.feedback_id == Feedback.id)
        .filter((AnalyseIA.id.is_(None)) | (AnalyseIA.theme_principal.is_(None)) | (AnalyseIA.theme_principal == ""))
    )
    if current_user.role == UserRole.AGENCY_MANAGER:
        uncategorised = uncategorised.filter(QRCode.agence_id == current_user.agence_id)
    elif current_user.role == UserRole.CX_MANAGER:
        uncategorised = uncategorised.join(Agence, QRCode.agence_id == Agence.id).filter(
            Agence.organisation_id == current_user.organisation_id
        )
        if agence_id:
            uncategorised = uncategorised.filter(QRCode.agence_id == agence_id)
    if uncategorised.first():
        themes.add("non_categorise")
    return sorted(themes)


@router.get("/demandes-contact", response_model=List[DemandeContactListItem])
def lister_demandes_contact(
    response: Response,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
    traitee: Optional[bool] = Query(False, description="Par défaut, ne montre que les demandes non traitées (traitee=false)."),
    agence_id: Optional[UUID] = Query(None, description="CX Manager uniquement : restreint à une agence de son organisation."),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """
    Liste les demandes de rappel/contact — CX Manager (organisation, avec filtre agence_id
    optionnel) ou Agency Manager (sa seule agence, forcée). Déclarée AVANT GET
    /{feedback_id} : même forme de chemin à un seul segment, sinon FastAPI la ferait
    matcher comme un feedback_id invalide.
    """
    query = (
        db.query(DemandeContact)
        .join(Feedback, DemandeContact.feedback_id == Feedback.id)
        .join(QRCode, Feedback.qr_code_id == QRCode.id)
        .options(
            joinedload(DemandeContact.feedback).joinedload(Feedback.qr_code).joinedload(QRCode.agence),
            joinedload(DemandeContact.traitee_par),
        )
    )

    if current_user.role == UserRole.AGENCY_MANAGER:
        query = query.filter(QRCode.agence_id == current_user.agence_id)
    elif current_user.role == UserRole.CX_MANAGER:
        # Sans organisation, le périmètre est vide (jamais « toutes les organisations »).
        query = query.join(Agence, QRCode.agence_id == Agence.id).filter(
            Agence.organisation_id == current_user.organisation_id
        )
        if agence_id:
            query = query.filter(QRCode.agence_id == agence_id)

    if traitee is not None:
        query = query.filter(DemandeContact.traitee == traitee)

    response.headers["X-Total-Count"] = str(query.order_by(None).count())
    demandes = query.order_by(DemandeContact.date_demande.desc()).offset(offset).limit(limit).all()
    return [_format_demande_contact(d, current_user) for d in demandes]


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
            joinedload(Feedback.categorie),
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
            logger.warning(f"Auto-analyse fallback pour feedback {feedback.id} ({type(e).__name__})")

    return _format_feedback_response(feedback, current_user)


# ── Machine à états du traitement d'un avis (statut_traitement) ────────────────────────────────────
#
#   nouveau --prise en charge (Responsable d'agence)--> en_traitement
#   en_traitement --action à mener définie (CX Manager)--> en_cours
#   en_cours --action confirmée réalisée (CX ou Responsable)--> resolu
#   resolu --réouverture (CX ou Responsable)--> en_traitement
#
# Le siège ne peut PAS faire passer un avis de « nouveau » à « en_cours » : l'action à mener se définit sur un avis
# déjà pris en charge. Aucune transition ne ramène un avis à « nouveau ». Chaque transition est un UPDATE conditionnel
# (atomique) : une répétition ou deux appels simultanés n'écrivent qu'UN événement d'historique.


def _conflit(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


def _transitionner(db: Session, feedback_id: UUID, depuis: str, valeurs: dict) -> bool:
    """Applique `valeurs` uniquement si l'avis est encore au statut `depuis` ; True si la transition a eu lieu."""
    return bool(
        db.query(Feedback)
        .filter(Feedback.id == feedback_id, Feedback.statut_traitement == depuis)
        .update(valeurs, synchronize_session=False)
    )


def _evenement(db: Session, feedback: Feedback, user: Utilisateur, type_evenement: str, ancien: str, nouveau: str, details: str) -> None:
    db.add(HistoriqueFeedback(
        feedback_id=feedback.id,
        utilisateur_id=user.id,
        auteur_nom=f"{user.prenom} {user.nom}",
        auteur_role=user.role.value,
        agence_nom=feedback.qr_code.agence.nom if (feedback.qr_code and feedback.qr_code.agence) else None,
        agence_id=feedback.qr_code.agence_id if feedback.qr_code else None,
        type_evenement=type_evenement,
        ancien_statut=ancien,
        nouveau_statut=nouveau,
        details=details,
    ))


@router.post("/{feedback_id}/open", response_model=FeedbackResponse)
def open_feedback(
    feedback_id: UUID,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_agency_manager),
):
    """
    CONSULTATION d'un avis (Agency Manager) : renvoie l'avis, SANS aucun effet de bord.
    Ouvrir un avis ne change ni son statut ni son attribution : la prise en charge est une action
    explicite (POST /{feedback_id}/prendre-en-charge). Conservée pour les clients existants ; appelée
    plusieurs fois, elle ne produit toujours aucune transition ni aucune écriture.
    """
    feedback = (
        db.query(Feedback)
        .options(
            joinedload(Feedback.analyse_ia),
            joinedload(Feedback.demande_contact),
            joinedload(Feedback.qr_code).joinedload(QRCode.agence),
            joinedload(Feedback.categorie),
            joinedload(Feedback.assigne_a),
        )
        .filter(Feedback.id == feedback_id)
        .first()
    )
    if not feedback:
        raise HTTPException(status_code=404, detail="Feedback introuvable")

    _check_feedback_access(feedback, current_user)

    return _format_feedback_response(feedback, current_user)


@router.post("/{feedback_id}/prendre-en-charge", response_model=FeedbackResponse)
def prendre_en_charge_feedback(
    feedback_id: UUID,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_agency_manager),
):
    """
    Prise en charge EXPLICITE d'un avis par le Responsable d'agence de SON agence : Nouveau -> En traitement,
    attribution à l'utilisateur connecté, événement tracé dans l'historique.
    - Réservée à l'Agency Manager (seul lui traite un avis jusqu'à sa résolution ; le CX Manager consulte).
    - Idempotente : si l'avis n'est plus « nouveau », rien n'est modifié (ni statut, ni attribution, ni historique).
    - Atomique : la transition est un UPDATE conditionnel, deux appels simultanés n'écrivent qu'un seul événement.
    """
    feedback = (
        db.query(Feedback)
        .options(
            joinedload(Feedback.analyse_ia),
            joinedload(Feedback.demande_contact),
            joinedload(Feedback.qr_code).joinedload(QRCode.agence),
            joinedload(Feedback.categorie),
            joinedload(Feedback.assigne_a),
        )
        .filter(Feedback.id == feedback_id)
        .first()
    )
    if not feedback:
        raise HTTPException(status_code=404, detail="Feedback introuvable")

    _check_feedback_access(feedback, current_user)

    transition = (
        db.query(Feedback)
        .filter(Feedback.id == feedback.id, Feedback.statut_traitement == "nouveau")
        .update(
            {
                Feedback.statut_traitement: "en_traitement",
                Feedback.assigne_a_id: current_user.id,
                Feedback.date_assignation: datetime.now(),
            },
            synchronize_session=False,
        )
    )
    if transition:
        db.add(HistoriqueFeedback(
            feedback_id=feedback.id,
            utilisateur_id=current_user.id,
            auteur_nom=f"{current_user.prenom} {current_user.nom}",
            auteur_role=current_user.role.value,
            agence_nom=feedback.qr_code.agence.nom if (feedback.qr_code and feedback.qr_code.agence) else None,
            agence_id=feedback.qr_code.agence_id if feedback.qr_code else None,
            type_evenement="prise_en_charge",
            ancien_statut="nouveau",
            nouveau_statut="en_traitement",
            details="Avis pris en charge par le Responsable d'agence",
        ))
        db.commit()
    db.refresh(feedback)

    return _format_feedback_response(feedback, current_user)


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
        agence_id=feedback.qr_code.agence_id if feedback.qr_code else None,
        type_evenement="note_interne",
        ancien_statut=feedback.statut_traitement,
        nouveau_statut=feedback.statut_traitement,
        details=data.texte.strip(),
    )
    db.add(hist)
    db.commit()
    db.refresh(feedback)

    return _format_feedback_response(feedback, current_user)


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
        agence_id=feedback.qr_code.agence_id if feedback.qr_code else None,
        type_evenement="suggestion_envoyee",
        ancien_statut=feedback.statut_traitement,
        nouveau_statut=feedback.statut_traitement,
        details=data.suggestion.strip(),
    )
    db.add(hist)
    db.commit()
    db.refresh(feedback)

    return _format_feedback_response(feedback, current_user)


@router.post("/{feedback_id}/action-cx", response_model=FeedbackResponse)
def definir_action_cx(
    feedback_id: UUID,
    data: ActionCXCreate,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
):
    """
    CX Manager uniquement : définit l'action à mener sur un avis DÉJÀ PRIS EN CHARGE par le Responsable d'agence.
    Transition : En traitement -> En cours (jamais depuis « Nouveau » ni « Résolu »). Répétée avec le même texte, elle est
    sans effet ; avec un autre texte sur un avis déjà « En cours », elle est refusée (409).
    """
    if current_user.role != UserRole.CX_MANAGER and current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Seul le CX Manager peut définir une Action à prendre")

    feedback = db.query(Feedback).filter(Feedback.id == feedback_id).first()
    if not feedback:
        raise HTTPException(status_code=404, detail="Feedback introuvable")

    _check_feedback_access(feedback, current_user)

    action = data.action.strip()
    statut = feedback.statut_traitement
    if statut == "en_cours":
        if (feedback.action_a_prendre or "").strip() == action:
            return _format_feedback_response(feedback, current_user)
        raise _conflit("Une action à mener est déjà définie pour cet avis.")
    if statut == "nouveau":
        raise _conflit("Cet avis n'a pas encore été pris en charge par le Responsable d'agence : l'action à mener se définit ensuite.")
    if statut == "resolu":
        raise _conflit("Cet avis est résolu : rouvrez-le avant de définir une nouvelle action.")
    if statut != "en_traitement":
        raise _conflit("Le statut de cet avis ne permet pas de définir une action à mener.")

    if _transitionner(db, feedback.id, "en_traitement", {
        Feedback.statut_traitement: "en_cours",
        Feedback.action_a_prendre: action,
        Feedback.action_realisee: False,
    }):
        _evenement(db, feedback, current_user, "action_definie", "en_traitement", "en_cours", action)
        db.commit()
    else:
        db.rollback()  # un autre appel a déjà fait évoluer l'avis : on ne l'écrase pas
    db.refresh(feedback)
    if feedback.statut_traitement == "en_cours" and (feedback.action_a_prendre or "").strip() != action:
        raise _conflit("Une action à mener est déjà définie pour cet avis.")

    return _format_feedback_response(feedback, current_user)


@router.post("/{feedback_id}/confirmer-action", response_model=FeedbackResponse)
def confirmer_action_realisee(
    feedback_id: UUID,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
):
    """
    CX Manager ou Agency Manager (sur sa propre agence) : confirme que l'action à mener a été réalisée.
    Transition : En cours -> Résolu. Sur un avis déjà résolu, sans effet (ni nouvel événement, ni date écrasée) ;
    sur un avis sans action à mener en cours (Nouveau, En traitement), refusée (409).
    """
    feedback = db.query(Feedback).filter(Feedback.id == feedback_id).first()
    if not feedback:
        raise HTTPException(status_code=404, detail="Feedback introuvable")

    _check_feedback_access(feedback, current_user)

    if feedback.statut_traitement == "resolu":
        return _format_feedback_response(feedback, current_user)
    if feedback.statut_traitement != "en_cours":
        raise _conflit("Aucune action à confirmer : une action à mener doit d'abord être définie sur cet avis.")

    if _transitionner(db, feedback.id, "en_cours", {
        Feedback.action_realisee: True,
        Feedback.statut_traitement: "resolu",
        Feedback.date_resolution: datetime.now(),
    }):
        _evenement(db, feedback, current_user, "action_realisee", "en_cours", "resolu", feedback.action_a_prendre or "Action réalisée sur le terrain")
        db.commit()
    else:
        db.rollback()
    db.refresh(feedback)

    return _format_feedback_response(feedback, current_user)


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

    # Enregistrer une réponse = avoir recontacté le client : la demande de rappel est traitée (date, auteur et événement
    # d'historique via le point de traitement unique) et ses coordonnées sont masquées ensuite.
    if feedback.demande_contact:
        marquer_recontactee(db, feedback.demande_contact, current_user, origine="reponse", canal=data.canal)

    # Ajouter à l'historique d'audit
    hist = HistoriqueFeedback(
        feedback_id=feedback.id,
        utilisateur_id=current_user.id,
        auteur_nom=auteur,
        auteur_role=current_user.role.value,
        agence_nom=feedback.qr_code.agence.nom if (feedback.qr_code and feedback.qr_code.agence) else None,
        agence_id=feedback.qr_code.agence_id if feedback.qr_code else None,
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
    Réouverture d'un feedback RÉSOLU suite à un nouveau signalement client (historique conservé).
    Transition : Résolu -> En traitement. Refusée (409) sur tout autre statut : un avis jamais résolu n'a rien à rouvrir.
    """
    feedback = db.query(Feedback).filter(Feedback.id == feedback_id).first()
    if not feedback:
        raise HTTPException(status_code=404, detail="Feedback introuvable")

    _check_feedback_access(feedback, current_user)

    if feedback.statut_traitement != "resolu":
        raise _conflit("Seul un avis résolu peut être rouvert.")

    if _transitionner(db, feedback.id, "resolu", {
        Feedback.statut_traitement: "en_traitement",
        Feedback.action_realisee: False,
        Feedback.date_resolution: None,
    }):
        _evenement(db, feedback, current_user, "reouverture", "resolu", "en_traitement", "Avis rouvert suite à un nouveau signalement du client")
        db.commit()
    else:
        db.rollback()
    db.refresh(feedback)

    return _format_feedback_response(feedback, current_user)


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
    """« Marquer comme recontacté » : traite la demande (date, auteur, événement d'historique) et masque définitivement le
    téléphone et l'e-mail du client dans les réponses de l'API. Sans effet (200, `deja_traitee`) si elle l'est déjà."""
    dc = (
        db.query(DemandeContact)
        .options(
            joinedload(DemandeContact.feedback).joinedload(Feedback.qr_code).joinedload(QRCode.agence),
            joinedload(DemandeContact.traitee_par),
        )
        .filter(DemandeContact.id == contact_id)
        .first()
    )
    if not dc:
        raise HTTPException(status_code=404, detail="Demande de contact introuvable")

    _check_feedback_access(dc.feedback, current_user)

    traitee_maintenant = marquer_recontactee(db, dc, current_user, origine="bouton")
    db.commit()
    db.refresh(dc)
    return {
        "message": "Demande de contact marquée comme recontactée",
        "deja_traitee": not traitee_maintenant,
        "demande": _format_demande_contact(dc, current_user),
    }
