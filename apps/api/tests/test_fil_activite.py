"""
Fil d'activité d'un problème `GET /issues/{id}/historique` (PR 7/10), SQLite en mémoire (volume et plan d'exécution : test_fil_activite_postgres.py) :
 - route ADDITIVE et en LECTURE SEULE ; rien n'est inventé : seulement les lignes réellement écrites par les routes existantes ;
 - périmètre strict : hors périmètre = 404 identique à un identifiant inconnu, administrateur 403 ;
 - AUCUNE fuite : ni identifiant d'avis ou d'utilisateur, ni texte d'avis, ni titre ou identifiant d'un autre problème (peut-être d'une autre agence) ;
 - ordre du plus récent au plus ancien, pagination et bornes, nombre de requêtes indépendant du nombre de lignes.
"""
import json
import os
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-fil-activite-0123456789")

import pytest
from sqlalchemy import event

from app.api.v1.endpoints import issues
from app.models.enums import CriticiteType
from app.models.historique_issue import HistoriqueIssue
from app.models.issue import Issue
from app.schemas.issue import EvenementProblemeResponse

from tests.test_issues import _creer_action, _creer_issue, ctx  # noqa: F401  (même jeu de données : deux organisations, deux agences dans la A)

UTC = timezone.utc
MAINTENANT = datetime.now(UTC)
CHAMPS = {"id", "type_evenement", "date_evenement", "auteur_nom", "auteur_role", "ancien_statut", "nouveau_statut", "details"}


def _fil(ctx, issue_id, acteur="cx_a", **params):
    r = ctx.call(acteur, "get", f"/issues/{issue_id}/historique", params={"limit": 100, **params})
    assert r.status_code == 200, r.text
    return r.json(), r


def _poser(ctx, issue_id, type_evenement, auteur="Awa Sawadogo", role="cx_manager", details=None, il_y_a=0, ancien=None, nouveau=None, feedback_id=None, utilisateur_id=None):
    db = ctx.Session()
    try:
        db.add(HistoriqueIssue(id=uuid4(), issue_id=UUID(str(issue_id)), type_evenement=type_evenement, auteur_nom=auteur, auteur_role=role, details=details, ancien_statut=ancien,
                               nouveau_statut=nouveau, feedback_id=feedback_id, utilisateur_id=utilisateur_id, date_evenement=MAINTENANT - timedelta(minutes=il_y_a)))
        db.commit()
    finally:
        db.close()


def _issue_directe(ctx, titre, agence, org):
    db = ctx.Session()
    try:
        i = Issue(id=uuid4(), organisation_id=org, agence_id=agence, titre=titre, statut="ouverte", severite=CriticiteType.MOYENNE, premiere_detection=MAINTENANT)
        db.add(i)
        db.commit()
        return i.id
    finally:
        db.close()


def _cycle_complet(ctx):
    """Le vrai parcours, par les routes existantes : création, avis rattaché, action définie, terminée (résolu), confirmée (vérifié), nouvelle action (rouvert)."""
    iid = _creer_issue(ctx)
    assert ctx.call("cx_a", "patch", f"/issues/{iid}/rattacher-feedback/{ctx.fb_a}").status_code == 200
    aid = _creer_action(ctx, iid, titre="Réparer la climatisation", responsable_id=str(ctx.am_a)).json()["id"]
    assert ctx.call("am_a", "post", f"/issues/{iid}/actions/{aid}/terminer").status_code == 200
    assert ctx.call("cx_a", "post", f"/issues/{iid}/verifier").status_code == 200
    assert _creer_action(ctx, iid, titre="Contrôler à nouveau").status_code == 201
    return iid


# ── Forme, ordre, contenu réel ───────────────────────────────────────────────────────────────────────────────────────────────

def test_route_additive_en_lecture_seule():
    methodes = {m for r in issues.router.routes if r.path == "/{issue_id}/historique" for m in r.methods}
    assert methodes == {"GET"}, "aucune écriture sur le fil : il n'est jamais modifié par cette route"


def test_champs_exacts_et_ordre_du_plus_recent_au_plus_ancien(ctx):
    iid = _cycle_complet(ctx)
    lignes, r = _fil(ctx, iid)
    assert all(set(l) == CHAMPS for l in lignes) and set(EvenementProblemeResponse.model_fields) == CHAMPS
    dates = [l["date_evenement"] for l in lignes]
    assert dates == sorted(dates, reverse=True)
    assert r.headers["x-total-count"] == str(len(lignes))


def test_ordre_du_plus_recent_au_plus_ancien_avec_des_dates_distinctes(ctx):
    """Les événements écrits par les routes partagent la même seconde en SQLite : l'ordre est prouvé ici avec des dates explicites, insérées dans le désordre."""
    iid = _creer_issue(ctx)
    for type_evenement, il_y_a in (("feedback_rattache", 30), ("issue_verifiee", 1), ("action_terminee", 600), ("action_creee", 5)):
        _poser(ctx, iid, type_evenement, il_y_a=il_y_a)
    types = [l["type_evenement"] for l in _fil(ctx, iid)[0] if l["type_evenement"] != "creation"]
    assert types == ["issue_verifiee", "action_creee", "feedback_rattache", "action_terminee"]


def test_le_fil_contient_exactement_ce_que_les_routes_ont_ecrit(ctx):
    iid = _cycle_complet(ctx)
    lignes, _ = _fil(ctx, iid)
    types = sorted(l["type_evenement"] for l in lignes)
    # Une réouverture par une nouvelle action écrit DEUX lignes « action_creee » (vérifiée → rouverte, puis rouverte → action en cours) : le fil les rend sans doublon.
    assert types == sorted(["creation", "feedback_rattache", "action_creee", "action_terminee", "issue_resolue", "issue_verifiee", "action_creee", "action_creee"]), types
    assert not [l for l in lignes if l["type_evenement"] not in {"creation", "feedback_rattache", "action_creee", "action_terminee", "issue_resolue", "issue_verifiee"}], "aucun événement fictif"


def test_reouverture_visible_par_les_statuts_de_l_evenement(ctx):
    iid = _cycle_complet(ctx)
    rouverts = [l for l in _fil(ctx, iid)[0] if l["nouveau_statut"] == "reouverte"]
    assert len(rouverts) == 1 and rouverts[0]["ancien_statut"] == "verifiee" and rouverts[0]["type_evenement"] == "action_creee"


def test_details_seulement_pour_les_titres_d_actions(ctx):
    iid = _cycle_complet(ctx)
    lignes, _ = _fil(ctx, iid)
    avec = {(l["type_evenement"], l["details"]) for l in lignes if l["details"]}
    assert avec == {("action_creee", "Réparer la climatisation"), ("action_creee", "Contrôler à nouveau"), ("action_terminee", "Réparer la climatisation")}
    assert all(l["details"] is None for l in lignes if l["type_evenement"] in {"creation", "feedback_rattache", "issue_resolue", "issue_verifiee"})


def test_auteur_par_son_nom_et_son_role(ctx):
    iid = _creer_issue(ctx)
    creation = [l for l in _fil(ctx, iid)[0] if l["type_evenement"] == "creation"][0]
    assert (creation["auteur_nom"], creation["auteur_role"]) == ("CX A", "cx_manager")


@pytest.mark.parametrize("auteur", ["", "   "])
def test_auteur_inconnu_jamais_devine(ctx, auteur):
    iid = _creer_issue(ctx)
    _poser(ctx, iid, "issue_verifiee", auteur=auteur, role="")
    l = [x for x in _fil(ctx, iid)[0] if x["type_evenement"] == "issue_verifiee"][0]
    assert l["auteur_nom"] is None and l["auteur_role"] is None


# ── Aucune fuite ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

def test_aucun_identifiant_ni_texte_d_avis_ni_donnee_d_une_autre_agence(ctx):
    """Un CX Manager déplace un avis entre deux problèmes de DEUX agences : les textes stockés nomment l'autre problème. Un Agency Manager ne doit rien en lire."""
    autre = _issue_directe(ctx, "Problème SECRET de l'agence A2", ctx.agence_a2, ctx.org_a)
    iid = _cycle_complet(ctx)
    _poser(ctx, iid, "feedback_deplace_entrant", details=f"Avis déplacé depuis le problème « Problème SECRET de l'agence A2 » ({autre})", feedback_id=ctx.fb_a, utilisateur_id=ctx.cx_a)
    _poser(ctx, iid, "creation", details="Description : Feedback A, client mécontent, 06 12 34 56 78")
    for acteur in ("cx_a", "am_a"):
        corps = json.dumps(_fil(ctx, iid, acteur)[0], ensure_ascii=False)
        for interdit in ("SECRET", str(autre), str(ctx.fb_a), str(ctx.cx_a), str(ctx.am_a), "Feedback A", "06 12 34 56 78", "agence_nom", "agence_id", "utilisateur_id", "feedback_id", "Agence A2"):
            assert interdit not in corps, f"{acteur} lit « {interdit} »"


def test_les_evenements_d_un_autre_probleme_ne_sont_jamais_melanges(ctx):
    a, b = _cycle_complet(ctx), _creer_issue(ctx, titre="Autre problème")
    assert {l["type_evenement"] for l in _fil(ctx, b)[0]} == {"creation"}
    assert len(_fil(ctx, a)[0]) > 1


# ── Rôles, périmètre, isolation ───────────────────────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("acteur,attendu", [("cx_a", 200), ("am_a", 200), ("am_a2", 404), ("am_b", 404), ("cx_b", 404), ("admin", 403)])
def test_matrice_des_roles(ctx, acteur, attendu):
    iid = _creer_issue(ctx)                                              # problème de l'agence A
    assert ctx.call(acteur, "get", f"/issues/{iid}/historique").status_code == attendu


def test_hors_perimetre_donne_le_meme_404_qu_un_identifiant_inconnu(ctx):
    iid = _creer_issue(ctx)
    inconnu = ctx.call("am_a2", "get", f"/issues/{uuid4()}/historique")
    assert inconnu.status_code == 404
    for acteur in ("am_a2", "am_b", "cx_b"):
        r = ctx.call(acteur, "get", f"/issues/{iid}/historique")
        assert (r.status_code, r.json()) == (404, inconnu.json()), acteur


def test_sans_aucune_ecriture_le_fil_ne_change_pas_apres_lecture(ctx):
    iid = _cycle_complet(ctx)
    avant = _fil(ctx, iid)[0]
    for _ in range(3):
        _fil(ctx, iid)
    assert _fil(ctx, iid)[0] == avant


# ── Pagination et bornes ──────────────────────────────────────────────────────────────────────────────────────────────────────

def test_pagination_total_stable_pages_disjointes(ctx):
    iid = _creer_issue(ctx)
    for n in range(6):
        _poser(ctx, iid, "feedback_rattache", il_y_a=n + 1)
    pages = []
    for offset in (0, 3, 6):
        r = ctx.call("cx_a", "get", f"/issues/{iid}/historique", params={"limit": 3, "offset": offset})
        assert r.headers["x-total-count"] == "7"
        pages.append([e["id"] for e in r.json()])
    assert [len(p) for p in pages] == [3, 3, 1] and len({i for p in pages for i in p}) == 7
    assert ctx.call("cx_a", "get", f"/issues/{iid}/historique", params={"offset": 99}).json() == []


@pytest.mark.parametrize("params,attendu", [({"limit": 0}, 422), ({"limit": 101}, 422), ({"limit": 100}, 200), ({"limit": 1}, 200), ({"offset": -1}, 422)])
def test_bornes(ctx, params, attendu):
    iid = _creer_issue(ctx)
    assert ctx.call("cx_a", "get", f"/issues/{iid}/historique", params=params).status_code == attendu


def test_le_nombre_de_requetes_ne_depend_pas_du_nombre_d_evenements(ctx):
    moteur = ctx.Session.kw["bind"]
    compte = []
    event.listen(moteur, "before_cursor_execute", lambda *a, **k: compte.append(1))

    def requetes(n):
        iid = _creer_issue(ctx, titre=f"Volume {n}")
        for k in range(n):
            _poser(ctx, iid, "feedback_rattache", il_y_a=k)
        compte.clear()
        assert ctx.call("cx_a", "get", f"/issues/{iid}/historique", params={"limit": 100}).status_code == 200
        return len(compte)

    petit, grand = requetes(2), requetes(60)
    assert petit == grand, f"{petit} requêtes pour peu d'événements, {grand} pour beaucoup : N+1"
