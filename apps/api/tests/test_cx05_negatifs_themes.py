"""
CX-05 — part d'avis négatifs + évolution, thèmes agrégés en SQL sur toute la période, clic sur un thème.

Définition de « négatif » : celle de dashboard_helpers.est_negatif (note <= 2 OU sentiment négatif), jamais redéfinie.
Vrai routeur, vrai JWT, SQLite en mémoire, deux organisations (A : agences A1 et A2, B : agence B1).
"""
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from app.core.erreurs_validation import installer_erreurs_validation
from app.models.analyse_ia import AnalyseIA
from app.models.enums import CriticiteType, SentimentType
from app.models.feedback import Feedback
from tests.test_cycle_traitement_avis import ctx  # noqa: F401  (fixture réutilisée)


def creer(ctx, code="QR-A1", note=1, jours=1.0, theme=None, sentiment=None, nombre=1):
    """`nombre` avis identiques, `jours` jours avant maintenant. theme/sentiment None : pas d'analyse IA."""
    db = ctx.Session()
    for i in range(nombre):
        fb = Feedback(id=uuid4(), qr_code_id=ctx.qr[code], note=note, commentaire=f"avis {i}", statut_traitement="nouveau",
                      date_soumission=datetime.now(timezone.utc) - timedelta(days=jours, minutes=i))
        db.add(fb); db.flush()
        if theme is not None or sentiment is not None:
            db.add(AnalyseIA(id=uuid4(), feedback_id=fb.id, sentiment=sentiment or SentimentType.NEUTRE, criticite=CriticiteType.FAIBLE,
                             score_sentiment=0.5, theme_principal=theme))
    db.commit()
    db.close()


def get(ctx, acteur, url, statut=200):
    r = ctx.client.get(url, headers=ctx.H(getattr(ctx, acteur)))
    assert r.status_code == statut, r.text
    return r.json()


def stats(ctx, acteur="cx_a", jours=30, extra=""):
    return get(ctx, acteur, f"/dashboard/statistics/cx?jours={jours}{extra}")


# ── Partie 1 : part d'avis négatifs ────────────────────────────────────────────────────────────


def test_periode_vide_aucune_part_et_aucun_zero_invente(ctx):
    pn = stats(ctx)["part_negatifs"]
    assert pn["total"] == 0 and pn["part"] is None and pn["evolution_pts"] is None and pn["statut_evolution"] == "sans_avis"


def test_un_seul_avis_negatif_donne_100_pour_cent_sans_comparaison(ctx):
    creer(ctx, note=1)
    pn = stats(ctx)["part_negatifs"]
    assert (pn["negatifs"], pn["total"], pn["part"]) == (1, 1, 100.0)
    assert pn["statut_evolution"] == "insuffisant" and pn["evolution_pts"] is None


def test_cas_limite_note_3_et_note_2(ctx):
    creer(ctx, note=3)                                                   # 3 sans sentiment négatif : pas négatif
    creer(ctx, note=2)                                                   # 2 : négatif (note faible)
    creer(ctx, note=3, theme="x", sentiment=SentimentType.NEGATIF)       # 3 mais sentiment négatif : négatif
    creer(ctx, note=5, theme="x", sentiment=SentimentType.POSITIF)
    pn = stats(ctx)["part_negatifs"]
    assert (pn["negatifs"], pn["total"], pn["part"]) == (2, 4, 50.0)


def test_meme_nombre_que_l_indicateur_existant_un_avis_une_seule_fois(ctx):
    creer(ctx, note=1, theme="x", sentiment=SentimentType.NEGATIF, nombre=3)     # note faible ET sentiment négatif : compté une fois
    creer(ctx, note=5, theme="x", sentiment=SentimentType.POSITIF, nombre=2)
    donnees = stats(ctx)
    assert donnees["kpis"]["feedbacks_negatifs"]["valeur"] == donnees["part_negatifs"]["negatifs"] == 3
    assert donnees["part_negatifs"]["part"] == 60.0


def test_agence_sans_avis_part_absente_et_agences_separees(ctx):
    creer(ctx, "QR-A1", note=1, nombre=2)
    creer(ctx, "QR-A1", note=5, nombre=2)
    par_agence = {a["agence_nom"]: a["part_negatifs"] for a in stats(ctx)["agences_ranking"]}
    assert par_agence["Agence A1"]["part"] == 50.0 and par_agence["Agence A1"]["total"] == 4
    assert par_agence["Agence A2"]["part"] is None and par_agence["Agence A2"]["total"] == 0
    assert par_agence["Agence A2"]["statut_evolution"] == "sans_avis"


def test_evolution_en_points_periode_precedente_suffisante(ctx):
    creer(ctx, note=1, jours=45, nombre=1)                  # période précédente : 5 avis dont 1 négatif = 20 %
    creer(ctx, note=5, jours=45, nombre=4)
    creer(ctx, note=1, jours=5, nombre=2)                   # période courante : 4 avis dont 2 négatifs = 50 %
    creer(ctx, note=5, jours=5, nombre=2)
    pn = stats(ctx)["part_negatifs"]
    assert (pn["part"], pn["part_precedente"], pn["total_precedent"]) == (50.0, 20.0, 5)
    assert pn["statut_evolution"] == "ok" and pn["evolution_pts"] == 30.0     # positif = plus d'avis négatifs


def test_evolution_negative_quand_la_part_baisse(ctx):
    creer(ctx, note=1, jours=45, nombre=4)                  # précédente : 4/5 = 80 %
    creer(ctx, note=5, jours=45, nombre=1)
    creer(ctx, note=1, jours=5, nombre=1)                   # courante : 1/5 = 20 %
    creer(ctx, note=5, jours=5, nombre=4)
    assert stats(ctx)["part_negatifs"]["evolution_pts"] == -60.0


def test_periode_precedente_insuffisante_4_avis_pas_de_comparaison(ctx):
    creer(ctx, note=1, jours=45, nombre=4)                  # 4 avis < 5
    creer(ctx, note=1, jours=5, nombre=2)
    pn = stats(ctx)["part_negatifs"]
    assert pn["statut_evolution"] == "insuffisant" and pn["evolution_pts"] is None and pn["total_precedent"] == 4


def test_periode_precedente_exactement_5_avis_est_suffisante(ctx):
    creer(ctx, note=5, jours=45, nombre=5)
    creer(ctx, note=1, jours=5, nombre=1)
    pn = stats(ctx)["part_negatifs"]
    assert pn["statut_evolution"] == "ok" and pn["evolution_pts"] == 100.0


def test_periode_precedente_sans_negatif_a_zero_pour_cent(ctx):
    creer(ctx, note=5, jours=45, nombre=6)                  # précédente : 0 % (suffisante)
    creer(ctx, note=1, jours=5, nombre=1)
    creer(ctx, note=5, jours=5, nombre=3)
    pn = stats(ctx)["part_negatifs"]
    assert pn["part_precedente"] == 0.0 and pn["evolution_pts"] == 25.0


def test_part_negatifs_isolee_par_organisation(ctx):
    creer(ctx, "QR-A1", note=1, nombre=2)
    creer(ctx, "QR-B1", note=5, nombre=3)
    assert stats(ctx, "cx_a")["part_negatifs"]["total"] == 2
    pn_b = stats(ctx, "cx_b")["part_negatifs"]
    assert (pn_b["total"], pn_b["part"]) == (3, 0.0)
    noms_b = {a["agence_nom"] for a in stats(ctx, "cx_b")["agences_ranking"]}
    assert noms_b == {"Agence B1"}


def test_jours_invalide_422_sans_echo_de_la_valeur(ctx):
    installer_erreurs_validation(ctx.client.app)                      # gestionnaire de production (app/main.py)
    for valeur in ("abc", "0", "9999", "-5"):
        r = ctx.client.get(f"/dashboard/statistics/cx?jours={valeur}", headers=ctx.H(ctx.cx_a))
        assert r.status_code == 422
    r = ctx.client.get("/dashboard/statistics/cx?jours=SECRET-VALEUR-123", headers=ctx.H(ctx.cx_a))
    assert r.status_code == 422 and "SECRET-VALEUR-123" not in r.text
    r = ctx.client.get("/feedbacks/themes/synthese?jours=SECRET-VALEUR-123", headers=ctx.H(ctx.cx_a))
    assert r.status_code == 422 and "SECRET-VALEUR-123" not in r.text


# ── Partie 2 : thèmes ──────────────────────────────────────────────────────────────────────────


def test_les_themes_couvrent_toute_la_periode_au_dela_de_200_avis(ctx):
    creer(ctx, note=5, theme="attente", sentiment=SentimentType.POSITIF, nombre=230)
    creer(ctx, note=5, theme="accueil", sentiment=SentimentType.POSITIF, nombre=10, jours=20)
    donnees = stats(ctx)
    attente = next(t for t in donnees["themes"] if t["theme"] == "attente")
    assert attente["count"] == 230 and donnees["themes_total_avis"] == 240
    synthese = get(ctx, "cx_a", "/feedbacks/themes/synthese")
    assert synthese["total_avis"] == 240 and synthese["themes"][0]["count"] == 230


def test_casse_melangee_comptee_ensemble_et_affichee_de_facon_coherente(ctx):
    for graphie in ("Accueil", "accueil", "ACCUEIL", "  accueil "):
        creer(ctx, theme=graphie, sentiment=SentimentType.POSITIF, note=5)
    themes = stats(ctx)["themes"]
    assert [(t["theme"], t["count"]) for t in themes] == [("accueil", 4)]
    assert themes[0]["label"] == "Accueil & Amabilité"
    synthese = get(ctx, "cx_a", "/feedbacks/themes/synthese")["themes"]
    assert [(t["theme"], t["count"]) for t in synthese] == [("accueil", 4)]
    assert get(ctx, "cx_a", "/feedbacks/themes") == ["accueil"]            # catalogue : une seule entrée


def test_plafond_de_20_themes_et_total_independant_du_plafond(ctx):
    for i in range(25):
        creer(ctx, theme=f"theme_{i:02d}", sentiment=SentimentType.POSITIF, note=5, nombre=1 + (i % 3))
    donnees = stats(ctx)
    assert len(donnees["themes"]) == 20
    assert donnees["themes_total_avis"] == sum(1 + (i % 3) for i in range(25))
    synthese = get(ctx, "cx_a", "/feedbacks/themes/synthese?limit=5")
    assert len(synthese["themes"]) == 5
    get(ctx, "cx_a", "/feedbacks/themes/synthese?limit=21", statut=422)
    assert len(get(ctx, "cx_a", "/feedbacks/themes/synthese")["themes"]) == 20


def test_part_negative_et_evolution_par_theme(ctx):
    creer(ctx, theme="attente", sentiment=SentimentType.NEGATIF, note=1, jours=5, nombre=3)       # courante : 3/4
    creer(ctx, theme="attente", sentiment=SentimentType.POSITIF, note=5, jours=5, nombre=1)
    creer(ctx, theme="attente", sentiment=SentimentType.NEGATIF, note=1, jours=45, nombre=1)      # précédente : 1/5
    creer(ctx, theme="attente", sentiment=SentimentType.POSITIF, note=5, jours=45, nombre=4)
    creer(ctx, theme="accueil", sentiment=SentimentType.NEGATIF, note=1, jours=5, nombre=2)       # précédente vide
    par_theme = {t["theme"]: t["part_negatifs"] for t in stats(ctx)["themes"]}
    assert (par_theme["attente"]["part"], par_theme["attente"]["part_precedente"], par_theme["attente"]["evolution_pts"]) == (75.0, 20.0, 55.0)
    assert par_theme["accueil"]["statut_evolution"] == "insuffisant" and par_theme["accueil"]["evolution_pts"] is None
    synthese = {t["theme"]: t["part_negatifs"] for t in get(ctx, "cx_a", "/feedbacks/themes/synthese?jours=30")["themes"]}
    assert synthese["attente"]["evolution_pts"] == 55.0


def test_synthese_sans_jours_pas_d_evolution_et_non_categorise_inclus(ctx):
    creer(ctx, theme="accueil", sentiment=SentimentType.POSITIF, note=5, nombre=2)
    creer(ctx, note=4, nombre=3)                                          # pas d'analyse : « non catégorisé »
    synthese = get(ctx, "cx_a", "/feedbacks/themes/synthese")
    assert synthese["total_avis"] == 5
    par_theme = {t["theme"]: t for t in synthese["themes"]}
    assert par_theme["non_categorise"]["count"] == 3 and par_theme["non_categorise"]["label"] == "Non catégorisé"
    assert par_theme["accueil"]["part_negatifs"] is None
    # Les statistiques du siège, elles, ne classent que les avis qui ont un thème (comportement inchangé).
    assert [t["theme"] for t in stats(ctx)["themes"]] == ["accueil"]


def test_synthese_respecte_la_periode_et_les_filtres_de_la_liste(ctx):
    creer(ctx, theme="accueil", sentiment=SentimentType.POSITIF, note=5, jours=3, nombre=2)
    creer(ctx, theme="accueil", sentiment=SentimentType.NEGATIF, note=1, jours=3, nombre=1)
    creer(ctx, theme="accueil", sentiment=SentimentType.POSITIF, note=5, jours=100, nombre=4)
    assert get(ctx, "cx_a", "/feedbacks/themes/synthese?jours=30")["total_avis"] == 3
    assert get(ctx, "cx_a", "/feedbacks/themes/synthese?jours=30&sentiment=negatif")["total_avis"] == 1
    assert get(ctx, "cx_a", "/feedbacks/themes/synthese?jours=30&note=5")["total_avis"] == 2
    assert get(ctx, "cx_a", "/feedbacks/themes/synthese")["total_avis"] == 7
    get(ctx, "cx_a", "/feedbacks/themes/synthese?criticite=inconnue", statut=422)


def test_isolation_des_themes_entre_organisations_et_agences(ctx):
    creer(ctx, "QR-A1", theme="accueil", sentiment=SentimentType.POSITIF, note=5, nombre=2)
    creer(ctx, "QR-A2", theme="tarifs", sentiment=SentimentType.POSITIF, note=5, nombre=3)
    creer(ctx, "QR-B1", theme="secret_b", sentiment=SentimentType.NEGATIF, note=1, nombre=4)
    themes_a = {t["theme"] for t in stats(ctx, "cx_a")["themes"]}
    assert themes_a == {"accueil", "tarifs"}
    assert {t["theme"] for t in get(ctx, "cx_a", "/feedbacks/themes/synthese")["themes"]} == {"accueil", "tarifs"}
    assert {t["theme"] for t in get(ctx, "cx_b", "/feedbacks/themes/synthese")["themes"]} == {"secret_b"}
    assert {t["theme"] for t in get(ctx, "am_a1", "/feedbacks/themes/synthese")["themes"]} == {"accueil"}
    # Une agence d'une autre organisation passée en paramètre ne rend rien.
    autre = get(ctx, "cx_a", f"/feedbacks/themes/synthese?agence_id={ctx.b1}")
    assert autre["themes"] == [] and autre["total_avis"] == 0
    assert "secret_b" not in str(get(ctx, "cx_a", "/feedbacks/themes"))


# ── Clic sur un thème : la liste retrouve exactement les mêmes avis ───────────────────────────


def test_clic_sur_un_theme_la_liste_filtree_retrouve_les_memes_avis(ctx):
    for graphie in ("Accueil", "accueil", "ACCUEIL ", " accueil"):
        creer(ctx, theme=graphie, sentiment=SentimentType.POSITIF, note=5)
    creer(ctx, theme="tarifs", sentiment=SentimentType.POSITIF, note=5, nombre=2)
    cle = get(ctx, "cx_a", "/feedbacks/themes/synthese")["themes"][0]
    assert cle["theme"] == "accueil" and cle["count"] == 4
    for transmis in ("accueil", "Accueil", "ACCUEIL"):
        r = ctx.client.get(f"/feedbacks/?theme={transmis}", headers=ctx.H(ctx.cx_a))
        assert r.status_code == 200 and r.headers["x-total-count"] == "4" and len(r.json()) == 4
    debut = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    r = ctx.client.get("/feedbacks/", params={"theme": "accueil", "date_debut": debut}, headers=ctx.H(ctx.cx_a))
    assert r.headers["x-total-count"] == "4"


def test_filtre_non_categorise_et_theme_vide(ctx):
    creer(ctx, note=4, nombre=2)
    creer(ctx, theme="  ", sentiment=SentimentType.POSITIF, note=4)       # thème vide après nettoyage
    creer(ctx, theme="accueil", sentiment=SentimentType.POSITIF, note=4)
    r = ctx.client.get("/feedbacks/?theme=non_categorise", headers=ctx.H(ctx.cx_a))
    assert r.headers["x-total-count"] == "3"
    r = ctx.client.get("/feedbacks/?theme=%20%20", headers=ctx.H(ctx.cx_a))
    assert r.status_code == 422 and "Thème invalide" in r.text
