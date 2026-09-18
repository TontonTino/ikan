import pytest
from app.utils.stats import wilson_lower_bound


def test_wilson_zero_total():
    assert wilson_lower_bound(0, 0) == 0.0


def test_wilson_perfect_scores_increase_with_sample_size():
    # 100% de satisfaction, mais la confiance doit croître avec le volume :
    # 1/1 < 2/2 < 3/3 < 100/100.
    w1 = wilson_lower_bound(1, 1)
    w2 = wilson_lower_bound(2, 2)
    w3 = wilson_lower_bound(3, 3)
    w100 = wilson_lower_bound(100, 100)

    assert w1 == pytest.approx(0.2066, abs=1e-3)
    assert w2 == pytest.approx(0.3424, abs=1e-3)
    assert w3 == pytest.approx(0.4385, abs=1e-3)
    assert w100 == pytest.approx(0.9630, abs=1e-3)
    assert w1 < w2 < w3 < w100


def test_wilson_40_sur_50():
    assert wilson_lower_bound(40, 50) == pytest.approx(0.6696, abs=1e-3)


def test_wilson_90_sur_100():
    # Valeur de référence validée : 82.56%, pas 82.2% (erreur d'une note antérieure).
    assert wilson_lower_bound(90, 100) == pytest.approx(0.8256, abs=1e-3)


def test_wilson_ranks_reliable_agency_above_small_perfect_one():
    # Une agence à 100% sur 2 avis ne doit pas dominer une agence à 90% sur
    # 200 avis : c'est la raison d'être du score de Wilson pour ce classement.
    petite_parfaite = wilson_lower_bound(2, 2)
    grande_fiable = wilson_lower_bound(180, 200)
    assert grande_fiable > petite_parfaite
