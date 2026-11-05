"""
Délai de traitement et récurrence saisissables (PR 8/10), SQLite en mémoire, AUCUNE migration (colonnes `date_limite_sla` et `issue_origine_id` existantes) :
 - `PATCH /issues/{id}/delai-recurrence` : CX Manager seul (Agency Manager et administrateur 403, hors organisation 404 identique à un identifiant inconnu) ;
 - création : un Agency Manager ne peut plus fixer délai ni récurrence (403) ; le CX Manager, si ;
 - validation : délai postérieur à la première détection, pas de délai après résolution, mêmes règles d'origine qu'à la création ;
 - idempotence, effacement par `null`, événements d'historique sans identifiant.
"""
import os
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-delai-recurrence-0123456789")

import pytest

from app.models.historique_issue import HistoriqueIssue
from app.models.issue import Issue

from tests.test_issues import _creer_issue, ctx  # noqa: F401

FUTUR = (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()


def _route(iid):
    return f"/issues/{iid}/delai-recurrence"


def _poser(ctx, iid, **champs):
    db = ctx.Session()
    try:
        i = db.get(Issue, UUID(str(iid)))
        for k, v in champs.items():
            setattr(i, k, v)
        db.commit()
    finally:
        db.close()


def _lire(ctx, iid):
    db = ctx.Session()
    try:
        i = db.get(Issue, UUID(str(iid)))
        return i.date_limite_sla, i.issue_origine_id
    finally:
        db.close()


def _evenements(ctx, iid):
    db = ctx.Session()
    try:
        return [h.type_evenement for h in db.query(HistoriqueIssue).filter(HistoriqueIssue.issue_id == UUID(str(iid))).order_by(HistoriqueIssue.date_evenement, HistoriqueIssue.id)]
    finally:
        db.close()


def _source(ctx, statut="resolue", user_key="cx_a", agence_id=None):
    sid = _creer_issue(ctx, user_key=user_key, agence_id=agence_id, titre="Problème source")
    _poser(ctx, sid, statut=statut, premiere_detection=datetime.now(timezone.utc) - timedelta(days=5))
    return sid


# ── Rôles ──────────────────────────────────────────────────────────────────────

def test_cx_fixe_le_delai(ctx):
    iid = _creer_issue(ctx)
    r = ctx.call("cx_a", "patch", _route(iid), json={"date_limite_sla": FUTUR})
    assert r.status_code == 200, r.text
    assert r.json()["date_limite_sla"] is not None
    assert _lire(ctx, iid)[0] is not None


@pytest.mark.parametrize("acteur", ["am_a", "am_a_bis", "am_a2", "am_b", "admin"])
def test_seul_le_cx_modifie_agency_manager_et_admin_refuses_sans_rien_ecrire(ctx, acteur):
    iid = _creer_issue(ctx)
    r = ctx.call(acteur, "patch", _route(iid), json={"date_limite_sla": FUTUR})
    assert r.status_code == 403
    assert _lire(ctx, iid) == (None, None)
    assert _evenements(ctx, iid) == ["creation"]


def test_autre_organisation_404_identique_a_un_identifiant_inconnu(ctx):
    iid = _creer_issue(ctx)
    r = ctx.call("cx_b", "patch", _route(iid), json={"date_limite_sla": FUTUR})
    inconnu = ctx.call("cx_b", "patch", _route(uuid4()), json={"date_limite_sla": FUTUR})
    assert r.status_code == inconnu.status_code == 404
    assert r.json() == inconnu.json()
    assert _lire(ctx, iid) == (None, None)


def test_inconnu_404(ctx):
    assert ctx.call("cx_a", "patch", _route(uuid4()), json={"date_limite_sla": FUTUR}).status_code == 404


# ── Création ───────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("extra", ["delai", "origine"])
def test_creation_agency_manager_ne_peut_pas_fixer_delai_ni_recurrence(ctx, extra):
    corps = {"titre": "Bruit en salle", "agence_id": str(ctx.agence_a)}
    if extra == "delai":
        corps["date_limite_sla"] = FUTUR
    else:
        corps["issue_origine_id"] = _source(ctx, agence_id=ctx.agence_a)
    r = ctx.call("am_a", "post", "/issues/", json=corps)
    assert r.status_code == 403
    assert r.json()["detail"] == "Le délai de traitement et la récurrence sont fixés par le CX Manager"


def test_creation_agency_manager_sans_ces_champs_reste_permise_et_cx_peut_les_fixer(ctx):
    assert ctx.call("am_a", "post", "/issues/", json={"titre": "Bruit en salle", "agence_id": str(ctx.agence_a)}).status_code == 201
    assert ctx.call("cx_a", "post", "/issues/", json={"titre": "Bruit en salle", "agence_id": str(ctx.agence_a), "date_limite_sla": FUTUR}).status_code == 201


# ── Délai ──────────────────────────────────────────────────────────────────────

def test_delai_modifie_puis_efface_par_null_et_absent_ne_touche_pas(ctx):
    iid = _creer_issue(ctx)
    ctx.call("cx_a", "patch", _route(iid), json={"date_limite_sla": FUTUR})
    assert _lire(ctx, iid)[0] is not None
    assert ctx.call("cx_a", "patch", _route(iid), json={}).status_code == 200            # champ absent : inchangé
    assert _lire(ctx, iid)[0] is not None
    r = ctx.call("cx_a", "patch", _route(iid), json={"date_limite_sla": None})            # null : effacé
    assert r.status_code == 200 and r.json()["date_limite_sla"] is None
    assert _lire(ctx, iid)[0] is None


def test_delai_avant_la_premiere_detection_refuse_422(ctx):
    iid = _creer_issue(ctx)
    r = ctx.call("cx_a", "patch", _route(iid), json={"date_limite_sla": (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()})
    assert r.status_code == 422
    assert "postérieur" in r.json()["detail"]
    assert _lire(ctx, iid)[0] is None


@pytest.mark.parametrize("statut", ["resolue", "verifiee"])
def test_delai_sur_probleme_resolu_refuse_409(ctx, statut):
    iid = _creer_issue(ctx)
    _poser(ctx, iid, statut=statut)
    r = ctx.call("cx_a", "patch", _route(iid), json={"date_limite_sla": FUTUR})
    assert r.status_code == 409
    assert _lire(ctx, iid)[0] is None


def test_corps_invalide_422_champ_inconnu_refuse(ctx):
    iid = _creer_issue(ctx)
    assert ctx.call("cx_a", "patch", _route(iid), json={"date_limite_sla": "pas une date"}).status_code == 422
    assert ctx.call("cx_a", "patch", _route(iid), json={"statut": "verifiee"}).status_code == 422
    assert _lire(ctx, iid) == (None, None)


def test_idempotent_meme_valeur_n_ecrit_pas_d_evenement(ctx):
    iid = _creer_issue(ctx)
    ctx.call("cx_a", "patch", _route(iid), json={"date_limite_sla": FUTUR})
    avant = _evenements(ctx, iid)
    assert ctx.call("cx_a", "patch", _route(iid), json={"date_limite_sla": FUTUR}).status_code == 200
    assert sorted(_evenements(ctx, iid)) == sorted(avant) == ["creation", "delai_modifie"]


# ── Récurrence ─────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("statut", ["resolue", "verifiee"])
def test_recurrence_posee_puis_effacee(ctx, statut):
    sid = _source(ctx, statut=statut)
    iid = _creer_issue(ctx)
    r = ctx.call("cx_a", "patch", _route(iid), json={"issue_origine_id": sid})
    assert r.status_code == 200, r.text
    assert r.json()["issue_origine_id"] == sid
    r = ctx.call("cx_a", "patch", _route(iid), json={"issue_origine_id": None})
    assert r.status_code == 200 and r.json()["issue_origine_id"] is None
    assert sorted(_evenements(ctx, iid)) == ["creation", "recurrence_modifiee", "recurrence_modifiee"]


def test_recurrence_inter_agence_dans_l_organisation_permise_au_cx(ctx):
    sid = _source(ctx, agence_id=ctx.agence_a)
    iid = _creer_issue(ctx, agence_id=ctx.agence_a2)
    assert ctx.call("cx_a", "patch", _route(iid), json={"issue_origine_id": sid}).status_code == 200


@pytest.mark.parametrize("statut", ["ouverte", "action_en_cours", "reouverte"])
def test_recurrence_source_non_resolue_422(ctx, statut):
    sid = _source(ctx, statut=statut)
    iid = _creer_issue(ctx)
    assert ctx.call("cx_a", "patch", _route(iid), json={"issue_origine_id": sid}).status_code == 422
    assert _lire(ctx, iid)[1] is None


def test_recurrence_source_inconnue_ou_autre_organisation_meme_reponse_422(ctx):
    autre = _source(ctx, agence_id=ctx.agence_b, user_key="cx_b")
    iid = _creer_issue(ctx)
    r1 = ctx.call("cx_a", "patch", _route(iid), json={"issue_origine_id": autre})
    r2 = ctx.call("cx_a", "patch", _route(iid), json={"issue_origine_id": str(uuid4())})
    assert r1.status_code == r2.status_code == 422
    assert r1.json() == r2.json()
    assert _lire(ctx, iid)[1] is None


def test_recurrence_regles_de_chaine_et_d_anteriorite(ctx):
    racine = _source(ctx)
    b = _creer_issue(ctx, titre="Problème B")
    assert ctx.call("cx_a", "patch", _route(b), json={"issue_origine_id": racine}).status_code == 200
    _poser(ctx, b, statut="resolue")
    c = _creer_issue(ctx, titre="Problème C")
    assert ctx.call("cx_a", "patch", _route(c), json={"issue_origine_id": b}).status_code == 422                # B est déjà récurrente
    assert ctx.call("cx_a", "patch", _route(racine), json={"issue_origine_id": racine}).status_code == 422      # soi-même
    autre = _source(ctx)
    assert ctx.call("cx_a", "patch", _route(racine), json={"issue_origine_id": autre}).status_code == 409       # la racine sert déjà de source
    futur = _source(ctx)
    _poser(ctx, futur, premiere_detection=datetime.now(timezone.utc) + timedelta(days=2))
    d = _creer_issue(ctx, titre="Problème D")
    assert ctx.call("cx_a", "patch", _route(d), json={"issue_origine_id": futur}).status_code == 422            # source plus récente


def test_recurrence_idempotente(ctx):
    sid = _source(ctx)
    iid = _creer_issue(ctx)
    ctx.call("cx_a", "patch", _route(iid), json={"issue_origine_id": sid})
    assert ctx.call("cx_a", "patch", _route(iid), json={"issue_origine_id": sid}).status_code == 200
    assert sorted(_evenements(ctx, iid)) == ["creation", "recurrence_modifiee"]


def test_evenement_sans_identifiant_ni_texte_libre(ctx):
    sid = _source(ctx)
    iid = _creer_issue(ctx)
    ctx.call("cx_a", "patch", _route(iid), json={"issue_origine_id": sid, "date_limite_sla": FUTUR})
    db = ctx.Session()
    try:
        lignes = db.query(HistoriqueIssue).filter(HistoriqueIssue.issue_id == UUID(iid), HistoriqueIssue.type_evenement.in_(["delai_modifie", "recurrence_modifiee"])).all()
        assert {h.type_evenement for h in lignes} == {"delai_modifie", "recurrence_modifiee"}
        assert all(h.details is None for h in lignes)
    finally:
        db.close()


def test_agency_manager_lit_les_valeurs(ctx):
    sid = _source(ctx)
    iid = _creer_issue(ctx)
    ctx.call("cx_a", "patch", _route(iid), json={"issue_origine_id": sid, "date_limite_sla": FUTUR})
    d = ctx.call("am_a", "get", f"/issues/{iid}").json()
    assert d["issue_origine_id"] == sid and d["date_limite_sla"] is not None
