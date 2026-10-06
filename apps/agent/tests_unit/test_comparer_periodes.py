"""
Comparaison de périodes de YAM (5B-2) : une période sans feedback n'est jamais
interprétée comme une hausse ou une baisse.

Tests UNITAIRES sans base de données : _requete_feedbacks est remplacé par un
double qui renvoie des feedbacks en mémoire selon la période demandée.

  python -m pytest tests_unit
"""
import os
import uuid

# Valeurs factices de test (aucun accès réseau ni base).
os.environ.setdefault("DATABASE_URL", "postgresql://test:test@127.0.0.1:1/ikanai_test_unit")  # jamais connectée
os.environ.setdefault("SECRET_KEY", "test-secret-key-minimisation-0123456789abcdef")
os.environ.setdefault("WEBHOOK_SECRET", "test-webhook-secret-minimisation")

from app.agent import queries  # noqa: E402

ORG = uuid.uuid4()


def _feedbacks(n, sentiment=0.8, criticite="faible", theme="accueil"):
    return [
        {"sentiment_score": sentiment, "criticite": criticite, "theme_principal": theme}
        for _ in range(n)
    ]


def _comparer(monkeypatch, actuelle, precedente):
    """comparer_periodes interroge d'abord la période actuelle, puis la précédente."""
    appels = iter([actuelle, precedente])
    monkeypatch.setattr(queries, "_requete_feedbacks", lambda *a, **k: next(appels))
    return queries.comparer_periodes(None, ORG, jours_periode=7)


def test_periode_actuelle_vide_ne_produit_pas_de_baisse(monkeypatch):
    """10 → 0 : aucune anomalie de sentiment ni de criticité, valeurs actuelles à None."""
    res = _comparer(monkeypatch, actuelle=[], precedente=_feedbacks(10, sentiment=0.8))
    assert res["periode_actuelle"] == {"total": 0, "sentiment_moyen": None, "taux_criticite": None, "par_theme": {}}
    assert res["periode_precedente"]["total"] == 10
    types = {a["type"] for a in res["anomalies"]}
    assert "sentiment" not in types and "criticite" not in types
    assert not any("en baisse" in a["description"] for a in res["anomalies"])


def test_periode_precedente_vide_ne_produit_pas_de_hausse(monkeypatch):
    """0 → 10 : pas de comparaison de sentiment/criticité (la détection de thème nouveau reste active)."""
    res = _comparer(monkeypatch, actuelle=_feedbacks(10, criticite="critique"), precedente=[])
    types = {a["type"] for a in res["anomalies"]}
    assert "sentiment" not in types and "criticite" not in types
    assert "theme_nouveau" in types
    assert res["periode_precedente"]["sentiment_moyen"] is None


def test_deux_periodes_avec_donnees_restent_comparees(monkeypatch):
    """N → M avec une vraie baisse : l'anomalie de sentiment est toujours détectée."""
    res = _comparer(monkeypatch, actuelle=_feedbacks(10, sentiment=-0.8), precedente=_feedbacks(10, sentiment=0.8))
    sentiment = [a for a in res["anomalies"] if a["type"] == "sentiment"]
    assert len(sentiment) == 1 and "en baisse" in sentiment[0]["description"]
