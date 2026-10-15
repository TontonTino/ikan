"""
Réponse 422 (corps de requête invalide) sans écho des valeurs saisies — un mot de passe mal formé ne doit jamais revenir dans la
réponse d'erreur. Installé par `installer_erreurs_validation(app)` (app/main.py).

Par rapport à la réponse par défaut de FastAPI :
- le champ `input` (valeur saisie, ou corps entier) est retiré de chaque erreur ;
- le préfixe anglais « Value error, » des validateurs maison est retiré (leurs messages sont déjà en français) ;
- « Field required » devient « Ce champ est obligatoire. ».
"""
from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

_PREFIXE_VALIDATEUR = "Value error, "


def _erreur_sans_echo(erreur: dict) -> dict:
    propre = {cle: valeur for cle, valeur in erreur.items() if cle not in ("input", "ctx", "url")}
    message = str(propre.get("msg", ""))
    if propre.get("type") == "missing":
        message = "Ce champ est obligatoire."
    elif message.startswith(_PREFIXE_VALIDATEUR):
        message = message[len(_PREFIXE_VALIDATEUR):]
    propre["msg"] = message
    return propre


async def _reponse_422(request: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": jsonable_encoder([_erreur_sans_echo(e) for e in exc.errors()])})


def installer_erreurs_validation(app: FastAPI) -> None:
    app.add_exception_handler(RequestValidationError, _reponse_422)
