"""
Agence NOMMÉE dans une question — isolation et périmètre (base PostgreSQL de test, voir conftest).

Règle vérifiée : le nom lu dans le texte ne donne jamais un droit d'accès. Un CX Manager n'est restreint
qu'à une agence de SON organisation ; un responsable d'agence qui nomme une autre agence est refusé sans
qu'aucune donnée soit lue ni envoyée au LLM.
"""
from app.agent import queries
from app.db import session as db_session

from .conftest import token_for

Q_ALERTES = "Y a-t-il des alertes critiques à {nom} ?"


def test_lister_agences_ne_renvoie_que_l_organisation_de_l_appelant(orgs):
    with db_session.SessionLocal() as db:
        noms = {a["nom"] for a in queries.lister_agences_organisation(db, orgs.a.org.id)}
    assert noms == {a.nom for a in orgs.a.agences}
    assert not any("BRAVO" in n.upper() for n in noms)


def test_secteur_absent_en_base_donne_none_sans_casser_la_session(orgs):
    with db_session.SessionLocal() as db:
        assert queries.get_secteur_organisation(db, orgs.a.org.id) is None
        # la session reste utilisable après la tentative de lecture de la colonne absente
        assert len(queries.lister_agences_organisation(db, orgs.a.org.id)) == len(orgs.a.agences)


def test_cx_manager_qui_nomme_une_agence_n_obtient_que_cette_agence(client, orgs, fake_llm):
    nord = orgs.a.agences[1]
    r = client.post("/agent/ask", json={"question": Q_ALERTES.format(nom=nord.nom)}, headers=token_for(orgs.a.cx))
    assert r.status_code == 200, r.text
    corps = r.json()
    assert corps["intention"] == "alertes_critiques"
    assert corps["donnees"] and all(d["agence_nom"] == nord.nom for d in corps["donnees"])
    assert nord.nom in corps["perimetre"]
    assert orgs.a.agences[0].nom not in str(corps["donnees"])


def test_cx_manager_qui_nomme_une_agence_d_une_autre_organisation_ne_voit_rien_d_elle(client, orgs, fake_llm):
    etrangere = orgs.b.agences[0]
    r = client.post("/agent/ask", json={"question": Q_ALERTES.format(nom=etrangere.nom)}, headers=token_for(orgs.a.cx))
    assert r.status_code == 200, r.text
    assert orgs.b.tag.lower() not in r.text.lower()
    assert orgs.b.tag.lower() not in fake_llm.everything_sent().lower()
    assert all(d["agence_nom"].startswith("Agence ALPHA") for d in r.json()["donnees"])
    assert "toutes les agences" in r.json()["perimetre"].lower()


def test_responsable_qui_nomme_une_autre_agence_de_son_organisation_est_refuse_sans_donnees(client, orgs, fake_llm):
    autre = orgs.a.agences[1]  # le responsable est rattaché à l'agence « Centre »
    r = client.post("/agent/ask", json={"question": Q_ALERTES.format(nom=autre.nom)}, headers=token_for(orgs.a.am))
    assert r.status_code == 200, r.text
    corps = r.json()
    assert corps["intention"] == "agence_hors_perimetre"
    assert corps["donnees"] is None
    assert orgs.a.agences[0].nom in corps["reponse"] and autre.nom not in corps["reponse"]
    assert fake_llm.calls == [], "aucune donnée ne doit être lue ni envoyée au LLM"


def test_responsable_qui_nomme_une_agence_d_une_autre_organisation_ne_decouvre_rien(client, orgs, fake_llm):
    r = client.post(
        "/agent/ask", json={"question": Q_ALERTES.format(nom=orgs.b.agences[0].nom)}, headers=token_for(orgs.a.am)
    )
    assert r.status_code == 200, r.text
    assert orgs.b.tag.lower() not in r.text.lower()
    assert all(d["agence_nom"] == orgs.a.agences[0].nom for d in r.json()["donnees"])


def test_responsable_peut_nommer_sa_propre_agence(client, orgs, fake_llm):
    mon_agence = orgs.a.agences[0]
    r = client.post("/agent/ask", json={"question": Q_ALERTES.format(nom=mon_agence.nom)}, headers=token_for(orgs.a.am))
    assert r.status_code == 200, r.text
    assert r.json()["intention"] == "alertes_critiques"
    assert all(d["agence_nom"] == mon_agence.nom for d in r.json()["donnees"])
