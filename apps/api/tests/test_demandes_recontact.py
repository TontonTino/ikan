"""
AM-07 — « Marquer comme recontacté » : traitement unique (date, auteur, historique), masquage définitif des coordonnées côté API,
isolation entre agences, consentement exposé. Vrai routeur, vrai JWT, SQLite en mémoire (fixture partagée à deux organisations,
deux agences dans A).
"""
import json
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from app.core.security import get_password_hash
from app.models.agence import Agence
from app.models.demande_contact import DemandeContact
from app.models.enums import UserRole
from app.models.feedback import Feedback
from app.models.historique_feedback import HistoriqueFeedback
from app.models.utilisateur import Utilisateur
from app.schemas.feedback import DemandeContactInfo
from app.services.demandes_contact import TYPE_EVENEMENT_RECONTACT, marquer_recontactee
from tests._fixture_deux_agences import construire_contexte

TEL = "+226 70 12 34 56"
TEL_NORMALISE = "22670123456"
EMAIL = "awa.client@example.com"
INTERDITS_QUAND_TRAITEE = (TEL, TEL_NORMALISE, "70 12 34 56", EMAIL)


@pytest.fixture()
def ctx():
    c = construire_contexte()
    db = c.Session()
    try:
        agence_a1 = db.get(Agence, c.a1)
        cx = Utilisateur(id=uuid4(), organisation_id=agence_a1.organisation_id, nom="N", prenom="CX", email=f"{uuid4().hex[:8]}@t.io",
                         mot_de_passe_hash=get_password_hash("Motdepasse-123"), role=UserRole.CX_MANAGER, active=True)
        db.add(cx)
        # Demande de A1 : numéro valide (normalisable pour WhatsApp), e-mail, consentement enregistré. L'avis est rattaché à un problème.
        dc = DemandeContact(id=uuid4(), feedback_id=c.fb_a1, nom="Awa Client", telephone=TEL, email=EMAIL, souhaite_etre_rappele=True,
                            consentement_contact=True, consentement_date=datetime(2026, 10, 1, tzinfo=timezone.utc), consentement_retention_mois=24)
        db.add(dc)
        db.get(Feedback, c.fb_a1).issue_id = c.issue_a1
        db.commit()
        c.cx_a, c.dc_a1 = cx.id, dc.id
    finally:
        db.close()
    return c


def definir_traitee(ctx, traitee: bool):
    db = ctx.Session()
    try:
        dc = db.get(DemandeContact, ctx.dc_a1)
        dc.traitee = traitee
        db.commit()
    finally:
        db.close()


def evenements(ctx):
    db = ctx.Session()
    try:
        return [(h.type_evenement, h.auteur_role, h.details, str(h.utilisateur_id)) for h in
                db.query(HistoriqueFeedback).filter(HistoriqueFeedback.type_evenement == TYPE_EVENEMENT_RECONTACT).all()]
    finally:
        db.close()


def etat_demande(ctx):
    db = ctx.Session()
    try:
        dc = db.get(DemandeContact, ctx.dc_a1)
        return dc.traitee, dc.date_traitement, dc.traitee_par_id
    finally:
        db.close()


# Routes qui renvoient une demande de contact (l'avis fb_a1 / la demande dc_a1).
# (méthode, chemin, corps, réservée à l'Agency Manager, contient la demande quand elle est traitée)
def routes(ctx):
    fb = ctx.fb_a1
    return [
        ("GET", "/feedbacks/demandes-contact?traitee=true", None, False, True),
        ("GET", "/feedbacks/demandes-contact?traitee=false", None, False, False),   # une demande traitée n'y figure plus
        ("GET", "/feedbacks/", None, False, True),
        ("GET", f"/feedbacks/{fb}", None, False, True),
        ("POST", f"/feedbacks/{fb}/open", None, True, True),
        ("POST", f"/feedbacks/{fb}/notes", {"texte": "note"}, False, True),
        ("GET", f"/issues/{ctx.issue_a1}", None, False, True),                       # détail d'un problème : avis liés (issues.py)
    ]


def routes_pour(ctx, acteur):
    return [r for r in routes(ctx) if not (r[3] and acteur != "am_a1")]


# ───────────────────────── masquage côté API ─────────────────────────

@pytest.mark.parametrize("acteur", ["am_a1", "cx_a"])
def test_une_demande_traitee_ne_renvoie_ni_telephone_ni_email_sur_aucune_route(ctx, acteur):
    definir_traitee(ctx, True)
    attendues = 0
    for methode, chemin, corps, _, contient in routes_pour(ctx, acteur):
        r = ctx.client.request(methode, chemin, headers=ctx.H(getattr(ctx, acteur)), json=corps)
        assert r.status_code == 200, (chemin, r.status_code)
        for interdit in INTERDITS_QUAND_TRAITEE:
            assert interdit not in r.text, f"{acteur} {methode} {chemin} : « {interdit} » dans le corps brut"
        if contient:
            attendues += 1
            assert '"coordonnees_masquees":true' in r.text.replace(" ", ""), f"{chemin} doit signaler le masquage"
    assert attendues >= 5


@pytest.mark.parametrize("acteur", ["am_a1", "cx_a"])
def test_une_demande_non_traitee_garde_ses_coordonnees_pour_ceux_qui_les_voient_deja(ctx, acteur):
    """Cas positif jumelé : sans le masquage, le numéro et l'e-mail sont bien dans chaque réponse (pas de refus généralisé)."""
    for methode, chemin, corps, _, _ in routes_pour(ctx, acteur):
        if chemin.startswith("/feedbacks/demandes-contact?traitee=true"):
            continue
        r = ctx.client.request(methode, chemin, headers=ctx.H(getattr(ctx, acteur)), json=corps)
        assert r.status_code == 200, chemin
        assert TEL in r.text and EMAIL in r.text, f"{acteur} {chemin}"
        assert "coordonnees_masquees\":false" in r.text.replace(" ", "")


def test_le_numero_whatsapp_n_existe_que_pour_une_demande_non_traitee_et_pour_l_am(ctx):
    vue = ctx.client.get(f"/feedbacks/{ctx.fb_a1}", headers=ctx.H(ctx.am_a1)).json()["demande_contact"]
    assert vue["telephone_whatsapp"] == TEL_NORMALISE and vue["coordonnees_masquees"] is False
    assert ctx.client.get(f"/feedbacks/{ctx.fb_a1}", headers=ctx.H(ctx.cx_a)).json()["demande_contact"]["telephone_whatsapp"] is None
    definir_traitee(ctx, True)
    vue = ctx.client.get(f"/feedbacks/{ctx.fb_a1}", headers=ctx.H(ctx.am_a1)).json()["demande_contact"]
    assert vue["telephone_whatsapp"] is None and vue["telephone"] is None and vue["email"] is None


def test_le_nom_du_client_est_conserve_apres_traitement(ctx):
    definir_traitee(ctx, True)
    vue = ctx.client.get(f"/feedbacks/{ctx.fb_a1}", headers=ctx.H(ctx.am_a1)).json()["demande_contact"]
    assert vue["nom"] == "Awa Client" and vue["coordonnees_masquees"] is True


def test_le_masquage_du_schema_ne_modifie_pas_la_base():
    class Orm:
        id, nom, telephone, email, souhaite_etre_rappele = uuid4(), "N", TEL, EMAIL, True
        traitee, telephone_whatsapp = True, TEL_NORMALISE
        date_traitement = traitee_par_nom = consentement_contact = consentement_date = consentement_retention_mois = None
        coordonnees_masquees = False

    source = Orm()
    info = DemandeContactInfo.model_validate(source)
    assert (info.telephone, info.email, info.telephone_whatsapp, info.coordonnees_masquees) == (None, None, None, True)
    assert (source.telephone, source.email) == (TEL, EMAIL)           # l'objet source n'est pas touché
    assert DemandeContactInfo.model_validate(type("O", (Orm,), {"traitee": False})()).telephone == TEL


# ───────────────────────── point de traitement unique ─────────────────────────

def test_le_bouton_enregistre_date_auteur_et_un_seul_evenement_sans_coordonnees(ctx):
    avant = datetime.now(timezone.utc) - timedelta(seconds=5)
    r = ctx.client.patch(f"/feedbacks/demandes-contact/{ctx.dc_a1}/traiter", headers=ctx.H(ctx.am_a1))
    assert r.status_code == 200
    corps = r.json()
    assert corps["deja_traitee"] is False
    for interdit in INTERDITS_QUAND_TRAITEE:
        assert interdit not in r.text
    assert corps["demande"]["traitee"] is True and corps["demande"]["coordonnees_masquees"] is True
    assert corps["demande"]["traitee_par_nom"] == "P N" and corps["demande"]["date_traitement"]
    traitee, date, auteur = etat_demande(ctx)
    assert traitee is True and auteur == ctx.am_a1
    assert date.replace(tzinfo=timezone.utc) >= avant
    (evt,) = evenements(ctx)
    assert evt[0] == TYPE_EVENEMENT_RECONTACT and evt[1] == "agency_manager" and evt[3] == str(ctx.am_a1)
    assert "bouton" in evt[2]
    for interdit in INTERDITS_QUAND_TRAITEE + ("Awa",):
        assert interdit not in evt[2]


def test_un_second_appel_ne_change_ni_la_date_ni_l_auteur_ni_l_historique(ctx):
    ctx.client.patch(f"/feedbacks/demandes-contact/{ctx.dc_a1}/traiter", headers=ctx.H(ctx.am_a1))
    premier = etat_demande(ctx)
    r = ctx.client.patch(f"/feedbacks/demandes-contact/{ctx.dc_a1}/traiter", headers=ctx.H(ctx.cx_a))   # autre acteur autorisé
    assert r.status_code == 200 and r.json()["deja_traitee"] is True
    assert etat_demande(ctx) == premier and len(evenements(ctx)) == 1


def test_enregistrer_une_reponse_passe_par_le_meme_point_de_traitement(ctx):
    r = ctx.client.post(f"/feedbacks/{ctx.fb_a1}/reponses-client", headers=ctx.H(ctx.am_a1),
                        json={"contenu": f"Rappelé au {TEL} ({EMAIL})", "canal": "whatsapp"})
    assert r.status_code == 200
    traitee, date, auteur = etat_demande(ctx)
    assert traitee is True and date is not None and auteur == ctx.am_a1
    (evt,) = evenements(ctx)
    assert "réponse enregistrée par WhatsApp" in evt[2]
    for interdit in INTERDITS_QUAND_TRAITEE:
        assert interdit not in evt[2], "l'événement ne reprend jamais le texte saisi"
    ctx.client.post(f"/feedbacks/{ctx.fb_a1}/reponses-client", headers=ctx.H(ctx.am_a1), json={"contenu": "Suite", "canal": "telephone"})
    assert len(evenements(ctx)) == 1 and etat_demande(ctx)[1] == date


def test_un_canal_inconnu_est_refuse_par_l_api_et_n_enregistre_rien(ctx):
    """AM-09 : le canal est validé (liste connue). Un canal libre contenant un numéro est refusé (422) : ni réponse, ni événement."""
    r = ctx.client.post(f"/feedbacks/{ctx.fb_a1}/reponses-client", headers=ctx.H(ctx.am_a1), json={"contenu": "x", "canal": f"canal {TEL}"})
    assert r.status_code == 422
    assert evenements(ctx) == [] and etat_demande(ctx)[0] is False


def test_le_service_n_ecrit_pas_un_canal_inconnu_dans_l_historique(ctx):
    """Défense en profondeur : même appelé directement avec un canal libre, le service ne le reprend pas."""
    db = ctx.Session()
    try:
        assert marquer_recontactee(db, db.get(DemandeContact, ctx.dc_a1), db.get(Utilisateur, ctx.am_a1), origine="reponse", canal=f"canal {TEL}")
        db.commit()
    finally:
        db.close()
    (evt,) = evenements(ctx)
    assert TEL not in evt[2] and evt[2] == "Client recontacté (réponse enregistrée)"


def test_le_service_ne_traite_qu_une_fois(ctx):
    db = ctx.Session()
    try:
        dc = db.get(DemandeContact, ctx.dc_a1)
        auteur = db.get(Utilisateur, ctx.am_a1)
        assert marquer_recontactee(db, dc, auteur, origine="bouton") is True
        assert marquer_recontactee(db, dc, auteur, origine="bouton") is False
        db.commit()
    finally:
        db.close()
    assert len(evenements(ctx)) == 1


def test_une_demande_traitee_avant_032_reste_traitee_sans_date_ni_auteur(ctx):
    definir_traitee(ctx, True)                       # traitée « avant » : aucune date ni auteur
    vue = ctx.client.get(f"/feedbacks/{ctx.fb_a1}", headers=ctx.H(ctx.am_a1)).json()["demande_contact"]
    assert vue["traitee"] is True and vue["date_traitement"] is None and vue["traitee_par_nom"] is None
    assert vue["coordonnees_masquees"] is True


# ───────────────────────── isolation ─────────────────────────

@pytest.mark.parametrize("acteur", ["am_a2", "am_b1"])
def test_marquer_recontacte_la_demande_d_une_autre_agence_est_refuse(ctx, acteur):
    avant = (etat_demande(ctx), evenements(ctx))
    r = ctx.client.patch(f"/feedbacks/demandes-contact/{ctx.dc_a1}/traiter", headers=ctx.H(getattr(ctx, acteur)))
    assert r.status_code in {403, 404}
    for interdit in INTERDITS_QUAND_TRAITEE:
        assert interdit not in r.text
    assert (etat_demande(ctx), evenements(ctx)) == avant


@pytest.mark.parametrize("acteur", ["am_a2", "am_b1"])
def test_la_liste_des_demandes_ne_montre_pas_celle_d_une_autre_agence(ctx, acteur):
    for etat in ("true", "false"):
        r = ctx.client.get(f"/feedbacks/demandes-contact?traitee={etat}", headers=ctx.H(getattr(ctx, acteur)))
        assert r.status_code == 200 and str(ctx.dc_a1) not in r.text and EMAIL not in r.text


def test_la_propre_agence_peut_traiter_et_voir_sa_demande(ctx):
    liste = ctx.client.get("/feedbacks/demandes-contact", headers=ctx.H(ctx.am_a1)).json()
    assert str(ctx.dc_a1) in {d["id"] for d in liste}
    assert ctx.client.patch(f"/feedbacks/demandes-contact/{ctx.dc_a1}/traiter", headers=ctx.H(ctx.am_a1)).status_code == 200
    traitees = ctx.client.get("/feedbacks/demandes-contact?traitee=true", headers=ctx.H(ctx.am_a1)).json()
    assert [d["id"] for d in traitees] == [str(ctx.dc_a1)] and traitees[0]["telephone"] is None


# ───────────────────────── consentement ─────────────────────────

def test_le_consentement_est_expose_et_les_lignes_anterieures_a_030_restent_utilisables(ctx):
    liste = {d["id"]: d for d in ctx.client.get("/feedbacks/demandes-contact", headers=ctx.H(ctx.am_a1)).json()}
    avec = liste[str(ctx.dc_a1)]
    assert avec["consentement_contact"] is True and avec["consentement_retention_mois"] == 24 and avec["consentement_date"].startswith("2026-10-01")
    ancien = {d["id"]: d for d in ctx.client.get("/feedbacks/demandes-contact", headers=ctx.H(ctx.am_a2)).json()}
    (sans,) = ancien.values()                       # la demande de A2 de la fixture n'a aucun consentement enregistré
    assert sans["consentement_contact"] is None and sans["consentement_date"] is None and sans["consentement_retention_mois"] is None
    assert sans["telephone"] is not None            # aucun blocage : la demande reste utilisable
