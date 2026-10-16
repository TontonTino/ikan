"""
Endpoints Recommandations — consultation par les Agency Managers, et vue
consolidée multi-agences pour le CX Manager (aide à la décision stratégique).
"""
from uuid import UUID
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import case, func
from datetime import datetime

from app.api.deps import get_cx_or_agency_manager, get_db
from app.models.utilisateur import Utilisateur
from app.models.recommandation import Recommandation
from app.models.historique_feedback import HistoriqueFeedback
from app.models.enums import PriorityLevel, UserRole
from app.services.acces_agence import verifier_acces_agence
from app.services.ai.recommandations import SOURCE_RECOMMANDATIONS
from app.schemas.dashboard import SourceAnalyse

router = APIRouter()


class RecommandationResponse(BaseModel):
    id: UUID
    analyse_ia_id: UUID
    contenu: str
    priorite: PriorityLevel
    date_generation: datetime
    traitee: bool
    # Origine réelle du contenu (templates par règles, aucun LLM).
    source: SourceAnalyse = SOURCE_RECOMMANDATIONS

    model_config = {"from_attributes": True}


class RecommandationOrgResponse(RecommandationResponse):
    agence_id: UUID
    agence_nom: str


# Ordre de criticité décroissante pour le tri par défaut de la vue consolidée
@router.get("/agences/{agence_id}", response_model=List[RecommandationResponse])
def list_recommandations_agence(
    agence_id: UUID,
    response: Response,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """Liste les recommandations non traitées pour une agence (CX Manager / Agency Manager)."""
    verifier_acces_agence(db, current_user, agence_id)

    from app.models.analyse_ia import AnalyseIA
    from app.models.feedback import Feedback
    from app.models.qr_code import QRCode

    query = (
        db.query(Recommandation)
        .join(AnalyseIA, Recommandation.analyse_ia_id == AnalyseIA.id)
        .join(Feedback, AnalyseIA.feedback_id == Feedback.id)
        .join(QRCode, Feedback.qr_code_id == QRCode.id)
        .filter(
            QRCode.agence_id == agence_id,
            Recommandation.traitee == False,
        )
        .order_by(Recommandation.date_generation.desc())
    )
    response.headers["X-Total-Count"] = str(query.order_by(None).count())
    return query.offset(offset).limit(limit).all()


class RecommandationsAgenceGroupe(BaseModel):
    agence_id: UUID
    agence_nom: str
    nombre: int                      # recommandations de l'agence dans l'état demandé (toutes, pas seulement celles renvoyées)
    plus_ancienne: datetime          # date de génération de la plus ancienne
    recommandations: List[RecommandationResponse]


class RecommandationsGroupeesResponse(BaseModel):
    groupes: List[RecommandationsAgenceGroupe]
    total: int


NB_PAR_GROUPE = 20


@router.get("/organisation/groupees", response_model=RecommandationsGroupeesResponse)
def list_recommandations_groupees(
    traitee: bool = Query(False, description="false (défaut) : à traiter ; true : traitées."),
    agence_id: Optional[UUID] = Query(None, description="Limite à une agence de l'organisation."),
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
):
    """
    CX-09 : recommandations regroupées par agence (nom, nombre, la plus ancienne), la plus chargée d'abord (puis la plus ancienne en
    attente, puis le nom). Une agence sans recommandation dans l'état demandé n'apparaît pas. `NB_PAR_GROUPE` recommandations au plus
    par agence, de la plus prioritaire à la moins prioritaire. Périmètre : agences actives de l'organisation (Agency Manager : la sienne).
    """
    from app.models.analyse_ia import AnalyseIA
    from app.models.feedback import Feedback
    from app.models.qr_code import QRCode
    from app.models.agence import Agence

    if not current_user.organisation_id:
        return RecommandationsGroupeesResponse(groupes=[], total=0)

    def base(*colonnes):
        requete = (
            db.query(*colonnes)
            .select_from(Recommandation)
            .join(AnalyseIA, Recommandation.analyse_ia_id == AnalyseIA.id)
            .join(Feedback, AnalyseIA.feedback_id == Feedback.id)
            .join(QRCode, Feedback.qr_code_id == QRCode.id)
            .join(Agence, QRCode.agence_id == Agence.id)
            .filter(Agence.active == True, Agence.organisation_id == current_user.organisation_id, Recommandation.traitee == traitee)  # noqa: E712
        )
        if current_user.role == UserRole.AGENCY_MANAGER:
            requete = requete.filter(Agence.id == current_user.agence_id)
        if agence_id:
            requete = requete.filter(Agence.id == agence_id)
        return requete

    agregats = (
        base(Agence.id, Agence.nom, func.count(Recommandation.id), func.min(Recommandation.date_generation))
        .group_by(Agence.id, Agence.nom)
        .order_by(func.count(Recommandation.id).desc(), func.min(Recommandation.date_generation).asc(), Agence.nom.asc())
        .all()
    )
    if not agregats:
        return RecommandationsGroupeesResponse(groupes=[], total=0)

    priorite = case(
        (Recommandation.priorite == PriorityLevel.CRITICAL, 0), (Recommandation.priorite == PriorityLevel.HIGH, 1),
        (Recommandation.priorite == PriorityLevel.MEDIUM, 2), (Recommandation.priorite == PriorityLevel.LOW, 3), else_=99,
    )
    rang = func.row_number().over(partition_by=Agence.id, order_by=(priorite, Recommandation.date_generation.desc(), Recommandation.id)).label("rang")
    sous_requete = (
        base(Agence.id.label("agence_id"), Recommandation.id, Recommandation.analyse_ia_id, Recommandation.contenu, Recommandation.priorite,
             Recommandation.date_generation, Recommandation.traitee, rang)
        .filter(Agence.id.in_([a[0] for a in agregats]))
        .subquery()
    )
    lignes = (
        db.query(sous_requete).filter(sous_requete.c.rang <= NB_PAR_GROUPE)
        .order_by(sous_requete.c.agence_id, sous_requete.c.rang).all()
    )
    par_agence: dict = {}
    for ligne in lignes:
        par_agence.setdefault(ligne.agence_id, []).append(RecommandationResponse(
            id=ligne.id, analyse_ia_id=ligne.analyse_ia_id, contenu=ligne.contenu, priorite=ligne.priorite,
            date_generation=ligne.date_generation, traitee=ligne.traitee,
        ))
    groupes = [
        RecommandationsAgenceGroupe(agence_id=a_id, agence_nom=nom, nombre=int(nombre), plus_ancienne=plus_ancienne, recommandations=par_agence.get(a_id, []))
        for a_id, nom, nombre, plus_ancienne in agregats
    ]
    return RecommandationsGroupeesResponse(groupes=groupes, total=sum(g.nombre for g in groupes))


@router.get("/organisation", response_model=List[RecommandationOrgResponse])
def list_recommandations_organisation(
    response: Response,
    traitee: Optional[bool] = Query(
        None, description="Filtre par statut : true=traitées, false ou absent=non traitées (défaut)"
    ),
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """
    Vue consolidée des recommandations IA de toutes les agences de l'organisation
    du CX Manager connecté (aide à la décision stratégique réseau). Pour un Agency
    Manager, la même vue est restreinte à SA seule agence.
    Triée par criticité décroissante puis par date la plus récente.
    Par défaut, ne montre que les recommandations non traitées.
    """
    from app.models.analyse_ia import AnalyseIA
    from app.models.feedback import Feedback
    from app.models.qr_code import QRCode
    from app.models.agence import Agence

    query = (
        db.query(Recommandation, Agence.id, Agence.nom)
        .join(AnalyseIA, Recommandation.analyse_ia_id == AnalyseIA.id)
        .join(Feedback, AnalyseIA.feedback_id == Feedback.id)
        .join(QRCode, Feedback.qr_code_id == QRCode.id)
        .join(Agence, QRCode.agence_id == Agence.id)
        .filter(Agence.active == True)
    )
    if current_user.organisation_id:
        query = query.filter(Agence.organisation_id == current_user.organisation_id)
    if current_user.role == UserRole.AGENCY_MANAGER:
        query = query.filter(Agence.id == current_user.agence_id)

    query = query.filter(Recommandation.traitee == (traitee if traitee is not None else False))
    response.headers["X-Total-Count"] = str(query.order_by(None).count())
    priority_order = case(
        (Recommandation.priorite == PriorityLevel.CRITICAL, 0),
        (Recommandation.priorite == PriorityLevel.HIGH, 1),
        (Recommandation.priorite == PriorityLevel.MEDIUM, 2),
        (Recommandation.priorite == PriorityLevel.LOW, 3),
        else_=99,
    )
    rows = query.order_by(priority_order, Recommandation.date_generation.desc()).offset(offset).limit(limit).all()

    return [
        RecommandationOrgResponse(
            id=reco.id,
            analyse_ia_id=reco.analyse_ia_id,
            contenu=reco.contenu,
            priorite=reco.priorite,
            date_generation=reco.date_generation,
            traitee=reco.traitee,
            agence_id=agence_id,
            agence_nom=agence_nom,
        )
        for reco, agence_id, agence_nom in rows
    ]


@router.patch("/{recommandation_id}/traiter")
def marquer_traitee(
    recommandation_id: UUID,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
):
    from app.models.analyse_ia import AnalyseIA
    from app.models.feedback import Feedback
    from app.models.qr_code import QRCode

    reco = db.query(Recommandation).filter(Recommandation.id == recommandation_id).first()
    if not reco:
        raise HTTPException(status_code=404, detail="Recommandation introuvable")

    agence_id = (
        db.query(QRCode.agence_id)
        .join(Feedback, Feedback.qr_code_id == QRCode.id)
        .join(AnalyseIA, AnalyseIA.feedback_id == Feedback.id)
        .filter(AnalyseIA.id == reco.analyse_ia_id)
        .scalar()
    )
    verifier_acces_agence(db, current_user, agence_id)

    if not reco.traitee:
        reco.traitee = True
        _journaliser(db, current_user, reco, "recommandation_traitee", "a_traiter", "traitee", "Recommandation marquée comme traitée")
    db.commit()
    return {"message": "Recommandation marquée comme traitée"}


def _journaliser(db: Session, user: Utilisateur, reco: Recommandation, type_evenement: str, ancien: str, nouveau: str, details: str) -> None:
    """Trace qui a fait quoi et quand dans l'historique EXISTANT de l'avis à l'origine de la recommandation (aucune nouvelle table)."""
    from app.models.analyse_ia import AnalyseIA
    from app.models.agence import Agence
    from app.models.feedback import Feedback
    from app.models.qr_code import QRCode

    ligne = (
        db.query(Feedback.id, Agence.id, Agence.nom)
        .join(AnalyseIA, AnalyseIA.feedback_id == Feedback.id)
        .join(QRCode, Feedback.qr_code_id == QRCode.id)
        .join(Agence, QRCode.agence_id == Agence.id)
        .filter(AnalyseIA.id == reco.analyse_ia_id)
        .first()
    )
    if ligne is None:
        return
    feedback_id, agence_id, agence_nom = ligne
    db.add(HistoriqueFeedback(
        feedback_id=feedback_id, agence_id=agence_id, agence_nom=agence_nom, utilisateur_id=user.id,
        auteur_nom=f"{user.prenom} {user.nom}", auteur_role=user.role.value,
        type_evenement=type_evenement, ancien_statut=ancien, nouveau_statut=nouveau, details=details,
    ))


@router.patch("/{recommandation_id}/rouvrir")
def remettre_a_traiter(
    recommandation_id: UUID,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
):
    """
    Remet une recommandation TRAITÉE à l'état « à traiter » (CX-09 : le statut n'est plus à sens unique). Même périmètre que
    « traiter » (CX Manager : son organisation ; Agency Manager : son agence). Refusée (409) si elle est déjà à traiter.
    L'opération est tracée dans l'historique de l'avis (qui, quand).
    """
    from app.models.analyse_ia import AnalyseIA
    from app.models.feedback import Feedback
    from app.models.qr_code import QRCode

    reco = db.query(Recommandation).filter(Recommandation.id == recommandation_id).first()
    if not reco:
        raise HTTPException(status_code=404, detail="Recommandation introuvable")

    agence_id = (
        db.query(QRCode.agence_id)
        .join(Feedback, Feedback.qr_code_id == QRCode.id)
        .join(AnalyseIA, AnalyseIA.feedback_id == Feedback.id)
        .filter(AnalyseIA.id == reco.analyse_ia_id)
        .scalar()
    )
    verifier_acces_agence(db, current_user, agence_id)

    if not reco.traitee:
        raise HTTPException(status_code=409, detail="Cette recommandation est déjà à traiter.")
    reco.traitee = False
    _journaliser(db, current_user, reco, "recommandation_rouverte", "traitee", "a_traiter", "Recommandation remise à traiter")
    db.commit()
    return {"message": "Recommandation remise à traiter"}
