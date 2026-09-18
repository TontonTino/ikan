"""
Tests du service de forfaits : catalogue, fail-open, cache, et non-régression du
pipeline d'analyse (un feedback est TOUJOURS traité, même si la vérification de
plan échoue).
"""
import uuid
from types import SimpleNamespace

import pytest

from app.services import plan_service
from app.services.plan_catalog import (
    FEATURES_GATEES,
    FEATURES_MARKETING,
    FEATURES_TOUJOURS_ACTIVES,
    FEATURE_ALERTES,
    FEATURE_ANALYSE_SENTIMENT,
    FEATURE_CATEGORIES,
    FEATURE_DISCORDANCE,
    FEATURE_QR_FORMULAIRE,
    PLANS,
    PLAN_FEATURES,
)
from app.services.plan_service import organisation_a_la_fonctionnalite

ORG = uuid.uuid4()


class FakeDb:
    """Stand-in minimal : le service n'utilise que db.info comme support de cache."""
    def __init__(self):
        self.info = {}


def _simuler_plan(monkeypatch, plan_code):
    """Fait répondre _lire_feature comme la base le ferait pour ce plan."""
    def fake(org, code):
        return code in PLAN_FEATURES[plan_code]
    monkeypatch.setattr(plan_service, "_lire_feature", fake)


# ── Catalogue ────────────────────────────────────────────────────────────────

def test_catalogue_limites_des_4_plans():
    assert PLANS["gratuit"][3:] == (1, 1, 20)
    assert PLANS["starter"][3:] == (1, 3, None)
    assert PLANS["pro"][3:] == (3, 10, None)
    assert PLANS["entreprise"][3:] == (None, None, None)


def test_mapping_fonctionnalites_par_plan():
    assert set(PLAN_FEATURES["gratuit"]) == {"qr_formulaire", "analyse_sentiment"}
    assert set(PLAN_FEATURES["starter"]) == set(PLAN_FEATURES["gratuit"]) | {
        "categories_personnalisees", "alertes_satisfaction"}
    assert set(PLAN_FEATURES["pro"]) == set(PLAN_FEATURES["starter"]) | {"detection_discordance"}
    assert set(PLAN_FEATURES["entreprise"]) == set(PLAN_FEATURES["pro"]) | set(FEATURES_MARKETING)


def test_codes_marketing_jamais_verifiables():
    # Aucune implémentation derrière : ils ne doivent jamais être un code gaté.
    assert not set(FEATURES_MARKETING) & set(FEATURES_GATEES)


# ── Chaque feature × chaque plan ─────────────────────────────────────────────

@pytest.mark.parametrize("plan", list(PLANS))
@pytest.mark.parametrize("feature", list(FEATURES_GATEES))
def test_chaque_feature_pour_chaque_plan(monkeypatch, plan, feature):
    _simuler_plan(monkeypatch, plan)
    attendu = feature in PLAN_FEATURES[plan]
    assert organisation_a_la_fonctionnalite(ORG, feature, FakeDb()) is attendu


def test_matrice_explicite(monkeypatch):
    attendu = {
        "gratuit": {FEATURE_CATEGORIES: False, FEATURE_ALERTES: False, FEATURE_DISCORDANCE: False},
        "starter": {FEATURE_CATEGORIES: True, FEATURE_ALERTES: True, FEATURE_DISCORDANCE: False},
        "pro": {FEATURE_CATEGORIES: True, FEATURE_ALERTES: True, FEATURE_DISCORDANCE: True},
        "entreprise": {FEATURE_CATEGORIES: True, FEATURE_ALERTES: True, FEATURE_DISCORDANCE: True},
    }
    for plan, features in attendu.items():
        _simuler_plan(monkeypatch, plan)
        for feature, ok in features.items():
            assert organisation_a_la_fonctionnalite(ORG, feature, FakeDb()) is ok, (plan, feature)


# ── Fail-open ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("feature", list(FEATURES_GATEES))
def test_fail_open_sur_exception_db(monkeypatch, feature):
    def boom(org, code):
        raise RuntimeError("DB down")
    monkeypatch.setattr(plan_service, "_lire_feature", boom)
    assert organisation_a_la_fonctionnalite(ORG, feature, FakeDb()) is True


@pytest.mark.parametrize("feature", list(FEATURES_GATEES))
def test_fail_open_organisation_ou_plan_introuvable(monkeypatch, feature):
    monkeypatch.setattr(plan_service, "_lire_feature", lambda org, code: None)
    assert organisation_a_la_fonctionnalite(ORG, feature, FakeDb()) is True


def test_fail_open_organisation_non_identifiee():
    assert organisation_a_la_fonctionnalite(None, FEATURE_DISCORDANCE, FakeDb()) is True


def test_fail_open_code_inconnu(monkeypatch):
    _simuler_plan(monkeypatch, "gratuit")
    assert organisation_a_la_fonctionnalite(ORG, "code_inexistant", FakeDb()) is True


def test_fail_open_sans_db_ni_cache(monkeypatch):
    def boom(org, code):
        raise ConnectionError("réseau")
    monkeypatch.setattr(plan_service, "_lire_feature", boom)
    assert organisation_a_la_fonctionnalite(ORG, FEATURE_DISCORDANCE) is True


def test_fail_open_meme_si_le_cache_est_corrompu(monkeypatch):
    _simuler_plan(monkeypatch, "gratuit")
    db = SimpleNamespace(info=None)  # db.info.setdefault lèvera AttributeError
    assert organisation_a_la_fonctionnalite(ORG, FEATURE_DISCORDANCE, db) is True


def test_erreur_reelle_de_connexion_est_fail_open(monkeypatch):
    """Sans mock de _lire_feature : le moteur pointe vers une base injoignable."""
    from sqlalchemy import create_engine
    import app.db.session as session_mod
    monkeypatch.setattr(session_mod, "engine",
                        create_engine("postgresql://x:x@127.0.0.1:1/x", connect_args={"connect_timeout": 1}))
    assert organisation_a_la_fonctionnalite(ORG, FEATURE_DISCORDANCE, FakeDb()) is True


# ── Fonctionnalités de base inconditionnelles ────────────────────────────────

@pytest.mark.parametrize("feature", [FEATURE_QR_FORMULAIRE, FEATURE_ANALYSE_SENTIMENT])
def test_fonctions_de_base_toujours_actives(monkeypatch, feature):
    assert feature in FEATURES_TOUJOURS_ACTIVES

    def ne_doit_pas_etre_appele(org, code):
        raise AssertionError("aucun accès DB pour une fonctionnalité de base")
    monkeypatch.setattr(plan_service, "_lire_feature", ne_doit_pas_etre_appele)
    assert organisation_a_la_fonctionnalite(ORG, feature, FakeDb()) is True
    assert organisation_a_la_fonctionnalite(None, feature) is True


# ── Cache par requête ────────────────────────────────────────────────────────

def test_cache_une_seule_requete_par_session(monkeypatch):
    appels = []

    def fake(org, code):
        appels.append((org, code))
        return False
    monkeypatch.setattr(plan_service, "_lire_feature", fake)

    db = FakeDb()
    for _ in range(5):
        assert organisation_a_la_fonctionnalite(ORG, FEATURE_DISCORDANCE, db) is False
    assert len(appels) == 1

    # Une autre session (autre requête) ne partage pas le cache.
    organisation_a_la_fonctionnalite(ORG, FEATURE_DISCORDANCE, FakeDb())
    assert len(appels) == 2


# ── Pipeline d'analyse : un feedback est TOUJOURS traité ─────────────────────

def _brancher_analyse(monkeypatch, plan_service_stub):
    """Exécute analyser_feedback sur un feedback factice, sans base de données."""
    from app.services.ai import analyse_service
    from app.models.enums import SentimentType

    ajoutes = []

    class FakeQuery:
        def __init__(self, model): self.model = model
        def filter(self, *a, **k): return self
        def first(self):
            return FEATURE_FB if self.model.__name__ == "Feedback" else None

    class Db:
        info = {}
        def query(self, model): return FakeQuery(model)
        def add(self, obj): ajoutes.append(obj)
        def flush(self): pass
        def commit(self): pass
        def rollback(self): pass
        def close(self): pass

    fb_id = uuid.uuid4()
    FEATURE_FB = SimpleNamespace(
        id=fb_id, note=5,
        commentaire="Service catastrophique, personnel impoli, très déçu et en colère.",
        categorie=SimpleNamespace(nom="Accueil"),
        qr_code=SimpleNamespace(agence=SimpleNamespace(organisation_id=ORG)),
    )
    monkeypatch.setattr(analyse_service, "organisation_a_la_fonctionnalite", plan_service_stub)
    analyse_service.analyser_feedback(fb_id, Db())
    analyses = [o for o in ajoutes if o.__class__.__name__ == "AnalyseIA"]
    return analyses, SentimentType


def test_pipeline_gratuit_sentiment_calcule_sans_discordance(monkeypatch):
    analyses, S = _brancher_analyse(monkeypatch, lambda org, code, db=None: False)
    assert len(analyses) == 1
    assert analyses[0].sentiment == S.NEGATIF          # sentiment TOUJOURS calculé
    assert analyses[0].discordance_detectee is False   # discordance non calculée


def test_pipeline_pro_detecte_la_discordance(monkeypatch):
    analyses, S = _brancher_analyse(monkeypatch, lambda org, code, db=None: True)
    assert len(analyses) == 1
    assert analyses[0].sentiment == S.NEGATIF
    assert analyses[0].discordance_detectee is True


def test_pipeline_traite_le_feedback_meme_si_la_verification_de_plan_plante(monkeypatch):
    """Le service réel est fail-open : on simule une panne de lecture DB en profondeur."""
    from app.services.ai import analyse_service
    def boom(org, code):
        raise RuntimeError("Supabase injoignable")
    monkeypatch.setattr(plan_service, "_lire_feature", boom)
    analyses, S = _brancher_analyse(monkeypatch, plan_service.organisation_a_la_fonctionnalite)
    assert len(analyses) == 1                          # le feedback est bien analysé
    assert analyses[0].sentiment == S.NEGATIF
    assert analyses[0].discordance_detectee is True    # fail-open : fonctionnalité exécutée


def test_pipeline_traite_le_feedback_si_organisation_indeterminable(monkeypatch):
    from app.services.ai import analyse_service
    monkeypatch.setattr(analyse_service, "organisation_du_feedback", lambda fb: None)
    analyses, S = _brancher_analyse(monkeypatch, plan_service.organisation_a_la_fonctionnalite)
    assert len(analyses) == 1
    assert analyses[0].discordance_detectee is True


# ── Catalogue affiché : statut « a_venir » identique pour tous les forfaits ──

@pytest.mark.parametrize("plan", list(PLANS))
def test_a_venir_identique_pour_tous_les_forfaits(plan):
    from app.services.plan_service import construire_fonctionnalites
    fonctionnalites = construire_fonctionnalites(True, set(PLAN_FEATURES[plan]))
    a_venir = [f for f in fonctionnalites if f["statut"] == "a_venir"]

    assert [f["code"] for f in a_venir] == list(FEATURES_MARKETING)
    assert all(f["actif"] is False for f in a_venir)
    # Les gatées ne sont jamais « a_venir », les 4 marketing jamais « disponible »/« verrouille ».
    assert all(f["statut"] in ("disponible", "verrouille") for f in fonctionnalites if f["code"] in FEATURES_GATEES)
    assert not [f for f in fonctionnalites if f["code"] in FEATURES_MARKETING and f["statut"] != "a_venir"]


def test_a_venir_meme_sans_plan_connu():
    from app.services.plan_service import construire_fonctionnalites
    fonctionnalites = construire_fonctionnalites(False, set())
    assert [f["statut"] for f in fonctionnalites if f["code"] in FEATURES_MARKETING] == ["a_venir"] * 4
