"""Masquage des coordonnées (e-mails, numéros de téléphone) avant toute écriture dans un journal."""
import re

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
# Suite d'au moins 8 chiffres, séparés ou non par espaces, points, tirets, parenthèses, avec « + » ou « 00 » éventuel.
_TELEPHONE = re.compile(r"(?<![\w])(?:\+|00)?\d(?:[\s.\-()]?\d){7,}")


def masquer_contacts(texte: str | None) -> str:
    if not texte:
        return ""
    return _TELEPHONE.sub("[téléphone masqué]", _EMAIL.sub("[e-mail masqué]", str(texte)))
