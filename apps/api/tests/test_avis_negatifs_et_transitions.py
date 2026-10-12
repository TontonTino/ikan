"""
Lot 6 — (A) définition unique de l'avis négatif, (B) machine à états du traitement d'un avis.

A. Négatif = note ≤ NOTE_FAIBLE_MAX (2) OU sentiment IA négatif ; chaque avis compté une fois ; un sentiment manquant
   n'est jamais déduit positif.
B. nouveau -> en_traitement (Responsable) -> en_cours (CX) -> resolu -> en_traitement (réouverture) ; tout autre
   enchaînement est refusé (409) ; une répétition n'écrit qu'un seul événement d'historique.
"""
from types import SimpleNamespace

import pytest

from app.models.enums import SentimentType
from app.services.dashboard_helpers import NOTE_FAIBLE_MAX, compter_negatifs, est_negatif
from tests.test_cycle_traitement_avis import _avis, _get, _lire, ctx  # noqa: F401  (fixture réutilisée)

# ── A. Définition pure ─────────────────────────────────────────────────────────────────────────


def _f(note, fid="x"):
    return SimpleNamespace(id=fid, note=note)


def _a(sentiment):
    return SimpleNamespace(sentiment=sentiment)


def test_seuil_de_note_faible_inchange():
    assert NOTE_FAIBLE_MAX == 2


def test_negatif_selon_note_ou_sentiment():
    assert est_negatif(_f(2), _a(SentimentType.POSITIF))        # note faible + sentiment positif
    assert est_negatif(_f(5), _a(SentimentType.NEGATIF))        # note haute + sentiment négatif
    assert est_negatif(_f(1), _a(SentimentType.NEGATIF))        # les deux
    assert not est_negatif(_f(3), _a(SentimentType.NEUTRE))
    assert not est_negatif(_f(5), _a(SentimentType.POSITIF))


def test_sentiment_manquant_n_est_jamais_positif_ni_negatif_par_defaut():
    assert est_negatif(_f(1), None)                              # la note décide seule
    assert not est_negatif(_f(4), None)                          # absence d'analyse ≠ négatif


def test_compter_negatifs_ne_double_compte_pas():
    fbs = [_f(1, "a"), _f(5, "b"), _f(2, "c"), _f(5, "d"), _f(3, "e")]
    analyses = {"a": _a(SentimentType.NEGATIF), "b": _a(SentimentType.NEGATIF), "c": _a(SentimentType.POSITIF), "d": _a(SentimentType.POSITIF)}
    assert compter_negatifs(fbs, analyses) == 3                  # a (les deux), b (sentiment), c (note) ; d et e non


# ── A. Endpoints : mêmes chiffres partout ──────────────────────────────────────────────────────


def _jeu(ctx):
    _avis(ctx, note=2, negatif=False)                            # note faible + sentiment positif
    _avis(ctx, note=5, negatif=True)                             # note haute + sentiment négatif
    _avis(ctx, note=1, negatif=True)                             # les deux
    _avis(ctx, note=4, analyse="attente")                        # sans sentiment, note haute
    _avis(ctx, note=5, negatif=False)                            # positif
    _avis(ctx, note=1, analyse="attente")                        # sans sentiment, note faible


def test_les_endpoints_donnent_le_meme_nombre_d_avis_negatifs(ctx):
    _jeu(ctx)
    attendu = 4
    assert _get(ctx, "am_a1", f"/dashboard/agence/{ctx.a1}?jours=30")["nombre_negatifs"] == attendu
    stats = _get(ctx, "am_a1", "/dashboard/statistics/agency?jours=30")["kpis"]
    assert stats["feedbacks_negatifs"]["valeur"] == attendu
    cx = _get(ctx, "cx_a", "/dashboard/statistics/cx?jours=30")["kpis"]
    assert cx["feedbacks_negatifs"]["valeur"] == attendu
    assert cx["feedbacks_notes_faibles"]["valeur"] == 3          # notes 1-2 seulement : indicateur distinct


def test_negatifs_respectent_periode_agence_et_organisation(ctx):
    _avis(ctx, "QR-A1", note=1, jours=2)
    _avis(ctx, "QR-A1", note=1, jours=40)                        # hors période
    _avis(ctx, "QR-A2", note=1, jours=2)                         # autre agence, même organisation
    _avis(ctx, "QR-B1", note=1, jours=2)                         # autre organisation
    assert _get(ctx, "am_a1", f"/dashboard/agence/{ctx.a1}?jours=30")["nombre_negatifs"] == 1
    assert _get(ctx, "am_a1", f"/dashboard/agence/{ctx.a1}?jours=90")["nombre_negatifs"] == 2
    assert _get(ctx, "cx_a", "/dashboard/statistics/cx?jours=30")["kpis"]["feedbacks_negatifs"]["valeur"] == 2
    assert _get(ctx, "cx_b", "/dashboard/statistics/cx?jours=30")["kpis"]["feedbacks_negatifs"]["valeur"] == 1


# ── B. Transitions ─────────────────────────────────────────────────────────────────────────────


def _post(ctx, acteur, fid, route, **kw):
    return ctx.client.post(f"/feedbacks/{fid}/{route}", headers=ctx.H(getattr(ctx, acteur)), **kw)


ACTION = {"json": {"action": "Rappeler le client"}}


def test_parcours_nominal_complet(ctx):
    fid = _avis(ctx)
    assert _post(ctx, "am_a1", fid, "prendre-en-charge").status_code == 200
    assert _post(ctx, "cx_a", fid, "action-cx", **ACTION).json()["statut_traitement"] == "en_cours"
    assert _post(ctx, "am_a1", fid, "confirmer-action").json()["statut_traitement"] == "resolu"
    assert _post(ctx, "am_a1", fid, "reouvrir").json()["statut_traitement"] == "en_traitement"
    assert _lire(ctx, fid).types == ["prise_en_charge", "action_definie", "action_realisee", "reouverture"]


def test_le_siege_ne_peut_pas_sauter_la_prise_en_charge(ctx):
    fid = _avis(ctx)
    r = _post(ctx, "cx_a", fid, "action-cx", **ACTION)
    assert r.status_code == 409
    etat = _lire(ctx, fid)
    assert (etat.statut, etat.nb_hist) == ("nouveau", 0)


@pytest.mark.parametrize("statut", ["nouveau", "en_traitement"])
def test_confirmer_sans_action_definie_est_refuse(ctx, statut):
    fid = _avis(ctx, statut=statut)
    assert _post(ctx, "am_a1", fid, "confirmer-action").status_code == 409
    assert _lire(ctx, fid).statut == statut


@pytest.mark.parametrize("statut", ["nouveau", "en_traitement", "en_cours"])
def test_reouvrir_un_avis_non_resolu_est_refuse(ctx, statut):
    fid = _avis(ctx, statut=statut)
    assert _post(ctx, "am_a1", fid, "reouvrir").status_code == 409
    assert _lire(ctx, fid).statut == statut


def test_un_avis_resolu_ne_redevient_jamais_nouveau(ctx):
    fid = _avis(ctx, statut="resolu")
    assert _post(ctx, "am_a1", fid, "prendre-en-charge").status_code == 200   # sans effet
    assert _post(ctx, "cx_a", fid, "action-cx", **ACTION).status_code == 409
    assert _lire(ctx, fid).statut == "resolu"
    assert _post(ctx, "am_a1", fid, "reouvrir").status_code == 200
    assert _lire(ctx, fid).statut == "en_traitement"


def test_repetitions_sans_doublon_d_historique(ctx):
    fid = _avis(ctx)
    _post(ctx, "am_a1", fid, "prendre-en-charge")
    for _ in range(3):
        assert _post(ctx, "cx_a", fid, "action-cx", **ACTION).status_code == 200
    for _ in range(3):
        assert _post(ctx, "am_a1", fid, "confirmer-action").status_code == 200
    assert _lire(ctx, fid).types == ["prise_en_charge", "action_definie", "action_realisee"]


def test_action_differente_sur_avis_deja_en_cours_est_refusee(ctx):
    fid = _avis(ctx, statut="en_traitement")
    _post(ctx, "cx_a", fid, "action-cx", **ACTION)
    assert _post(ctx, "cx_a", fid, "action-cx", json={"action": "Autre"}).status_code == 409


@pytest.mark.parametrize("acteur,attendu", [("am_a1", 403), ("am_a2", 403), ("cx_b", 403), ("admin", 403)])
def test_definir_l_action_est_reserve_au_cx_de_l_organisation(ctx, acteur, attendu):
    fid = _avis(ctx, statut="en_traitement")
    r = _post(ctx, acteur, fid, "action-cx", **ACTION)
    assert r.status_code in (attendu, 404)
    assert _lire(ctx, fid).statut == "en_traitement"


@pytest.mark.parametrize("acteur", ["am_a2", "am_b1", "cx_b"])
def test_confirmer_et_reouvrir_hors_perimetre_sont_refuses(ctx, acteur):
    fid = _avis(ctx, statut="en_cours")
    assert _post(ctx, acteur, fid, "confirmer-action").status_code in (403, 404)
    fid2 = _avis(ctx, statut="resolu")
    assert _post(ctx, acteur, fid2, "reouvrir").status_code in (403, 404)
    assert _lire(ctx, fid).statut == "en_cours" and _lire(ctx, fid2).statut == "resolu"


def test_effet_sur_les_indicateurs_de_prise_en_charge(ctx):
    fid = _avis(ctx)
    avant = _get(ctx, "am_a1", f"/dashboard/agence/{ctx.a1}")
    assert (avant["feedbacks_nouveaux"], avant["feedbacks_pris_en_charge"]) == (1, 0)
    _post(ctx, "cx_a", fid, "action-cx", **ACTION)               # refusé : rien ne bouge
    assert _get(ctx, "am_a1", f"/dashboard/agence/{ctx.a1}")["feedbacks_pris_en_charge"] == 0
    _post(ctx, "am_a1", fid, "prendre-en-charge")
    apres = _get(ctx, "am_a1", f"/dashboard/agence/{ctx.a1}")
    assert (apres["feedbacks_nouveaux"], apres["feedbacks_pris_en_charge"], apres["feedbacks_resolus"]) == (0, 1, 0)
