"""
Analyse de sentiment déterministe en français.
Approche lexicale avec dictionnaire de mots-clés pondérés, gestion des expressions et normalisation accentuée.
Moteur local rapide, précis et sans dépendance externe (BF-06).
"""
import unicodedata
from app.models.enums import SentimentType


def _strip_accents(text: str) -> str:
    """Supprime les accents pour une comparaison lexicale uniforme."""
    text = unicodedata.normalize("NFD", text)
    return "".join(c for c in text if unicodedata.category(c) != "Mn")


# Expressions composées explicites
EXPRESSIONS_POSITIVES: dict[str, int] = {
    "pas de probleme": 2,
    "aucun probleme": 2,
    "pas de souci": 2,
    "aucun souci": 2,
    "tres bien": 2,
    "tres bon": 2,
    "tres bonne": 2,
    "tres content": 2,
    "tres contente": 2,
    "tres propre": 2,
    "tres aimable": 2,
    "tres efficace": 2,
    "rien a redire": 2,
    "au top": 2,
    "bonne continuation": 1,
    "bon courage": 1,
}

EXPRESSIONS_NEGATIVES: dict[str, int] = {
    "ne marche pas": 2,
    "ne fonctionne pas": 2,
    "ne resout pas": 2,
    "ne repond pas": 2,
    "pas de reseau": 2,
    "pas de connexion": 2,
    "pas de signal": 2,
    "pas d acces": 2,
    "pas de reponse": 2,
    "pas de stock": 2,
    "plus de stock": 2,
    "trop d attente": 2,
    "trop cher": 2,
    "trop chere": 2,
    "trop lents": 2,
    "trop lent": 2,
    "hors de prix": 2,
    "perte de temps": 2,
    "foutage de gueule": 2,
    "jamais vu ca": 2,
}

# Dictionnaire étendu de mots positifs (formes sans accents)
MOTS_POSITIFS: dict[str, int] = {
    # Très positifs (poids 2)
    "excellent": 2, "excellente": 2, "excellents": 2, "excellentes": 2,
    "parfait": 2, "parfaite": 2, "parfaits": 2, "parfaites": 2,
    "exceptionnel": 2, "exceptionnelle": 2, "exceptionnels": 2, "exceptionnelles": 2,
    "remarquable": 2, "remarquables": 2,
    "fantastique": 2, "fantastiques": 2,
    "magnifique": 2, "magnifiques": 2,
    "super": 2, "genial": 2, "geniale": 2, "geniaux": 2, "geniales": 2,
    "top": 2, "nickel": 2, "impeccable": 2, "impeccables": 2,
    "impressionnant": 2, "impressionnante": 2,
    "formidable": 2, "formidables": 2,
    "adore": 2, "adoree": 2, "adores": 2, "adorees": 2, "adorons": 2,

    # Positifs (poids 1)
    "content": 1, "contente": 1, "contents": 1, "contentes": 1,
    "heureux": 1, "heureuse": 1, "heureuses": 1,
    "bien": 1, "bon": 1, "bonne": 1, "bons": 1, "bonnes": 1,
    "satisfait": 1, "satisfaite": 1, "satisfaits": 1, "satisfaites": 1,
    "satisfaisant": 1, "satisfaisante": 1, "satisfaisants": 1, "satisfaisantes": 1,
    "rapide": 1, "rapides": 1, "rapidite": 1,
    "efficace": 1, "efficaces": 1, "efficacite": 1,
    "professionnel": 1, "professionnelle": 1, "professionnels": 1, "professionnelles": 1,
    "agreable": 1, "agreables": 1,
    "sympathique": 1, "sympathiques": 1, "sympa": 1,
    "souriant": 1, "souriante": 1, "souriants": 1, "souriantes": 1,
    "aimable": 1, "aimables": 1, "amabilite": 1,
    "accueillant": 1, "accueillante": 1, "accueillants": 1, "accueillantes": 1,
    "propre": 1, "propres": 1, "proprete": 1,
    "confortable": 1, "confortables": 1, "confort": 1,
    "facile": 1, "faciles": 1, "facilite": 1,
    "pratique": 1, "pratiques": 1,
    "abordable": 1, "abordables": 1,
    "utile": 1, "utiles": 1,
    "clair": 1, "claire": 1, "clairs": 1, "claires": 1, "clarte": 1,
    "competent": 1, "competente": 1, "competents": 1, "competentes": 1,
    "attentionne": 1, "attentionnee": 1, "attentionnes": 1, "attentionnees": 1,
    "serviable": 1, "serviables": 1,
    "disponible": 1, "disponibles": 1, "disponibilite": 1,
    "poli": 1, "polie": 1, "polis": 1, "polies": 1, "politesse": 1,
    "courtois": 1, "courtoise": 1, "courtoises": 1, "courtoisie": 1,
    "merci": 1, "bravo": 1, "felicitations": 1, "continuez": 1, "recommande": 1,
    "conforme": 1, "fiable": 1, "fiables": 1, "securise": 1, "securisee": 1,
    "moderne": 1, "modernes": 1, "qualite": 1, "qualitatif": 1, "qualitative": 1,
}

# Dictionnaire étendu de mots négatifs (formes sans accents)
MOTS_NEGATIFS: dict[str, int] = {
    # Très négatifs (poids 2)
    "terrible": 2, "terribles": 2,
    "horrible": 2, "horribles": 2,
    "catastrophique": 2, "catastrophiques": 2, "catastrophe": 2,
    "inacceptable": 2, "inacceptables": 2,
    "scandaleux": 2, "scandaleuse": 2, "scandaleuses": 2,
    "honteux": 2, "honteuse": 2, "honte": 2,
    "desastreux": 2, "desastreuse": 2, "desastre": 2,
    "nul": 2, "nulle": 2, "nuls": 2, "nulles": 2,
    "arnaque": 2, "arnaques": 2, "vol": 2, "escroquerie": 2, "voleur": 2,
    "incompetent": 2, "incompetente": 2, "incompetents": 2, "incompetentes": 2, "incompetence": 2,
    "inutile": 2, "inutiles": 2,
    "inadmissible": 2, "inadmissibles": 2,
    "foutage": 2, "merde": 2,

    # Négatifs (poids 1)
    "mauvais": 1, "mauvaise": 1, "mauvaises": 1,
    "lent": 1, "lente": 1, "lents": 1, "lentes": 1, "lenteur": 1, "lenteurs": 1,
    "long": 1, "longue": 1, "longs": 1, "longues": 1,
    "attente": 1, "attendre": 1, "queue": 1,
    "decu": 1, "decue": 1, "decus": 1, "decues": 1, "deception": 1,
    "mecontent": 1, "mecontente": 1, "mecontents": 1, "mecontentes": 1, "mecontentement": 1,
    "probleme": 1, "problemes": 1, "erreur": 1, "erreurs": 1,
    "difficile": 1, "difficiles": 1, "difficulte": 1, "difficultes": 1,
    "complique": 1, "compliquee": 1, "compliques": 1, "compliquees": 1,
    "confus": 1, "confuse": 1,
    "impoli": 1, "impolie": 1, "impolis": 1, "impolies": 1, "impolitesse": 1,
    "desagreable": 1, "desagreables": 1,
    "sale": 1, "sales": 1, "salete": 1, "saletes": 1, "poussiere": 1,
    "bruyant": 1, "bruyante": 1, "bruit": 1,
    "inconfortable": 1, "inconfortables": 1, "inconfort": 1,
    "froid": 1, "froide": 1,
    "manque": 1, "manquent": 1, "manquant": 1,
    "absent": 1, "absente": 1, "absents": 1, "absentes": 1, "absence": 1,
    "fermer": 1, "ferme": 1, "fermee": 1, "fermes": 1, "fermees": 1,
    "retard": 1, "retards": 1, "delai": 1, "delais": 1,
    "refus": 1, "refuse": 1, "refusee": 1, "refuses": 1, "refusees": 1,
    "rejete": 1, "rejetee": 1, "bloque": 1, "bloquee": 1, "bloques": 1, "bloquees": 1, "blocage": 1,
    "panne": 1, "pannes": 1, "coupure": 1, "coupures": 1,
    "bogue": 1, "bug": 1, "bugs": 1, "crash": 1, "plante": 1, "dysfonctionnement": 1, "dysfonctionnements": 1,
    "insatisfait": 1, "insatisfaite": 1, "insatisfaits": 1, "insatisfaites": 1, "insatisfaction": 1,
    "desolant": 1, "frustrant": 1, "agacant": 1, "enerve": 1, "enervant": 1,
    "cher": 1, "chere": 1, "chers": 1, "cheres": 1,
    "indisponible": 1, "epuise": 1, "epuisee": 1, "rupture": 1,
}

# Mots de négation qui inversent la polarité des termes positifs
NEGATIONS = {"ne", "pas", "jamais", "aucun", "aucune", "ni", "non", "sans", "guere", "point", "n"}


def analyser_sentiment(texte: str) -> tuple[SentimentType, float]:
    """
    Analyse le sentiment d'un texte en français avec gestion des expressions composées, négations et accents.

    Returns:
        (SentimentType, score) où score va de 0.0 (très négatif) à 1.0 (très positif)
    """
    if not texte or len(texte.strip()) < 2:
        return SentimentType.NEUTRE, 0.5

    texte_clean = _strip_accents(texte.lower())

    score_positif = 0.0
    score_negatif = 0.0

    # 1. Vérification des expressions composées exactes
    for expr, poids in EXPRESSIONS_POSITIVES.items():
        if expr in texte_clean:
            score_positif += poids * 1.5

    for expr, poids in EXPRESSIONS_NEGATIVES.items():
        if expr in texte_clean:
            score_negatif += poids * 1.5

    # 2. Analyse mot par mot
    mots = texte_clean.split()
    mots_nettoyes = [m.strip(".,;:!?()\"'«»-") for m in mots if m.strip(".,;:!?()\"'«»-")]

    i = 0
    while i < len(mots_nettoyes):
        mot = mots_nettoyes[i]

        # Vérifier si une négation précède le mot (ex: "pas bon", "ne ... jamais poli")
        est_nie = (i > 0 and mots_nettoyes[i - 1] in NEGATIONS) or (i > 1 and mots_nettoyes[i - 2] in NEGATIONS)

        if mot in MOTS_POSITIFS:
            poids = MOTS_POSITIFS[mot]
            if est_nie:
                score_negatif += poids * 1.2  # "pas bon" -> négatif
            else:
                score_positif += poids

        elif mot in MOTS_NEGATIFS:
            poids = MOTS_NEGATIFS[mot]
            score_negatif += poids

        i += 1

    total = score_positif + score_negatif

    if total == 0:
        # Analyse de secours par ponctuation
        nb_exclamations = texte.count("!")
        if nb_exclamations >= 2:
            return SentimentType.POSITIF, 0.65
        return SentimentType.NEUTRE, 0.5

    # Calculer le score normalisé (0 = très négatif, 1 = très positif)
    score_normalise = score_positif / total

    if score_normalise >= 0.55:
        return SentimentType.POSITIF, round(score_normalise, 3)
    elif score_normalise <= 0.45:
        return SentimentType.NEGATIF, round(score_normalise, 3)
    else:
        return SentimentType.NEUTRE, round(score_normalise, 3)
