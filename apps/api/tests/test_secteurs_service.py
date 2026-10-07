"""
app/services/secteurs.py — source unique code/libellé de secteur, et sa fonction de
backfill (app/services/secteurs.py::normaliser_secteur_libre, dupliquée intentionnellement
dans la migration 023_organisation_secteur_code, voir sa docstring). Couvre aussi la
validation 422 de secteur_code sur OrganisationCreate/Update (app/schemas/organisation.py).

Les 4 valeurs réellement rencontrées en base (rapport d'audit KPI) sont testées
explicitement ; voir la migration 023 pour le résultat du backfill réel, listé dans sa PR.
"""
import os

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-secteurs-tests-0123456789")

import pytest
from pydantic import ValidationError

from app.schemas.organisation import OrganisationCreate, OrganisationUpdate
from app.services.secteurs import (
    SECTEUR_AUTRE,
    SECTEUR_CODES,
    libelle_secteur,
    normaliser_secteur_libre,
    secteurs_disponibles,
)


# ── normaliser_secteur_libre (backfill) ─────────────────────────────────────────

@pytest.mark.parametrize("valeur,code_attendu", [
    # Les 4 valeurs réellement observées en base au moment de l'audit.
    ("Télécommunications", "telecom"),
    ("Banque / Finance", "banque"),
    ("Commerce / Distribution", "commerce"),
    ("Santé / Pharmacie", "sante"),
    # Variantes et cas limites.
    ("banque", "banque"),
    ("Banque", "banque"),
    ("Finance", "banque"),
    ("telecom", "telecom"),
    ("Télécom", "telecom"),
    ("Restauration", "restauration"),
    ("Maquis", "restauration"),
    ("Hôtellerie", "hotellerie"),
    ("hotel", "hotellerie"),
    ("Commerce", "commerce"),
    ("Distribution", "commerce"),
    ("Santé", "sante"),
    ("Pharmacie", "sante"),
    ("Clinique", "sante"),
    ("Agro-alimentaire", SECTEUR_AUTRE),
    ("", SECTEUR_AUTRE),
    ("   ", SECTEUR_AUTRE),
    (None, SECTEUR_AUTRE),
])
def test_normaliser_secteur_libre(valeur, code_attendu):
    assert normaliser_secteur_libre(valeur) == code_attendu


def test_normaliser_secteur_libre_insensible_aux_accents_et_a_la_casse():
    assert normaliser_secteur_libre("TÉLÉCOMMUNICATIONS") == "telecom"
    assert normaliser_secteur_libre("sAnTé") == "sante"


# ── libelle_secteur / secteurs_disponibles ──────────────────────────────────────

def test_libelle_secteur_connu():
    assert libelle_secteur("banque") == "Banque"
    assert libelle_secteur("telecom") == "Télécommunications"


def test_libelle_secteur_inconnu_retombe_sur_autre_sans_exception():
    assert libelle_secteur("code_inexistant") == libelle_secteur(SECTEUR_AUTRE) == "Autre"
    assert libelle_secteur(None) == "Autre"


def test_secteurs_disponibles_couvre_tous_les_codes():
    disponibles = secteurs_disponibles()
    assert {s["code"] for s in disponibles} == set(SECTEUR_CODES)
    assert all(s["libelle"] for s in disponibles)


# ── Validation 422 (OrganisationCreate / OrganisationUpdate) ────────────────────

def _creation_valide(**overrides):
    base = dict(nom="Org Test", secteur_code="banque", pays_region="Burkina Faso", email_pro="contact@example.com")
    base.update(overrides)
    return base


def test_organisation_create_secteur_code_valide_ok():
    org = OrganisationCreate(**_creation_valide())
    assert org.secteur_code == "banque"


def test_organisation_create_secteur_code_invalide_422():
    with pytest.raises(ValidationError):
        OrganisationCreate(**_creation_valide(secteur_code="invalide"))


def test_organisation_create_secteur_code_obligatoire():
    data = _creation_valide()
    del data["secteur_code"]
    with pytest.raises(ValidationError):
        OrganisationCreate(**data)


def test_organisation_create_secteur_activite_deductible_si_omis():
    """secteur_activite n'est plus obligatoire — l'endpoint (pas le schéma) déduit le
    libellé de secteur_code quand il est omis, voir organisations.py::create_organisation."""
    org = OrganisationCreate(**_creation_valide())
    assert org.secteur_activite is None


def test_organisation_update_secteur_code_optionnel():
    assert OrganisationUpdate(secteur_code=None).secteur_code is None


def test_organisation_update_secteur_code_invalide_422():
    with pytest.raises(ValidationError):
        OrganisationUpdate(secteur_code="invalide")


def test_organisation_update_secteur_code_valide_ok():
    assert OrganisationUpdate(secteur_code="restauration").secteur_code == "restauration"
