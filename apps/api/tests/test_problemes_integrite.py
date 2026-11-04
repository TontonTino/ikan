"""
Intégrité des actions d'un problème (PR 3/10), appliquée par le SERVEUR (SQLite en mémoire ; la concurrence réelle et le fuseau Asia/Tokyo sont dans
test_problemes_integrite_postgres.py) :
 - création d'une action et confirmation de la résolution : CX Manager seul ;
 - responsable d'une action : dans le périmètre du problème (agence), même organisation, actif ;
 - terminer une action : idempotent, une action annulée ne se termine pas et ne bloque pas la résolution ;
 - cinq dates écrites en UTC ; nom du responsable lisible par l'Agency Manager.
"""
import os
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-integrite-problemes-0123456789")

import pytest

from app.api.v1.endpoints import issues
from app.models.action_corrective import ActionCorrective
from app.models.historique_issue import HistoriqueIssue
from app.models.issue import Issue
from app.models.utilisateur import Utilisateur

from tests.test_issues import _creer_action, _creer_issue, ctx  # noqa: F401  (même jeu de données : deux organisations, deux agences dans la A)

UTC = timezone.utc


def _u(valeur):
    return valeur if isinstance(valeur, UUID) else UUID(str(valeur))


def _issue(ctx, issue_id):
    db = ctx.Session()
    try:
        i = db.get(Issue, _u(issue_id))
        db.expunge(i)
        return i
    finally:
        db.close()


def _actions(ctx, issue_id):
    db = ctx.Session()
    try:
        return db.query(ActionCorrective).filter(ActionCorrective.issue_id == _u(issue_id)).all()
    finally:
        db.close()


def _evenements(ctx, issue_id, type_evenement):
    db = ctx.Session()
    try:
        return db.query(HistoriqueIssue).filter(HistoriqueIssue.issue_id == _u(issue_id), HistoriqueIssue.type_evenement == type_evenement).count()
    finally:
        db.close()


def _modifier(ctx, modele, cle, **valeurs):
    db = ctx.Session()
    try:
        db.query(modele).filter(modele.id == cle).update(valeurs)
        db.commit()
    finally:
        db.close()


# ── 3. Rôles : création d'une action et vérification de la résolution = CX Manager seul ───────────────────────────────────────────

@pytest.mark.parametrize("acteur,attendu", [("cx_a", 201), ("am_a", 403), ("am_a2", 403), ("am_b", 403), ("cx_b", 403), ("admin", 403)])
def test_creer_une_action_est_reserve_au_cx_manager_de_l_organisation(ctx, acteur, attendu):
    iid = _creer_issue(ctx)
    r = _creer_action(ctx, iid, user_key=acteur)
    assert r.status_code == attendu, r.text
    assert len(_actions(ctx, iid)) == (1 if attendu == 201 else 0), "un refus n'écrit rien"
    if attendu != 201:
        assert _issue(ctx, iid).statut == "ouverte"


@pytest.mark.parametrize("acteur,attendu", [("cx_a", 200), ("am_a", 403), ("am_a2", 403), ("am_b", 403), ("cx_b", 403), ("admin", 403)])
def test_confirmer_la_resolution_est_reserve_au_cx_manager_de_l_organisation(ctx, acteur, attendu):
    iid = _creer_issue(ctx)
    aid = _creer_action(ctx, iid).json()["id"]
    assert ctx.call("cx_a", "post", f"/issues/{iid}/actions/{aid}/terminer").status_code == 200
    r = ctx.call(acteur, "post", f"/issues/{iid}/verifier")
    assert r.status_code == attendu, r.text
    assert _issue(ctx, iid).statut == ("verifiee" if attendu == 200 else "resolue")


@pytest.mark.parametrize("acteur,attendu", [("cx_a", 200), ("am_a", 200), ("am_a2", 403), ("am_b", 403), ("cx_b", 403), ("admin", 403)])
def test_terminer_une_action_reste_ouvert_au_cx_et_a_l_agency_manager_de_l_agence(ctx, acteur, attendu):
    iid = _creer_issue(ctx)
    aid = _creer_action(ctx, iid).json()["id"]
    assert ctx.call(acteur, "post", f"/issues/{iid}/actions/{aid}/terminer").status_code == attendu


# ── 2. Responsable dans le périmètre ──────────────────────────────────────────────────────────────────────────────────────────

def test_responsable_de_la_meme_agence_et_cx_manager_acceptes_et_ils_peuvent_ouvrir_le_probleme(ctx):
    iid = _creer_issue(ctx)                                                      # agence A
    for responsable in (ctx.am_a, ctx.cx_a):
        r = _creer_action(ctx, iid, responsable_id=str(responsable))
        assert r.status_code == 201, r.text
        assert r.json()["responsable_id"] == str(responsable)
    # le responsable désigné peut réellement ouvrir le problème : plus de « 201 puis 403 »
    assert ctx.call("am_a", "get", f"/issues/{iid}").status_code == 200


def test_responsable_d_une_autre_agence_refuse_avec_un_message_clair(ctx):
    iid = _creer_issue(ctx)                                                      # agence A ; am_a2 appartient à l'agence A2
    r = _creer_action(ctx, iid, responsable_id=str(ctx.am_a2))
    assert r.status_code == 400
    assert "n'appartient pas à l'agence de l'Issue" in r.json()["detail"]
    assert ctx.call("am_a2", "get", f"/issues/{iid}").status_code == 403         # c'est bien ce 403 qu'on évite à la personne désignée
    assert _actions(ctx, iid) == []


@pytest.mark.parametrize("responsable", ["am_b", "cx_b"])
def test_responsable_d_une_autre_organisation_refuse(ctx, responsable):
    iid = _creer_issue(ctx)
    r = _creer_action(ctx, iid, responsable_id=str(getattr(ctx, responsable)))
    assert r.status_code == 400
    assert "même organisation" in r.json()["detail"]
    assert _actions(ctx, iid) == []


def test_responsable_inactif_refuse(ctx):
    iid = _creer_issue(ctx)
    _modifier(ctx, Utilisateur, ctx.am_a, active=False)
    r = _creer_action(ctx, iid, responsable_id=str(ctx.am_a))
    assert r.status_code == 400
    assert "désactivé" in r.json()["detail"]
    assert _actions(ctx, iid) == []


def test_responsable_inexistant_refuse(ctx):
    r = _creer_action(ctx, _creer_issue(ctx), responsable_id=str(uuid4()))
    assert r.status_code == 400 and "introuvable" in r.json()["detail"]


def test_aucune_route_ne_modifie_une_action_existante():
    """Il n'existe pas de route de modification d'une action : le périmètre du responsable est donc contrôlé à la seule création. Si une route PATCH/PUT est un jour
    ajoutée, ce test échoue et impose d'y appliquer `_verifier_responsable`."""
    methodes = {(m, r.path) for r in issues.router.routes if "/actions" in r.path for m in r.methods}
    assert methodes == {("POST", "/{issue_id}/actions"), ("POST", "/{issue_id}/actions/{action_id}/terminer")}


# ── 1. Terminer une action : idempotent ───────────────────────────────────────────────────────────────────────────────────────

def test_terminer_deux_fois_ne_reecrit_ni_la_date_ni_l_historique_ni_la_resolution(ctx):
    iid = _creer_issue(ctx)
    aid = _creer_action(ctx, iid).json()["id"]
    premiere = ctx.call("cx_a", "post", f"/issues/{iid}/actions/{aid}/terminer")
    assert premiere.status_code == 200
    resolution = _issue(ctx, iid).date_resolution
    assert resolution is not None
    seconde = ctx.call("am_a", "post", f"/issues/{iid}/actions/{aid}/terminer")            # un autre acteur, plus tard : même réponse, rien n'est réécrit
    assert seconde.status_code == 200
    assert seconde.json() == premiere.json()
    assert seconde.json()["date_completion"] == premiere.json()["date_completion"]
    assert _issue(ctx, iid).date_resolution == resolution
    assert _evenements(ctx, iid, "action_terminee") == 1
    assert _evenements(ctx, iid, "issue_resolue") == 1


def test_terminer_une_action_deja_terminee_ne_fait_pas_reculer_un_probleme_verifie(ctx):
    iid = _creer_issue(ctx)
    aid = _creer_action(ctx, iid).json()["id"]
    ctx.call("cx_a", "post", f"/issues/{iid}/actions/{aid}/terminer")
    assert ctx.call("cx_a", "post", f"/issues/{iid}/verifier").status_code == 200
    r = ctx.call("cx_a", "post", f"/issues/{iid}/actions/{aid}/terminer")
    assert r.status_code == 200
    assert _issue(ctx, iid).statut == "verifiee"
    assert _evenements(ctx, iid, "issue_resolue") == 1


def test_terminer_une_action_inexistante_reste_404(ctx):
    assert ctx.call("cx_a", "post", f"/issues/{_creer_issue(ctx)}/actions/{uuid4()}/terminer").status_code == 404


# ── 4. Action annulée : le modèle la prévoit (statut « annulee »), elle ne bloque plus la résolution ─────────────────────────────

def test_une_action_annulee_ne_bloque_pas_la_resolution(ctx):
    iid = _creer_issue(ctx)
    a1 = _creer_action(ctx, iid, titre="Action 1").json()["id"]
    a2 = _creer_action(ctx, iid, titre="Action 2").json()["id"]
    _modifier(ctx, ActionCorrective, _u(a2), statut="annulee")          # aucune route d'annulation n'existe encore : écriture directe
    r = ctx.call("cx_a", "post", f"/issues/{iid}/actions/{a1}/terminer")
    assert r.status_code == 200
    issue = _issue(ctx, iid)
    assert issue.statut == "resolue" and issue.date_resolution is not None


def test_une_action_encore_a_faire_bloque_toujours_la_resolution(ctx):
    iid = _creer_issue(ctx)
    a1 = _creer_action(ctx, iid, titre="Action 1").json()["id"]
    _creer_action(ctx, iid, titre="Action 2")
    ctx.call("cx_a", "post", f"/issues/{iid}/actions/{a1}/terminer")
    assert _issue(ctx, iid).statut == "action_en_cours"


def test_une_action_annulee_ne_peut_pas_etre_terminee(ctx):
    iid = _creer_issue(ctx)
    aid = _creer_action(ctx, iid).json()["id"]
    _modifier(ctx, ActionCorrective, _u(aid), statut="annulee")
    r = ctx.call("cx_a", "post", f"/issues/{iid}/actions/{aid}/terminer")
    assert r.status_code == 409
    assert _actions(ctx, iid)[0].statut == "annulee" and _actions(ctx, iid)[0].date_completion is None
    assert _issue(ctx, iid).statut != "resolue"


# ── 5. Dates en UTC (une preuve par colonne ; le fuseau réel d'une session est dans le test Postgres) ─────────────────────────

@pytest.fixture()
def espion(monkeypatch):
    """Remplace `datetime` du module des endpoints par une sous-classe dont `now` consigne le fuseau demandé (None = heure locale naïve)."""
    appels = []

    class DatetimeEspion(datetime):
        @classmethod
        def now(cls, tz=None):
            appels.append(tz)
            return datetime.now(tz)

    monkeypatch.setattr(issues, "datetime", DatetimeEspion)
    return appels


def _proche_de_maintenant_utc(valeur):
    lue = valeur if valeur.tzinfo else valeur.replace(tzinfo=UTC)
    return abs(datetime.now(UTC) - lue) < timedelta(seconds=60)


def test_derniere_detection_ecrite_en_utc_a_la_creation_avec_avis(ctx, espion):
    r = ctx.call("cx_a", "post", "/issues/", json={"titre": "Avec avis", "agence_id": str(ctx.agence_a), "feedback_ids": [str(ctx.fb_a)]})
    assert r.status_code == 201, r.text
    assert UTC in espion and None not in espion, f"datetime.now doit recevoir le fuseau UTC, reçu : {espion}"
    assert _proche_de_maintenant_utc(_issue(ctx, r.json()["id"]).derniere_detection)


def test_derniere_detection_ecrite_en_utc_au_rattachement_d_un_avis(ctx, espion):
    iid = _creer_issue(ctx)
    espion.clear()
    r = ctx.call("cx_a", "patch", f"/issues/{iid}/rattacher-feedback/{ctx.fb_a}")
    assert r.status_code == 200, r.text
    assert UTC in espion and None not in espion
    assert _proche_de_maintenant_utc(_issue(ctx, iid).derniere_detection)


def test_date_completion_et_date_resolution_ecrites_en_utc(ctx, espion):
    iid = _creer_issue(ctx)
    aid = _creer_action(ctx, iid).json()["id"]
    espion.clear()
    r = ctx.call("cx_a", "post", f"/issues/{iid}/actions/{aid}/terminer")
    assert r.status_code == 200
    assert espion.count(UTC) == 2 and None not in espion, f"date_completion et date_resolution : deux écritures UTC attendues, reçu : {espion}"
    assert _proche_de_maintenant_utc(_actions(ctx, iid)[0].date_completion)
    assert _proche_de_maintenant_utc(_issue(ctx, iid).date_resolution)


def test_date_verification_ecrite_en_utc(ctx, espion):
    iid = _creer_issue(ctx)
    aid = _creer_action(ctx, iid).json()["id"]
    ctx.call("cx_a", "post", f"/issues/{iid}/actions/{aid}/terminer")
    espion.clear()
    assert ctx.call("cx_a", "post", f"/issues/{iid}/verifier").status_code == 200
    assert espion == [UTC]
    assert _proche_de_maintenant_utc(_issue(ctx, iid).date_verification)


def test_le_fichier_des_endpoints_n_ecrit_plus_aucune_date_en_heure_locale():
    source = open(issues.__file__, encoding="utf8").read()
    assert "datetime.now()" not in source, "plus aucun datetime.now() naïf dans issues.py"


# ── 6. Nom du responsable (lu dans `utilisateurs`, sans colonne ni migration) ─────────────────────────────────────────────────

def test_le_nom_du_responsable_est_renvoye_et_lisible_par_l_agency_manager(ctx):
    iid = _creer_issue(ctx)
    cree = _creer_action(ctx, iid, titre="Avec responsable", responsable_id=str(ctx.am_a))
    sans = _creer_action(ctx, iid, titre="Sans responsable")
    assert cree.json()["responsable_nom"] == "AM-A N"
    assert sans.json()["responsable_nom"] is None
    detail = ctx.call("am_a", "get", f"/issues/{iid}")                             # l'Agency Manager ne peut pas lister les utilisateurs : le nom vient de l'action
    assert detail.status_code == 200
    noms = {a["titre"]: a["responsable_nom"] for a in detail.json()["actions"]}
    assert noms == {"Avec responsable": "AM-A N", "Sans responsable": None}
