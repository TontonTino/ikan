"""
YAM n'envoie un WhatsApp que si le consentement du client à être recontacté est enregistré à « oui » (migration 030 côté API).
NULL (demandes d'avant 030), « non » ou demande absente : aucun envoi, statut « ignore », message sans numéro.

Le fournisseur WhatsApp est TOUJOURS le faux de conftest (`whatsapp_sent`) : aucun message réel, jamais d'appel réseau.
Base PostgreSQL locale de test (voir conftest). Le jeu de données de conftest donne le consentement « oui » à ses clients.
"""
import re

import pytest

from app.agent import queries
from app.agent.action_service import MESSAGE_CONSENTEMENT_NON_ENREGISTRE, MESSAGE_DEMANDE_TRAITEE
from app.agent.minimisation import CHAMPS_EXCLUS_DU_LLM, pour_llm
from app.models.action_agent import ActionAgent
from app.models.readonly import DemandeContact

from .conftest import token_for

MESSAGE_SANS_NUMERO = "Aucun numéro de contact laissé par le client."
NUMERO = "+22670000000"


def _definir(db, feedback_id, **valeurs):
    db.query(DemandeContact).filter(DemandeContact.feedback_id == feedback_id).update(
        {getattr(DemandeContact, cle): valeur for cle, valeur in valeurs.items()}, synchronize_session=False
    )
    db.commit()


def _supprimer(db, feedback_id):
    db.query(DemandeContact).filter(DemandeContact.feedback_id == feedback_id).delete(synchronize_session=False)
    db.commit()


def _valider(client, db, org):
    action = org.actions[0]
    r = client.post(f"/agent/actions/{action.id}/valider", json={"contenu_final": "Texte final"}, headers=token_for(org.cx))
    assert r.status_code == 200 and r.json()["statut"] == "validee"
    db.expire_all()
    return db.query(ActionAgent).filter(ActionAgent.id == action.id).one()


def _aucun_numero_dans(texte):
    assert texte is not None
    assert "+" not in texte and not re.search(r"\d{4,}", texte), f"le message contient un numéro : {texte!r}"


# ───────────────────────── consentement « oui » : envoi ─────────────────────────

def test_avec_consentement_le_whatsapp_part_une_fois_au_bon_numero(client, db, orgs, whatsapp_sent):
    action = _valider(client, db, orgs.a)
    assert len(whatsapp_sent) == 1
    assert whatsapp_sent[0]["numero_destinataire"] == NUMERO and whatsapp_sent[0]["parametres_corps"] == ["Texte final"]
    assert action.statut_envoi_whatsapp == "envoye" and action.whatsapp_erreur is None


# ───────────────────────── consentement absent, NULL ou « non » : aucun envoi ─────────────────────────

@pytest.mark.parametrize("consentement", [None, False], ids=["NULL (avant la migration 030)", "faux"])
def test_sans_consentement_a_oui_aucun_envoi(client, db, orgs, whatsapp_sent, consentement):
    _definir(db, orgs.a.actions[0].feedback_id, consentement_contact=consentement, consentement_date=None, consentement_retention_mois=None)
    action = _valider(client, db, orgs.a)
    assert whatsapp_sent == [], "le fournisseur ne doit pas être appelé sans consentement enregistré à « oui »"
    assert action.statut_envoi_whatsapp == "ignore"
    assert action.whatsapp_erreur == "consentement du client non enregistré" == MESSAGE_CONSENTEMENT_NON_ENREGISTRE
    assert action.whatsapp_message_id is None
    _aucun_numero_dans(action.whatsapp_erreur)


# ───────────────────────── priorité des règles existantes ─────────────────────────

def test_demande_traitee_ET_consentement_vrai_aucun_envoi_message_demande_traitee(client, db, orgs, whatsapp_sent):
    _definir(db, orgs.a.actions[0].feedback_id, traitee=True, consentement_contact=True)
    action = _valider(client, db, orgs.a)
    assert whatsapp_sent == []
    assert action.statut_envoi_whatsapp == "ignore" and action.whatsapp_erreur == MESSAGE_DEMANDE_TRAITEE
    _aucun_numero_dans(action.whatsapp_erreur)


def test_demande_traitee_sans_consentement_garde_le_message_demande_traitee(client, db, orgs, whatsapp_sent):
    _definir(db, orgs.a.actions[0].feedback_id, traitee=True, consentement_contact=None)
    action = _valider(client, db, orgs.a)
    assert whatsapp_sent == [] and action.whatsapp_erreur == MESSAGE_DEMANDE_TRAITEE


def test_demande_absente_garde_le_message_actuel(client, db, orgs, whatsapp_sent):
    """Pas de demande = pas de numéro : la règle existante « pas de numéro » passe avant celle du consentement."""
    _supprimer(db, orgs.a.actions[0].feedback_id)
    action = _valider(client, db, orgs.a)
    assert whatsapp_sent == []
    assert action.statut_envoi_whatsapp == "ignore" and action.whatsapp_erreur == MESSAGE_SANS_NUMERO


def test_pas_de_numero_garde_le_message_actuel_meme_sans_consentement(client, db, orgs, whatsapp_sent):
    _definir(db, orgs.a.actions[0].feedback_id, telephone=None, consentement_contact=None)
    action = _valider(client, db, orgs.a)
    assert whatsapp_sent == [] and action.whatsapp_erreur == MESSAGE_SANS_NUMERO


def test_le_consentement_d_une_autre_organisation_ne_change_rien_chez_moi(client, db, orgs, whatsapp_sent):
    _definir(db, orgs.b.actions[0].feedback_id, consentement_contact=None)
    action = _valider(client, db, orgs.a)
    assert len(whatsapp_sent) == 1 and action.statut_envoi_whatsapp == "envoye"


# ───────────────────────── la lecture et le LLM ─────────────────────────

def test_la_lecture_expose_le_consentement_tel_quel(db, orgs):
    org, feedback_id = orgs.a.org, orgs.a.actions[0].feedback_id
    assert queries.get_feedback_with_analyse(db, org.id, feedback_id)["consentement_contact"] is True
    _definir(db, feedback_id, consentement_contact=None)
    assert queries.get_feedback_with_analyse(db, org.id, feedback_id)["consentement_contact"] is None
    _definir(db, feedback_id, consentement_contact=False)
    assert queries.get_feedback_with_analyse(db, org.id, feedback_id)["consentement_contact"] is False
    _supprimer(db, feedback_id)
    assert queries.get_feedback_with_analyse(db, org.id, feedback_id)["consentement_contact"] is None


def test_le_consentement_n_atteint_jamais_le_llm(db, orgs):
    ligne = queries.get_feedback_with_analyse(db, orgs.a.org.id, orgs.a.actions[0].feedback_id)
    assert "consentement_contact" in CHAMPS_EXCLUS_DU_LLM
    transmis = pour_llm(ligne)
    assert not {"contact_telephone", "demande_traitee", "consentement_contact"} & set(transmis)
    assert ligne["consentement_contact"] is True            # l'original n'est pas modifié
    assert "consentement_contact" not in pour_llm([ligne, {"imbrique": ligne}])[1]["imbrique"]


def test_le_prompt_du_brouillon_ne_contient_ni_numero_ni_consentement(client, db, orgs, fake_llm):
    r = client.post("/agent/actions/brouillon", json={"feedback_id": str(orgs.a.actions[0].feedback_id), "type_action": "reponse_client"},
                    headers=token_for(orgs.a.cx))
    assert r.status_code == 200
    transmis = fake_llm.everything_sent()
    assert NUMERO not in transmis and "consentement" not in transmis.lower()


# ───────────────────────── le modèle en lecture seule suit la migration 030 ─────────────────────────

def test_le_modele_en_lecture_seule_porte_les_trois_colonnes_de_la_migration_030():
    """Mêmes noms, types PostgreSQL et nullabilité que apps/api/alembic/versions/030_demande_contact_consentement.py."""
    from sqlalchemy.dialects import postgresql

    colonnes = DemandeContact.__table__.columns
    attendu = {"consentement_contact": "BOOLEAN", "consentement_date": "TIMESTAMP WITH TIME ZONE", "consentement_retention_mois": "INTEGER"}
    for nom, type_sql in attendu.items():
        assert nom in colonnes, nom
        assert colonnes[nom].nullable is True, f"{nom} doit rester nullable (lignes d'avant 030)"
        assert colonnes[nom].type.compile(dialect=postgresql.dialect()) == type_sql, nom
