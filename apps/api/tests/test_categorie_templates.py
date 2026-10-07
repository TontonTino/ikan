"""
app/services/categorie_templates.py — jeu de catégories de départ par secteur et logique
pure de rattrapage (réutilisée par la migration 026_telecom_categories_rattrapage).
"""
import os
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-categorie-templates-0123456789")

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.session import Base
from app.models.agence import Agence
from app.models.categorie import Categorie
from app.models.organisation import Organisation
from app.models.plan import Plan
from app.services.categorie_templates import (
    JAMAIS_AFFECTER_NOMS_NORMALISES,
    SECTEUR_CATEGORIES_DEPART,
    CategorieDepart,
    cles_attendues_par_nom_normalise,
    creer_categories_depart,
    normaliser_nom_categorie,
    resoudre_conflit_rattrapage,
)
import app.services.categorie_templates as categorie_templates


NOW = datetime.now(timezone.utc)


# ── normaliser_nom_categorie ─────────────────────────────────────────────────────

@pytest.mark.parametrize("nom,attendu", [
    ("Accueil", "accueil"),
    ("Carte SIM & Numéro", "carte sim numero"),
    ("Internet & Réseau Mobile", "internet reseau mobile"),
    ("ÉQUIPEMENTS & BOUTIQUE", "equipements boutique"),
    ("  Service   Client  ", "service client"),
    ("Acceuil", "acceuil"),  # faute de frappe réelle observée en base : NE matche PAS "accueil"
])
def test_normaliser_nom_categorie(nom, attendu):
    assert normaliser_nom_categorie(nom) == attendu


def test_normaliser_distingue_accueil_de_la_faute_de_frappe_acceuil():
    """Preuve explicite du cas réel trouvé en base (Orange Burkina Faso, agence Ouaga
    2000) : "Acceuil" (faute de frappe, inactive) ne doit jamais prendre la clé "accueil"."""
    assert normaliser_nom_categorie("Accueil") != normaliser_nom_categorie("Acceuil")


# ── cles_attendues_par_nom_normalise ─────────────────────────────────────────────

def test_cles_attendues_telecom_couvre_les_7_libelles_matchables():
    cles = cles_attendues_par_nom_normalise("telecom")
    assert cles["accueil"] == "accueil"
    assert cles["service client"] == "service_client"
    assert cles["carte sim numero"] == "carte_sim_numero"
    assert cles["forfaits recharge"] == "forfaits_recharge"
    assert cles["internet reseau mobile"] == "internet_reseau_mobile"
    assert cles["facturation paiement"] == "facturation_paiement"
    assert cles["equipements boutique"] == "equipements_boutique"
    assert cles["mobile money"] == "mobile_money"
    assert len(cles) == 8


def test_cles_attendues_secteur_sans_registre_est_vide():
    assert cles_attendues_par_nom_normalise("banque") == {}
    assert cles_attendues_par_nom_normalise("code_inconnu") == {}


def test_jamais_affecter_ne_correspond_a_aucune_cle_telecom():
    """Les 4 noms protégés ne doivent de toute façon jamais matcher une clé — la liste de
    sécurité est une ceinture-et-bretelles, pas le seul rempart."""
    cles = cles_attendues_par_nom_normalise("telecom")
    for nom in ("nnv", "general", "formation", "proprete"):
        assert nom in JAMAIS_AFFECTER_NOMS_NORMALISES
        assert nom not in cles


# ── resoudre_conflit_rattrapage ──────────────────────────────────────────────────

@dataclass
class _Candidat:
    id: str
    nom: str
    active: bool
    created_at: datetime


def test_resoudre_conflit_un_seul_candidat():
    c = _Candidat("1", "Accueil", True, NOW)
    gagnant, perdants = resoudre_conflit_rattrapage([c])
    assert gagnant is c
    assert perdants == []


def test_resoudre_conflit_une_seule_active_gagne():
    actif = _Candidat("1", "Accueil", True, NOW)
    inactif = _Candidat("2", "Acceuil (doublon)", False, NOW - timedelta(days=10))
    gagnant, perdants = resoudre_conflit_rattrapage([inactif, actif])
    assert gagnant is actif
    assert perdants == [inactif]


def test_resoudre_conflit_plusieurs_actives_la_plus_ancienne_gagne():
    plus_recente = _Candidat("1", "Accueil", True, NOW)
    plus_ancienne = _Candidat("2", "Accueil (bis)", True, NOW - timedelta(days=30))
    gagnant, perdants = resoudre_conflit_rattrapage([plus_recente, plus_ancienne])
    assert gagnant is plus_ancienne
    assert perdants == [plus_recente]


def test_resoudre_conflit_aucune_active_la_plus_ancienne_gagne():
    a = _Candidat("1", "Accueil", False, NOW - timedelta(days=5))
    b = _Candidat("2", "Accueil (bis)", False, NOW - timedelta(days=50))
    gagnant, perdants = resoudre_conflit_rattrapage([a, b])
    assert gagnant is b
    assert perdants == [a]


# ── creer_categories_depart (DB SQLite en mémoire) ───────────────────────────────

@pytest.fixture()
def db_session():
    engine = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine, tables=[Plan.__table__, Organisation.__table__, Agence.__table__, Categorie.__table__])
    Session = sessionmaker(bind=engine)
    db = Session()
    yield db
    db.close()


def _creer_org_et_agence(db, secteur_code: str):
    org = Organisation(id=uuid.uuid4(), nom="Org", active=True, secteur_code=secteur_code)
    db.add(org)
    db.flush()
    agence = Agence(id=uuid.uuid4(), organisation_id=org.id, nom="Agence", active=True)
    db.add(agence)
    db.flush()
    return org, agence


def test_creer_categories_depart_sans_registre_ne_fait_rien(db_session):
    """secteur sans entrée dans SECTEUR_CATEGORIES_DEPART (ex. "autre") : aucun effet, le
    comportement actuel ("Général" créé à la volée par get_or_create_categories_actives)
    reste intact."""
    org, agence = _creer_org_et_agence(db_session, "autre")
    creees = creer_categories_depart(db_session, agence)
    assert creees == []
    assert db_session.query(Categorie).filter(Categorie.agence_id == agence.id).count() == 0


def test_creer_categories_depart_telecom_cree_8_categories_mobile_money_inactive(db_session):
    org, agence = _creer_org_et_agence(db_session, "telecom")
    creees = creer_categories_depart(db_session, agence)
    assert len(creees) == 8
    categories = db_session.query(Categorie).filter(Categorie.agence_id == agence.id).all()
    assert len(categories) == 8
    actives = [c for c in categories if c.active]
    inactives = [c for c in categories if not c.active]
    assert len(actives) == 7
    assert len(inactives) == 1
    assert inactives[0].cle == "mobile_money"
    assert inactives[0].nom == "Mobile Money"


def test_creer_categories_depart_idempotent(db_session):
    org, agence = _creer_org_et_agence(db_session, "telecom")
    creer_categories_depart(db_session, agence)
    db_session.commit()
    total_apres_premier_appel = db_session.query(Categorie).filter(Categorie.agence_id == agence.id).count()

    creees_second_appel = creer_categories_depart(db_session, agence)
    db_session.commit()
    total_apres_second_appel = db_session.query(Categorie).filter(Categorie.agence_id == agence.id).count()

    assert creees_second_appel == []
    assert total_apres_premier_appel == total_apres_second_appel == 8


def test_creer_categories_depart_registre_injecte_seulement_le_bon_secteur(db_session, monkeypatch):
    """Avec un registre injecté UNIQUEMENT dans ce test (jamais le vrai
    SECTEUR_CATEGORIES_DEPART) : seule l'organisation du secteur concerné reçoit les
    catégories, les autres secteurs restent inchangés."""
    monkeypatch.setitem(
        categorie_templates.SECTEUR_CATEGORIES_DEPART, "restauration",
        [CategorieDepart("salle", "Salle"), CategorieDepart("cuisine", "Cuisine", active=False)],
    )
    _, agence_restau = _creer_org_et_agence(db_session, "restauration")
    _, agence_commerce = _creer_org_et_agence(db_session, "commerce")

    creees_restau = creer_categories_depart(db_session, agence_restau)
    creees_commerce = creer_categories_depart(db_session, agence_commerce)

    assert {c.cle for c in creees_restau} == {"salle", "cuisine"}
    assert creees_commerce == []
    assert db_session.query(Categorie).filter(Categorie.agence_id == agence_commerce.id).count() == 0
