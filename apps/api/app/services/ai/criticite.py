"""
Calcul de la criticité d'un feedback (BF-08, BF-17).
Combine la note et le sentiment pour évaluer l'urgence.
"""
from app.models.enums import SentimentType, CriticiteType


def calculer_criticite(note: int, sentiment: SentimentType) -> CriticiteType:
    """
    Calcule le niveau de criticité basé sur la note et le sentiment.

    Matrice de criticité :
    ┌──────────┬──────────┬──────────┬──────────┐
    │          │ Positif  │  Neutre  │ Négatif  │
    ├──────────┼──────────┼──────────┼──────────┤
    │ Note 5   │ Faible   │ Faible   │ Élevée*  │
    │ Note 4   │ Faible   │ Moyenne  │ Élevée*  │
    │ Note 3   │ Faible   │ Moyenne  │ Élevée   │
    │ Note 2   │ Moyenne  │ Élevée   │ Critique │
    │ Note 1   │ Élevée   │ Critique │ Critique │
    └──────────┴──────────┴──────────┴──────────┘
    * Discordance détectée
    """
    if note >= 4:
        if sentiment == SentimentType.POSITIF:
            return CriticiteType.FAIBLE
        elif sentiment == SentimentType.NEUTRE:
            return CriticiteType.FAIBLE if note == 5 else CriticiteType.MOYENNE
        else:  # Négatif — discordance
            return CriticiteType.ELEVEE

    elif note == 3:
        if sentiment == SentimentType.POSITIF:
            return CriticiteType.FAIBLE
        elif sentiment == SentimentType.NEUTRE:
            return CriticiteType.MOYENNE
        else:
            return CriticiteType.ELEVEE

    elif note == 2:
        if sentiment == SentimentType.POSITIF:
            return CriticiteType.MOYENNE
        elif sentiment == SentimentType.NEUTRE:
            return CriticiteType.ELEVEE
        else:
            return CriticiteType.CRITIQUE

    else:  # Note 1
        if sentiment == SentimentType.POSITIF:
            return CriticiteType.ELEVEE
        else:
            return CriticiteType.CRITIQUE


def detecter_discordance(note: int, sentiment: SentimentType) -> bool:
    """
    Détecte une discordance : note haute (>=4) avec commentaire négatif (BF-08).
    Signal qualité important — indique que le client n'exprime pas sa vraie insatisfaction via la note.
    """
    return note >= 4 and sentiment == SentimentType.NEGATIF
