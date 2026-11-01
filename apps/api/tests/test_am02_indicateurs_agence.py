"""
AM-02 — indicateurs de MON agence : valeurs EXACTES sur le jeu de données écrit à la main de tests/_jeu_donnees_cx.py.

Critères couverts : CSAT, nombre de feedbacks, évolution par rapport à la période précédente de même durée, période choisie,
et « aucune donnée d'une autre agence n'apparaît ». Source : GET /dashboard/agence/{id} (vue d'ensemble) et sa jumelle
GET /dashboard/statistics/agency (mêmes définitions).

Agence A1 sur 30 jours : a1-01 (5, positif), a1-02 (4, positif, en cours), a1-03 (3, neutre, résolu), a1-04 (2, négatif, critique),
a1-05 (1, négatif, critique), a1-06 (5 étoiles mais ton négatif, discordant) ; avant : a1-p1 (5), a1-p2 (4), a1-p3 (2, critique).
"""
import pytest

from tests._jeu_donnees_cx import construire


@pytest.fixture(scope="module")
def ctx():
    return construire()


def agence(ctx, acteur, cle="ag_A1", **params):
    r = ctx.client.get(f"/dashboard/agence/{getattr(ctx.ids, cle)}", headers=ctx.H(getattr(ctx.ids, acteur)), params=params)
    assert r.status_code == 200, r.text
    return r.json()


def part(donnees):
    return {s["sentiment"]: (s["count"], s["pourcentage"]) for s in donnees}


# ───────────────────────── CSAT, nombre d'avis, évolution ─────────────────────────

def test_csat_nombre_d_avis_et_evolution_exacts(ctx):
    d = agence(ctx, "am_a1", jours=30)
    assert d["agence_nom"] == "Agence A1" and d["periode"] == "30 derniers jours"
    assert d["taux_satisfaction"] == 50.0                                  # a1-01, a1-02, a1-06 sur 6
    assert d["nombre_feedbacks"] == 6
    c = d["comparaison"]
    assert c["jours"] == 30 and c["nombre_feedbacks_precedent"] == 3
    s, v = c["satisfaction"], c["total_feedbacks"]
    assert (s["valeur_num"], s["valeur_precedente"], s["evolution"], s["is_positive"]) == (50.0, 66.7, "-16.7 pts", False)    # 2 sur 3 avant
    assert (v["valeur"], v["valeur_precedente"], v["evolution"], v["is_positive"]) == (6, 3, "+100.0%", True)


def test_avis_negatifs_critiques_et_discordances(ctx):
    d = agence(ctx, "am_a1", jours=30)
    assert d["nombre_negatifs"] == 3          # a1-04 (note 2), a1-05 (note 1), a1-06 (ton négatif malgré 5 étoiles) : chaque avis une fois
    assert d["nombre_critiques"] == 2         # a1-04 et a1-05
    assert d["discordances"] == 1             # a1-06


def test_repartition_des_sentiments(ctx):
    d = agence(ctx, "am_a1", jours=30)
    assert part(d["sentiments"]) == {"positif": (2, 33.3), "neutre": (1, 16.7), "negatif": (3, 50.0)}
    assert sum(c for c, _ in part(d["sentiments"]).values()) == d["nombre_feedbacks"]


def test_cycle_de_traitement_et_avis_a_traiter(ctx):
    d = agence(ctx, "am_a1", jours=30)
    assert (d["feedbacks_nouveaux"], d["feedbacks_pris_en_charge"], d["feedbacks_resolus"], d["feedbacks_analyses_ia"]) == (4, 2, 1, 6)
    assert d["feedbacks_nouveaux"] + d["feedbacks_pris_en_charge"] == d["nombre_feedbacks"]
    assert d["taux_prise_en_charge"] == 33.3                               # 2 sur 6
    assert d["feedbacks_a_traiter"] == 5                                   # tous sauf a1-03 (résolu, sans demande de rappel)


def test_themes_classes_par_nombre_d_avis(ctx):
    d = agence(ctx, "am_a1", jours=30)
    assert [(t["theme"], t["count"], t["pourcentage"]) for t in d["themes"]] == [("attente", 3, 50.0), ("accueil", 2, 33.3), ("facturation", 1, 16.7)]


# ───────────────────────── la période est choisie ─────────────────────────

def test_periode_de_7_jours_evolution_nulle_signalee_comme_stable(ctx):
    d = agence(ctx, "am_a1", jours=7)
    assert d["nombre_feedbacks"] == 2 and d["taux_satisfaction"] == 50.0       # a1-01 (5 j), a1-04 (3 j)
    assert d["nombre_critiques"] == 1 and d["nombre_negatifs"] == 1
    c = d["comparaison"]
    assert c["nombre_feedbacks_precedent"] == 2                                # a1-02 (10 j), a1-03 (12 j)
    assert (c["satisfaction"]["valeur_precedente"], c["satisfaction"]["evolution"]) == (50.0, "+0.0 pts")
    assert (c["total_feedbacks"]["evolution"], c["total_feedbacks"]["is_positive"]) == ("+0.0%", True)


def test_periode_de_90_jours_sans_periode_precedente(ctx):
    d = agence(ctx, "am_a1", jours=90)
    assert d["nombre_feedbacks"] == 10 and d["taux_satisfaction"] == 50.0       # 5 positifs sur 10 (a1-ancien, 70 j, inclus)
    c = d["comparaison"]
    assert c["nombre_feedbacks_precedent"] == 0
    assert c["satisfaction"]["evolution"] is None and c["satisfaction"]["valeur_precedente"] is None
    assert c["total_feedbacks"]["evolution"] is None


def test_avis_hors_periode_exclus(ctx):
    d30 = agence(ctx, "am_a1", jours=30)
    d60 = agence(ctx, "am_a1", jours=60)
    assert d30["nombre_feedbacks"] == 6 and d60["nombre_feedbacks"] == 9       # a1-p1, p2, p3 entrent à 60 j ; a1-ancien (70 j) reste dehors
    assert agence(ctx, "am_a1", jours=69)["nombre_feedbacks"] == 9 and agence(ctx, "am_a1", jours=71)["nombre_feedbacks"] == 10


def test_periode_sans_avis_donnees_absentes_et_jamais_zero(ctx):
    d = agence(ctx, "am_a2", "ag_A2", jours=1)
    assert d["nombre_feedbacks"] == 0 and d["taux_satisfaction"] is None and d["taux_prise_en_charge"] is None
    assert d["comparaison"]["satisfaction"]["status"] == "no_data" and d["comparaison"]["satisfaction"]["valeur"] is None


@pytest.mark.parametrize("jours", [0, -1, 366])
def test_periode_invalide_refusee(ctx, jours):
    r = ctx.client.get(f"/dashboard/agence/{ctx.ids.ag_A1}", headers=ctx.H(ctx.ids.am_a1), params={"jours": jours})
    assert r.status_code == 422


# ───────────────────────── aucune donnée d'une autre agence ─────────────────────────

def test_l_agence_a2_a_ses_propres_valeurs(ctx):
    d = agence(ctx, "am_a2", "ag_A2", jours=30)
    assert d["agence_nom"] == "Agence A2" and d["nombre_feedbacks"] == 2 and d["taux_satisfaction"] == 50.0
    assert d["nombre_negatifs"] == 1 and d["nombre_critiques"] == 0
    c = d["comparaison"]
    assert (c["nombre_feedbacks_precedent"], c["satisfaction"]["valeur_precedente"], c["satisfaction"]["evolution"]) == (1, 100.0, "-50.0 pts")
    assert part(d["sentiments"]) == {"positif": (1, 50.0), "neutre": (0, 0.0), "negatif": (1, 50.0)}


def test_le_cx_manager_voit_chaque_agence_de_son_organisation_avec_les_memes_valeurs(ctx):
    assert agence(ctx, "cx_a", "ag_A1", jours=30) == agence(ctx, "am_a1", "ag_A1", jours=30)
    assert agence(ctx, "cx_a", "ag_A2", jours=30)["nombre_feedbacks"] == 2


@pytest.mark.parametrize("acteur,cle,code", [
    ("am_a1", "ag_A2", 403),        # autre agence de la même organisation
    ("am_a1", "ag_B1", 403),        # agence d'une autre organisation
    ("am_b1", "ag_A1", 403),
    ("cx_b", "ag_A1", 403),         # CX d'une autre organisation
    ("admin", "ag_A1", 403),        # l'administrateur n'a pas accès aux données clients
])
def test_aucun_acces_aux_indicateurs_d_une_autre_agence(ctx, acteur, cle, code):
    r = ctx.client.get(f"/dashboard/agence/{getattr(ctx.ids, cle)}", headers=ctx.H(getattr(ctx.ids, acteur)))
    assert r.status_code == code
    corps = r.text
    for interdit in ("Agence A1", "Agence A2", "Agence B1", "nombre_feedbacks", "taux_satisfaction"):
        assert interdit not in corps, interdit
    assert ctx.client.get(f"/dashboard/agence/{ctx.ids.ag_A1}").status_code == 401


def test_les_chiffres_d_une_agence_ne_contiennent_jamais_les_avis_des_autres(ctx):
    a1 = agence(ctx, "am_a1", jours=365)
    assert a1["nombre_feedbacks"] == 10                                        # 10 avis de A1 : ni les 3 de A2, ni ceux de A3, B1 ou D1
    assert agence(ctx, "am_a2", "ag_A2", jours=365)["nombre_feedbacks"] == 4              # a2-01, a2-02, a2-p1 et l'avis sans analyse (200 j)


# ───────────────────────── la vue d'ensemble et les statistiques donnent les mêmes chiffres ─────────────────────────

@pytest.mark.parametrize("jours", [7, 30, 60, 90])
def test_vue_d_ensemble_et_statistiques_de_l_agence_concordent(ctx, jours):
    vue = agence(ctx, "am_a1", jours=jours)
    r = ctx.client.get("/dashboard/statistics/agency", headers=ctx.H(ctx.ids.am_a1), params={"jours": jours})
    assert r.status_code == 200, r.text
    stats = r.json()["kpis"]
    assert stats["total_feedbacks"]["valeur"] == vue["nombre_feedbacks"]
    assert stats["satisfaction"]["valeur_num"] == vue["taux_satisfaction"]
    assert stats["satisfaction"]["evolution"] == vue["comparaison"]["satisfaction"]["evolution"]
    assert stats["total_feedbacks"]["evolution"] == vue["comparaison"]["total_feedbacks"]["evolution"]
