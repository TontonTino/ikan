import pytest
from app.services.ai.classification_service import classify, compute_criticite, detect_discordance
from app.services.ai.recommandations import generer_recommandations
from app.models.enums import CriticiteType, PriorityLevel


def test_theme_classification_15_categories():
    test_cases = [
        ("Le temps d'attente était beaucoup trop long au guichet.", "attente"),
        ("Personnel très accueillant, souriant et courtois.", "accueil"),
        ("L'application mobile se ferme dès que je consulte mon solde.", "application_mobile"),
        ("Plus de réseau 4G depuis ce matin dans toute la ville.", "reseau"),
        ("Frais bancaires injustifiés prélevés sur ma facture.", "facturation"),
        ("Agence très propre, espace climatisé et confortable.", "proprete_cadre"),
        ("Rupture de stock sur les nouvelles cartes SIM.", "disponibilite_produit"),
        ("Les tarifs et abonnements sont devenus hors de prix.", "tarifs"),
    ]
    for text, expected_theme in test_cases:
        res = classify(text)
        assert res["theme"] == expected_theme, f"Expected {expected_theme}, got {res['theme']} for '{text}'"
        assert res["score_sentiment"] >= 0.0 and res["score_sentiment"] <= 1.0


def test_sentiment_positif_malgre_mot_negatif_isole():
    # "problème" est reconnu négatif seul, mais "gain de cause"/"rapidement"/"réglé"
    # sont désormais reconnus positifs et l'emportent nettement.
    res = classify("J'ai eu gain de cause. On a rapidement réglé mon problème de carte sim", note=5)
    assert res["sentiment"] == "positive"


def test_sentiment_positif_mot_hors_dictionnaire_original():
    # "ravi(s)" est désormais dans le dictionnaire positif.
    res = classify("Je suis ravis de mon experience", note=5)
    assert res["sentiment"] == "positive"


def test_sentiment_positif_expression_forte_sans_regression():
    res = classify("L'accueil a été très bien, j'aime", note=4)
    assert res["sentiment"] == "positive"


def test_discordance_detection():
    # Note haute (5/5) mais sentiment négatif => Discordance
    assert detect_discordance(5, "negative") is True
    # Note basse (1/5) et sentiment négatif => Pas de discordance
    assert detect_discordance(1, "negative") is False
    # Note basse (1/5) mais sentiment positif => Discordance
    assert detect_discordance(1, "positive") is True


def test_recommendations_generation():
    recos = generer_recommandations("reseau", CriticiteType.CRITIQUE, discordance=False)
    assert len(recos) >= 1
    assert recos[0][1] == PriorityLevel.CRITICAL

    # Recommandations avec discordance
    recos_disc = generer_recommandations("attente", CriticiteType.ELEVEE, discordance=True)
    assert len(recos_disc) == 2
