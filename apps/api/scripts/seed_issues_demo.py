"""
Script de seeding démo — Issues du pack telecom pour Orange Burkina Faso.

Dans l'esprit de seed_feedbacks_demo.py : chaque Issue passe par le pipeline réel
(app.api.v1.endpoints.issues — creer_issue, creer_action_corrective,
terminer_action_corrective, verifier_issue), pour que les statuts et l'historique
(HistoriqueIssue) soient exactement ceux qu'une vraie utilisation produirait. Seules les
dates (premiere_detection, derniere_detection, dates de complétion/résolution/vérification
et les HistoriqueIssue correspondants) sont repoussées dans le passé après coup, pour
obtenir une vraie répartition sur 30 jours — ces fonctions fixent `datetime.now()` en dur
et n'acceptent pas de date historique en paramètre (V1 volontairement manuelle, voir
app/models/issue.py). Le statut et la trace d'audit, eux, restent 100% réels : aucun INSERT
brut ne contourne une transition ou une ligne d'historique.

Chaque Issue regroupe 1 à 3 feedbacks EXISTANTS de la même agence et de la même catégorie,
jamais déjà rattachés à une autre Issue (Feedback.issue_id IS NULL). Renseigne aussi
nps_note sur ~30 feedbacks de démo (distribution réaliste), marqués individuellement
(HistoriqueFeedback.type_evenement="nps_demo_seed") pour un retrait précis et sélectif.

Idempotent : refuse de s'exécuter si des Issues de démo (titre marqué) existent déjà pour
Orange Burkina Faso, sauf --force. --supprimer retire UNIQUEMENT ce que ce script a créé
(détection par le marqueur de titre et le marqueur d'historique nps — jamais par un fichier
local, qui pourrait être absent ou désynchronisé).

Prérequis : Organisation.secteur_code="telecom" et categories_agence.cle renseignées pour
Orange (migrations 024 à 027) — le script vérifie ce prérequis et s'arrête sinon.

Usage :
    cd apps/api
    python scripts/seed_issues_demo.py                # crée le jeu de données
    python scripts/seed_issues_demo.py --force         # régénère même si déjà présent
    python scripts/seed_issues_demo.py --supprimer     # retire uniquement ce qui a été créé
"""
import io
import os
import random
import sys
import uuid
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Force stdout en UTF-8 (console Windows par défaut en cp1252).
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

from app.db.session import SessionLocal
from app.models.agence import Agence
from app.models.action_corrective import ActionCorrective
from app.models.categorie import Categorie
from app.models.enums import CriticiteType, UserRole
from app.models.feedback import Feedback
from app.models.historique_feedback import HistoriqueFeedback
from app.models.historique_issue import HistoriqueIssue
from app.models.issue import Issue
from app.models.organisation import Organisation
from app.models.utilisateur import Utilisateur
from app.schemas.issue import ActionCorrectiveCreate, IssueCreate
from app.api.v1.endpoints.issues import (
    creer_issue,
    creer_action_corrective,
    terminer_action_corrective,
    verifier_issue,
)
from app.services.kpi.packs_telecom import PERIMETRE_CATEGORIES, PERIMETRE_AGENCE, PERIMETRE_HORS_AGENCE, PERIMETRE_MIXTE

random.seed(2026)  # reproductible si on doit relancer avant la démo

ORGANISATION_NOM = "Orange Burkina Faso"
MARQUEUR_TITRE = " [Démo pack telecom]"
MARQUEUR_NPS = "nps_demo_seed"

NOW = datetime.now(timezone.utc)


# ============================================================================
# 1. TITRES RÉALISTES PAR CLÉ
# ============================================================================

TITRES_PAR_CLE = {
    "accueil": [
        "File d'attente trop longue à l'accueil",
        "Accueil peu disponible aux heures d'affluence",
        "Orientation client confuse à l'arrivée en agence",
        "Manque de personnel à l'accueil le samedi",
    ],
    "service_client": [
        "Conseiller peu réactif sur une demande de résiliation",
        "Temps de réponse du service client jugé trop long",
        "Suivi de dossier client insuffisant",
        "Demande de réclamation restée sans réponse",
    ],
    "carte_sim_numero": [
        "Délai de remplacement de carte SIM trop long",
        "Portabilité de numéro bloquée plusieurs jours",
        "Carte SIM défectueuse à l'activation",
        "Erreur lors du changement de numéro",
    ],
    "equipements_boutique": [
        "Rupture de stock récurrente sur les smartphones",
        "Chargeurs et accessoires indisponibles en boutique",
        "Vitrine d'exposition mal entretenue",
        "Matériel de démonstration hors service",
    ],
    "internet_reseau_mobile": [
        "Coupures répétées du réseau mobile dans le quartier",
        "Débit internet mobile très dégradé en soirée",
        "Zone blanche signalée près de l'agence",
        "Réseau 4G instable sur l'axe principal",
    ],
    "facturation_paiement": [
        "Facturation incorrecte sur le forfait mensuel",
        "Paiement Mobile Money non pris en compte",
        "Prélèvement en double constaté sur la facture",
        "Facture reçue en retard, pénalité contestée",
    ],
    "forfaits_recharge": [
        "Recharge mobile non créditée après paiement",
        "Changement de forfait non appliqué",
        "Bonus de recharge promotionnel non reçu",
        "Forfait data épuisé plus vite qu'annoncé",
    ],
}

TITRES_UTILISES: set[str] = set()


def titre_pour(cle: str, rng: random.Random) -> str:
    """Un titre non encore utilisé dans cette exécution quand c'est possible (peu de
    doublons visibles sur ~24 Issues), sinon un titre réutilisé plutôt qu'une erreur."""
    candidats = [t for t in TITRES_PAR_CLE[cle] if t not in TITRES_UTILISES]
    if not candidats:
        candidats = TITRES_PAR_CLE[cle]
    titre = rng.choice(candidats)
    TITRES_UTILISES.add(titre)
    return titre + MARQUEUR_TITRE


# ============================================================================
# 2. GARDE-FOUS / PRÉREQUIS
# ============================================================================

def issues_demo_existent(db, organisation_id) -> int:
    return (
        db.query(Issue)
        .filter(Issue.organisation_id == organisation_id, Issue.titre.ilike(f"%{MARQUEUR_TITRE}%"))
        .count()
    )


def verifier_prerequis(db, org: Organisation) -> None:
    if org.secteur_code != "telecom":
        raise SystemExit(
            f"[ERREUR] {org.nom} : secteur_code='{org.secteur_code}' (attendu 'telecom'). "
            "Vérifiez que la migration 024_organisation_secteur_code a bien été appliquée."
        )
    nb_avec_cle = (
        db.query(Categorie)
        .join(Agence, Categorie.agence_id == Agence.id)
        .filter(Agence.organisation_id == org.id, Categorie.cle.isnot(None))
        .count()
    )
    if nb_avec_cle == 0:
        raise SystemExit(
            "[ERREUR] Aucune catégorie de cette organisation n'a de clé (categories_agence.cle). "
            "Appliquez les migrations 025_categorie_cle, 026_telecom_categories_cle et "
            "027_telecom_cles_retry avant de lancer ce script."
        )


# ============================================================================
# 3. SUPPRESSION (--supprimer) — uniquement ce que ce script a créé
# ============================================================================

def supprimer(db, org: Organisation) -> dict:
    issue_ids = [
        row.id for row in db.query(Issue.id)
        .filter(Issue.organisation_id == org.id, Issue.titre.ilike(f"%{MARQUEUR_TITRE}%"))
        .all()
    ]
    nb_issues = len(issue_ids)
    if issue_ids:
        # ON DELETE CASCADE (actions_correctives, historique_issues) et ON DELETE SET NULL
        # (feedbacks.issue_id) sont posés au niveau de la base : un DELETE direct suffit,
        # jamais de suppression manuelle table par table qui pourrait en oublier une.
        db.query(Issue).filter(Issue.id.in_(issue_ids)).delete(synchronize_session=False)

    marqueurs_nps = (
        db.query(HistoriqueFeedback)
        .join(Feedback, HistoriqueFeedback.feedback_id == Feedback.id)
        .join(Agence, HistoriqueFeedback.agence_id == Agence.id)
        .filter(Agence.organisation_id == org.id, HistoriqueFeedback.type_evenement == MARQUEUR_NPS)
        .all()
    )
    feedback_ids_nps = [m.feedback_id for m in marqueurs_nps]
    nb_nps = len(feedback_ids_nps)
    if feedback_ids_nps:
        db.query(Feedback).filter(Feedback.id.in_(feedback_ids_nps)).update(
            {"nps_note": None}, synchronize_session=False
        )
        db.query(HistoriqueFeedback).filter(
            HistoriqueFeedback.id.in_([m.id for m in marqueurs_nps])
        ).delete(synchronize_session=False)

    db.commit()
    return {"issues_supprimees": nb_issues, "nps_notes_retirees": nb_nps}


# ============================================================================
# 4. INVENTAIRE — agences, catégories actives avec clé, pools de feedbacks libres
# ============================================================================

def charger_inventaire(db, org: Organisation) -> dict:
    """{cle: [(agence_id, agence_nom, categorie_id), ...]} pour les catégories ACTIVES
    avec une clé — seules celles-là représentent le pack telecom v1."""
    rows = (
        db.query(Categorie.cle, Agence.id, Agence.nom, Categorie.id)
        .join(Agence, Categorie.agence_id == Agence.id)
        .filter(Agence.organisation_id == org.id, Categorie.active == True, Categorie.cle.isnot(None))  # noqa: E712
        .all()
    )
    par_cle: dict[str, list] = {}
    for cle, agence_id, agence_nom, categorie_id in rows:
        par_cle.setdefault(cle, []).append((agence_id, agence_nom, categorie_id))
    return par_cle


def pool_feedbacks_libres(db, agence_id, categorie_id) -> list:
    """Feedbacks existants, de cette agence et cette catégorie, pas déjà rattachés à une
    Issue — jamais réutilisés deux fois (voir consommation dans PoolFeedbacks)."""
    from app.models.qr_code import QRCode
    return (
        db.query(Feedback.id)
        .join(QRCode, Feedback.qr_code_id == QRCode.id)
        .filter(
            QRCode.agence_id == agence_id,
            Feedback.categorie_id == categorie_id,
            Feedback.issue_id.is_(None),
        )
        .order_by(Feedback.date_soumission.asc())
        .all()
    )


class PoolFeedbacks:
    """Pools (agence_id, categorie_id) -> [feedback_id, ...], chargés une fois, consommés
    en mémoire au fil des assignations (jamais deux fois le même feedback)."""

    def __init__(self, db):
        self.db = db
        self._pools: dict[tuple, list] = {}

    def disponibles(self, agence_id, categorie_id) -> int:
        key = (agence_id, categorie_id)
        if key not in self._pools:
            self._pools[key] = [r.id for r in pool_feedbacks_libres(self.db, agence_id, categorie_id)]
        return len(self._pools[key])

    def consommer(self, agence_id, categorie_id, n: int) -> list:
        key = (agence_id, categorie_id)
        self.disponibles(agence_id, categorie_id)  # s'assure que le pool est chargé
        pris, reste = self._pools[key][:n], self._pools[key][n:]
        self._pools[key] = reste
        return pris


# ============================================================================
# 5. PLAN — qui (agence/catégorie), quel groupe, standalone ou paire de récurrence
# ============================================================================

GROUPE_PAR_CLE = {cle: groupe for groupe, cles in PERIMETRE_CATEGORIES.items() for cle in cles}

# Cibles approximatives (~24 Issues) : hors_agence ~35%, agence ~50%, mixte le reste.
# Chaque groupe pertinent (agence, hors_agence) dépasse largement le seuil de 5 utilisé
# par TEL_RECURRENCE_AGENCE / TEL_RECURRENCE_HORS_PERIMETRE.
CIBLES_HORS_AGENCE = {"internet_reseau_mobile": 4, "facturation_paiement": 4}       # 8
CIBLES_AGENCE = {"accueil": 3, "service_client": 3, "carte_sim_numero": 3, "equipements_boutique": 3}  # 12
CIBLES_MIXTE = {"forfaits_recharge": 4}                                            # 4

# Paires de récurrence : (cle, groupe) — 3 côté hors_agence, 2 côté agence ("plus de
# récurrences du côté hors agence"). Chaque paire consomme 2 des Issues du total ci-dessus
# (1 origine + 1 occurrence), le reste de chaque cle est "standalone".
PAIRES_RECURRENCE = [
    ("internet_reseau_mobile", "hors_agence"),
    ("internet_reseau_mobile", "hors_agence"),
    ("facturation_paiement", "hors_agence"),
    ("accueil", "agence"),
    ("service_client", "agence"),
]


def choisir_agence_avec_stock(inventaire, pools: PoolFeedbacks, cle: str, n_requis: int, eviter=None):
    """Première agence (déterministe, ordre d'inventaire) ayant cette clé active et au
    moins n_requis feedbacks libres restants — None si aucune n'en a assez."""
    eviter = eviter or set()
    for agence_id, agence_nom, categorie_id in inventaire.get(cle, []):
        if agence_id in eviter:
            continue
        if pools.disponibles(agence_id, categorie_id) >= n_requis:
            return agence_id, agence_nom, categorie_id
    # Repli : la première qui a au moins 1, même si moins que n_requis demandé.
    for agence_id, agence_nom, categorie_id in inventaire.get(cle, []):
        if agence_id in eviter:
            continue
        if pools.disponibles(agence_id, categorie_id) >= 1:
            return agence_id, agence_nom, categorie_id
    return None


# ============================================================================
# 6. CRÉATION D'UNE ISSUE VIA LE PIPELINE RÉEL + BACKDATING
# ============================================================================

def _backdater_historique(db, issue_id, type_evenement: str, date_evenement: datetime) -> None:
    db.query(HistoriqueIssue).filter(
        HistoriqueIssue.issue_id == issue_id, HistoriqueIssue.type_evenement == type_evenement
    ).update({"date_evenement": date_evenement}, synchronize_session=False)


def creer_une_issue(
    db, cx_user, agence_id, agence_nom, categorie_id, cle: str, feedback_ids: list,
    detection_date: datetime, statut_cible: str, sla: str | None, origine_id=None,
) -> Issue:
    """statut_cible : 'ouverte' | 'action_en_cours' | 'resolue' | 'verifiee'.
    sla : None | 'respectee' | 'manquee' — ignoré si statut_cible == 'ouverte'."""
    date_limite_sla = None
    if sla == "respectee":
        date_limite_sla = detection_date + timedelta(hours=random.randint(36, 96))
    elif sla == "manquee":
        date_limite_sla = detection_date + timedelta(hours=random.randint(4, 10))

    data = IssueCreate(
        titre=titre_pour(cle, random),
        agence_id=agence_id,
        categorie_id=categorie_id,
        severite=random.choice([CriticiteType.FAIBLE, CriticiteType.FAIBLE, CriticiteType.MOYENNE, CriticiteType.CRITIQUE]),
        date_limite_sla=date_limite_sla,
        issue_origine_id=origine_id,
        feedback_ids=feedback_ids,
    )
    reponse = creer_issue(data=data, db=db, current_user=cx_user)
    issue = db.query(Issue).filter(Issue.id == reponse.id).first()

    issue.premiere_detection = detection_date
    if feedback_ids:
        issue.derniere_detection = detection_date
    db.flush()
    _backdater_historique(db, issue.id, "creation", detection_date)
    for fid in feedback_ids:
        _backdater_historique(db, issue.id, "feedback_rattache", detection_date)

    if statut_cible == "ouverte":
        db.commit()
        return issue

    # action_en_cours (et toute étape suivante) passe par une vraie action corrective.
    action_date = detection_date + timedelta(hours=random.randint(2, 20))
    action_reponse = creer_action_corrective(
        issue_id=issue.id,
        data=ActionCorrectiveCreate(titre=f"Traitement — {issue.titre.replace(MARQUEUR_TITRE, '')}"[:200]),
        db=db, current_user=cx_user,
    )
    action = db.query(ActionCorrective).filter(ActionCorrective.id == action_reponse.id).first()
    action.created_at = action_date
    action.updated_at = action_date
    db.flush()
    _backdater_historique(db, issue.id, "action_creee", action_date)

    if statut_cible == "action_en_cours":
        db.commit()
        return issue

    # resolue / verifiee : termine l'action (clôt l'Issue par ricochet).
    marge_sla = timedelta(hours=random.randint(1, 12))
    if sla == "respectee" and date_limite_sla:
        completion_date = min(date_limite_sla - marge_sla, NOW - timedelta(hours=1))
        if completion_date <= action_date:
            completion_date = action_date + timedelta(hours=1)
    elif sla == "manquee" and date_limite_sla:
        completion_date = date_limite_sla + marge_sla
    else:
        completion_date = action_date + timedelta(hours=random.randint(6, 96))
    completion_date = min(completion_date, NOW - timedelta(minutes=5))

    terminer_action_corrective(issue_id=issue.id, action_id=action.id, db=db, current_user=cx_user)
    action2 = db.query(ActionCorrective).filter(ActionCorrective.id == action.id).first()
    action2.date_completion = completion_date
    action2.updated_at = completion_date
    issue.date_resolution = completion_date
    db.flush()
    _backdater_historique(db, issue.id, "action_terminee", completion_date)
    _backdater_historique(db, issue.id, "issue_resolue", completion_date)

    if statut_cible == "verifiee":
        verification_date = min(completion_date + timedelta(hours=random.randint(1, 48)), NOW - timedelta(minutes=1))
        verifier_issue(issue_id=issue.id, db=db, current_user=cx_user)
        issue.date_verification = verification_date
        db.flush()
        _backdater_historique(db, issue.id, "issue_verifiee", verification_date)

    db.commit()
    db.refresh(issue)
    return issue


def date_detection_aleatoire(besoin_de_marge: bool) -> datetime:
    """besoin_de_marge=True : laisse assez de jours pour qu'action + résolution (+
    vérification) tiennent avant maintenant. False (Issues encore ouvertes) : peut être
    plus récente."""
    jours = random.randint(4, 29) if besoin_de_marge else random.randint(0, 6)
    heure = random.randint(8, 19)
    minute = random.randint(0, 59)
    d = NOW - timedelta(days=jours)
    return d.replace(hour=heure, minute=minute, second=random.randint(0, 59), microsecond=0)


# ============================================================================
# 7. NPS — ~30 feedbacks marqués, distribution réaliste
# ============================================================================

NPS_NOTES_POOL = (
    [0] * 2 + [1] * 1 + [2] * 1 + [3] * 2 + [4] * 3 + [5] * 4 + [6] * 5
    + [7] * 10 + [8] * 12 + [9] * 18 + [10] * 15
)


def renseigner_nps(db, org: Organisation, n_cible: int = 30) -> list:
    from app.models.qr_code import QRCode
    candidats = (
        db.query(Feedback)
        .join(QRCode, Feedback.qr_code_id == QRCode.id)
        .join(Agence, QRCode.agence_id == Agence.id)
        .filter(Agence.organisation_id == org.id, Feedback.nps_note.is_(None))
        .all()
    )
    random.shuffle(candidats)
    choisis = candidats[:n_cible]
    for fb in choisis:
        note = random.choice(NPS_NOTES_POOL)
        fb.nps_note = note
        db.add(HistoriqueFeedback(
            feedback_id=fb.id,
            agence_id=fb.qr_code.agence_id if fb.qr_code else None,
            auteur_nom="Script seed_issues_demo",
            auteur_role="system",
            type_evenement=MARQUEUR_NPS,
            details=f"nps_note={note} (jeu de données de démo, pack telecom)",
        ))
    db.commit()
    return choisis


# ============================================================================
# 8. MAIN
# ============================================================================

def main():
    db = SessionLocal()
    try:
        org = db.query(Organisation).filter(Organisation.nom == ORGANISATION_NOM).first()
        if not org:
            raise SystemExit(f"[ERREUR] Organisation introuvable : {ORGANISATION_NOM}")

        if "--supprimer" in sys.argv:
            resultat = supprimer(db, org)
            print(f"[OK] Supprimé : {resultat['issues_supprimees']} Issue(s) de démo, "
                  f"{resultat['nps_notes_retirees']} nps_note de démo retirée(s).")
            return

        verifier_prerequis(db, org)

        force = "--force" in sys.argv
        existantes = issues_demo_existent(db, org.id)
        if existantes and not force:
            print(f"[REFUS] {existantes} Issue(s) de démo (titre marqué) existent déjà pour "
                  f"{org.nom}. Relancer avec --force pour régénérer quand même (créera un "
                  f"second lot), ou --supprimer pour retirer l'existant d'abord.")
            return

        cx_user = (
            db.query(Utilisateur)
            .filter(Utilisateur.organisation_id == org.id, Utilisateur.role == UserRole.CX_MANAGER, Utilisateur.active == True)  # noqa: E712
            .first()
        )
        if not cx_user:
            raise SystemExit(f"[ERREUR] Aucun CX Manager actif pour {org.nom}.")

        inventaire = charger_inventaire(db, org)
        manquantes = [cle for cle in {**CIBLES_HORS_AGENCE, **CIBLES_AGENCE, **CIBLES_MIXTE} if cle not in inventaire]
        if manquantes:
            raise SystemExit(f"[ERREUR] Clés du pack telecom absentes de l'inventaire (catégories actives "
                              f"avec clé introuvables) : {manquantes}")

        pools = PoolFeedbacks(db)

        # ---- 1. Paires de récurrence : origine (résolue, date ancienne) + occurrence ----
        issues_creees = []
        agences_utilisees_par_cle: dict[str, set] = {}
        for cle, groupe in PAIRES_RECURRENCE:
            eviter = agences_utilisees_par_cle.get(cle, set())
            choix = choisir_agence_avec_stock(inventaire, pools, cle, 2, eviter=eviter)
            if choix is None:
                print(f"[AVERTISSEMENT] Pas assez de feedbacks libres pour une paire de récurrence "
                      f"sur '{cle}' — paire ignorée.")
                continue
            agence_id, agence_nom, categorie_id = choix
            agences_utilisees_par_cle.setdefault(cle, set()).add(agence_id)

            # Origine : ancienne, résolue, sans SLA (simplicité).
            detection_origine = date_detection_aleatoire(besoin_de_marge=True) - timedelta(days=3)
            n_fb = min(random.randint(1, 3), pools.disponibles(agence_id, categorie_id))
            fb_ids = pools.consommer(agence_id, categorie_id, max(n_fb, 1))
            origine = creer_une_issue(
                db, cx_user, agence_id, agence_nom, categorie_id, cle, fb_ids,
                detection_origine, statut_cible="resolue", sla=None,
            )
            issues_creees.append((origine, groupe, cle, agence_nom, "origine"))

            # Occurrence : plus récente, référence l'origine, statut varié.
            detection_occurrence = date_detection_aleatoire(besoin_de_marge=True)
            if detection_occurrence <= detection_origine:
                detection_occurrence = detection_origine + timedelta(days=2)
            n_fb = min(random.randint(1, 3), pools.disponibles(agence_id, categorie_id))
            fb_ids = pools.consommer(agence_id, categorie_id, max(n_fb, 1)) if n_fb else []
            occurrence = creer_une_issue(
                db, cx_user, agence_id, agence_nom, categorie_id, cle, fb_ids,
                detection_occurrence, statut_cible=random.choice(["resolue", "resolue", "verifiee"]),
                sla=random.choice([None, "respectee"]), origine_id=origine.id,
            )
            issues_creees.append((occurrence, groupe, cle, agence_nom, "occurrence"))

        # ---- 2. Issues standalone — complète chaque cible jusqu'au compte visé ----
        # "Quelques-unes sont ouvertes" doit être GARANTI, pas laissé à un tirage aléatoire
        # qui peut ne jamais tomber dessus sur ~14 tirages (vécu : une graine a produit 0
        # Issue non résolue sur un premier essai). File déterministe de statuts non résolus,
        # consommée en priorité sur les premiers emplacements standalone rencontrés,
        # peu importe leur groupe/clé — quels KPI communs doivent rester < 100% résolus.
        statuts_non_resolus = ["ouverte", "ouverte", "ouverte", "action_en_cours", "action_en_cours"]
        random.shuffle(statuts_non_resolus)

        def generer_standalone(cibles: dict, groupe: str):
            for cle, n_total in cibles.items():
                n_deja = sum(1 for (_, g, c, _, _) in issues_creees if g == groupe and c == cle)
                for _ in range(max(n_total - n_deja, 0)):
                    choix = choisir_agence_avec_stock(inventaire, pools, cle, 1)
                    if choix is None:
                        print(f"[AVERTISSEMENT] Plus aucun feedback libre pour '{cle}' — Issue standalone ignorée.")
                        continue
                    agence_id, agence_nom, categorie_id = choix

                    if statuts_non_resolus:
                        statut_cible = statuts_non_resolus.pop()
                        sla = None
                        detection = date_detection_aleatoire(besoin_de_marge=False)
                    else:
                        statut_cible = random.choices(["resolue", "verifiee"], weights=[65, 35])[0]
                        sla = random.choices([None, "respectee", "manquee"], weights=[45, 35, 20])[0]
                        detection = date_detection_aleatoire(besoin_de_marge=True)

                    n_fb = min(random.randint(1, 3), pools.disponibles(agence_id, categorie_id))
                    fb_ids = pools.consommer(agence_id, categorie_id, max(n_fb, 1))

                    issue = creer_une_issue(
                        db, cx_user, agence_id, agence_nom, categorie_id, cle, fb_ids,
                        detection, statut_cible=statut_cible, sla=sla,
                    )
                    issues_creees.append((issue, groupe, cle, agence_nom, "standalone"))

        generer_standalone(CIBLES_HORS_AGENCE, "hors_agence")
        generer_standalone(CIBLES_AGENCE, "agence")
        generer_standalone(CIBLES_MIXTE, "mixte")

        # ---- 3. NPS ----
        feedbacks_nps = renseigner_nps(db, org, n_cible=30)

        # ---- Récapitulatif ----
        print("\n" + "=" * 70)
        print(f"RÉCAPITULATIF — {org.nom}")
        print("=" * 70)
        print(f"Issues créées : {len(issues_creees)}")
        for groupe in ("agence", "mixte", "hors_agence"):
            n = sum(1 for (_, g, _, _, _) in issues_creees if g == groupe)
            print(f"  groupe {groupe} : {n}")
        n_recurrentes = sum(1 for (i, *_ ) in issues_creees if i.issue_origine_id is not None)
        print(f"Issues récurrentes (issue_origine_id) : {n_recurrentes}")
        print(f"Feedbacks nps_note renseignés : {len(feedbacks_nps)}")

    finally:
        db.close()


if __name__ == "__main__":
    main()
