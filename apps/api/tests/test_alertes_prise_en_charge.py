"""
Prise en charge d'une alerte de seuil par l'Agency Manager (cycle de vie des alertes, PR 3/5) : POST /alertes/episodes/{id}/prendre-en-charge.

Vrai routeur, vraie authentification JWT, SQLite en mémoire, deux organisations. La concurrence sur un vrai PostgreSQL et le fuseau de
date_assignation sont dans test_alertes_prise_en_charge_postgres.py.
"""
import os
from datetime import datetime, timedelta, timezone
from uuid import uuid4

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-alertes-prise-en-charge-0123456789")

import pytest

from app.api.v1.endpoints import alertes
from app.core.security import create_access_token, get_password_hash
from app.models.alerte_episode import STATUT_DETECTEE, STATUT_PRISE_EN_CHARGE, STATUT_TERMINEE
from app.models.enums import UserRole
from app.models.journal_audit import JournalAudit
from app.models.utilisateur import Utilisateur
from app.services import alertes_episodes as ep
from app.services import journal_audit as journal

from tests.test_alertes_episodes import ctx  # noqa: F401  (même jeu de données : deux organisations, A1 et B1 sous leur seuil)

UTC = timezone.utc
CHAMPS_ANCIENS = {"agence_id", "agence_nom", "taux_actuel", "seuil", "message", "gravite", "ecart_seuil"}
CHAMPS_EPISODE = {"episode_id", "episode_statut", "detecte_le", "debut_condition", "debut_approximatif", "debut_remontee_limitee", "pris_en_charge_le",
                  "pris_en_charge_par_nom", "commentaire_prise_en_charge"}


def entete(utilisateur_id):
    return {"Authorization": f"Bearer {create_access_token(utilisateur_id)}"}


def post(ctx, episode_id, acteur_id, json=None, **kw):
    corps = {} if json is None else {"json": json}
    return ctx.client.post(f"/alertes/episodes/{episode_id}/prendre-en-charge", headers=entete(acteur_id) if acteur_id else {}, **corps, **kw)


def ajouter_am(ctx, agence_id, organisation_id):
    uid = uuid4()
    ctx.modifier(lambda s: s.add(Utilisateur(
        id=uid, organisation_id=organisation_id, agence_id=agence_id, nom="Traoré", prenom="Awa", email=f"{uuid4().hex[:10]}@test.io",
        mot_de_passe_hash=get_password_hash("Motdepasse-123"), role=UserRole.AGENCY_MANAGER, active=True)))
    return uid


@pytest.fixture()
def cas(ctx):  # noqa: F811
    """Un épisode ouvert sur A1 (via la vraie réconciliation), un AM de A2 (même organisation), des mauvais avis anciens pour que le CX voie l'alerte."""
    for heures in (130, 120, 110, 100):
        ctx.ajouter("A1", 1, heures)
    ctx.lire("am_a1")
    (episode,) = ctx.episodes(agence_id=ctx.a1)
    ctx.am_a2 = ajouter_am(ctx, ctx.a2, ctx.org_a)
    ctx.episode = episode.id
    return ctx


def etat(ctx):
    (e,) = ctx.episodes(agence_id=ctx.a1)
    return e


def lignes_journal(ctx):
    with ctx.Session() as s:
        lignes = s.query(JournalAudit).filter(JournalAudit.action == journal.ALERTE_EPISODE_PRIS_EN_CHARGE).all()
        s.expunge_all()
        return lignes


# ── Matrice des rôles ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

def test_matrice_des_roles_aucun_refus_ne_modifie_l_episode(cas):
    inconnu = post(cas, uuid4(), cas.am_a1)
    assert inconnu.status_code == 404
    refus = {
        "AM d'une autre agence (même organisation)": post(cas, cas.episode, cas.am_a2),
        "AM d'une autre organisation": post(cas, cas.episode, cas.am_b1),
    }
    for nom, r in refus.items():
        assert r.status_code == 404, nom
        assert r.json() == inconnu.json(), f"{nom} : la réponse doit être identique à celle d'un identifiant inconnu (aucune fuite d'existence)"
    assert post(cas, cas.episode, cas.cx_a).status_code == 403            # le CX Manager de la même organisation consulte seulement
    assert post(cas, cas.episode, cas.cx_b).status_code == 403
    assert post(cas, cas.episode, cas.admin).status_code == 403           # l'Administrateur reste refusé
    assert post(cas, cas.episode, None).status_code == 401                # sans connexion
    assert post(cas, "pas-un-uuid", cas.am_a1).status_code == 422
    e = etat(cas)
    assert e.statut == STATUT_DETECTEE and e.pris_en_charge_le is None and e.pris_en_charge_par_id is None and lignes_journal(cas) == []
    r = post(cas, cas.episode, cas.am_a1)
    assert r.status_code == 200, r.text                                   # l'AM concerné peut agir
    assert etat(cas).statut == STATUT_PRISE_EN_CHARGE


def test_un_responsable_d_une_autre_agence_ne_peut_pas_prendre_en_charge_meme_apres_la_reponse_d_un_collegue(cas):
    assert post(cas, cas.episode, cas.am_a1).status_code == 200
    assert post(cas, cas.episode, cas.am_a2).status_code == 404           # toujours 404 (pas 409) : on ne révèle pas l'état d'un épisode d'une autre agence
    assert post(cas, cas.episode, cas.am_b1).status_code == 404


def test_forfait_sans_alertes_refuse(cas, monkeypatch):
    monkeypatch.setattr(alertes, "organisation_a_la_fonctionnalite", lambda *a, **k: False)
    r = post(cas, cas.episode, cas.am_a1)
    assert r.status_code == 403 and "forfait" in r.json()["detail"].lower() and etat(cas).statut == STATUT_DETECTEE


# ── Succès ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

def test_prise_en_charge_renseigne_tout_et_l_alerte_reste_dans_la_liste(cas):
    avant = cas.lire("am_a1")
    avant_cx = cas.lire("cx_a")
    assert len(avant["alertes_seuil"]) == 1 and len(avant_cx["alertes_seuil"]) == 1, "le CX voit l'alerte (4 avis de plus de 100 h)"
    debut = datetime.now(UTC)
    r = post(cas, cas.episode, cas.am_a1, {"commentaire": "  Rappel de l'équipe d'accueil prévu demain  "})
    assert r.status_code == 200, r.text
    corps = r.json()
    assert corps["statut"] == "prise_en_charge" and corps["episode_id"] == str(cas.episode) and corps["agence_id"] == str(cas.a1)
    assert corps["pris_en_charge_par_nom"] == "P N"
    assert corps["commentaire_prise_en_charge"] == "Rappel de l'équipe d'accueil prévu demain"
    e = etat(cas)
    assert e.statut == STATUT_PRISE_EN_CHARGE and e.pris_en_charge_par_id == cas.am_a1 and e.pris_en_charge_par_nom == "P N"
    pec = e.pris_en_charge_le.replace(tzinfo=UTC)
    assert debut - timedelta(seconds=5) <= pec <= datetime.now(UTC) + timedelta(seconds=5)           # instant UTC, avec fuseau à l'écriture
    assert e.commentaire_prise_en_charge == "Rappel de l'équipe d'accueil prévu demain"
    apres, apres_cx = cas.lire("am_a1"), cas.lire("cx_a")
    for ancien, nouveau in ((avant, apres), (avant_cx, apres_cx)):                                     # l'alerte RESTE dans la liste, compteurs inchangés
        assert len(nouveau["alertes_seuil"]) == len(ancien["alertes_seuil"]) == 1
        assert len(nouveau["alertes_feedback"]) == len(ancien["alertes_feedback"])
        assert len(nouveau["agences_sous_seuil"]) == len(ancien["agences_sous_seuil"])
        assert {k: v for k, v in nouveau["alertes_seuil"][0].items() if k in CHAMPS_ANCIENS} == {k: v for k, v in ancien["alertes_seuil"][0].items() if k in CHAMPS_ANCIENS}


def test_les_champs_additifs_sont_visibles_du_responsable_et_du_cx_manager(cas):
    avant = cas.lire("am_a1")["alertes_seuil"][0]
    assert set(avant) == CHAMPS_ANCIENS | CHAMPS_EPISODE, "les anciens champs restent, seuls les champs d'épisode sont ajoutés"
    assert avant["episode_statut"] == "detectee" and avant["pris_en_charge_le"] is None and avant["pris_en_charge_par_nom"] is None
    assert avant["debut_approximatif"] is True and avant["debut_remontee_limitee"] is False and avant["detecte_le"] and avant["debut_condition"]
    assert avant["episode_id"] == str(cas.episode)
    post(cas, cas.episode, cas.am_a1, {"commentaire": "Pris en main"})
    for acteur in ("am_a1", "cx_a"):                                                                    # le CX voit en lecture, l'AM aussi
        a = cas.lire(acteur)["alertes_seuil"][0]
        assert a["episode_statut"] == "prise_en_charge" and a["pris_en_charge_par_nom"] == "P N" and a["commentaire_prise_en_charge"] == "Pris en main"
        assert a["pris_en_charge_le"] is not None and a["episode_id"] == str(cas.episode)
        assert a["detecte_le"] == avant["detecte_le"] and a["debut_condition"] == avant["debut_condition"]


def test_interrupteur_coupe_les_champs_d_episode_restent_vides(cas, monkeypatch):
    monkeypatch.setattr(ep.settings, "ALERTES_EPISODES", "non")
    a = cas.lire("am_a1")["alertes_seuil"][0]
    assert set(a) == CHAMPS_ANCIENS | CHAMPS_EPISODE and all(a[k] is None for k in CHAMPS_EPISODE)


# ── 409 ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

def test_deja_prise_en_charge_409_et_rien_n_est_ecrase(cas):
    assert post(cas, cas.episode, cas.am_a1, {"commentaire": "premier"}).status_code == 200
    avant = etat(cas)
    r = post(cas, cas.episode, cas.am_a1, {"commentaire": "second"})
    assert r.status_code == 409 and "déjà prise en charge" in r.json()["detail"]
    apres = etat(cas)
    assert (apres.pris_en_charge_le, apres.pris_en_charge_par_id, apres.commentaire_prise_en_charge, apres.updated_at) == \
           (avant.pris_en_charge_le, avant.pris_en_charge_par_id, "premier", avant.updated_at)
    assert len(lignes_journal(cas)) == 1


def test_episode_termine_409_sans_rien_ecrire(cas):
    for i in range(30):
        cas.ajouter("A1", 5, 1 + i * 0.01)
    cas.lire("am_a1")
    assert etat(cas).statut == STATUT_TERMINEE
    r = post(cas, cas.episode, cas.am_a1, {"commentaire": "trop tard"})
    assert r.status_code == 409 and "terminée" in r.json()["detail"]
    e = etat(cas)
    assert e.statut == STATUT_TERMINEE and e.pris_en_charge_le is None and e.commentaire_prise_en_charge is None and lignes_journal(cas) == []


# ── Commentaire ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("corps, attendu", [
    (None, None),                                       # pas de corps du tout
    ({}, None),
    ({"commentaire": None}, None),
    ({"commentaire": ""}, None),                        # vide = absent
    ({"commentaire": "   \t \n "}, None),               # espaces seuls = absent
    ({"commentaire": "  texte  "}, "texte"),            # nettoyé
    ({"commentaire": "é" * 500}, "é" * 500),            # 500 caractères : accepté
    ({"commentaire": "  " + "x" * 500 + "  "}, "x" * 500),     # la limite porte sur le texte nettoyé
])
def test_commentaire_facultatif_nettoye_et_borne(cas, corps, attendu):
    r = post(cas, cas.episode, cas.am_a1, corps)
    assert r.status_code == 200, r.text
    assert r.json()["commentaire_prise_en_charge"] == attendu and etat(cas).commentaire_prise_en_charge == attendu


@pytest.mark.parametrize("corps", [{"commentaire": "x" * 501}, {"commentaire": " " + "é" * 501}, {"commentaire": 123}, {"commentaire": ["a"]}])
def test_commentaire_trop_long_ou_invalide_422_et_rien_n_est_ecrit(cas, corps):
    r = post(cas, cas.episode, cas.am_a1, corps)
    assert r.status_code == 422
    e = etat(cas)
    assert e.statut == STATUT_DETECTEE and e.pris_en_charge_le is None and lignes_journal(cas) == []


# ── La réconciliation préserve la prise en charge ─────────────────────────────────────────────────────────────────────────────────────

def test_la_reconciliation_preserve_la_prise_en_charge_et_la_conserve_a_la_fin(cas):
    assert post(cas, cas.episode, cas.am_a1, {"commentaire": "À suivre"}).status_code == 200
    pris = etat(cas)
    cas.ecritures.clear()
    for acteur in ("am_a1", "cx_a", "am_a1"):
        cas.lire(acteur)
    assert cas.ecritures == [], "un épisode pris en charge qui continue ne provoque aucune écriture"
    continuee = etat(cas)
    assert (continuee.id, continuee.statut, continuee.pris_en_charge_le, continuee.pris_en_charge_par_id, continuee.commentaire_prise_en_charge) == \
           (pris.id, STATUT_PRISE_EN_CHARGE, pris.pris_en_charge_le, pris.pris_en_charge_par_id, "À suivre")
    assert len(cas.episodes(agence_id=cas.a1)) == 1, "un épisode pris en charge compte comme ouvert : aucun second épisode"

    for i in range(30):                                                                                # les données remontent : l'épisode se termine
        cas.ajouter("A1", 5, 1 + i * 0.01)
    reponse = cas.lire("am_a1")
    assert reponse["alertes_seuil"] == [], "une fois terminée, l'alerte quitte la liste active"
    fin = etat(cas)
    assert fin.statut == STATUT_TERMINEE and fin.fin_cause == "retablie"
    assert (fin.pris_en_charge_le, fin.pris_en_charge_par_id, fin.pris_en_charge_par_nom, fin.commentaire_prise_en_charge) == \
           (pris.pris_en_charge_le, pris.pris_en_charge_par_id, pris.pris_en_charge_par_nom, "À suivre"), "les infos de prise en charge sont conservées à la fin"

    for i in range(40):                                                                                # le problème revient : NOUVEL épisode, sans prise en charge
        cas.ajouter("A1", 1, 0.5 + i * 0.001)
    cas.lire("am_a1")
    anciens, nouveaux = [e for e in cas.episodes(agence_id=cas.a1) if e.statut == STATUT_TERMINEE], [e for e in cas.episodes(agence_id=cas.a1) if e.statut != STATUT_TERMINEE]
    assert len(anciens) == 1 and len(nouveaux) == 1 and nouveaux[0].id != anciens[0].id
    assert nouveaux[0].statut == STATUT_DETECTEE and nouveaux[0].pris_en_charge_le is None


# ── Journal d'audit ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

def test_journal_acteur_agency_manager_sans_le_commentaire(cas):
    post(cas, cas.episode, cas.am_a1, {"commentaire": "SECRET-COMMENTAIRE-AM"})
    (ligne,) = lignes_journal(cas)
    assert ligne.acteur_id == cas.am_a1 and ligne.acteur_role == "agency_manager" and ligne.resultat == "succes"
    assert ligne.cible_type == "alerte_episode" and ligne.cible_id == str(cas.episode) and ligne.organisation_id == cas.org_a and ligne.cible_libelle == "Agence A1"
    assert set(ligne.details) == {"agence_id", "type", "statut_avant", "statut_apres", "delai_prise_en_charge_minutes"}, "une clé a été supprimée en silence"
    assert ligne.details["statut_avant"] == "detectee" and ligne.details["statut_apres"] == "prise_en_charge"
    assert all(not any(f in cle.lower() for f in journal.FRAGMENTS_INTERDITS) for cle in ligne.details)
    contenu = " ".join(str(getattr(ligne, c.name)) for c in JournalAudit.__table__.columns)
    assert "SECRET-COMMENTAIRE-AM" not in contenu and "TEXTE-SECRET-CLIENT" not in contenu


def test_aucune_ligne_de_journal_pour_une_ouverture_qui_n_a_pas_lieu(cas):
    post(cas, cas.episode, cas.am_a1)
    post(cas, cas.episode, cas.am_a1)                              # 409
    post(cas, cas.episode, cas.cx_a)                               # 403
    assert len(lignes_journal(cas)) == 1


def test_le_nouveau_code_est_stable_et_unique():
    assert journal.ALERTE_EPISODE_PRIS_EN_CHARGE == "alerte_episode.pris_en_charge" and journal.ALERTE_EPISODE_PRIS_EN_CHARGE in journal.CODES_ACTION
    assert len(journal.CODES_ACTION) == len(set(journal.CODES_ACTION))


# ── date_assignation des avis : toujours un instant UTC explicite ─────────────────────────────────────────────────────────────────────

def test_date_assignation_est_ecrite_avec_un_fuseau_utc_explicite():
    import inspect
    import re

    from app.api.v1.endpoints import feedbacks

    source = inspect.getsource(feedbacks)
    ecritures = re.findall(r"date_assignation\s*[:=][^\n]*", source)
    assert ecritures, "l'écriture de date_assignation a disparu : revoir ce test"
    for ligne in ecritures:
        assert "datetime.now(timezone.utc)" in ligne, f"écriture naïve de date_assignation : {ligne}"
