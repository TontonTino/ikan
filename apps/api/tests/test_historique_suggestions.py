"""
AM-08 — historique des suggestions : lecture, périmètre, contrôle des transitions, commentaire.
Vrai routeur, vrai JWT, SQLite en mémoire (fixture partagée : 2 organisations, agences A1 et A2 dans A, B1 dans B). Inclut les
suggestions envoyées SANS avis (PR #15, suggestions_scope.py) et des suggestions liées à un avis dont le client a laissé ses coordonnées.
"""
import logging
from datetime import datetime, timezone
from uuid import uuid4

import pytest

from app.core.security import create_access_token, get_password_hash
from app.models.agence import Agence
from app.models.enums import IdeaStatus, UserRole
from app.models.suggestion import HistoriqueSuggestion, Suggestion
from app.models.utilisateur import Utilisateur
from tests._fixture_deux_agences import SECRET_A2, TEL_A2, construire_contexte

REFUS = {403, 404}


@pytest.fixture()
def ctx():
    c = construire_contexte()
    db = c.Session()
    try:
        organisation_a = db.get(Agence, c.a1).organisation_id
        organisation_b = db.get(Agence, c.b1).organisation_id

        def utilisateur(role, organisation, prenom):
            u = Utilisateur(id=uuid4(), organisation_id=organisation, nom="Nom", prenom=prenom, email=f"{uuid4().hex[:8]}@t.io",
                            mot_de_passe_hash=get_password_hash("Motdepasse-123"), role=role, active=True)
            db.add(u)
            return u.id

        c.cx_a = utilisateur(UserRole.CX_MANAGER, organisation_a, "CxA")
        c.cx_b = utilisateur(UserRole.CX_MANAGER, organisation_b, "CxB")
        c.admin = utilisateur(UserRole.ADMIN, organisation_a, "Admin")
        # Suggestions : liée à un avis (A1), SANS avis (A1), liée à un avis dont le client a laissé ses coordonnées (A2), sans avis (B1)
        c.s_a1 = _suggestion(db, feedback_id=c.fb_a1, contenu="idée A1 avec avis")
        c.s_a1_seule = _suggestion(db, agence_id=c.a1, contenu="idée A1 sans avis")
        c.s_a2 = _suggestion(db, feedback_id=c.fb_a2, contenu="idée A2 avec avis")
        c.s_b1 = _suggestion(db, agence_id=c.b1, contenu="IDEE-SECRETE-B1")
        db.commit()
    finally:
        db.close()
    return c


def _suggestion(db, *, contenu, feedback_id=None, agence_id=None, statut=IdeaStatus.NOUVEAU):
    s = Suggestion(id=uuid4(), feedback_id=feedback_id, agence_id=agence_id, contenu=contenu, statut=statut)
    db.add(s)
    return s.id


def creer(ctx, statut, agence=None):
    db = ctx.Session()
    try:
        sid = _suggestion(db, agence_id=agence or ctx.a1, contenu="idée", statut=statut)
        db.commit()
        return sid
    finally:
        db.close()


def changer(ctx, acteur, sid, statut, commentaire=None, **extra):
    corps = {"statut": statut, **({"commentaire": commentaire} if commentaire is not None else {}), **extra}
    jeton = acteur if not isinstance(acteur, str) else getattr(ctx, acteur)
    return ctx.client.patch(f"/suggestions/{sid}/statut", headers=ctx.H(jeton), json=corps)


def historique(ctx, acteur, sid):
    jeton = acteur if not isinstance(acteur, str) else getattr(ctx, acteur)
    return ctx.client.get(f"/suggestions/{sid}/historique", headers=ctx.H(jeton))


def etat_en_base(ctx, sid):
    db = ctx.Session()
    try:
        s = db.get(Suggestion, sid)
        return s.statut, s.date_traitement, db.query(HistoriqueSuggestion).filter(HistoriqueSuggestion.suggestion_id == sid).count()
    finally:
        db.close()


# ═════════════════════════ historique : complet, ordonné, auteur et commentaire ═════════════════════════

def test_historique_complet_ordonne_avec_auteur_role_et_commentaire(ctx):
    for statut, commentaire in (("en_cours", "à étudier avec le siège"), ("traite", "mis en place"), ("en_cours", "rouverte, ça ne marche pas"), ("rejete", None)):
        assert changer(ctx, "am_a1", ctx.s_a1, statut, commentaire).status_code == 200
    r = historique(ctx, "am_a1", ctx.s_a1)
    assert r.status_code == 200
    entrees = r.json()
    assert [(e["ancien_statut"], e["nouveau_statut"]) for e in entrees] == [
        ("nouveau", "en_cours"), ("en_cours", "traite"), ("traite", "en_cours"), ("en_cours", "rejete")]
    assert [e["commentaire"] for e in entrees] == ["à étudier avec le siège", "mis en place", "rouverte, ça ne marche pas", None]
    dates = [e["date"] for e in entrees]
    assert dates == sorted(dates) and len(set(dates)) == 4                      # ordre chronologique strict
    assert {e["auteur_nom"] for e in entrees} == {"P N"} and {e["auteur_role"] for e in entrees} == {"agency_manager"}
    assert set(entrees[0]) == {"id", "ancien_statut", "nouveau_statut", "date", "auteur_nom", "auteur_role", "commentaire"}


def test_historique_vide_pour_une_suggestion_jamais_modifiee(ctx):
    r = historique(ctx, "am_a1", ctx.s_a1)
    assert r.status_code == 200 and r.json() == []


def test_l_auteur_est_celui_qui_a_fait_le_changement_quel_que_soit_son_role(ctx):
    changer(ctx, "am_a1", ctx.s_a1, "en_cours")
    changer(ctx, ctx.cx_a, ctx.s_a1, "traite", "validé par le siège")
    entrees = historique(ctx, ctx.cx_a, ctx.s_a1).json()
    assert [(e["auteur_nom"], e["auteur_role"]) for e in entrees] == [("P N", "agency_manager"), ("CxA Nom", "cx_manager")]


def test_dernier_changement_dans_la_liste_et_le_detail_champ_additif(ctx):
    changer(ctx, "am_a1", ctx.s_a1, "en_cours")
    changer(ctx, "am_a1", ctx.s_a1, "traite", "fait")
    liste = {s["id"]: s for s in ctx.client.get("/suggestions/", headers=ctx.H(ctx.am_a1)).json()}
    modifiee, intacte = liste[str(ctx.s_a1)], liste[str(ctx.s_a1_seule)]
    assert modifiee["dernier_changement"]["nouveau_statut"] == "traite" and modifiee["dernier_changement"]["commentaire"] == "fait"
    assert modifiee["dernier_changement"]["auteur_nom"] == "P N"
    assert intacte["dernier_changement"] is None
    assert {"id", "feedback_id", "agence_id", "contenu", "statut", "date_soumission", "date_traitement", "notes_internes"} <= set(modifiee)  # existant
    detail = ctx.client.get(f"/suggestions/{ctx.s_a1}", headers=ctx.H(ctx.am_a1)).json()
    assert detail["dernier_changement"]["nouveau_statut"] == "traite"


# ═════════════════════════ transitions ═════════════════════════

AUTORISEES = [
    ("nouveau", "en_cours"), ("nouveau", "traite"), ("nouveau", "rejete"), ("en_cours", "traite"), ("en_cours", "rejete"),
    ("traite", "en_cours"), ("rejete", "en_cours"), ("traite", "rejete"), ("rejete", "traite"),
]
INTERDITES = [("en_cours", "nouveau"), ("traite", "nouveau"), ("rejete", "nouveau")]


@pytest.mark.parametrize("de,vers", AUTORISEES)
def test_transitions_autorisees_creent_une_entree(ctx, de, vers):
    sid = creer(ctx, IdeaStatus(de))
    r = changer(ctx, "am_a1", sid, vers, "motif")
    assert r.status_code == 200 and r.json()["statut"] == vers
    assert r.json()["dernier_changement"]["ancien_statut"] == de and r.json()["dernier_changement"]["nouveau_statut"] == vers
    assert etat_en_base(ctx, sid)[0] == IdeaStatus(vers) and etat_en_base(ctx, sid)[2] == 1


@pytest.mark.parametrize("de,vers", INTERDITES)
def test_retour_a_nouveau_est_refuse_en_409_sans_rien_changer(ctx, de, vers):
    sid = creer(ctx, IdeaStatus(de))
    avant = etat_en_base(ctx, sid)
    r = changer(ctx, "am_a1", sid, vers, "tentative")
    assert r.status_code == 409
    assert "ne peut pas revenir au statut « Nouveau »" in r.json()["detail"] and "En cours" in r.json()["detail"]
    assert etat_en_base(ctx, sid) == avant


@pytest.mark.parametrize("statut", ["nouveau", "en_cours", "traite", "rejete"])
def test_meme_statut_ne_cree_aucune_entree(ctx, statut):
    sid = creer(ctx, IdeaStatus(statut))
    avant = etat_en_base(ctx, sid)
    r = changer(ctx, "am_a1", sid, statut, "rien ne change")
    assert r.status_code == 200 and r.json()["statut"] == statut
    assert etat_en_base(ctx, sid) == avant                                      # statut, date de traitement et nombre d'entrées intacts
    assert historique(ctx, "am_a1", sid).json() == []


def test_la_date_de_traitement_suit_le_statut(ctx):
    sid = creer(ctx, IdeaStatus.NOUVEAU)
    changer(ctx, "am_a1", sid, "traite")
    assert etat_en_base(ctx, sid)[1] is not None
    changer(ctx, "am_a1", sid, "en_cours")                                      # rouverte : plus « traitée »
    assert etat_en_base(ctx, sid)[1] is None
    changer(ctx, "am_a1", sid, "rejete")
    assert etat_en_base(ctx, sid)[1] is not None
    assert len(historique(ctx, "am_a1", sid).json()) == 3                       # la date de traitement d'origine reste lisible ici


def test_les_notes_internes_restent_enregistrees_sur_un_meme_statut(ctx):
    sid = creer(ctx, IdeaStatus.EN_COURS)
    r = changer(ctx, "am_a1", sid, "en_cours", notes_internes="à revoir lundi")
    assert r.status_code == 200 and r.json()["notes_internes"] == "à revoir lundi" and etat_en_base(ctx, sid)[2] == 0
    assert changer(ctx, "am_a1", sid, "en_cours", notes_internes="x" * 1001).status_code == 422


# ═════════════════════════ commentaire ═════════════════════════

def test_commentaire_longueur_maximale_et_caracteres_de_controle(ctx):
    sid = creer(ctx, IdeaStatus.NOUVEAU)
    assert changer(ctx, "am_a1", sid, "en_cours", "x" * 501).status_code == 422
    assert changer(ctx, "am_a1", sid, "en_cours", "ok\x07cloche").status_code == 422
    assert changer(ctx, "am_a1", sid, "en_cours", "null\x00ici").status_code == 422
    assert etat_en_base(ctx, sid)[0] == IdeaStatus.NOUVEAU and etat_en_base(ctx, sid)[2] == 0     # rien d'enregistré
    assert changer(ctx, "am_a1", sid, "en_cours", "x" * 500).status_code == 200                # la limite elle-même passe


def test_commentaire_multiligne_nettoye_et_vide_ignore(ctx):
    a, b = creer(ctx, IdeaStatus.NOUVEAU), creer(ctx, IdeaStatus.NOUVEAU)
    changer(ctx, "am_a1", a, "en_cours", "  ligne 1\r\nligne 2\tfin  ")
    changer(ctx, "am_a1", b, "en_cours", "   ")
    assert historique(ctx, "am_a1", a).json()[0]["commentaire"] == "ligne 1\nligne 2\tfin"
    assert historique(ctx, "am_a1", b).json()[0]["commentaire"] is None


def test_le_commentaire_est_bien_enregistre_en_base(ctx):
    sid = creer(ctx, IdeaStatus.NOUVEAU)
    changer(ctx, "am_a1", sid, "en_cours", "décision du comité")
    db = ctx.Session()
    try:
        (entree,) = db.query(HistoriqueSuggestion).filter(HistoriqueSuggestion.suggestion_id == sid).all()
        assert entree.commentaire == "décision du comité" and entree.utilisateur_id == ctx.am_a1
    finally:
        db.close()


def test_le_texte_du_commentaire_n_est_jamais_journalise(ctx, caplog):
    caplog.set_level(logging.DEBUG)
    sid = creer(ctx, IdeaStatus.TRAITE)
    secret = "COMMENTAIRE-CONFIDENTIEL-731"
    changer(ctx, "am_a1", sid, "nouveau", secret)            # 409
    changer(ctx, "am_a1", sid, "en_cours", secret + "x" * 600)  # 422
    changer(ctx, "am_a1", sid, "en_cours", secret)           # 200
    changer(ctx, "am_a2", sid, "rejete", secret)             # 403 (journal des accès refusés)
    historique(ctx, "am_a1", sid)
    cote_serveur = " | ".join(r.getMessage() for r in caplog.records if not r.name.startswith(("httpx", "httpcore")))
    assert secret not in cote_serveur
    assert any(r.name == "ikan.security.access_denied" for r in caplog.records)


def test_les_coordonnees_saisies_dans_un_commentaire_sont_masquees_a_la_sortie(ctx):
    sid = creer(ctx, IdeaStatus.NOUVEAU)
    changer(ctx, "am_a1", sid, "en_cours", "rappeler le client au 06 12 34 56 78 ou awa@example.com")
    texte = historique(ctx, "am_a1", sid).text
    assert "06 12 34 56 78" not in texte and "awa@example.com" not in texte
    assert "[téléphone masqué]" in texte and "[e-mail masqué]" in texte


# ═════════════════════════ périmètre (refus jumelés à leur cas positif) ═════════════════════════

def test_historique_dans_le_perimetre_agence_avec_et_sans_avis(ctx):
    changer(ctx, "am_a1", ctx.s_a1, "en_cours")
    changer(ctx, "am_a1", ctx.s_a1_seule, "en_cours")             # suggestion SANS avis (PR #15)
    for sid in (ctx.s_a1, ctx.s_a1_seule):
        r = historique(ctx, "am_a1", sid)
        assert r.status_code == 200 and len(r.json()) == 1
        assert historique(ctx, ctx.cx_a, sid).status_code == 200  # le CX de la même organisation la voit aussi


@pytest.mark.parametrize("acteur,cible", [
    ("am_a1", "s_a2"),        # autre agence, même organisation (suggestion liée à un avis)
    ("am_a1", "s_b1"),        # autre organisation (suggestion sans avis)
    ("am_a2", "s_a1_seule"),  # suggestion sans avis d'une autre agence
    ("am_b1", "s_a1"),
    ("cx_b", "s_a1"),         # CX d'une autre organisation
    ("cx_b", "s_a1_seule"),
    ("admin", "s_a1"),        # l'administrateur n'a aucun accès aux données clients
])
def test_historique_et_changement_refuses_hors_perimetre(ctx, acteur, cible):
    sid = getattr(ctx, cible)
    jeton = getattr(ctx, acteur)
    avant = etat_en_base(ctx, sid)
    r = historique(ctx, jeton, sid)
    assert r.status_code in REFUS
    for secret in ("IDEE-SECRETE-B1", "idée A1", "idée A2", SECRET_A2):
        assert secret not in r.text
    r = changer(ctx, jeton, sid, "en_cours", "intrusion")
    assert r.status_code in REFUS
    assert etat_en_base(ctx, sid) == avant                        # ni statut, ni entrée d'historique


def test_cas_positifs_jumeles_aux_refus(ctx):
    """Chaque acteur refusé ci-dessus accède bien à SES suggestions."""
    for acteur, sid in (("am_a1", ctx.s_a1), ("am_a2", ctx.s_a2), ("am_b1", ctx.s_b1), (ctx.cx_a, ctx.s_a2), (ctx.cx_b, ctx.s_b1)):
        jeton = getattr(ctx, acteur) if isinstance(acteur, str) else acteur
        assert changer(ctx, jeton, sid, "en_cours").status_code == 200
        assert len(historique(ctx, jeton, sid).json()) == 1


def test_suggestion_inconnue_et_sans_authentification(ctx):
    assert historique(ctx, "am_a1", uuid4()).status_code == 404
    assert ctx.client.get(f"/suggestions/{ctx.s_a1}/historique").status_code == 401


# ═════════════════════════ aucune coordonnée ═════════════════════════

def test_aucune_coordonnee_du_client_dans_l_historique_ni_la_liste_ni_le_changement(ctx):
    """s_a2 est liée à l'avis fb_a2 dont le client a laissé nom, téléphone et e-mail (demande de contact)."""
    r = changer(ctx, "am_a2", ctx.s_a2, "en_cours", "à suivre")
    assert r.status_code == 200
    reponses = [r.text, historique(ctx, "am_a2", ctx.s_a2).text, ctx.client.get("/suggestions/", headers=ctx.H(ctx.am_a2)).text,
                ctx.client.get(f"/suggestions/{ctx.s_a2}", headers=ctx.H(ctx.am_a2)).text]
    for texte in reponses:
        for interdit in (TEL_A2, "a2@example.com", "Client A2", "telephone", "email"):
            assert interdit not in texte, interdit
    entree = historique(ctx, "am_a2", ctx.s_a2).json()[0]
    assert "utilisateur_id" not in entree and "mot_de_passe" not in str(entree)    # pas non plus d'identifiant d'utilisateur
