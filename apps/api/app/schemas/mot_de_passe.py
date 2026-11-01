"""
Règle UNIQUE de robustesse d'un mot de passe choisi pour un compte — utilisée par la création et la modification d'un compte
(CX Manager, Administrateur) et par le changement de mot de passe de l'utilisateur.

Longueur : 8 caractères au minimum, comptés APRÈS suppression des espaces de début et de fin : la connexion retire ces espaces
(auth.py::login), un mot de passe de 8 espaces ou «   abc   » serait sinon impossible à utiliser. Le validateur RETOURNE le mot de
passe sans ces espaces, et c'est cette valeur qui est hachée. Les espaces au milieu sont conservés. Aucun maximum : le hachage est Argon2id (app/core/security.py), qui n'a pas la limite de
72 octets de bcrypt. Si le schéma de hachage changeait pour bcrypt, il faudrait ajouter ici un maximum de 72 octets.

Les messages ne reprennent JAMAIS le mot de passe saisi.
"""
from typing import Optional

from fastapi import HTTPException

MOT_DE_PASSE_LONGUEUR_MIN = 8

MESSAGE_TROP_COURT = (
    f"Le mot de passe doit contenir au moins {MOT_DE_PASSE_LONGUEUR_MIN} caractères "
    "(les espaces au début et à la fin ne comptent pas)."
)
MESSAGE_EGAL_EMAIL = "Le mot de passe ne doit pas être identique à l'adresse e-mail."
MESSAGE_MOT_DE_PASSE_IDENTIQUE = "Le nouveau mot de passe doit être différent du mot de passe actuel."


def verifier_mot_de_passe(mot_de_passe: str, email: Optional[str] = None) -> str:
    """Retourne le mot de passe SANS espaces de début ni de fin s'il est acceptable, sinon lève ValueError (message en français,
    sans le mot de passe). `email` : adresse du compte, quand elle est connue — le mot de passe ne doit pas lui être identique
    (casse et espaces ignorés)."""
    propre = mot_de_passe.strip()
    if len(propre) < MOT_DE_PASSE_LONGUEUR_MIN:
        raise ValueError(MESSAGE_TROP_COURT)
    if email and propre.lower() == email.strip().lower():
        raise ValueError(MESSAGE_EGAL_EMAIL)
    return propre


def exiger_mot_de_passe_acceptable(mot_de_passe: str, email: Optional[str] = None) -> None:
    """Même règle, pour un endpoint : 422 avec le message français (jamais le mot de passe)."""
    try:
        verifier_mot_de_passe(mot_de_passe, email)
    except ValueError as erreur:
        raise HTTPException(status_code=422, detail=str(erreur)) from None
