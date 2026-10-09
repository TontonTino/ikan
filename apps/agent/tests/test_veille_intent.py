from app.agent.intent_classifier import classifier_intention
from app.agent import qa_service
from app.models.enums import UserRole

from .conftest import token_for


def test_termes_explicites_reconnaissent_la_veille_externe():
    for question in (
        "Que disent les mentions Facebook cette semaine ?",
        "Fais une veille sur les réseaux sociaux",
        "Quelle est notre e-réputation en ligne ?",
    ):
        assert classifier_intention(question) == "veille_externe"


def test_les_mots_cles_veille_priment_sur_les_periodes():
    assert classifier_intention("Que disent les mentions Facebook cette semaine ?") == "veille_externe"
    assert classifier_intention("Que disent les gens sur Facebook ce mois-ci ?") == "veille_externe"


def test_question_generale_sur_les_clients_reste_dans_les_feedbacks():
    assert classifier_intention("Que disent les clients ?") == "resume_periode"
    assert classifier_intention("Quelle est la répartition par thème ?") == "statistiques_theme"


def test_les_periodes_sans_mot_cle_veille_reste_dans_le_flux_feedback():
    assert classifier_intention("Résume-moi cette semaine") == "resume_periode"
    assert classifier_intention("Comment ça s'est passé ce mois-ci ?") == "resume_periode"


def test_agency_manager_recoit_un_refus_fixe_sans_llm(client, orgs, fake_llm):
    r = client.post(
        "/agent/ask",
        json={"question": "Analyse les mentions Facebook", "role": "cx_manager"},
        headers=token_for(orgs.a.am),
    )
    assert r.status_code == 200, r.text
    assert r.json()["intention"] == "veille_externe"
    assert "réservée au CX Manager" in r.json()["reponse"]
    assert fake_llm.calls == []


def test_cx_manager_sans_mention_recoit_reponse_fixe_sans_llm(client, orgs, fake_llm):
    r = client.post(
        "/agent/ask",
        json={"question": "Notre veille Facebook cette semaine ?", "role": "agency_manager"},
        headers=token_for(orgs.a.cx),
    )
    assert r.status_code == 200, r.text
    assert r.json()["intention"] == "veille_externe"
    assert "Veille réseaux sociaux" in r.json()["reponse"]
    assert "Aucune mention" in r.json()["reponse"]
    assert "séparées des indicateurs de satisfaction" in r.json()["reponse"]
    assert fake_llm.calls == []


def test_le_role_ne_peut_pas_etre_fourni_par_le_client(client, orgs, fake_llm):
    r = client.post(
        "/agent/ask",
        json={"question": "Analyse les mentions Facebook", "role": UserRole.CX_MANAGER.value},
        headers=token_for(orgs.a.am),
    )
    assert r.status_code == 200, r.text
    assert "réservée au CX Manager" in r.json()["reponse"]
    assert fake_llm.calls == []


def test_refus_veille_precede_les_requetes_metier_et_la_memoire(monkeypatch, orgs, fake_llm):
    def _interdit(*args, **kwargs):
        raise AssertionError("aucune requête métier ni lecture mémoire ne doit précéder le refus")

    monkeypatch.setattr(qa_service.queries, "verifier_agence_dans_organisation", _interdit)
    monkeypatch.setattr(qa_service, "_charger_memoire", _interdit)
    resultat = qa_service.repondre_question(
        None,
        orgs.a.org.id,
        "Analyse les mentions Facebook",
        role=UserRole.AGENCY_MANAGER,
    )
    assert "réservée au CX Manager" in resultat["reponse"]
    assert fake_llm.calls == []


def test_intentions_feedback_existantes_ne_regressent_pas():
    cases = {
        "Y a-t-il des alertes critiques ?": "alertes_critiques",
        "Quelle est la répartition par thème ?": "statistiques_theme",
        "Fais-moi un résumé de la période": "resume_periode",
        "Quels sont les problèmes récurrents ?": "problemes_recurrents",
        "Comment évolue la satisfaction dans le temps ?": "evolution_satisfaction",
        "Quelles sont tes recommandations d'actions prioritaires ?": "recommandations",
    }
    for question, attendu in cases.items():
        assert classifier_intention(question) == attendu
