"""
Service d'analyse IA principal — orchestre toutes les analyses pour un feedback.
Exécuté en tâche de fond après la soumission d'un feedback.
"""
import uuid
import logging
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.feedback import Feedback
from app.models.analyse_ia import AnalyseIA
from app.models.recommandation import Recommandation
from app.models.enums import SentimentType, CriticiteType
from app.services.ai.sentiment import analyser_sentiment
from app.services.ai.classification_service import compute_criticite, detect_discordance
from app.services.ai.recommandations import generer_recommandations
from app.services.plan_catalog import FEATURE_DISCORDANCE
from app.services.plan_service import organisation_a_la_fonctionnalite, organisation_du_feedback

logger = logging.getLogger(__name__)

# Mapping des chaînes de classification vers les Enums SQLAlchemy
SENTIMENT_MAP = {
    "positive": SentimentType.POSITIF,
    "positif": SentimentType.POSITIF,
    "negative": SentimentType.NEGATIF,
    "negatif": SentimentType.NEGATIF,
    "neutral": SentimentType.NEUTRE,
    "neutre": SentimentType.NEUTRE,
}

CRITICITE_MAP = {
    "critique": CriticiteType.CRITIQUE,
    "elevee": CriticiteType.ELEVEE,
    "moyenne": CriticiteType.MOYENNE,
    "faible": CriticiteType.FAIBLE,
}


def analyser_feedback(feedback_id: uuid.UUID, db: Session | None = None) -> None:
    """
    Analyse complète d'un feedback :
    1. Analyse de sentiment (moteur lexical déterministe)
    2. Thème = catégorie choisie par le client sur le formulaire (plus de devinette IA)
    3. Détection de discordance
    4. Calcul de criticité
    5. Génération de recommandations d'action
    """
    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True

    try:
        feedback = db.query(Feedback).filter(Feedback.id == feedback_id).first()
        if not feedback:
            logger.warning(f"Feedback {feedback_id} introuvable pour analyse")
            return

        # Ne pas analyser si déjà analysé
        existing = db.query(AnalyseIA).filter(AnalyseIA.feedback_id == feedback_id).first()
        if existing:
            logger.info(f"Feedback {feedback_id} déjà analysé")
            return

        texte = (feedback.commentaire or "").strip()
        if not texte:
            # Récupérer la suggestion associée si le client a partagé une idée
            from app.models.suggestion import Suggestion
            sugg = db.query(Suggestion).filter(Suggestion.feedback_id == feedback_id).first()
            if sugg and sugg.contenu:
                texte = sugg.contenu.strip()

        # 1. Le thème n'est plus deviné par l'IA : c'est la catégorie choisie par le
        # client sur le formulaire (fallback "accueil" pour les rares feedbacks
        # anciens sans catégorie rattachée).
        theme = feedback.categorie.nom if feedback.categorie else "accueil"

        # 2. Inférence du sentiment (moteur lexical déterministe, cf. sentiment.py)
        if not texte:
            if feedback.note >= 4:
                raw_sentiment = "positive"
                score_sentiment = 0.85
            elif feedback.note <= 2:
                raw_sentiment = "negative"
                score_sentiment = 0.20
            else:
                raw_sentiment = "neutral"
                score_sentiment = 0.50
        else:
            sent_enum, score_sentiment = analyser_sentiment(texte, feedback.note)
            raw_sentiment = (
                "positive" if sent_enum == SentimentType.POSITIF
                else "negative" if sent_enum == SentimentType.NEGATIF
                else "neutral"
            )

        # 3. Détection de discordance & calcul criticité
        raw_criticite = compute_criticite(feedback.note, raw_sentiment)
        # Détection de discordance : fonctionnalité Pro+. Fail-open — en cas de doute
        # ou d'erreur la détection s'exécute ; sinon le champ garde sa valeur par
        # défaut (False). Le sentiment et la criticité, eux, sont TOUJOURS calculés.
        if organisation_a_la_fonctionnalite(
            organisation_du_feedback(feedback), FEATURE_DISCORDANCE, db
        ):
            discordance = detect_discordance(feedback.note, raw_sentiment)
        else:
            discordance = False

        # Conversion vers vos Enums de base de données
        sentiment_enum = SENTIMENT_MAP.get(raw_sentiment.lower(), SentimentType.NEUTRE)
        criticite_enum = CRITICITE_MAP.get(raw_criticite.lower(), CriticiteType.FAIBLE)

        logger.info(
            f"Feedback {feedback_id} analysé — "
            f"sentiment={sentiment_enum.value}, score={score_sentiment}, theme={theme}, "
            f"criticite={criticite_enum.value}, discordance={discordance}"
        )

        # 4. Persister l'analyse avec score_sentiment
        analyse = AnalyseIA(
            feedback_id=feedback_id,
            sentiment=sentiment_enum,
            criticite=criticite_enum,
            theme_principal=theme,
            discordance_detectee=discordance,
            score_sentiment=score_sentiment,
        )
        db.add(analyse)
        db.flush()

        # 5. Générer les recommandations d'action
        recommandations = generer_recommandations(theme, criticite_enum, discordance)
        for contenu, priorite in recommandations:
            reco = Recommandation(
                analyse_ia_id=analyse.id,
                contenu=contenu,
                priorite=priorite,
            )
            db.add(reco)

        db.commit()
        logger.info(f"Analyse et recommandations sauvegardées pour feedback {feedback_id}")

    except Exception as e:
        logger.error(f"Erreur lors de l'analyse du feedback {feedback_id}: {e}")
        db.rollback()
    finally:
        if close_db:
            db.close()