"""
Titres des problèmes de démonstration (scripts/seed_issues_demo.py) : de vraies phrases, sans suffixe technique visible,
et jamais deux problèmes du même nom dans la même agence (titres déjà en base compris). Aucune base n'est ouverte.
"""
import importlib.util
import random
import re
import sys
import uuid
from pathlib import Path

RACINE_API = Path(__file__).resolve().parent.parent
_ENVELOPPES = []


def _charger():
    spec = importlib.util.spec_from_file_location("seed_issues_demo_titres", RACINE_API / "scripts/seed_issues_demo.py")
    module = importlib.util.module_from_spec(spec)
    sortie, erreurs = sys.stdout, sys.stderr  # le script remplace sys.stdout à l'import (UTF-8) : on le rend à pytest
    try:
        spec.loader.exec_module(module)
    finally:
        _ENVELOPPES.append(sys.stdout)
        sys.stdout, sys.stderr = sortie, erreurs
    return module


class _Requete:
    def __init__(self, titres):
        self._titres = titres

    def filter(self, *_):
        return self

    def all(self):
        return [(t,) for t in self._titres]


class _Base:
    """Fausse session : renvoie les titres déjà présents en base pour l'agence demandée."""

    def __init__(self, titres_existants=()):
        self.titres = list(titres_existants)

    def query(self, *_):
        return _Requete(self.titres)


def test_aucun_titre_ne_porte_de_suffixe_ou_de_crochet_et_tous_sont_des_phrases():
    module = _charger()
    source = (RACINE_API / "scripts/seed_issues_demo.py").read_text(encoding="utf8")
    assert "titre + MARQUEUR" not in source and not re.search(r"^MARQUEUR_TITRE\s*=", source, re.M)
    for titres in module.TITRES_PAR_CLE.values():
        for titre in titres:
            assert "[" not in titre and "Démo" not in titre, titre
            assert len(titre.split()) >= 4, f"titre trop court pour une phrase : {titre!r}"
            assert titre[0].isupper(), titre


def test_jamais_deux_problemes_du_meme_nom_dans_la_meme_agence():
    module = _charger()
    db, agence, rng = _Base(), uuid.uuid4(), random.Random(1)
    n = len(module.TITRES_PAR_CLE["accueil"])
    titres = [module.titre_pour(db, "accueil", agence, rng) for _ in range(n)]
    assert len(set(titres)) == n
    # Catalogue épuisé pour cette agence : on renonce plutôt que de créer un doublon.
    assert module.titre_pour(db, "accueil", agence, rng) is None
    # Une autre agence peut reprendre ces titres.
    assert module.titre_pour(db, "accueil", uuid.uuid4(), rng) in module.TITRES_PAR_CLE["accueil"]


def test_les_titres_deja_en_base_pour_l_agence_sont_evites():
    module = _charger()
    deja = module.TITRES_PAR_CLE["accueil"][:-1]
    titre = module.titre_pour(_Base(deja), "accueil", uuid.uuid4(), random.Random(2))
    assert titre == module.TITRES_PAR_CLE["accueil"][-1]


def test_supprimer_reconnait_le_catalogue_et_l_ancien_suffixe():
    module = _charger()
    source = (RACINE_API / "scripts/seed_issues_demo.py").read_text(encoding="utf8")
    assert re.search(r"Issue\.titre\.in_\(TITRES_DEMO\)", source)
    assert module.ANCIEN_MARQUEUR_TITRE == " [Démo pack telecom]"
    assert "filtre_issues_demo(org.id)" in source and "filtre_issues_demo(organisation_id)" in source
