"""
CX-01 — indicateurs du siège : valeurs EXACTES sur un jeu de données écrit à la main (voir tests/_jeu_donnees_cx.py).

Critères couverts : CSAT global, nombre d'avis, nombre d'avis critiques, leur évolution, répartition des sentiments, période
sélectionnable, seules les données de MON organisation (autre organisation, agence désactivée, avis hors période exclus).
Sources : GET /dashboard/statistics/cx (page siège du dashboard) et GET /dashboard/siege (ancienne vue, mêmes définitions).
"""
import pytest

from tests._jeu_donnees_cx import construire


@pytest.fixture(scope="module")
def ctx():
    return construire()


def lire(ctx, acteur, url, **params):
    r = ctx.client.get(url, headers=ctx.H(getattr(ctx.ids, acteur)), params=params)
    assert r.status_code == 200, r.text
    return r.json()


def stats(ctx, acteur="cx_a", **params):
    return lire(ctx, acteur, "/dashboard/statistics/cx", **params)


def sentiments(donnees):
    return {s["sentiment"]: (s["count"], s["pourcentage"]) for s in donnees}


# ───────────────────────── période de 30 jours : toutes les valeurs ─────────────────────────

def test_csat_global_et_son_evolution_en_points(ctx):
    k = stats(ctx, jours=30)["kpis"]["satisfaction"]
    assert k["status"] == "ok"
    assert (k["valeur"], k["valeur_num"]) == ("50.0%", 50.0)               # 4 avis notés 4 ou 5 sur 8
    assert k["valeur_precedente"] == 75.0                                   # 3 sur 4 sur les 30 jours d'avant
    assert (k["evolution"], k["is_positive"]) == ("-25.0 pts", False)       # écart en POINTS, défavorable


def test_nombre_d_avis_et_son_evolution_en_pourcentage(ctx):
    k = stats(ctx, jours=30)["kpis"]["total_feedbacks"]
    assert (k["valeur"], k["valeur_num"], k["valeur_precedente"]) == (8, 8.0, 4)
    assert (k["evolution"], k["is_positive"]) == ("+100.0%", True)           # 4 -> 8, plus de voix clients : favorable


def test_nombre_d_avis_critiques_et_son_evolution(ctx):
    k = stats(ctx, jours=30)["kpis"]["alertes_critiques"]
    assert (k["valeur"], k["valeur_precedente"]) == (2, 1)                   # a1-04 et a1-05 ; a1-p3 avant
    assert (k["evolution"], k["is_positive"]) == ("+100.0%", False)          # plus d'avis critiques : défavorable
    synthese = stats(ctx, jours=30)["alertes_synthese"]
    assert (synthese["total_critiques"], synthese["evolution_pct"], synthese["evolution_positive"]) == (2, "+100.0%", False)


def test_repartition_des_sentiments_comptes_et_pourcentages(ctx):
    r = sentiments(stats(ctx, jours=30)["sentiments"])
    assert r == {"positif": (3, 37.5), "neutre": (1, 12.5), "negatif": (4, 50.0)}
    assert sum(c for c, _ in r.values()) == 8
    assert sum(p for _, p in r.values()) == 100.0


def test_avis_positifs_negatifs_et_notes_faibles(ctx):
    k = stats(ctx, jours=30)["kpis"]
    assert (k["feedbacks_positifs"]["valeur"], k["feedbacks_positifs"]["valeur_precedente"]) == (4, 3)
    # négatif = note ≤ 2 OU ton négatif, chaque avis une seule fois : a1-04, a1-05, a1-06 (5 étoiles mais ton négatif), a2-02
    assert (k["feedbacks_negatifs"]["valeur"], k["feedbacks_negatifs"]["valeur_precedente"]) == (4, 1)
    assert (k["feedbacks_notes_faibles"]["valeur"], k["feedbacks_notes_faibles"]["valeur_precedente"]) == (3, 1)   # notes 1 ou 2 : a1-04, a1-05, a2-02


def test_alertes_critiques_du_reseau_par_agence_visibles_dans_la_meme_reponse(ctx):
    d = stats(ctx, jours=30)
    impactees = d["alertes_synthese"]["agences_impactees"]
    assert [(a["agence_nom"], a["alertes_count"], a["satisfaction_rate"]) for a in impactees] == [("Agence A1", 2, 50.0)]
    rang = {a["agence_nom"]: a for a in d["agences_ranking"]}
    assert rang["Agence A1"]["alertes_critiques"] == 2 and rang["Agence A2"]["alertes_critiques"] == 0
    assert any(i["id"] == "insight-alertes" for i in d["insights_ia"])


def test_classement_par_agence_valeurs_et_evolution_en_points(ctx):
    rang = {a["agence_nom"]: a for a in stats(ctx, jours=30)["agences_ranking"]}
    assert set(rang) == {"Agence A1", "Agence A2"}                           # ni l'agence désactivée, ni une autre organisation
    assert (rang["Agence A1"]["total_feedbacks"], rang["Agence A1"]["satisfaction_rate"], rang["Agence A1"]["tendance_val"]) == (6, 50.0, "-16.7 pts")
    assert (rang["Agence A2"]["total_feedbacks"], rang["Agence A2"]["satisfaction_rate"], rang["Agence A2"]["tendance_val"]) == (2, 50.0, "-50.0 pts")


def test_organisation_et_periode_dans_la_reponse(ctx):
    d = stats(ctx, jours=30)
    assert d["organisation_nom"] == "Organisation A" and d["periode_jours"] == 30


# ───────────────────────── la période est sélectionnable ─────────────────────────

def test_periode_de_7_jours(ctx):
    d = stats(ctx, jours=7)
    k = d["kpis"]
    assert k["total_feedbacks"]["valeur"] == 2 and k["total_feedbacks"]["valeur_precedente"] == 3          # a1-01, a1-04 ; avant a1-02, a1-03, a2-01
    assert (k["total_feedbacks"]["evolution"], k["total_feedbacks"]["is_positive"]) == ("-33.3%", False)       # 3 -> 2 avis
    assert (k["satisfaction"]["valeur_num"], k["satisfaction"]["valeur_precedente"], k["satisfaction"]["evolution"]) == (50.0, 66.7, "-16.7 pts")
    assert k["alertes_critiques"]["valeur"] == 1 and k["alertes_critiques"]["valeur_precedente"] == 0
    assert k["alertes_critiques"]["evolution"] is None                      # rien à comparer : 0 avis critique avant
    assert sentiments(d["sentiments"]) == {"positif": (1, 50.0), "neutre": (0, 0.0), "negatif": (1, 50.0)}


def test_periode_de_60_jours(ctx):
    k = stats(ctx, jours=60)["kpis"]
    assert k["total_feedbacks"]["valeur"] == 12 and k["total_feedbacks"]["valeur_precedente"] == 1         # a1-ancien (70 j) seul avant
    assert k["total_feedbacks"]["evolution"] == "+1100.0%"
    assert (k["satisfaction"]["valeur_num"], k["satisfaction"]["valeur_precedente"], k["satisfaction"]["evolution"]) == (58.3, 0.0, "+58.3 pts")
    assert (k["alertes_critiques"]["valeur"], k["alertes_critiques"]["valeur_precedente"], k["alertes_critiques"]["evolution"]) == (3, 1, "+200.0%")


def test_periode_de_90_jours_sans_periode_precedente(ctx):
    k = stats(ctx, jours=90)["kpis"]
    assert k["total_feedbacks"]["valeur"] == 13                              # les 12 avis des 60 jours + a1-ancien
    assert k["satisfaction"]["valeur_num"] == 53.8                           # 7 sur 13
    assert k["alertes_critiques"]["valeur"] == 4
    for nom in ("total_feedbacks", "satisfaction", "alertes_critiques"):
        assert k[nom]["evolution"] is None, nom                              # aucun avis entre 90 et 180 jours : pas de comparaison
    assert k["satisfaction"]["valeur_precedente"] is None


def test_periode_par_defaut_30_jours_et_limites_de_validation(ctx):
    assert stats(ctx)["periode_jours"] == 30
    assert stats(ctx)["kpis"]["total_feedbacks"]["valeur"] == stats(ctx, jours=30)["kpis"]["total_feedbacks"]["valeur"]
    for jours in (0, -5, 366, 1000):
        r = ctx.client.get("/dashboard/statistics/cx", headers=ctx.H(ctx.ids.cx_a), params={"jours": jours})
        assert r.status_code == 422, jours
    assert stats(ctx, jours=1)["periode_jours"] == 1 and stats(ctx, jours=365)["periode_jours"] == 365


# ───────────────────────── filtre par agence du siège ─────────────────────────

def test_filtre_par_agence_de_mon_organisation(ctx):
    d = stats(ctx, jours=30, agence_id=str(ctx.ids.ag_A2))
    assert d["agence_filtree_nom"] == "Agence A2"
    k = d["kpis"]
    assert (k["total_feedbacks"]["valeur"], k["total_feedbacks"]["valeur_precedente"]) == (2, 1)
    assert (k["satisfaction"]["valeur_num"], k["satisfaction"]["valeur_precedente"], k["satisfaction"]["evolution"]) == (50.0, 100.0, "-50.0 pts")
    assert k["alertes_critiques"]["valeur"] == 0


@pytest.mark.parametrize("agence", ["ag_B1", "ag_D1", "ag_A3"])
def test_agence_d_une_autre_organisation_ou_desactivee_ne_donne_aucune_donnee(ctx, agence):
    d = stats(ctx, jours=30, agence_id=str(getattr(ctx.ids, agence)))
    assert d["agence_filtree_nom"] is None
    assert d["kpis"]["total_feedbacks"]["valeur"] == 0
    assert d["kpis"]["satisfaction"]["status"] == "no_data" and d["kpis"]["satisfaction"]["valeur"] is None   # jamais « 0 % »
    assert d["kpis"]["alertes_critiques"]["valeur"] == 0


# ───────────────────────── seules les données de mon organisation ─────────────────────────

def test_l_organisation_b_ne_voit_que_ses_avis(ctx):
    d = stats(ctx, "cx_b", jours=30)
    assert d["organisation_nom"] == "Organisation B"
    k = d["kpis"]
    assert (k["total_feedbacks"]["valeur"], k["satisfaction"]["valeur_num"], k["alertes_critiques"]["valeur"]) == (2, 50.0, 1)
    assert [a["agence_nom"] for a in d["agences_ranking"]] == ["Agence B1"]
    assert sentiments(d["sentiments"]) == {"positif": (1, 50.0), "neutre": (0, 0.0), "negatif": (1, 50.0)}


def test_aucune_donnee_d_une_autre_organisation_dans_la_reponse_de_a(ctx):
    brut = ctx.client.get("/dashboard/statistics/cx", headers=ctx.H(ctx.ids.cx_a), params={"jours": 90}).text
    for interdit in ("Agence B1", "Agence D1", "Organisation B", "Organisation D", str(ctx.ids.ag_B1), str(ctx.ids.ag_D1), "Agence A3"):
        assert interdit not in brut, interdit


def test_sans_analyse_la_repartition_des_sentiments_se_deduit_des_notes(ctx):
    d = stats(ctx, "cx_d", jours=30)
    assert d["kpis"]["total_feedbacks"]["valeur"] == 3
    assert sentiments(d["sentiments"]) == {"positif": (1, 33.3), "neutre": (1, 33.3), "negatif": (1, 33.3)}   # notes 5, 3 et 1
    assert d["kpis"]["satisfaction"]["valeur_num"] == 33.3
    assert d["kpis"]["alertes_critiques"]["valeur"] == 0                      # pas d'analyse, donc pas d'avis critique inventé


@pytest.mark.parametrize("acteur,code", [("admin", 403), ("am_a1", 403)])
def test_seul_le_cx_manager_lit_les_indicateurs_du_siege(ctx, acteur, code):
    for url in ("/dashboard/statistics/cx", "/dashboard/siege"):
        assert ctx.client.get(url, headers=ctx.H(getattr(ctx.ids, acteur))).status_code == code, (acteur, url)
    assert ctx.client.get("/dashboard/statistics/cx").status_code == 401


# ───────────────────────── ancienne vue /dashboard/siege : mêmes définitions ─────────────────────────

def test_dashboard_siege_valeurs_exactes(ctx):
    d = lire(ctx, "cx_a", "/dashboard/siege", jours=30)
    assert d["feedbacks_total"] == 8 and d["taux_satisfaction_global"] == 50.0 and d["agences_actives"] == 2
    assert d["nombre_critiques"] == 2 and d["nombre_discordances"] == 1
    assert (d["evolution_feedbacks_total"], d["evolution_feedbacks_total_positive"]) == ("+100.0%", True)
    assert (d["evolution_satisfaction"], d["evolution_satisfaction_positive"]) == ("-25.0 pts", False)
    assert sentiments(d["sentiments_globaux"]) == {"negatif": (4, 50.0), "positif": (3, 37.5), "neutre": (1, 12.5)}
    assert {(t["theme"], t["count"], t["pourcentage"]) for t in d["themes_globaux"]} == {("attente", 4, 50.0), ("accueil", 3, 37.5), ("facturation", 1, 12.5)}
    agences = {a["agence_nom"]: a for a in d["agences"]}
    assert set(agences) == {"Agence A1", "Agence A2"}
    assert (agences["Agence A1"]["nombre_feedbacks"], agences["Agence A1"]["taux_satisfaction"], agences["Agence A1"]["nombre_negatifs"]) == (6, 50.0, 3)
    assert (agences["Agence A2"]["nombre_feedbacks"], agences["Agence A2"]["taux_satisfaction"], agences["Agence A2"]["nombre_negatifs"]) == (2, 50.0, 1)


def test_les_deux_sources_du_siege_donnent_les_memes_chiffres(ctx):
    for jours in (7, 30, 60, 90):
        ancien = lire(ctx, "cx_a", "/dashboard/siege", jours=jours)
        page = stats(ctx, jours=jours)["kpis"]
        assert ancien["feedbacks_total"] == page["total_feedbacks"]["valeur"], jours
        assert ancien["taux_satisfaction_global"] == page["satisfaction"]["valeur_num"], jours
        assert ancien["nombre_critiques"] == page["alertes_critiques"]["valeur"], jours


def test_dashboard_siege_isole_les_organisations_et_les_periodes(ctx):
    b = lire(ctx, "cx_b", "/dashboard/siege", jours=30)
    assert b["feedbacks_total"] == 2 and b["nombre_critiques"] == 1 and [a["agence_nom"] for a in b["agences"]] == ["Agence B1"]
    assert lire(ctx, "cx_a", "/dashboard/siege", jours=7)["feedbacks_total"] == 2
    assert lire(ctx, "cx_a", "/dashboard/siege", jours=90)["feedbacks_total"] == 13
