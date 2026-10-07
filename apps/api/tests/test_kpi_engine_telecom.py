"""
Pack KPI telecom — calculs (app/services/kpi/engine.py::calculer_tel_*). Base SQLite en
mémoire, jeu de données construit à la main couvrant les 3 groupes de périmètre (agence,
mixte, hors_agence — app/services/kpi/packs_telecom.py), le groupe mixte exclu des KPI de
récurrence, les Issues non classées, et le seuil de 5.
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-kpi-telecom-tests-0123456789")

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.session import Base
from app.models.agence import Agence
from app.models.categorie import Categorie
from app.models.enums import CriticiteType
from app.models.issue import Issue
from app.models.organisation import Organisation
from app.models.plan import Plan
from app.services.kpi.engine import (
    calculer_tel_part_hors_perimetre,
    calculer_tel_recurrence_agence,
    calculer_tel_recurrence_hors_perimetre,
)

NOW = datetime.now(timezone.utc)


def _issue(organisation_id, agence_id, categorie_id=None, recurrente=False, titre="Issue"):
    return Issue(
        id=uuid.uuid4(), organisation_id=organisation_id, agence_id=agence_id, titre=titre,
        statut="ouverte", severite=CriticiteType.FAIBLE, necessite_action=False,
        premiere_detection=NOW, categorie_id=categorie_id,
        issue_origine_id=uuid.uuid4() if recurrente else None,
    )


@pytest.fixture()
def ctx():
    engine = create_engine("sqlite+pysqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine, tables=[Plan.__table__, Organisation.__table__, Agence.__table__, Categorie.__table__, Issue.__table__])
    Session = sessionmaker(bind=engine)
    db = Session()

    org_a = Organisation(id=uuid.uuid4(), nom="Org A (telecom)", active=True, secteur_code="telecom")
    org_b = Organisation(id=uuid.uuid4(), nom="Org B (telecom, isolation)", active=True, secteur_code="telecom")
    db.add_all([org_a, org_b])
    db.flush()

    agence_a1 = Agence(id=uuid.uuid4(), organisation_id=org_a.id, nom="A1", active=True)
    agence_a2 = Agence(id=uuid.uuid4(), organisation_id=org_a.id, nom="A2", active=True)
    agence_b = Agence(id=uuid.uuid4(), organisation_id=org_b.id, nom="B", active=True)
    db.add_all([agence_a1, agence_a2, agence_b])
    db.flush()

    def cat(agence_id, cle, nom="Categorie"):
        c = Categorie(id=uuid.uuid4(), agence_id=agence_id, nom=nom, active=True, cle=cle)
        db.add(c)
        db.flush()
        return c

    # Catégories de l'agence A1, une par clé pertinente + une sans clé + une hors pack.
    cat_accueil = cat(agence_a1.id, "accueil", "Accueil")
    cat_service_client = cat(agence_a1.id, "service_client", "Service Client")
    cat_forfaits = cat(agence_a1.id, "forfaits_recharge", "Forfaits & Recharge")  # mixte
    cat_internet = cat(agence_a1.id, "internet_reseau_mobile", "Internet & Réseau Mobile")
    cat_facturation = cat(agence_a1.id, "facturation_paiement", "Facturation & Paiement")
    cat_sans_cle = cat(agence_a1.id, None, "Catégorie libre sans clé")
    cat_hors_pack = cat(agence_a1.id, "cle_dun_autre_pack_imaginaire", "Catégorie d'un autre pack")

    # 11 Issues sur A1, dans la période, organisation_id=org_a :
    # 3 accueil (groupe agence), 1 recurrente
    db.add(_issue(org_a.id, agence_a1.id, cat_accueil.id, recurrente=True, titre="accueil-1-recurrente"))
    db.add(_issue(org_a.id, agence_a1.id, cat_accueil.id, titre="accueil-2"))
    db.add(_issue(org_a.id, agence_a1.id, cat_accueil.id, titre="accueil-3"))
    # 2 service_client (groupe agence), 1 recurrente -> agence total=5, recurrentes=2
    db.add(_issue(org_a.id, agence_a1.id, cat_service_client.id, recurrente=True, titre="sc-1-recurrente"))
    db.add(_issue(org_a.id, agence_a1.id, cat_service_client.id, titre="sc-2"))
    # 1 forfaits (groupe mixte) — ne doit compter nulle part dans les KPI de récurrence
    db.add(_issue(org_a.id, agence_a1.id, cat_forfaits.id, recurrente=True, titre="forfaits-mixte-exclue"))
    # 2 internet + 1 facturation (groupe hors_agence) = 3, sous le seuil de 5
    db.add(_issue(org_a.id, agence_a1.id, cat_internet.id, titre="internet-1"))
    db.add(_issue(org_a.id, agence_a1.id, cat_internet.id, titre="internet-2"))
    db.add(_issue(org_a.id, agence_a1.id, cat_facturation.id, titre="facturation-1"))
    # 2 non classées : 1 sans catégorie du tout, 1 avec catégorie sans clé du pack
    db.add(_issue(org_a.id, agence_a1.id, None, titre="sans-categorie"))
    db.add(_issue(org_a.id, agence_a1.id, cat_hors_pack.id, titre="hors-pack"))

    # Agence A2 : aucune Issue (sert à vérifier l'isolation par agence : filtrer sur A1 ne
    # doit jamais inclure A2, et filtrer sur A2 ne doit jamais inclure A1).
    cat_accueil_a2 = cat(agence_a2.id, "accueil", "Accueil (A2)")
    db.add(_issue(org_a.id, agence_a2.id, cat_accueil_a2.id, titre="a2-accueil-seule"))

    # Org B : données totalement différentes, sert à l'isolation inter-organisation.
    cat_accueil_b = cat(agence_b.id, "accueil", "Accueil (B)")
    for i in range(6):
        db.add(_issue(org_b.id, agence_b.id, cat_accueil_b.id, recurrente=(i == 0), titre=f"b-accueil-{i}"))

    db.commit()
    return {
        "org_a": org_a.id, "org_b": org_b.id,
        "agence_a1": agence_a1.id, "agence_a2": agence_a2.id, "agence_b": agence_b.id,
        "db": db,
    }


# ── TEL_PART_HORS_PERIMETRE ──────────────────────────────────────────────────────

def test_tel_part_hors_perimetre_calcul_et_non_classees(ctx):
    # A1 : 11 Issues. Classées = agence(3 accueil + 2 service_client) + mixte(1 forfaits)
    # + hors_agence(2 internet + 1 facturation) = 9. Non classées = 11 - 9 = 2 (sans
    # catégorie, catégorie hors pack). hors_agence (numérateur) = 2 + 1 = 3.
    r = calculer_tel_part_hors_perimetre(ctx["db"], ctx["org_a"], agence_id=ctx["agence_a1"])
    assert r.status == "ok"
    assert r.denominator == 9
    assert r.numerator == 3
    assert r.value == round(3 / 9 * 100, 1)
    assert r.non_classees_count == 2


def test_tel_part_hors_perimetre_isolation_agence(ctx):
    """A2 n'a qu'une Issue classée (accueil) : jamais contaminée par les 10 Issues de A1."""
    r = calculer_tel_part_hors_perimetre(ctx["db"], ctx["org_a"], agence_id=ctx["agence_a2"])
    assert r.denominator == 1
    assert r.numerator == 0
    assert r.non_classees_count == 0


def test_tel_part_hors_perimetre_isolation_organisation(ctx):
    """Org B n'a que des Issues 'accueil' (groupe agence) : jamais hors_agence."""
    r = calculer_tel_part_hors_perimetre(ctx["db"], ctx["org_b"])
    assert r.denominator == 6
    assert r.numerator == 0
    assert r.value == 0.0


# ── TEL_RECURRENCE_AGENCE / TEL_RECURRENCE_HORS_PERIMETRE ────────────────────────

def test_tel_recurrence_agence_atteint_le_seuil_et_exclut_le_mixte(ctx):
    r = calculer_tel_recurrence_agence(ctx["db"], ctx["org_a"], agence_id=ctx["agence_a1"])
    assert r.status == "ok"
    assert r.denominator == 5  # 3 accueil + 2 service_client — jamais le forfaits (mixte)
    assert r.numerator == 2
    assert r.value == round(2 / 5 * 100, 1)


def test_tel_recurrence_hors_perimetre_sous_le_seuil_de_5(ctx):
    r = calculer_tel_recurrence_hors_perimetre(ctx["db"], ctx["org_a"], agence_id=ctx["agence_a1"])
    assert r.status == "no_data"
    assert r.denominator == 3  # 2 internet + 1 facturation, sous le seuil de 5


def test_tel_recurrence_organisation_sans_issue_telecom_est_no_data(ctx):
    """Secteur telecom mais pas d'Issue du tout sur ce périmètre précis (A2 pour le groupe
    hors_agence) : no_data, jamais une exception ni une division par zéro."""
    r = calculer_tel_recurrence_hors_perimetre(ctx["db"], ctx["org_a"], agence_id=ctx["agence_a2"])
    assert r.status == "no_data"
    assert r.denominator == 0


def test_tel_recurrence_isolation_organisation(ctx):
    """Org B : 6 Issues 'accueil' (groupe agence), 1 récurrente — jamais mélangées avec A."""
    r = calculer_tel_recurrence_agence(ctx["db"], ctx["org_b"])
    assert r.status == "ok"
    assert r.denominator == 6
    assert r.numerator == 1
