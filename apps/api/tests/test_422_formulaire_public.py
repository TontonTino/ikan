"""
Le gestionnaire de 422 (app/core/erreurs_validation.py) ne change que ce qu'il annonce : il retire `input`, `ctx` et `url` et traduit
« Field required ». Le formulaire public d'avis (apps/client/src/pages/feedback/[code].astro) lit le 422 ainsi :

    res.status === 422 && Array.isArray(err.detail) && err.detail.some((d) => Array.isArray(d?.loc) && d.loc.includes('contact_telephone'))

Ces tests figent cette forme (statut, `detail` en liste, `loc` en liste contenant « contact_telephone », `type`, `msg`).
"""
import os

os.environ.setdefault("SECRET_KEY", "test-secret-key-for-422-formulaire-public-0123456789")

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.endpoints import feedbacks
from app.core.erreurs_validation import installer_erreurs_validation
from app.db.session import get_db

CORPS_TELEPHONE_INVALIDE = {"note": 2, "souhaite_etre_rappele": True, "contact_telephone": "70 12 34 5a", "consentement_contact": True}


def _db_factice():
    yield None   # la validation du corps échoue avant tout accès à la base


def _app():
    app = FastAPI()
    app.include_router(feedbacks.router, prefix="/feedbacks")
    app.dependency_overrides[get_db] = _db_factice
    return app


def _lire_comme_apps_client(corps) -> bool:
    detail = corps.get("detail")
    return isinstance(detail, list) and any(isinstance(d, dict) and isinstance(d.get("loc"), list) and "contact_telephone" in d["loc"] for d in detail)


def test_le_422_du_formulaire_public_garde_la_forme_attendue_par_apps_client():
    avant = TestClient(_app()).post("/feedbacks/", params={"qr_code": "QR-X"}, json=CORPS_TELEPHONE_INVALIDE)
    assert avant.status_code == 422 and _lire_comme_apps_client(avant.json())      # forme par défaut de FastAPI

    app = _app()
    installer_erreurs_validation(app)                                              # installé AVANT la première requête (comme main.py)
    apres = TestClient(app).post("/feedbacks/", params={"qr_code": "QR-X"}, json=CORPS_TELEPHONE_INVALIDE)
    assert apres.status_code == 422
    assert _lire_comme_apps_client(apres.json())                                   # ce que lit apps/client : inchangé
    assert "Numéro de téléphone invalide" in apres.text                            # message de la validation maison conservé
    erreurs_avant, erreurs_apres = avant.json()["detail"], apres.json()["detail"]
    assert [(e["type"], e["loc"]) for e in erreurs_apres] == [(e["type"], e["loc"]) for e in erreurs_avant]
    for e in erreurs_apres:
        assert set(e) == {"type", "loc", "msg"}                                    # plus d'`input`, de `ctx`, d'`url`
    assert "70 12 34 5a" not in apres.text and "70 12 34 5a" in avant.text         # la valeur saisie n'est plus renvoyée


@pytest.mark.parametrize("corps", [{}, {"note": "abc"}, {"note": 9}])
def test_les_autres_422_du_formulaire_public_restent_des_422_en_liste(corps):
    app = _app()
    installer_erreurs_validation(app)
    r = TestClient(app).post("/feedbacks/", params={"qr_code": "QR-X"}, json=corps)
    assert r.status_code == 422 and isinstance(r.json()["detail"], list) and r.json()["detail"]
    assert all(isinstance(e["loc"], list) and "msg" in e and "type" in e for e in r.json()["detail"])


def test_le_vrai_point_d_entree_de_l_api_installe_le_gestionnaire():
    """app.main.app (celui de la production) : un 422 de connexion ne renvoie pas le mot de passe saisi."""
    from app.main import app as application
    secret = "Secr3t-Valeur-Distinctive"
    r = TestClient(application).post("/api/v1/auth/login", json={"email": "pas-un-email", "password": secret})
    assert r.status_code == 422 and secret not in r.text and "input" not in r.text
    assert all(set(e) == {"type", "loc", "msg"} for e in r.json()["detail"])
