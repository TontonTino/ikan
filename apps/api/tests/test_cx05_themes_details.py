"""
CX-05 (complément) — GET /feedbacks/themes/synthese : agences concernées, gravité la plus fréquente et extraits récents par thème.

Calculés en SQL sur la même période et les mêmes filtres que le reste de l'onglet (jamais sur 200 avis), pour les thèmes retenus.
"""
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import event

from app.models.analyse_ia import AnalyseIA
from app.models.demande_contact import DemandeContact
from app.models.enums import CriticiteType, SentimentType
from app.models.feedback import Feedback
from tests.test_cx05_negatifs_themes import get
from tests.test_cycle_traitement_avis import ctx  # noqa: F401  (fixture réutilisée)

TEL, MAIL = "0699887766", "client.secret@example.com"


def avis(ctx, code="QR-A1", theme="accueil", criticite=CriticiteType.FAIBLE, commentaire="ok", jours=1.0, minutes=0, contact=False, analyse=True):
    db = ctx.Session()
    fb = Feedback(id=uuid4(), qr_code_id=ctx.qr[code], note=4, commentaire=commentaire, statut_traitement="nouveau",
                  date_soumission=datetime.now(timezone.utc) - timedelta(days=jours, minutes=minutes))
    db.add(fb); db.flush()
    if analyse:
        db.add(AnalyseIA(id=uuid4(), feedback_id=fb.id, sentiment=SentimentType.POSITIF, criticite=criticite, score_sentiment=0.5, theme_principal=theme))
    if contact:
        db.add(DemandeContact(id=uuid4(), feedback_id=fb.id, nom="Nom Secret", telephone=TEL, email=MAIL, souhaite_etre_rappele=True))
    db.commit()
    db.close()


def theme(ctx, acteur="cx_a", cle="accueil", extra=""):
    synthese = get(ctx, acteur, f"/feedbacks/themes/synthese{extra}")
    return next((t for t in synthese["themes"] if t["theme"] == cle), None)


# ── Agences concernées ─────────────────────────────────────────────────────────────────────────


def test_une_agence(ctx):
    for _ in range(3):
        avis(ctx, "QR-A1")
    assert theme(ctx)["agences_concernees"] == 1


def test_plusieurs_agences_comptees_une_fois_chacune(ctx):
    for code in ("QR-A1", "QR-A1", "QR-A2", "QR-A2", "QR-A2"):
        avis(ctx, code)
    assert theme(ctx)["agences_concernees"] == 2


def test_casse_melangee_et_agences_distinctes_dans_un_seul_theme(ctx):
    avis(ctx, "QR-A1", theme="Accueil")
    avis(ctx, "QR-A2", theme="ACCUEIL ")
    avis(ctx, "QR-A2", theme="accueil")
    t = theme(ctx)
    assert (t["count"], t["agences_concernees"]) == (3, 2)


def test_les_agences_d_une_autre_organisation_ne_comptent_pas(ctx):
    avis(ctx, "QR-A1")
    avis(ctx, "QR-B1")
    assert theme(ctx, "cx_a")["agences_concernees"] == 1
    assert theme(ctx, "cx_b")["agences_concernees"] == 1


# ── Gravité la plus fréquente ──────────────────────────────────────────────────────────────────


def test_gravite_majoritaire(ctx):
    for _ in range(3):
        avis(ctx, criticite=CriticiteType.FAIBLE)
    avis(ctx, criticite=CriticiteType.CRITIQUE)
    assert theme(ctx)["gravite_frequente"] == "faible"


def test_egalite_la_plus_grave_l_emporte(ctx):
    for _ in range(2):
        avis(ctx, theme="t1", criticite=CriticiteType.FAIBLE)
        avis(ctx, theme="t1", criticite=CriticiteType.CRITIQUE)
        avis(ctx, theme="t2", criticite=CriticiteType.MOYENNE)
        avis(ctx, theme="t2", criticite=CriticiteType.ELEVEE)
        avis(ctx, theme="t3", criticite=CriticiteType.FAIBLE)       # « faible » précède « moyenne » dans l'ordre alphabétique de SQL :
        avis(ctx, theme="t3", criticite=CriticiteType.MOYENNE)      # ce cas échoue si l'égalité dépend de l'ordre des lignes
    assert theme(ctx, cle="t3")["gravite_frequente"] == "moyenne"
    assert theme(ctx, cle="t1")["gravite_frequente"] == "critique"
    assert theme(ctx, cle="t2")["gravite_frequente"] == "elevee"


def test_sans_analyse_aucune_gravite(ctx):
    avis(ctx, analyse=False)
    t = theme(ctx, cle="non_categorise")
    assert t["gravite_frequente"] is None and t["count"] == 1


def test_gravite_calculee_sur_la_periode_choisie(ctx):
    avis(ctx, criticite=CriticiteType.FAIBLE, jours=2)
    for _ in range(3):
        avis(ctx, criticite=CriticiteType.CRITIQUE, jours=100)
    assert theme(ctx, extra="?jours=30")["gravite_frequente"] == "faible"
    assert theme(ctx)["gravite_frequente"] == "critique"


# ── Extraits (verbatims) ───────────────────────────────────────────────────────────────────────


def test_trois_extraits_au_plus_du_plus_recent_au_plus_ancien(ctx):
    for i in range(5):
        avis(ctx, commentaire=f"extrait {i}", minutes=i)         # extrait 0 = le plus récent
    assert theme(ctx)["verbatims"] == ["extrait 0", "extrait 1", "extrait 2"]


def test_theme_sans_commentaire_aucun_extrait_et_commentaires_vides_ignores(ctx):
    avis(ctx, theme="muet", commentaire=None)
    avis(ctx, theme="muet", commentaire="   ")
    avis(ctx, theme="bavard", commentaire="  un vrai avis  ")
    assert theme(ctx, cle="muet")["verbatims"] == []
    assert theme(ctx, cle="bavard")["verbatims"] == ["un vrai avis"]


def test_aucune_donnee_de_contact_dans_la_reponse(ctx):
    avis(ctx, commentaire="avis avec rappel", contact=True)
    brut = ctx.client.get("/feedbacks/themes/synthese", headers=ctx.H(ctx.cx_a)).text
    assert "avis avec rappel" in brut
    for secret in (TEL, MAIL, "Nom Secret"):
        assert secret not in brut


def test_isolation_des_extraits_entre_organisations(ctx):
    avis(ctx, "QR-A1", commentaire="extrait de A")
    avis(ctx, "QR-B1", commentaire="SECRET-ORG-B")
    assert theme(ctx, "cx_a")["verbatims"] == ["extrait de A"]
    assert "SECRET-ORG-B" not in ctx.client.get("/feedbacks/themes/synthese", headers=ctx.H(ctx.cx_a)).text
    assert theme(ctx, "cx_b")["verbatims"] == ["SECRET-ORG-B"]
    assert "extrait de A" not in ctx.client.get("/feedbacks/themes/synthese", headers=ctx.H(ctx.cx_b)).text


def test_extraits_respectent_la_periode_et_les_filtres(ctx):
    avis(ctx, commentaire="récent", jours=2)
    avis(ctx, commentaire="très ancien", jours=200)
    assert theme(ctx, extra="?jours=30")["verbatims"] == ["récent"]
    assert theme(ctx)["verbatims"] == ["récent", "très ancien"]


def test_au_dela_de_200_avis_les_trois_informations_portent_sur_toute_la_periode(ctx):
    for i in range(230):
        avis(ctx, "QR-A1" if i < 229 else "QR-A2", criticite=CriticiteType.FAIBLE if i < 229 else CriticiteType.CRITIQUE,
             commentaire=f"c{i}", minutes=i)
    t = theme(ctx)
    assert t["count"] == 230
    assert t["agences_concernees"] == 2             # la 2e agence n'a que l'avis le plus ancien (au-delà des 200 plus récents)
    assert t["gravite_frequente"] == "faible"
    assert t["verbatims"] == ["c0", "c1", "c2"]


def test_champs_existants_conserves_et_themes_non_retenus_exclus(ctx):
    for i in range(22):
        avis(ctx, theme=f"th{i:02d}", commentaire="x", criticite=CriticiteType.ELEVEE)
    synthese = get(ctx, "cx_a", "/feedbacks/themes/synthese")
    assert len(synthese["themes"]) == 20 and synthese["total_avis"] == 22
    premier = synthese["themes"][0]
    for champ in ("theme", "label", "count", "pourcentage", "sentiment_predominant", "negatifs", "part_negatifs",
                  "agences_concernees", "gravite_frequente", "verbatims"):
        assert champ in premier


def test_nombre_de_requetes_sql_constant_quel_que_soit_le_nombre_de_themes(ctx):
    compteur = {"n": 0}
    engine = ctx.Session.kw["bind"]

    def compter(*_):
        compteur["n"] += 1

    def mesurer(url):
        compteur["n"] = 0
        event.listen(engine, "before_cursor_execute", compter)
        try:
            get(ctx, "cx_a", url)
        finally:
            event.remove(engine, "before_cursor_execute", compter)
        return compteur["n"]

    avis(ctx, theme="t0", commentaire="a")
    petit = mesurer("/feedbacks/themes/synthese?jours=30")
    for i in range(1, 20):
        avis(ctx, theme=f"t{i}", commentaire="a")
    grand = mesurer("/feedbacks/themes/synthese?jours=30")
    assert petit == grand
    assert grand == 5                                    # 1 lecture de l'utilisateur + 4 agrégats (thèmes, période précédente, gravité, extraits)
