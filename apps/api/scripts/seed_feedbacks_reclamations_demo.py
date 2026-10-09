"""
Script de seeding démo — réclamations telecom (feedbacks) pour Orange Burkina Faso.

Alimente les KPI TEL_RECLAMATIONS_RESEAU / _RECHARGE_FORFAIT / _FACTURATION
(app/services/kpi/engine.py) avec des feedbacks réalistes, datés sur les 30 derniers
jours, répartis sur plusieurs agences.

Dans l'esprit de seed_feedbacks_demo.py : CHAQUE feedback passe par le pipeline réel de
soumission (app.api.v1.endpoints.feedbacks.submit_feedback), donc par l'analyse IA réelle
(sentiment, criticité, discordance, recommandations — app/services/ai/analyse_service.py).
Aucun INSERT brut ne contourne l'analyse : le script vérifie après chaque soumission que
l'AnalyseIA existe et que son sentiment est celui attendu, et s'arrête sinon. Seules les
dates (soumission, historique, analyse) sont repoussées dans le passé après coup.

Rattachement : la catégorie de chaque feedback est résolue par sa clé stable
(categories_agence.cle), jamais par son nom ; une agence sans catégorie active portant la
clé arrête le script AVANT toute écriture.

Marquage : chaque feedback créé reçoit un événement d'historique
type_evenement="reclamations_demo_seed". Idempotent : refuse de s'exécuter si ce marqueur
existe déjà pour l'organisation, sauf --force (crée alors un second lot). --supprimer
retire UNIQUEMENT les feedbacks portant ce marqueur (analyse, recommandations et
historique suivent par ON DELETE CASCADE). Aucun feedback ni Issue existant n'est modifié.

Comptes : choisis pour viser, sur 30 jours, ~15-20 % (réseau), ~8-10 % (recharge &
forfaits) et ~6-8 % (facturation) avec une base d'environ 40 feedbacks existants sur la
période — les feedbacks ajoutés comptent aussi au dénominateur.

Usage :
    cd apps/api
    python scripts/seed_feedbacks_reclamations_demo.py              # crée le jeu de données
    python scripts/seed_feedbacks_reclamations_demo.py --force      # crée un second lot
    python scripts/seed_feedbacks_reclamations_demo.py --supprimer  # retire uniquement ce lot
"""
import io
import os
import random
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Force stdout en UTF-8 (console Windows par défaut en cp1252).
if __name__ == "__main__":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

from fastapi import BackgroundTasks

from app.db.session import SessionLocal
from app.models.agence import Agence
from app.models.analyse_ia import AnalyseIA
from app.models.categorie import Categorie
from app.models.enums import SentimentType
from app.models.feedback import Feedback
from app.models.historique_feedback import HistoriqueFeedback
from app.models.organisation import Organisation
from app.models.qr_code import QRCode
from app.schemas.feedback import FeedbackCreate
from app.services.ai.sentiment import analyser_sentiment
from app.api.v1.endpoints.feedbacks import submit_feedback

ORGANISATION_NOM = "Orange Burkina Faso"
MARQUEUR = "reclamations_demo_seed"
FENETRE_JOURS = (1, 26)  # bien à l'intérieur des 30 derniers jours

NEG, POS = SentimentType.NEGATIF, SentimentType.POSITIF


# ============================================================================
# 1. JEU DE DONNÉES — (agence, note, commentaire, sentiment attendu) par clé
# ============================================================================

@dataclass(frozen=True)
class FeedbackPlan:
    cle: str
    agence: str
    note: int
    commentaire: str
    sentiment_attendu: SentimentType


PLAN: list[FeedbackPlan] = [
    # ── internet_reseau_mobile : 12 feedbacks, 11 négatifs ──────────────────────
    FeedbackPlan("internet_reseau_mobile", "Agence Orange Bobo-Dioulasso", 1,
                 "Coupures répétées du réseau tous les soirs, impossible de passer un appel. Inacceptable.", NEG),
    FeedbackPlan("internet_reseau_mobile", "Agence Orange Bobo-Dioulasso", 2,
                 "Débit internet trop lent depuis une semaine, les pages ne chargent pas. Je suis déçu.", NEG),
    FeedbackPlan("internet_reseau_mobile", "Agence Orange Bobo-Dioulasso", 2,
                 "Problème de 4G instable dans mon quartier, la connexion coupe sans arrêt, c'est frustrant.", NEG),
    FeedbackPlan("internet_reseau_mobile", "Agence Orange Koupéla", 1,
                 "Pas de réseau dans tout le secteur depuis trois jours, panne jamais réglée. Catastrophique.", NEG),
    FeedbackPlan("internet_reseau_mobile", "Agence Orange Koupéla", 2,
                 "Internet mobile très lent en soirée, impossible de travailler, vraiment mauvais.", NEG),
    FeedbackPlan("internet_reseau_mobile", "Agence Ouahigouya", 1,
                 "La 4G ne fonctionne pas depuis la coupure de mardi, et personne ne répond. Inadmissible.", NEG),
    FeedbackPlan("internet_reseau_mobile", "Agence Ouahigouya", 2,
                 "Connexion lente et coupures fréquentes, je paie un forfait data pour rien. Mécontent.", NEG),
    FeedbackPlan("internet_reseau_mobile", "Agence Orange Tanghin", 2,
                 "Pas de signal à l'intérieur de la maison, appels coupés en permanence. Très déçu.", NEG),
    FeedbackPlan("internet_reseau_mobile", "Agence Orange Tanghin", 1,
                 "Le réseau ne marche pas le week-end, panne après panne. C'est honteux.", NEG),
    FeedbackPlan("internet_reseau_mobile", "Agence Orange Pissy", 2,
                 "Débit catastrophique, les vidéos bloquent sans arrêt. Problème signalé deux fois.", NEG),
    FeedbackPlan("internet_reseau_mobile", "Agence Orange Pissy", 1,
                 "Coupure totale d'internet pendant deux jours sans aucune information. Inacceptable.", NEG),
    FeedbackPlan("internet_reseau_mobile", "Agence Orange Saaba", 5,
                 "Réseau 4G très bon depuis la nouvelle antenne, débit rapide. Merci.", POS),

    # ── forfaits_recharge : 8 feedbacks, 5 négatifs ─────────────────────────────
    FeedbackPlan("forfaits_recharge", "Agence Orange Siège (Koulouba)", 1,
                 "Recharge de 5000 FCFA non créditée sur mon compte malgré le reçu. Arnaque.", NEG),
    FeedbackPlan("forfaits_recharge", "Agence Orange Siège (Koulouba)", 4,
                 "Changement de forfait fait rapidement en agence, conseiller aimable.", POS),
    FeedbackPlan("forfaits_recharge", "Agence Orange Tanghin", 2,
                 "Forfait internet non activé après paiement, toujours bloqué depuis hier. Déçue.", NEG),
    FeedbackPlan("forfaits_recharge", "Agence Orange Saaba", 1,
                 "Recharge débitée deux fois mais crédit jamais reçu. Problème non résolu, inadmissible.", NEG),
    FeedbackPlan("forfaits_recharge", "Agence Orange Saaba", 5,
                 "Très bonne explication des offres de recharge, je suis satisfait.", POS),
    FeedbackPlan("forfaits_recharge", "Agence Premium Super U Zad", 2,
                 "Le bonus de recharge promis n'est pas arrivé, erreur de l'opérateur. Mécontent.", NEG),
    FeedbackPlan("forfaits_recharge", "Agence Premium Super U Zad", 4,
                 "Activation du forfait mensuel efficace, rien à redire.", POS),
    FeedbackPlan("forfaits_recharge", "Agence Orange Koupéla", 1,
                 "Forfait épuisé en deux jours, consommation incompréhensible. Arnaque, très déçu.", NEG),

    # ── facturation_paiement : 6 feedbacks, 5 négatifs ──────────────────────────
    FeedbackPlan("facturation_paiement", "Agence Orange Siège (Koulouba)", 1,
                 "Double prélèvement sur ma facture du mois, toujours pas remboursé. Scandaleux.", NEG),
    FeedbackPlan("facturation_paiement", "Agence Orange Siège (Koulouba)", 2,
                 "Litige de facture ouvert depuis un mois, pas de réponse du service. Très déçu.", NEG),
    FeedbackPlan("facturation_paiement", "Agence Orange Pissy", 2,
                 "Montant facturé erroné, erreur de calcul sur les appels. Problème non réglé.", NEG),
    FeedbackPlan("facturation_paiement", "Agence Orange Bobo-Dioulasso", 1,
                 "Paiement refusé deux fois puis prélevé en double. Inadmissible.", NEG),
    FeedbackPlan("facturation_paiement", "Agence Premium Centre Commercial Ouaga 2000", 2,
                 "Facture reçue en retard avec des pénalités injustifiées. Je suis mécontent.", NEG),
    FeedbackPlan("facturation_paiement", "Agence Ouahigouya", 5,
                 "Litige de facturation réglé rapidement par l'agence, très efficace.", POS),
]


# ============================================================================
# 2. GARDE-FOUS (lecture seule, AVANT toute écriture)
# ============================================================================

def verifier_commentaires() -> None:
    """Chaque commentaire doit produire, avec sa note, le sentiment attendu par le moteur
    réel (analyser_sentiment, le même que celui appelé par analyser_feedback)."""
    erreurs = []
    for p in PLAN:
        obtenu, _score = analyser_sentiment(p.commentaire, p.note)
        if obtenu != p.sentiment_attendu:
            erreurs.append(f"  [{p.cle}] attendu {p.sentiment_attendu.value}, obtenu {obtenu.value} : {p.commentaire}")
    if erreurs:
        raise SystemExit("[ERREUR] Commentaires mal classés par le moteur de sentiment :\n" + "\n".join(erreurs))


def resoudre_cibles(db, org: Organisation) -> dict:
    """{(agence_nom, cle): (qr_code, categorie_id, agence_id)} — par clé, jamais par nom de
    catégorie. Refuse tout plan dont une cible est absente ou ambiguë."""
    cibles, erreurs = {}, []
    for agence_nom, cle in sorted({(p.agence, p.cle) for p in PLAN}):
        agence = db.query(Agence).filter(Agence.organisation_id == org.id, Agence.nom == agence_nom).first()
        if agence is None:
            erreurs.append(f"  agence introuvable : {agence_nom}")
            continue
        cats = (
            db.query(Categorie)
            .filter(Categorie.agence_id == agence.id, Categorie.cle == cle, Categorie.active == True)  # noqa: E712
            .all()
        )
        if len(cats) != 1:
            erreurs.append(f"  {agence_nom} : {len(cats)} catégorie(s) active(s) de clé '{cle}' (exactement 1 attendue)")
            continue
        qr = db.query(QRCode).filter(QRCode.agence_id == agence.id, QRCode.actif == True).first()  # noqa: E712
        if qr is None:
            erreurs.append(f"  {agence_nom} : aucun QR code actif")
            continue
        cibles[(agence_nom, cle)] = (qr.code, cats[0].id, agence.id)
    if erreurs:
        raise SystemExit("[ERREUR] Cibles invalides, rien n'a été écrit :\n" + "\n".join(erreurs))
    return cibles


def feedback_ids_marques(db, org: Organisation) -> list:
    return [
        row.feedback_id for row in
        db.query(HistoriqueFeedback.feedback_id)
        .join(Agence, HistoriqueFeedback.agence_id == Agence.id)
        .filter(Agence.organisation_id == org.id, HistoriqueFeedback.type_evenement == MARQUEUR)
        .distinct()
        .all()
    ]


# ============================================================================
# 3. CRÉATION VIA LE PIPELINE RÉEL + ANTIDATAGE
# ============================================================================

def dates_aleatoires(n: int, rng: random.Random, now: datetime) -> list[datetime]:
    dates = []
    for _ in range(n):
        d = now - timedelta(days=rng.randint(*FENETRE_JOURS))
        dates.append(d.replace(hour=rng.randint(8, 19), minute=rng.randint(0, 59), second=rng.randint(0, 59), microsecond=0))
    return dates


def creer_un_feedback(db, p: FeedbackPlan, cible: tuple, date_cible: datetime) -> Feedback:
    qr_code, categorie_id, agence_id = cible
    reponse = submit_feedback(
        qr_code=qr_code,
        data=FeedbackCreate(categorie_id=categorie_id, note=p.note, commentaire=p.commentaire),
        background_tasks=BackgroundTasks(),
        db=db,
    )

    # Marqueur AVANT toute vérification (commit immédiat) : --supprimer doit retrouver ce
    # feedback même si la vérification ci-dessous l'arrête.
    db.add(HistoriqueFeedback(
        feedback_id=reponse.id,
        agence_id=agence_id,
        auteur_nom="Script seed_feedbacks_reclamations_demo",
        auteur_role="system",
        type_evenement=MARQUEUR,
        details=f"Jeu de données de démo, réclamations telecom (clé {p.cle})",
    ))
    db.commit()

    # submit_feedback journalise sans lever si l'analyse échoue : on vérifie ici qu'elle
    # existe et qu'elle a donné le sentiment attendu — jamais un feedback non analysé.
    analyse = db.query(AnalyseIA).filter(AnalyseIA.feedback_id == reponse.id).first()
    if analyse is None or analyse.sentiment != p.sentiment_attendu:
        obtenu = analyse.sentiment.value if analyse else "aucune analyse"
        raise RuntimeError(
            f"Analyse IA inattendue pour le feedback {reponse.id} ({p.cle}, {p.agence}) : "
            f"attendu {p.sentiment_attendu.value}, obtenu {obtenu}. Arrêt — les feedbacks déjà créés "
            f"portent le marqueur et peuvent être retirés avec --supprimer."
        )

    # Antidatage (seule étape non "temps réel" : l'analyse a déjà tourné pour de vrai).
    feedback = db.query(Feedback).filter(Feedback.id == reponse.id).first()
    feedback.date_soumission = date_cible
    db.query(HistoriqueFeedback).filter(HistoriqueFeedback.feedback_id == reponse.id).update(
        {"date_evenement": date_cible}, synchronize_session=False
    )
    analyse.date_analyse = date_cible
    db.commit()
    return feedback


# ============================================================================
# 4. SUPPRESSION (--supprimer) — uniquement ce que ce script a créé
# ============================================================================

def supprimer(db, org: Organisation) -> int:
    ids = feedback_ids_marques(db, org)
    if ids:
        # ON DELETE CASCADE au niveau de la base : analyses_ia (-> recommandations),
        # historique_feedbacks (dont le marqueur), demandes_contact, suggestions,
        # reponses_clients. historique_issues.feedback_id passe à NULL.
        db.query(Feedback).filter(Feedback.id.in_(ids)).delete(synchronize_session=False)
    db.commit()
    return len(ids)


# ============================================================================
# 5. MAIN
# ============================================================================

def main(argv: list[str] | None = None) -> None:
    argv = sys.argv[1:] if argv is None else argv
    db = SessionLocal()
    try:
        org = db.query(Organisation).filter(Organisation.nom == ORGANISATION_NOM).first()
        if org is None:
            raise SystemExit(f"[ERREUR] Organisation introuvable : {ORGANISATION_NOM}")

        if "--supprimer" in argv:
            n = supprimer(db, org)
            print(f"[OK] Supprimé : {n} feedback(s) de démo (marqueur {MARQUEUR}).")
            return

        if org.secteur_code != "telecom":
            raise SystemExit(f"[ERREUR] {org.nom} : secteur_code='{org.secteur_code}' (attendu 'telecom').")

        existants = len(feedback_ids_marques(db, org))
        if existants and "--force" not in argv:
            print(f"[REFUS] {existants} feedback(s) de démo (marqueur {MARQUEUR}) existent déjà pour {org.nom}. "
                  f"Relancer avec --force pour créer un second lot, ou --supprimer pour retirer l'existant.")
            return

        verifier_commentaires()
        cibles = resoudre_cibles(db, org)

        rng = random.Random(2026)
        now = datetime.now(timezone.utc)
        dates = dates_aleatoires(len(PLAN), rng, now)

        crees = []
        for p, d in zip(PLAN, dates):
            crees.append((p, creer_un_feedback(db, p, cibles[(p.agence, p.cle)], d)))

        print("\n" + "=" * 70)
        print(f"RÉCAPITULATIF — {org.nom}")
        print("=" * 70)
        print(f"Feedbacks créés : {len(crees)}")
        for cle in ("internet_reseau_mobile", "forfaits_recharge", "facturation_paiement"):
            lot = [p for p, _ in crees if p.cle == cle]
            negs = sum(1 for p in lot if p.sentiment_attendu == NEG)
            agences = sorted({p.agence for p in lot})
            print(f"  {cle} : {len(lot)} feedbacks, {negs} négatifs — agences : {', '.join(agences)}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
