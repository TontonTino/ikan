"""
Pack KPI du secteur restauration — clés de catégorie couvertes par le pack.

CLES_RESTAURATION est dérivé du jeu de départ (app/services/categorie_templates.py::
SECTEUR_CATEGORIES_DEPART["restauration"]) : une seule source de vérité pour les clés,
jamais une liste parallèle. Une Issue dont la catégorie n'a aucune de ces clés (ou pas de
catégorie) est hors du périmètre de RESTO_RECIDIVE_CATEGORIE (engine.py).
"""
from app.services.categorie_templates import SECTEUR_CATEGORIES_DEPART

CLES_RESTAURATION: frozenset[str] = frozenset(c.cle for c in SECTEUR_CATEGORIES_DEPART["restauration"])
