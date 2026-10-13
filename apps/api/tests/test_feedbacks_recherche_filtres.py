"""
GET /feedbacks/ : recherche texte (q), filtres sentiment / gravité, total et pagination côté serveur (AM-01).
Vrai routeur, vrai JWT, SQLite en mémoire (fixture partagée : 2 organisations, agences A1 et A2 dans A, B1 dans B).
"""
import logging
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from app.models.analyse_ia import AnalyseIA
from app.models.demande_contact import DemandeContact
from app.models.enums import CriticiteType, SentimentType
from app.models.feedback import Feedback
from app.models.qr_code import QRCode
from tests._fixture_deux_agences import SECRET_A2, TEL_A2, construire_contexte

MAINTENANT = datetime.now(timezone.utc)


@pytest.fixture()
def ctx():
    return construire_contexte()


def ajouter_avis(ctx, code_qr, commentaire, *, jours=0, sentiment=SentimentType.NEUTRE, criticite=CriticiteType.FAIBLE,
                 analyse=True, date=None, note=3):
    db = ctx.Session()
    try:
        qr = db.query(QRCode).filter(QRCode.code == code_qr).one()
        fb = Feedback(id=uuid4(), qr_code_id=qr.id, note=note, commentaire=commentaire, statut_traitement="nouveau",
                      date_soumission=date or (MAINTENANT - timedelta(days=jours)))
        db.add(fb); db.flush()
        if analyse:
            db.add(AnalyseIA(id=uuid4(), feedback_id=fb.id, sentiment=sentiment, criticite=criticite, score_sentiment=0.5,
                             theme_principal="attente"))
        db.commit()
        return str(fb.id)
    finally:
        db.close()


def lister(ctx, acteur, **params):
    return ctx.client.get("/feedbacks/", headers=ctx.H(getattr(ctx, acteur)), params=params)


def total(r):
    return int(r.headers["X-Total-Count"])


def commentaires(r):
    return [f["commentaire"] for f in r.json()]


# ───────────────────────── recherche ─────────────────────────

def test_un_mot_cle_present_dans_un_avis_ancien_est_trouve_au_dela_des_50_premiers(ctx):
    for i in range(120):
        ajouter_avis(ctx, "QR-A1", f"avis courant {i}", jours=0)
    ajouter_avis(ctx, "QR-A1", "Le xylophone était cassé", jours=200)
    sans = lister(ctx, "am_a1", limit=50)
    assert total(sans) == 122 and "xylophone" not in " ".join(commentaires(sans))   # absent des 50 premiers
    avec = lister(ctx, "am_a1", q="xylophone")
    assert avec.status_code == 200 and commentaires(avec) == ["Le xylophone était cassé"] and total(avec) == 1


def test_recherche_insensible_a_la_casse_et_aux_accents(ctx):
    ajouter_avis(ctx, "QR-A1", "Très long délai à l'ÉCOUTE, œuvre ÉNORME")
    for q in ("tres LONG delai", "ecoute", "ÉCOUTE", "OEUVRE", "énorme", "L’ecoute"):
        assert total(lister(ctx, "am_a1", q=q)) == 1, q
    assert total(lister(ctx, "am_a1", q="introuvable")) == 0


def test_les_jokers_sont_cherches_litteralement(ctx):
    ajouter_avis(ctx, "QR-A1", "Remise de 100% promise")
    ajouter_avis(ctx, "QR-A1", "100 euros")
    ajouter_avis(ctx, "QR-A1", "code a_b valide")
    ajouter_avis(ctx, "QR-A1", "code axb valide")
    ajouter_avis(ctx, "QR-A1", r"chemin c:\temp")
    assert commentaires(lister(ctx, "am_a1", q="100%")) == ["Remise de 100% promise"]
    assert commentaires(lister(ctx, "am_a1", q="a_b")) == ["code a_b valide"]
    assert commentaires(lister(ctx, "am_a1", q="%")) == ["Remise de 100% promise"]
    assert commentaires(lister(ctx, "am_a1", q="_")) == ["code a_b valide"]
    assert commentaires(lister(ctx, "am_a1", q="c:\\temp")) == [r"chemin c:\temp"]


def test_q_vide_ou_blanc_equivaut_a_pas_de_recherche(ctx):
    ajouter_avis(ctx, "QR-A1", "un avis")
    base = total(lister(ctx, "am_a1"))
    for q in ("", "   "):
        r = lister(ctx, "am_a1", q=q)
        assert r.status_code == 200 and total(r) == base


def test_q_trop_long_ou_avec_caractere_de_controle_est_refuse(ctx):
    assert lister(ctx, "am_a1", q="x" * 100).status_code == 200
    assert lister(ctx, "am_a1", q="x" * 101).status_code == 422
    assert ctx.client.get("/feedbacks/?q=a%00b", headers=ctx.H(ctx.am_a1)).status_code == 422     # NUL réel dans l'URL


def test_la_recherche_ne_porte_que_sur_le_texte_de_l_avis(ctx):
    db = ctx.Session()
    dc = db.query(DemandeContact).one()
    dc.nom = "Zébulon Martin"
    db.commit(); db.close()
    # am_a2 possède l'avis fb_a2 (téléphone 0611111111, e-mail a2@example.com, nom Zébulon Martin)
    assert total(lister(ctx, "am_a2", q=SECRET_A2)) == 1                                  # cas positif : le texte est trouvé
    for q in (TEL_A2, "a2@example", "Zebulon", "Martin"):
        assert total(lister(ctx, "am_a2", q=q)) == 0, q


def test_valider_recherche_est_un_garde_a_lui_seul():
    """Défense en profondeur : indépendante de la limite que FastAPI applique déjà sur le paramètre."""
    from fastapi import HTTPException

    from app.utils.recherche_texte import LONGUEUR_MAX_RECHERCHE, valider_recherche

    assert valider_recherche(None) is None and valider_recherche("   ") is None
    assert valider_recherche("  remboursement ") == "remboursement"
    assert valider_recherche("x" * LONGUEUR_MAX_RECHERCHE) == "x" * LONGUEUR_MAX_RECHERCHE
    for interdit in ("x" * (LONGUEUR_MAX_RECHERCHE + 1), "a\x00b", "a\tb", "a\nb"):
        with pytest.raises(HTTPException) as exc:
            valider_recherche(interdit)
        assert exc.value.status_code == 422


# ───────────────────────── filtres ─────────────────────────

def test_filtre_sentiment_et_gravite_et_combinaison_en_et(ctx):
    ajouter_avis(ctx, "QR-A1", "pos faible", sentiment=SentimentType.POSITIF, criticite=CriticiteType.FAIBLE)
    ajouter_avis(ctx, "QR-A1", "neg critique remboursement", sentiment=SentimentType.NEGATIF, criticite=CriticiteType.CRITIQUE)
    ajouter_avis(ctx, "QR-A1", "neg elevee remboursement", sentiment=SentimentType.NEGATIF, criticite=CriticiteType.ELEVEE)
    ajouter_avis(ctx, "QR-A1", "neg elevee attente", sentiment=SentimentType.NEGATIF, criticite=CriticiteType.ELEVEE)
    ajouter_avis(ctx, "QR-A1", "sans analyse", analyse=False)
    assert sorted(commentaires(lister(ctx, "am_a1", sentiment="positif"))) == ["pos faible"]
    assert total(lister(ctx, "am_a1", sentiment="negatif")) == 4          # 3 ajoutés + l'avis négatif de la fixture
    assert total(lister(ctx, "am_a1", criticite="elevee")) == 2
    assert commentaires(lister(ctx, "am_a1", criticite="non_evaluee")) == ["sans analyse"]
    r = lister(ctx, "am_a1", sentiment="negatif", criticite="elevee", q="remboursement")
    assert commentaires(r) == ["neg elevee remboursement"] and total(r) == 1
    assert total(lister(ctx, "am_a1", sentiment="positif", criticite="critique")) == 0          # ET, pas OU
    assert total(lister(ctx, "am_a1", sentiment="negatif", theme="attente", criticite="elevee")) == 2  # une seule jointure d'analyse


def test_sentiment_ou_gravite_inconnus_sont_refuses(ctx):
    assert lister(ctx, "am_a1", sentiment="furieux").status_code == 422
    assert lister(ctx, "am_a1", criticite="enorme").status_code == 422


def test_filtre_note_et_onglets_a_traiter_et_a_surveiller(ctx):
    pos = ajouter_avis(ctx, "QR-A1", "positif resolu", note=5, sentiment=SentimentType.POSITIF, criticite=CriticiteType.FAIBLE)
    ajouter_avis(ctx, "QR-A1", "positif nouveau", note=5, sentiment=SentimentType.POSITIF, criticite=CriticiteType.FAIBLE)
    ajouter_avis(ctx, "QR-A1", "note faible", note=2, sentiment=SentimentType.NEUTRE, criticite=CriticiteType.FAIBLE)
    ajouter_avis(ctx, "QR-A1", "grave", note=4, sentiment=SentimentType.POSITIF, criticite=CriticiteType.ELEVEE)
    db = ctx.Session()
    from app.models.demande_contact import DemandeContact as DC
    fb = db.get(Feedback, __import__("uuid").UUID(pos)); fb.statut_traitement = "resolu"
    contradictoire = ajouter_avis(ctx, "QR-A1", "contradictoire", note=4, sentiment=SentimentType.POSITIF, criticite=CriticiteType.FAIBLE)
    a = db.query(AnalyseIA).filter(AnalyseIA.feedback_id == __import__("uuid").UUID(contradictoire)).one(); a.discordance_detectee = True
    # résolu MAIS avec une demande de rappel en attente => reste « à traiter »
    resolu_rappel = ajouter_avis(ctx, "QR-A1", "resolu avec rappel", note=5, sentiment=SentimentType.POSITIF, criticite=CriticiteType.FAIBLE)
    db.get(Feedback, __import__("uuid").UUID(resolu_rappel)).statut_traitement = "resolu"
    db.add(DC(feedback_id=__import__("uuid").UUID(resolu_rappel), nom="X", telephone="0600000001", souhaite_etre_rappele=True, traitee=False))
    db.commit(); db.close()
    assert total(lister(ctx, "am_a1", note=5)) == 3
    assert total(lister(ctx, "am_a1", note=5, q="resolu")) == 2                                   # ET
    surveiller = commentaires(lister(ctx, "am_a1", a_surveiller=True))
    assert sorted(surveiller) == sorted(["avis A1", "note faible", "grave", "contradictoire"])      # chaque avis une seule fois
    assert "positif resolu" not in commentaires(lister(ctx, "am_a1", a_traiter=True))
    assert "resolu avec rappel" in commentaires(lister(ctx, "am_a1", a_traiter=True))
    assert total(lister(ctx, "am_a1", a_traiter=True)) == total(lister(ctx, "am_a1")) - 1
    assert total(lister(ctx, "am_a1", a_surveiller=True, q="grave")) == 1
    assert lister(ctx, "am_a1", note=6).status_code == 422


# ───────────────────────── pagination ─────────────────────────

def test_pagination_sans_doublon_ni_trou_et_ordre_stable_a_dates_egales(ctx):
    meme_date = MAINTENANT - timedelta(days=1)
    attendus = {ajouter_avis(ctx, "QR-A1", f"avis {i}", date=meme_date) for i in range(120)}
    attendus |= {ajouter_avis(ctx, "QR-A1", f"ancien {i}", jours=30 + i) for i in range(15)}
    db = ctx.Session(); attendus.add(str(ctx.fb_a1)); db.close()
    vus, pages = [], 0
    for offset in range(0, 200, 50):
        r = lister(ctx, "am_a1", limit=50, offset=offset)
        assert total(r) == len(attendus)
        vus += [f["id"] for f in r.json()]
        pages += bool(r.json())
    assert len(vus) == len(set(vus)) == len(attendus) and set(vus) == attendus and pages == 3
    lignes = lister(ctx, "am_a1", limit=200).json()
    dates = [f["date_soumission"] for f in lignes]
    assert dates == sorted(dates, reverse=True)
    # À dates égales, l'ordre est celui de l'id décroissant (et pas l'ordre d'insertion de la base) : une page ne se recoupe jamais.
    attendu = sorted(lignes, key=lambda f: (f["date_soumission"], f["id"]), reverse=True)
    assert [f["id"] for f in lignes] == [f["id"] for f in attendu]
    # même requête = même ordre
    assert [f["id"] for f in lister(ctx, "am_a1", limit=200).json()] == [f["id"] for f in lister(ctx, "am_a1", limit=200).json()]


def test_le_total_suit_les_filtres_et_pas_la_page(ctx):
    for i in range(30):
        ajouter_avis(ctx, "QR-A1", f"retard numero {i}", sentiment=SentimentType.NEGATIF)
    r = lister(ctx, "am_a1", q="retard", limit=10, offset=20)
    assert len(r.json()) == 10 and total(r) == 30
    r = lister(ctx, "am_a1", q="retard", limit=10, offset=100)
    assert r.json() == [] and total(r) == 30


# ───────────────────────── isolation ─────────────────────────

def test_un_mot_cle_d_une_autre_agence_ne_donne_rien_et_ne_revele_aucun_compte(ctx):
    ajouter_avis(ctx, "QR-A2", f"{SECRET_A2} bis")
    ajouter_avis(ctx, "QR-B1", f"{SECRET_A2} chez B")
    # cas positifs : le propriétaire le trouve
    assert total(lister(ctx, "am_a2", q=SECRET_A2)) == 2
    assert total(lister(ctx, "am_b1", q=SECRET_A2)) == 1
    # cas négatifs : A1 (même organisation que A2) et B1 (autre organisation) ne voient rien d'autre que leur périmètre
    r = lister(ctx, "am_a1", q=SECRET_A2)
    assert r.status_code == 200 and r.json() == [] and total(r) == 0
    assert SECRET_A2 not in r.text
    r = lister(ctx, "am_a1", q=SECRET_A2, agence_id=str(ctx.a2))
    assert r.status_code == 200 and r.json() == [] and total(r) == 0
    r = lister(ctx, "am_a1", q=SECRET_A2, agence_id=str(ctx.b1))
    assert r.status_code == 200 and r.json() == [] and total(r) == 0


def test_le_total_sans_recherche_ne_compte_que_sa_propre_agence(ctx):
    for i in range(7):
        ajouter_avis(ctx, "QR-A2", f"a2 {i}")
        ajouter_avis(ctx, "QR-B1", f"b1 {i}", sentiment=SentimentType.NEGATIF)
    avant = total(lister(ctx, "am_a1"))
    assert avant == 1                                                     # seulement l'avis A1 de la fixture
    for params in ({"agence_id": str(ctx.a2)}, {"sentiment": "negatif", "agence_id": str(ctx.b1)}, {"criticite": "critique"}):
        r = lister(ctx, "am_a1", **params)
        assert r.status_code == 200 and total(r) <= avant and all(f["agence_nom"] == "Agence A1" for f in r.json()), params
    assert total(lister(ctx, "am_a2")) == 8                               # cas positif : A2 voit ses 8 avis


# ───────────────────────── journaux ─────────────────────────

def test_la_valeur_de_q_n_apparait_dans_aucun_journal_de_l_api(ctx, caplog):
    caplog.set_level(logging.DEBUG)
    r = ctx.client.get(f"/feedbacks/{ctx.fb_a2}", headers=ctx.H(ctx.am_a1), params={"q": "TERME-CONFIDENTIEL-42"})
    assert r.status_code == 403
    r = lister(ctx, "am_a1", q="TERME-CONFIDENTIEL-42")
    assert r.status_code == 200
    # Journaux de l'API seulement : httpx / httpcore sont ceux du CLIENT de test, pas du serveur.
    cote_api = [rec.getMessage() for rec in caplog.records if not rec.name.startswith(("httpx", "httpcore"))]
    assert "TERME-CONFIDENTIEL-42" not in " | ".join(cote_api)
    assert any(rec.name == "ikan.security.access_denied" for rec in caplog.records)   # le 403 a bien été journalisé


def test_le_journal_d_acces_d_uvicorn_masque_q(caplog):
    import logging.config
    from uvicorn.config import LOGGING_CONFIG

    from app.core.masquage_acces_http import installer_masquage_acces_http

    installer_masquage_acces_http()
    logging.config.dictConfig(LOGGING_CONFIG)       # uvicorn reconfigure ses journaux au démarrage : le filtre doit survivre
    sortie = []

    class Capture(logging.Handler):
        def emit(self, record):
            sortie.append(record.getMessage())

    journal = logging.getLogger("uvicorn.access")
    journal.addHandler(Capture())
    journal.setLevel(logging.INFO)
    journal.info('%s - "%s %s HTTP/%s" %d', "1.2.3.4:5", "GET", "/api/v1/feedbacks/?sentiment=negatif&q=TERME-SECRET&limit=50", "1.1", 200)
    assert sortie and "TERME-SECRET" not in sortie[0] and "q=***" in sortie[0] and "sentiment=negatif" in sortie[0]


# ───────────────────────── PostgreSQL (moteur de production) ─────────────────────────

def test_la_recherche_se_comporte_de_la_meme_facon_sur_postgresql():
    """Mêmes cas que ci-dessus sur un vrai PostgreSQL jetable (expression régulière à classes d'accents).
    Ignoré sans TEST_DATABASE_URL (jamais la base de .env)."""
    import os

    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL non défini : base Postgres jetable requise (jamais la base de .env).")
    from sqlalchemy import column, create_engine, select, table, text

    from app.utils.recherche_texte import condition_recherche

    moteur = create_engine(url)
    avis = table("t_recherche_avis", column("commentaire"))
    lignes = [
        "Très long délai à l'ÉCOUTE, œuvre ÉNORME", "Remise de 100% promise", "100 euros", "code a_b valide", "code axb valide",
        "L’accueil était ÀÇÔ", r"prix (TTC) [net] a.b a+b $5 c:\temp", "aXb", None,
    ]
    with moteur.begin() as cx:
        cx.execute(text("DROP TABLE IF EXISTS t_recherche_avis"))
        cx.execute(text("CREATE TABLE t_recherche_avis (commentaire text)"))
        cx.execute(text("INSERT INTO t_recherche_avis VALUES (:t)"), [{"t": t} for t in lignes])

        def cherche(q):
            requete = select(avis.c.commentaire).where(condition_recherche("postgresql", avis.c.commentaire, q))
            return sorted(r[0] for r in cx.execute(requete))

        assert cherche("tres LONG delai") == [lignes[0]]
        assert cherche("ecoute") == [lignes[0]] and cherche("OEUVRE") == [lignes[0]] and cherche("énorme") == [lignes[0]]
        assert cherche("100%") == [lignes[1]] and cherche("%") == [lignes[1]]                      # jokers littéraux
        assert cherche("a_b") == [lignes[3]] and cherche("_") == [lignes[3]]
        assert cherche("l'accueil") == [lignes[5]] and cherche("aco") == [lignes[5]]               # apostrophe typographique, ÀÇÔ
        for q in ("(ttc)", "[net]", "a.b", "a+b", "$5", r"c:\temp"):                               # caractères spéciaux de regex
            assert cherche(q) == [lignes[6]], q
        assert cherche("a.b") == [lignes[6]]                                                       # « . » n'est pas « n'importe quel caractère »
        assert cherche("introuvable") == [] and cherche("(") == [lignes[6]]
        cx.execute(text("DROP TABLE t_recherche_avis"))
