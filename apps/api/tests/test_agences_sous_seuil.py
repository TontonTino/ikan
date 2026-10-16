"""
CX-06 — liste des agences ACTUELLEMENT sous leur seuil (champ additif `agences_sous_seuil` de GET /alertes, CX Manager).

Satisfaction glissante de 7 jours, au moins 3 avis, strictement sous le seuil de l'agence (même calcul que les alertes). Le badge
`depuis_plus_de_48h` reprend le test de persistance de l'alerte CX. `alertes_seuil` (alertes à 48 h) est inchangé.

Vrai routeur, vrai JWT, SQLite en mémoire (fixture partagée : organisations A — A1, A2 — et B — B1). Scénario construit ici.
"""
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from app.api.v1.endpoints import alertes
from app.core.security import get_password_hash
from app.models.agence import Agence
from app.models.enums import UserRole
from app.models.feedback import Feedback
from app.models.qr_code import QRCode
from app.models.utilisateur import Utilisateur
from tests._fixture_deux_agences import construire_contexte

MAINTENANT = datetime.now(timezone.utc)


def creer_agence(ctx, nom, organisation_id, seuil, avis, *, active=True):
    """`avis` : liste de (note, âge en heures)."""
    db = ctx.Session()
    try:
        agence = Agence(id=uuid4(), organisation_id=organisation_id, nom=nom, ville="Ville", active=active, seuil_alerte=seuil)
        db.add(agence); db.flush()
        qr = QRCode(id=uuid4(), agence_id=agence.id, code=f"QR-{uuid4().hex[:8].upper()}", url="http://t/x", actif=True)
        db.add(qr); db.flush()
        for note, heures in avis:
            db.add(Feedback(id=uuid4(), qr_code_id=qr.id, note=note, commentaire="avis", statut_traitement="nouveau",
                            date_soumission=MAINTENANT - timedelta(hours=heures)))
        db.commit()
        return agence.id
    finally:
        db.close()


@pytest.fixture()
def ctx(monkeypatch):
    # Forfait connu avec alertes, sans interroger la base réelle (plan_service ouvre sa propre connexion au moteur de l'application).
    monkeypatch.setattr(alertes, "organisation_a_la_fonctionnalite", lambda *a, **k: True)
    c = construire_contexte()
    db = c.Session()
    c.org_a, c.org_b = db.get(Agence, c.a1).organisation_id, db.get(Agence, c.b1).organisation_id
    # La fixture met un avis (note 1, maintenant) sur A1, A2 et aucun sur B1. On neutralise A1 et A2 : ce sont des agences témoins.
    db.query(Feedback).delete()
    for agence in db.query(Agence).all():
        agence.active = False
    cx = lambda org: Utilisateur(id=uuid4(), organisation_id=org, nom="N", prenom="CX", email=f"{uuid4().hex[:8]}@t.io",  # noqa: E731
                                 mot_de_passe_hash=get_password_hash("Motdepasse-123"), role=UserRole.CX_MANAGER, active=True)
    c.cx_a, c.cx_b = cx(c.org_a), cx(c.org_b)
    db.add_all([c.cx_a, c.cx_b]); db.commit()
    c.cx_a, c.cx_b = c.cx_a.id, c.cx_b.id
    db.close()

    # Organisation A — seuil 70 % sauf mention contraire.
    c.persistante = creer_agence(c, "Agence persistante", c.org_a, 70, [(1, 96), (1, 90), (5, 80), (1, 2)])       # 25 % sur 4 avis, sous le seuil depuis 4 jours
    c.recente = creer_agence(c, "Agence récente", c.org_a, 70, [(1, 5), (5, 3), (1, 1)])                       # 33,3 % sur 3 avis, depuis quelques heures
    c.au_dessus = creer_agence(c, "Agence au-dessus", c.org_a, 70, [(5, 90), (5, 80), (4, 2), (5, 1)])         # 100 %
    c.exactement = creer_agence(c, "Agence exactement au seuil", c.org_a, 75, [(5, 90), (5, 80), (5, 2), (1, 1)])   # 75 % = seuil
    c.inactive = creer_agence(c, "Agence inactive", c.org_a, 70, [(1, 90), (1, 80), (1, 2)], active=False)     # sous le seuil mais inactive
    c.peu_d_avis = creer_agence(c, "Agence peu d'avis", c.org_a, 70, [(1, 2), (1, 1)])                         # 2 avis : pas de calcul
    # Organisation B : sous son seuil aussi.
    c.agence_b = creer_agence(c, "Agence B sous le seuil", c.org_b, 70, [(1, 90), (1, 80), (1, 2)])
    return c


def lire(ctx, acteur):
    r = ctx.client.get("/alertes/", headers=ctx.H(getattr(ctx, acteur)))
    assert r.status_code == 200, r.text
    return r.json()


def ids(liste):
    return [x["agence_id"] for x in liste]


# ─────────────────────────── contenu et tri ───────────────────────────

def test_le_cx_voit_les_agences_actuellement_sous_leur_seuil_la_plus_en_difficulte_d_abord(ctx):
    corps = lire(ctx, "cx_a")
    liste = corps["agences_sous_seuil"]
    assert ids(liste) == [str(ctx.persistante), str(ctx.recente)]          # écart 45 pts puis 36,7 pts
    persistante, recente = liste
    assert (persistante["agence_nom"], persistante["taux_actuel"], persistante["seuil"], persistante["ecart_seuil"]) == ("Agence persistante", 25.0, 70.0, 45.0)
    assert (recente["taux_actuel"], recente["ecart_seuil"]) == (33.3, 36.7)
    assert persistante["gravite"] == "critique" and set(persistante) >= {"agence_id", "agence_nom", "taux_actuel", "seuil", "ecart_seuil", "depuis_plus_de_48h", "gravite"}


def test_agences_au_dessus_exactement_au_seuil_inactives_ou_sans_assez_d_avis_sont_absentes(ctx):
    liste = lire(ctx, "cx_a")["agences_sous_seuil"]
    for absente in (ctx.au_dessus, ctx.exactement, ctx.inactive, ctx.peu_d_avis):
        assert str(absente) not in ids(liste)


def test_exactement_au_seuil_n_est_pas_sous_le_seuil_mais_un_point_de_plus_l_est(ctx):
    db = ctx.Session(); db.get(Agence, ctx.exactement).seuil_alerte = 75.1; db.commit(); db.close()
    assert str(ctx.exactement) in ids(lire(ctx, "cx_a")["agences_sous_seuil"])          # 75 % < 75,1 %
    db = ctx.Session(); db.get(Agence, ctx.exactement).seuil_alerte = 75.0; db.commit(); db.close()
    assert str(ctx.exactement) not in ids(lire(ctx, "cx_a")["agences_sous_seuil"])      # 75 % = 75 %


def test_une_agence_inactive_reactivee_apparait(ctx):
    db = ctx.Session(); db.get(Agence, ctx.inactive).active = True; db.commit(); db.close()
    assert str(ctx.inactive) in ids(lire(ctx, "cx_a")["agences_sous_seuil"])


def test_a_ecart_egal_le_tri_se_fait_par_nom(ctx):
    a = creer_agence(ctx, "Zèbre", ctx.org_a, 70, [(1, 90), (1, 80), (1, 2)])
    b = creer_agence(ctx, "Abeille", ctx.org_a, 70, [(1, 90), (1, 80), (1, 2)])
    liste = ids(lire(ctx, "cx_a")["agences_sous_seuil"])
    assert liste.index(str(b)) < liste.index(str(a))
    assert liste[0] in {str(b), str(a)}          # 100 % de mécontents : écart maximal, avant « persistante »


# ─────────────────────────── badge « depuis plus de 48 h » ───────────────────────────

def test_le_badge_48_h_est_present_avec_une_persistance_et_absent_sans(ctx):
    par_id = {x["agence_id"]: x for x in lire(ctx, "cx_a")["agences_sous_seuil"]}
    assert par_id[str(ctx.persistante)]["depuis_plus_de_48h"] is True
    assert par_id[str(ctx.recente)]["depuis_plus_de_48h"] is False


def test_les_alertes_du_cx_restent_celles_a_48_h(ctx):
    corps = lire(ctx, "cx_a")
    assert ids(corps["alertes_seuil"]) == [str(ctx.persistante)]               # champ existant inchangé : seulement la persistante
    assert set(ids(corps["alertes_seuil"])) == {x["agence_id"] for x in corps["agences_sous_seuil"] if x["depuis_plus_de_48h"]}
    assert corps["alertes_incluses"] is True


# ─────────────────────────── isolation ───────────────────────────

def test_le_cx_de_a_ne_voit_jamais_une_agence_de_b_et_inversement(ctx):
    corps = lire(ctx, "cx_a")
    assert str(ctx.agence_b) not in ids(corps["agences_sous_seuil"]) and "Agence B" not in str(corps)
    b = lire(ctx, "cx_b")
    assert ids(b["agences_sous_seuil"]) == [str(ctx.agence_b)] and "Agence persistante" not in str(b)


def test_le_responsable_d_agence_n_a_pas_cette_liste_et_ses_alertes_sont_inchangees(ctx):
    db = ctx.Session()
    db.get(Agence, ctx.a1).active = True
    db.add(Utilisateur(id=uuid4(), organisation_id=ctx.org_a, agence_id=ctx.persistante, nom="N", prenom="AM", email=f"{uuid4().hex[:8]}@t.io",
                       mot_de_passe_hash=get_password_hash("Motdepasse-123"), role=UserRole.AGENCY_MANAGER, active=True))
    db.commit(); db.close()
    db = ctx.Session(); am = db.query(Utilisateur).filter(Utilisateur.role == UserRole.AGENCY_MANAGER, Utilisateur.agence_id == ctx.persistante).one().id; db.close()
    ctx.am = am
    corps = lire(ctx, "am")
    assert corps["agences_sous_seuil"] == []
    assert ids(corps["alertes_seuil"]) == [str(ctx.persistante)]               # l'AM voit l'alerte de SA agence, comme avant


def test_sans_authentification_refuse(ctx):
    assert ctx.client.get("/alertes/").status_code in {401, 403}


# ─────────────────────────── forfait sans alertes ───────────────────────────

def test_forfait_sans_alertes_inchange_aucune_liste_et_indicateur_explicite(ctx, monkeypatch):
    monkeypatch.setattr(alertes, "organisation_a_la_fonctionnalite", lambda *a, **k: False)
    corps = lire(ctx, "cx_a")
    assert corps["alertes_incluses"] is False
    assert corps["alertes_seuil"] == [] and corps["alertes_feedback"] == [] and corps["agences_sous_seuil"] == []


def test_forfait_avec_alertes_la_liste_est_servie(ctx, monkeypatch):
    monkeypatch.setattr(alertes, "organisation_a_la_fonctionnalite", lambda *a, **k: True)
    corps = lire(ctx, "cx_a")
    assert corps["alertes_incluses"] is True and len(corps["agences_sous_seuil"]) == 2
