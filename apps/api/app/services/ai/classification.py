"""
Classification thématique (BF-07).
Utilise classify() depuis app.services.ai.classification_service pour l'inférence IA
avec les 15 thèmes officiels de IKAN AI.
"""
from app.services.ai.classification_service import classify


def classifier_theme(texte: str) -> str:
    """
    Classifie le texte dans l'un des 15 thèmes IKAN AI via classify().
    """
    if not texte or len(texte.strip()) < 3:
        return "accueil"

    resultat = classify(texte)
    return resultat.get("theme", "accueil")

