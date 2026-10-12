"""
Non-régression de la fiabilité des réponses de YAM — tests UNITAIRES sans base ni fournisseur IA.

Le LLM et les requêtes sont remplacés par des doublures déterministes : on teste ici le comportement du code
(budget de sortie, vide/tronqué, nombres inventés, périmètre d'agence, contexte sectoriel, calculs), pas la
qualité rédactionnelle du modèle (celle-ci ne se vérifie que par appels réels, hors de cette suite).

  python -m pytest tests_unit
"""
import os
import uuid

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@127.0.0.1:1/ikanai_test_unit")  # jamais connectée
os.environ.setdefault("SECRET_KEY", "test-secret-key-fiabilite-0123456789abcdef")
os.environ.setdefault("WEBHOOK_SECRET", "test-webhook-secret-fiabilite")

from app.agent import calculs, perimetre, qa_service, verification  # noqa: E402
from app.agent.intent_classifier import categoriser_question_sans_intention, classifier_intention  # noqa: E402
from app.models.enums import UserRole  # noqa: E402
from app.providers import llm_provider  # noqa: E402
from app.providers.llm_provider import LLMEmptyResponseError, TexteGenere  # noqa: E402

ORG = uuid.uuid4()
AG_TUNIS = {"id": uuid.uuid4(), "nom": "Agence Tunis Bourguiba", "ville": "Tunis"}
AG_SFAX = {"id": uuid.uuid4(), "nom": "Agence Sfax Ville", "ville": "Sfax"}
AG_SOUSSE = {"id": uuid.uuid4(), "nom": "Agence Sousse Les Oliviers", "ville": "Sousse"}
AGENCES = [AG_TUNIS, AG_SFAX, AG_SOUSSE]


def texte(contenu: str, finish: str = "stop") -> TexteGenere:
    t = TexteGenere(contenu)
    t.finish_reason = finish
    t.tronquee = finish == "length"
    return t


# ─────────────────────────── provider : budget, vide, tronqué ───────────────────────────

class _Reponse:
    status_code = 200
    headers: dict = {}

    def __init__(self, contenu, finish):
        self._data = {"choices": [{"message": {"content": contenu}, "finish_reason": finish}]}

    def raise_for_status(self):
        pass

    def json(self):
        return self._data


@pytest.fixture()
def groq(monkeypatch):
    appels = []
    suite = []

    def faux_post(url, headers=None, json=None, timeout=None):
        appels.append(json)
        return _Reponse(*suite.pop(0))

    monkeypatch.setattr(llm_provider.requests, "post", faux_post)
    monkeypatch.setattr(llm_provider.settings, "GROQ_API_KEY", "cle-de-test")
    monkeypatch.setattr(llm_provider.settings, "GROQ_MODEL", "openai/gpt-oss-20b")
    return appels, suite


def test_le_provider_demande_un_raisonnement_court_pour_gpt_oss(groq):
    appels, suite = groq
    suite.append(("Bonjour", "stop"))
    llm_provider.generate_text("s", "u", max_tokens=300)
    assert appels[0]["reasoning_effort"] == "low"


def test_pas_de_parametre_de_raisonnement_pour_un_autre_modele(groq, monkeypatch):
    appels, suite = groq
    monkeypatch.setattr(llm_provider.settings, "GROQ_MODEL", "llama-3.3-70b-versatile")
    suite.append(("Bonjour", "stop"))
    llm_provider.generate_text("s", "u")
    assert "reasoning_effort" not in appels[0]


def test_sortie_vide_relancee_une_fois_avec_budget_double(groq):
    appels, suite = groq
    suite += [("", "length"), ("Voici la réponse.", "stop")]
    resultat = llm_provider.generate_text("s", "u", max_tokens=600)
    assert str(resultat) == "Voici la réponse." and not resultat.tronquee
    assert [a["max_tokens"] for a in appels] == [600, 1200]


def test_sortie_tronquee_gardee_et_marquee_apres_le_nouvel_essai(groq):
    appels, suite = groq
    suite += [("Début de réponse", "length"), ("Début de réponse plus long mais coupé", "length")]
    resultat = llm_provider.generate_text("s", "u", max_tokens=600)
    assert resultat.tronquee and resultat.finish_reason == "length"
    assert str(resultat).startswith("Début de réponse")  # jamais supprimée en silence
    assert len(appels) == 2


def test_le_budget_de_relance_est_plafonne(groq, monkeypatch):
    appels, suite = groq
    monkeypatch.setattr(llm_provider.settings, "LLM_MAX_TOKENS_PLAFOND", 1000)
    suite += [("", "length"), ("ok", "stop")]
    llm_provider.generate_text("s", "u", max_tokens=900)
    assert appels[1]["max_tokens"] == 1000


def test_contenu_absent_ou_null_est_une_sortie_vide_pas_une_erreur_de_format(groq):
    appels, suite = groq
    suite += [(None, "stop"), (None, "stop")]
    resultat = llm_provider.generate_text("s", "u")
    assert resultat.vide


# ─────────────────────────── calculs et vérification des nombres ───────────────────────────

def test_pourcentages_calcules_par_le_code():
    assert calculs.pourcentage(9, 18) == 50.0
    assert calculs.pourcentage(1, 3) == 33.3
    assert calculs.pourcentage(5, 0) is None  # jamais de division par zéro
    rep = calculs.repartition_themes({"accueil": 18})
    assert rep["total_feedbacks"] == 18 and rep["themes"][0]["pourcentage"] == 100.0


def test_tendance_calculee_par_le_code():
    hausse = calculs.evolution([
        {"periode": "p1", "nombre_feedbacks": 3, "sentiment_moyen": 0.40},
        {"periode": "p2", "nombre_feedbacks": 0, "sentiment_moyen": None},
        {"periode": "p3", "nombre_feedbacks": 6, "sentiment_moyen": 0.55},
    ])
    assert hausse["sens"] == "hausse" and hausse["variation_sentiment_moyen"] == 0.15
    assert hausse["periodes_sans_donnees"] == ["p2"]
    assert calculs.evolution([{"periode": "p1", "nombre_feedbacks": 3, "sentiment_moyen": 0.4}])["sens"] == "indeterminee"
    assert calculs.evolution([
        {"periode": "a", "nombre_feedbacks": 4, "sentiment_moyen": 0.50},
        {"periode": "b", "nombre_feedbacks": 4, "sentiment_moyen": 0.51},
    ])["sens"] == "stable"


def test_un_nombre_absent_des_donnees_est_detecte():
    autorises = verification.nombres_autorises({"alertes": [{"score": 0.98}, {"score": 0.95}], "total": 18})
    assert verification.nombres_non_justifies("Il y a 18 feedbacks et 2 alertes.", autorises) == []
    assert verification.nombres_non_justifies("Affecter 2 agents pendant 24 h.", autorises) == ["2", "24"] or \
        "24" in verification.nombres_non_justifies("Affecter 2 agents pendant 24 h.", autorises)


def test_numeros_de_liste_dates_et_pourcentage_equivalent_ne_sont_pas_des_faux_positifs():
    autorises = verification.nombres_autorises({"sentiment": 0.55, "date": "2026-10-03"})
    reponse = "1. Premier point\n2. Second point\nSentiment de 55 % relevé le 2026-10-03."
    assert verification.nombres_non_justifies(reponse, autorises) == []


# ─────────────────────────── périmètre : agence nommée ───────────────────────────

def test_detection_par_nom_ville_et_sans_accent():
    assert perimetre.detecter_agences_mentionnees("avis de l'agence Sfax Ville ?", AGENCES) == [AG_SFAX]
    assert perimetre.detecter_agences_mentionnees("et à tunis ?", AGENCES) == [AG_TUNIS]
    assert perimetre.detecter_agences_mentionnees("comment va Sousse les oliviers", AGENCES) == [AG_SOUSSE]
    assert perimetre.detecter_agences_mentionnees("Compare Sfax et Tunis", AGENCES) == [AG_TUNIS, AG_SFAX]
    assert perimetre.detecter_agences_mentionnees("Où en est mon réseau ?", AGENCES) == []


# ─────────────────────────── classifieur ───────────────────────────

def test_question_de_situation_n_est_plus_hors_perimetre():
    assert classifier_intention("Où en est la situation de mon réseau en ce moment ?") == "resume_periode"
    assert classifier_intention("Fais-moi un état des lieux") == "resume_periode"


def test_hors_sujet_question_metier_et_donnee_indisponible_sont_distingues():
    assert classifier_intention("Quelle est la capitale de la France ?") == "autre"
    assert categoriser_question_sans_intention("Quelle est la capitale de la France ?") == "hors_sujet"
    q = "Quel est le taux de résolution des problèmes sur les deux dernières années ?"
    assert classifier_intention(q) == "autre"
    assert categoriser_question_sans_intention(q) == "donnee_indisponible"
    assert categoriser_question_sans_intention("Mes clients sont gentils ?") == "metier_non_compris"


# ─────────────────────────── qa_service : flux complets avec doublures ───────────────────────────

class Espion:
    """Enregistre les appels aux requêtes et au LLM, et sert des réponses scriptées."""

    def __init__(self):
        self.llm_calls = []
        self.reponses_llm = []
        self.requetes = []

    def llm(self, system_prompt, user_prompt, *, messages_history=None, max_tokens=400):
        self.llm_calls.append({"system": system_prompt, "user": user_prompt, "messages": messages_history, "max_tokens": max_tokens})
        return self.reponses_llm.pop(0)


@pytest.fixture()
def espion(monkeypatch):
    e = Espion()
    monkeypatch.setattr(qa_service.llm_provider, "generate_text", e.llm)
    monkeypatch.setattr(qa_service.queries, "lister_agences_organisation", lambda db, org: AGENCES)
    monkeypatch.setattr(qa_service.queries, "get_secteur_organisation", lambda db, org: None)
    monkeypatch.setattr(qa_service.queries, "verifier_agence_dans_organisation", lambda db, org, ag: None)

    def get_feedbacks(db, org, agence_id=None, jours=7):
        e.requetes.append(("get_feedbacks", agence_id))
        return [{"agence_nom": "Agence Tunis Bourguiba", "criticite": "critique", "theme_principal": "accueil",
                 "sentiment_score": 0.2, "date_soumission": "2026-10-09T10:00:00+00:00", "commentaire": "Attente"}] * 4

    def alertes(db, org, agence_id=None, jours=7):
        e.requetes.append(("alertes", agence_id))
        return [{"agence_nom": "Agence Tunis Bourguiba", "criticite": "critique", "theme_principal": "accueil",
                 "score_priorite": 0.9, "commentaire": "Attente"}] * 4

    def reco(db, org, agence_id=None, jours=7):
        e.requetes.append(("recommandations", agence_id))
        return {"alertes_prioritaires": [{"agence_nom": "Agence Tunis Bourguiba", "theme": "accueil",
                                          "criticite": "critique", "score_priorite": 0.9,
                                          "commentaire_exemple": "Attente"}],
                "problemes_systemiques": [], "risques_detectes": [], "tendance_globale": "stable",
                "periode_analysee": "7 jours", "donnees_disponibles": True}

    monkeypatch.setattr(qa_service.queries, "get_feedbacks", get_feedbacks)
    monkeypatch.setattr(qa_service.queries, "query_alertes_critiques", alertes)
    monkeypatch.setattr(qa_service.queries, "query_recommandations", reco)
    return e


def poser(question, *, role=UserRole.CX_MANAGER, agence_id=None):
    return qa_service.repondre_question(None, ORG, question, agence_id=agence_id, jours=7, role=role)


def test_question_simple_sans_structure_imposee_ni_secteur_fige(espion):
    espion.reponses_llm = [texte("Il y a 4 alertes critiques, toutes sur l'accueil à l'Agence Tunis Bourguiba.")]
    res = poser("Y a-t-il des alertes critiques ?")
    systeme = espion.llm_calls[0]["system"]
    assert "télécom" not in systeme.lower() and "telecom" not in systeme.lower()
    assert "Secteur de l'organisation" not in systeme  # secteur inconnu : rien d'inventé
    assert "Question simple ou factuelle : réponds directement" in systeme
    assert "Structure chaque réponse ainsi" not in systeme and "CAUSE PROBABLE : si les données" not in systeme
    assert res["reponse"].startswith("Il y a 4 alertes") and res["tronquee"] is False and res["avertissements"] == []
    # les répartitions sont calculées par le code et transmises au modèle
    assert '"calculs_verifies"' in espion.llm_calls[0]["user"] and '"nombre_alertes": 4' in espion.llm_calls[0]["user"]


def test_le_secteur_connu_est_transmis_et_jamais_suppose(espion, monkeypatch):
    monkeypatch.setattr(qa_service.queries, "get_secteur_organisation", lambda db, org: "restauration")
    espion.reponses_llm = [texte("Quatre alertes sur l'accueil.")]
    poser("Y a-t-il des alertes critiques ?")
    assert "Secteur de l'organisation : Restauration" in espion.llm_calls[0]["system"]
    # « autre » ou code inconnu : aucune consigne
    monkeypatch.setattr(qa_service.queries, "get_secteur_organisation", lambda db, org: "autre")
    espion.reponses_llm = [texte("Quatre alertes sur l'accueil.")]
    poser("Y a-t-il des alertes critiques ?")
    assert "Secteur de l'organisation" not in espion.llm_calls[1]["system"]


def test_recommandation_sans_chiffre_invente_et_pied_calcule_par_le_code(espion):
    espion.reponses_llm = [texte("🔴 URGENT :\n- Reprendre l'accueil à l'Agence Tunis Bourguiba — fondée sur : 1 alerte critique.")]
    res = poser("Que me recommandes-tu de faire en priorité ?")
    assert "fondées sur 4 feedbacks analysés sur les 7 derniers jours" in res["reponse"]
    assert "rien n'a été exécuté" in res["reponse"]
    assert "Maximum 2 actions" in espion.llm_calls[0]["system"] and "quantité" in espion.llm_calls[0]["system"]
    assert len(espion.llm_calls) == 1


def test_chiffre_invente_relance_une_fois_puis_texte_corrige(espion):
    espion.reponses_llm = [
        texte("Affecter 2 agents supplémentaires pendant 24 h à l'Agence Tunis Bourguiba."),
        texte("Renforcer l'accueil à l'Agence Tunis Bourguiba, où se concentrent les alertes."),
    ]
    res = poser("Y a-t-il des alertes critiques ?")
    assert len(espion.llm_calls) == 2
    assert "2 agents" not in res["reponse"] and res["avertissements"] == []
    assert "ne figurent pas dans les données" in espion.llm_calls[1]["user"]


def test_chiffre_invente_persistant_est_signale_pas_cache(espion):
    espion.reponses_llm = [texte("Affecter 9 agents."), texte("Affecter 9 agents quand même.")]
    res = poser("Y a-t-il des alertes critiques ?")
    assert "Affecter 9 agents quand même." in res["reponse"]
    assert "Vérification automatique" in res["reponse"] and "taires" not in res["reponse"]
    assert "9" in res["avertissements"][0]
    assert res["avertissements"] and res["avertissements"][0].startswith("valeurs_non_verifiees")


def test_reponse_vide_leve_une_erreur_recuperable(espion):
    espion.reponses_llm = [texte("")]
    with pytest.raises(LLMEmptyResponseError):
        poser("Y a-t-il des alertes critiques ?")


def test_reponse_tronquee_est_marquee_et_signalee(espion):
    espion.reponses_llm = [texte("Les alertes se concentrent sur l'accueil et la", finish="length")]
    res = poser("Y a-t-il des alertes critiques ?")
    assert res["tronquee"] is True and "Réponse interrompue" in res["reponse"]
    assert "reponse_tronquee" in res["avertissements"]


def test_le_budget_de_sortie_n_est_plus_600(espion):
    espion.reponses_llm = [texte("Quatre alertes.")]
    poser("Y a-t-il des alertes critiques ?")
    assert espion.llm_calls[0]["max_tokens"] >= 1500


def test_donnees_insuffisantes_pour_recommander_sans_appel_llm(espion, monkeypatch):
    monkeypatch.setattr(qa_service.queries, "query_recommandations", lambda db, org, agence_id=None, jours=7: {"donnees_disponibles": False})
    res = poser("Que me recommandes-tu de faire en priorité ?")
    assert "pas encore assez de données" in res["reponse"] and espion.llm_calls == []


def test_question_de_situation_est_traitee_pas_refusee(espion):
    espion.reponses_llm = [texte("Sur la période, 4 feedbacks, tous critiques.")]
    res = poser("Où en est la situation de mon réseau en ce moment ?")
    assert res["intention"] == "resume_periode" and len(espion.llm_calls) == 1


def test_messages_distincts_selon_la_nature_de_la_question(espion):
    assert "ne sais pas répondre" in poser("Quelle est la capitale de la France ?")["reponse"]
    assert "pas bien compris" in poser("Mes clients sont gentils ?")["reponse"]
    assert "n'ai pas accès à cette information" in poser("Quel est le taux de résolution des problèmes ?")["reponse"]
    assert espion.llm_calls == []


def test_responsable_qui_demande_une_autre_agence_est_refuse_clairement(espion):
    res = poser("Donne-moi les avis de l'agence Sfax Ville", role=UserRole.AGENCY_MANAGER, agence_id=AG_TUNIS["id"])
    assert res["intention"] == "agence_hors_perimetre"
    assert "Je ne peux répondre que pour votre agence (Agence Tunis Bourguiba)" in res["reponse"]
    assert "Sfax" not in res["reponse"]  # le message ne confirme ni ne décrit l'autre agence
    assert espion.llm_calls == [] and espion.requetes == []  # aucune donnée consultée


def test_responsable_reste_limite_a_son_agence_meme_sans_nom_dans_la_question(espion):
    espion.reponses_llm = [texte("Quatre alertes sur l'accueil.")]
    poser("Y a-t-il des alertes critiques ?", role=UserRole.AGENCY_MANAGER, agence_id=AG_TUNIS["id"])
    assert espion.requetes == [("alertes", AG_TUNIS["id"])]
    assert "uniquement l'agence « Agence Tunis Bourguiba »" in espion.llm_calls[0]["system"]
    assert "n'a pas accès aux autres agences" in espion.llm_calls[0]["system"]


def test_responsable_peut_nommer_sa_propre_agence(espion):
    espion.reponses_llm = [texte("Quatre alertes sur l'accueil.")]
    res = poser("Les alertes de l'agence Tunis Bourguiba ?", role=UserRole.AGENCY_MANAGER, agence_id=AG_TUNIS["id"])
    assert res["intention"] != "agence_hors_perimetre" and espion.requetes == [("alertes", AG_TUNIS["id"])]


def test_cx_manager_qui_nomme_une_agence_est_restreint_a_cette_agence(espion):
    espion.reponses_llm = [texte("Quatre alertes sur l'accueil à Sfax.")]
    res = poser("Les alertes critiques de l'agence Sfax Ville ?")
    assert espion.requetes == [("alertes", AG_SFAX["id"])]
    assert "uniquement l'agence « Agence Sfax Ville », car la question la nomme" in espion.llm_calls[0]["system"]
    assert "Agence Sfax Ville" in res["perimetre"]


def test_cx_manager_avec_deux_agences_nommees_doit_preciser_au_lieu_d_elargir(espion):
    res = poser("Les alertes critiques de Sfax et de Tunis ?")
    assert res["intention"] == "agence_a_preciser" and "une agence à la fois" in res["reponse"]
    assert espion.requetes == [] and espion.llm_calls == []  # aucune donnée lue, périmètre jamais élargi


def test_agence_choisie_par_le_cx_manager_est_conservee(espion):
    espion.reponses_llm = [texte("Quatre alertes.")]
    res = poser("Y a-t-il des alertes critiques ?", agence_id=AG_SOUSSE["id"])
    assert espion.requetes == [("alertes", AG_SOUSSE["id"])]
    assert "sélectionnée par le manager" in espion.llm_calls[0]["system"] and "Sousse" in res["perimetre"]


def test_une_panne_de_lecture_des_agences_ne_donne_aucun_droit_supplementaire(espion, monkeypatch):
    def boom(db, org):
        raise RuntimeError("base indisponible")

    monkeypatch.setattr(qa_service.queries, "lister_agences_organisation", boom)
    espion.reponses_llm = [texte("Quatre alertes.")]
    poser("Y a-t-il des alertes critiques ?", role=UserRole.AGENCY_MANAGER, agence_id=AG_TUNIS["id"])
    assert espion.requetes == [("alertes", AG_TUNIS["id"])]  # la restriction vient de agence_id (JWT), pas du nom


def test_limite_de_debit_429_est_retentee_une_fois_apres_le_delai_indique(monkeypatch):
    class R429:
        status_code = 429
        headers = {"retry-after": "3"}

        def raise_for_status(self):
            raise llm_provider.requests.HTTPError("429")

    reponses = [R429(), _Reponse("Réponse après attente.", "stop")]
    attentes = []
    monkeypatch.setattr(llm_provider.requests, "post", lambda *a, **k: reponses.pop(0))
    monkeypatch.setattr(llm_provider.time, "sleep", attentes.append)
    monkeypatch.setattr(llm_provider.settings, "GROQ_API_KEY", "cle-de-test")
    assert str(llm_provider.generate_text("s", "u")) == "Réponse après attente."
    assert attentes == [3.0]


def test_429_persistant_reste_une_erreur_du_fournisseur(monkeypatch):
    class R429:
        status_code = 429
        headers = {}

        def raise_for_status(self):
            raise llm_provider.requests.HTTPError("429")

    monkeypatch.setattr(llm_provider.requests, "post", lambda *a, **k: R429())
    monkeypatch.setattr(llm_provider.time, "sleep", lambda s: None)
    monkeypatch.setattr(llm_provider.settings, "GROQ_API_KEY", "cle-de-test")
    with pytest.raises(llm_provider.requests.HTTPError):
        llm_provider.generate_text("s", "u")


def test_le_perimetre_d_agence_est_rappele_en_tete_pour_un_cx_manager_seulement(espion):
    espion.reponses_llm = [texte("Quatre alertes."), texte("Quatre alertes.")]
    cx = poser("Les alertes critiques de l'agence Sfax Ville ?")
    assert cx["reponse"].startswith("Périmètre : agence « Agence Sfax Ville ».")
    am = poser("Y a-t-il des alertes critiques ?", role=UserRole.AGENCY_MANAGER, agence_id=AG_TUNIS["id"])
    assert not am["reponse"].startswith("Périmètre")
