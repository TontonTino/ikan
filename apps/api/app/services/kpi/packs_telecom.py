"""
Pack KPI du secteur telecom — groupes de périmètre des catégories.

PERIMETRE_CATEGORIES est une HYPOTHÈSE MÉTIER, pas un fait vérifié : elle décide quelles
clés de catégorie (app/services/categorie_templates.py::SECTEUR_CATEGORIES_DEPART["telecom"])
désignent un problème qu'une agence peut résoudre seule ("agence"), un problème qui dépend
d'un autre service de l'entreprise ("hors_agence"), ou un mélange des deux ("mixte", exclu
des KPIs de récurrence par périmètre — voir calculer_tel_recurrence_* dans engine.py).

À VALIDER AVEC L'ÉQUIPE avant de s'appuyer dessus pour une décision opérationnelle (ex. un
classement d'agences — ce que ces KPIs ne doivent justement jamais servir à faire, voir
leurs descriptions dans definitions.py).
"""

PERIMETRE_AGENCE = "agence"
PERIMETRE_MIXTE = "mixte"
PERIMETRE_HORS_AGENCE = "hors_agence"

PERIMETRE_CATEGORIES: dict[str, frozenset[str]] = {
    PERIMETRE_AGENCE: frozenset({"accueil", "service_client", "carte_sim_numero", "equipements_boutique"}),
    PERIMETRE_MIXTE: frozenset({"forfaits_recharge"}),
    PERIMETRE_HORS_AGENCE: frozenset({"internet_reseau_mobile", "facturation_paiement", "mobile_money"}),
}

# Toutes les clés couvertes par le pack (les 3 groupes réunis) — une Issue dont la
# catégorie a une clé hors de cet ensemble (ou pas de catégorie du tout) est "non classée".
TOUTES_LES_CLES_DU_PACK: frozenset[str] = frozenset().union(*PERIMETRE_CATEGORIES.values())
