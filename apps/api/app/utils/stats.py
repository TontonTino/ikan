"""
Utilitaires statistiques partagés — implémentation unique, à réutiliser
partout où un classement fiable par petit échantillon est nécessaire plutôt
que de dupliquer la formule.
"""
import math


def wilson_lower_bound(positifs: int, total: int, z: float = 1.96) -> float:
    """
    Borne inférieure de l'intervalle de confiance de Wilson pour une
    proportion, au niveau de confiance correspondant à z (1.96 => 95%).

    Sert à classer des agences par fiabilité de leur taux de satisfaction :
    une agence à 100% sur 2 avis ne doit pas dominer une agence à 90% sur
    200 avis — le CSAT brut ne fait pas cette distinction, Wilson si.

    Args:
        positifs: nombre d'avis positifs (ex: note >= 4).
        total: nombre total d'avis.
        z: score z du niveau de confiance (1.96 = 95%).

    Returns:
        La borne inférieure, entre 0.0 et 1.0. Retourne 0.0 si total == 0
        (aucun échantillon = aucune confiance, et 0.0 reste directement
        utilisable comme clé de tri sans gestion particulière de None).
    """
    if total <= 0:
        return 0.0

    phat = positifs / total
    z2 = z * z
    denominator = 1 + z2 / total
    center = phat + z2 / (2 * total)
    margin = z * math.sqrt((phat * (1 - phat) + z2 / (4 * total)) / total)
    return (center - margin) / denominator
