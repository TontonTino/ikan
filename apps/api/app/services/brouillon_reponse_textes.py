"""
TOUS les textes des brouillons de réponse au client (AM-09), dans ce seul fichier, faciles à relire et à corriger.

Ce fichier ne contient que des DONNÉES : la logique (choix du registre, de la famille, assemblage) est dans brouillon_reponse.py.

Règles d'écriture (vérifiées par tests/test_brouillon_reponse.py) :
- aucune promesse datée ou chiffrée : pas de délai, pas de chiffre, pas de « aujourd'hui / demain / sous … heures » ;
  « nous reviendrons vers vous » est accepté ;
- aucune coordonnée (numéro, e-mail, lien) et aucun extrait du commentaire du client ;
- une seule variable dans les corps de texte : {lieu} (vocabulaire du secteur, voir LIEU_PAR_SECTEUR) ;
  {nom} dans la salutation et {entite} dans la signature. Aucune autre accolade.
- le gestionnaire relit et modifie toujours le brouillon avant l'enregistrement : ces textes sont un point de départ sobre.
"""

# ── Registres ────────────────────────────────────────────────────────────────────────────────────────────────────────
# critique     : avis de criticité critique.
# discordance  : bonne note mais commentaire négatif (le client ne dit pas son insatisfaction par la note).
# negatif      : note faible, commentaire négatif ou criticité élevée.
# rappel_simple: le client demande à être rappelé, sans signal négatif.

# ── Salutation et signature ─────────────────────────────────────────────────────────────────────────────────────────
SALUTATION_AVEC_NOM = "Bonjour {nom},"
SALUTATION_SANS_NOM = "Bonjour,"
SIGNATURE_AVEC_ENTITE = "Cordialement,\nL'équipe de {entite}"
# Même signature quand le nom de l'agence commence par une voyelle ou un « h » (élision : « d'Agence Centre »).
SIGNATURE_AVEC_ENTITE_ELISION = "Cordialement,\nL'équipe d'{entite}"
INITIALES_ELISION = "aeiouyhàâäéèêëîïôöùûüœ"
SIGNATURE_SANS_ENTITE ="Cordialement,\nL'équipe"

# ── Vocabulaire par secteur (valeur de {lieu}) ───────────────────────────────────────────────────────────────────────
LIEU_PAR_SECTEUR: dict[str, str] = {
    "banque": "notre agence",
    "telecom": "notre boutique",
    "restauration": "notre restaurant",
    "hotellerie": "notre établissement",
    "commerce": "notre magasin",
    "sante": "notre établissement",
}
LIEU_PAR_DEFAUT = "notre établissement"

# ── Textes : registre -> famille -> corps du message ────────────────────────────────────────────────────────────────
# La famille « autre » existe pour chaque registre : c'est le texte de repli.
TEXTES: dict[str, dict[str, str]] = {
    "critique": {
        "attente": (
            "Nous vous présentons nos excuses sincères pour l'attente que vous avez subie à {lieu}. "
            "Ce n'est pas le niveau de service que nous voulons offrir, et nous prenons votre situation très au sérieux. "
            "Nous cherchons à comprendre ce qui s'est passé et nous reviendrons vers vous. "
            "Si vous souhaitez nous donner plus de précisions, répondez simplement à ce message."
        ),
        "accueil": (
            "Nous vous présentons nos excuses sincères pour l'accueil que vous avez reçu à {lieu}. "
            "Ce n'est pas la façon dont nous voulons recevoir nos clients, et nous prenons votre retour très au sérieux. "
            "Nous cherchons à comprendre ce qui s'est passé et nous reviendrons vers vous. "
            "Si vous souhaitez nous donner plus de précisions, répondez simplement à ce message."
        ),
        "qualite_produit": (
            "Nous vous présentons nos excuses sincères pour la qualité de ce que vous avez reçu à {lieu}. "
            "Ce n'est pas le niveau que nous voulons offrir, et nous prenons votre retour très au sérieux. "
            "Nous cherchons à comprendre ce qui s'est passé et nous reviendrons vers vous pour trouver une solution. "
            "Si vous souhaitez nous donner plus de précisions, répondez simplement à ce message."
        ),
        "facturation": (
            "Nous vous présentons nos excuses sincères pour le problème de facturation ou de paiement que vous avez rencontré à {lieu}. "
            "Nous prenons votre situation très au sérieux et nous allons vérifier ce dossier avec attention. "
            "Nous reviendrons vers vous. "
            "Si vous souhaitez nous donner plus de précisions, répondez simplement à ce message."
        ),
        "tarifs": (
            "Nous vous remercions de nous avoir fait part de votre mécontentement au sujet de nos tarifs à {lieu}. "
            "Nous prenons votre retour très au sérieux et nous souhaitons comprendre ce qui vous a posé problème. "
            "Nous reviendrons vers vous. "
            "Si vous souhaitez nous donner plus de précisions, répondez simplement à ce message."
        ),
        "reseau": (
            "Nous vous présentons nos excuses sincères pour les difficultés de connexion que vous avez rencontrées. "
            "Nous prenons votre situation très au sérieux et nous cherchons à comprendre ce qui s'est passé. "
            "Nous reviendrons vers vous. "
            "Si vous souhaitez nous donner plus de précisions, répondez simplement à ce message."
        ),
        "proprete_cadre": (
            "Nous vous présentons nos excuses sincères pour l'état des lieux que vous avez constaté à {lieu}. "
            "Ce n'est pas le niveau de propreté et de confort que nous voulons offrir, et nous prenons votre retour très au sérieux. "
            "Nous reviendrons vers vous. "
            "Si vous souhaitez nous donner plus de précisions, répondez simplement à ce message."
        ),
        "livraison_logistique": (
            "Nous vous présentons nos excuses sincères pour le problème de livraison que vous avez rencontré. "
            "Nous prenons votre situation très au sérieux et nous cherchons à comprendre ce qui s'est passé. "
            "Nous reviendrons vers vous pour trouver une solution. "
            "Si vous souhaitez nous donner plus de précisions, répondez simplement à ce message."
        ),
        "resolution_probleme": (
            "Nous vous présentons nos excuses sincères pour la façon dont votre demande a été prise en charge à {lieu}. "
            "Nous prenons votre situation très au sérieux et nous allons reprendre votre dossier avec attention. "
            "Nous reviendrons vers vous. "
            "Si vous souhaitez nous donner plus de précisions, répondez simplement à ce message."
        ),
        "autre": (
            "Nous vous présentons nos excuses sincères pour la mauvaise expérience que vous avez vécue à {lieu}. "
            "Ce n'est pas le niveau de service que nous voulons offrir, et nous prenons votre retour très au sérieux. "
            "Nous cherchons à comprendre ce qui s'est passé et nous reviendrons vers vous. "
            "Si vous souhaitez nous donner plus de précisions, répondez simplement à ce message."
        ),
    },
    "discordance": {
        "attente": (
            "Merci d'avoir pris le temps de nous écrire. Votre note est positive, mais votre message nous laisse penser que l'attente à {lieu} vous a gêné. "
            "Nous voulons que votre expérience soit bonne de bout en bout : pouvez-vous nous en dire un peu plus ? "
            "Nous tiendrons compte de votre retour."
        ),
        "accueil": (
            "Merci d'avoir pris le temps de nous écrire. Votre note est positive, mais votre message nous laisse penser que l'accueil à {lieu} ne vous a pas pleinement satisfait. "
            "Nous voulons que votre expérience soit bonne de bout en bout : pouvez-vous nous en dire un peu plus ? "
            "Nous tiendrons compte de votre retour."
        ),
        "qualite_produit": (
            "Merci d'avoir pris le temps de nous écrire. Votre note est positive, mais votre message nous laisse penser que la qualité de ce que vous avez reçu à {lieu} ne vous a pas pleinement satisfait. "
            "Nous voulons que votre expérience soit bonne de bout en bout : pouvez-vous nous en dire un peu plus ? "
            "Nous tiendrons compte de votre retour."
        ),
        "facturation": (
            "Merci d'avoir pris le temps de nous écrire. Votre note est positive, mais votre message nous laisse penser qu'un point de facturation ou de paiement vous a gêné. "
            "Nous voulons que votre expérience soit bonne de bout en bout : pouvez-vous nous en dire un peu plus ? "
            "Nous tiendrons compte de votre retour."
        ),
        "tarifs": (
            "Merci d'avoir pris le temps de nous écrire. Votre note est positive, mais votre message nous laisse penser que nos tarifs vous ont posé question. "
            "Nous voulons que votre expérience soit bonne de bout en bout : pouvez-vous nous en dire un peu plus ? "
            "Nous tiendrons compte de votre retour."
        ),
        "reseau": (
            "Merci d'avoir pris le temps de nous écrire. Votre note est positive, mais votre message nous laisse penser que la qualité de la connexion vous a gêné. "
            "Nous voulons que votre expérience soit bonne de bout en bout : pouvez-vous nous en dire un peu plus ? "
            "Nous tiendrons compte de votre retour."
        ),
        "proprete_cadre": (
            "Merci d'avoir pris le temps de nous écrire. Votre note est positive, mais votre message nous laisse penser que la propreté ou le cadre de {lieu} ne vous a pas pleinement satisfait. "
            "Nous voulons que votre expérience soit bonne de bout en bout : pouvez-vous nous en dire un peu plus ? "
            "Nous tiendrons compte de votre retour."
        ),
        "livraison_logistique": (
            "Merci d'avoir pris le temps de nous écrire. Votre note est positive, mais votre message nous laisse penser que la livraison ne s'est pas passée comme vous l'espériez. "
            "Nous voulons que votre expérience soit bonne de bout en bout : pouvez-vous nous en dire un peu plus ? "
            "Nous tiendrons compte de votre retour."
        ),
        "resolution_probleme": (
            "Merci d'avoir pris le temps de nous écrire. Votre note est positive, mais votre message nous laisse penser que la prise en charge de votre demande à {lieu} ne vous a pas pleinement satisfait. "
            "Nous voulons que votre expérience soit bonne de bout en bout : pouvez-vous nous en dire un peu plus ? "
            "Nous tiendrons compte de votre retour."
        ),
        "autre": (
            "Merci d'avoir pris le temps de nous écrire. Votre note est positive, mais votre message nous laisse penser que votre visite à {lieu} ne s'est pas entièrement bien passée. "
            "Nous voulons que votre expérience soit bonne de bout en bout : pouvez-vous nous en dire un peu plus ? "
            "Nous tiendrons compte de votre retour."
        ),
    },
    "negatif": {
        "attente": (
            "Merci d'avoir pris le temps de nous écrire, et toutes nos excuses pour l'attente que vous avez eue à {lieu}. "
            "Votre retour est précieux : il nous aide à améliorer notre organisation. "
            "Nous reviendrons vers vous si nous avons besoin de précisions, et vous pouvez répondre à ce message à tout moment."
        ),
        "accueil": (
            "Merci d'avoir pris le temps de nous écrire, et toutes nos excuses pour l'accueil que vous avez reçu à {lieu}. "
            "Votre retour est précieux : il nous aide à améliorer la façon dont nous recevons nos clients. "
            "Nous reviendrons vers vous si nous avons besoin de précisions, et vous pouvez répondre à ce message à tout moment."
        ),
        "qualite_produit": (
            "Merci d'avoir pris le temps de nous écrire, et toutes nos excuses pour la qualité de ce que vous avez reçu à {lieu}. "
            "Votre retour est précieux : il nous aide à nous améliorer. "
            "Nous reviendrons vers vous si nous avons besoin de précisions, et vous pouvez répondre à ce message à tout moment."
        ),
        "facturation": (
            "Merci d'avoir pris le temps de nous écrire, et toutes nos excuses pour le désagrément lié à votre facturation ou à votre paiement. "
            "Nous allons vérifier les éléments de votre dossier. "
            "Nous reviendrons vers vous si nous avons besoin de précisions, et vous pouvez répondre à ce message à tout moment."
        ),
        "tarifs": (
            "Merci d'avoir pris le temps de nous écrire au sujet de nos tarifs. "
            "Nous comprenons votre réaction et votre retour est précieux pour nous. "
            "Nous reviendrons vers vous si nous avons besoin de précisions, et vous pouvez répondre à ce message à tout moment."
        ),
        "reseau": (
            "Merci d'avoir pris le temps de nous écrire, et toutes nos excuses pour les difficultés de connexion que vous avez rencontrées. "
            "Votre retour est précieux : il nous aide à repérer ce qui doit être amélioré. "
            "Nous reviendrons vers vous si nous avons besoin de précisions, et vous pouvez répondre à ce message à tout moment."
        ),
        "proprete_cadre": (
            "Merci d'avoir pris le temps de nous écrire, et toutes nos excuses pour ce que vous avez constaté à {lieu} en matière de propreté ou de confort. "
            "Votre retour est précieux : il nous aide à améliorer nos lieux. "
            "Nous reviendrons vers vous si nous avons besoin de précisions, et vous pouvez répondre à ce message à tout moment."
        ),
        "livraison_logistique": (
            "Merci d'avoir pris le temps de nous écrire, et toutes nos excuses pour le problème de livraison que vous avez rencontré. "
            "Votre retour est précieux : il nous aide à améliorer notre organisation. "
            "Nous reviendrons vers vous si nous avons besoin de précisions, et vous pouvez répondre à ce message à tout moment."
        ),
        "resolution_probleme": (
            "Merci d'avoir pris le temps de nous écrire, et toutes nos excuses pour la façon dont votre demande a été prise en charge à {lieu}. "
            "Votre retour est précieux : il nous aide à mieux répondre à nos clients. "
            "Nous reviendrons vers vous si nous avons besoin de précisions, et vous pouvez répondre à ce message à tout moment."
        ),
        "autre": (
            "Merci d'avoir pris le temps de nous écrire, et toutes nos excuses pour la déception que vous avez ressentie à {lieu}. "
            "Votre retour est précieux : il nous aide à nous améliorer. "
            "Nous reviendrons vers vous si nous avons besoin de précisions, et vous pouvez répondre à ce message à tout moment."
        ),
    },
    # Un seul texte : sans signal négatif, le thème n'oriente pas la réponse.
    "rappel_simple": {
        "autre": (
            "Merci d'avoir pris le temps de nous écrire et de nous laisser vos coordonnées. "
            "Nous avons bien noté que vous souhaitiez être recontacté et nous reviendrons vers vous. "
            "Vous pouvez aussi répondre à ce message si vous préférez."
        ),
    },
}
