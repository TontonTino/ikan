"""
Intention « classement_agences » : nomme les agences les plus/moins satisfaisantes
avec leurs vrais chiffres — et reste cloisonnée par organisation / par agence.

Jeu de données (conftest), par organisation :
  Centre : 9 feedbacks, notes 1,2,1,5,3,2,4,5,4  -> 4 satisfaits (>=4) = 44,4 %
  Nord   : 6 feedbacks, notes 1,2,1,5,3,2        -> 1 satisfait       = 16,7 %
  => la PIRE agence est « Nord », la MEILLEURE est « Centre ».
"""
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.agent import queries
from app.agent.intent_classifier import classifier_intention
from app.agent.qa_service import _jours_pour_classement
from app.models.enums import CriticiteType, SentimentType
from app.models.readonly import Agence, AnalyseIA, Feedback, QRCode

from .conftest import token_for

SENS = [("a", "b"), ("b", "a")]

# Formulations naturelles qui doivent toutes déclencher l'intention.
FORMULATIONS = [
    "Quelle agence a la satisfaction la plus faible ce mois-ci ?",
    "Quelle agence a la satisfaction la plus haute ?",
    "Quelle est la meilleure agence ?",
    "Quelle est la pire agence ?",
    "Classement des agences",
    "Donne-moi le classement des agences",
    "L'agence la moins performante ?",
    "Top agences ?",
    "Quelle agence a le pire score ?",
    "Quelle agence a le meilleur score ?",
    "Quelles agences ont la satisfaction la plus basse ?",
    "Quelle agence va le moins bien ?",
    "Quelles sont les agences en difficulté ?",
    "Compare mes agences",
    "Quelle agence est la plus performante ce trimestre ?",
    "Peux-tu classer les agences par satisfaction ?",
    "Top 3 des agences",
    "Quelle agence a la meilleure note ?",
    "Dans quelle agence les clients sont-ils le moins satisfaits ?",
    "Quelle agence est en tête ?",
]

# Questions voisines qui NE doivent PAS être captées par le classement.
AUTRES = {
    "Y a-t-il des alertes critiques ?": "alertes_critiques",
    "Quelle est la répartition par thème ?": "statistiques_theme",
    "Fais-moi un résumé de la période": "resume_periode",
    "Quels sont les problèmes récurrents ?": "problemes_recurrents",
    "Comment évolue la satisfaction dans le temps ?": "evolution_satisfaction",
    "Quelles sont tes recommandations d'actions prioritaires ?": "recommandations",
    "Quelle est la capitale de la France ?": "autre",
}


@pytest.mark.parametrize("question", FORMULATIONS)
def test_formulations_naturelles_declenchent_le_classement(question):
    assert classifier_intention(question, None) == "classement_agences"


@pytest.mark.parametrize("question,attendue", list(AUTRES.items()))
def test_le_classement_ne_capte_pas_les_autres_intentions(question, attendue):
    assert classifier_intention(question, None) == attendue


def test_periode_deduite_de_la_question():
    assert _jours_pour_classement("Quelle agence est la pire ce mois-ci ?", 7) == 30
    assert _jours_pour_classement("Quelle agence est la pire cette semaine ?", 30) == 7
    assert _jours_pour_classement("Quelle agence est la pire ce trimestre ?", 30) == 90
    assert _jours_pour_classement("Quelle agence est la pire cette année ?", 30) == 365
    assert _jours_pour_classement("Quelle est la meilleure agence ?", 7) == 30  # jamais moins de 30 j par défaut
    assert _jours_pour_classement("Quelle est la meilleure agence ?", 90) == 90
    assert _jours_pour_classement("Quelle agence est la plus performante ?", 7) == 30  # « an » dans un mot != « année »


# --------------------------------------------------------------------------- données réelles

@pytest.mark.parametrize("moi,autre", SENS)
def test_la_pire_agence_est_nommee_avec_ses_vrais_chiffres(client, orgs, fake_llm, moi, autre):
    mon = getattr(orgs, moi)
    r = client.post("/agent/ask", json={"question": "Quelle agence a la satisfaction la plus faible ce mois-ci ?"},
                    headers=token_for(mon.cx))
    assert r.status_code == 200, r.text
    corps = r.json()
    assert corps["intention"] == "classement_agences"
    d = corps["donnees"]
    pire = d["plus_faibles"][0]
    assert pire["agence_nom"] == f"Agence {mon.tag.upper()}-Nord"
    assert pire["satisfaction_pct"] == 16.7 and pire["nb_feedbacks"] == 6
    assert pire["rang_du_moins_au_plus_satisfaisant"] == 1
    assert d["meilleures"][0]["agence_nom"] == f"Agence {mon.tag.upper()}-Centre"
    assert d["nb_agences_classees"] == 2 and d["total_feedbacks"] == 15
    assert d["satisfaction_globale_pct"] == 33.3  # 5 satisfaits sur 15
    # Le prompt spécifique (nommer les agences) est bien celui utilisé, et il reçoit les vrais chiffres.
    appel = fake_llm.calls[-1]
    assert "NOMMER" in appel["system"] and "16.7" in appel["user"]
    assert f"{mon.tag.upper()}-Nord" in appel["user"]


@pytest.mark.parametrize("moi,autre", SENS)
def test_la_meilleure_agence_fonctionne_dans_l_autre_sens(client, orgs, fake_llm, moi, autre):
    mon = getattr(orgs, moi)
    r = client.post("/agent/ask", json={"question": "Quelle est la meilleure agence ?"}, headers=token_for(mon.cx))
    assert r.status_code == 200, r.text
    d = r.json()["donnees"]
    assert r.json()["intention"] == "classement_agences"
    assert d["meilleures"][0]["agence_nom"] == f"Agence {mon.tag.upper()}-Centre"
    assert d["meilleures"][0]["satisfaction_pct"] == 44.4 and d["meilleures"][0]["nb_feedbacks"] == 9
    # Les deux extrémités sont toujours transmises : le LLM choisit selon le sens de la question.
    assert d["plus_faibles"][0]["agence_nom"].endswith("Nord")
    assert "meilleure" in fake_llm.calls[-1]["user"].lower()


@pytest.mark.parametrize("moi,autre", SENS)
def test_le_classement_compte_aussi_les_alertes_par_agence(client, orgs, fake_llm, moi, autre):
    mon = getattr(orgs, moi)
    d = client.post("/agent/ask", json={"question": "Classement des agences"}, headers=token_for(mon.cx)).json()["donnees"]
    par_nom = {a["agence_nom"]: a for a in d["classement_complet"]}
    # Centre : 4 alertes (2 critiques + 2 élevées) ; Nord : 4 alertes sur ses 6 premiers feedbacks
    assert par_nom[f"Agence {mon.tag.upper()}-Centre"]["nb_alertes_elevees_ou_critiques"] == 4
    assert par_nom[f"Agence {mon.tag.upper()}-Nord"]["nb_alertes_elevees_ou_critiques"] == 4


def test_volume_faible_et_agence_sans_feedback(db, orgs):
    """Une agence à 1 seul avis n'est pas présentée comme fiable ; une agence sans avis est listée à part."""
    org = orgs.a.org
    maintenant = datetime.now(timezone.utc)
    mini = Agence(id=uuid.uuid4(), organisation_id=org.id, nom="Agence ALPHA-Mini", active=True, seuil_alerte=2.5)
    vide = Agence(id=uuid.uuid4(), organisation_id=org.id, nom="Agence ALPHA-Vide", active=True, seuil_alerte=2.5)
    db.add_all([mini, vide])
    db.flush()
    qr = QRCode(id=uuid.uuid4(), agence_id=mini.id, code="QR-MINI-1", url="https://x.test", actif=True)
    db.add(qr)
    db.flush()
    fb = Feedback(id=uuid.uuid4(), qr_code_id=qr.id, note=5, commentaire="ALPHA-SECRET mini",
                  date_soumission=maintenant - timedelta(days=1))
    db.add(fb)
    db.flush()
    db.add(AnalyseIA(id=uuid.uuid4(), feedback_id=fb.id, sentiment=SentimentType.POSITIF,
                     criticite=CriticiteType.FAIBLE, theme_principal="accueil", discordance_detectee=False,
                     score_sentiment=0.9))
    db.commit()

    d = queries.query_classement_agences(db, org.id, jours=30)
    par_nom = {a["agence_nom"]: a for a in d["classement_complet"]}
    assert par_nom["Agence ALPHA-Mini"]["satisfaction_pct"] == 100.0
    assert par_nom["Agence ALPHA-Mini"]["volume_faible"] is True
    assert par_nom["Agence ALPHA-Centre"]["volume_faible"] is False
    assert d["agences_actives_sans_feedback"] == ["Agence ALPHA-Vide"]
    assert d["meilleures"][0]["agence_nom"] == "Agence ALPHA-Mini"  # 100 % mais volume_faible -> le LLM doit nuancer
    # l'autre organisation ne voit ni Mini ni Vide
    d_b = queries.query_classement_agences(db, orgs.b.org.id, jours=30)
    assert all("ALPHA" not in a["agence_nom"] for a in d_b["classement_complet"])
    assert d_b["agences_actives_sans_feedback"] == []


def test_periode_respectee_par_la_requete(db, orgs):
    """Sur 5 jours, seuls les feedbacks récents comptent (les anciens de 9 à 11 jours sont exclus)."""
    court = queries.query_classement_agences(db, orgs.a.org.id, jours=5)
    tout = queries.query_classement_agences(db, orgs.a.org.id, jours=30)
    assert tout["total_feedbacks"] == 15
    assert court["total_feedbacks"] == 12  # 15 moins les 3 feedbacks de 9, 10 et 11 jours (agence Centre)


# --------------------------------------------------------------------------- isolation

@pytest.mark.parametrize("moi,autre", SENS)
def test_classement_ne_contient_que_les_agences_de_mon_organisation(client, orgs, fake_llm, moi, autre):
    mon, etranger = getattr(orgs, moi), getattr(orgs, autre)
    for q in ("Quelle agence a la satisfaction la plus faible ce mois-ci ?", "Quelle est la meilleure agence ?",
              "Classement des agences", "Quelle agence a le plus d'alertes critiques ?"):
        r = client.post("/agent/ask", json={"question": q}, headers=token_for(mon.cx))
        assert r.status_code == 200 and r.json()["intention"] == "classement_agences"
        assert etranger.tag.lower() not in (r.text + fake_llm.everything_sent()).lower()
        noms = {a["agence_nom"] for a in r.json()["donnees"]["classement_complet"]}
        assert noms == {f"Agence {mon.tag.upper()}-Centre", f"Agence {mon.tag.upper()}-Nord"}


@pytest.mark.parametrize("moi,autre", SENS)
def test_classement_refuse_une_agence_etrangere(client, orgs, fake_llm, moi, autre):
    mon, etranger = getattr(orgs, moi), getattr(orgs, autre)
    r = client.post("/agent/ask", json={"question": "Classement des agences", "agence_id": str(etranger.agences[0].id)},
                    headers=token_for(mon.cx))
    assert r.status_code == 404
    assert fake_llm.calls == []


@pytest.mark.parametrize("moi,autre", SENS)
def test_agency_manager_ne_classe_que_sa_propre_agence(client, orgs, fake_llm, moi, autre):
    mon = getattr(orgs, moi)
    r = client.post("/agent/ask", json={"question": "Quelle agence a la satisfaction la plus faible ce mois-ci ?"},
                    headers=token_for(mon.am))
    assert r.status_code == 200, r.text
    d = r.json()["donnees"]
    assert d["perimetre_restreint_a_une_agence"] is True and d["nb_agences_classees"] == 1
    assert [a["agence_nom"] for a in d["classement_complet"]] == [f"Agence {mon.tag.upper()}-Centre"]
    assert d["agences_actives_sans_feedback"] == []
    tout = r.text + fake_llm.everything_sent()
    assert "-Nord" not in tout and getattr(orgs, autre).tag not in tout.lower()
    # Il ne peut pas non plus cibler l'autre agence de son organisation
    r2 = client.post("/agent/ask", json={"question": "Classement des agences", "agence_id": str(mon.agences[1].id)},
                     headers=token_for(mon.am))
    assert r2.status_code == 404


def test_requete_du_classement_exige_organisation_id(db):
    import inspect

    param = inspect.signature(queries.query_classement_agences).parameters.get("organisation_id")
    assert param is not None and param.default is inspect.Parameter.empty
    with pytest.raises(ValueError):
        queries.query_classement_agences(db, None)


def test_relance_sur_le_classement_recalcule_les_donnees(client, orgs, fake_llm):
    """« Et la meilleure ? » après « la pire » : les données sont rechargées (le sens de la question change)."""
    h = token_for(orgs.a.cx)
    r1 = client.post("/agent/ask", json={"question": "Quelle est la pire agence ?"}, headers=h).json()
    n_appels = len(fake_llm.calls)
    r2 = client.post("/agent/ask", json={"question": "Et la meilleure ?", "conversation_id": r1["conversation_id"]},
                     headers=h)
    assert r2.status_code == 200
    assert r2.json()["intention"] == "classement_agences"
    assert r2.json()["donnees"]["meilleures"][0]["agence_nom"].endswith("Centre")
    assert len(fake_llm.calls) == n_appels + 1
