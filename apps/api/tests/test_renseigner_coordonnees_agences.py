"""Le script de rattrapage des coordonnées : positions connues, repli sur la ville, jamais d'invention."""
from scripts.renseigner_coordonnees_agences import AGENCES, VILLES, coordonnees_pour

# Les 11 agences de la démo Orange Burkina Faso (mêmes noms que scripts/seed_feedbacks_demo.py).
AGENCES_DEMO = [
    "Agence Orange Siège (Koulouba)", "Agence Orange Ouaga 2000", "Agence Premium Centre Commercial Ouaga 2000",
    "Agence Orange Tanghin", "Agence Orange Saaba", "Agence Premium Super U Zad", "Agence Orange Pissy",
    "Agence Orange Bobo-Dioulasso", "Agence Orange Koupéla", "Agence Ouahigouya", "Orange Digital Center (Cissin)",
]


def test_toutes_les_agences_de_demo_ont_une_position_exacte():
    for nom in AGENCES_DEMO:
        trouve = coordonnees_pour(nom, None)
        assert trouve is not None and trouve[2] is False, nom


def test_nom_tolerant_aux_accents_et_a_la_casse():
    assert coordonnees_pour("agence orange koupela", None) == (*AGENCES["Agence Orange Koupéla"], False)


def test_agence_inconnue_placee_au_centre_de_sa_ville_et_signalee_approximative():
    assert coordonnees_pour("Agence Orange Gounghin", "ouagadougou") == (*VILLES["Ouagadougou"], True)


def test_rien_d_invente_sans_nom_ni_ville_connus():
    assert coordonnees_pour("Agence X", "Ville inconnue") is None
    assert coordonnees_pour(None, None) is None


def test_positions_dans_les_limites_du_burkina_faso():
    for latitude, longitude in [*AGENCES.values(), *VILLES.values()]:
        assert 9.3 <= latitude <= 15.1 and -5.6 <= longitude <= 2.5
