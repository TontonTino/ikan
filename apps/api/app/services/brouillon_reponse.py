"""
Brouillon de réponse au client (AM-09) — règles, sans IA générative.

Le brouillon est un POINT DE DÉPART que le gestionnaire relit et modifie avant d'enregistrer sa réponse. Il n'envoie rien.
Tous les textes sont dans brouillon_reponse_textes.py ; ce module décide quand proposer un brouillon, avec quel registre et quelle
famille de thème, et assemble le message. Il est PUR (aucun accès base) : l'endpoint lui passe des valeurs simples.

Ce que le brouillon n'utilise JAMAIS : le commentaire du client (aucun extrait n'est repris), son nom (texte libre), son
téléphone, son e-mail, la note. Seuls entrent dans le texte : le nom de l'agence (ou de l'organisation) et le vocabulaire du
secteur. La salutation est toujours « Bonjour, ».
"""
import re
from dataclasses import dataclass
from typing import Optional

from app.models.enums import CriticiteType, SentimentType
from app.services.ai.cles_modeles import MODELE_PAR_DEFAUT, resoudre_cle_modele
from app.services.brouillon_reponse_textes import (
    LIEU_PAR_DEFAUT,
    LIEU_PAR_SECTEUR,
    SALUTATION,
    INITIALES_ELISION,
    SIGNATURE_AVEC_ENTITE,
    SIGNATURE_AVEC_ENTITE_ELISION,
    SIGNATURE_SANS_ENTITE,
    TEXTES,
)
from app.services.dashboard_helpers import NOTE_FAIBLE_MAX

REGISTRE_CRITIQUE = "critique"
REGISTRE_DISCORDANCE = "discordance"
REGISTRE_NEGATIF = "negatif"
REGISTRE_RAPPEL_SIMPLE = "rappel_simple"

RAISON_AUCUN_SUIVI = "aucun_suivi"
RAISON_REPONSE_EXISTANTE = "reponse_existante"

_VARIABLE = re.compile(r"\{(\w+)\}")
# Caractères de contrôle et accolades retirés : jamais de « {…} » dans un brouillon, même si le nom de l'agence en contient.
_CARACTERES_DE_CONTROLE = re.compile(r"[\x00-\x1f\x7f{}]")


@dataclass(frozen=True)
class Brouillon:
    registre: str
    famille: str
    texte: str


def choisir_registre(
    *,
    note: int,
    sentiment: Optional[SentimentType],
    criticite: Optional[CriticiteType],
    discordance: bool,
    souhaite_etre_rappele: bool,
) -> Optional[str]:
    """Registre du brouillon, ou None si l'avis ne demande pas de suivi (aucun brouillon, formulaire vide).

    Ordre : critique > discordance > négatif > rappel simple. « Négatif » = note faible, sentiment négatif ou criticité élevée
    (la note faible suit la définition du tableau de bord, NOTE_FAIBLE_MAX)."""
    if criticite == CriticiteType.CRITIQUE:
        return REGISTRE_CRITIQUE
    if discordance:
        return REGISTRE_DISCORDANCE
    if note <= NOTE_FAIBLE_MAX or sentiment == SentimentType.NEGATIF or criticite == CriticiteType.ELEVEE:
        return REGISTRE_NEGATIF
    if souhaite_etre_rappele:
        return REGISTRE_RAPPEL_SIMPLE
    return None


def _nettoyer(valeur: Optional[str], longueur_max: int) -> str:
    """Texte saisi par un tiers : sans caractères de contrôle ni accolades, espaces normalisés, longueur bornée."""
    if not valeur:
        return ""
    return " ".join(_CARACTERES_DE_CONTROLE.sub(" ", valeur).split())[:longueur_max].strip()


def _remplir(modele: str, valeurs: dict[str, str]) -> str:
    """Remplace {variable} en UNE passe : une valeur qui contiendrait des accolades n'est jamais réinterprétée."""
    return _VARIABLE.sub(lambda m: valeurs[m.group(1)], modele)


def construire_brouillon(
    *,
    registre: str,
    cle_categorie: Optional[str],
    nom_categorie: Optional[str],
    secteur_code: Optional[str],
    entite: Optional[str],
) -> Brouillon:
    """Assemble salutation + corps + signature. `entite` = nom de l'agence (à défaut de l'organisation)."""
    textes_registre = TEXTES[registre]
    famille = resoudre_cle_modele(cle_categorie, nom_categorie, textes_registre.keys(), defaut=MODELE_PAR_DEFAUT)
    entite_propre = _nettoyer(entite, 100)
    lieu = LIEU_PAR_SECTEUR.get(secteur_code or "", LIEU_PAR_DEFAUT)

    if not entite_propre:
        signature = SIGNATURE_SANS_ENTITE
    else:
        modele_signature = SIGNATURE_AVEC_ENTITE_ELISION if entite_propre[0].lower() in INITIALES_ELISION else SIGNATURE_AVEC_ENTITE
        signature = _remplir(modele_signature, {"entite": entite_propre})
    corps = _remplir(textes_registre[famille], {"lieu": lieu})
    return Brouillon(registre=registre, famille=famille, texte=f"{SALUTATION}\n\n{corps}\n\n{signature}")
