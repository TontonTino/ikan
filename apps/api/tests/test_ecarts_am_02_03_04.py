"""
Écarts des stories prioritaires de l'Agency Manager.

- AM-02 : comparaison avec la période précédente (même durée, même agence) sur GET /dashboard/agence/{id}.
- AM-03 : GET /recommandations/... et PATCH .../traiter, cas nominaux et positifs jumelés aux refus déjà prouvés.
- AM-04 : gravité « Critique » / « Important » des alertes de seuil (GET /alertes/).

Vrai routeur, vrai JWT, SQLite en mémoire (fixture partagée : 2 organisations, agences A1 et A2 dans A, B1 dans B).
"""
import json
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest

from app.core.security import get_password_hash
from app.models.agence import Agence
from app.models.analyse_ia import AnalyseIA
from app.models.enums import CriticiteType, PriorityLevel, SentimentType, UserRole
from app.models.feedback import Feedback
from app.models.qr_code import QRCode
from app.models.recommandation import Recommandation
from app.models.utilisateur import Utilisateur
from app.services.ai.recommandations import RECOMMANDATION_DISCORDANCE, generer_recommandations
from app.services.alertes_seuil import (
    ECART_SEUIL_CRITIQUE_POINTS, GRAVITE_CRITIQUE, GRAVITE_IMPORTANTE, ecart_sous_le_seuil, gravite_alerte_seuil,
)
from tests._fixture_deux_agences import SECRET_A2, construire_contexte

MAINTENANT = datetime.now(timezone.utc)


@pytest.fixture()
def ctx():
    return construire_contexte()


def ajouter_avis(ctx, code_qr, note, *, jours=0, heures=0):
    db = ctx.Session()
    try:
        qr = db.query(QRCode).filter(QRCode.code == code_qr).one()
        db.add(Feedback(id=uuid4(), qr_code_id=qr.id, note=note, commentaire="avis", statut_traitement="nouveau",
                        date_soumission=MAINTENANT - timedelta(days=jours, hours=heures)))
        db.commit()
    finally:
        db.close()


def definir_seuil(ctx, agence_id, seuil):
    db = ctx.Session()
    try:
        db.get(Agence, agence_id).seuil_alerte = seuil
        db.commit()
    finally:
        db.close()


def creer_cx(ctx):
    db = ctx.Session()
    try:
        organisation = db.get(Agence, ctx.a1).organisation_id
        cx = Utilisateur(id=uuid4(), organisation_id=organisation, nom="N", prenom="CX", email=f"{uuid4().hex[:8]}@t.io",
                         mot_de_passe_hash=get_password_hash("Motdepasse-123"), role=UserRole.CX_MANAGER, active=True)
        db.add(cx)
        db.commit()
        return cx.id
    finally:
        db.close()


def tableau_de_bord(ctx, acteur, agence, jours=30):
    r = ctx.client.get(f"/dashboard/agence/{agence}?jours={jours}", headers=ctx.H(getattr(ctx, acteur)))
    assert r.status_code == 200, r.text
    return r


# ═════════════════════════ AM-02 : comparaison avec la période précédente ═════════════════════════

def test_la_comparaison_compare_deux_periodes_de_meme_duree(ctx):
    # Période courante (30 j) : l'avis de la fixture (note 1, maintenant) + 5 et 5  => 3 avis, 2 positifs = 66,7 %
    ajouter_avis(ctx, "QR-A1", 5, jours=2)
    ajouter_avis(ctx, "QR-A1", 5, jours=10)
    # Période précédente (30 à 60 j) : 5 et 1 => 2 avis, 1 positif = 50,0 %
    ajouter_avis(ctx, "QR-A1", 5, jours=45)
    ajouter_avis(ctx, "QR-A1", 1, jours=50)
    corps = tableau_de_bord(ctx, "am_a1", ctx.a1).json()
    assert corps["taux_satisfaction"] == 66.7 and corps["nombre_feedbacks"] == 3          # champs existants inchangés
    c = corps["comparaison"]
    assert c["jours"] == 30 and c["nombre_feedbacks_precedent"] == 2
    assert c["satisfaction"]["valeur_num"] == 66.7 and c["satisfaction"]["valeur_precedente"] == 50.0
    assert c["satisfaction"]["evolution"] == "+16.7 pts" and c["satisfaction"]["is_positive"] is True
    assert c["total_feedbacks"]["valeur"] == 3 and c["total_feedbacks"]["valeur_precedente"] == 2
    assert c["total_feedbacks"]["evolution"] == "+50.0%"


def test_la_periode_precedente_a_exactement_la_duree_de_la_courante(ctx):
    ajouter_avis(ctx, "QR-A1", 5, jours=29)       # dans la période courante
    ajouter_avis(ctx, "QR-A1", 5, jours=31)       # début de la période précédente
    ajouter_avis(ctx, "QR-A1", 5, jours=59)       # fin de la période précédente
    ajouter_avis(ctx, "QR-A1", 5, jours=61)       # avant : dans aucune des deux
    c = tableau_de_bord(ctx, "am_a1", ctx.a1).json()["comparaison"]
    assert c["nombre_feedbacks_precedent"] == 2
    assert tableau_de_bord(ctx, "am_a1", ctx.a1).json()["nombre_feedbacks"] == 2        # fixture + celui de 29 j


def test_sans_donnees_avant_aucune_evolution_ni_zero_ni_nan(ctx):
    r = tableau_de_bord(ctx, "am_a1", ctx.a1)
    c = r.json()["comparaison"]
    assert c["nombre_feedbacks_precedent"] == 0
    for kpi in (c["satisfaction"], c["total_feedbacks"]):
        assert kpi["evolution"] is None, kpi
    assert c["satisfaction"]["valeur_precedente"] is None          # jamais 0
    assert c["total_feedbacks"]["valeur_precedente"] == 0           # 0 avis avant, pas d'évolution calculée
    assert "NaN" not in r.text and "Infinity" not in r.text


def test_un_seul_avis_de_chaque_cote(ctx):
    ajouter_avis(ctx, "QR-A1", 5, jours=40)           # un seul avis avant (positif) ; un seul maintenant (note 1)
    c = tableau_de_bord(ctx, "am_a1", ctx.a1).json()["comparaison"]
    assert c["nombre_feedbacks_precedent"] == 1
    assert c["satisfaction"]["valeur_num"] == 0.0 and c["satisfaction"]["valeur_precedente"] == 100.0
    assert c["satisfaction"]["evolution"] == "-100.0 pts" and c["satisfaction"]["is_positive"] is False
    assert c["total_feedbacks"]["evolution"] == "+0.0%"


def test_periode_courante_vide_et_precedente_remplie_division_par_zero(ctx):
    for note in (5, 5, 1):
        ajouter_avis(ctx, "QR-B1", note, jours=40)    # B1 : aucun avis maintenant, trois avant
    r = tableau_de_bord(ctx, "am_b1", ctx.b1)
    corps = r.json()
    assert corps["taux_satisfaction"] is None and corps["nombre_feedbacks"] == 0
    c = corps["comparaison"]
    assert c["satisfaction"]["status"] == "no_data" and c["satisfaction"]["valeur"] is None and c["satisfaction"]["evolution"] is None
    assert c["total_feedbacks"]["evolution"] == "-100.0%" and c["total_feedbacks"]["valeur"] == 0
    assert "NaN" not in r.text and "Infinity" not in r.text


def test_les_deux_periodes_sont_limitees_a_l_agence_isolation(ctx):
    ajouter_avis(ctx, "QR-A1", 5, jours=40)           # A1 : un avis avant
    for _ in range(6):
        ajouter_avis(ctx, "QR-A2", 5, jours=40)       # A2, même organisation : six avis avant
        ajouter_avis(ctx, "QR-B1", 5, jours=40)       # B1, autre organisation : six avis avant
        ajouter_avis(ctx, "QR-A2", 1, jours=3)
    c1 = tableau_de_bord(ctx, "am_a1", ctx.a1).json()["comparaison"]
    assert c1["nombre_feedbacks_precedent"] == 1                       # JAMAIS les avis de A2 ni de B1
    assert tableau_de_bord(ctx, "am_a1", ctx.a1).json()["nombre_feedbacks"] == 1
    # cas positifs : les propriétaires voient bien leurs propres données
    assert tableau_de_bord(ctx, "am_a2", ctx.a2).json()["comparaison"]["nombre_feedbacks_precedent"] == 6
    assert tableau_de_bord(ctx, "am_b1", ctx.b1).json()["comparaison"]["nombre_feedbacks_precedent"] == 6
    # et l'AM de A ne peut pas lire la comparaison d'une autre agence
    for autre in (ctx.a2, ctx.b1):
        r = ctx.client.get(f"/dashboard/agence/{autre}", headers=ctx.H(ctx.am_a1))
        assert r.status_code == 403 and "comparaison" not in r.text


def test_vue_d_ensemble_et_statistiques_partagent_la_meme_definition(ctx):
    ajouter_avis(ctx, "QR-A1", 5, jours=2)
    ajouter_avis(ctx, "QR-A1", 5, jours=45)
    ajouter_avis(ctx, "QR-A1", 1, jours=50)
    accueil = tableau_de_bord(ctx, "am_a1", ctx.a1).json()["comparaison"]
    r = ctx.client.get("/dashboard/statistics/agency?jours=30", headers=ctx.H(ctx.am_a1))
    assert r.status_code == 200
    stats = r.json()["kpis"]
    for cle in ("satisfaction", "total_feedbacks"):
        for champ in ("valeur", "valeur_num", "valeur_precedente", "evolution", "is_positive", "status"):
            assert stats[cle][champ] == accueil[cle][champ], (cle, champ)


# ═════════════════════════ AM-03 : recommandations ═════════════════════════

def reco(ctx, reco_id):
    db = ctx.Session()
    try:
        return db.get(Recommandation, reco_id).traitee
    finally:
        db.close()


def test_marquer_une_recommandation_la_fait_apparaitre_comme_prise_en_compte(ctx):
    h = ctx.H(ctx.am_a1)
    avant = ctx.client.get(f"/recommandations/agences/{ctx.a1}", headers=h).json()
    assert [r["id"] for r in avant] == [str(ctx.reco_a1)] and avant[0]["traitee"] is False
    r = ctx.client.patch(f"/recommandations/{ctx.reco_a1}/traiter", headers=h)
    assert r.status_code == 200 and "traitée" in r.json()["message"]
    assert reco(ctx, ctx.reco_a1) is True                                              # la base a changé
    assert reco(ctx, ctx.reco_a2) is False                                             # et seulement elle
    assert ctx.client.get(f"/recommandations/agences/{ctx.a1}", headers=h).json() == []   # plus « en attente »
    traitees = ctx.client.get("/recommandations/organisation?traitee=true", headers=h).json()
    assert [(x["id"], x["traitee"]) for x in traitees] == [(str(ctx.reco_a1), True)]  # apparaît comme prise en compte
    assert ctx.client.get("/recommandations/organisation?traitee=false", headers=h).json() == []


def test_marquer_deux_fois_ou_une_recommandation_inconnue(ctx):
    h = ctx.H(ctx.am_a1)
    assert ctx.client.patch(f"/recommandations/{ctx.reco_a1}/traiter", headers=h).status_code == 200
    assert ctx.client.patch(f"/recommandations/{ctx.reco_a1}/traiter", headers=h).status_code == 200   # idempotent
    assert reco(ctx, ctx.reco_a1) is True
    assert ctx.client.patch(f"/recommandations/{uuid4()}/traiter", headers=h).status_code == 404


def test_la_recommandation_d_une_autre_agence_reste_inchangee_et_sa_proprietaire_peut_la_marquer(ctx):
    assert ctx.client.patch(f"/recommandations/{ctx.reco_a2}/traiter", headers=ctx.H(ctx.am_a1)).status_code in {403, 404}
    assert reco(ctx, ctx.reco_a2) is False
    assert ctx.client.patch(f"/recommandations/{ctx.reco_a2}/traiter", headers=ctx.H(ctx.am_a2)).status_code == 200   # cas positif jumelé
    assert reco(ctx, ctx.reco_a2) is True


def test_lecture_des_recommandations_d_une_agence_avec_vraie_base_refus_et_acces(ctx):
    """Jumelle sur une vraie base le refus déjà prouvé par test_acces_agence (fausse base) : mon agence 200, les autres 403."""
    h = ctx.H(ctx.am_a1)
    mienne = ctx.client.get(f"/recommandations/agences/{ctx.a1}", headers=h)
    assert mienne.status_code == 200 and [r["id"] for r in mienne.json()] == [str(ctx.reco_a1)]
    for autre in (ctx.a2, ctx.b1):
        r = ctx.client.get(f"/recommandations/agences/{autre}", headers=h)
        assert r.status_code == 403 and "RECO-Agence A2" not in r.text and SECRET_A2 not in r.text


def test_la_recommandation_discordance_de_priorite_moyenne_est_conservee():
    """Hors critère d'acceptation (AM-03 ne demande que Élevée/Critique) mais utile : elle ne doit pas disparaître."""
    seule = generer_recommandations("attente", CriticiteType.FAIBLE, True)
    assert seule == [(RECOMMANDATION_DISCORDANCE, PriorityLevel.MEDIUM)]
    avec_critique = generer_recommandations("attente", CriticiteType.CRITIQUE, True)
    assert [p for _, p in avec_critique] == [PriorityLevel.CRITICAL, PriorityLevel.MEDIUM]
    assert generer_recommandations("attente", CriticiteType.FAIBLE, False) == []          # ni élevée/critique ni discordance : rien


# ═════════════════════════ AM-04 : gravité des alertes de seuil ═════════════════════════

def alertes(ctx, acteur):
    r = ctx.client.get("/alertes/", headers=ctx.H(acteur if not isinstance(acteur, str) else getattr(ctx, acteur)))
    assert r.status_code == 200, r.text
    return r.json()


def preparer_taux_40(ctx, code_qr):
    """5 avis sur 7 jours dont 2 positifs => 40,0 % (l'avis de la fixture, note 1, compte pour A1/A2 : on en ajoute 4)."""
    for note in (5, 5, 1, 1):
        ajouter_avis(ctx, code_qr, note, jours=1)


@pytest.mark.parametrize("taux,seuil,ecart,gravite", [
    (55.1, 70, "14.9", GRAVITE_IMPORTANTE),
    (55.0, 70, "15.0", GRAVITE_CRITIQUE),
    (54.9, 70, "15.1", GRAVITE_CRITIQUE),
    (57.3, 72.3, "15.0", GRAVITE_CRITIQUE),        # piège flottant : 72.3 - 57.3 = 14.999999999999993 en flottant
    (69.9, 70, "0.1", GRAVITE_IMPORTANTE),
    (0.0, 70, "70.0", GRAVITE_CRITIQUE),
    (40.0, 54.9, "14.9", GRAVITE_IMPORTANTE),
    (40.0, 55.0, "15.0", GRAVITE_CRITIQUE),
    (40.0, 55.1, "15.1", GRAVITE_CRITIQUE),
])
def test_frontiere_de_gravite(taux, seuil, ecart, gravite):
    assert ecart_sous_le_seuil(taux, seuil) == Decimal(ecart)
    assert gravite_alerte_seuil(taux, seuil) == gravite


def test_le_seuil_de_gravite_est_une_seule_constante_documentee():
    assert ECART_SEUIL_CRITIQUE_POINTS == Decimal("15")


@pytest.mark.parametrize("seuil,gravite,ecart", [(54.9, "important", 14.9), (55.0, "critique", 15.0), (55.1, "critique", 15.1)])
def test_l_api_expose_la_gravite_a_la_frontiere(ctx, seuil, gravite, ecart):
    preparer_taux_40(ctx, "QR-A1")
    definir_seuil(ctx, ctx.a1, seuil)
    (alerte,) = alertes(ctx, "am_a1")["alertes_seuil"]
    assert alerte["taux_actuel"] == 40.0 and alerte["seuil"] == seuil
    assert alerte["gravite"] == gravite and alerte["ecart_seuil"] == ecart


def test_champs_existants_inchanges_et_champs_ajoutes_additifs(ctx):
    preparer_taux_40(ctx, "QR-A1")
    corps = alertes(ctx, "am_a1")
    (alerte,) = corps["alertes_seuil"]
    assert {"agence_id", "agence_nom", "taux_actuel", "seuil", "message"} <= set(alerte)
    assert alerte["agence_id"] == str(ctx.a1) and alerte["message"].startswith("Satisfaction en baisse — Agence A1 : 40.0%")
    assert {"alertes_seuil", "alertes_feedback", "alertes_incluses"} <= set(corps)


def test_une_alerte_disparait_quand_le_taux_remonte_et_sans_assez_d_avis(ctx):
    preparer_taux_40(ctx, "QR-A1")
    assert len(alertes(ctx, "am_a1")["alertes_seuil"]) == 1
    for _ in range(6):
        ajouter_avis(ctx, "QR-A1", 5, jours=0, heures=1)           # 8 positifs sur 11 = 72,7 % >= seuil 70
    assert alertes(ctx, "am_a1")["alertes_seuil"] == []            # disparaît
    # moins de 3 avis dans la fenêtre de 7 jours : jamais d'alerte (A2 : seulement l'avis de la fixture)
    assert alertes(ctx, "am_a2")["alertes_seuil"] == []


def test_plusieurs_alertes_avec_des_gravites_differentes_pour_le_cx(ctx):
    cx = creer_cx(ctx)
    for note in (5, 5, 1, 1):
        ajouter_avis(ctx, "QR-A1", note, jours=3)                   # A1 : 40 % sous un seuil de 70 => écart 30 : critique
    # A2 : 6 positifs sur 9 (66,7 %) puis, avec l'avis négatif de la fixture, 6 sur 10 = 60 % => écart 10 : important. Toujours sous
    # le seuil de 70 % pendant les 48 h exigées du CX Manager (voir DUREE_PERSISTANCE_SEUIL_CX).
    for note in [5] * 6 + [1] * 3:
        ajouter_avis(ctx, "QR-A2", note, jours=3)
    corps = alertes(ctx, cx)
    par_agence = {a["agence_nom"]: a for a in corps["alertes_seuil"]}
    assert set(par_agence) == {"Agence A1", "Agence A2"}
    assert (par_agence["Agence A1"]["gravite"], par_agence["Agence A1"]["ecart_seuil"]) == ("critique", 30.0)
    assert (par_agence["Agence A2"]["gravite"], par_agence["Agence A2"]["ecart_seuil"]) == ("important", 10.0)


def test_aucune_alerte_quand_tout_va_bien(ctx):
    for _ in range(4):
        ajouter_avis(ctx, "QR-A1", 5, jours=1)
    for acteur in ("am_a1", "am_a2", "am_b1"):
        assert alertes(ctx, acteur)["alertes_seuil"] == []


def test_isolation_l_am_ne_voit_jamais_l_alerte_d_une_autre_agence(ctx):
    preparer_taux_40(ctx, "QR-A2")            # A2 en alerte (même organisation que A1)
    for note in (1, 1, 1):
        ajouter_avis(ctx, "QR-B1", note, jours=1)   # B1 en alerte (autre organisation)
    assert alertes(ctx, "am_a1")["alertes_seuil"] == []
    assert [a["agence_id"] for a in alertes(ctx, "am_a2")["alertes_seuil"]] == [str(ctx.a2)]     # cas positif jumelé
    assert [a["agence_id"] for a in alertes(ctx, "am_b1")["alertes_seuil"]] == [str(ctx.b1)]
    assert "Agence A2" not in json.dumps(alertes(ctx, "am_a1")) and "Agence B1" not in json.dumps(alertes(ctx, "am_a1"))


def test_le_compteur_d_en_tete_reste_alertes_seuil_plus_alertes_feedback(ctx):
    """Le front additionne len(alertes_seuil) + len(alertes_feedback) : la gravité ne change ni l'un ni l'autre."""
    preparer_taux_40(ctx, "QR-A1")
    corps = alertes(ctx, "am_a1")
    assert len(corps["alertes_seuil"]) == 1 and len(corps["alertes_feedback"]) >= 1
