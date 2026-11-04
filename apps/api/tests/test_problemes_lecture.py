"""
Lecture enrichie de `GET /issues/` (PR 4/10), SQLite en mémoire (le plan d'exécution et le volume sont dans test_problemes_lecture_postgres.py) :
 - champs ADDITIFS : nb_avis, nb_actions, nb_actions_a_faire, prochaine_echeance, en_retard (aucun champ existant ne change) ;
 - filtres serveur : en_retard, date_debut, date_fin ; pagination et bornes ;
 - portée par rôle inchangée (CX : son organisation ; Agency Manager : son agence) et jamais de fuite d'une autre organisation ;
 - aucun chiffre inventé : en_retard est null sans délai ou si le problème est résolu ; une action annulée ne compte pas « à faire ».
"""
import os
from datetime import datetime, timedelta, timezone
from uuid import uuid4

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-lecture-problemes-0123456789")

import pytest
from sqlalchemy import event

from app.models.action_corrective import ActionCorrective
from app.models.enums import CriticiteType
from app.models.feedback import Feedback
from app.models.issue import Issue
from app.schemas.issue import IssueResponse

from tests.test_issues import ctx  # noqa: F401  (même jeu de données : deux organisations, deux agences dans la A)

UTC = timezone.utc
MAINTENANT = datetime.now(UTC)
CHAMPS_NOUVEAUX = {"nb_avis", "nb_actions", "nb_actions_a_faire", "prochaine_echeance", "en_retard"}


def _poser(ctx, titre, agence=None, org=None, statut="ouverte", detection=None, sla=None):
    """Insertion directe : maîtrise de premiere_detection, du délai et du statut (l'API ne les fixe pas tous)."""
    db = ctx.Session()
    try:
        i = Issue(id=uuid4(), organisation_id=org or ctx.org_a, agence_id=agence or ctx.agence_a, titre=titre, statut=statut,
                  severite=CriticiteType.MOYENNE, premiere_detection=detection or MAINTENANT, date_limite_sla=sla)
        db.add(i)
        db.commit()
        return i.id
    finally:
        db.close()


def _action(ctx, issue_id, statut="creee", echeance=None, titre="Action"):
    db = ctx.Session()
    try:
        db.add(ActionCorrective(id=uuid4(), issue_id=issue_id, titre=titre, statut=statut, echeance=echeance))
        db.commit()
    finally:
        db.close()


def _avis(ctx, issue_id, n):
    db = ctx.Session()
    try:
        qr = db.get(Feedback, ctx.fb_a).qr_code_id
        for _ in range(n):
            db.add(Feedback(id=uuid4(), qr_code_id=qr, note=2, commentaire="Avis", statut_traitement="nouveau", issue_id=issue_id))
        db.commit()
    finally:
        db.close()


def _liste(ctx, acteur="cx_a", **params):
    r = ctx.call(acteur, "get", "/issues/", params={"limit": 200, **params})
    assert r.status_code == 200, r.text
    return {i["titre"]: i for i in r.json()}, r


# ── Additivité ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

def test_aucun_champ_existant_ne_change_ni_ne_disparait(ctx):
    iid = _poser(ctx, "Problème A")
    ligne = _liste(ctx)[0]["Problème A"]
    detail = ctx.call("cx_a", "get", f"/issues/{iid}").json()
    anciens = set(IssueResponse.model_fields)
    assert anciens <= set(ligne), f"champs disparus : {anciens - set(ligne)}"
    assert set(ligne) - anciens == CHAMPS_NOUVEAUX, "seuls les cinq champs prévus sont ajoutés"
    assert all(ligne[c] == detail[c] for c in anciens), "les champs existants ont la même valeur que dans le détail"


def test_les_autres_routes_ne_renvoient_pas_les_nouveaux_champs(ctx):
    iid = _poser(ctx, "Problème B")
    assert CHAMPS_NOUVEAUX.isdisjoint(ctx.call("cx_a", "get", f"/issues/{iid}").json())
    creee = ctx.call("cx_a", "post", "/issues/", json={"titre": "Problème C", "agence_id": str(ctx.agence_a)})
    assert CHAMPS_NOUVEAUX.isdisjoint(creee.json())


# ── Chiffres calculés à la lecture ────────────────────────────────────────────────────────────────────────────────────────────

def test_compteurs_d_avis_et_d_actions_et_prochaine_echeance(ctx):
    iid = _poser(ctx, "Avec tout")
    _avis(ctx, iid, 2)
    _action(ctx, iid, "creee", MAINTENANT + timedelta(days=5), "Lointaine")
    _action(ctx, iid, "creee", MAINTENANT + timedelta(days=2), "Proche")
    _action(ctx, iid, "terminee", MAINTENANT + timedelta(days=1), "Faite")                 # terminée : ne compte plus « à faire », son échéance est ignorée
    _action(ctx, iid, "annulee", MAINTENANT + timedelta(hours=12), "Annulée")              # annulée : idem
    ligne = _liste(ctx)[0]["Avec tout"]
    assert (ligne["nb_avis"], ligne["nb_actions"], ligne["nb_actions_a_faire"]) == (2, 4, 2)
    assert datetime.fromisoformat(ligne["prochaine_echeance"].replace("Z", "+00:00")).replace(tzinfo=UTC) - (MAINTENANT + timedelta(days=2)) < timedelta(seconds=2)


def test_sans_avis_ni_action_les_zeros_sont_vrais_et_l_echeance_est_nulle(ctx):
    _poser(ctx, "Vide")
    ligne = _liste(ctx)[0]["Vide"]
    assert (ligne["nb_avis"], ligne["nb_actions"], ligne["nb_actions_a_faire"], ligne["prochaine_echeance"]) == (0, 0, 0, None)


def test_prochaine_echeance_est_nulle_si_les_actions_a_faire_n_ont_pas_d_echeance(ctx):
    iid = _poser(ctx, "Sans échéance")
    _action(ctx, iid, "creee", None)
    _action(ctx, iid, "terminee", MAINTENANT + timedelta(days=1))
    ligne = _liste(ctx)[0]["Sans échéance"]
    assert ligne["nb_actions_a_faire"] == 1 and ligne["prochaine_echeance"] is None


def test_en_retard_vrai_faux_ou_inconnu_jamais_invente(ctx):
    _poser(ctx, "Dépassé", sla=MAINTENANT - timedelta(days=3))
    _poser(ctx, "Tenu", sla=MAINTENANT + timedelta(days=3))
    _poser(ctx, "Sans délai")
    _poser(ctx, "Résolu hors délai", statut="resolue", sla=MAINTENANT - timedelta(days=3))
    _poser(ctx, "Vérifié hors délai", statut="verifiee", sla=MAINTENANT - timedelta(days=3))
    lignes = _liste(ctx)[0]
    assert {t: l["en_retard"] for t, l in lignes.items()} == {
        "Dépassé": True, "Tenu": False, "Sans délai": None, "Résolu hors délai": None, "Vérifié hors délai": None}


# ── Filtres serveur ───────────────────────────────────────────────────────────────────────────────────────────────────────────

def test_filtre_en_retard_vrai_et_faux(ctx):
    _poser(ctx, "Dépassé", sla=MAINTENANT - timedelta(days=3))
    _poser(ctx, "Tenu", sla=MAINTENANT + timedelta(days=3))
    _poser(ctx, "Sans délai")
    _poser(ctx, "Résolu hors délai", statut="resolue", sla=MAINTENANT - timedelta(days=3))
    lignes, r = _liste(ctx, en_retard="true")
    assert set(lignes) == {"Dépassé"} and r.headers["x-total-count"] == "1"
    lignes, r = _liste(ctx, en_retard="false")
    assert set(lignes) == {"Tenu", "Sans délai", "Résolu hors délai"} and r.headers["x-total-count"] == "3"


def test_filtre_en_retard_se_combine_avec_les_autres_filtres(ctx):
    _poser(ctx, "Dépassé A", sla=MAINTENANT - timedelta(days=3))
    _poser(ctx, "Dépassé A2", agence=ctx.agence_a2, sla=MAINTENANT - timedelta(days=3))
    assert set(_liste(ctx, en_retard="true", agence_id=str(ctx.agence_a2))[0]) == {"Dépassé A2"}
    assert set(_liste(ctx, en_retard="true", statut="resolue")[0]) == set()


def test_filtres_de_date_sur_la_premiere_detection_bornes_incluses(ctx):
    j = lambda n: MAINTENANT - timedelta(days=n)  # noqa: E731
    for titre, n in (("Il y a 10 j", 10), ("Il y a 5 j", 5), ("Il y a 1 j", 1)):
        _poser(ctx, titre, detection=j(n))
    assert set(_liste(ctx, date_debut=j(6).isoformat())[0]) == {"Il y a 5 j", "Il y a 1 j"}
    assert set(_liste(ctx, date_fin=j(6).isoformat())[0]) == {"Il y a 10 j"}
    assert set(_liste(ctx, date_debut=j(10).isoformat(), date_fin=j(5).isoformat())[0]) == {"Il y a 10 j", "Il y a 5 j"}      # bornes incluses
    assert set(_liste(ctx, date_debut=j(0).isoformat())[0]) == set()
    lignes, r = _liste(ctx, date_debut=j(6).isoformat())
    assert r.headers["x-total-count"] == "2"


def test_une_date_sans_fuseau_est_lue_en_utc(ctx):
    _poser(ctx, "Ancien", detection=datetime(2026, 1, 10, 12, 0, tzinfo=UTC))
    _poser(ctx, "Récent", detection=datetime(2026, 1, 20, 12, 0, tzinfo=UTC))
    assert set(_liste(ctx, date_debut="2026-01-15T00:00:00")[0]) == {"Récent"}
    assert set(_liste(ctx, date_fin="2026-01-15T00:00:00")[0]) == {"Ancien"}


def test_date_debut_apres_date_fin_est_refuse(ctx):
    r = ctx.call("cx_a", "get", "/issues/", params={"date_debut": "2026-02-01T00:00:00", "date_fin": "2026-01-01T00:00:00"})
    assert r.status_code == 422 and "date_debut" in r.json()["detail"]


@pytest.mark.parametrize("params", [{"en_retard": "peut-etre"}, {"date_debut": "hier"}, {"date_fin": "32/13/2026"}])
def test_valeurs_de_filtre_invalides_refusees(ctx, params):
    assert ctx.call("cx_a", "get", "/issues/", params=params).status_code == 422


# ── Pagination et bornes ──────────────────────────────────────────────────────────────────────────────────────────────────────

def test_pagination_total_stable_et_pages_disjointes(ctx):
    for n in range(5):
        _poser(ctx, f"P{n}", detection=MAINTENANT - timedelta(days=n))
    pages = []
    for offset in (0, 2, 4):
        r = ctx.call("cx_a", "get", "/issues/", params={"limit": 2, "offset": offset})
        assert r.headers["x-total-count"] == "5"
        pages.append([i["titre"] for i in r.json()])
    assert pages == [["P0", "P1"], ["P2", "P3"], ["P4"]]
    assert ctx.call("cx_a", "get", "/issues/", params={"limit": 2, "offset": 50}).json() == []


@pytest.mark.parametrize("params,attendu", [({"limit": 0}, 422), ({"limit": 201}, 422), ({"limit": 200}, 200), ({"limit": 1}, 200), ({"offset": -1}, 422)])
def test_bornes_de_limit_et_d_offset(ctx, params, attendu):
    assert ctx.call("cx_a", "get", "/issues/", params=params).status_code == attendu


def test_le_nombre_de_requetes_ne_depend_pas_du_nombre_de_problemes(ctx):
    """Pas de N+1 : deux requêtes groupées pour toute la page, quel que soit le nombre de lignes."""
    moteur = ctx.Session.kw["bind"]
    compte = []
    event.listen(moteur, "before_cursor_execute", lambda *a, **k: compte.append(1))

    def requetes(n):
        for k in range(n):
            iid = _poser(ctx, f"Volume {n}-{k}")
            _action(ctx, iid, "creee", MAINTENANT)
        compte.clear()
        assert ctx.call("cx_a", "get", "/issues/", params={"limit": 200}).status_code == 200
        return len(compte)

    petit, grand = requetes(2), requetes(30)
    assert petit == grand, f"{petit} requêtes pour peu de lignes, {grand} pour beaucoup : N+1"


# ── Portée par rôle et isolation ──────────────────────────────────────────────────────────────────────────────────────────────

def _jeu_de_portee(ctx):
    a = _poser(ctx, "Issue agence A")
    a2 = _poser(ctx, "Issue agence A2", agence=ctx.agence_a2)
    b = _poser(ctx, "Issue org B", agence=ctx.agence_b, org=ctx.org_b)
    for iid in (a, a2, b):
        _action(ctx, iid, "creee", MAINTENANT + timedelta(days=1))
        _avis(ctx, iid, 1)


@pytest.mark.parametrize("acteur,attendu", [
    ("cx_a", {"Issue agence A", "Issue agence A2"}),     # son organisation, toutes agences
    ("am_a", {"Issue agence A"}),                        # son agence seulement
    ("am_a2", {"Issue agence A2"}),                      # l'autre agence de la même organisation ne voit pas A
    ("cx_b", {"Issue org B"}),                           # une autre organisation ne voit rien de A
    ("am_b", {"Issue org B"}),
])
def test_chaque_role_ne_voit_que_son_perimetre(ctx, acteur, attendu):
    _jeu_de_portee(ctx)
    lignes, r = _liste(ctx, acteur)
    assert set(lignes) == attendu
    assert r.headers["x-total-count"] == str(len(attendu)), "le total ne compte que le périmètre"
    assert all(l["nb_actions"] == 1 and l["nb_avis"] == 1 for l in lignes.values()), "les chiffres sont ceux du problème, jamais agrégés hors périmètre"


def test_l_administrateur_n_a_pas_acces_a_la_liste(ctx):
    _jeu_de_portee(ctx)
    assert ctx.call("admin", "get", "/issues/").status_code == 403


def test_un_agency_manager_qui_filtre_sur_une_autre_agence_ne_voit_rien(ctx):
    _jeu_de_portee(ctx)
    lignes, r = _liste(ctx, "am_a", agence_id=str(ctx.agence_a2))
    assert lignes == {} and r.headers["x-total-count"] == "0"
    assert _liste(ctx, "am_a", agence_id=str(ctx.agence_b))[0] == {}


def test_les_filtres_ne_donnent_jamais_acces_hors_perimetre(ctx):
    _jeu_de_portee(ctx)
    j = (MAINTENANT - timedelta(days=1)).isoformat()
    for acteur, interdit in (("am_a", {"Issue agence A2", "Issue org B"}), ("cx_a", {"Issue org B"}), ("am_b", {"Issue agence A", "Issue agence A2"})):
        for params in ({"en_retard": "false"}, {"date_debut": j}, {"statut": "ouverte"}, {}):
            assert not (interdit & set(_liste(ctx, acteur, **params)[0])), (acteur, params)
