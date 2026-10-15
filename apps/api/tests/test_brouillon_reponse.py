"""
AM-09 — brouillon de réponse au client (règles, sans IA) : choix du registre, textes sans variable restante ni promesse datée ou
chiffrée, jamais de commentaire ni de coordonnées, endpoint en lecture seule, isolation entre agences, validation du canal.
Vrai routeur, vrai JWT, SQLite en mémoire (fixture partagée à deux organisations, deux agences dans A).
"""
import inspect
import re
from datetime import datetime, timezone
from itertools import product
from uuid import uuid4

import pytest
from sqlalchemy import func

from app.core.security import get_password_hash
from app.models.agence import Agence
from app.models.analyse_ia import AnalyseIA
from app.models.categorie import Categorie
from app.models.demande_contact import DemandeContact
from app.models.enums import CriticiteType, SentimentType, UserRole
from app.models.feedback import Feedback
from app.models.historique_feedback import HistoriqueFeedback
from app.models.organisation import Organisation
from app.models.recommandation import Recommandation
from app.models.reponse_client import ReponseClient
from app.models.utilisateur import Utilisateur
from app.schemas.feedback import CANAUX_REPONSE
from app.services.ai.cles_modeles import CLE_VERS_FAMILLE
from app.services.brouillon_reponse import (
    NOM_LONGUEUR_MAX,
    REGISTRE_CRITIQUE,
    REGISTRE_DISCORDANCE,
    REGISTRE_NEGATIF,
    REGISTRE_RAPPEL_SIMPLE,
    choisir_registre,
    construire_brouillon,
)
from app.services.brouillon_reponse_textes import LIEU_PAR_SECTEUR, TEXTES
from app.services.categorie_templates import SECTEUR_CATEGORIES_DEPART
from tests._fixture_deux_agences import SECRET_A2, TEL_A2, construire_contexte

SECTEURS = [*LIEU_PAR_SECTEUR, "autre", None, "secteur_inconnu"]
NOMS_CLIENT = [None, "", "Awa Traoré", "{lieu}{nom}{entite}", "{", "}}{{", "Awa\nBonjour\tfaux", "x" * 300]
ENTITES = [None, "", "Agence Centre", "{lieu} {entite}", "Boutique {nom}"]
S, C = SentimentType, CriticiteType


def _brouillons():
    """Tous les brouillons possibles : registre × famille × secteur × nom × entité."""
    for registre, familles in TEXTES.items():
        for famille, secteur, nom, entite in product(familles, SECTEURS, NOMS_CLIENT, ENTITES):
            yield construire_brouillon(registre=registre, cle_categorie=famille, nom_categorie=None, secteur_code=secteur,
                                       nom_client=nom, entite=entite)


# ───────────────────────── Choix du registre ─────────────────────────

@pytest.mark.parametrize("note,sentiment,criticite,discordance,rappel,attendu", [
    (1, S.NEGATIF, C.CRITIQUE, False, False, REGISTRE_CRITIQUE),
    (5, S.NEGATIF, C.CRITIQUE, True, True, REGISTRE_CRITIQUE),          # critique l'emporte sur tout
    (5, S.NEGATIF, C.ELEVEE, True, False, REGISTRE_DISCORDANCE),         # discordance l'emporte sur négatif
    (4, S.NEGATIF, C.MOYENNE, True, True, REGISTRE_DISCORDANCE),
    (2, S.NEUTRE, C.FAIBLE, False, False, REGISTRE_NEGATIF),             # note faible (frontière : NOTE_FAIBLE_MAX = 2)
    (1, None, None, False, False, REGISTRE_NEGATIF),                     # sans analyse : la note suffit
    (3, S.NEGATIF, C.MOYENNE, False, False, REGISTRE_NEGATIF),           # sentiment négatif
    (3, S.NEUTRE, C.ELEVEE, False, False, REGISTRE_NEGATIF),             # criticité élevée
    (5, S.POSITIF, C.FAIBLE, False, True, REGISTRE_RAPPEL_SIMPLE),       # rappel demandé, rien de négatif
    (3, None, None, False, True, REGISTRE_RAPPEL_SIMPLE),
    (3, S.NEUTRE, C.MOYENNE, False, False, None),                        # pas de suivi : ni note faible, ni négatif, ni rappel
    (3, None, None, False, False, None),                                 # frontière haute : 3 n'est pas une note faible
    (5, S.POSITIF, C.FAIBLE, False, False, None),
])
def test_choix_du_registre(note, sentiment, criticite, discordance, rappel, attendu):
    assert choisir_registre(note=note, sentiment=sentiment, criticite=criticite, discordance=discordance,
                            souhaite_etre_rappele=rappel) == attendu


# ───────────────────────── Textes ─────────────────────────

def test_aucune_variable_ne_reste_dans_aucun_brouillon():
    """Quels que soient le registre, le thème, le secteur, le nom du client et l'entité : aucune accolade dans le texte final."""
    total = 0
    for b in _brouillons():
        total += 1
        assert "{" not in b.texte and "}" not in b.texte, (b.registre, b.famille, b.texte)
    assert total > 1000


def test_chaque_theme_de_depart_de_chaque_secteur_donne_un_brouillon_dans_chaque_registre():
    for registre, (secteur, gabarits) in product(TEXTES, SECTEUR_CATEGORIES_DEPART.items()):
        for g in gabarits:
            b = construire_brouillon(registre=registre, cle_categorie=g.cle, nom_categorie=g.libelle, secteur_code=secteur,
                                     nom_client=None, entite=None)
            assert b.famille in TEXTES[registre] and "{" not in b.texte, (registre, secteur, g.cle)
    for cle, famille in CLE_VERS_FAMILLE.items():
        assert construire_brouillon(registre="negatif", cle_categorie=cle, nom_categorie=None, secteur_code=None,
                                    nom_client=None, entite=None).famille in TEXTES["negatif"]


def test_chaque_registre_a_un_texte_de_repli_autre_et_les_trois_registres_negatifs_ont_les_memes_familles():
    assert all("autre" in familles for familles in TEXTES.values())
    assert set(TEXTES["critique"]) == set(TEXTES["discordance"]) == set(TEXTES["negatif"])
    assert set(TEXTES) == {REGISTRE_CRITIQUE, REGISTRE_DISCORDANCE, REGISTRE_NEGATIF, REGISTRE_RAPPEL_SIMPLE}


def test_les_textes_bruts_n_utilisent_que_la_variable_lieu():
    for registre, familles in TEXTES.items():
        for famille, texte in familles.items():
            sans_lieu = texte.replace("{lieu}", "")
            assert "{" not in sans_lieu and "}" not in sans_lieu, (registre, famille)


INTERDIT_PROMESSE = re.compile(
    r"\d|\b(heures?|jours?|semaines?|mois|minutes?|demain|aujourd|ce soir|imm[ée]diat\w*|sous|d'ici|avant le|au plus tard)\b", re.IGNORECASE)


def test_aucune_promesse_datee_ou_chiffree_dans_les_textes():
    for registre, familles in TEXTES.items():
        for famille, texte in familles.items():
            assert not INTERDIT_PROMESSE.search(texte), (registre, famille, INTERDIT_PROMESSE.search(texte).group(0))


def test_les_brouillons_ne_contiennent_ni_coordonnee_ni_lien():
    for b in _brouillons():
        assert not re.search(r"@|https?:|www\.", b.texte), b.texte


def test_les_formules_acceptees_sont_presentes():
    assert all("reviendrons vers vous" in TEXTES[r]["autre"] for r in ("critique", "negatif", "rappel_simple"))


def test_le_vocabulaire_du_secteur_est_utilise():
    textes = {
        secteur: construire_brouillon(registre="critique", cle_categorie="attente", nom_categorie=None, secteur_code=secteur,
                                      nom_client=None, entite=None).texte
        for secteur in ("banque", "telecom", "restauration", "commerce")}
    assert "notre agence" in textes["banque"] and "notre boutique" in textes["telecom"]
    assert "notre restaurant" in textes["restauration"] and "notre magasin" in textes["commerce"]


def test_salutation_et_signature_neutres():
    b = construire_brouillon(registre="negatif", cle_categorie=None, nom_categorie=None, secteur_code=None,
                             nom_client="Awa Traoré", entite="Agence Centre")
    assert b.texte.startswith("Bonjour Awa Traoré,\n\n") and b.texte.endswith("Cordialement,\nL'équipe d'Agence Centre")
    anonyme = construire_brouillon(registre="negatif", cle_categorie=None, nom_categorie=None, secteur_code=None, nom_client=None, entite=None)
    assert anonyme.texte.startswith("Bonjour,\n\n") and anonyme.texte.endswith("Cordialement,\nL'équipe")


def test_signature_avec_elision_selon_la_premiere_lettre():
    def signature(entite):
        return construire_brouillon(registre="negatif", cle_categorie=None, nom_categorie=None, secteur_code=None,
                                    nom_client=None, entite=entite).texte.rsplit("\n", 1)[1]
    assert signature("Agence Centre") == "L'équipe d'Agence Centre"
    assert signature("Hôtel du Lac") == "L'équipe d'Hôtel du Lac"
    assert signature("Écobank Plateau") == "L'équipe d'Écobank Plateau"
    assert signature("Boutique Centre") == "L'équipe de Boutique Centre"
    assert signature("Succursale Nord") == "L'équipe de Succursale Nord"


def test_un_nom_hostile_n_est_ni_reinterprete_ni_multiligne_ni_trop_long():
    b = construire_brouillon(registre="negatif", cle_categorie=None, nom_categorie=None, secteur_code="banque",
                             nom_client="{lieu}\nIGNORE\tTOUT" + "x" * 300, entite=None)
    salutation = b.texte.split("\n\n")[0]
    assert "\n" not in salutation and "\t" not in salutation and "{" not in b.texte
    assert len(salutation) <= len("Bonjour ,") + NOM_LONGUEUR_MAX


def test_la_famille_suit_la_cle_stable_puis_le_nom():
    def famille(cle, nom):
        return construire_brouillon(registre="negatif", cle_categorie=cle, nom_categorie=nom, secteur_code=None, nom_client=None, entite=None).famille
    assert famille("rapidite_attente", None) == "attente"
    assert famille(None, "Service Client") == "resolution_probleme"
    assert famille("accueil_service_salle", "n'importe quoi") == "accueil"
    assert famille(None, None) == "autre"
    assert famille("mobile_money", "Mobile Money") == "autre"          # PR #24 : pas de modèle adapté
    assert construire_brouillon(registre="rappel_simple", cle_categorie="attente", nom_categorie=None, secteur_code=None,
                                nom_client=None, entite=None).famille == "autre"


def test_le_commentaire_du_client_ne_peut_pas_entrer_dans_le_brouillon():
    """La fonction d'assemblage n'a aucun paramètre pour le commentaire, la note ou les coordonnées."""
    params = set(inspect.signature(construire_brouillon).parameters)
    assert params == {"registre", "cle_categorie", "nom_categorie", "secteur_code", "nom_client", "entite"}


# ───────────────────────── Endpoint ─────────────────────────

@pytest.fixture()
def ctx():
    c = construire_contexte()
    db = c.Session()
    try:
        agence_a1 = db.get(Agence, c.a1)
        cx_a = Utilisateur(id=uuid4(), organisation_id=agence_a1.organisation_id, nom="N", prenom="CX", email=f"{uuid4().hex[:8]}@t.io",
                           mot_de_passe_hash=get_password_hash("Motdepasse-123"), role=UserRole.CX_MANAGER, active=True)
        autre_org = Organisation(id=uuid4(), nom="Client C", active=True)
        db.add_all([cx_a, autre_org]); db.flush()
        cx_c = Utilisateur(id=uuid4(), organisation_id=autre_org.id, nom="N", prenom="CXC", email=f"{uuid4().hex[:8]}@t.io",
                           mot_de_passe_hash=get_password_hash("Motdepasse-123"), role=UserRole.CX_MANAGER, active=True)
        db.add(cx_c)
        db.commit()
        c.cx_a, c.cx_c = cx_a.id, cx_c.id
    finally:
        db.close()
    return c


def brouillon(ctx, fb, user):
    return ctx.client.get(f"/feedbacks/{fb}/brouillon-reponse", headers=ctx.H(user))


def creer_avis(ctx, *, note, sentiment=None, criticite=None, discordance=False, rappel=None, traitee=False, tel=None, email=None,
               nom="Awa", categorie=None, agence=None):
    """Avis de l'agence A1 (ou `agence`). `sentiment=None` = avis sans analyse. `rappel=None` = pas de demande de contact."""
    from app.models.qr_code import QRCode
    db = ctx.Session()
    try:
        qr = db.query(QRCode).filter(QRCode.agence_id == (agence or ctx.a1)).first()
        cat = None
        if categorie:
            cat = Categorie(id=uuid4(), agence_id=qr.agence_id, nom=categorie[1], cle=categorie[0])
            db.add(cat); db.flush()
        fb = Feedback(id=uuid4(), qr_code_id=qr.id, categorie_id=cat.id if cat else None, note=note,
                      commentaire="COMMENTAIRE-SECRET-DU-CLIENT", statut_traitement="nouveau", date_soumission=datetime.now(timezone.utc))
        db.add(fb); db.flush()
        if sentiment is not None:
            db.add(AnalyseIA(id=uuid4(), feedback_id=fb.id, sentiment=sentiment, criticite=criticite or CriticiteType.FAIBLE,
                             discordance_detectee=discordance, theme_principal="x"))
        if rappel is not None:
            db.add(DemandeContact(id=uuid4(), feedback_id=fb.id, nom=nom, telephone=tel, email=email, souhaite_etre_rappele=rappel,
                                  traitee=traitee))
        db.commit()
        return fb.id
    finally:
        db.close()


def compter(ctx):
    db = ctx.Session()
    try:
        return tuple(db.query(func.count()).select_from(m).scalar() for m in
                     (AnalyseIA, Recommandation, ReponseClient, HistoriqueFeedback, DemandeContact, Feedback, Categorie)) + (
            db.query(func.count()).select_from(DemandeContact).filter(DemandeContact.traitee.is_(True)).scalar(),)
    finally:
        db.close()


def test_un_gestionnaire_recoit_le_brouillon_de_son_agence(ctx):
    r = brouillon(ctx, ctx.fb_a1, ctx.am_a1)
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    d = r.json()
    assert d["disponible"] is True and d["registre"] == "critique" and d["raison"] is None
    assert d["texte"].startswith("Bonjour,") and "Agence A1" in d["texte"] and d["canal_suggere"] == "autre"


def test_le_brouillon_utilise_nom_client_secteur_famille_et_canal(ctx):
    db = ctx.Session()
    org = db.get(Agence, ctx.a1).organisation
    org.secteur_code = "restauration"
    db.commit(); db.close()
    fb = creer_avis(ctx, note=1, sentiment=S.NEGATIF, criticite=C.ELEVEE, rappel=True, tel="0600000000", nom="Awa Traoré",
                    categorie=("rapidite_attente", "Rapidité / Attente"))
    d = brouillon(ctx, fb, ctx.am_a1).json()
    assert d["registre"] == "negatif" and d["canal_suggere"] == "telephone"
    assert d["texte"].startswith("Bonjour Awa Traoré,") and "notre restaurant" in d["texte"] and "l'attente" in d["texte"]
    assert "0600000000" not in str(d)


def test_canal_propose_selon_la_coordonnee_jamais_la_coordonnee(ctx):
    mail = creer_avis(ctx, note=1, rappel=True, email="awa@example.com")
    traitee = creer_avis(ctx, note=1, rappel=True, tel="0600000000", traitee=True)
    sans = creer_avis(ctx, note=1, rappel=False)
    assert brouillon(ctx, mail, ctx.am_a1).json()["canal_suggere"] == "email"
    assert brouillon(ctx, traitee, ctx.am_a1).json()["canal_suggere"] == "autre"      # coordonnées masquées une fois traitée
    assert brouillon(ctx, sans, ctx.am_a1).json()["canal_suggere"] == "autre"
    assert "awa@example.com" not in brouillon(ctx, mail, ctx.am_a1).text


@pytest.mark.parametrize("kw,registre", [
    (dict(note=5, sentiment=S.NEGATIF, criticite=C.MOYENNE, discordance=True), "discordance"),
    (dict(note=2, sentiment=S.NEUTRE), "negatif"),
    (dict(note=5, sentiment=S.POSITIF, rappel=True), "rappel_simple"),
    (dict(note=1), "negatif"),                                    # sans analyse
])
def test_registres_via_l_endpoint(ctx, kw, registre):
    d = brouillon(ctx, creer_avis(ctx, **kw), ctx.am_a1).json()
    assert d["disponible"] is True and d["registre"] == registre


@pytest.mark.parametrize("kw", [dict(note=5, sentiment=S.POSITIF), dict(note=3, sentiment=S.NEUTRE, criticite=C.MOYENNE),
                                dict(note=5, sentiment=S.POSITIF, rappel=False), dict(note=4)])
def test_avis_sans_suivi_pas_de_brouillon(ctx, kw):
    d = brouillon(ctx, creer_avis(ctx, **kw), ctx.am_a1).json()
    assert d == {"disponible": False, "raison": "aucun_suivi", "registre": None, "texte": None, "canal_suggere": None}


def test_brouillon_masque_des_qu_une_reponse_existe(ctx):
    assert brouillon(ctx, ctx.fb_a1, ctx.am_a1).json()["disponible"] is True
    ok = ctx.client.post(f"/feedbacks/{ctx.fb_a1}/reponses-client", headers=ctx.H(ctx.am_a1), json={"contenu": "Bonjour", "canal": "autre"})
    assert ok.status_code == 200
    d = brouillon(ctx, ctx.fb_a1, ctx.am_a1).json()
    assert d["disponible"] is False and d["raison"] == "reponse_existante" and d["texte"] is None


def test_l_endpoint_est_en_lecture_seule_et_ne_declenche_pas_l_analyse(ctx):
    sans_analyse = creer_avis(ctx, note=1, rappel=True, tel="0600000000")
    avant = compter(ctx)
    for fb in (ctx.fb_a1, sans_analyse):
        assert brouillon(ctx, fb, ctx.am_a1).status_code == 200
    assert compter(ctx) == avant, "aucune ligne créée ni modifiée (analyse, recommandation, réponse, historique, traitement)"


def test_le_corps_de_la_reponse_ne_contient_ni_commentaire_ni_coordonnees(ctx):
    for fb, user in ((ctx.fb_a2, ctx.am_a2), (ctx.fb_a1, ctx.am_a1)):
        corps = brouillon(ctx, fb, user).text
        assert SECRET_A2 not in corps and TEL_A2 not in corps and "a2@example.com" not in corps and "COMMENTAIRE" not in corps
    assert "Bonjour Client A2," in brouillon(ctx, ctx.fb_a2, ctx.am_a2).json()["texte"]


def test_isolation_entre_agences_et_organisations(ctx):
    refus = [(ctx.fb_a2, ctx.am_a1), (ctx.fb_a1, ctx.am_a2), (ctx.fb_a1, ctx.am_b1), (ctx.fb_a2, ctx.am_b1), (ctx.fb_a1, ctx.cx_c)]
    for fb, user in refus:
        r = brouillon(ctx, fb, user)
        assert r.status_code == 403, (fb, user)
        assert SECRET_A2 not in r.text and TEL_A2 not in r.text and "Bonjour" not in r.text
    # cas positifs : sa propre agence, et le CX de l'organisation voit les deux agences
    assert brouillon(ctx, ctx.fb_a1, ctx.am_a1).status_code == 200
    assert brouillon(ctx, ctx.fb_a2, ctx.am_a2).status_code == 200
    assert brouillon(ctx, ctx.fb_a1, ctx.cx_a).status_code == 200 and brouillon(ctx, ctx.fb_a2, ctx.cx_a).status_code == 200


def test_authentification_requise_et_avis_inconnu(ctx):
    assert ctx.client.get(f"/feedbacks/{ctx.fb_a1}/brouillon-reponse").status_code == 401
    assert brouillon(ctx, uuid4(), ctx.am_a1).status_code == 404


# ───────────────────────── Validation du canal ─────────────────────────

def poster(ctx, canal, fb=None):
    corps = {"contenu": "Réponse"} if canal is ... else {"contenu": "Réponse", "canal": canal}
    return ctx.client.post(f"/feedbacks/{fb or ctx.fb_a1}/reponses-client", headers=ctx.H(ctx.am_a1), json=corps)


@pytest.mark.parametrize("canal", CANAUX_REPONSE)
def test_les_canaux_connus_sont_acceptes(ctx, canal):
    r = poster(ctx, canal)
    assert r.status_code == 200 and r.json()[-1]["canal"] == canal


def test_canal_normalise_et_defaut(ctx):
    assert poster(ctx, " WhatsApp ").json()[-1]["canal"] == "whatsapp"
    assert poster(ctx, ...).json()[-1]["canal"] == "telephone"


@pytest.mark.parametrize("canal", ["fax", "", "   ", "pigeon", "telephone; DROP TABLE", "a" * 51, "a" * 5000, 123, None])
def test_canaux_invalides_refuses_sans_rien_enregistrer(ctx, canal):
    avant = compter(ctx)
    assert poster(ctx, canal).status_code == 422
    assert compter(ctx) == avant


def test_la_limite_de_50_caracteres_est_verifiee_avant_la_liste():
    from pydantic import ValidationError
    from app.schemas.feedback import ReponseClientCreate
    with pytest.raises(ValidationError) as e:
        ReponseClientCreate(contenu="x", canal="a" * 51)
    assert "50" in str(e.value)
