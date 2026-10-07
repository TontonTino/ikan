"""
Configuration CORS : liste explicite d'origines, jamais de joker ni de regex large
(allow_credentials=True est actif). Le défaut de ALLOWED_ORIGINS doit couvrir la
production actuelle (client + dashboard) et ne plus citer les anciens noms d'hôte.
"""
import os

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-cors-config-tests-0123456789")

from app.core.config import Settings


def _defaut() -> str:
    return Settings.model_fields["ALLOWED_ORIGINS"].default


def test_defaut_contient_client_et_dashboard_de_production():
    origines = _defaut().split(",")
    assert "https://ikan-1.onrender.com" in origines
    assert "https://ikanai-dashboard-fixs.onrender.com" in origines


def test_defaut_ne_cite_plus_les_anciens_noms_d_hote():
    assert "ikanai-client.onrender.com" not in _defaut()
    assert "ikanai-dashboard.onrender.com" not in _defaut()


def test_defaut_est_une_liste_explicite_sans_joker():
    origines = Settings(ALLOWED_ORIGINS=_defaut()).allowed_origins_list
    assert "*" not in origines
    assert all(o.startswith(("http://", "https://")) for o in origines)


def test_la_liste_de_la_variable_d_environnement_est_decoupee_et_nettoyee():
    s = Settings(ALLOWED_ORIGINS=" https://a.example , https://b.example ")
    assert s.allowed_origins_list == ["https://a.example", "https://b.example"]
