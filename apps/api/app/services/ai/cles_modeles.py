"""
Résolution de la clé de MODÈLE (texte de recommandation, et demain brouillon de réponse) à partir de la catégorie d'un avis.

Pourquoi : les modèles sont indexés par des clés stables en minuscules (« accueil », « reseau »…), alors que la catégorie d'un avis
porte un NOM libre (« Accueil », « Service Client »). Chercher le modèle avec le nom retombait presque toujours sur le modèle
générique « autre ». Cette fonction est la SEULE qui décide quel modèle s'applique à une catégorie ; elle ne dépend d'aucune liste
de modèles précise (l'appelant passe celles dont il dispose) pour servir plusieurs jeux de textes.

Ordre de résolution :
1. clé stable de la catégorie (`Categorie.cle`, migration 025), si un modèle existe pour elle ;
2. à défaut, nom normalisé (casse et accents ignorés, espaces, tirets et ponctuation traités comme « _ ») ;
3. à défaut, correspondance heuristique par famille (mots-clés) pour les catégories libres, sans clé ;
4. à défaut, le modèle générique (« autre »).
Une clé ou un nom qui correspond directement à un modèle l'emporte ; sinon la table CLE_VERS_FAMILLE rattache les clés de départ
des secteurs (télécom, restauration) à la famille de modèle la plus proche.
"""
import re
import unicodedata
from typing import Any, Collection, Optional

MODELE_PAR_DEFAUT = "autre"

# Clés de départ des secteurs (app/services/categorie_templates.py) -> famille de modèle. Aucune ne retombe sur « autre » sauf
# « suggestion_compliment » (un compliment ou une idée n'a pas de modèle de recommandation correctif) et « mobile_money »
# (le texte « facturation » parle d'un duplicata de facture : hors sujet pour une transaction mobile money).
CLE_VERS_FAMILLE: dict[str, str] = {
    # télécom
    "accueil": "accueil",
    "service_client": "resolution_probleme",
    "carte_sim_numero": "qualite_produit",
    "forfaits_recharge": "qualite_produit",
    "internet_reseau_mobile": "reseau",
    "facturation_paiement": "facturation",
    "equipements_boutique": "qualite_produit",
    "mobile_money": MODELE_PAR_DEFAUT,  # le texte « facturation » (duplicata de facture) serait hors sujet
    # restauration
    "accueil_service_salle": "accueil",
    "qualite_plats": "qualite_produit",
    "rapidite_attente": "attente",
    "proprete_cadre": "proprete_cadre",
    "addition_paiement": "facturation",
    "livraison_emporter": "livraison_logistique",
    "suggestion_compliment": MODELE_PAR_DEFAUT,
}

# Heuristique pour les catégories libres, sans clé : (famille, mots-clés). Mots normalisés ; « * » en fin = début de mot. La
# première famille dont un mot apparaît l'emporte : l'ordre va du plus spécifique au plus général.
FAMILLES_MOTS_CLES: list[tuple[str, tuple[str, ...]]] = [
    ("attente", ("attent*", "attend*", "file", "queue", "delai*", "rapidite", "lenteur", "patienter")),
    ("facturation", ("factur*", "paiement*", "addition*", "prelevement*", "frais")),
    ("tarifs", ("tarif*", "prix", "cout*", "cher", "grille")),
    ("reseau", ("reseau*", "internet", "connexion*", "signal", "4g", "5g")),
    ("application_mobile", ("appli", "application*")),
    ("digital", ("digital*", "automate*", "borne*", "ligne")),
    ("livraison_logistique", ("livraison*", "emporter", "colis", "expedition*", "transport*")),
    ("proprete_cadre", ("proprete", "hygiene", "cadre", "ambiance", "toilettes", "climatisation", "decor")),
    ("disponibilite_produit", ("stock*", "rupture*", "disponibilite")),
    ("disponibilite_accessibilite", ("accessibilite", "horaire*", "ouverture", "parking", "handicap*", "pmr")),
    ("securite_confidentialite", ("securite", "confidentialite", "fraude*")),
    ("resolution_probleme", ("reclamation*", "litige*", "sav", "support", "assistance")),
    ("communication_information", ("information*", "communication", "affichage", "renseignement*")),
    ("personnalisation_besoin", ("personnalisation", "besoin*")),
    ("qualite_produit", ("qualite", "produit*", "plat*", "repas", "nourriture", "cuisine", "forfait*", "recharge*", "equipement*")),
    ("accueil", ("accueil*", "personnel", "equipe*", "courtoisie", "sourire")),
    ("infrastructure", ("infrastructure*", "locaux", "batiment*")),
]


def normaliser_cle(texte: Optional[str]) -> str:
    """Forme comparable : sans accents, en minuscules, toute suite d'espaces, tirets ou signes devient un seul « _ »."""
    if not texte:
        return ""
    sans_accents = "".join(c for c in unicodedata.normalize("NFD", str(texte)) if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", "_", sans_accents.lower()).strip("_")


def _modele_direct(cle_normalisee: str, disponibles: Collection[str]) -> Optional[str]:
    if not cle_normalisee:
        return None
    if cle_normalisee in disponibles:
        return cle_normalisee
    famille = CLE_VERS_FAMILLE.get(cle_normalisee)
    return famille if famille in disponibles else None


def _famille_par_mots_cles(nom_normalise: str, disponibles: Collection[str]) -> Optional[str]:
    mots = [m for m in nom_normalise.split("_") if m]
    for famille, motifs in FAMILLES_MOTS_CLES:
        if famille not in disponibles:
            continue
        for motif in motifs:
            debut = motif.endswith("*")
            racine = motif.rstrip("*")
            if any((m.startswith(racine) if debut else m == racine) for m in mots):
                return famille
    return None


def resoudre_cle_modele(cle: Optional[str], nom: Optional[str], disponibles: Collection[str], *, defaut: str = MODELE_PAR_DEFAUT) -> str:
    """Clé du modèle à utiliser pour une catégorie de clé stable `cle` (peut être absente) et de nom `nom` (peut être absent)."""
    modele = _modele_direct(normaliser_cle(cle), disponibles)
    if modele:
        return modele
    nom_normalise = normaliser_cle(nom)
    modele = _modele_direct(nom_normalise, disponibles)
    if modele:
        return modele
    return _famille_par_mots_cles(nom_normalise, disponibles) or defaut


def cle_modele_de_categorie(categorie: Any, disponibles: Collection[str], *, defaut: str = MODELE_PAR_DEFAUT) -> str:
    """Même résolution à partir d'un objet catégorie (attributs `cle` et `nom`) ou de `None` (avis sans catégorie)."""
    if categorie is None:
        return defaut
    return resoudre_cle_modele(getattr(categorie, "cle", None), getattr(categorie, "nom", None), disponibles, defaut=defaut)
