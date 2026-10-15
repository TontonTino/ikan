"""
PR B — isolation entre organisations côté CX Manager (tests manquants de l'audit) et suppression d'une agence.

Fixture partagée (tests/_fixture_deux_agences.py) : vrai routeur, vrai JWT, SQLite en mémoire, organisations A (agences A1, A2) et B
(agence B1). On ajoute ici un CX Manager par organisation et des avis, une analyse et une recommandation côté B. Pour chaque refus,
l'empreinte de la base (lignes de toutes les tables concernées) est comparée avant/après : un refus n'écrit rien.
"""
from datetime import datetime, timezone
from uuid import UUID, uuid4

import pytest

from app.models.agence import Agence
from app.models.analyse_ia import AnalyseIA
from app.models.categorie import Categorie
from app.models.demande_contact import DemandeContact
from app.models.enums import CriticiteType, PriorityLevel, SentimentType, UserRole
from app.models.feedback import Feedback
from app.models.organisation import Organisation
from app.models.qr_code import QRCode
from app.models.recommandation import Recommandation
from app.models.utilisateur import Utilisateur
from app.core.security import get_password_hash
from tests._fixture_deux_agences import construire_contexte

REFUS = {403, 404}                    # convention existante (test_isolation_multi_org.py) ; en pratique 403 pour une agence existante
THEME_B = "theme-secret-b"
RECO_B = "RECO-SECRETE-B"


@pytest.fixture()
def ctx():
    c = construire_contexte()
    db = c.Session()
    org_a = db.get(Agence, c.a1).organisation_id
    org_b = db.get(Agence, c.b1).organisation_id

    def cx(org):
        u = Utilisateur(id=uuid4(), organisation_id=org, nom="N", prenom="CX", email=f"{uuid4().hex[:10]}@test.io",
                        mot_de_passe_hash=get_password_hash("Motdepasse-123"), role=UserRole.CX_MANAGER, active=True)
        db.add(u); db.flush()
        return u.id

    c.cx_a, c.cx_b, c.org_a, c.org_b = cx(org_a), cx(org_b), org_a, org_b
    qr_b1 = db.query(QRCode).filter(QRCode.agence_id == c.b1).one()
    fb_b1 = Feedback(id=uuid4(), qr_code_id=qr_b1.id, note=1, commentaire="avis B1", statut_traitement="nouveau",
                     date_soumission=datetime.now(timezone.utc))
    db.add(fb_b1); db.flush()
    analyse = AnalyseIA(id=uuid4(), feedback_id=fb_b1.id, sentiment=SentimentType.NEGATIF, criticite=CriticiteType.CRITIQUE,
                        score_sentiment=0.1, theme_principal=THEME_B)
    db.add(analyse); db.flush()
    db.add(Recommandation(id=uuid4(), analyse_ia_id=analyse.id, contenu=RECO_B, priorite=PriorityLevel.CRITICAL))
    db.add(DemandeContact(id=uuid4(), feedback_id=fb_b1.id, nom="Client B", telephone="0622222222", souhaite_etre_rappele=True))
    db.add(Categorie(id=uuid4(), agence_id=c.b1, nom="Catégorie B1", active=True))
    db.commit()
    c.fb_b1 = fb_b1.id
    db.close()
    return c


def empreinte(ctx):
    """Contenu complet des tables touchées par les routes testées : égal avant et après un refus."""
    db = ctx.Session()
    try:
        agences = sorted((str(a.id), a.organisation_id and str(a.organisation_id), a.nom, a.ville, a.seuil_alerte, a.active)
                         for a in db.query(Agence).all())
        comptes = {m.__tablename__: sorted(str(i) for (i,) in db.query(m.id).all())
                   for m in (QRCode, Feedback, AnalyseIA, Recommandation, DemandeContact, Categorie, Utilisateur, Organisation)}
        return agences, comptes
    finally:
        db.close()


def _agences_de(ctx, organisation_id):
    db = ctx.Session()
    try:
        return {a.id for a in db.query(Agence).filter(Agence.organisation_id == organisation_id).all()}
    finally:
        db.close()


# ═════════════════════════ 1. PATCH d'une agence étrangère ═════════════════════════

def test_modifier_une_agence_d_une_autre_organisation_est_refuse_et_ne_change_rien(ctx):
    avant = empreinte(ctx)
    for corps in ({"nom": "Piratée", "seuil_alerte": 5, "active": False}, {"seuil_alerte": 99}, {"ville": "Ailleurs"}):
        r = ctx.client.patch(f"/agences/{ctx.b1}", headers=ctx.H(ctx.cx_a), json=corps)
        assert r.status_code in REFUS, (corps, r.text)
        assert "Agence B1" not in r.text and "Paris" not in r.text           # le refus ne révèle rien sur l'agence
    assert empreinte(ctx) == avant


def test_cas_positif_jumele_le_cx_modifie_sa_propre_agence(ctx):
    r = ctx.client.patch(f"/agences/{ctx.a1}", headers=ctx.H(ctx.cx_a), json={"ville": "Lyon 2e"})
    assert r.status_code == 200 and r.json()["ville"] == "Lyon 2e"
    # Et le CX de B ne touche pas à A1 : symétrie.
    avant = empreinte(ctx)
    assert ctx.client.patch(f"/agences/{ctx.a1}", headers=ctx.H(ctx.cx_b), json={"ville": "Piratée"}).status_code in REFUS
    assert empreinte(ctx) == avant


# ═════════════════════════ 2. DELETE d'une agence étrangère ═════════════════════════

def test_supprimer_une_agence_d_une_autre_organisation_est_refuse_et_ne_change_rien(ctx):
    avant = empreinte(ctx)
    r = ctx.client.delete(f"/agences/{ctx.b1}", headers=ctx.H(ctx.cx_a))
    assert r.status_code in REFUS, r.text
    assert empreinte(ctx) == avant
    # Une agence de A sans avis ne se supprime pas non plus par le CX de B.
    creee = ctx.client.post("/agences/", headers=ctx.H(ctx.cx_a), json={"nom": "A3 vide"}).json()["id"]
    apres_creation = empreinte(ctx)
    assert ctx.client.delete(f"/agences/{creee}", headers=ctx.H(ctx.cx_b)).status_code in REFUS
    assert empreinte(ctx) == apres_creation


def test_sans_authentification_ou_en_tant_que_responsable_d_agence_la_suppression_est_refusee(ctx):
    avant = empreinte(ctx)
    assert ctx.client.delete(f"/agences/{ctx.a1}").status_code in {401, 403}
    assert ctx.client.delete(f"/agences/{ctx.a1}", headers=ctx.H(ctx.am_a1)).status_code == 403
    assert empreinte(ctx) == avant


# ═════════════════════════ 3. POST /agences/ avec l'organisation d'une autre ═════════════════════════

def test_creation_d_agence_ignore_l_organisation_fournie_par_le_client(ctx):
    avant_b = _agences_de(ctx, ctx.org_b)
    avant_a = _agences_de(ctx, ctx.org_a)
    r = ctx.client.post("/agences/", headers=ctx.H(ctx.cx_a), params={"org_id": str(ctx.org_b)},
                        json={"nom": "Intruse", "organisation_id": str(ctx.org_b), "org_id": str(ctx.org_b)})
    assert r.status_code == 201
    assert r.json()["organisation_id"] == str(ctx.org_a)                  # créée chez le CX, jamais chez l'autre
    assert _agences_de(ctx, ctx.org_b) == avant_b                          # B n'a reçu aucune agence
    assert len(_agences_de(ctx, ctx.org_a)) == len(avant_a) + 1
    # Même chose en sens inverse.
    r2 = ctx.client.post("/agences/", headers=ctx.H(ctx.cx_b), json={"nom": "Intruse 2", "organisation_id": str(ctx.org_a)})
    assert r2.status_code == 201 and r2.json()["organisation_id"] == str(ctx.org_b)
    assert len(_agences_de(ctx, ctx.org_a)) == len(avant_a) + 1


def test_un_responsable_d_agence_ne_cree_pas_d_agence(ctx):
    avant = empreinte(ctx)
    assert ctx.client.post("/agences/", headers=ctx.H(ctx.am_a1), json={"nom": "X"}).status_code == 403
    assert empreinte(ctx) == avant


# ═════════════════════════ 4. /feedbacks/themes ═════════════════════════

def test_themes_du_cx_de_a_ne_contiennent_rien_venant_de_b(ctx):
    r = ctx.client.get("/feedbacks/themes", headers=ctx.H(ctx.cx_a))
    assert r.status_code == 200 and r.json() == ["attente"] and THEME_B not in r.text
    # Filtre sur une agence de B : toujours rien de B.
    filtre = ctx.client.get("/feedbacks/themes", headers=ctx.H(ctx.cx_a), params={"agence_id": str(ctx.b1)})
    assert filtre.status_code == 200 and THEME_B not in filtre.text and "attente" not in filtre.text
    # Cas positif jumelé : le CX de B voit son thème, et pas celui de A.
    b = ctx.client.get("/feedbacks/themes", headers=ctx.H(ctx.cx_b))
    assert b.json() == [THEME_B]


# ═════════════════════════ 5. /recommandations/organisation ═════════════════════════

def test_recommandations_du_cx_de_a_ne_contiennent_rien_venant_de_b(ctx):
    r = ctx.client.get("/recommandations/organisation", headers=ctx.H(ctx.cx_a))
    assert r.status_code == 200
    assert {x["id"] for x in r.json()} == {str(ctx.reco_a1), str(ctx.reco_a2)}
    assert RECO_B not in r.text and "Agence B1" not in r.text
    assert {x["agence_nom"] for x in r.json()} == {"Agence A1", "Agence A2"}
    b = ctx.client.get("/recommandations/organisation", headers=ctx.H(ctx.cx_b))
    assert [x["contenu"] for x in b.json()] == [RECO_B] and "Agence A" not in b.text


# ═════════════════════════ 6. GET /agences/ ═════════════════════════

def test_liste_des_agences_du_cx_de_a_sans_aucune_agence_de_b(ctx):
    r = ctx.client.get("/agences/", headers=ctx.H(ctx.cx_a))
    assert r.status_code == 200
    assert {a["id"] for a in r.json()} == {str(ctx.a1), str(ctx.a2)}
    assert "Agence B1" not in r.text and str(ctx.b1) not in r.text
    assert {a["id"] for a in ctx.client.get("/agences/", headers=ctx.H(ctx.cx_b)).json()} == {str(ctx.b1)}


# ═════════════════════════ Suppression d'une agence : refus dès qu'elle a des avis ═════════════════════════

MESSAGE_409 = "Cette agence a déjà reçu des avis : elle ne peut pas être supprimée."


def _existe_agence(ctx, agence_id):
    db = ctx.Session()
    try:
        return db.get(Agence, UUID(str(agence_id))) is not None
    finally:
        db.close()


def test_une_agence_qui_a_des_avis_ne_se_supprime_pas(ctx):
    avant = empreinte(ctx)
    r = ctx.client.delete(f"/agences/{ctx.a1}", headers=ctx.H(ctx.cx_a))
    assert r.status_code == 409 and r.json()["detail"].startswith(MESSAGE_409)
    assert empreinte(ctx) == avant                                           # rien n'est supprimé (ni QR, ni avis, ni analyses…)
    assert _existe_agence(ctx, ctx.a1)


def test_les_avis_recus_par_un_qr_code_desactive_comptent_aussi(ctx):
    db = ctx.Session()
    db.query(QRCode).filter(QRCode.agence_id == ctx.a1).update({"actif": False})
    db.commit(); db.close()
    avant = empreinte(ctx)
    assert ctx.client.delete(f"/agences/{ctx.a1}", headers=ctx.H(ctx.cx_a)).status_code == 409
    assert empreinte(ctx) == avant


def test_une_agence_sans_aucun_avis_se_supprime_comme_avant(ctx):
    creee = ctx.client.post("/agences/", headers=ctx.H(ctx.cx_a), json={"nom": "Agence neuve"})
    assert creee.status_code == 201
    agence_id = creee.json()["id"]
    assert _existe_agence(ctx, agence_id)
    r = ctx.client.delete(f"/agences/{agence_id}", headers=ctx.H(ctx.cx_a))
    assert r.status_code == 204 and not _existe_agence(ctx, agence_id)
    assert _existe_agence(ctx, ctx.a1) and _existe_agence(ctx, ctx.b1)       # les autres agences sont intactes


def test_ordre_des_controles_appartenance_avant_le_409(ctx):
    avant = empreinte(ctx)
    # CX d'une autre organisation sur une agence QUI A DES AVIS : 403, jamais 409 (il ne doit pas apprendre qu'il y a des avis).
    r = ctx.client.delete(f"/agences/{ctx.a1}", headers=ctx.H(ctx.cx_b))
    assert r.status_code == 403 and "avis" not in r.text.lower().replace("accès refusé", "")
    assert ctx.client.delete(f"/agences/{ctx.b1}", headers=ctx.H(ctx.cx_a)).status_code == 403
    # Agence inconnue : 404 ; sans authentification : refus avant tout ; responsable d'agence : 403.
    assert ctx.client.delete(f"/agences/{uuid4()}", headers=ctx.H(ctx.cx_a)).status_code == 404
    assert ctx.client.delete(f"/agences/{ctx.a1}").status_code in {401, 403}
    assert ctx.client.delete(f"/agences/{ctx.a1}", headers=ctx.H(ctx.am_a1)).status_code == 403
    assert empreinte(ctx) == avant
    # Le propriétaire, lui, reçoit bien le 409 sur la même agence.
    assert ctx.client.delete(f"/agences/{ctx.a1}", headers=ctx.H(ctx.cx_a)).status_code == 409
