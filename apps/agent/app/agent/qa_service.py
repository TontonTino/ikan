"""
Service de Question/Réponse pour les managers. CONVERTI depuis le prototype :
mock_store remplacé par de vraies requêtes SQLAlchemy (app.agent.queries),
chaque fonction reçoit désormais une session `db` explicite.

Flux strict (conservé du prototype) :
  1. classifier_intention() détermine l'intention SANS jamais passer par le LLM.
  2. La fonction de requête correspondante va chercher les données en base.
  3. Un prompt Groq est construit avec UNIQUEMENT ces données réelles.
  4. Si l'intention est "autre", on répond avec un message fixe SANS
     appeler le LLM du tout.

MÉMOIRE CONVERSATIONNELLE (voir app.agent.conversation_manager) :
  - Chaque appel charge/crée une Conversation et ses derniers tours, puis
    construit l'historique de messages envoyé au LLM.
  - Chaque appel persiste le tour courant et met à jour le contexte actif
    de la conversation.
  - RÈGLE : la mémoire est TOUJOURS best-effort. Toute panne côté
    ConversationManager (DB indisponible, etc.) est capturée, journalisée
    en WARNING, et le Q&A continue en mode dégradé (stateless) — jamais
    d'échec de la question à cause de la mémoire.
"""
from __future__ import annotations

import json
import logging
import re
import uuid
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.agent import conversation_manager, queries
from app.agent.intent_classifier import (
    MOTS_CLES_INTENTIONS, _strip_accents, classifier_intention, detect_followup_question,
)
from app.models.conversation import Conversation, ConversationTurn
from app.providers import llm_provider

logger = logging.getLogger(__name__)

MESSAGE_HORS_PERIMETRE = (
    "Je suis YAM, l'assistant IKAN AI : je ne sais pas répondre à ça dans ce cadre. "
    "Je peux en revanche vous aider sur les feedbacks, alertes, thèmes et tendances de votre organisation."
)

MESSAGE_PRESENTATION = (
    "Je suis YAM, l'assistant IKAN AI. J'analyse les feedbacks clients de votre organisation : "
    "alertes critiques, thèmes, problèmes récurrents, tendances et recommandations d'actions. "
    "Posez-moi votre question !"
)

_PATTERN_IDENTITE = re.compile(
    r"(qui es[- ]tu|tu es qui|qui etes[- ]vous|vous etes qui|comment t'?appelles[- ]tu|"
    r"comment tu t'?appelles|tu t'?appelles comment|quel est ton nom|c'?est quoi ton nom)",
    re.IGNORECASE,
)

_SYSTEM_PROMPT_CLASSEMENT = """
Tu es YAM, l'assistant d'analyse business d'IKAN AI pour un opérateur télécom.
Le manager te demande de COMPARER SES AGENCES : ta réponse doit NOMMER les agences.

RÈGLES ABSOLUES :
- Tu réponds UNIQUEMENT à partir du JSON fourni ; tu n'inventes aucun chiffre ni aucune agence.
- Commence par le verdict, en nommant explicitement l'agence : « L'agence X a la
  satisfaction la plus faible : 32,5 % sur 40 feedbacks. » Ne réponds JAMAIS par
  thème ou de façon générale à la place d'une agence.
- Selon la question : « la plus faible / la pire / la moins performante / en difficulté »
  → utilise `plus_faibles` ; « la meilleure / la plus haute / en tête / top » → utilise
  `meilleures`. Si la question ne précise pas le sens, donne les deux extrémités.
- Nomme les 2 ou 3 premières agences du classement demandé (pas seulement la première),
  avec pour chacune : `satisfaction_pct`, `nb_feedbacks`, `nb_alertes_elevees_ou_critiques`.
- Si `volume_faible` est vrai pour une agence, précise que son taux repose sur très peu de
  feedbacks (fiabilité limitée) ; ne la présente pas comme un constat solide.
- Si `perimetre_restreint_a_une_agence` est vrai ou `nb_agences_classees` vaut 1, tu n'as
  accès qu'à UNE agence : dis-le, ne prétends pas la comparer à d'autres, donne sa situation.
- Si `agences_actives_sans_feedback` n'est pas vide, mentionne-les en une phrase
  (non classables faute de feedback sur la période).
- Rappelle la période (`periode_jours` jours) et le volume total analysé.
- « Satisfaction » = part des clients ayant noté 4 ou 5 sur 5.
- Distingue FAIT (chiffres) et HYPOTHÈSE ; ne propose aucune cause qui ne soit pas dans les données.
- Termine par UNE recommandation concrète et ciblée sur l'agence nommée.
- Réponds en français, de façon concise (une courte liste ou un tableau des 2-3 agences).
"""

_SYSTEM_PROMPT_BASE = """
Tu es YAM, l'assistant d'analyse business d'IKAN AI pour un opérateur télécom.
Tu travailles aux côtés du manager comme un analyste business expert.
Si on te demande qui tu es, présente-toi comme YAM, l'assistant IKAN AI.

PRINCIPE FONDAMENTAL — INSIGHT FIRST, DATA SECOND :
Commence TOUJOURS par la conclusion la plus importante, pas par les données.
Structure chaque réponse ainsi :
1. SITUATION : ce qui se passe en une phrase directe
2. INTERPRÉTATION : ce que cela signifie pour le manager
3. CAUSE PROBABLE : si les données permettent de l'identifier
   (utilise "semble", "probablement", "les données suggèrent" —
   jamais de certitude absolue)
4. RECOMMANDATION : une action concrète et spécifique
5. DONNÉES : les chiffres qui justifient ton analyse
   (résumés, pas un tableau exhaustif sauf si nécessaire)

RÈGLES ABSOLUES :
- Tu réponds UNIQUEMENT à partir des données JSON fournies
- Tu n'inventes JAMAIS de chiffre ou de feedback absent des données
- Le champ 'agence_nom' est le SEUL identifiant officiel de lieu
- Un lieu mentionné dans 'commentaire' n'est jamais un nom d'agence officiel
- Quand les données sont insuffisantes, dis-le clairement
- Distingue toujours FAIT / INTERPRÉTATION / HYPOTHÈSE / RECOMMANDATION
- Réponds en français, de façon concise et utile pour un manager

POUR LES QUESTIONS DE SUIVI (marquées [CONTEXTE]) :
Réponds directement à la question posée en utilisant l'historique.
Ne répète pas les données du tour précédent sauf si nécessaire.
Concentre-toi sur ce que le manager veut savoir maintenant.

Si tu ne peux pas répondre à partir des données disponibles,
dis-le clairement plutôt que d'improviser.
"""


def _jours_pour_classement(question: str, jours: int) -> int:
    """
    Période d'un classement d'agences. Un classement sur quelques jours est trop
    bruité : par défaut au moins 30 jours ; la question peut préciser
    (« cette semaine » = 7, « ce trimestre » = 90, « cette année » = 365, « ce mois » = 30).
    """
    q = _strip_accents(question.lower())
    if "semaine" in q:
        return 7
    if "trimestre" in q:
        return 90
    if re.search(r"\b(annee|an)\b", q):
        return 365
    if "mois" in q:
        return 30
    return max(jours, 30)


def _resume_agregats(feedbacks: list[dict[str, Any]]) -> dict[str, Any]:
    total = len(feedbacks)
    critiques = sum(1 for f in feedbacks if f["criticite"] == "critique")
    elevees = sum(1 for f in feedbacks if f["criticite"] == "elevee")

    par_theme: dict[str, int] = {}
    sentiment_par_theme: dict[str, list[float]] = {}
    for f in feedbacks:
        theme = f["theme_principal"]
        par_theme[theme] = par_theme.get(theme, 0) + 1
        sentiment_par_theme.setdefault(theme, []).append(f["sentiment_score"])
    top_themes = sorted(par_theme.items(), key=lambda item: item[1], reverse=True)[:3]

    moyennes_theme = {
        theme: sum(scores) / len(scores) for theme, scores in sentiment_par_theme.items()
    }
    theme_plus_negatif = min(moyennes_theme.items(), key=lambda x: x[1]) if moyennes_theme else None

    return {
        "total": total,
        "critiques": critiques,
        "elevees": elevees,
        "top_themes": [{"theme": theme, "count": count} for theme, count in top_themes],
        "theme_sentiment_le_plus_negatif": (
            {"theme": theme_plus_negatif[0], "sentiment_moyen": round(theme_plus_negatif[1], 3)}
            if theme_plus_negatif else None
        ),
    }


def _charger_memoire(
    db: Session,
    conversation_id: Optional[uuid.UUID],
    utilisateur_id: Optional[uuid.UUID],
    agence_id: Optional[uuid.UUID],
) -> tuple[Optional[Conversation], list[ConversationTurn]]:
    """
    Charge (ou crée) la conversation et ses derniers tours — best-effort :
    toute exception est capturée ici, journalisée en WARNING, et le Q&A
    continue en mode dégradé (conversation=None, aucun historique).
    """
    try:
        conversation = conversation_manager.get_or_create_conversation(
            db, conversation_id, utilisateur_id, agence_id
        )
        turns = conversation_manager.get_recent_turns(db, conversation.id)
        return conversation, turns
    except Exception:
        logger.warning(
            "ConversationManager indisponible (chargement) — Q&A en mode "
            "dégradé, sans mémoire conversationnelle.",
            exc_info=True,
        )
        try:
            db.rollback()
        except Exception:
            pass
        return None, []


def _finaliser_tour(
    db: Session,
    conversation: Optional[Conversation],
    conversation_id_effectif: uuid.UUID,
    question: str,
    intention: str,
    reponse: str,
    donnees: Any,
    agence_id: Optional[uuid.UUID],
    jours: int,
) -> dict[str, Any]:
    """
    Persiste le tour courant (best-effort — voir _charger_memoire) et
    construit le résultat final avec conversation_id.
    """
    if conversation is not None:
        try:
            conversation_manager.save_turn(db, conversation.id, question, intention, reponse, donnees)
            conversation_manager.update_contexte_actif(db, conversation, intention, donnees, agence_id, jours)
        except Exception:
            logger.warning(
                "ConversationManager indisponible (sauvegarde) — ce tour "
                "n'a pas été mémorisé.",
                exc_info=True,
            )
            try:
                db.rollback()
            except Exception:
                pass

    return {
        "intention": intention,
        "reponse": reponse,
        "donnees": donnees,
        "conversation_id": conversation_id_effectif,
    }


# --- Résolution de références pronominales (Phase 2) ---

_PATTERNS_SUJET_ACTIF = [
    r"\bça\b", r"\bca\b", r"\bcela\b", r"\bceci\b",
    r"\bce probl[eè]me\b", r"\ble probl[eè]me\b",
]
_PATTERNS_AGENCE = [
    r"\bl'agence\b", r"\bl agence\b", r"\bcette agence\b", r"\bl[aà]-bas\b",
]


def _resoudre_references(question: str, contexte: dict) -> str:
    """
    Remplace les références pronominales par leur référent dans le contexte
    actif, pour améliorer la classification.
    Exemple : "Et ça ?" + contexte.sujet_actif="accueil"
              → "Et accueil ?"

    Substitution DIRECTE (le motif est remplacé tel quel par la valeur du
    contexte, pas de reformulation grammaticale — voir note dans le rapport
    de Phase 2 pour la divergence avec l'exemple illustratif de la spec).
    Recherche insensible à la casse. Si aucun référent n'est disponible pour
    un motif donné, ce motif n'est pas remplacé ; "ces clients"/"les clients"
    sont volontairement laissés tels quels (neutres, pas de référent unique).
    Si rien n'a de référent, retourne la question inchangée.
    """
    resultat = question

    sujet_actif = contexte.get("sujet_actif")
    if sujet_actif:
        for pattern in _PATTERNS_SUJET_ACTIF:
            resultat = re.sub(pattern, sujet_actif, resultat, flags=re.IGNORECASE)

    agence_nom = contexte.get("agence_nom")
    if agence_nom:
        for pattern in _PATTERNS_AGENCE:
            resultat = re.sub(pattern, agence_nom, resultat, flags=re.IGNORECASE)

    return resultat


def repondre_question(
    db: Session,
    organisation_id: uuid.UUID,
    question: str,
    agence_id: Optional[uuid.UUID] = None,
    jours: int = 7,
    conversation_id: Optional[uuid.UUID] = None,
    utilisateur_id: Optional[uuid.UUID] = None,
) -> dict[str, Any]:
    """
    Répond à une question en langage naturel d'un manager.

    Retourne {'intention': str, 'reponse': str, 'donnees': Any,
    'conversation_id': UUID}. `conversation_id` est toujours renvoyé (même
    en mode dégradé, où il est généré localement sans être persisté) — le
    client le renvoie au tour suivant pour poursuivre la conversation.

    `organisation_id` provient TOUJOURS du JWT de l'appelant (jamais du
    corps de la requête). Si `agence_id` est fourni, il est vérifié comme
    appartenant à cette organisation AVANT toute requête de données
    (PerimetreOrganisationError sinon).
    """
    if agence_id is not None:
        queries.verifier_agence_dans_organisation(db, organisation_id, agence_id)

    conversation, turns_precedents = _charger_memoire(db, conversation_id, utilisateur_id, agence_id)
    conversation_id_effectif = conversation.id if conversation is not None else (conversation_id or uuid.uuid4())

    # Question d'identité : réponse fixe, sans LLM ni accès aux données.
    if _PATTERN_IDENTITE.search(_strip_accents(question)):
        return _finaliser_tour(
            db, conversation, conversation_id_effectif, question, "presentation",
            MESSAGE_PRESENTATION, None, agence_id, jours,
        )

    contexte_actif = conversation.contexte_actif if conversation else None
    question_resolue = _resoudre_references(question, contexte_actif or {})
    intention = classifier_intention(question_resolue, contexte_actif)
    est_relance_avec_contexte = (
        detect_followup_question(question_resolue)
        and contexte_actif is not None
        and contexte_actif.get("intention_precedente") in MOTS_CLES_INTENTIONS
    )

    if intention == "autre":
        return _finaliser_tour(
            db, conversation, conversation_id_effectif, question, "autre",
            MESSAGE_HORS_PERIMETRE, None, agence_id, jours,
        )

    if intention == "classement_agences":
        # Toujours recalculé (même en relance : « et la meilleure ? » change le sens
        # de la question) et rédigé avec son propre prompt système, qui impose de
        # NOMMER les agences avec leurs chiffres.
        jours_classement = _jours_pour_classement(question, jours)
        donnees = queries.query_classement_agences(
            db, organisation_id, agence_id=agence_id, jours=jours_classement
        )
        user_prompt = (
            f"Question du manager : « {question} »\n\n"
            "Voici le classement des agences (rang 1 = la moins satisfaisante) sur la période, "
            f"au format JSON :\n{json.dumps(donnees, ensure_ascii=False)}"
        )
        if est_relance_avec_contexte:
            user_prompt = (
                "[CONTEXTE : relance dans une conversation ; l'historique est disponible ci-dessus.]\n\n"
                + user_prompt
            )
        messages_classement = conversation_manager.build_messages_history(
            turns_precedents, _SYSTEM_PROMPT_CLASSEMENT, user_prompt
        )
        reponse_classement = llm_provider.generate_text(
            _SYSTEM_PROMPT_CLASSEMENT, user_prompt,
            messages_history=messages_classement, max_tokens=600,
        )
        return _finaliser_tour(
            db, conversation, conversation_id_effectif, question, intention,
            reponse_classement, donnees, agence_id, jours_classement,
        )

    # Relance confirmée : même intention que le tour précédent, avec de
    # l'historique disponible. On NE recharge PAS les données depuis la DB
    # (déjà transmises au LLM dans les tours précédents via l'historique de
    # messages) — on construit un prompt minimal ciblé sur la question
    # posée, pour éviter que le LLM ne régénère une analyse complète déjà
    # donnée au tour précédent.
    is_followup = (
        len(turns_precedents) > 0
        and contexte_actif is not None
        and contexte_actif.get("intention_precedente") == intention
    )

    if is_followup:
        donnees = None
        user_prompt = (
            f"[RELANCE] Le manager demande : '{question}'\n\n"
            f"Contexte actif : sujet='{contexte_actif.get('sujet_actif')}', "
            f"agence='{contexte_actif.get('agence_nom')}'\n\n"
            f"L'historique complet de la conversation est disponible ci-dessus. "
            f"Réponds UNIQUEMENT à la question posée en utilisant ce qui a déjà "
            f"été analysé. Ne répète pas les données du tour précédent. "
            f"Donne une réponse courte et directe."
        )
    elif intention == "alertes_critiques":
        donnees = queries.query_alertes_critiques(db, organisation_id, agence_id=agence_id, jours=jours)
        user_prompt = (
            "Voici la liste des feedbacks d'alerte critique (criticité "
            "élevée ou critique) des derniers jours, DÉJÀ TRIÉE par ordre "
            "de priorité décroissant (champ 'score_priorite', qui combine "
            "criticité, fraîcheur et fréquence du thème), au format JSON :\n"
            f"{json.dumps(donnees, ensure_ascii=False)}\n\n"
            "Commence par identifier le problème dominant et son urgence. "
            "Explique POURQUOI ces alertes sont préoccupantes (volume, "
            "concentration, récurrence). Identifie l'agence ou le thème le "
            "plus critique. Termine par une recommandation d'action concrète "
            "et prioritaire. Les données détaillées viennent en dernier."
        )

    elif intention == "statistiques_theme":
        donnees = queries.query_statistiques_theme(db, organisation_id, agence_id=agence_id, jours=jours)
        user_prompt = (
            "Voici la répartition des feedbacks par thème sur la période, "
            f"au format JSON :\n{json.dumps(donnees, ensure_ascii=False)}\n\n"
            "Commence par identifier le thème dominant et ce qu'il révèle "
            "sur la satisfaction client. Explique si la répartition est "
            "normale ou préoccupante. Donne une recommandation sur quoi "
            "prioriser. Les chiffres viennent ensuite pour justifier."
        )

    elif intention == "a_verifier":
        donnees = queries.query_a_verifier(db, organisation_id, agence_id=agence_id, jours=jours)
        user_prompt = (
            "Voici les feedbacks signalés comme nécessitant une "
            f"vérification manuelle, au format JSON :\n"
            f"{json.dumps(donnees, ensure_ascii=False)}\n\n"
            "Commence par expliquer pourquoi ces feedbacks nécessitent "
            "attention (discordance entre note et sentiment). Évalue le "
            "risque que ces cas représentent. Recommande une action de "
            "vérification ciblée."
        )

    elif intention == "resume_periode":
        feedbacks = queries.get_feedbacks(db, organisation_id, agence_id=agence_id, jours=jours)
        donnees = _resume_agregats(feedbacks)
        user_prompt = (
            "Voici les agrégats de l'activité feedbacks sur la période, au "
            f"format JSON :\n{json.dumps(donnees, ensure_ascii=False)}\n\n"
            "Commence par le verdict global de la période en une phrase. "
            "Identifie la tendance principale (amélioration, dégradation, "
            "stable). Mets en avant le fait le plus important que le "
            "manager doit retenir. Les détails chiffrés viennent après."
        )

    elif intention == "problemes_recurrents":
        donnees = queries.query_problemes_recurrents(db, organisation_id, agence_id=agence_id, jours=max(jours, 30))
        user_prompt = (
            "Voici les problèmes récurrents détectés (même thème signalé "
            "plusieurs fois dans la même agence), au format JSON :\n"
            f"{json.dumps(donnees, ensure_ascii=False)}\n\n"
            "Commence par identifier le problème récurrent le plus grave. "
            "Explique ce que la récurrence signifie (problème systémique, "
            "pas un incident isolé). Recommande une action pour briser le "
            "cycle. Les données de fréquence viennent en justification."
        )

    elif intention == "tendances_anomalies":
        donnees = queries.comparer_periodes(db, organisation_id, agence_id=agence_id, jours_periode=jours)
        user_prompt = (
            "Voici une comparaison entre la période actuelle et la période "
            "précédente de même durée, avec les anomalies déjà détectées "
            f"(champ 'anomalies'), au format JSON :\n"
            f"{json.dumps(donnees, ensure_ascii=False)}\n\n"
            "Commence par identifier si la situation s'améliore ou se "
            "dégrade. Mets en avant l'anomalie la plus significative si "
            "elle existe. Explique ce que cette tendance implique si elle "
            "continue. Les comparaisons chiffrées viennent en support."
        )

    elif intention == "evolution_satisfaction":
        donnees = queries.query_evolution_satisfaction(db, organisation_id, agence_id=agence_id, jours_periode=min(jours, 7))
        user_prompt = (
            "Voici l'évolution du sentiment moyen sur plusieurs périodes "
            f"consécutives, de la plus ancienne à la plus récente, au format JSON :\n"
            f"{json.dumps(donnees, ensure_ascii=False)}\n\n"
            "Calcule toi-même la tendance à partir des valeurs 'sentiment_moyen' "
            "successives ('null' = pas assez de feedbacks sur cette période, "
            "dis-le si c'est le cas plutôt que de l'ignorer). Commence par le "
            "verdict (s'améliore / se dégrade / stable), explique ce qui "
            "explique cette évolution si les données le permettent, et "
            "recommande comment maintenir ou inverser la tendance."
        )

    elif intention == "predictions_risques":
        donnees = queries.query_predictions(db, organisation_id, agence_id=agence_id, jours_periode=jours)
        if donnees.get("donnees_insuffisantes"):
            return _finaliser_tour(
                db, conversation, conversation_id_effectif, question, intention,
                (
                    "YAM : pas encore assez de données pour établir des prédictions "
                    "fiables. Continuez à collecter des feedbacks."
                ),
                donnees, agence_id, jours,
            )
        user_prompt = (
            "Voici les risques et opportunités détectés par comparaison entre "
            "la période actuelle et la période précédente, au format JSON :\n"
            f"{json.dumps(donnees, ensure_ascii=False)}\n\n"
            "Le champ 'donnees_insuffisantes' indique si l'analyse est fiable. "
            "Pour chaque RISQUE : commence par l'urgence, explique le signal "
            "détecté et recommande une action préventive spécifique. Pour "
            "chaque OPPORTUNITÉ : explique ce qui s'améliore et comment "
            "capitaliser dessus. Distingue clairement ce qui est un FAIT "
            "observé d'une PRÉDICTION basée sur une tendance."
        )

    elif intention == "recommandations":
        # Branche à part (retour direct, pas de passage par l'appel LLM
        # partagé en fin de fonction) : le prompt demandé pour cette
        # intention a son propre system prompt "consultant business" et son
        # propre max_tokens=500, différents de _SYSTEM_PROMPT_BASE/600
        # utilisés par toutes les autres intentions — même schéma que le
        # retour anticipé de "predictions_risques" ci-dessus pour le cas
        # donnees_insuffisantes.
        donnees = queries.query_recommandations(db, organisation_id, agence_id=agence_id, jours=jours)
        if not donnees.get("donnees_disponibles"):
            return _finaliser_tour(
                db, conversation, conversation_id_effectif, question, intention,
                (
                    "YAM : je n'ai pas encore assez de données pour formuler des "
                    "recommandations fiables. Continuez à collecter des "
                    "feedbacks."
                ),
                donnees, agence_id, jours,
            )

        system_prompt_recommandations = (
            "Tu es YAM, l'assistant IKAN AI, dans un rôle de consultant business expert. À partir des données "
            "fournies, produis un plan d'action PRIORISÉ pour le manager.\n\n"
            "Structure ta réponse STRICTEMENT ainsi :\n"
            "🔴 URGENT (à traiter dans les 24h) :\n"
            "- [action concrète et spécifique avec l'agence concernée]\n\n"
            "🟡 IMPORTANT (cette semaine) :\n"
            "- [action concrète]\n\n"
            "🟢 À SURVEILLER :\n"
            "- [action préventive]\n\n"
            "RÈGLES :\n"
            "- Chaque action doit mentionner l'agence ou le thème concerné\n"
            "- Jamais d'action générique comme 'améliorer le service client'\n"
            "- Maximum 2 actions par niveau de priorité\n"
            "- Si un niveau n'a pas d'action justifiée par les données, "
            "omets-le\n"
            "- Termine par : 'Ces recommandations sont basées sur X "
            "feedbacks analysés sur les Y derniers jours.'"
        )
        user_prompt_recommandations = (
            "Voici les données agrégées (alertes prioritaires, problèmes "
            "systémiques, risques détectés, tendance globale), au format "
            f"JSON :\n{json.dumps(donnees, ensure_ascii=False)}"
        )
        messages_recommandations = conversation_manager.build_messages_history(
            turns_precedents, system_prompt_recommandations, user_prompt_recommandations
        )
        reponse_recommandations = llm_provider.generate_text(
            system_prompt_recommandations, user_prompt_recommandations,
            messages_history=messages_recommandations, max_tokens=500,
        )
        return _finaliser_tour(
            db, conversation, conversation_id_effectif, question, intention,
            reponse_recommandations, donnees, agence_id, jours,
        )

    else:
        # Filet de sécurité si intentions.yaml évolue sans que ce service
        # ne soit mis à jour en conséquence.
        return _finaliser_tour(
            db, conversation, conversation_id_effectif, question, "autre",
            MESSAGE_HORS_PERIMETRE, None, agence_id, jours,
        )

    if est_relance_avec_contexte:
        prefixe_relance = (
            f"[CONTEXTE : cette question est une relance sur "
            f"'{contexte_actif.get('intention_precedente', 'la question précédente')}'. "
            f"Sujet actif : {contexte_actif.get('sujet_actif', 'non spécifié')}. "
            f"L'historique de la conversation est disponible ci-dessus.]\n\n"
        )
        user_prompt = prefixe_relance + user_prompt

    messages = conversation_manager.build_messages_history(turns_precedents, _SYSTEM_PROMPT_BASE, user_prompt)
    logger.info(
        f"Appel LLM pour intention='{intention}' avec {len(turns_precedents)} "
        f"tour(s) d'historique ({len(messages)} message(s) au total transmis au LLM)"
    )
    reponse = llm_provider.generate_text(
        _SYSTEM_PROMPT_BASE, user_prompt, messages_history=messages, max_tokens=600
    )

    return _finaliser_tour(
        db, conversation, conversation_id_effectif, question, intention, reponse, donnees, agence_id, jours,
    )


# --- Analyse proactive à l'ouverture du dashboard (Phase 5) ---

_SYSTEM_PROMPT_PROACTIF = (
    "Tu es YAM, l'assistant IKAN AI. Tu viens d'analyser les données "
    "récentes et tu dois informer le manager des points importants "
    "à surveiller, SANS qu'il t'ait posé de question. "
    "Commence par 'J'ai analysé les données récentes.' si la "
    "situation est normale, ou '⚠️ J'ai détecté quelque chose "
    "d'important :' si niveau=warning ou critique. "
    "Sois direct et concis (3-4 phrases maximum). "
    "Termine par une recommandation d'action si niveau >= warning. "
    "Ne mentionne jamais de scores techniques ni d'UUIDs."
)

# Seuils déterministes — voir docstring de generer_resume_proactif() pour
# le choix de "variation de criticité" comme métrique de "variation".
_SEUIL_VARIATION_CRITIQUE = 0.5
_SEUIL_VARIATION_WARNING = 0.3
_NB_ALERTES_CRITIQUE = 5
_NB_ALERTES_WARNING = 2


def _variation_criticite_max(anomalies: list[dict[str, Any]]) -> float:
    """
    Plus grande variation absolue du taux de criticité entre les deux
    périodes, parmi les anomalies détectées par comparer_periodes().

    NOTE DE PORTAGE : comparer_periodes() ne retourne pas de champ
    "variation" générique — chaque type d'anomalie ("sentiment",
    "criticite", "theme_nouveau", "theme_hausse") a sa propre forme, et
    seul le type "criticite" porte des valeurs numériques (valeur_actuelle/
    valeur_precedente, deux fractions 0-1) directement comparables au
    seuil "variation > 50%" demandé. C'est celle utilisée ici — les
    anomalies "theme_hausse" ont bien un pourcentage, mais uniquement
    dans un texte de description libre, pas un champ numérique fiable à
    parser.
    """
    variations = [
        abs(a.get("valeur_actuelle", 0) - a.get("valeur_precedente", 0))
        for a in anomalies
        if a.get("type") == "criticite"
    ]
    return max(variations) if variations else 0.0


def _construire_actions(
    niveau: str,
    theme_dominant: Optional[str],
    agences_touchees: list[str],
    risques: list[dict[str, Any]],
) -> list[str]:
    """
    Dérive 1 à 3 actions courtes de façon déterministe, à partir des mêmes
    données que celles envoyées au LLM — jamais en essayant de parser le
    texte généré par le LLM (format libre, non fiable à extraire). Liste
    vide si niveau="info" (rien à recommander en situation normale).
    """
    if niveau == "info":
        return []

    actions: list[str] = []
    if theme_dominant:
        if len(agences_touchees) == 1:
            actions.append(f"Auditer les causes du thème '{theme_dominant}' à {agences_touchees[0]}")
        else:
            actions.append(f"Auditer les causes du thème '{theme_dominant}' dans les agences concernées")

    for risque in risques:
        theme = risque.get("theme")
        if theme and theme != theme_dominant:
            actions.append(f"Surveiller le thème '{theme}' (risque {risque.get('urgence', 'moyen')})")
        if len(actions) >= 3:
            break

    return actions[:3]


def generer_resume_proactif(
    db: Session,
    organisation_id: uuid.UUID,
    agence_id: Optional[uuid.UUID],
    jours: int = 7,
) -> dict[str, Any]:
    """
    Analyse proactive affichée à l'ouverture de la page Assistant IA, avant
    toute question du manager. Détection 100% déterministe (aucune décision
    métier laissée au LLM, qui ne fait que formuler le texte) — voir
    _SYSTEM_PROMPT_PROACTIF.

    Retourne {"insight": str, "niveau": "info"|"warning"|"critique",
    "actions": list[str]}.

    Mode dégradé : toute exception (DB, LLM) est capturée ici et retourne
    un résultat neutre — ne doit JAMAIS faire échouer le chargement du
    dashboard.

    La vérification de périmètre (agence dans l'organisation) est faite AVANT
    le try/except : une erreur d'autorisation ne doit jamais être avalée par
    le mode dégradé.
    """
    if agence_id is not None:
        queries.verifier_agence_dans_organisation(db, organisation_id, agence_id)
    try:
        alertes = queries.query_alertes_critiques(db, organisation_id, agence_id=agence_id, jours=jours)
        comparaison = queries.comparer_periodes(db, organisation_id, agence_id=agence_id, jours_periode=jours)
        predictions = queries.query_predictions(db, organisation_id, agence_id=agence_id, jours_periode=jours)

        nb_alertes = len(alertes)
        variation_max = _variation_criticite_max(comparaison.get("anomalies", []))
        risques = predictions.get("risques", [])
        risque_haute = any(r.get("urgence") == "haute" for r in risques)

        if nb_alertes >= _NB_ALERTES_CRITIQUE or variation_max > _SEUIL_VARIATION_CRITIQUE or risque_haute:
            niveau = "critique"
        elif nb_alertes >= _NB_ALERTES_WARNING or variation_max > _SEUIL_VARIATION_WARNING:
            niveau = "warning"
        else:
            niveau = "info"

        par_theme: dict[str, int] = {}
        for alerte in alertes:
            par_theme[alerte["theme_principal"]] = par_theme.get(alerte["theme_principal"], 0) + 1
        theme_dominant = max(par_theme, key=par_theme.get) if par_theme else None
        agences_touchees = sorted({a["agence_nom"] for a in alertes if a.get("agence_nom")})

        contexte_proactif = {
            "nb_alertes": nb_alertes,
            "theme_dominant": theme_dominant,
            "agences_touchees": agences_touchees,
            "anomalies": comparaison.get("anomalies", []),
            "risques": risques,
            "opportunites": predictions.get("opportunites", []),
            "donnees_insuffisantes": predictions.get("donnees_insuffisantes", False),
        }

        user_prompt = (
            f"Niveau détecté par le système : {niveau}.\n"
            "Contexte de l'analyse, au format JSON :\n"
            f"{json.dumps(contexte_proactif, ensure_ascii=False)}"
        )
        insight = llm_provider.generate_text(_SYSTEM_PROMPT_PROACTIF, user_prompt, max_tokens=300)

        actions = _construire_actions(niveau, theme_dominant, agences_touchees, risques)

        return {"insight": insight, "niveau": niveau, "actions": actions}
    except Exception:
        logger.warning(
            "Échec de la génération du résumé proactif — mode dégradé.",
            exc_info=True,
        )
        return {"insight": "YAM : analyse indisponible pour le moment.", "niveau": "info", "actions": []}
