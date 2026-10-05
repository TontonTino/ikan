"""
Minimisation des données personnelles avant tout envoi au fournisseur LLM (Groq) ou
stockage dans la mémoire de conversation.

Le numéro de téléphone du client (DemandeContact.telephone, exposé par queries.py sous
`contact_telephone`) n'est nécessaire à AUCUNE génération de texte : il ne sert qu'à
l'envoi WhatsApp (action_service.envoyer_whatsapp), qui le relit directement en base.
Il n'est donc jamais transmis au LLM ni conservé dans l'historique conversationnel.

Ajouter ici tout futur champ personnel qui ne doit pas quitter le périmètre serveur.
"""
from typing import Any

CHAMPS_EXCLUS_DU_LLM: frozenset[str] = frozenset({"contact_telephone"})


def pour_llm(donnees: Any) -> Any:
    """Copie de `donnees` sans les champs personnels exclus (récursif, listes et dicts).
    Ne modifie jamais l'objet d'origine (toujours utilisé pour la réponse et les actions)."""
    if isinstance(donnees, dict):
        return {cle: pour_llm(valeur) for cle, valeur in donnees.items() if cle not in CHAMPS_EXCLUS_DU_LLM}
    if isinstance(donnees, list):
        return [pour_llm(element) for element in donnees]
    if isinstance(donnees, tuple):
        return tuple(pour_llm(element) for element in donnees)
    return donnees
