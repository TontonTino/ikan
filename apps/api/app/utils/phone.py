"""Normalise une saisie internationale explicite au format E.164.

Sans métadonnées pays fiables, la validation contrôle la syntaxe et la longueur
(8 à 15 chiffres, indicatif commençant par 1-9). Elle ne vérifie pas l'attribution
réelle de l'indicatif ni l'existence du numéro.
"""
import re
from typing import Optional

MESSAGE_TELEPHONE_INVALIDE = (
    "Numéro de téléphone invalide. Saisissez le numéro avec son indicatif international, "
    "par exemple +226 70 12 34 56."
)

_SEPARATEURS = re.compile(r"[\s.\-()]")


def normaliser_telephone(valeur: Optional[str]) -> Optional[str]:
    """Retourne les chiffres internationaux sans « + », ou None si vide/invalide."""
    if valeur is None:
        return None
    brut = _SEPARATEURS.sub("", str(valeur))
    if not brut:
        return None
    if brut.startswith("+"):
        brut = brut[1:]
    elif brut.startswith("00"):
        brut = brut[2:]
    else:
        return None
    if not brut.isascii() or not brut.isdigit() or not 8 <= len(brut) <= 15 or brut.startswith("0"):
        return None
    return brut
