"""
Le journal d'accès d'uvicorn (« uvicorn.access », actif par défaut) écrit la requête complète, query string comprise : une
recherche dans les avis (`?q=…`) s'y retrouverait en clair. Ce filtre remplace la valeur de `q` par « *** » avant l'écriture.
"""
import logging
import re

_RECHERCHE = re.compile(r"([?&]q=)[^&\s\"]*")


class MasquerRechercheDansJournalAcces(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple):
            record.args = tuple(_RECHERCHE.sub(r"\1***", a) if isinstance(a, str) else a for a in record.args)
        elif isinstance(record.msg, str):
            record.msg = _RECHERCHE.sub(r"\1***", record.msg)
        return True


def installer_masquage_acces_http() -> None:
    journal = logging.getLogger("uvicorn.access")
    if not any(isinstance(f, MasquerRechercheDansJournalAcces) for f in journal.filters):
        journal.addFilter(MasquerRechercheDansJournalAcces())
