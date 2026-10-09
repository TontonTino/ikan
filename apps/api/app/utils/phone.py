"""
Normalisation des numéros de téléphone au format international sans « + » ni espaces
(ex. « 70 12 34 56 », « +226 70123456 », « 0022670123456 » -> « 22670123456 »), tel
qu'attendu par https://wa.me/<numero>.

Seul le Burkina Faso (indicatif 226, 8 chiffres) est accepté pour l'instant. Pour ajouter
un pays : ajouter une entrée à PAYS_ACCEPTES (la logique ci-dessous n'est pas à toucher).
La même règle existe côté front : apps/dashboard/src/utils/whatsapp.ts et
apps/client/src/pages/feedback/[code].astro — les garder alignées.
"""
import re
from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class RegleTelephone:
    indicatif: str       # ex. "226"
    longueur_locale: int  # nombre de chiffres du numéro national, sans indicatif


PAYS_ACCEPTES: tuple[RegleTelephone, ...] = (
    RegleTelephone(indicatif="226", longueur_locale=8),  # Burkina Faso
)
# Pays utilisé quand le numéro est saisi sans indicatif (« 70 12 34 56 »).
PAYS_PAR_DEFAUT = PAYS_ACCEPTES[0]

MESSAGE_TELEPHONE_INVALIDE = (
    "Numéro de téléphone invalide. Saisissez 8 chiffres (ex. 70 12 34 56) "
    "ou le format international +226 70 12 34 56."
)

_SEPARATEURS = re.compile(r"[\s.\-()]")


def normaliser_telephone(valeur: Optional[str]) -> Optional[str]:
    """Retourne le numéro international sans « + » (ex. « 22670123456 »), ou None si la
    valeur est vide ou invalide. Ne lève jamais d'exception."""
    if valeur is None:
        return None
    brut = _SEPARATEURS.sub("", str(valeur))
    if not brut:
        return None

    if brut.startswith("+"):
        brut = brut[1:]
    elif brut.startswith("00"):
        brut = brut[2:]

    if not brut.isascii() or not brut.isdigit():
        return None

    # Numéro national (sans indicatif) : on suppose le pays par défaut.
    if len(brut) == PAYS_PAR_DEFAUT.longueur_locale:
        return PAYS_PAR_DEFAUT.indicatif + brut
    # Numéro international (avec ou sans « + » / « 00 » devant).
    for regle in PAYS_ACCEPTES:
        if brut.startswith(regle.indicatif) and len(brut) == len(regle.indicatif) + regle.longueur_locale:
            return brut
    return None
