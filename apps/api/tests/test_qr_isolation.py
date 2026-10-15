"""
CX-07 — le QR code d'une agence n'est obtenu que par les routes d'agences : un CX Manager ne reçoit que les codes de SES agences, un
Agency Manager que celui de la sienne. Le dashboard génère maintenant l'image du QR dans le navigateur à partir de `qr_code_token`
(plus aucun service externe) : ce token est donc la seule donnée de QR qui circule, et elle reste cloisonnée.

Vrai routeur, vrai JWT, SQLite en mémoire (fixture partagée : organisations A — A1, A2 — et B — B1).
"""
from uuid import uuid4

import pytest

from app.core.config import settings
from app.core.security import get_password_hash
from app.models.agence import Agence
from app.models.enums import UserRole
from app.models.qr_code import QRCode
from app.models.utilisateur import Utilisateur
from tests._fixture_deux_agences import construire_contexte


@pytest.fixture()
def ctx():
    c = construire_contexte()
    db = c.Session()
    org_a, org_b = db.get(Agence, c.a1).organisation_id, db.get(Agence, c.b1).organisation_id

    def cx(org):
        u = Utilisateur(id=uuid4(), organisation_id=org, nom="N", prenom="CX", email=f"{uuid4().hex[:10]}@test.io",
                        mot_de_passe_hash=get_password_hash("Motdepasse-123"), role=UserRole.CX_MANAGER, active=True)
        db.add(u); db.flush()
        return u.id

    c.cx_a, c.cx_b = cx(org_a), cx(org_b)
    db.commit(); db.close()
    return c


def nb_qr(ctx):
    db = ctx.Session()
    try:
        return db.query(QRCode).count()
    finally:
        db.close()


def tokens(r):
    return {a["qr_code_token"] for a in r.json()}


def test_le_cx_ne_recoit_que_les_qr_de_ses_agences(ctx):
    r = ctx.client.get("/agences/", headers=ctx.H(ctx.cx_a))
    assert r.status_code == 200 and tokens(r) == {"QR-A1", "QR-A2"} and "QR-B1" not in r.text
    base = settings.PUBLIC_CLIENT_URL.rstrip("/")
    assert {a["qr_code_url"] for a in r.json()} == {f"{base}/feedback/QR-A1", f"{base}/feedback/QR-A2"}
    assert tokens(ctx.client.get("/agences/", headers=ctx.H(ctx.cx_b))) == {"QR-B1"}


def test_le_cx_ne_lit_pas_le_qr_d_une_agence_d_une_autre_organisation(ctx):
    avant = nb_qr(ctx)
    for acteur, agence, secret in [(ctx.cx_a, ctx.b1, "QR-B1"), (ctx.cx_b, ctx.a1, "QR-A1"), (ctx.cx_b, ctx.a2, "QR-A2")]:
        r = ctx.client.get(f"/agences/{agence}", headers=ctx.H(acteur))
        assert r.status_code == 403 and secret not in r.text
    assert nb_qr(ctx) == avant                                   # lecture seule : aucun QR créé ni modifié


def test_le_responsable_d_agence_ne_recoit_que_le_qr_de_la_sienne(ctx):
    r = ctx.client.get("/agences/", headers=ctx.H(ctx.am_a1))
    assert r.status_code == 200 and tokens(r) == {"QR-A1"} and "QR-A2" not in r.text and "QR-B1" not in r.text
    assert ctx.client.get(f"/agences/{ctx.a1}", headers=ctx.H(ctx.am_a1)).json()["qr_code_token"] == "QR-A1"
    for agence, secret in [(ctx.a2, "QR-A2"), (ctx.b1, "QR-B1")]:
        r = ctx.client.get(f"/agences/{agence}", headers=ctx.H(ctx.am_a1))
        assert r.status_code == 403 and secret not in r.text


def test_sans_authentification_aucun_qr(ctx):
    for chemin in ("/agences/", f"/agences/{ctx.a1}"):
        r = ctx.client.get(chemin)
        assert r.status_code in {401, 403} and "QR-" not in r.text
