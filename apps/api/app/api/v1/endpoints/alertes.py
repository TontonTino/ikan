"""
Endpoints Alertes — configuration et consultation (BF-12).
"""
from uuid import UUID
from typing import List
from datetime import datetime, timedelta, timezone

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, field_validator
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.api.deps import get_agency_manager, get_cx_or_agency_manager, get_cx_or_admin, get_db
from app.models.utilisateur import Utilisateur
from app.models.agence import Agence
from app.models.feedback import Feedback
from app.models.qr_code import QRCode
from app.models.categorie import Categorie
from app.models.analyse_ia import AnalyseIA
from app.models.enums import UserRole, SentimentType
from app.schemas.agence import SeuilAlerte
from app.services.acces_agence import verifier_acces_agence
from app.services.alertes_seuil import (
    DUREE_PERSISTANCE_SEUIL_CX,
    FENETRE_SATISFACTION,
    GraviteAlerte,
    ecart_sous_le_seuil,
    en_utc,
    gravite_alerte_seuil,
    satisfaction_a,
    sous_seuil_en_continu,
)
from app.services.alertes_episodes import (
    AgenceHorsPerimetre, CurseurInvalide, EpisodeDejaPrisEnCharge, EpisodeIntrouvable, EpisodeTermine, LIMITE_PAGE_DEFAUT, LIMITE_PAGE_MAX,
    LONGUEUR_MAX_COMMENTAIRE, duree_episode, episodes_ouverts_pour_lecture, lire_episode, lister_historique, nettoyer_commentaire,
    prendre_en_charge_episode, reconcilier_episodes, reconciliation_activee,
)
from app.services.plan_catalog import FEATURE_ALERTES
from app.services.plan_service import organisation_a_la_fonctionnalite
from app.services.dashboard_helpers import NOTE_FAIBLE_MAX

router = APIRouter()


class AlerteResponse(BaseModel):
    agence_id: UUID
    agence_nom: str
    taux_actuel: float
    seuil: float
    message: str
    # Gravité (AM-04), champs additifs : « critique » à 15 points ou plus sous le seuil, sinon « important »
    # (constante ECART_SEUIL_CRITIQUE_POINTS, services/alertes_seuil.py). ecart_seuil = points sous le seuil.
    gravite: GraviteAlerte = "important"
    ecart_seuil: float = 0.0
    # Épisode de l'alerte (cycle de vie, champs ADDITIFS : tous None si l'épisode n'existe pas encore ou si ALERTES_EPISODES=non). Une alerte prise en
    # charge RESTE dans la liste avec son état ; elle ne se termine que lorsque les données le montrent. `detecte_le` (première constatation) et
    # `debut_condition` (reconstitué d'après les avis, toujours approximatif) sont deux dates distinctes.
    episode_id: Optional[UUID] = None
    episode_statut: Optional[str] = None                     # « detectee » | « prise_en_charge »
    detecte_le: Optional[datetime] = None
    debut_condition: Optional[datetime] = None
    debut_approximatif: Optional[bool] = None
    debut_remontee_limitee: Optional[bool] = None
    pris_en_charge_le: Optional[datetime] = None
    pris_en_charge_par_nom: Optional[str] = None
    commentaire_prise_en_charge: Optional[str] = None


class AgenceSousSeuilResponse(BaseModel):
    """Agence actuellement sous son seuil (CX Manager). Champs additifs de GET /alertes, `alertes_seuil` est inchangé."""
    agence_id: UUID
    agence_nom: str
    taux_actuel: float
    seuil: float
    ecart_seuil: float          # points sous le seuil (> 0)
    depuis_plus_de_48h: bool    # restée sous le seuil en continu pendant 48 h : c'est ce qui déclenche l'alerte du CX Manager
    gravite: GraviteAlerte = "important"


class AlerteFeedbackResponse(BaseModel):
    feedback_id: UUID
    agence_id: UUID
    agence_nom: str
    note: int
    categorie_nom: str | None
    # 'note_basse' | 'sentiment_negatif' | 'note_basse_et_sentiment_negatif'
    raison: str
    commentaire: str | None
    date_soumission: datetime
    # Champ additif : statut de traitement de l'avis tel qu'en base (feedbacks.statut_traitement : « nouveau », « en_traitement »,
    # « en_cours »; jamais « resolu », ces avis sont exclus de la liste). None si la colonne est vide. Aucune règle d'alerte ne l'utilise.
    statut_traitement: str | None = None


class AlertesResponse(BaseModel):
    alertes_seuil: List[AlerteResponse]
    alertes_feedback: List[AlerteFeedbackResponse]
    # Champ additif (CX Manager) : toutes les agences ACTUELLEMENT sous leur seuil, y compris depuis moins de 48 h. Vide sinon.
    agences_sous_seuil: List[AgenceSousSeuilResponse] = []
    # False quand le forfait de l'organisation n'inclut pas les alertes : les listes sont alors vides
    # parce que la fonctionnalité est indisponible, PAS parce qu'il n'y a rien à signaler.
    alertes_incluses: bool = True


class SeuilUpdate(BaseModel):
    seuil_alerte: SeuilAlerte


def _evaluer_agences_seuil(db: Session, current_user: Utilisateur):
    """
    Satisfaction glissante (7 jours, au moins 3 avis) de chaque agence du périmètre de l'utilisateur.
    Retourne (instant, pour_cx, [(agence, avis, taux)]) ; les agences sans assez d'avis (taux None) sont omises.
    - Agency Manager : son agence. - CX Manager : agences ACTIVES de son organisation (jamais celles d'une autre).
    """
    maintenant = datetime.now(timezone.utc)
    pour_cx = current_user.role != UserRole.AGENCY_MANAGER

    if not pour_cx:
        agences = db.query(Agence).filter(Agence.id == current_user.agence_id).all()
    else:
        agences = db.query(Agence).filter(
            Agence.organisation_id == current_user.organisation_id,
            Agence.active == True,
        ).all()
    if not agences:
        return maintenant, pour_cx, []

    # Une seule requête : les avis nécessaires à la fenêtre de 7 jours, en remontant de 48 h pour le CX Manager.
    debut_donnees = maintenant - FENETRE_SATISFACTION - (DUREE_PERSISTANCE_SEUIL_CX if pour_cx else timedelta(0))
    lignes = (
        db.query(QRCode.agence_id, Feedback.date_soumission, Feedback.note)
        .join(Feedback, Feedback.qr_code_id == QRCode.id)
        .filter(
            QRCode.agence_id.in_([a.id for a in agences]),
            Feedback.date_soumission >= debut_donnees,
        )
        .all()
    )
    avis_par_agence: dict = {}
    for agence_id, date_soumission, note in lignes:
        avis_par_agence.setdefault(agence_id, []).append((en_utc(date_soumission), note))

    evaluations = []
    for agence in agences:
        avis = avis_par_agence.get(agence.id, [])
        _, taux = satisfaction_a(avis, maintenant)
        if taux is None:
            continue  # Pas assez de données pour déclencher une alerte
        evaluations.append((agence, avis, taux))
    return maintenant, pour_cx, evaluations


def _calculer_alertes_seuil(db: Session, current_user: Utilisateur) -> List[AlerteResponse]:
    """
    Alertes de seuil de satisfaction par agence (fenêtre glissante de 7 jours, au moins 3 avis).
    - Agency Manager (son agence) : IMMÉDIAT, dès que la satisfaction est sous le seuil.
    - CX Manager (agences actives de son organisation) : uniquement si la satisfaction est restée sous le
      seuil EN CONTINU pendant DUREE_PERSISTANCE_SEUIL_CX (48 h) — voir app/services/alertes_seuil.py.
    """
    maintenant, pour_cx, evaluations = _evaluer_agences_seuil(db, current_user)

    alertes: List[AlerteResponse] = []
    for agence, avis, taux in evaluations:
        if pour_cx:
            sous_le_seuil, _ = sous_seuil_en_continu(avis, agence.seuil_alerte, maintenant)
            if not sous_le_seuil:
                continue
            heures = int(DUREE_PERSISTANCE_SEUIL_CX.total_seconds() // 3600)
            message = (
                f"Satisfaction sous le seuil depuis plus de {heures} h — {agence.nom} : "
                f"{taux}% sur 7 jours, seuil de {agence.seuil_alerte}%"
            )
        else:
            if not taux < agence.seuil_alerte:
                continue
            message = f"Satisfaction en baisse — {agence.nom} : {taux}% cette semaine, sous le seuil de {agence.seuil_alerte}%"

        alertes.append(AlerteResponse(
            agence_id=agence.id,
            agence_nom=agence.nom,
            taux_actuel=taux,
            seuil=agence.seuil_alerte,
            message=message,
            gravite=gravite_alerte_seuil(taux, agence.seuil_alerte),
            ecart_seuil=float(ecart_sous_le_seuil(taux, agence.seuil_alerte)),
        ))

    return alertes


def _calculer_agences_sous_seuil(db: Session, current_user: Utilisateur) -> List[AgenceSousSeuilResponse]:
    """
    CX Manager : les agences ACTUELLEMENT sous leur seuil (satisfaction glissante de 7 jours, au moins 3 avis, strictement sous le
    seuil de l'agence), la plus en difficulté d'abord. `depuis_plus_de_48h` = restée sous le seuil en continu pendant 48 h (même
    règle que l'alerte). Une agence exactement au seuil n'est pas sous son seuil. Vide pour un Agency Manager.
    """
    if current_user.role == UserRole.AGENCY_MANAGER:
        return []
    maintenant, _, evaluations = _evaluer_agences_seuil(db, current_user)

    agences_sous_seuil: List[AgenceSousSeuilResponse] = []
    for agence, avis, taux in evaluations:
        if not taux < agence.seuil_alerte:
            continue
        persistante, _ = sous_seuil_en_continu(avis, agence.seuil_alerte, maintenant)
        agences_sous_seuil.append(AgenceSousSeuilResponse(
            agence_id=agence.id,
            agence_nom=agence.nom,
            taux_actuel=taux,
            seuil=agence.seuil_alerte,
            ecart_seuil=float(ecart_sous_le_seuil(taux, agence.seuil_alerte)),
            depuis_plus_de_48h=persistante,
            gravite=gravite_alerte_seuil(taux, agence.seuil_alerte),
        ))
    agences_sous_seuil.sort(key=lambda a: (-a.ecart_seuil, a.agence_nom.lower()))
    return agences_sous_seuil


def _raison_alerte_feedback(note: int, sentiment) -> "str | None":
    """Motif d'alerte d'un feedback : note <= 2 et/ou sentiment IA négatif (None = pas d'alerte)."""
    note_basse = note <= NOTE_FAIBLE_MAX
    sentiment_negatif = sentiment == SentimentType.NEGATIF
    if note_basse and sentiment_negatif:
        return "note_basse_et_sentiment_negatif"
    if note_basse:
        return "note_basse"
    if sentiment_negatif:
        return "sentiment_negatif"
    return None


def _calculer_alertes_feedback(db: Session, current_user: Utilisateur) -> List[AlerteFeedbackResponse]:
    """
    Alertes individuelles par feedback : mauvaise note (<= 2) OU sentiment IA négatif
    (AnalyseIA.sentiment == NEGATIF ; un feedback sans analyse n'est pas considéré négatif).
    - Agency Manager (sa propre agence) : alerte IMMÉDIATE.
    - CX Manager (son organisation) : seulement si le feedback n'est pas traité (statut != 'resolu') une fois
      le délai configuré par ce CX Manager (delai_alerte_negatif_heures) écoulé depuis sa soumission.
    Une alerte disparaît dès que le feedback est marqué « resolu ». Calcul à la volée, sans cache ni job.
    La catégorie (et son étiquette informative est_categorie_suggestion) ne déclenche aucune alerte.
    """
    query = (
        db.query(Feedback, Categorie, Agence, AnalyseIA)
        .join(QRCode, Feedback.qr_code_id == QRCode.id)
        .join(Agence, QRCode.agence_id == Agence.id)
        .outerjoin(Categorie, Feedback.categorie_id == Categorie.id)
        .outerjoin(AnalyseIA, AnalyseIA.feedback_id == Feedback.id)
        .filter(
            Feedback.statut_traitement != "resolu",
            or_(Feedback.note <= NOTE_FAIBLE_MAX, AnalyseIA.sentiment == SentimentType.NEGATIF),
        )
    )
    if current_user.role == UserRole.AGENCY_MANAGER:
        query = query.filter(Agence.id == current_user.agence_id)
    else:
        query = query.filter(Agence.organisation_id == current_user.organisation_id, Agence.active == True)

    maintenant = datetime.now(timezone.utc)
    apres_delai = maintenant - timedelta(hours=current_user.delai_alerte_negatif_heures)

    alertes: List[AlerteFeedbackResponse] = []
    for feedback, categorie, agence, analyse in query.all():
        if current_user.role != UserRole.AGENCY_MANAGER and en_utc(feedback.date_soumission) > apres_delai:
            continue  # CX Manager : le chef d'agence a encore le temps de traiter ce feedback
        raison = _raison_alerte_feedback(feedback.note, analyse.sentiment if analyse else None)
        if raison is None:
            continue

        alertes.append(AlerteFeedbackResponse(
            feedback_id=feedback.id,
            agence_id=agence.id,
            agence_nom=agence.nom,
            note=feedback.note,
            categorie_nom=categorie.nom if categorie else None,
            raison=raison,
            commentaire=feedback.commentaire,
            date_soumission=feedback.date_soumission,
            statut_traitement=feedback.statut_traitement,
        ))

    alertes.sort(key=lambda a: en_utc(a.date_soumission), reverse=True)
    return alertes


@router.get("/", response_model=AlertesResponse)
def list_alertes(
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
):
    """
    Retourne les alertes actives : seuil de satisfaction par agence (inchangé)
    ET alertes individuelles par feedback (nouvelle catégorie), dans deux listes
    séparées d'un même payload. BF-12 — Agency Manager et CX Manager uniquement.
    """
    # Alertes = fonctionnalité Starter+. Listes vides (et non 403) pour un forfait
    # Gratuit : plusieurs écrans chargent cet endpoint avec d'autres appels.
    if not organisation_a_la_fonctionnalite(current_user.organisation_id, FEATURE_ALERTES, db):
        return AlertesResponse(alertes_seuil=[], alertes_feedback=[], alertes_incluses=False)

    reponse = AlertesResponse(
        alertes_seuil=_calculer_alertes_seuil(db, current_user),
        alertes_feedback=_calculer_alertes_feedback(db, current_user),
        agences_sous_seuil=_calculer_agences_sous_seuil(db, current_user),
    )
    # Épisodes d'alerte de seuil : écrits EN SILENCE, APRÈS le calcul de la réponse, qu'ils ne peuvent ni modifier ni casser (ne lève jamais ;
    # n'écrit que s'il y a une différence ; interrupteur ALERTES_EPISODES=non). Voir app/services/alertes_episodes.py.
    reconcilier_episodes(db, current_user)
    # Informations d'épisode ajoutées à chaque alerte de seuil (additif ; sans épisode, les champs restent None et la réponse est celle d'avant).
    episodes = episodes_ouverts_pour_lecture(db, [a.agence_id for a in reponse.alertes_seuil])
    if episodes:
        reponse.alertes_seuil = [_avec_episode(a, episodes.get(a.agence_id)) for a in reponse.alertes_seuil]
    return reponse


def _avec_episode(alerte: AlerteResponse, episode) -> AlerteResponse:
    if episode is None:
        return alerte
    return alerte.model_copy(update=dict(
        episode_id=episode.id, episode_statut=episode.statut, detecte_le=en_utc(episode.detecte_le), debut_condition=en_utc(episode.debut_condition),
        debut_approximatif=episode.debut_approximatif, debut_remontee_limitee=episode.debut_remontee_limitee,
        pris_en_charge_le=en_utc(episode.pris_en_charge_le) if episode.pris_en_charge_le else None,
        pris_en_charge_par_nom=episode.pris_en_charge_par_nom, commentaire_prise_en_charge=episode.commentaire_prise_en_charge,
    ))


class PriseEnChargeRequest(BaseModel):
    """Corps (facultatif) de la prise en charge : un commentaire de 500 caractères au plus, espaces de début et de fin retirés ; vide = absent."""
    commentaire: Optional[str] = None

    @field_validator("commentaire", mode="before")
    @classmethod
    def _commentaire(cls, valeur):
        if valeur is None:
            return None
        if not isinstance(valeur, str):
            raise ValueError("Le commentaire doit être un texte.")
        propre = nettoyer_commentaire(valeur)
        if propre is not None and len(propre) > LONGUEUR_MAX_COMMENTAIRE:
            raise ValueError(f"Le commentaire ne peut pas dépasser {LONGUEUR_MAX_COMMENTAIRE} caractères.")
        return propre


class EpisodeResponse(BaseModel):
    episode_id: UUID
    agence_id: UUID
    statut: str
    detecte_le: datetime
    debut_condition: datetime
    debut_approximatif: bool
    debut_remontee_limitee: bool
    pris_en_charge_le: Optional[datetime] = None
    pris_en_charge_par_nom: Optional[str] = None
    commentaire_prise_en_charge: Optional[str] = None


@router.post("/episodes/{episode_id}/prendre-en-charge", response_model=EpisodeResponse)
def prendre_en_charge(
    episode_id: UUID,
    request: Request,
    data: Optional[PriseEnChargeRequest] = None,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_agency_manager),
):
    """
    Prise en charge d'une alerte de seuil par le Responsable d'agence de SON agence (CX Manager : 403, il consulte ; Administrateur : refusé ; autre agence ou
    autre organisation : 404, comme un identifiant inconnu, sans rien révéler). Valable seulement si l'épisode est « detectee » (409 sinon : déjà pris en
    charge, ou terminé). Atomique : deux clics simultanés = une seule prise en charge, l'autre reçoit 409. L'alerte reste dans la liste avec son état.
    """
    if not organisation_a_la_fonctionnalite(current_user.organisation_id, FEATURE_ALERTES, db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Les alertes ne sont pas incluses dans le forfait de votre organisation.")
    try:
        episode = prendre_en_charge_episode(db, episode_id, current_user, data.commentaire if data else None, requete=request)
        db.commit()
    except EpisodeIntrouvable:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alerte introuvable.")
    except EpisodeTermine:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Cette alerte est terminée : les données ne montrent plus de dépassement du seuil. Il n'y a plus rien à prendre en charge.")
    except EpisodeDejaPrisEnCharge:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Cette alerte est déjà prise en charge.")
    db.refresh(episode)
    return EpisodeResponse(
        episode_id=episode.id, agence_id=episode.agence_id, statut=episode.statut, detecte_le=en_utc(episode.detecte_le),
        debut_condition=en_utc(episode.debut_condition), debut_approximatif=episode.debut_approximatif, debut_remontee_limitee=episode.debut_remontee_limitee,
        pris_en_charge_le=en_utc(episode.pris_en_charge_le) if episode.pris_en_charge_le else None,
        pris_en_charge_par_nom=episode.pris_en_charge_par_nom, commentaire_prise_en_charge=episode.commentaire_prise_en_charge,
    )


# ── Historique des épisodes (cycle de vie des alertes, PR 4/5) : LECTURE SEULE ────────────────────────────────────────────────────────────

class EpisodeHistorique(BaseModel):
    """Un épisode d'alerte de seuil. Les dates sont en UTC. AUCUNE durée n'est certaine : `debut_condition` est reconstitué d'après les avis
    (`debut_approximatif`), éventuellement tronqué (`debut_remontee_limitee` : « depuis au moins … »), `duree_minutes` hérite de ces limites."""
    episode_id: UUID
    agence_id: UUID
    agence_nom: str
    type: str
    statut: str                                       # « detectee » | « prise_en_charge » | « terminee »
    gravite_ouverture: Optional[str] = None
    detecte_le: datetime                              # première constatation par IKAN (date exacte, distincte du début)
    debut_condition: datetime
    debut_approximatif: bool
    debut_remontee_limitee: bool
    fin_condition: Optional[datetime] = None          # terminé seulement
    terminee_le: Optional[datetime] = None
    fin_cause: Optional[str] = None                   # « retablie » | « donnees_insuffisantes » | « seuil_modifie » | « agence_desactivee »
    duree_minutes: int
    duree_approximative: bool                         # vrai dès que le début est approximatif
    duree_minimale: bool                              # vrai si le début est tronqué : la durée est un MINIMUM
    duree_en_cours: bool                              # vrai si l'épisode n'est pas terminé : durée jusqu'à maintenant
    taux_ouverture: float
    seuil_ouverture: float
    taux_fermeture: Optional[float] = None
    seuil_fermeture: Optional[float] = None
    pris_en_charge_le: Optional[datetime] = None
    pris_en_charge_par_nom: Optional[str] = None


class EpisodeDetail(EpisodeHistorique):
    """Détail d'un épisode (tiroir de la PR 5) : tout l'historique, plus le commentaire de prise en charge et le délai (dates exactes d'IKAN)."""
    commentaire_prise_en_charge: Optional[str] = None
    delai_prise_en_charge_minutes: Optional[int] = None   # detecte_le -> pris_en_charge_le : deux instants constatés, donc exact
    created_at: datetime


class HistoriqueEpisodesResponse(BaseModel):
    episodes: List[EpisodeHistorique]
    # Pagination PAR CURSEUR : passer `curseur_suivant` dans `curseur` pour la page suivante ; None = dernière page (une page vide est une réponse normale).
    curseur_suivant: Optional[str] = None
    limite: int
    # False (liste vide) quand le forfait n'inclut pas les alertes ou que l'interrupteur ALERTES_EPISODES=non est coupé.
    episodes_disponibles: bool = True
    alertes_incluses: bool = True


def _historique(episode, agence_nom: str, maintenant: datetime) -> dict:
    minutes, en_cours = duree_episode(episode, maintenant)
    optionnel = lambda valeur: en_utc(valeur) if valeur else None  # noqa: E731
    return dict(
        episode_id=episode.id, agence_id=episode.agence_id, agence_nom=agence_nom, type=episode.type, statut=episode.statut,
        gravite_ouverture=episode.gravite_ouverture, detecte_le=en_utc(episode.detecte_le), debut_condition=en_utc(episode.debut_condition),
        debut_approximatif=episode.debut_approximatif, debut_remontee_limitee=episode.debut_remontee_limitee,
        fin_condition=optionnel(episode.fin_condition), terminee_le=optionnel(episode.terminee_le), fin_cause=episode.fin_cause,
        duree_minutes=minutes, duree_approximative=episode.debut_approximatif, duree_minimale=episode.debut_remontee_limitee, duree_en_cours=en_cours,
        taux_ouverture=episode.taux_ouverture, seuil_ouverture=episode.seuil_ouverture, taux_fermeture=episode.taux_fermeture,
        seuil_fermeture=episode.seuil_fermeture, pris_en_charge_le=optionnel(episode.pris_en_charge_le), pris_en_charge_par_nom=episode.pris_en_charge_par_nom,
    )


@router.get("/episodes", response_model=HistoriqueEpisodesResponse)
def lister_episodes(
    statut: Optional[List[Literal["detectee", "prise_en_charge", "terminee"]]] = Query(None, description="Un ou plusieurs statuts (paramètre répété)."),
    agence_id: Optional[UUID] = Query(None),
    du: Optional[datetime] = Query(None, description="Début de la condition à partir de cet instant (UTC si sans fuseau)."),
    au: Optional[datetime] = Query(None, description="Début de la condition jusqu'à cet instant (UTC si sans fuseau)."),
    limite: int = Query(LIMITE_PAGE_DEFAUT, ge=1, le=LIMITE_PAGE_MAX),
    curseur: Optional[str] = Query(None, max_length=200),
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
):
    """
    Historique des épisodes d'alerte de seuil (actifs et terminés), du plus récent au plus ancien (début de la condition). Agency Manager : sa seule agence ;
    CX Manager : son organisation, limité aux épisodes que son alerte aurait montrés (règle des 48 h, voir services/alertes_episodes.py) ; Administrateur : 403.
    Pagination par curseur, `limite` de 1 à 100 (20 par défaut). LECTURE SEULE : ne déclenche ni écriture ni réconciliation (un épisode ouvert reflète donc
    la dernière lecture de GET /alertes/).
    """
    if not organisation_a_la_fonctionnalite(current_user.organisation_id, FEATURE_ALERTES, db):
        return HistoriqueEpisodesResponse(episodes=[], limite=limite, episodes_disponibles=False, alertes_incluses=False)
    if not reconciliation_activee():
        return HistoriqueEpisodesResponse(episodes=[], limite=limite, episodes_disponibles=False)
    du, au = _en_utc_ou_none(du), _en_utc_ou_none(au)
    if du is not None and au is not None and du > au:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="La période est invalide : « du » doit précéder « au ».")
    maintenant = datetime.now(timezone.utc)
    try:
        lignes, suivant = lister_historique(db, current_user, statuts=statut, agence_id=agence_id, du=du, au=au, limite=limite, curseur=curseur, maintenant=maintenant)
    except CurseurInvalide:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Le curseur de pagination est invalide.")
    except AgenceHorsPerimetre:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agence introuvable.")
    return HistoriqueEpisodesResponse(
        episodes=[EpisodeHistorique(**_historique(e, nom, maintenant)) for e, nom in lignes], curseur_suivant=suivant, limite=limite,
    )


@router.get("/episodes/{episode_id}", response_model=EpisodeDetail)
def detail_episode(
    episode_id: UUID,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_agency_manager),
):
    """
    Détail d'un épisode. Inconnu, d'une autre agence, d'une autre organisation, ou (CX Manager) pas encore visible selon la règle des 48 h : 404 identique,
    sans rien révéler. Lecture seule.
    """
    if not organisation_a_la_fonctionnalite(current_user.organisation_id, FEATURE_ALERTES, db):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Les alertes ne sont pas incluses dans le forfait de votre organisation.")
    if not reconciliation_activee():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alerte introuvable.")
    maintenant = datetime.now(timezone.utc)
    try:
        episode, agence_nom = lire_episode(db, current_user, episode_id, maintenant)
    except EpisodeIntrouvable:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alerte introuvable.")
    delai = None
    if episode.pris_en_charge_le is not None:
        delai = max(0, int((en_utc(episode.pris_en_charge_le) - en_utc(episode.detecte_le)).total_seconds() // 60))
    return EpisodeDetail(**_historique(episode, agence_nom, maintenant), commentaire_prise_en_charge=episode.commentaire_prise_en_charge,
                         delai_prise_en_charge_minutes=delai, created_at=en_utc(episode.created_at))


def _en_utc_ou_none(valeur: Optional[datetime]) -> Optional[datetime]:
    return en_utc(valeur) if valeur is not None else None


@router.patch("/agences/{agence_id}/seuil")
def update_seuil_alerte(
    agence_id: UUID,
    data: SeuilUpdate,
    db: Session = Depends(get_db),
    current_user: Utilisateur = Depends(get_cx_or_admin),
):
    """Configure le seuil d'alerte d'une agence (Admin ou CX Manager)."""
    agence = db.query(Agence).filter(Agence.id == agence_id).first()
    if not agence:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Agence introuvable")
    # Un CX Manager ne configure que les agences de SON organisation (l'Admin, lui,
    # configure les seuils d'alerte par droit structurel — matrice des permissions).
    # Droit STRUCTUREL explicite de l'Admin (politique existante, inchangée) ; le CX Manager
    # reste limité aux agences de son organisation.
    verifier_acces_agence(db, current_user, agence_id, autoriser_admin=True)
    agence.seuil_alerte = data.seuil_alerte
    db.commit()
    return {"message": f"Seuil mis à jour : {data.seuil_alerte}%"}
