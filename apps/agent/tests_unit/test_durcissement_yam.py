"""
Durcissement de la fiabilité de YAM — ambiguïtés d'agence, cohérence des affirmations, recommandations.

Tests UNITAIRES sans base ni fournisseur IA (le LLM est une doublure scriptée). Ils vérifient le comportement
du code ; ils ne prétendent pas garantir la véracité de toutes les phrases d'un modèle de langage.

  python -m pytest tests_unit
"""
import os
import uuid

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@127.0.0.1:1/ikanai_test_unit")  # jamais connectée
os.environ.setdefault("SECRET_KEY", "test-secret-key-durcissement-0123456789abcdef")
os.environ.setdefault("WEBHOOK_SECRET", "test-webhook-secret-durcissement")

from app.agent import calculs, coherence, perimetre, qa_service  # noqa: E402
from app.models.enums import UserRole  # noqa: E402
from app.providers.llm_provider import TexteGenere  # noqa: E402

ORG = uuid.uuid4()


def ag(nom, ville):
    return {"id": uuid.uuid4(), "nom": nom, "ville": ville}


T_BOURGUIBA = ag("Agence Tunis Bourguiba", "Tunis")
T_LAC = ag("Agence Tunis Lac", "Tunis")
SFAX = ag("Agence Sfax Ville", "Sfax")
GABES_1 = ag("Agence Gabès Centre", "Gabès")
GABES_2 = ag("Agence Gabès Centre", "Gabès")  # homonyme exact
ALPHA_CENTRE = ag("Agence ALPHA-Centre", None)
ALPHA_NORD = ag("Agence ALPHA-Nord", None)
AGENCES = [T_BOURGUIBA, T_LAC, SFAX, GABES_1, GABES_2, ALPHA_CENTRE, ALPHA_NORD]


# ═════════════════════════ 1. Résolution des ambiguïtés d'agence ═════════════════════════

def resoudre(question):
    return perimetre.resoudre_agences(question, AGENCES)


def test_ville_commune_a_deux_agences_est_ambigue_pas_devinee():
    r = resoudre("Comment va Tunis ?")
    assert r.statut == perimetre.AMBIGUE and {a["id"] for a in r.agences} == {T_BOURGUIBA["id"], T_LAC["id"]}


def test_le_nom_complet_leve_l_ambiguite_de_la_ville():
    r = resoudre("Les alertes de l'agence Tunis Lac ?")
    assert r.statut == perimetre.UNIQUE and r.agences == [T_LAC]
    assert resoudre("Tunis Lac").agences == [T_LAC]  # sans le préfixe « agence »


def test_nom_partiel_unique_est_reconnu_et_nom_partiel_commun_reste_ambigu():
    assert resoudre("Les retours sur Bourguiba").agences == [T_BOURGUIBA]
    assert resoudre("Les retours sur Tunis").statut == perimetre.AMBIGUE


def test_noms_identiques_sont_ambigus_et_le_libelle_donne_la_ville():
    r = resoudre("Les avis de l'agence Gabès Centre")
    assert r.statut == perimetre.AMBIGUE and len(r.agences) == 2
    assert perimetre.libelle_agence(GABES_1) == "« Agence Gabès Centre » (Gabès)"


def test_prefixe_commun_ne_designe_pas_les_deux_agences():
    r = resoudre("Les alertes de l'agence ALPHA-Nord")
    assert r.statut == perimetre.UNIQUE and r.agences == [ALPHA_NORD]


def test_deux_agences_distinctes_citees_sont_multiples():
    assert resoudre("Compare Sfax et Agence Tunis Lac").statut == perimetre.MULTIPLES


def test_un_terme_ambigu_mele_a_une_agence_precise_reste_ambigu():
    assert resoudre("Compare Sfax et Tunis").statut == perimetre.AMBIGUE


def test_agence_precise_et_agence_citee_en_passant_ne_sont_pas_fusionnees():
    r = resoudre("Sfax et Agence Tunis Lac")
    assert r.statut == perimetre.MULTIPLES and {a["id"] for a in r.agences} == {SFAX["id"], T_LAC["id"]}


def test_aucun_nom_donne_aucune_agence_et_un_mot_du_domaine_n_est_pas_un_nom():
    assert resoudre("Où en est mon réseau ?").statut == perimetre.AUCUNE
    assert perimetre.resoudre_agences("accueil et service", [ag("Agence Accueil", None)]).statut == perimetre.AUCUNE


# ── flux complets : l'ambiguïté ne lit aucune donnée, n'appelle pas le LLM, n'élargit rien ──

class Espion:
    def __init__(self):
        self.llm_calls = []
        self.reponses_llm = []
        self.requetes = []

    def llm(self, system_prompt, user_prompt, *, messages_history=None, max_tokens=400):
        self.llm_calls.append({"system": system_prompt, "user": user_prompt, "messages": messages_history})
        return self.reponses_llm.pop(0)


def texte(contenu, finish="stop"):
    t = TexteGenere(contenu)
    t.finish_reason = finish
    t.tronquee = finish == "length"
    return t


@pytest.fixture()
def espion(monkeypatch):
    e = Espion()
    monkeypatch.setattr(qa_service.llm_provider, "generate_text", e.llm)
    monkeypatch.setattr(qa_service.queries, "lister_agences_organisation", lambda db, org: AGENCES)
    monkeypatch.setattr(qa_service.queries, "get_secteur_organisation", lambda db, org: None)
    monkeypatch.setattr(qa_service.queries, "verifier_agence_dans_organisation", lambda db, org, a: None)

    def get_feedbacks(db, org, agence_id=None, jours=7):
        e.requetes.append(("get_feedbacks", agence_id))
        return [{"agence_nom": "Agence Tunis Lac", "criticite": "critique", "theme_principal": "accueil",
                 "sentiment_score": 0.2, "date_soumission": "2026-10-09T10:00:00+00:00", "commentaire": "Attente"}] * 8

    def alertes(db, org, agence_id=None, jours=7):
        e.requetes.append(("alertes", agence_id))
        return [{"agence_nom": "Agence Tunis Lac", "criticite": "critique", "theme_principal": "accueil",
                 "score_priorite": 0.9, "commentaire": "Attente"}] * 7 + [
                {"agence_nom": "Agence Sfax Ville", "criticite": "elevee", "theme_principal": "accueil",
                 "score_priorite": 0.6, "commentaire": "Attente"}]

    def classement(db, org, agence_id=None, jours=30):
        e.requetes.append(("classement", agence_id))
        return {"plus_faibles": [{"agence_nom": "Agence Sfax Ville", "satisfaction_pct": 40.0, "nb_feedbacks": 5}],
                "meilleures": [], "periode_jours": jours, "nb_agences_classees": 3,
                "perimetre_restreint_a_une_agence": False, "agences_actives_sans_feedback": []}

    def reco(db, org, agence_id=None, jours=7):
        e.requetes.append(("recommandations", agence_id))
        return {"alertes_prioritaires": [{"agence_nom": "Agence Tunis Lac", "theme": "accueil", "criticite": "critique",
                                          "score_priorite": 0.9, "commentaire_exemple": "Attente interminable"}],
                "problemes_systemiques": [], "risques_detectes": [], "tendance_globale": "insuffisant",
                "periode_analysee": "7 jours", "donnees_disponibles": True}

    monkeypatch.setattr(qa_service.queries, "get_feedbacks", get_feedbacks)
    monkeypatch.setattr(qa_service.queries, "query_alertes_critiques", alertes)
    monkeypatch.setattr(qa_service.queries, "query_classement_agences", classement)
    monkeypatch.setattr(qa_service.queries, "query_recommandations", reco)
    return e


def poser(question, *, role=UserRole.CX_MANAGER, agence_id=None):
    return qa_service.repondre_question(None, ORG, question, agence_id=agence_id, jours=7, role=role)


def test_cx_manager_ville_ambigue_demande_une_precision_sans_lire_de_donnees(espion):
    res = poser("Y a-t-il des alertes critiques à Tunis ?")
    assert res["intention"] == "agence_a_preciser"
    assert "Plusieurs agences peuvent correspondre" in res["reponse"]
    assert "Agence Tunis Bourguiba" in res["reponse"] and "Agence Tunis Lac" in res["reponse"]
    assert "Sfax" not in res["reponse"]
    assert espion.requetes == [] and espion.llm_calls == []


def test_homonymes_exacts_invitent_a_donner_la_ville_ou_l_adresse(espion):
    res = poser("Les alertes critiques de l'agence Gabès Centre ?")
    assert res["intention"] == "agence_a_preciser" and "même nom" in res["reponse"]
    assert espion.requetes == []


def test_deux_agences_citees_hors_classement_demandent_de_choisir(espion):
    res = poser("Les alertes critiques de Sfax et de l'agence Tunis Lac ?")
    assert res["intention"] == "agence_a_preciser" and "une agence à la fois" in res["reponse"]
    assert espion.requetes == [] and espion.llm_calls == []


def test_deux_agences_citees_pour_un_classement_portent_sur_le_reseau_dit_explicitement(espion):
    espion.reponses_llm = [texte("L'agence Sfax Ville a la satisfaction la plus faible : 40 % sur 5 feedbacks.")]
    res = poser("Quelle est la meilleure agence entre Sfax et l'agence Tunis Lac ?")
    assert espion.requetes == [("classement", None)]
    assert "toutes les agences de l'organisation (la question en cite plusieurs" in espion.llm_calls[0]["system"]
    assert res["intention"] == "classement_agences"


def test_cx_manager_agence_selectionnee_en_conflit_avec_l_agence_citee(espion):
    res = poser("Les alertes critiques de Sfax ?", agence_id=T_LAC["id"])
    assert res["intention"] == "agence_a_preciser" and "déjà sélectionnée (Agence Tunis Lac)" in res["reponse"]
    assert espion.requetes == []


def test_cx_manager_agence_selectionnee_et_meme_agence_citee_est_acceptee(espion):
    espion.reponses_llm = [texte("Huit alertes sur l'accueil.")]
    poser("Les alertes critiques de l'agence Tunis Lac ?", agence_id=T_LAC["id"])
    assert espion.requetes == [("alertes", T_LAC["id"])]


def test_responsable_dont_le_terme_designe_sa_ville_et_une_autre_ne_recoit_aucun_detail_sur_les_autres(espion):
    res = poser("Les alertes critiques de Tunis ?", role=UserRole.AGENCY_MANAGER, agence_id=T_BOURGUIBA["id"])
    assert res["intention"] == "agence_a_preciser"
    assert "Agence Tunis Bourguiba" in res["reponse"] and "Lac" not in res["reponse"]
    assert espion.requetes == [] and espion.llm_calls == []


def test_responsable_qui_cite_une_ville_commune_hors_de_son_agence_est_refuse(espion):
    res = poser("Les alertes de Tunis ?", role=UserRole.AGENCY_MANAGER, agence_id=SFAX["id"])
    assert res["intention"] == "agence_hors_perimetre"
    assert "Tunis" not in res["reponse"] and "Lac" not in res["reponse"] and "Bourguiba" not in res["reponse"]
    assert espion.requetes == [] and espion.llm_calls == []


def test_responsable_qui_cite_sa_propre_agence_sans_ambiguite_est_servi(espion):
    espion.reponses_llm = [texte("Huit alertes sur l'accueil.")]
    res = poser("Les alertes de l'agence Tunis Lac ?", role=UserRole.AGENCY_MANAGER, agence_id=T_LAC["id"])
    assert res["intention"] not in ("agence_a_preciser", "agence_hors_perimetre")
    assert espion.requetes == [("alertes", T_LAC["id"])]


def test_ambiguite_toujours_resolue_dans_l_organisation_de_l_appelant_uniquement(espion, monkeypatch):
    vues = []

    def agences(db, org):
        vues.append(org)
        return AGENCES

    monkeypatch.setattr(qa_service.queries, "lister_agences_organisation", agences)
    poser("Les alertes de Tunis ?")
    assert vues == [ORG]


# ═════════════════════════ 2. Cohérence des affirmations ═════════════════════════

@pytest.mark.parametrize("phrase", [
    "Ces agences représentent la moitié des incidents critiques (7 sur 8).",
    "La majorité des alertes (20 %) concerne l'accueil.",
    "Une minorité des avis (90 %) est négative.",
    "La totalité des avis (50 %) concerne l'accueil.",
    "Aucun avis critique (60 %) n'est signalé.",
    "Un quart des alertes (75 %) vient de Tunis.",
    "Les trois quarts des retours (20 %) sont positifs.",
    "Un tiers des feedbacks (4 sur 5) est critique.",
])
def test_formulation_de_proportion_contredite_par_ses_chiffres(phrase):
    assert coherence.incoherences_proportions(phrase), phrase


@pytest.mark.parametrize("phrase", [
    "Ces agences représentent la grande majorité des incidents critiques (7 sur 8).",
    "L'agence Tunis concentre environ la moitié des alertes (4 sur 8, soit 50 %).",
    "La majorité des alertes (62,5 %) concerne l'accueil.",
    "Une minorité des avis (20 %) est négative.",
    "Tous les avis analysés (100 %) concernent l'accueil.",
    "La totalité des alertes (8 sur 8) concerne l'accueil.",
    "La moitié des feedbacks est négative.",  # sans chiffre : non vérifiable, donc non jugée
    "Un quart des alertes (25 %) vient de Tunis.",
])
def test_formulation_de_proportion_coherente_ou_non_verifiable_n_est_pas_signalee(phrase):
    assert coherence.incoherences_proportions(phrase) == [], phrase


def test_fraction_impossible_est_detectee():
    assert coherence.incoherences_proportions("Il y a 8 sur 7 alertes critiques.")


def test_comparaisons_et_pourcentages_multiples_dans_une_phrase_sont_juges_sur_l_ensemble():
    # le qualificatif n'est contredit que si AUCUN chiffre de la phrase ne le justifie
    assert coherence.incoherences_proportions("Tunis (50 %) devance Sfax (25 %), soit la moitié des alertes.") == []
    assert coherence.incoherences_proportions("Tunis (10 %) devance Sfax (5 %) : la majorité des alertes.")


def test_les_formulations_calculees_par_le_code_ne_sont_jamais_contredites_par_le_controle():
    for pct in [0, 0.1, 5, 14.9, 15, 25, 29.9, 30, 33.3, 44.9, 45, 50, 55, 55.1, 60, 74.9, 75, 87.5, 99.9, 100]:
        formulation = calculs.qualifier_proportion(float(pct))
        phrase = f"{formulation} des alertes ({pct} %)"
        if formulation in {"la totalité", "aucun"} or "moitié" in formulation or "majorité" in formulation or "minorité" in formulation:
            assert coherence.incoherences_proportions(phrase) == [], (pct, formulation)


def test_le_code_fournit_les_formulations_de_proportion_au_modele():
    a = calculs.alertes([{"agence_nom": "T", "criticite": "critique", "theme_principal": "accueil"}] * 7
                        + [{"agence_nom": "S", "criticite": "elevee", "theme_principal": "accueil"}])
    assert a["par_agence"][0]["pourcentage"] == 87.5 and a["par_agence"][0]["formulation"] == "la grande majorité"
    assert a["par_criticite"]["critique"]["formulation"] == "la grande majorité"
    assert a["par_theme"][0]["formulation"] == "la totalité"
    assert calculs.qualifier_proportion(None) is None and calculs.qualifier_proportion(50.0) == "environ la moitié"


def test_une_incoherence_de_proportion_relance_puis_est_signalee_si_elle_persiste(espion):
    espion.reponses_llm = [
        texte("Sfax et Tunis représentent la moitié des alertes (7 sur 8)."),
        texte("Tunis concentre la grande majorité des alertes (7 sur 8)."),
    ]
    res = poser("Y a-t-il des alertes critiques ?")
    assert len(espion.llm_calls) == 2 and "grande majorité" in res["reponse"] and res["avertissements"] == []
    assert "contredit les chiffres" in espion.llm_calls[1]["user"]

    espion.reponses_llm = [texte("La moitié des alertes (7 sur 8)."), texte("Toujours la moitié des alertes (7 sur 8).")]
    res = poser("Y a-t-il des alertes critiques ?")
    assert "Vérification automatique" in res["reponse"] and "proportion_incoherente" in res["avertissements"]
    assert "Toujours la moitié" in res["reponse"]  # signalée, pas supprimée en silence


def test_le_modele_recoit_les_formulations_de_proportion_calculees(espion):
    espion.reponses_llm = [texte("Sept alertes sur huit concernent Tunis.")]
    poser("Y a-t-il des alertes critiques ?")
    prompt = espion.llm_calls[0]["user"]
    assert '"formulation": "la grande majorité"' in prompt and '"pourcentage": 87.5' in prompt
    assert "reprends la formulation du champ" in espion.llm_calls[0]["system"]


# ═════════════════════════ 3. Recommandations encadrées ═════════════════════════

SOURCE_RECO = "Agence Tunis Lac accueil critique score 0.9 Attente interminable 1 alerte prioritaire"


def test_equipe_effectif_dispositif_inventes_sont_detectes_seulement_s_ils_sont_absents_des_donnees():
    texte_reco = "Créer une équipe de secours pour l'agence, ajouter des agents supplémentaires et lancer RAPID-TEAM."
    trouves = coherence.capacites_inventees(texte_reco, SOURCE_RECO)
    assert "equipe de secours" in trouves and "agents supplementaires" in trouves and "RAPID-TEAM" in trouves
    # le terme figure dans les données (commentaire d'un client) : il n'est pas inventé par YAM
    assert coherence.capacites_inventees("Un renfort est demandé.", SOURCE_RECO + " le client demande un renfort") == []
    assert coherence.capacites_inventees("Revoir la gestion de la file d'attente.", SOURCE_RECO) == []


def test_action_sans_fondee_sur_ou_sans_ancrage_est_signalee():
    texte_reco = (
        "🔴 URGENT :\n"
        "- Revoir l'accueil à l'Agence Tunis Lac — fondée sur : l'alerte critique d'accueil (score 0.9).\n"
        "- Réorganiser tout le réseau.\n"
        "🟡 IMPORTANT :\n"
        "- Former le personnel — fondée sur : une intuition générale.\n"
        "Ces suggestions sont fondées sur 4 feedbacks."
    )
    sans = coherence.recommandations_sans_justification(texte_reco, SOURCE_RECO)
    assert any("Réorganiser" in l for l in sans) and any("Former" in l for l in sans)
    assert not any("Revoir l'accueil" in l for l in sans) and not any("Ces suggestions" in l for l in sans)


def test_recommandation_justifiee_n_est_pas_modifiee(espion):
    espion.reponses_llm = [texte(
        "🔴 URGENT :\n- Revoir l'accueil à l'Agence Tunis Lac — fondée sur : l'alerte prioritaire d'accueil (score 0.9)."
    )]
    res = poser("Que me recommandes-tu de faire en priorité ?")
    assert len(espion.llm_calls) == 1 and res["avertissements"] == []
    assert "Revoir l'accueil à l'Agence Tunis Lac" in res["reponse"]


def test_recommandation_sans_justification_est_relancee_puis_retiree_avec_mention(espion):
    espion.reponses_llm = [
        texte("🔴 URGENT :\n- Réorganiser tout le réseau."),
        texte("🔴 URGENT :\n- Réorganiser tout le réseau.\n🟡 IMPORTANT :\n- Revoir l'accueil à l'Agence Tunis Lac — fondée sur : l'alerte prioritaire d'accueil."),
    ]
    res = poser("Que me recommandes-tu de faire en priorité ?")
    assert len(espion.llm_calls) == 2 and "fondée sur" in espion.llm_calls[1]["user"]
    assert "Réorganiser tout le réseau" not in res["reponse"]  # aucune justification : retirée
    assert "Revoir l'accueil à l'Agence Tunis Lac" in res["reponse"]
    assert "suggestions_non_justifiees_retirees" in res["avertissements"] and "ont été retirées" in res["reponse"]


def test_equipe_inventee_dans_une_recommandation_est_relancee_et_signalee(espion):
    espion.reponses_llm = [
        texte("🔴 URGENT :\n- Créer une équipe de secours — fondée sur : l'alerte prioritaire d'accueil."),
        texte("🔴 URGENT :\n- Créer une équipe de secours — fondée sur : l'alerte prioritaire d'accueil."),
    ]
    res = poser("Que me recommandes-tu de faire en priorité ?")
    assert "capacite_non_demontree" in res["avertissements"] and "equipe de secours" in res["reponse"]
    assert "Vérification automatique" in res["reponse"]


def test_le_pied_distingue_suggestion_et_fonctions_reellement_disponibles_selon_le_role(espion):
    ok = "🔴 URGENT :\n- Revoir l'accueil à l'Agence Tunis Lac — fondée sur : l'alerte prioritaire d'accueil (score 0.9)."
    espion.reponses_llm = [texte(ok), texte(ok)]
    cx = poser("Que me recommandes-tu de faire en priorité ?")
    assert "rien n'a été exécuté" in cx["reponse"] and "définissant une action à mener" in cx["reponse"]
    assert "transmettre une suggestion au siège" not in cx["reponse"]
    am = poser("Que me recommandes-tu de faire en priorité ?", role=UserRole.AGENCY_MANAGER, agence_id=T_LAC["id"])
    assert "transmettre une suggestion au siège" in am["reponse"] and "définir une action à mener" not in am["reponse"]
    assert "YAM ne les exécute pas" in am["reponse"]


def test_ce_qui_manque_est_indique_par_le_code_et_transmis_au_modele(espion):
    espion.reponses_llm = [texte("🔴 URGENT :\n- Revoir l'accueil à l'Agence Tunis Lac — fondée sur : l'alerte prioritaire d'accueil.")]
    res = poser("Que me recommandes-tu de faire en priorité ?")
    prompt = espion.llm_calls[0]["user"]
    assert "limites_des_donnees" in prompt and "aucun problème récurrent détecté" in prompt
    assert "tendance globale non établie" in prompt
    assert "Attention : le volume est faible" not in res["reponse"]  # 8 feedbacks : volume suffisant


def test_volume_faible_est_signale_dans_le_pied_et_dans_les_limites(espion, monkeypatch):
    monkeypatch.setattr(qa_service.queries, "get_feedbacks", lambda db, org, agence_id=None, jours=7: [
        {"agence_nom": "Agence Tunis Lac"}] * 3)
    espion.reponses_llm = [texte("🔴 URGENT :\n- Revoir l'accueil à l'Agence Tunis Lac — fondée sur : l'alerte prioritaire d'accueil.")]
    res = poser("Que me recommandes-tu de faire en priorité ?")
    assert "volume faible : 3 feedbacks" in espion.llm_calls[0]["user"]
    assert "Attention : le volume est faible (3)" in res["reponse"]


def test_donnees_insuffisantes_disent_ce_qui_manque_sans_appeler_le_llm(espion, monkeypatch):
    monkeypatch.setattr(qa_service.queries, "query_recommandations", lambda db, org, agence_id=None, jours=7: {"donnees_disponibles": False})
    res = poser("Que me recommandes-tu de faire en priorité ?")
    assert "pas encore assez de données" in res["reponse"] and "Il manque : aucune alerte prioritaire" in res["reponse"]
    assert espion.llm_calls == []


def test_le_prompt_de_recommandation_interdit_les_dispositifs_inventes_et_liste_les_fonctions_reelles(espion):
    espion.reponses_llm = [texte("🔴 URGENT :\n- Revoir l'accueil à l'Agence Tunis Lac — fondée sur : l'alerte prioritaire d'accueil.")]
    poser("Que me recommandes-tu de faire en priorité ?")
    systeme = espion.llm_calls[0]["system"]
    assert "N'invente aucune équipe" in systeme and "Fonctions réellement disponibles dans IKAN AI" in systeme
    assert "limites_des_donnees" in systeme and "SUGGESTION" in systeme
