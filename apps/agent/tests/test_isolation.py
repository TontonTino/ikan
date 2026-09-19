"""
TESTS D'ISOLATION CROSS-ORGANISATION — les plus importants du service.

Deux organisations (Alpha, Bravo) aux données distinctes (chaque donnée porte
le tag de son organisation : « ALPHA-SECRET-…», agence « ALPHA-Centre »…).
Pour chaque endpoint, on prouve qu'un utilisateur d'Alpha ne peut JAMAIS
voir / modifier / lister / déclencher quoi que ce soit d'Bravo, et
réciproquement. Détecteur de fuite : le tag de l'AUTRE organisation ne doit
apparaître ni dans la réponse HTTP, ni dans ce qui est envoyé au LLM, ni en
base après coup.
"""
import uuid

import pytest
from sqlalchemy import func

from app.agent import action_service, conversation_manager, queries
from app.models.action_agent import ActionAgent
from app.models.conversation import Conversation, ConversationTurn
from app.models.enums import StatutActionAgent

from .conftest import token_for

# Une question par intention, toutes vérifiées comme classées vers l'intention visée.
QUESTIONS = {
    "alertes_critiques": "Y a-t-il des alertes critiques ?",
    "statistiques_theme": "Quelle est la répartition par thème ?",
    "a_verifier": "Quels feedbacks faut-il vérifier ?",
    "resume_periode": "Fais-moi un résumé de la période",
    "problemes_recurrents": "Quels sont les problèmes récurrents ?",
    "tendances_anomalies": "Y a-t-il des anomalies ou des tendances inhabituelles ?",
    "evolution_satisfaction": "Comment évolue la satisfaction dans le temps ?",
    "predictions_risques": "Quels risques prévois-tu pour la semaine prochaine ?",
    "recommandations": "Quelles sont tes recommandations d'actions prioritaires ?",
}

# (organisation appelante, organisation étrangère) — chaque test tourne dans les DEUX sens.
SENS = [("a", "b"), ("b", "a")]


def _autre_tag(orgs, autre):
    return getattr(orgs, autre).tag


def assert_pas_de_fuite(texte: str, tag_interdit: str):
    assert tag_interdit.lower() not in texte.lower(), (
        f"FUITE : le tag '{tag_interdit}' d'une autre organisation apparaît dans :\n{texte[:600]}"
    )


# =============================================================================
# /agent/ask — données
# =============================================================================

@pytest.mark.parametrize("moi,autre", SENS)
@pytest.mark.parametrize("intention", list(QUESTIONS))
def test_ask_ne_retourne_que_les_donnees_de_mon_organisation(
    client, orgs, fake_llm, moi, autre, intention
):
    mon = getattr(orgs, moi)
    r = client.post("/agent/ask", json={"question": QUESTIONS[intention]}, headers=token_for(mon.cx))
    assert r.status_code == 200, r.text
    assert r.json()["intention"] == intention
    assert_pas_de_fuite(r.text, _autre_tag(orgs, autre))
    assert_pas_de_fuite(fake_llm.everything_sent(), _autre_tag(orgs, autre))


@pytest.mark.parametrize("moi,autre", SENS)
def test_ask_retourne_bien_mes_vraies_donnees(client, orgs, fake_llm, moi, autre):
    """Contre-test : l'isolation ne doit pas vider mes propres résultats."""
    mon = getattr(orgs, moi)
    r = client.post("/agent/ask", json={"question": QUESTIONS["alertes_critiques"]}, headers=token_for(mon.cx))
    assert r.status_code == 200
    donnees = r.json()["donnees"]
    assert len(donnees) > 0
    assert all(d["agence_nom"].startswith(f"Agence {mon.tag.upper()}") for d in donnees)
    ids_a_moi = {str(f.id) for f in mon.feedbacks}
    assert {d["id"] for d in donnees} <= ids_a_moi


@pytest.mark.parametrize("moi,autre", SENS)
def test_ask_agence_id_d_une_autre_organisation_est_refuse(client, orgs, fake_llm, moi, autre):
    mon, etranger = getattr(orgs, moi), getattr(orgs, autre)
    for agence in etranger.agences:
        r = client.post(
            "/agent/ask",
            json={"question": QUESTIONS["alertes_critiques"], "agence_id": str(agence.id)},
            headers=token_for(mon.cx),
        )
        assert r.status_code == 404, r.text
        assert_pas_de_fuite(r.text, etranger.tag)
    assert fake_llm.calls == [], "le LLM ne doit même pas être appelé pour une agence hors périmètre"


@pytest.mark.parametrize("moi,autre", SENS)
def test_ask_agence_id_inexistante_est_indistinguable_d_une_agence_etrangere(client, orgs, fake_llm, moi, autre):
    mon, etranger = getattr(orgs, moi), getattr(orgs, autre)
    r_inconnue = client.post(
        "/agent/ask", json={"question": "alertes critiques", "agence_id": str(uuid.uuid4())},
        headers=token_for(mon.cx),
    )
    r_etrangere = client.post(
        "/agent/ask", json={"question": "alertes critiques", "agence_id": str(etranger.agences[0].id)},
        headers=token_for(mon.cx),
    )
    assert r_inconnue.status_code == r_etrangere.status_code == 404
    assert r_inconnue.json()["detail"] == r_etrangere.json()["detail"]


@pytest.mark.parametrize("moi,autre", SENS)
def test_ask_agence_id_de_mon_organisation_reste_autorise_et_filtre(client, orgs, fake_llm, moi, autre):
    mon = getattr(orgs, moi)
    ag = mon.agences[0]
    r = client.post(
        "/agent/ask", json={"question": QUESTIONS["alertes_critiques"], "agence_id": str(ag.id)},
        headers=token_for(mon.cx),
    )
    assert r.status_code == 200
    assert {d["agence_id"] for d in r.json()["donnees"]} == {str(ag.id)}


@pytest.mark.parametrize("moi,autre", SENS)
def test_ask_organisation_id_dans_le_corps_est_ignore(client, orgs, fake_llm, moi, autre):
    """L'organisation vient du JWT, jamais du payload : un champ organisation_id forgé ne change rien."""
    mon, etranger = getattr(orgs, moi), getattr(orgs, autre)
    r = client.post(
        "/agent/ask",
        json={"question": QUESTIONS["alertes_critiques"],
              "organisation_id": str(etranger.org.id), "organisation": str(etranger.org.id)},
        headers=token_for(mon.cx),
    )
    assert r.status_code == 200
    assert_pas_de_fuite(r.text, etranger.tag)
    assert_pas_de_fuite(fake_llm.everything_sent(), etranger.tag)


@pytest.mark.parametrize("moi,autre", SENS)
def test_admin_d_une_organisation_reste_cantonne_a_son_organisation(client, orgs, fake_llm, moi, autre):
    mon = getattr(orgs, moi)
    r = client.post("/agent/ask", json={"question": QUESTIONS["alertes_critiques"]}, headers=token_for(mon.admin))
    assert r.status_code == 200
    assert_pas_de_fuite(r.text, _autre_tag(orgs, autre))


def test_ask_sans_token_ou_token_invalide_est_refuse(client, orgs, fake_llm):
    assert client.post("/agent/ask", json={"question": "alertes"}).status_code == 401
    assert client.post(
        "/agent/ask", json={"question": "alertes"}, headers={"Authorization": "Bearer nimportequoi"}
    ).status_code == 401
    assert fake_llm.calls == []


def test_resume_proactif_refuse_une_agence_etrangere_sans_l_avaler(db, orgs, fake_llm):
    """generer_resume_proactif avale les erreurs (mode dégradé) : le contrôle de périmètre doit précéder."""
    from app.agent import qa_service

    with pytest.raises(queries.PerimetreOrganisationError):
        qa_service.generer_resume_proactif(db, orgs.a.org.id, orgs.b.agences[0].id)
    res = qa_service.generer_resume_proactif(db, orgs.a.org.id, None)
    assert_pas_de_fuite(str(res) + fake_llm.everything_sent(), "bravo")


# =============================================================================
# Couche requêtes — pas de requête sans organisation
# =============================================================================

def test_toutes_les_fonctions_de_requete_exigent_organisation_id():
    import inspect

    publiques = [
        "get_feedbacks", "get_feedback_with_analyse", "query_alertes_critiques",
        "query_statistiques_theme", "query_a_verifier", "query_problemes_recurrents",
        "comparer_periodes", "query_evolution_satisfaction", "query_predictions",
        "query_recommandations", "_requete_feedbacks",
    ]
    for nom in publiques:
        param = inspect.signature(getattr(queries, nom)).parameters.get("organisation_id")
        assert param is not None, f"{nom} n'a pas de paramètre organisation_id"
        assert param.default is inspect.Parameter.empty, f"{nom}: organisation_id ne doit pas être optionnel"


def test_requete_avec_organisation_none_est_refusee(db, orgs):
    with pytest.raises(ValueError):
        queries.get_feedbacks(db, None)
    with pytest.raises(ValueError):
        queries.query_alertes_critiques(db, None)
    with pytest.raises(ValueError):
        queries.get_feedback_with_analyse(db, None, orgs.a.feedbacks[0].id)


def test_requetes_directes_ne_voient_que_l_organisation_demandee(db, orgs):
    ids_a = {str(f.id) for f in orgs.a.feedbacks}
    ids_b = {str(f.id) for f in orgs.b.feedbacks}
    vus_a = {f["id"] for f in queries.get_feedbacks(db, orgs.a.org.id, jours=30)}
    vus_b = {f["id"] for f in queries.get_feedbacks(db, orgs.b.org.id, jours=30)}
    assert vus_a == ids_a and vus_b == ids_b
    assert not (vus_a & ids_b) and not (vus_b & ids_a)
    # Un feedback étranger demandé par identifiant direct : introuvable.
    assert queries.get_feedback_with_analyse(db, orgs.a.org.id, orgs.b.feedbacks[0].id) is None
    assert queries.get_feedback_with_analyse(db, orgs.b.org.id, orgs.b.feedbacks[0].id) is not None


# =============================================================================
# /agent/actions — lister
# =============================================================================

@pytest.mark.parametrize("moi,autre", SENS)
def test_lister_actions_ne_montre_que_mon_organisation(client, orgs, moi, autre):
    mon, etranger = getattr(orgs, moi), getattr(orgs, autre)
    r = client.get("/agent/actions", headers=token_for(mon.cx))
    assert r.status_code == 200
    ids = {a["id"] for a in r.json()}
    assert ids == {str(a.id) for a in mon.actions}
    assert not (ids & {str(a.id) for a in etranger.actions})
    assert_pas_de_fuite(r.text, etranger.tag)


# =============================================================================
# /agent/actions/{id}/valider et /rejeter
# =============================================================================

@pytest.mark.parametrize("moi,autre", SENS)
@pytest.mark.parametrize("verbe", ["valider", "rejeter"])
def test_valider_rejeter_action_etrangere_refuse_et_sans_effet(
    client, db, orgs, whatsapp_sent, moi, autre, verbe
):
    mon, etranger = getattr(orgs, moi), getattr(orgs, autre)
    cible = etranger.actions[0]
    r = client.post(f"/agent/actions/{cible.id}/{verbe}", json={"contenu_final": "PIRATAGE"}, headers=token_for(mon.cx))
    assert r.status_code == 404, r.text
    assert_pas_de_fuite(r.text, etranger.tag)

    db.expire_all()
    action = db.query(ActionAgent).filter(ActionAgent.id == cible.id).one()
    assert action.statut == StatutActionAgent.EN_ATTENTE
    assert action.valide_par_id is None and action.valide_le is None
    assert action.contenu_final is None
    assert action.statut_envoi_whatsapp is None
    assert whatsapp_sent == [], "aucun WhatsApp ne doit partir pour une action hors périmètre"


@pytest.mark.parametrize("moi,autre", SENS)
def test_valider_et_rejeter_mes_propres_actions_fonctionnent(client, db, orgs, whatsapp_sent, moi, autre):
    mon = getattr(orgs, moi)
    r = client.post(f"/agent/actions/{mon.actions[0].id}/valider", json={"contenu_final": "Texte final"},
                    headers=token_for(mon.cx))
    assert r.status_code == 200 and r.json()["statut"] == "validee"
    assert len(whatsapp_sent) == 1  # bien SON client, numéro de son organisation
    r = client.post(f"/agent/actions/{mon.actions[1].id}/rejeter", headers=token_for(mon.cx))
    assert r.status_code == 200 and r.json()["statut"] == "rejetee"


def test_action_inexistante_et_action_etrangere_sont_indistinguables(client, orgs):
    h = token_for(orgs.a.cx)
    r1 = client.post(f"/agent/actions/{uuid.uuid4()}/valider", json={}, headers=h)
    r2 = client.post(f"/agent/actions/{orgs.b.actions[0].id}/valider", json={}, headers=h)
    assert r1.status_code == r2.status_code == 404


# =============================================================================
# /agent/actions/brouillon
# =============================================================================

@pytest.mark.parametrize("moi,autre", SENS)
@pytest.mark.parametrize("type_action", ["reponse_client", "ticket_interne"])
def test_brouillon_pour_feedback_etranger_refuse_sans_rien_creer(
    client, db, orgs, fake_llm, moi, autre, type_action
):
    mon, etranger = getattr(orgs, moi), getattr(orgs, autre)
    avant = db.query(func.count(ActionAgent.id)).scalar()
    r = client.post(
        "/agent/actions/brouillon",
        json={"feedback_id": str(etranger.feedbacks[3].id), "type_action": type_action},
        headers=token_for(mon.cx),
    )
    assert r.status_code == 404, r.text
    assert_pas_de_fuite(r.text, etranger.tag)
    assert fake_llm.calls == [], "aucun appel LLM (donc aucune donnée étrangère envoyée) avant la vérification"
    db.expire_all()
    assert db.query(func.count(ActionAgent.id)).scalar() == avant, "aucun brouillon ne doit être créé"


@pytest.mark.parametrize("moi,autre", SENS)
def test_brouillon_pour_mon_feedback_fonctionne_et_n_utilise_que_mes_donnees(client, db, orgs, fake_llm, moi, autre):
    mon = getattr(orgs, moi)
    r = client.post(
        "/agent/actions/brouillon",
        json={"feedback_id": str(mon.feedbacks[3].id), "type_action": "ticket_interne"},
        headers=token_for(mon.cx),
    )
    assert r.status_code == 200, r.text
    assert_pas_de_fuite(fake_llm.everything_sent(), _autre_tag(orgs, autre))
    # ... et il apparaît dans MA liste, pas dans celle de l'autre organisation
    mes = {a["id"] for a in client.get("/agent/actions", headers=token_for(mon.cx)).json()}
    theirs = {a["id"] for a in client.get("/agent/actions", headers=token_for(getattr(orgs, autre).cx)).json()}
    assert r.json()["id"] in mes and r.json()["id"] not in theirs


# =============================================================================
# Conversations
# =============================================================================

def _conv_ids(db):
    return {c.id for c in db.query(Conversation).all()}


@pytest.mark.parametrize("moi,autre", SENS)
def test_impossible_de_charger_la_conversation_d_une_autre_organisation(client, db, orgs, fake_llm, moi, autre):
    mon, etranger = getattr(orgs, moi), getattr(orgs, autre)
    tours_avant = db.query(func.count(ConversationTurn.id)).filter(
        ConversationTurn.conversation_id == etranger.conversation.id).scalar()

    r = client.post(
        "/agent/ask",
        json={"question": "Et pour les alertes critiques ?", "conversation_id": str(etranger.conversation.id)},
        headers=token_for(mon.cx),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["conversation_id"] != str(etranger.conversation.id), "la conversation étrangère ne doit pas être reprise"
    assert_pas_de_fuite(r.text, etranger.tag)
    assert_pas_de_fuite(fake_llm.everything_sent(), etranger.tag)  # ni son historique, ni son contexte

    db.expire_all()
    tours_apres = db.query(func.count(ConversationTurn.id)).filter(
        ConversationTurn.conversation_id == etranger.conversation.id).scalar()
    assert tours_apres == tours_avant, "aucun tour ne doit être ajouté à la conversation d'autrui"
    nouvelle = db.query(Conversation).filter(Conversation.id == uuid.UUID(body["conversation_id"])).one()
    assert nouvelle.utilisateur_id == mon.cx.id


@pytest.mark.parametrize("moi,autre", SENS)
def test_impossible_de_charger_la_conversation_d_un_collegue_de_la_meme_organisation(
    client, db, orgs, fake_llm, moi, autre
):
    """Même organisation, autre utilisateur : le filtre est bien sur utilisateur_id, pas seulement l'organisation."""
    mon = getattr(orgs, moi)
    r = client.post(
        "/agent/ask",
        json={"question": "Et pour les alertes critiques ?", "conversation_id": str(mon.conversation.id)},
        headers=token_for(mon.cx2),
    )
    assert r.status_code == 200
    assert r.json()["conversation_id"] != str(mon.conversation.id)
    assert "SECRET-HISTORIQUE" not in fake_llm.everything_sent()
    assert "Question secrète" not in fake_llm.everything_sent()


@pytest.mark.parametrize("moi,autre", SENS)
def test_ma_propre_conversation_est_bien_reprise_avec_son_historique(client, orgs, fake_llm, moi, autre):
    mon = getattr(orgs, moi)
    r = client.post(
        "/agent/ask",
        json={"question": "Et pour les alertes critiques ?", "conversation_id": str(mon.conversation.id)},
        headers=token_for(mon.cx),
    )
    assert r.status_code == 200
    assert r.json()["conversation_id"] == str(mon.conversation.id)
    assert f"{mon.tag.upper()}-SECRET-HISTORIQUE" in fake_llm.everything_sent()


def test_get_or_create_conversation_exige_un_utilisateur(db, orgs):
    with pytest.raises(ValueError):
        conversation_manager.get_or_create_conversation(db, orgs.a.conversation.id, None, None)


def test_get_or_create_conversation_filtre_sur_utilisateur(db, orgs):
    conv = conversation_manager.get_or_create_conversation(db, orgs.a.conversation.id, orgs.b.cx.id, None)
    assert conv.id != orgs.a.conversation.id
    assert conv.utilisateur_id == orgs.b.cx.id
    conv2 = conversation_manager.get_or_create_conversation(db, orgs.a.conversation.id, orgs.a.cx.id, None)
    assert conv2.id == orgs.a.conversation.id


# =============================================================================
# Webhook (service-à-service) — reste correct et reste cloisonné
# =============================================================================

def test_webhook_cree_le_brouillon_dans_l_organisation_du_feedback(client, db, orgs, fake_llm):
    fb = orgs.b.feedbacks[0]  # critique
    # On repart d'un état sans brouillon pour ce feedback
    db.query(ActionAgent).filter(ActionAgent.feedback_id == fb.id).delete()
    db.commit()

    r = client.post(
        "/webhook/analyse-complete",
        json={"feedback_id": str(fb.id), "criticite": "critique"},
        headers={"X-Webhook-Secret": "test-webhook-secret"},
    )
    assert r.status_code == 202
    db.expire_all()
    cree = db.query(ActionAgent).filter(ActionAgent.feedback_id == fb.id).one()
    mes = {a["id"] for a in client.get("/agent/actions", headers=token_for(orgs.b.cx)).json()}
    autres = {a["id"] for a in client.get("/agent/actions", headers=token_for(orgs.a.cx)).json()}
    assert str(cree.id) in mes and str(cree.id) not in autres
    assert_pas_de_fuite(fake_llm.everything_sent(), "alpha")


def test_webhook_sans_secret_valide_est_refuse(client, orgs):
    r = client.post("/webhook/analyse-complete",
                    json={"feedback_id": str(orgs.a.feedbacks[0].id), "criticite": "critique"},
                    headers={"X-Webhook-Secret": "faux"})
    assert r.status_code == 401


# =============================================================================
# Agency Manager — limité à SON agence (comme dans apps/api), en plus de l'organisation
# =============================================================================
# Rappel du jeu de données : par organisation, agence « Centre » (ag1) et « Nord » (ag2).
# actions[0], actions[1] -> feedbacks de Centre ; actions[2] -> feedback de Nord.

@pytest.mark.parametrize("moi,autre", SENS)
@pytest.mark.parametrize("intention", list(QUESTIONS))
def test_agency_manager_ne_voit_que_son_agence(client, orgs, fake_llm, moi, autre, intention):
    mon = getattr(orgs, moi)
    r = client.post("/agent/ask", json={"question": QUESTIONS[intention]}, headers=token_for(mon.am))
    assert r.status_code == 200, r.text
    assert_pas_de_fuite(r.text, _autre_tag(orgs, autre))
    tout = r.text + fake_llm.everything_sent()
    assert "-Nord" not in tout and f"accueil_{mon.tag}" not in tout, "données de l'autre agence de la même organisation"
    # contre-test : SES données sont bien présentes (agence ou thème de « Centre ») quand l'intention les expose
    if intention in {"alertes_critiques", "a_verifier", "statistiques_theme", "resume_periode"}:
        assert "Centre" in tout or f"reseau_{mon.tag}" in tout


@pytest.mark.parametrize("moi,autre", SENS)
def test_agency_manager_agence_id_autre_agence_ou_autre_organisation_refuse(client, orgs, fake_llm, moi, autre):
    mon, etranger = getattr(orgs, moi), getattr(orgs, autre)
    interdits = [mon.agences[1], *etranger.agences]  # autre agence de MON organisation + agences étrangères
    for ag in interdits:
        r = client.post("/agent/ask", json={"question": "alertes critiques", "agence_id": str(ag.id)},
                        headers=token_for(mon.am))
        assert r.status_code == 404, r.text
    assert fake_llm.calls == []
    r = client.post("/agent/ask", json={"question": "alertes critiques", "agence_id": str(mon.agences[0].id)},
                    headers=token_for(mon.am))
    assert r.status_code == 200


@pytest.mark.parametrize("moi,autre", SENS)
def test_agency_manager_sans_agence_rattachee_est_refuse_partout(client, orgs, fake_llm, moi, autre):
    mon = getattr(orgs, moi)
    h = token_for(mon.am_sans_agence)
    assert client.post("/agent/ask", json={"question": "alertes critiques"}, headers=h).status_code == 403
    assert client.get("/agent/actions", headers=h).status_code == 403
    assert client.post(f"/agent/actions/{mon.actions[0].id}/valider", json={}, headers=h).status_code == 403
    assert client.post(f"/agent/actions/{mon.actions[0].id}/rejeter", headers=h).status_code == 403
    assert client.post("/agent/actions/brouillon", headers=h,
                       json={"feedback_id": str(mon.fb_centre[0].id), "type_action": "ticket_interne"}).status_code == 403
    assert fake_llm.calls == []


@pytest.mark.parametrize("moi,autre", SENS)
def test_agency_manager_liste_uniquement_les_actions_de_son_agence(client, orgs, moi, autre):
    mon = getattr(orgs, moi)
    ids = {a["id"] for a in client.get("/agent/actions", headers=token_for(mon.am)).json()}
    assert ids == {str(mon.actions[0].id), str(mon.actions[1].id)}
    # le CX de la même organisation, lui, voit les trois
    ids_cx = {a["id"] for a in client.get("/agent/actions", headers=token_for(mon.cx)).json()}
    assert ids_cx == {str(a.id) for a in mon.actions}


@pytest.mark.parametrize("moi,autre", SENS)
@pytest.mark.parametrize("verbe", ["valider", "rejeter"])
def test_agency_manager_ne_peut_pas_agir_sur_une_action_d_une_autre_agence(
    client, db, orgs, whatsapp_sent, moi, autre, verbe
):
    mon = getattr(orgs, moi)
    cible = mon.actions[2]  # feedback de l'agence Nord, même organisation
    r = client.post(f"/agent/actions/{cible.id}/{verbe}", json={"contenu_final": "X"}, headers=token_for(mon.am))
    assert r.status_code == 404
    db.expire_all()
    action = db.query(ActionAgent).filter(ActionAgent.id == cible.id).one()
    assert action.statut == StatutActionAgent.EN_ATTENTE and action.valide_par_id is None
    assert whatsapp_sent == []
    # sur son agence : autorisé
    ok = client.post(f"/agent/actions/{mon.actions[0].id}/{verbe}", json={}, headers=token_for(mon.am))
    assert ok.status_code == 200


@pytest.mark.parametrize("moi,autre", SENS)
def test_agency_manager_brouillon_limite_a_son_agence(client, db, orgs, fake_llm, moi, autre):
    mon = getattr(orgs, moi)
    avant = db.query(func.count(ActionAgent.id)).scalar()
    r = client.post("/agent/actions/brouillon", headers=token_for(mon.am),
                    json={"feedback_id": str(mon.fb_nord[3].id), "type_action": "ticket_interne"})
    assert r.status_code == 404
    assert fake_llm.calls == []
    db.expire_all()
    assert db.query(func.count(ActionAgent.id)).scalar() == avant
    r = client.post("/agent/actions/brouillon", headers=token_for(mon.am),
                    json={"feedback_id": str(mon.fb_centre[3].id), "type_action": "ticket_interne"})
    assert r.status_code == 200
    assert "-Nord" not in fake_llm.everything_sent()


def test_yam_se_presente_sans_llm_ni_donnees(client, orgs, fake_llm):
    for q in ["Qui es-tu ?", "qui es tu", "Comment t'appelles-tu ?"]:
        r = client.post("/agent/ask", json={"question": q}, headers=token_for(orgs.a.cx))
        assert r.status_code == 200 and r.json()["intention"] == "presentation"
        assert "je ne sais pas répondre" not in r.json()["reponse"] and r.json()["donnees"] is None
    assert fake_llm.calls == []


def test_erreur_llm_donne_un_message_yam_et_rien_d_autre(client, orgs, monkeypatch):
    from app.providers import llm_provider

    def _boom(*a, **k):
        raise llm_provider.LLMProviderError("GROQ_API_KEY est vide")

    monkeypatch.setattr(llm_provider, "generate_text", _boom)
    r = client.post("/agent/ask", json={"question": "alertes critiques"}, headers=token_for(orgs.a.cx))
    assert r.status_code == 502
    assert r.json()["detail"].startswith("YAM est momentanément indisponible")
    assert "GROQ" not in r.text


# =============================================================================
# /agent/proactive-summary — même isolation que le reste
# =============================================================================

@pytest.mark.parametrize("moi,autre", SENS)
def test_proactive_summary_ne_couvre_que_mon_organisation(client, orgs, fake_llm, moi, autre):
    mon = getattr(orgs, moi)
    r = client.get("/agent/proactive-summary", headers=token_for(mon.cx))
    assert r.status_code == 200, r.text
    corps = r.json()
    assert set(corps) == {"insight", "niveau", "actions"}
    assert corps["niveau"] in {"info", "warning", "critique"}
    assert_pas_de_fuite(r.text, _autre_tag(orgs, autre))
    envoye = fake_llm.everything_sent()
    assert_pas_de_fuite(envoye, _autre_tag(orgs, autre))
    # contre-test : mes propres agences sont bien analysées (CX = toutes les agences de son organisation)
    assert f"{mon.tag.upper()}-Centre" in envoye and f"{mon.tag.upper()}-Nord" in envoye


@pytest.mark.parametrize("moi,autre", SENS)
def test_proactive_summary_parametres_de_perimetre_forges_ignores(client, orgs, fake_llm, moi, autre):
    mon, etranger = getattr(orgs, moi), getattr(orgs, autre)
    r = client.get(
        "/agent/proactive-summary",
        params={"organisation_id": str(etranger.org.id), "agence_id": str(etranger.agences[0].id)},
        headers=token_for(mon.cx),
    )
    assert r.status_code == 200
    assert_pas_de_fuite(r.text + fake_llm.everything_sent(), etranger.tag)


@pytest.mark.parametrize("moi,autre", SENS)
def test_proactive_summary_agency_manager_limite_a_son_agence(client, orgs, fake_llm, moi, autre):
    mon = getattr(orgs, moi)
    r = client.get("/agent/proactive-summary", headers=token_for(mon.am))
    assert r.status_code == 200, r.text
    tout = r.text + fake_llm.everything_sent()
    assert_pas_de_fuite(tout, _autre_tag(orgs, autre))
    assert "-Nord" not in tout and f"accueil_{mon.tag}" not in tout
    assert f"{mon.tag.upper()}-Centre" in tout


@pytest.mark.parametrize("moi,autre", SENS)
def test_proactive_summary_agency_manager_sans_agence_refuse(client, orgs, fake_llm, moi, autre):
    r = client.get("/agent/proactive-summary", headers=token_for(getattr(orgs, moi).am_sans_agence))
    assert r.status_code == 403
    assert fake_llm.calls == []


def test_proactive_summary_exige_une_authentification(client, orgs, fake_llm):
    assert client.get("/agent/proactive-summary").status_code == 401
    assert client.get("/agent/proactive-summary", headers={"Authorization": "Bearer faux"}).status_code == 401
    assert fake_llm.calls == []


def test_proactive_summary_valide_jours(client, orgs, fake_llm):
    h = token_for(orgs.a.cx)
    assert client.get("/agent/proactive-summary", params={"jours": 0}, headers=h).status_code == 422
    assert client.get("/agent/proactive-summary", params={"jours": 9999}, headers=h).status_code == 422
    assert client.get("/agent/proactive-summary", params={"jours": 30}, headers=h).status_code == 200


def test_proactive_summary_mode_degrade_reste_sur_et_sans_fuite(client, orgs, monkeypatch):
    from app.providers import llm_provider

    def _boom(*a, **k):
        raise llm_provider.LLMProviderError("panne")

    monkeypatch.setattr(llm_provider, "generate_text", _boom)
    r = client.get("/agent/proactive-summary", headers=token_for(orgs.a.cx))
    assert r.status_code == 200
    assert r.json()["niveau"] == "info" and r.json()["insight"].startswith("YAM")
    assert "panne" not in r.text


def test_erreurs_de_validation_restent_des_422_et_non_des_500(client, orgs):
    """Régression : get_db transformait toute exception (dont 422) en 500 « connexion PostgreSQL »."""
    h = token_for(orgs.a.cx)
    assert client.post("/agent/ask", json={}, headers=h).status_code == 422
    assert client.post("/agent/ask", json={"question": "x", "agence_id": ""}, headers=h).status_code == 422
