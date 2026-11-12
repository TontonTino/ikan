"""
Origines CORS autorisées.

Liste explicite uniquement : jamais de joker ni de regex, car allow_credentials=True est actif.

- Si ALLOWED_ORIGINS est renseignée (au moins une origine après nettoyage), elle fait foi, quel que soit APP_ENV.
- Sinon, en "development", repli sur les origines locales (localhost) ; partout ailleurs, l'API REFUSE de démarrer
  avec un message qui nomme la variable manquante. Aucune adresse de déploiement n'est codée ici : elle vient
  toujours de l'environnement du service (Render, AWS…), jamais d'un repli silencieux sur une ancienne adresse.
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


class OriginesManquantes(RuntimeError):
    """ALLOWED_ORIGINS absente ou vide hors développement : l'API ne doit pas démarrer."""


def message_origines_manquantes(app_env: str) -> str:
    return (
        f"ALLOWED_ORIGINS est manquante ou vide (APP_ENV={app_env}). Hors développement, l'API ne démarre pas sans "
        "elle : renseignez les adresses du formulaire client et du dashboard, séparées par des virgules, "
        "dans l'environnement du service."
    )


def normaliser_origines(valeur: str) -> List[str]:
    """Découpe sur les virgules, retire espaces, entrées vides et « / » finaux, sans doublon."""
    vues: List[str] = []
    for brut in valeur.split(","):
        origine = brut.strip().rstrip("/")
        if origine and origine not in vues:
            vues.append(origine)
    return vues


def origines_autorisees(allowed_origins: str | None, app_env: str) -> List[str]:
    """Liste finale : la variable explicite si elle contient au moins une origine, sinon le repli local (développement)."""
    if allowed_origins is not None and allowed_origins.strip():
        origines = normaliser_origines(allowed_origins)
        if origines:
            return origines
    if app_env == "development":
        return list(ORIGINES_LOCALES)
    raise OriginesManquantes(message_origines_manquantes(app_env))


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
