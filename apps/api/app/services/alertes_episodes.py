"""
Épisodes d'alerte de seuil : ouverture et fin, écrites EN SILENCE à la lecture de GET /alertes/ (cycle de vie des alertes, PR 2/5).

Les alertes de seuil restent calculées à chaque lecture (app/services/alertes_seuil.py, inchangé). Ce module en garde la mémoire :
 - un épisode S'OUVRE quand la satisfaction glissante d'une agence passe sous son seuil (≥ 3 avis sur 7 jours, strictement sous le seuil) ;
 - il SE TERMINE quand les données montrent que ce n'est plus vrai, avec la cause : `retablie` (au-dessus du seuil), `donnees_insuffisantes`
   (moins de 3 avis : la fenêtre s'est vidée, ce n'est PAS une amélioration), `seuil_modifie` (la condition aurait encore été vraie au seuil
   d'ouverture), `agence_desactivee` ;
 - un retour du problème après une fin ouvre un NOUVEL épisode ; l'ancien reste.

Honnêteté des dates : `detecte_le` est l'instant où IKAN l'a constaté ; `debut_condition` est RECONSTITUÉ d'après les avis (immuables et horodatés)
avec la logique existante `historique_satisfaction`, en appliquant le SEUIL ACTUEL au passé : il est donc toujours marqué approximatif, et
`debut_remontee_limitee` si la reconstitution a atteint sa limite (REMONTEE_DEBUT). Aucun épisode passé n'est fabriqué.

Les 48 h de visibilité du CX Manager ne sont PAS touchées : elles restent calculées par `sous_seuil_en_continu`. Un épisode est un fait de l'agence ;
l'ouverture et la fin ne dépendent pas du rôle de l'appelant (seul le périmètre lu change : Agency Manager = son agence, CX Manager = son organisation).

La lecture ne doit JAMAIS casser à cause des épisodes : `reconcilier_episodes` ne lève jamais, travaille dans sa propre session (annulée en cas d'erreur,
seul le type de l'erreur est journalisé techniquement) et n'écrit RIEN s'il n'y a pas de différence. Interrupteur d'urgence : ALERTES_EPISODES=non.
"""
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional, Sequence

from sqlalchemy import select, text, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.agence import Agence
from app.models.alerte_episode import (
    AlerteEpisode, FIN_AGENCE_DESACTIVEE, FIN_DONNEES_INSUFFISANTES, FIN_RETABLIE, FIN_SEUIL_MODIFIE,
    STATUT_DETECTEE, STATUT_PRISE_EN_CHARGE, STATUT_TERMINEE, TYPE_SEUIL_SATISFACTION,
)
from app.models.enums import UserRole
from app.models.feedback import Feedback
from app.models.qr_code import QRCode
from app.services import journal_audit as journal
from app.services.alertes_seuil import (
    FENETRE_SATISFACTION, Avis, en_utc, gravite_alerte_seuil, historique_satisfaction, satisfaction_a,
)

technique = logging.getLogger("ikan.alertes_episodes")

# Jusqu'où l'on remonte dans les avis pour reconstituer le début (ou la fin) d'un épisode. Au-delà : « depuis plus de 30 jours ».
REMONTEE_DEBUT = timedelta(days=30)
# Valeurs (sans casse) de ALERTES_EPISODES qui coupent entièrement la réconciliation. Tout le reste, y compris l'absence de valeur : actif.
VALEURS_DESACTIVEES = frozenset({"non", "no", "false", "0", "off"})


def reconciliation_activee() -> bool:
    """Interrupteur d'urgence : ALERTES_EPISODES=non désactive TOUTE la réconciliation (aucune lecture ni écriture d'épisode)."""
    return str(settings.ALERTES_EPISODES).strip().lower() not in VALEURS_DESACTIVEES


# ── Logique PURE (aucun accès base) ──────────────────────────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class EtatAgence:
    """Situation d'une agence à l'instant de la lecture. `taux` est None s'il y a moins de 3 avis dans la fenêtre de 7 jours."""
    agence_id: uuid.UUID
    organisation_id: uuid.UUID
    nom: str
    seuil: float
    taux: Optional[float]
    nombre_retours_clients: int
    active: bool = True

    @property
    def condition_vraie(self) -> bool:
        return self.active and self.taux is not None and self.taux < self.seuil


@dataclass(frozen=True)
class EpisodeOuvert:
    id: uuid.UUID
    agence_id: uuid.UUID
    seuil_ouverture: float
    debut_condition: datetime


@dataclass(frozen=True)
class Plan:
    """Ce qu'il faut écrire : agences dont il manque l'épisode, et épisodes ouverts dont la condition n'est plus remplie (avec la cause)."""
    ouvertures: tuple = ()
    fermetures: tuple = ()          # tuples (EpisodeOuvert, cause, EtatAgence)

    @property
    def vide(self) -> bool:
        return not self.ouvertures and not self.fermetures


def cause_de_fin(etat: EtatAgence, episode: EpisodeOuvert) -> Optional[str]:
    """Cause de fin d'un épisode ouvert, ou None si la condition est toujours remplie (l'épisode continue)."""
    if not etat.active:
        return FIN_AGENCE_DESACTIVEE
    if etat.taux is None:
        return FIN_DONNEES_INSUFFISANTES
    if etat.taux < etat.seuil:
        return None
    if etat.seuil != episode.seuil_ouverture and etat.taux < episode.seuil_ouverture:
        return FIN_SEUIL_MODIFIE       # au seuil d'ouverture, l'agence serait encore sous le seuil : c'est la règle qui a changé
    return FIN_RETABLIE


def planifier(etats: Sequence[EtatAgence], ouverts: Sequence[EpisodeOuvert]) -> Plan:
    """Compare l'état courant des agences aux épisodes ouverts. Idempotente : appliquée deux fois, la seconde ne trouve plus rien à faire."""
    ouvert_par_agence = {e.agence_id: e for e in ouverts}
    ouvertures, fermetures = [], []
    for etat in etats:
        episode = ouvert_par_agence.get(etat.agence_id)
        if episode is None:
            if etat.condition_vraie:
                ouvertures.append(etat)
            continue
        cause = cause_de_fin(etat, episode)
        if cause is not None:
            fermetures.append((episode, cause, etat))
    return Plan(tuple(ouvertures), tuple(fermetures))


def _sous_le_seuil(taux: Optional[float], seuil: float) -> bool:
    return taux is not None and taux < seuil


def reconstituer_debut(avis: Sequence[Avis], seuil: float, maintenant: datetime, remontee: timedelta = REMONTEE_DEBUT) -> "tuple[datetime, bool]":
    """
    Début de la condition « sous le seuil » d'après les avis : premier instant de la série CONTINUE de points sous le seuil qui se termine à
    `maintenant`. Retourne (début, remontée_limitée) ; si la série remonte jusqu'à la limite, le début est la limite et `remontée_limitée` est vrai.
    Le seuil fourni (le seuil actuel) est appliqué au passé : le résultat est toujours approximatif.
    """
    limite = maintenant - remontee
    points = historique_satisfaction(avis, limite, maintenant)
    for i in range(len(points) - 1, -1, -1):
        if not _sous_le_seuil(points[i][2], seuil):
            return (points[i + 1][0], False) if i + 1 < len(points) else (maintenant, False)
    return limite, True


def reconstituer_fin(avis: Sequence[Avis], seuil: float, debut: datetime, maintenant: datetime, remontee: timedelta = REMONTEE_DEBUT) -> datetime:
    """Premier instant, à partir du début de l'épisode, où la condition « sous le seuil » n'est plus vraie d'après les avis ; `maintenant` à défaut."""
    depart = max(debut, maintenant - remontee)
    for instant, _, taux in historique_satisfaction(avis, depart, maintenant):
        if not _sous_le_seuil(taux, seuil):
            return max(instant, debut)
    return maintenant


# ── Accès base ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Resultat:
    ouverts: int = 0
    termines: int = 0

    @property
    def ecritures(self) -> int:
        return self.ouverts + self.termines


def _etats_du_perimetre(s: Session, current_user, maintenant: datetime) -> "list[EtatAgence]":
    """Agency Manager : son agence. CX Manager : les agences de son organisation (actives ou non : une agence désactivée termine son épisode)."""
    if current_user.role == UserRole.AGENCY_MANAGER:
        agences = s.query(Agence).filter(Agence.id == current_user.agence_id).all()
    else:
        agences = s.query(Agence).filter(Agence.organisation_id == current_user.organisation_id).all()
    if not agences:
        return []
    lignes = (
        s.query(QRCode.agence_id, Feedback.date_soumission, Feedback.note)
        .join(Feedback, Feedback.qr_code_id == QRCode.id)
        .filter(QRCode.agence_id.in_([a.id for a in agences]), Feedback.date_soumission >= maintenant - FENETRE_SATISFACTION)
        .all()
    )
    avis_par_agence: dict = {}
    for agence_id, date_soumission, note in lignes:
        avis_par_agence.setdefault(agence_id, []).append((en_utc(date_soumission), note))
    etats = []
    for agence in agences:
        volume, taux = satisfaction_a(avis_par_agence.get(agence.id, []), maintenant)
        etats.append(EtatAgence(agence.id, agence.organisation_id, agence.nom, float(agence.seuil_alerte), taux, volume, bool(agence.active)))
    return etats


def _episodes_ouverts(s: Session, agence_ids: Sequence) -> "list[EpisodeOuvert]":
    lignes = s.query(AlerteEpisode).filter(
        AlerteEpisode.agence_id.in_(list(agence_ids)), AlerteEpisode.type == TYPE_SEUIL_SATISFACTION, AlerteEpisode.statut != STATUT_TERMINEE,
    ).all()
    return [EpisodeOuvert(e.id, e.agence_id, e.seuil_ouverture, en_utc(e.debut_condition)) for e in lignes]


def _avis_remontes(s: Session, agence_ids: Sequence, depuis: datetime) -> dict:
    lignes = (
        s.query(QRCode.agence_id, Feedback.date_soumission, Feedback.note)
        .join(Feedback, Feedback.qr_code_id == QRCode.id)
        .filter(QRCode.agence_id.in_(list(agence_ids)), Feedback.date_soumission >= depuis)
        .all()
    )
    par_agence: dict = {}
    for agence_id, date_soumission, note in lignes:
        par_agence.setdefault(agence_id, []).append((en_utc(date_soumission), note))
    return par_agence


def _inserer_si_absent(s: Session, valeurs: dict) -> bool:
    """INSERT ... ON CONFLICT DO NOTHING sur l'index unique partiel : deux lectures simultanées ne créent jamais deux épisodes ouverts, sans erreur."""
    if s.get_bind().dialect.name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    instruction = insert(AlerteEpisode).values(**valeurs).on_conflict_do_nothing(
        index_elements=["agence_id", "type"], index_where=text("statut <> 'terminee'"),
    ).returning(AlerteEpisode.id)
    # RETURNING et non `rowcount` : avec psycopg 3, le nombre de lignes d'un INSERT ... ON CONFLICT vaut -1. Une ligne renvoyée = CET appel a créé l'épisode.
    return s.execute(instruction).first() is not None


def _details(**champs) -> dict:
    """Détails MINIMAUX du journal d'audit. Le journal supprime en silence toute clé contenant « avis », « message », « texte », « commentaire », etc. :
    ne jamais en utiliser dans ces noms (le volume s'appelle `nombre_retours_clients`)."""
    return champs


def _ouvrir(s: Session, etat: EtatAgence, avis_agence: Sequence[Avis], maintenant: datetime) -> bool:
    debut, limitee = reconstituer_debut(avis_agence, etat.seuil, maintenant)
    gravite = gravite_alerte_seuil(etat.taux, etat.seuil)
    episode_id = uuid.uuid4()
    inserted = _inserer_si_absent(s, dict(
        id=episode_id, organisation_id=etat.organisation_id, agence_id=etat.agence_id, type=TYPE_SEUIL_SATISFACTION, statut=STATUT_DETECTEE,
        debut_condition=debut, debut_approximatif=True, debut_remontee_limitee=limitee, detecte_le=maintenant,
        taux_ouverture=etat.taux, seuil_ouverture=etat.seuil, gravite_ouverture=gravite, created_at=maintenant, updated_at=maintenant,
    ))
    if inserted:
        journal.journaliser(
            s, action=journal.ALERTE_EPISODE_OUVERT, acteur=None, role_si_absent=journal.ROLE_SYSTEME, cible_type="alerte_episode",
            cible_id=episode_id, cible_libelle=etat.nom, organisation_id=etat.organisation_id,
            details=_details(agence_id=etat.agence_id, type=TYPE_SEUIL_SATISFACTION, statut_apres=STATUT_DETECTEE, debut_condition=debut,
                             debut_approximatif=True, debut_remontee_limitee=limitee, taux=etat.taux, seuil=etat.seuil, gravite=gravite,
                             nombre_retours_clients=etat.nombre_retours_clients),
        )
    return inserted


def _terminer(s: Session, episode: EpisodeOuvert, cause: str, etat: EtatAgence, avis_agence: Sequence[Avis], maintenant: datetime) -> bool:
    fin = reconstituer_fin(avis_agence, etat.seuil, episode.debut_condition, maintenant)
    resultat = s.execute(
        update(AlerteEpisode)
        .where(AlerteEpisode.id == episode.id, AlerteEpisode.statut != STATUT_TERMINEE)
        .values(statut=STATUT_TERMINEE, fin_condition=fin, terminee_le=maintenant, fin_cause=cause, taux_fermeture=etat.taux,
                seuil_fermeture=etat.seuil, updated_at=maintenant)
    )
    if resultat.rowcount != 1:
        return False                      # un autre appel l'a déjà terminé : rien à écrire
    journal.journaliser(
        s, action=journal.ALERTE_EPISODE_TERMINE, acteur=None, role_si_absent=journal.ROLE_SYSTEME, cible_type="alerte_episode",
        cible_id=episode.id, cible_libelle=etat.nom, organisation_id=etat.organisation_id,
        details=_details(agence_id=etat.agence_id, type=TYPE_SEUIL_SATISFACTION, statut_apres=STATUT_TERMINEE, fin_cause=cause, fin_condition=fin,
                         duree_minutes=int((fin - episode.debut_condition).total_seconds() // 60), taux=etat.taux, seuil=etat.seuil),
    )
    return True


def _reconcilier(s: Session, current_user, maintenant: datetime) -> Resultat:
    etats = _etats_du_perimetre(s, current_user, maintenant)
    if not etats:
        return Resultat()
    plan = planifier(etats, _episodes_ouverts(s, [e.agence_id for e in etats]))
    if plan.vide:
        return Resultat()                  # régime stable : aucune écriture
    # Les avis plus anciens ne sont lus QUE s'il y a quelque chose à écrire (début ou fin à reconstituer).
    borne = maintenant - REMONTEE_DEBUT - FENETRE_SATISFACTION
    avis = _avis_remontes(s, {e.agence_id for e in plan.ouvertures} | {ep.agence_id for ep, _, _ in plan.fermetures}, borne)
    ouverts = sum(1 for etat in plan.ouvertures if _ouvrir(s, etat, avis.get(etat.agence_id, []), maintenant))
    termines = sum(1 for ep, cause, etat in plan.fermetures if _terminer(s, ep, cause, etat, avis.get(etat.agence_id, []), maintenant))
    return Resultat(ouverts, termines)


def reconcilier_episodes(db: Session, current_user, maintenant: Optional[datetime] = None) -> Optional[Resultat]:
    """
    Ouvre les épisodes manquants et termine ceux dont la condition n'est plus remplie, pour le périmètre de `current_user`. NE LÈVE JAMAIS.
    Session et transaction PROPRES (celles de la lecture ne sont jamais touchées) ; en cas d'erreur, la transaction est annulée et seul le type de
    l'erreur est journalisé. None si l'interrupteur est coupé ou en cas d'erreur ; sinon le nombre d'ouvertures et de fins (0 et 0 = aucune écriture).
    """
    if not reconciliation_activee():
        return None
    try:
        instant = maintenant or datetime.now(timezone.utc)
        with Session(bind=db.get_bind(), expire_on_commit=False) as s:
            if s.get_bind().dialect.name == "postgresql":
                s.execute(text("SET LOCAL statement_timeout = 2000"))      # une lecture n'attend jamais les épisodes plus de 2 s
            resultat = _reconcilier(s, current_user, instant)
            if resultat.ecritures:
                s.commit()
            else:
                s.rollback()
            return resultat
    except Exception as erreur:  # noqa: BLE001 — la lecture ne casse JAMAIS à cause des épisodes ; jamais le contenu de l'exception
        technique.error("Réconciliation des épisodes d'alerte impossible (%s)", type(erreur).__name__)
        return None


# ── Lecture des épisodes pour enrichir GET /alertes/ (champs additifs) ────────────────────────────────────────────────────────────────

def episodes_ouverts_pour_lecture(db: Session, agence_ids: Sequence) -> dict:
    """Épisodes NON terminés des agences données, indexés par agence ; {} si l'interrupteur est coupé, s'il n'y a rien à chercher, ou en cas d'erreur
    (jamais de levée : la lecture d'une alerte ne casse pas à cause des épisodes). Session propre, en lecture seule."""
    if not reconciliation_activee() or not agence_ids:
        return {}
    try:
        with Session(bind=db.get_bind(), expire_on_commit=False) as s:
            if s.get_bind().dialect.name == "postgresql":
                s.execute(text("SET LOCAL statement_timeout = 2000"))
            lignes = s.query(AlerteEpisode).filter(
                AlerteEpisode.agence_id.in_(list(agence_ids)), AlerteEpisode.type == TYPE_SEUIL_SATISFACTION, AlerteEpisode.statut != STATUT_TERMINEE,
            ).all()
            s.rollback()
            return {e.agence_id: e for e in lignes}
    except Exception as erreur:  # noqa: BLE001
        technique.error("Lecture des épisodes d'alerte impossible (%s)", type(erreur).__name__)
        return {}


# ── Prise en charge d'un épisode (Agency Manager de l'agence concernée uniquement) ──────────────────────────────────────────────────────

class EpisodeIntrouvable(Exception):
    """Épisode inconnu OU hors du périmètre de l'appelant : les deux cas sont indiscernables (on ne révèle jamais l'existence d'un épisode)."""


class EpisodeDejaPrisEnCharge(Exception):
    pass


class EpisodeTermine(Exception):
    pass


LONGUEUR_MAX_COMMENTAIRE = 500


def nettoyer_commentaire(valeur: Optional[str]) -> Optional[str]:
    """Espaces de début et de fin retirés ; vide ou composé d'espaces = absent (None)."""
    if valeur is None:
        return None
    propre = valeur.strip()
    return propre or None


def prendre_en_charge_episode(db: Session, episode_id: uuid.UUID, current_user, commentaire: Optional[str] = None, requete=None) -> AlerteEpisode:
    """
    Passe un épisode de « detectee » à « prise_en_charge », atomiquement : UN UPDATE conditionnel `WHERE statut = 'detectee'`. Deux appels simultanés :
    un seul réussit, l'autre reçoit EpisodeDejaPrisEnCharge. Ne COMMIT pas : l'appelant valide (le journal d'audit est dans la même transaction).
    L'épisode doit appartenir à l'agence ET à l'organisation de l'appelant, sinon EpisodeIntrouvable (comme un identifiant inconnu).
    """
    episode = (
        db.query(AlerteEpisode)
        .filter(AlerteEpisode.id == episode_id, AlerteEpisode.agence_id == current_user.agence_id,
                AlerteEpisode.organisation_id == current_user.organisation_id, AlerteEpisode.type == TYPE_SEUIL_SATISFACTION)
        .first()
    )
    if episode is None:
        raise EpisodeIntrouvable()
    maintenant = datetime.now(timezone.utc)
    nom = f"{(current_user.prenom or '').strip()} {(current_user.nom or '').strip()}".strip()[:200] or None
    gagne = db.execute(
        update(AlerteEpisode)
        .where(AlerteEpisode.id == episode.id, AlerteEpisode.statut == STATUT_DETECTEE)
        .values(statut=STATUT_PRISE_EN_CHARGE, pris_en_charge_le=maintenant, pris_en_charge_par_id=current_user.id, pris_en_charge_par_nom=nom,
                commentaire_prise_en_charge=nettoyer_commentaire(commentaire), updated_at=maintenant)
        .returning(AlerteEpisode.id)
    ).first()
    if gagne is None:
        db.refresh(episode)
        raise EpisodeTermine() if episode.statut == STATUT_TERMINEE else EpisodeDejaPrisEnCharge()
    db.refresh(episode)
    journal.journaliser(
        db, action=journal.ALERTE_EPISODE_PRIS_EN_CHARGE, acteur=current_user, cible_type="alerte_episode", cible_id=episode.id,
        cible_libelle=db.get(Agence, episode.agence_id).nom, organisation_id=episode.organisation_id,
        # Jamais le commentaire, ni aucune clé contenant « avis », « message », « texte » ou « commentaire » (filtrées en silence par le journal).
        details=_details(agence_id=episode.agence_id, type=TYPE_SEUIL_SATISFACTION, statut_avant=STATUT_DETECTEE, statut_apres=STATUT_PRISE_EN_CHARGE,
                         delai_prise_en_charge_minutes=int((maintenant - en_utc(episode.detecte_le)).total_seconds() // 60)),
        requete=requete,
    )
    return episode
