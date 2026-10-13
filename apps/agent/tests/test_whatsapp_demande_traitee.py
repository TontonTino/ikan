"""
YAM n'envoie plus de WhatsApp pour une demande de rappel déjà TRAITÉE (AM-07 : l'API masque alors les coordonnées ; la lecture
directe en base de l'agent ne doit pas les rouvrir).

Le fournisseur WhatsApp est TOUJOURS le faux de conftest (`whatsapp_sent`) : aucun message réel n'est envoyé, jamais d'appel
réseau. Base PostgreSQL locale de test (voir conftest).
"""
import pytest

from app.agent import queries
from app.agent.action_service import MESSAGE_DEMANDE_TRAITEE
from app.agent.minimisation import pour_llm
from app.models.action_agent import ActionAgent
from app.models.readonly import DemandeContact

from .conftest import token_for

MESSAGE_SANS_NUMERO = "Aucun numéro de contact laissé par le client."


def _definir_demande(db, feedback_id, *, traitee=None, supprimer=False):
    requete = db.query(DemandeContact).filter(DemandeContact.feedback_id == feedback_id)
    if supprimer:
        requete.delete(synchronize_session=False)
    else:
        requete.update({DemandeContact.traitee: traitee}, synchronize_session=False)
    db.commit()


def _valider(client, db, org):
    """Valide le premier brouillon de l'organisation (feedback fb_centre[0], numéro +22670000000) et relit l'action."""
    action = org.actions[0]
    r = client.post(f"/agent/actions/{action.id}/valider", json={"contenu_final": "Texte final"}, headers=token_for(org.cx))
    assert r.status_code == 200 and r.json()["statut"] == "validee"
    db.expire_all()
    return db.query(ActionAgent).filter(ActionAgent.id == action.id).one()


# ───────────────────────── (a) demande traitée : rien n'est envoyé ─────────────────────────

def test_une_demande_traitee_n_envoie_aucun_whatsapp(client, db, orgs, whatsapp_sent):
    _definir_demande(db, orgs.a.actions[0].feedback_id, traitee=True)
    action = _valider(client, db, orgs.a)
    assert whatsapp_sent == [], "le fournisseur ne doit pas être appelé pour une demande traitée"
    assert action.statut_envoi_whatsapp == "ignore"
    assert action.whatsapp_erreur == "demande déjà traitée, coordonnées masquées" == MESSAGE_DEMANDE_TRAITEE
    assert action.whatsapp_message_id is None


def test_le_message_d_erreur_ne_contient_aucun_numero(client, db, orgs, whatsapp_sent):
    _definir_demande(db, orgs.a.actions[0].feedback_id, traitee=True)
    action = _valider(client, db, orgs.a)
    assert "+226" not in (action.whatsapp_erreur or "") and "70000000" not in (action.whatsapp_erreur or "")


# ───────────────────────── (b) demande non traitée : comportement inchangé ─────────────────────────

def test_une_demande_non_traitee_envoie_toujours_le_whatsapp(client, db, orgs, whatsapp_sent):
    action = _valider(client, db, orgs.a)          # la demande du jeu de données est NON traitée
    assert len(whatsapp_sent) == 1
    assert whatsapp_sent[0]["numero_destinataire"] == "+22670000000"
    assert whatsapp_sent[0]["parametres_corps"] == ["Texte final"]
    assert action.statut_envoi_whatsapp == "envoye"
    assert action.whatsapp_message_id == "wamid.FAKE" and action.whatsapp_erreur is None


# ───────────────────────── (c) demande absente : comportement actuel ─────────────────────────

def test_une_demande_absente_garde_son_comportement(client, db, orgs, whatsapp_sent):
    _definir_demande(db, orgs.a.actions[0].feedback_id, supprimer=True)
    action = _valider(client, db, orgs.a)
    assert whatsapp_sent == []
    assert action.statut_envoi_whatsapp == "ignore"
    assert action.whatsapp_erreur == MESSAGE_SANS_NUMERO


# ───────────────────────── la lecture elle-même ─────────────────────────

def test_la_lecture_ne_renvoie_le_numero_que_pour_une_demande_non_traitee(db, orgs):
    org, feedback_id = orgs.a.org, orgs.a.actions[0].feedback_id
    avant = queries.get_feedback_with_analyse(db, org.id, feedback_id)
    assert avant["contact_telephone"] == "+22670000000" and avant["demande_traitee"] is False
    _definir_demande(db, feedback_id, traitee=True)
    apres = queries.get_feedback_with_analyse(db, org.id, feedback_id)
    assert apres["contact_telephone"] is None and apres["demande_traitee"] is True


def test_la_liste_de_feedbacks_ne_contient_aucun_numero_de_demande_traitee(db, orgs):
    for feedback in orgs.a.feedbacks:
        _definir_demande(db, feedback.id, traitee=True)
    lignes = queries.get_feedbacks(db, orgs.a.org.id, jours=30)
    assert lignes and all(ligne["contact_telephone"] is None and ligne["demande_traitee"] is True for ligne in lignes)


def test_le_drapeau_demande_traitee_n_atteint_jamais_le_llm(db, orgs):
    ligne = queries.get_feedback_with_analyse(db, orgs.a.org.id, orgs.a.actions[0].feedback_id)
    transmis = pour_llm(ligne)
    assert "contact_telephone" not in transmis and "demande_traitee" not in transmis
    assert ligne["demande_traitee"] is False             # l'original n'est pas modifié


def test_une_demande_traitee_d_une_autre_organisation_ne_change_rien_chez_moi(client, db, orgs, whatsapp_sent):
    _definir_demande(db, orgs.b.actions[0].feedback_id, traitee=True)
    action = _valider(client, db, orgs.a)
    assert len(whatsapp_sent) == 1 and action.statut_envoi_whatsapp == "envoye"
