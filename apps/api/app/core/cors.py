"""
Origines CORS autorisées.

Liste explicite uniquement : jamais de joker ni de regex, car allow_credentials=True est actif.

- Si ALLOWED_ORIGINS est renseignée (non vide après nettoyage), elle REMPLACE le défaut,
  quel que soit APP_ENV.
- Sinon le défaut dépend de APP_ENV : en "development", les origines locales s'ajoutent
  aux deux origines de production ; partout ailleurs, seules les deux origines de production.
"""
from typing import Iterable, List

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

ORIGINES_LOCALES: List[str] = [
    "http://localhost:4321",
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:4321",
    "http://127.0.0.1:5173",
]

ORIGINES_PRODUCTION: List[str] = [
    "https://ikan-1.onrender.com",  # formulaire client (QR codes)
    "https://ikanai-dashboard-fixs.onrender.com",  # dashboard
]


def defaut_allowed_origins(app_env: str) -> str:
    """Valeur par défaut de ALLOWED_ORIGINS (chaîne séparée par des virgules) selon APP_ENV."""
    if app_env == "development":
        return ",".join(ORIGINES_LOCALES + ORIGINES_PRODUCTION)
    return ",".join(ORIGINES_PRODUCTION)


def normaliser_origines(valeur: str) -> List[str]:
    """Découpe sur les virgules, retire espaces, entrées vides et « / » finaux, sans doublon."""
    vues: List[str] = []
    for brut in valeur.split(","):
        origine = brut.strip().rstrip("/")
        if origine and origine not in vues:
            vues.append(origine)
    return vues


def origines_autorisees(allowed_origins: str | None, app_env: str) -> List[str]:
    """Liste finale : la variable explicite si elle contient au moins une origine, sinon le défaut."""
    if allowed_origins is not None and allowed_origins.strip():
        origines = normaliser_origines(allowed_origins)
        if origines:
            return origines
        print("[CORS] ALLOWED_ORIGINS ne contient aucune origine valide : valeur par défaut utilisée")
    return normaliser_origines(defaut_allowed_origins(app_env))


def appliquer_cors(app: FastAPI, origines: Iterable[str]) -> None:
    """Unique point de configuration du middleware CORS (utilisé par app.main et par les tests)."""
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(origines),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Total-Count"],
    )
