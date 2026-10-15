"""
CX-04 — filtre « discordance » de GET /feedbacks/ (avis dont la note et le ton de l'analyse se contredisent).

Vrai routeur, vrai JWT, SQLite en mémoire (fixture partagée : organisations A — agences A1, A2 — et B — agence B1). On ajoute un CX
Manager par organisation et des avis discordants ou non. Le filtre s'ajoute aux autres en ET et respecte le périmètre de l'utilisateur.
"""
from datetime import datetime, timezone
from uuid import uuid4

import pytest

from app.core.erreurs_validation import installer_erreurs_validation
from app.core.security import get_password_hash
from app.models.agence import Agence
from app.models.analyse_ia import AnalyseIA
from app.models.enums import CriticiteType, SentimentType, UserRole
from app.models.feedback import Feedback
from app.models.qr_code import QRCode
from app.models.utilisateur import Utilisateur
from tests._fixture_deux_agences import construire_contexte

SECRET_B = "SECRET-AVIS-B-DISCORDANT"


@pytest.fixture()
def ctx():
    c = construire_contexte()
    installer_erreurs_validation(c.app)
    db = c.Session()
    org_a, org_b = db.get(Agence, c.a1).organisation_id, db.get(Agence, c.b1).organisation_id

    def cx(org):
        u = Utilisateur(id=uuid4(), organisation_id=org, nom="N", prenom="CX", email=f"{uuid4().hex[:10]}@test.io",
                        mot_de_passe_hash=get_password_hash("Motdepasse-123"), role=UserRole.CX_MANAGER, active=True)
        db.add(u); db.flush()
        return u.id

    c.cx_a, c.cx_b = cx(org_a), cx(org_b)
    db.commit(); db.close()
    # Avis ajoutés (la fixture en contient déjà deux, A1 et A2, analysés sans discordance).
    c.disc_a1 = avis(c, "QR-A1", "disc A1", note=5, sentiment=SentimentType.NEGATIF, discordance=True)
    c.disc_a2 = avis(c, "QR-A2", "disc A2", note=1, sentiment=SentimentType.POSITIF, discordance=True)
    c.normal_a1 = avis(c, "QR-A1", "normal A1", note=2, sentiment=SentimentType.NEGATIF, discordance=False)
    c.sans_analyse_a1 = avis(c, "QR-A1", "sans analyse A1", note=4, analyse=False)
    c.disc_b1 = avis(c, "QR-B1", SECRET_B, note=5, sentiment=SentimentType.NEGATIF, discordance=True)
    c.normal_b1 = avis(c, "QR-B1", "normal B1", note=3, sentiment=SentimentType.NEUTRE, discordance=False)
    return c


def avis(ctx, code_qr, commentaire, *, note, sentiment=SentimentType.NEUTRE, discordance=False, analyse=True):
    db = ctx.Session()
    try:
        qr = db.query(QRCode).filter(QRCode.code == code_qr).one()
        fb = Feedback(id=uuid4(), qr_code_id=qr.id, note=note, commentaire=commentaire, statut_traitement="nouveau",
                      date_soumission=datetime.now(timezone.utc))
        db.add(fb); db.flush()
        if analyse:
            db.add(AnalyseIA(id=uuid4(), feedback_id=fb.id, sentiment=sentiment, criticite=CriticiteType.FAIBLE, score_sentiment=0.5,
                             theme_principal="attente", discordance_detectee=discordance))
        db.commit()
        return str(fb.id)
    finally:
        db.close()


def lister(ctx, acteur, **params):
    return ctx.client.get("/feedbacks/", headers=ctx.H(getattr(ctx, acteur)), params=params)


def ids(r):
    return {f["id"] for f in r.json()}


def total(r):
    return int(r.headers["X-Total-Count"])


# ─────────────────────────── avec / sans le paramètre ───────────────────────────

def test_sans_le_parametre_la_liste_est_inchangee(ctx):
    r = lister(ctx, "cx_a")
    assert r.status_code == 200
    assert {ctx.disc_a1, ctx.disc_a2, ctx.normal_a1, ctx.sans_analyse_a1, str(ctx.fb_a1), str(ctx.fb_a2)} == ids(r)
    assert total(r) == 6 and ctx.disc_b1 not in ids(r)


def test_discordance_vrai_ne_garde_que_les_avis_contradictoires(ctx):
    r = lister(ctx, "cx_a", discordance="true")
    assert r.status_code == 200 and ids(r) == {ctx.disc_a1, ctx.disc_a2} and total(r) == 2
    assert all(f["analyse_ia"]["discordance_detectee"] is True for f in r.json())


def test_discordance_faux_garde_les_avis_sans_contradiction_y_compris_non_analyses(ctx):
    r = lister(ctx, "cx_a", discordance="false")
    assert ids(r) == {ctx.normal_a1, ctx.sans_analyse_a1, str(ctx.fb_a1), str(ctx.fb_a2)} and total(r) == 4
    # Vrai + faux = tout le périmètre, sans recouvrement.
    assert ids(r) | ids(lister(ctx, "cx_a", discordance="true")) == ids(lister(ctx, "cx_a"))


# ─────────────────────────── combinaison en ET et pagination ───────────────────────────

def test_le_filtre_se_combine_en_et_avec_les_autres(ctx):
    assert ids(lister(ctx, "cx_a", discordance="true", agence_id=str(ctx.a1))) == {ctx.disc_a1}
    assert ids(lister(ctx, "cx_a", discordance="true", agence_id=str(ctx.a2))) == {ctx.disc_a2}
    assert ids(lister(ctx, "cx_a", discordance="true", note=1)) == {ctx.disc_a2}
    assert ids(lister(ctx, "cx_a", discordance="true", sentiment="positif")) == {ctx.disc_a2}
    r = lister(ctx, "cx_a", discordance="true", note=3)
    assert r.json() == [] and total(r) == 0


def test_pagination_et_total_portent_sur_les_avis_filtres(ctx):
    page1 = lister(ctx, "cx_a", discordance="true", limit=1, offset=0)
    page2 = lister(ctx, "cx_a", discordance="true", limit=1, offset=1)
    assert total(page1) == total(page2) == 2
    assert len(page1.json()) == len(page2.json()) == 1 and ids(page1) | ids(page2) == {ctx.disc_a1, ctx.disc_a2}


# ─────────────────────────── isolation entre organisations ───────────────────────────

def test_le_cx_de_a_ne_voit_jamais_un_avis_de_b_via_le_filtre(ctx):
    for params in ({}, {"discordance": "true"}, {"discordance": "false"}, {"discordance": "true", "agence_id": str(ctx.b1)},
                   {"discordance": "false", "agence_id": str(ctx.b1)}, {"discordance": "true", "note": 5}):
        r = lister(ctx, "cx_a", **params)
        assert r.status_code == 200, params
        assert ctx.disc_b1 not in ids(r) and ctx.normal_b1 not in ids(r) and SECRET_B not in r.text, params
    r = lister(ctx, "cx_a", discordance="true", agence_id=str(ctx.b1))
    assert r.json() == [] and total(r) == 0


def test_cas_positif_jumele_le_cx_de_b_voit_ses_avis_discordants_et_pas_ceux_de_a(ctx):
    r = lister(ctx, "cx_b", discordance="true")
    assert ids(r) == {ctx.disc_b1} and total(r) == 1
    assert ctx.disc_a1 not in ids(r) and ctx.disc_a2 not in ids(r)


def test_un_responsable_d_agence_reste_limite_a_son_agence(ctx):
    assert ids(lister(ctx, "am_a1", discordance="true")) == {ctx.disc_a1}
    assert ids(lister(ctx, "am_a2", discordance="true")) == {ctx.disc_a2}
    assert ids(lister(ctx, "am_b1", discordance="true")) == {ctx.disc_b1}


def test_l_admin_reste_exclu_et_sans_authentification_refuse(ctx):
    assert ctx.client.get("/feedbacks/", params={"discordance": "true"}).status_code in {401, 403}


# ─────────────────────────── valeur invalide : 422 sans écho ───────────────────────────

@pytest.mark.parametrize("valeur", ["peut-etre", "oui-certainement", "2", "<script>x</script>", "SECRET-VALEUR-INVALIDE"])
def test_valeur_inconnue_donne_422_sans_renvoyer_la_valeur(ctx, valeur):
    r = lister(ctx, "cx_a", discordance=valeur)
    assert r.status_code == 422
    assert valeur not in r.text and '"input"' not in r.text
    assert all(set(e) == {"type", "loc", "msg"} for e in r.json()["detail"])
