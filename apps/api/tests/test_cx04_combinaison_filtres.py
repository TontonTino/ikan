"""
CX-04 — page « Avis du réseau » : combinaison de TOUS les filtres de GET /feedbacks/ (agence, période, note, ton, gravité, thème,
discordance) sur le jeu de données écrit à la main de tests/_jeu_donnees_cx.py.

Critère : « quand je combine plusieurs filtres, la liste ne contient que les feedbacks qui respectent TOUS les filtres ».
Preuve : (1) des valeurs exactes lues à la main ; (2) les 128 combinaisons possibles des 7 filtres comparées à un modèle de référence
(un simple prédicat Python sur le tableau d'avis) : liste, total (X-Total-Count), ordre ; (3) pagination et isolation.
"""
from datetime import timedelta
from itertools import combinations

import pytest

from tests._jeu_donnees_cx import AVIS, CRITIQUE, ELEVEE, FAIBLE, MOYENNE, NEG, NEU, POS, construire


@pytest.fixture(scope="module")
def ctx():
    return construire()


# Avis de l'organisation A (agences A1, A2 et l'agence désactivée A3) : le périmètre d'un CX Manager de A.
AVIS_A = [a for a in AVIS if a.agence in ("A1", "A2", "A3")]
NOMS_A = {a.texte for a in AVIS_A}
NOM_AGENCE = {"A1": "Agence A1", "A2": "Agence A2"}


def lister(ctx, acteur="cx_a", **params):
    r = ctx.client.get("/feedbacks/", headers=ctx.H(getattr(ctx.ids, acteur)), params={"limit": 200, **params})
    assert r.status_code == 200, r.text
    return r


def textes(r):
    return [f["commentaire"] for f in r.json()]


def total(r):
    return int(r.headers["X-Total-Count"])


# ───────────────────────── chaque filtre, seul ─────────────────────────

def test_sans_filtre_tous_les_avis_de_mon_organisation_et_seulement_eux(ctx):
    r = lister(ctx)
    assert set(textes(r)) == NOMS_A and total(r) == len(AVIS_A) == 15
    assert not any(t.startswith(("b1-", "d1-")) for t in textes(r))


def test_filtre_agence(ctx):
    assert set(textes(lister(ctx, agence_id=str(ctx.ids.ag_A2)))) == {"a2-01", "a2-02", "a2-p1", "a2-sans-analyse"}
    assert total(lister(ctx, agence_id=str(ctx.ids.ag_A1))) == 10


def test_filtre_note(ctx):
    assert set(textes(lister(ctx, note=5))) == {"a1-01", "a1-06", "a1-p1", "a2-p1"}
    assert set(textes(lister(ctx, note=1))) == {"a1-05", "a1-ancien", "a3-01"}


def test_filtre_ton(ctx):
    assert set(textes(lister(ctx, sentiment="neutre"))) == {"a1-03"}
    assert total(lister(ctx, sentiment="positif")) == 6 and total(lister(ctx, sentiment="negatif")) == 7


def test_filtre_gravite(ctx):
    assert set(textes(lister(ctx, criticite="critique"))) == {"a1-04", "a1-05", "a1-p3", "a1-ancien", "a3-01"}
    assert set(textes(lister(ctx, criticite="moyenne"))) == {"a1-03"}
    assert set(textes(lister(ctx, criticite="elevee"))) == {"a1-06", "a2-02"}
    assert textes(lister(ctx, criticite="non_evaluee")) == ["a2-sans-analyse"]            # avis sans analyse : « non évaluée »


def test_filtre_theme_insensible_a_la_casse_et_aux_espaces(ctx):
    attendus = {"a1-03", "a1-04", "a1-06", "a2-02", "a1-p3", "a1-ancien", "a3-01"}
    for saisie in ("attente", "Attente", "ATTENTE", "  attente  "):
        assert set(textes(lister(ctx, theme=saisie))) == attendus, saisie
    assert set(textes(lister(ctx, theme="facturation"))) == {"a1-05"}
    assert textes(lister(ctx, theme="inexistant")) == []


def test_filtre_periode_bornes_incluses(ctx):
    debut = (ctx.maintenant - timedelta(days=15)).isoformat()
    fin = (ctx.maintenant - timedelta(days=4)).isoformat()
    # depuis 15 jours : a1-01 (5), a1-02 (10), a1-03 (12), a1-04 (3), a2-01 (8), a3-01 (5)
    assert set(textes(lister(ctx, date_debut=debut))) == {"a1-01", "a1-02", "a1-03", "a1-04", "a2-01", "a3-01"}
    # jusqu'à il y a 4 jours : tout sauf a1-04 (3 j) ; les avis plus récents sont exclus
    assert "a1-04" not in textes(lister(ctx, date_fin=fin)) and "a1-01" in textes(lister(ctx, date_fin=fin))
    # fenêtre [15 j ; 4 j] : a1-01, a1-02, a1-03, a2-01, a3-01
    assert set(textes(lister(ctx, date_debut=debut, date_fin=fin))) == {"a1-01", "a1-02", "a1-03", "a2-01", "a3-01"}
    # début après la fin : liste vide, pas d'erreur
    r = lister(ctx, date_debut=fin, date_fin=debut)
    assert r.json() == [] and total(r) == 0


def test_filtre_discordance_isole_les_avis_dont_la_note_contredit_le_ton(ctx):
    assert textes(lister(ctx, discordance="true")) == ["a1-06"]                    # 5 étoiles, ton négatif
    sans = lister(ctx, discordance="false")
    assert "a1-06" not in textes(sans) and total(sans) == 14                        # tous les autres, analysés ou non
    assert "a2-sans-analyse" in textes(sans)                                         # un avis sans analyse n'est pas « contradictoire »


# ───────────────────────── toutes les combinaisons ─────────────────────────

def test_les_sept_filtres_combines_ne_laissent_que_les_avis_qui_respectent_tous_les_filtres(ctx):
    r = lister(ctx, agence_id=str(ctx.ids.ag_A1), date_debut=(ctx.maintenant - timedelta(days=28)).isoformat(), note=5,
               sentiment="negatif", criticite="elevee", theme="attente", discordance="true")
    assert textes(r) == ["a1-06"] and total(r) == 1


def test_combinaison_qui_ne_correspond_a_rien(ctx):
    r = lister(ctx, agence_id=str(ctx.ids.ag_A2), note=5, sentiment="negatif", discordance="true")
    assert r.json() == [] and total(r) == 0


def test_retirer_un_filtre_elargit_exactement_comme_prevu(ctx):
    """Équivalent côté serveur du retrait « un par un » des filtres actifs : chaque filtre retiré redonne un ensemble connu."""
    base = dict(agence_id=str(ctx.ids.ag_A1), date_debut=(ctx.maintenant - timedelta(days=28)).isoformat(), note=5, sentiment="negatif",
                criticite="elevee", theme="attente", discordance="true")
    attendus = {
        "agence_id": {"a1-06"},                     # sans filtre d'agence : a2 n'a pas de 5 étoiles négatives
        "date_debut": {"a1-06"},
        "note": {"a1-06"},                          # sans la note : elevee + negatif + attente + discordant -> toujours a1-06
        "sentiment": {"a1-06"},
        "criticite": {"a1-06"},
        "theme": {"a1-06"},
        "discordance": {"a1-06"},
    }
    # Retirer un filtre ne peut jamais retirer un avis : l'ensemble ne fait que s'élargir ou rester identique.
    for cle in base:
        sans = {k: v for k, v in base.items() if k != cle}
        resultat = set(textes(lister(ctx, **sans)))
        assert attendus[cle] <= resultat, cle
    # Cas où le retrait change réellement le résultat
    assert set(textes(lister(ctx, **{k: v for k, v in base.items() if k != "criticite"}))) == {"a1-06"}
    base2 = dict(agence_id=str(ctx.ids.ag_A1), sentiment="negatif", theme="attente")
    assert set(textes(lister(ctx, **base2))) == {"a1-04", "a1-06", "a1-p3", "a1-ancien"}                 # avec ton + thème + agence
    assert set(textes(lister(ctx, agence_id=str(ctx.ids.ag_A1), sentiment="negatif"))) == {"a1-04", "a1-05", "a1-06", "a1-p3", "a1-ancien"}
    assert set(textes(lister(ctx, agence_id=str(ctx.ids.ag_A1), theme="attente"))) == {"a1-03", "a1-04", "a1-06", "a1-p3", "a1-ancien"}
    assert set(textes(lister(ctx, sentiment="negatif", theme="attente"))) >= {"a1-04", "a1-06", "a2-02", "a3-01"}


def _reference(**f):
    """Modèle de référence : prédicat Python sur le tableau d'avis écrit à la main (aucun code applicatif)."""
    def ok(a):
        if f.get("agence") and a.agence != f["agence"]:
            return False
        if f.get("jours_max") is not None and a.jours > f["jours_max"]:
            return False
        if f.get("note") is not None and a.note != f["note"]:
            return False
        if f.get("sentiment") is not None and a.sentiment != f["sentiment"]:
            return False
        if f.get("gravite") is not None and (a.sentiment is None or a.gravite != f["gravite"]):
            return False
        if f.get("theme") is not None and (a.sentiment is None or a.theme != f["theme"]):
            return False
        if f.get("discordance") and not (a.sentiment is not None and a.discordance):
            return False
        return True
    return [a.texte for a in sorted((a for a in AVIS_A if ok(a)), key=lambda a: a.jours)]      # plus récent d'abord


def test_les_128_combinaisons_des_sept_filtres_donnent_exactement_la_liste_de_reference(ctx):
    valeurs = {
        "agence": ("agence_id", "A1", str(ctx.ids.ag_A1)),
        "jours_max": ("date_debut", 28, (ctx.maintenant - timedelta(days=28)).isoformat()),
        "note": ("note", 5, 5),
        "sentiment": ("sentiment", NEG, "negatif"),
        "gravite": ("criticite", ELEVEE, "elevee"),
        "theme": ("theme", "attente", "attente"),
        "discordance": ("discordance", True, "true"),
    }
    cles = list(valeurs)
    verifiees = 0
    for taille in range(len(cles) + 1):
        for choix in combinations(cles, taille):
            modele = {c: valeurs[c][1] for c in choix}
            params = {valeurs[c][0]: valeurs[c][2] for c in choix}
            r = lister(ctx, **params)
            attendu = _reference(**modele)
            assert textes(r) == attendu, f"{choix} : {textes(r)} != {attendu}"
            assert total(r) == len(attendu), choix
            verifiees += 1
    assert verifiees == 128


# ───────────────────────── tri, pagination, cas vides ─────────────────────────

def test_ordre_date_decroissante_et_pagination_sans_doublon_ni_trou_sous_filtres(ctx):
    params = {"sentiment": "negatif"}
    complet = lister(ctx, **params)
    ordre = textes(complet)
    assert ordre == _reference(sentiment=NEG)
    jours_par_texte = {a.texte: a.jours for a in AVIS_A}
    assert [jours_par_texte[t] for t in ordre] == sorted(jours_par_texte[t] for t in ordre)       # le plus récent d'abord
    vus = []
    for offset in range(0, total(complet), 3):
        page = lister(ctx, limit=3, offset=offset, **params)
        assert total(page) == total(complet) == 7
        vus += textes(page)
    assert vus == ordre and len(set(vus)) == 7


def test_page_au_dela_du_total_et_cas_vide(ctx):
    r = lister(ctx, sentiment="negatif", limit=5, offset=50)
    assert r.json() == [] and total(r) == 7
    vide = lister(ctx, sentiment="neutre", note=5)
    assert vide.json() == [] and total(vide) == 0


# ───────────────────────── je ne vois que les agences de mon organisation ─────────────────────────

@pytest.mark.parametrize("agence", ["ag_B1", "ag_D1"])
def test_agence_d_une_autre_organisation_donne_une_liste_vide(ctx, agence):
    r = lister(ctx, agence_id=str(getattr(ctx.ids, agence)))
    assert r.json() == [] and total(r) == 0
    r = lister(ctx, agence_id=str(getattr(ctx.ids, agence)), note=1, sentiment="negatif", criticite="critique", discordance="false")
    assert r.json() == [] and total(r) == 0


def test_aucun_filtre_ne_fait_sortir_un_avis_d_une_autre_organisation(ctx):
    for params in ({}, {"note": 1}, {"sentiment": "negatif"}, {"criticite": "critique"}, {"theme": "attente"}, {"discordance": "false"},
                   {"note": 1, "criticite": "critique", "sentiment": "negatif"}):
        assert not any(t.startswith(("b1-", "d1-")) for t in textes(lister(ctx, **params))), params
    b = lister(ctx, "cx_b")
    assert set(textes(b)) == {"b1-01", "b1-02"} and total(b) == 2


def test_un_responsable_d_agence_reste_limite_a_son_agence_meme_avec_le_parametre_agence(ctx):
    r = lister(ctx, "am_a1", agence_id=str(ctx.ids.ag_A2))
    assert set(textes(r)) == {a.texte for a in AVIS_A if a.agence == "A1"} and total(r) == 10
    assert all(f["agence_nom"] == "Agence A1" for f in r.json())
