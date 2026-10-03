"""
Endpoints Issues — fondation V1 (manuelle) : un CX Manager ou Agency Manager crée
l'Issue et y rattache des feedbacks à la main. Pas de suggestion IA de regroupement,
pas de clustering, pas de dashboard ni de KPI dédiés (voir le rapport de la tâche).
"""
from datetime import datetime
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_cx_or_agency_manager, get_db
from app.models.agence import Agence
from app.models.action_corrective import ActionCorrective
from app.models.categorie import Categorie
from app.models.enums import CriticiteType, UserRole
from app.models.feedback import Feedback
from app.models.historique_issue import HistoriqueIssue
from app.models.issue import Issue
from app.models.qr_code import QRCode
from app.models.utilisateur import Utilisateur
from app.schemas.feedback import FeedbackResponse
from app.schemas.issue import (
    ActionCorrectiveCreate,
    ActionCorrectiveResponse,
    IssueCreate,
    IssueDetailResponse,
    IssueResponse,
)
from app.services.acces_agence import verifier_acces_agence

router = APIRouter()


# ── Accès & formatage (dupliqués volontairement de feedbacks.py, non modifié — voir rapport) ──

def _check_issue_access(issue: Issue, user: Utilisateur) -> None:
    """Vérifie que l'utilisateur a accès à l'Issue selon son périmètre RBAC (même règle
    que _check_feedback_access, feedbacks.py)."""
    if user.role == UserRole.AGENCY_MANAGER:
        if issue.agence_id != user.agence_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accès refusé à cette Issue hors de votre agence")
    elif user.role == UserRole.CX_MANAGER:
        if user.organisation_id and issue.organisation_id != user.organisation_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accès refusé à cette Issue hors de votre organisation")


def _check_feedback_access_scope(feedback: Feedback, user: Utilisateur) -> None:
    """Même règle que _check_feedback_access (feedbacks.py) — dupliquée ici pour ne pas
    modifier feedbacks.py (hors périmètre de cette tâche)."""
    if not feedback.qr_code:
        return
    if user.role == UserRole.AGENCY_MANAGER:
        if feedback.qr_code.agence_id != user.agence_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accès refusé à ce feedback hors de votre agence")
    elif user.role == UserRole.CX_MANAGER:
        if user.organisation_id and feedback.qr_code.agence:
            if feedback.qr_code.agence.organisation_id != user.organisation_id:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accès refusé à ce feedback hors de votre organisation")


def _format_issue_response(issue: Issue) -> IssueResponse:
    res = IssueResponse.model_validate(issue)
    if issue.agence:
        res.agence_nom = issue.agence.nom
    if issue.categorie:
        res.categorie_nom = issue.categorie.nom
    return res


def _format_feedback_summary(f: Feedback) -> FeedbackResponse:
    res = FeedbackResponse.model_validate(f)
    if f.qr_code and f.qr_code.agence:
        res.agence_id = f.qr_code.agence_id
        res.agence_nom = f.qr_code.agence.nom
    if f.categorie:
        res.categorie_nom = f.categorie.nom
    if f.assigne_a:
        res.assigne_a_nom = f"{f.assigne_a.prenom} {f.assigne_a.nom}"
    return res


def _log_issue_event(
    db: Session,
    issue: Issue,
    user: Utilisateur,
    type_evenement: str,
    ancien_statut: Optional[str] = None,
    nouveau_statut: Optional[str] = None,
    details: Optional[str] = None,
    feedback_id: Optional[UUID] = None,
) -> None:
    db.add(HistoriqueIssue(
        issue_id=issue.id,
        feedback_id=feedback_id,
        utilisateur_id=user.id,
        auteur_nom=f"{user.prenom} {user.nom}",
        auteur_role=user.role.value,
        agence_nom=issue.agence.nom if issue.agence else None,
        agence_id=issue.agence_id,
        type_evenement=type_evenement,
        ancien_statut=ancien_statut,
        nouveau_statut=nouveau_statut,
        details=details,
    ))


def _get_issue_or_404(db: Session, issue_id: UUID) -> Issue:
    issue = db.query(Issue).filter(Issue.id == issue_id).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue introuvable")
    return issue


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/", response_model=IssueResponse, status_code=status.HTTP_201_CREATED)
def creer_issue(
    data: IssueCreate,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
):
    """Crée l'Issue (statut='ouverte') et rattache les feedback_ids fournis s'il y en a."""
    verifier_acces_agence(db, current_user, data.agence_id)

    agence = db.query(Agence).filter(Agence.id == data.agence_id).first()
    if not agence:
        raise HTTPException(status_code=404, detail="Agence introuvable")

    if data.categorie_id:
        categorie = db.query(Categorie).filter(
            Categorie.id == data.categorie_id, Categorie.agence_id == agence.id
        ).first()
        if not categorie:
            raise HTTPException(status_code=400, detail="Catégorie invalide pour cette agence")

    issue = Issue(
        organisation_id=agence.organisation_id,
        agence_id=agence.id,
        titre=data.titre.strip(),
        description=data.description,
        severite=data.severite,
        categorie_id=data.categorie_id,
        statut="ouverte",
    )
    db.add(issue)
    db.flush()

    _log_issue_event(db, issue, current_user, "creation", nouveau_statut="ouverte", details=data.description)

    if data.feedback_ids:
        feedbacks = (
            db.query(Feedback)
            .options(joinedload(Feedback.qr_code).joinedload(QRCode.agence))
            .filter(Feedback.id.in_(data.feedback_ids))
            .all()
        )
        for fb in feedbacks:
            _check_feedback_access_scope(fb, current_user)
            fb.issue_id = issue.id
            _log_issue_event(db, issue, current_user, "feedback_rattache", feedback_id=fb.id)
        issue.derniere_detection = datetime.now()

    db.commit()
    db.refresh(issue)
    return _format_issue_response(issue)


@router.get("/", response_model=List[IssueResponse])
def lister_issues(
    response: Response,
    statut: Optional[str] = Query(None),
    severite: Optional[CriticiteType] = Query(None),
    agence_id: Optional[UUID] = Query(None),
    categorie_id: Optional[UUID] = Query(None),
    tri: Optional[str] = Query("recent", description="'recent' (défaut, décroissant) ou 'ancien' (croissant) sur premiere_detection. Toute autre valeur ou absence : comportement par défaut, inchangé."),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
):
    """Liste filtrable, scopée par organisation (CX Manager) ou agence (Agency Manager) —
    même logique RBAC que list_feedbacks."""
    query = db.query(Issue)
    if current_user.role == UserRole.AGENCY_MANAGER:
        query = query.filter(Issue.agence_id == current_user.agence_id)
    elif current_user.role == UserRole.CX_MANAGER:
        query = query.filter(Issue.organisation_id == current_user.organisation_id)

    if statut:
        query = query.filter(Issue.statut == statut)
    if severite:
        query = query.filter(Issue.severite == severite)
    if agence_id:
        query = query.filter(Issue.agence_id == agence_id)
    if categorie_id:
        query = query.filter(Issue.categorie_id == categorie_id)

    response.headers["X-Total-Count"] = str(query.order_by(None).count())
    ordre = Issue.premiere_detection.asc() if tri == "ancien" else Issue.premiere_detection.desc()
    issues = query.order_by(ordre).offset(offset).limit(limit).all()
    return [_format_issue_response(i) for i in issues]


@router.get("/{issue_id}", response_model=IssueDetailResponse)
def detail_issue(
    issue_id: UUID,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
):
    """Détail d'une Issue + feedbacks liés + actions liées. 403 si hors périmètre."""
    issue = _get_issue_or_404(db, issue_id)
    _check_issue_access(issue, current_user)

    feedbacks = (
        db.query(Feedback)
        .options(
            joinedload(Feedback.qr_code).joinedload(QRCode.agence),
            joinedload(Feedback.categorie),
            joinedload(Feedback.assigne_a),
            joinedload(Feedback.analyse_ia),
        )
        .filter(Feedback.issue_id == issue.id)
        .order_by(Feedback.date_soumission.desc())
        .all()
    )
    actions = (
        db.query(ActionCorrective)
        .filter(ActionCorrective.issue_id == issue.id)
        .order_by(ActionCorrective.created_at.asc())
        .all()
    )

    base = _format_issue_response(issue)
    return IssueDetailResponse(
        **base.model_dump(),
        feedbacks=[_format_feedback_summary(fb) for fb in feedbacks],
        actions=[ActionCorrectiveResponse.model_validate(a) for a in actions],
    )


@router.patch("/{issue_id}/rattacher-feedback/{feedback_id}", response_model=IssueResponse)
def rattacher_feedback(
    issue_id: UUID,
    feedback_id: UUID,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
):
    """Vérifie l'accès aux DEUX ressources avant d'écrire. Met à jour derniere_detection.
    Si l'Issue était 'verifiee' : repasse à 'reouverte' et remet date_verification à NULL.
    Si le feedback était déjà rattaché à une AUTRE Issue, le déplacement n'est autorisé que
    si l'utilisateur a aussi accès à cette ancienne Issue (vérifiée avant toute écriture) ;
    le déplacement est alors tracé des deux côtés (événement sortant sur l'ancienne Issue,
    entrant sur la nouvelle) — jamais silencieux."""
    issue = _get_issue_or_404(db, issue_id)
    _check_issue_access(issue, current_user)

    feedback = (
        db.query(Feedback)
        .options(joinedload(Feedback.qr_code).joinedload(QRCode.agence))
        .filter(Feedback.id == feedback_id)
        .first()
    )
    if not feedback:
        raise HTTPException(status_code=404, detail="Feedback introuvable")
    _check_feedback_access_scope(feedback, current_user)

    ancienne_issue = None
    if feedback.issue_id and feedback.issue_id != issue.id:
        ancienne_issue = db.query(Issue).filter(Issue.id == feedback.issue_id).first()
        if ancienne_issue:
            _check_issue_access(ancienne_issue, current_user)

    feedback.issue_id = issue.id
    issue.derniere_detection = datetime.now()

    ancien_statut = issue.statut
    if issue.statut == "verifiee":
        issue.statut = "reouverte"
        issue.date_verification = None
    nouveau_statut = issue.statut if issue.statut != ancien_statut else None
    ancien_statut = ancien_statut if nouveau_statut else None

    if ancienne_issue:
        _log_issue_event(
            db, ancienne_issue, current_user, "feedback_deplace_sortant", feedback_id=feedback.id,
            details=f"Feedback déplacé vers l'Issue « {issue.titre} » ({issue.id})",
        )
        _log_issue_event(
            db, issue, current_user, "feedback_deplace_entrant", feedback_id=feedback.id,
            ancien_statut=ancien_statut, nouveau_statut=nouveau_statut,
            details=f"Feedback déplacé depuis l'Issue « {ancienne_issue.titre} » ({ancienne_issue.id})",
        )
    else:
        _log_issue_event(
            db, issue, current_user, "feedback_rattache", feedback_id=feedback.id,
            ancien_statut=ancien_statut, nouveau_statut=nouveau_statut,
        )

    db.commit()
    db.refresh(issue)
    return _format_issue_response(issue)


@router.patch("/{issue_id}/detacher-feedback/{feedback_id}", response_model=IssueResponse)
def detacher_feedback(
    issue_id: UUID,
    feedback_id: UUID,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
):
    """Vérifie l'accès aux DEUX ressources avant d'écrire. Remet feedback.issue_id à NULL."""
    issue = _get_issue_or_404(db, issue_id)
    _check_issue_access(issue, current_user)

    feedback = (
        db.query(Feedback)
        .options(joinedload(Feedback.qr_code).joinedload(QRCode.agence))
        .filter(Feedback.id == feedback_id, Feedback.issue_id == issue.id)
        .first()
    )
    if not feedback:
        raise HTTPException(status_code=404, detail="Feedback introuvable ou non rattaché à cette Issue")
    _check_feedback_access_scope(feedback, current_user)

    feedback.issue_id = None
    _log_issue_event(db, issue, current_user, "feedback_detache", feedback_id=feedback.id)

    db.commit()
    db.refresh(issue)
    return _format_issue_response(issue)


@router.post("/{issue_id}/actions", response_model=ActionCorrectiveResponse, status_code=status.HTTP_201_CREATED)
def creer_action_corrective(
    issue_id: UUID,
    data: ActionCorrectiveCreate,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
):
    """Crée l'ActionCorrective (statut='creee'), passe issue.statut à 'action_en_cours' et
    issue.necessite_action à True si ce n'était pas déjà fait.

    Si l'Issue était 'verifiee' : une nouvelle action la remet en cause, comme un
    rattachement de feedback après vérification — repasse d'abord par 'reouverte' et
    remet date_verification à NULL (sinon date_verification resterait renseignée alors
    que le statut n'est plus 'verifiee', ce qui fausserait un futur calcul de Loop
    Closure Rate basé sur cette date), avant la transition normale vers 'action_en_cours'.
    Si l'Issue était 'resolue' (mais pas 'verifiee') : comportement inchangé."""
    issue = _get_issue_or_404(db, issue_id)
    _check_issue_access(issue, current_user)

    if data.responsable_id:
        responsable = db.query(Utilisateur).filter(Utilisateur.id == data.responsable_id).first()
        if not responsable:
            raise HTTPException(status_code=400, detail="responsable_id invalide : utilisateur introuvable")
        if responsable.organisation_id != issue.organisation_id:
            raise HTTPException(status_code=400, detail="responsable_id invalide : cet utilisateur n'appartient pas à la même organisation que l'Issue")
        if responsable.role not in (UserRole.CX_MANAGER, UserRole.AGENCY_MANAGER):
            raise HTTPException(status_code=400, detail="responsable_id invalide : seul un CX Manager ou un Agency Manager peut être responsable d'une action")

    action = ActionCorrective(
        issue_id=issue.id,
        titre=data.titre.strip(),
        description=data.description,
        responsable_id=data.responsable_id,
        echeance=data.echeance,
        statut="creee",
    )
    db.add(action)

    if issue.statut == "verifiee":
        issue.statut = "reouverte"
        issue.date_verification = None
        _log_issue_event(
            db, issue, current_user, "action_creee",
            ancien_statut="verifiee", nouveau_statut="reouverte",
            details=data.titre.strip(),
        )

    ancien_statut = issue.statut
    issue.statut = "action_en_cours"
    if not issue.necessite_action:
        issue.necessite_action = True

    db.flush()
    _log_issue_event(
        db, issue, current_user, "action_creee",
        ancien_statut=ancien_statut, nouveau_statut="action_en_cours",
        details=data.titre.strip(),
    )

    db.commit()
    db.refresh(action)
    return ActionCorrectiveResponse.model_validate(action)


@router.post("/{issue_id}/actions/{action_id}/terminer", response_model=ActionCorrectiveResponse)
def terminer_action_corrective(
    issue_id: UUID,
    action_id: UUID,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
):
    """action.statut='terminee', date_completion=now(). Si TOUTES les actions de l'Issue
    sont 'terminee' : issue.statut='resolue', issue.date_resolution=now()."""
    issue = _get_issue_or_404(db, issue_id)
    _check_issue_access(issue, current_user)

    action = db.query(ActionCorrective).filter(
        ActionCorrective.id == action_id, ActionCorrective.issue_id == issue.id
    ).first()
    if not action:
        raise HTTPException(status_code=404, detail="Action corrective introuvable pour cette Issue")

    action.statut = "terminee"
    action.date_completion = datetime.now()
    db.flush()
    _log_issue_event(db, issue, current_user, "action_terminee", details=action.titre)

    reste_a_faire = db.query(ActionCorrective).filter(
        ActionCorrective.issue_id == issue.id, ActionCorrective.statut != "terminee"
    ).count()
    if reste_a_faire == 0:
        ancien_statut = issue.statut
        issue.statut = "resolue"
        issue.date_resolution = datetime.now()
        _log_issue_event(db, issue, current_user, "issue_resolue", ancien_statut=ancien_statut, nouveau_statut="resolue")

    db.commit()
    db.refresh(action)
    return ActionCorrectiveResponse.model_validate(action)


@router.post("/{issue_id}/verifier", response_model=IssueResponse)
def verifier_issue(
    issue_id: UUID,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
):
    """Refuse (400) si issue.statut != 'resolue'. Sinon : statut='verifiee', date_verification=now()."""
    issue = _get_issue_or_404(db, issue_id)
    _check_issue_access(issue, current_user)

    if issue.statut != "resolue":
        raise HTTPException(status_code=400, detail="Seule une Issue au statut 'resolue' peut être vérifiée")

    ancien_statut = issue.statut
    issue.statut = "verifiee"
    issue.date_verification = datetime.now()
    _log_issue_event(db, issue, current_user, "issue_verifiee", ancien_statut=ancien_statut, nouveau_statut="verifiee")

    db.commit()
    db.refresh(issue)
    return _format_issue_response(issue)
