"""
Signaux d'urgence / préjudice : détection en DÉBUT DE MOT.

Régression : « vol » était cherché comme simple sous-chaîne, si bien que « volume », « évolution » ou « volonté »
faisaient monter la criticité d'un avis positif à « élevée » (alertes, recommandations « retour négatif » à tort).
Les vraies plaintes (vol, danger, double débit, urgence…) restent détectées.
"""
import os

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-signaux-criticite-0123456789")

import pytest

from app.services.ai.classification_service import compute_criticite, detecter_signaux


@pytest.mark.parametrize("texte", [
    "Le volume de la musique était correct",
    "Belle évolution du service cette année",
    "Merci pour votre volonté de nous aider",
    "Un départ involontaire mais sans conséquence",
    "VOLUME-12 avis de volume",
    "Une révolution dans la qualité d'accueil",
])
def test_aucun_faux_positif_sur_des_mots_qui_contiennent_vol(texte):
    assert detecter_signaux(texte) == ([], [])
    assert compute_criticite(5, "positif", texte) == "faible"


@pytest.mark.parametrize("texte,attendu", [
    ("On m'a volé mon téléphone dans l'agence", "vol"),
    ("Il y a eu un vol dans la file d'attente", "vol"),
    ("Deux vols cette semaine", "vol"),
    ("Le voleur est reparti sans être inquiété", "vol"),
    ("C'est dangereux de rester dans ce hall", "danger"),
    ("J'ai été débité deux fois", "debite"),
    ("Mon dossier est perdu depuis une semaine", "perdu"),
    ("Ma carte perdue n'a pas été remplacée", "perdu"),
    ("Un remboursement est attendu", "remboursement"),
    ("Problème de sécurité à l'entrée", "securite"),
])
def test_les_vraies_plaintes_restent_detectees(texte, attendu):
    urgence, prejudice = detecter_signaux(texte)
    assert attendu in prejudice, (texte, urgence, prejudice)


@pytest.mark.parametrize("texte,attendu", [
    ("C'est urgent, répondez-moi", "urgent"),
    ("Réponse demandée tout de suite", "tout de suite"),
    ("Personne ne répond au téléphone", "personne ne repond"),
    ("Toujours pas de nouvelles", "toujours pas"),
    ("Demande urgente de rappel", "urgent"),
])
def test_signaux_d_urgence_detectes(texte, attendu):
    assert attendu in detecter_signaux(texte)[0]


def test_la_criticite_de_base_n_est_pas_modifiee_hors_signaux():
    assert compute_criticite(1, "negatif", "service lent") == "critique"
    assert compute_criticite(3, "neutre", "correct") == "moyenne"
    assert compute_criticite(5, "positif", "excellent") == "faible"


def test_un_signal_reel_renforce_toujours_la_criticite():
    assert compute_criticite(5, "positif", "On m'a volé mon portable") == "elevee"
    assert compute_criticite(3, "neutre", "urgent et dangereux") in ("elevee", "critique")


def test_texte_vide():
    assert detecter_signaux("") == ([], [])
    assert detecter_signaux(None) == ([], [])  # type: ignore[arg-type]
