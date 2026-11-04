"""
Liste des actions de problème `GET /issues/actions` (PR 6/10), SQLite en mémoire (volume et plan d'exécution : test_actions_problemes_postgres.py) :
 - route ADDITIVE : rien d'existant ne change ;
 - périmètre strict par rôle, isolation entre organisations, hors périmètre = 404 identique à un identifiant inconnu, administrateur refusé ;
 - filtres (état, responsable, en retard, période, agence), pagination et bornes ;
 - aucun chiffre inventé : `en_retard` est null sans échéance ou si l'action est faite ; nombre de requêtes indépendant du nombre de lignes.
"""
import os
from datetime import datetime, timedelta, timezone
from uuid import uuid4

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-actions-problemes-0123456789")

import pytest
from sqlalchemy import event

from app.models.action_corrective import ActionCorrective
from app.models.enums import CriticiteType
from app.models.issue import Issue
from app.schemas.issue import IssueDetailResponse

from tests.test_issues import ctx  # noqa: F401  (même jeu de données : deux organisations, deux agences dans la A)

UTC = timezone.utc
MAINTENANT = datetime.now(UTC)
JOUR = timedelta(days=1)
CHAMPS = {"id", "issue_id", "titre", "description", "statut", "responsable_id", "responsable_nom", "echeance", "date_completion", "created_at",
          "en_retard", "derniere_a_faire", "issue_titre", "agence_id", "agence_nom"}


def _issue(ctx, titre, agence=None, org=None):
    db = ctx.Session()
    try:
        i = Issue(id=uuid4(), organisation_id=org or ctx.org_a, agence_id=agence or ctx.agence_a, titre=titre, statut="action_en_cours",
                  severite=CriticiteType.MOYENNE, premiere_detection=MAINTENANT)
        db.add(i)
        db.commit()
        return i.id
    finally:
        db.close()


def _action(ctx, issue_id, titre="Action", statut="creee", echeance=None, responsable=None, creee=None, terminee=None):
    db = ctx.Session()
    try:
        a = ActionCorrective(id=uuid4(), issue_id=issue_id, titre=titre, statut=statut, echeance=echeance, responsable_id=responsable,
                             created_at=creee or MAINTENANT, date_completion=terminee)
        db.add(a)
        db.commit()
        return a.id
    finally:
        db.close()


def _liste(ctx, acteur="cx_a", **params):
    r = ctx.call(acteur, "get", "/issues/actions", params={"limit": 200, **params})
    assert r.status_code == 200, r.text
    return {a["titre"]: a for a in r.json()}, r


# ── Additivité et forme ───────────────────────────────────────────────────────────────────────────────────────────────────────

def test_la_route_n_entre_pas_en_collision_avec_le_detail_d_un_probleme(ctx):
    assert ctx.call("cx_a", "get", "/issues/actions").status_code == 200           # pas de 422 « actions n'est pas un UUID »
    iid = _issue(ctx, "P")
    detail = ctx.call("cx_a", "get", f"/issues/{iid}")
    assert detail.status_code == 200 and set(detail.json()) == set(IssueDetailResponse.model_fields), "le détail d'un problème ne change pas"


def test_champs_de_la_ligne(ctx):
    iid = _issue(ctx, "Climatisation en panne")
    _action(ctx, iid, "Appeler le prestataire", echeance=MAINTENANT + 3 * JOUR, responsable=ctx.am_a)
    ligne = _liste(ctx)[0]["Appeler le prestataire"]
    assert set(ligne) == CHAMPS
    assert ligne["issue_id"] == str(iid) and ligne["issue_titre"] == "Climatisation en panne"
    assert ligne["agence_id"] == str(ctx.agence_a) and ligne["agence_nom"] == "Agence A"
    assert ligne["responsable_id"] == str(ctx.am_a) and ligne["responsable_nom"] == "AM-A N"
    assert ligne["statut"] == "creee"


def test_sans_responsable_le_nom_est_nul_jamais_invente(ctx):
    _action(ctx, _issue(ctx, "P"), "Sans responsable")
    ligne = _liste(ctx)[0]["Sans responsable"]
    assert ligne["responsable_id"] is None and ligne["responsable_nom"] is None


def test_en_retard_vrai_faux_ou_inconnu(ctx):
    iid = _issue(ctx, "P")
    _action(ctx, iid, "Échue", echeance=MAINTENANT - 2 * JOUR)
    _action(ctx, iid, "À venir", echeance=MAINTENANT + 2 * JOUR)
    _action(ctx, iid, "Sans échéance")
    _action(ctx, iid, "Faite hors délai", statut="terminee", echeance=MAINTENANT - 2 * JOUR, terminee=MAINTENANT - JOUR)
    _action(ctx, iid, "Annulée hors délai", statut="annulee", echeance=MAINTENANT - 2 * JOUR)
    lignes = _liste(ctx)[0]
    assert {t: l["en_retard"] for t, l in lignes.items()} == {"Échue": True, "À venir": False, "Sans échéance": None, "Faite hors délai": None, "Annulée hors délai": None}


def test_derniere_a_faire_previent_que_terminer_resoudra_le_probleme(ctx):
    seul = _issue(ctx, "Un seul")
    _action(ctx, seul, "Unique")
    deux = _issue(ctx, "Deux")
    _action(ctx, deux, "Première")
    _action(ctx, deux, "Seconde")
    reste_une = _issue(ctx, "Une reste")
    _action(ctx, reste_une, "Déjà faite", statut="terminee", terminee=MAINTENANT)
    _action(ctx, reste_une, "Dernière")
    _action(ctx, reste_une, "Annulée", statut="annulee")
    l = _liste(ctx)[0]
    assert (l["Unique"]["derniere_a_faire"], l["Première"]["derniere_a_faire"], l["Seconde"]["derniere_a_faire"]) == (True, False, False)
    assert (l["Dernière"]["derniere_a_faire"], l["Déjà faite"]["derniere_a_faire"], l["Annulée"]["derniere_a_faire"]) == (True, False, False)


# ── Filtres ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

def test_filtre_etat(ctx):
    iid = _issue(ctx, "P")
    _action(ctx, iid, "À faire")
    _action(ctx, iid, "En cours", statut="en_cours")
    _action(ctx, iid, "Faite", statut="terminee", terminee=MAINTENANT)
    _action(ctx, iid, "Annulée", statut="annulee")
    assert set(_liste(ctx, etat="a_faire")[0]) == {"À faire", "En cours"}
    assert set(_liste(ctx, etat="terminee")[0]) == {"Faite"}
    assert set(_liste(ctx, etat="annulee")[0]) == {"Annulée"}
    assert set(_liste(ctx)[0]) == {"À faire", "En cours", "Faite", "Annulée"}
    assert ctx.call("cx_a", "get", "/issues/actions", params={"etat": "bloquee"}).status_code == 422          # aucun état inventé


def test_filtre_responsable(ctx):
    iid = _issue(ctx, "P")
    _action(ctx, iid, "À Alice", responsable=ctx.am_a)
    _action(ctx, iid, "Au CX", responsable=ctx.cx_a)
    _action(ctx, iid, "À personne")
    assert set(_liste(ctx, responsable_id=str(ctx.am_a))[0]) == {"À Alice"}
    assert set(_liste(ctx, responsable_id=str(ctx.cx_a))[0]) == {"Au CX"}
    assert _liste(ctx, responsable_id=str(uuid4()))[0] == {}


def test_filtre_en_retard(ctx):
    iid = _issue(ctx, "P")
    _action(ctx, iid, "Échue", echeance=MAINTENANT - JOUR)
    _action(ctx, iid, "À venir", echeance=MAINTENANT + JOUR)
    _action(ctx, iid, "Sans échéance")
    _action(ctx, iid, "Faite hors délai", statut="terminee", echeance=MAINTENANT - JOUR, terminee=MAINTENANT)
    lignes, r = _liste(ctx, en_retard="true")
    assert set(lignes) == {"Échue"} and r.headers["x-total-count"] == "1"
    lignes, r = _liste(ctx, en_retard="false")
    assert set(lignes) == {"À venir", "Sans échéance", "Faite hors délai"} and r.headers["x-total-count"] == "3"
    assert ctx.call("cx_a", "get", "/issues/actions", params={"en_retard": "peut-etre"}).status_code == 422


def test_filtre_de_periode_sur_la_date_de_definition_bornes_incluses(ctx):
    iid = _issue(ctx, "P")
    j = lambda n: MAINTENANT - n * JOUR  # noqa: E731
    for titre, n in (("Il y a 10 j", 10), ("Il y a 5 j", 5), ("Il y a 1 j", 1)):
        _action(ctx, iid, titre, creee=j(n))
    assert set(_liste(ctx, date_debut=j(6).isoformat())[0]) == {"Il y a 5 j", "Il y a 1 j"}
    assert set(_liste(ctx, date_fin=j(6).isoformat())[0]) == {"Il y a 10 j"}
    assert set(_liste(ctx, date_debut=j(10).isoformat(), date_fin=j(5).isoformat())[0]) == {"Il y a 10 j", "Il y a 5 j"}
    assert ctx.call("cx_a", "get", "/issues/actions", params={"date_debut": "2026-02-01T00:00:00", "date_fin": "2026-01-01T00:00:00"}).status_code == 422


def test_filtre_agence_et_combinaison(ctx):
    a, a2 = _issue(ctx, "Pa"), _issue(ctx, "Pa2", agence=ctx.agence_a2)
    _action(ctx, a, "Dans A", echeance=MAINTENANT - JOUR)
    _action(ctx, a2, "Dans A2", echeance=MAINTENANT - JOUR)
    assert set(_liste(ctx, agence_id=str(ctx.agence_a2))[0]) == {"Dans A2"}
    assert set(_liste(ctx, agence_id=str(ctx.agence_a), en_retard="true", etat="a_faire")[0]) == {"Dans A"}


def test_ordre_par_echeance_les_sans_echeance_en_dernier(ctx):
    iid = _issue(ctx, "P")
    _action(ctx, iid, "Sans", None)
    _action(ctx, iid, "Lointaine", echeance=MAINTENANT + 9 * JOUR)
    _action(ctx, iid, "Proche", echeance=MAINTENANT + 1 * JOUR)
    r = ctx.call("cx_a", "get", "/issues/actions", params={"etat": "a_faire"})
    assert [a["titre"] for a in r.json()] == ["Proche", "Lointaine", "Sans"]


# ── Pagination et bornes ──────────────────────────────────────────────────────────────────────────────────────────────────────

def test_pagination_total_stable_pages_disjointes(ctx):
    iid = _issue(ctx, "P")
    for n in range(5):
        _action(ctx, iid, f"A{n}", echeance=MAINTENANT + (n + 1) * JOUR)
    pages = []
    for offset in (0, 2, 4):
        r = ctx.call("cx_a", "get", "/issues/actions", params={"limit": 2, "offset": offset, "etat": "a_faire"})
        assert r.headers["x-total-count"] == "5"
        pages.append([a["titre"] for a in r.json()])
    assert pages == [["A0", "A1"], ["A2", "A3"], ["A4"]]
    assert ctx.call("cx_a", "get", "/issues/actions", params={"limit": 2, "offset": 50}).json() == []


@pytest.mark.parametrize("params,attendu", [({"limit": 0}, 422), ({"limit": 201}, 422), ({"limit": 200}, 200), ({"limit": 1}, 200), ({"offset": -1}, 422)])
def test_bornes(ctx, params, attendu):
    assert ctx.call("cx_a", "get", "/issues/actions", params=params).status_code == attendu


def test_le_nombre_de_requetes_ne_depend_pas_du_nombre_de_lignes(ctx):
    moteur = ctx.Session.kw["bind"]
    compte = []
    event.listen(moteur, "before_cursor_execute", lambda *a, **k: compte.append(1))

    def requetes(n):
        for k in range(n):
            iid = _issue(ctx, f"Volume {n}-{k}")
            _action(ctx, iid, f"Action {n}-{k}", echeance=MAINTENANT, responsable=ctx.am_a)
        compte.clear()
        assert ctx.call("cx_a", "get", "/issues/actions", params={"limit": 200}).status_code == 200
        return len(compte)

    petit, grand = requetes(2), requetes(30)
    assert petit == grand, f"{petit} requêtes pour peu de lignes, {grand} pour beaucoup : N+1"


# ── Portée par rôle et isolation ──────────────────────────────────────────────────────────────────────────────────────────────

def _jeu_de_portee(ctx):
    for titre, agence, org in (("agence A", None, None), ("agence A2", ctx.agence_a2, None), ("org B", ctx.agence_b, ctx.org_b)):
        _action(ctx, _issue(ctx, f"Problème {titre}", agence=agence, org=org), f"Action {titre}", responsable=ctx.am_b if org else ctx.am_a)


@pytest.mark.parametrize("acteur,attendu", [
    ("cx_a", {"Action agence A", "Action agence A2"}),
    ("am_a", {"Action agence A"}),
    ("am_a2", {"Action agence A2"}),
    ("cx_b", {"Action org B"}),
    ("am_b", {"Action org B"}),
])
def test_chaque_role_ne_voit_que_son_perimetre(ctx, acteur, attendu):
    _jeu_de_portee(ctx)
    lignes, r = _liste(ctx, acteur)
    assert set(lignes) == attendu
    assert r.headers["x-total-count"] == str(len(attendu))


def test_l_administrateur_est_refuse(ctx):
    _jeu_de_portee(ctx)
    assert ctx.call("admin", "get", "/issues/actions").status_code == 403


def test_les_filtres_ne_donnent_jamais_acces_hors_perimetre(ctx):
    _jeu_de_portee(ctx)
    for acteur, interdit in (("am_a", {"Action agence A2", "Action org B"}), ("cx_a", {"Action org B"}), ("am_b", {"Action agence A", "Action agence A2"})):
        for params in ({}, {"etat": "a_faire"}, {"en_retard": "false"}, {"responsable_id": str(ctx.am_a)}, {"responsable_id": str(ctx.am_b)}):
            assert not (interdit & set(_liste(ctx, acteur, **params)[0])), (acteur, params)


def test_agence_hors_perimetre_donne_le_meme_404_qu_une_agence_inconnue(ctx):
    _jeu_de_portee(ctx)
    inconnue = ctx.call("am_a", "get", "/issues/actions", params={"agence_id": str(uuid4())})
    assert inconnue.status_code == 404
    for acteur, agence in (("am_a", ctx.agence_a2), ("am_a", ctx.agence_b), ("cx_a", ctx.agence_b), ("cx_b", ctx.agence_a), ("am_b", ctx.agence_a)):
        r = ctx.call(acteur, "get", "/issues/actions", params={"agence_id": str(agence)})
        assert r.status_code == 404 and r.json() == inconnue.json(), (acteur, r.status_code, r.text)


def test_agence_de_son_perimetre_acceptee(ctx):
    _jeu_de_portee(ctx)
    assert set(_liste(ctx, "am_a", agence_id=str(ctx.agence_a))[0]) == {"Action agence A"}
    assert set(_liste(ctx, "cx_a", agence_id=str(ctx.agence_a2))[0]) == {"Action agence A2"}
