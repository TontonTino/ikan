"""
Métadonnées des 8 KPI P0 — définitions pures, aucun accès base de données. Une seule
source de vérité pour le code, le libellé, la description exacte de la formule et
l'unité, utilisée par le moteur (engine.py) et par toute future API KPI.

Stratégie de période (documentée ici, appliquée dans engine.py) :
- KPI Feedback/AnalyseIA (CSAT, NEGATIVE_SENTIMENT_RATE, FEEDBACK_VOLUME) : filtrent sur
  Feedback.date_soumission — même convention que les KPI déjà calculés dans dashboard.py.
- KPI Issue (ISSUE_VOLUME, CRITICAL_ISSUE_RATE, ISSUE_RESOLUTION_RATE, LOOP_CLOSURE_RATE,
  MEDIAN_RESOLUTION_TIME) : filtrent sur Issue.premiere_detection (Issue détectée dans la
  période), jamais sur date_resolution — y compris pour la médiane, où la période délimite
  la population de départ, pas la date de résolution elle-même.

Convention "no_data" : quand un KPI a besoin d'un dénominateur et que celui-ci est nul (ou
qu'aucune Issue résolue n'existe pour la médiane), `value` reste `None` et `status` vaut
"no_data" — jamais une valeur de 0 % ou 0h artificielle. S'applique à CSAT,
NEGATIVE_SENTIMENT_RATE, CRITICAL_ISSUE_RATE, ISSUE_RESOLUTION_RATE, LOOP_CLOSURE_RATE et
MEDIAN_RESOLUTION_TIME. Les KPI de volume (FEEDBACK_VOLUME, ISSUE_VOLUME) n'ont pas cette
notion : un compte de 0 est une réponse valide, jamais "no_data".
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class KPIDefinition:
    code: str
    label: str
    description: str
    unit: str


KPI_DEFINITIONS: dict[str, KPIDefinition] = {
    "CSAT": KPIDefinition(
        code="CSAT",
        label="CSAT",
        description=(
            "Pourcentage de feedbacks avec une note de 4 ou 5 (sur l'échelle 1-5 réellement "
            "utilisée) parmi tous les feedbacks de la période. Feedback.note est toujours "
            "renseigné (NOT NULL en base, défaut 3 à la soumission) : il n'existe pas de "
            "notion distincte de \"réponse CSAT valide\" — la population est donc identique "
            "à FEEDBACK_VOLUME."
        ),
        unit="percent",
    ),
    "NEGATIVE_SENTIMENT_RATE": KPIDefinition(
        code="NEGATIVE_SENTIMENT_RATE",
        label="Taux de sentiment négatif",
        description=(
            "Pourcentage de feedbacks analysés (AnalyseIA existante) dont le sentiment IA "
            "est NEGATIF, parmi les feedbacks analysés de la période. Un feedback sans "
            "AnalyseIA (non encore analysé) est exclu du dénominateur, jamais compté comme "
            "positif ou négatif par défaut."
        ),
        unit="percent",
    ),
    "FEEDBACK_VOLUME": KPIDefinition(
        code="FEEDBACK_VOLUME",
        label="Volume de feedbacks",
        description="Nombre de feedbacks soumis (Feedback.date_soumission) dans la période.",
        unit="count",
    ),
    "ISSUE_VOLUME": KPIDefinition(
        code="ISSUE_VOLUME",
        label="Volume d'Issues",
        description=(
            "Nombre d'Issues distinctes détectées (Issue.premiere_detection) dans la "
            "période — jamais un décompte de feedbacks négatifs. Une Issue liée à plusieurs "
            "feedbacks compte pour une seule unité."
        ),
        unit="count",
    ),
    "CRITICAL_ISSUE_RATE": KPIDefinition(
        code="CRITICAL_ISSUE_RATE",
        label="Taux d'Issues critiques",
        description=(
            "Pourcentage d'Issues de sévérité CRITIQUE (Issue.severite, jamais recalculée "
            "depuis les feedbacks) parmi les Issues détectées dans la période. severite est "
            "NOT NULL avec un défaut (FAIBLE) : aucune Issue sans sévérité à gérer."
        ),
        unit="percent",
    ),
    "ISSUE_RESOLUTION_RATE": KPIDefinition(
        code="ISSUE_RESOLUTION_RATE",
        label="Taux de résolution des Issues",
        description=(
            "Pourcentage d'Issues détectées dans la période dont le statut ACTUEL est "
            "'resolue' ou 'verifiee' (verifiee implique nécessairement d'avoir été résolue). "
            "Une Issue 'reouverte' n'est plus comptée comme résolue, même si elle l'a été "
            "par le passé — le KPI mesure l'état présent, pas l'historique."
        ),
        unit="percent",
    ),
    "MEDIAN_RESOLUTION_TIME": KPIDefinition(
        code="MEDIAN_RESOLUTION_TIME",
        label="Temps médian de résolution",
        description=(
            "Médiane (pas la moyenne) de (date_resolution - premiere_detection), en heures, "
            "pour les Issues détectées dans la période et actuellement 'resolue' ou "
            "'verifiee' avec une date_resolution renseignée. Une Issue non résolue est "
            "exclue plutôt que comptée à 0."
        ),
        unit="hours",
    ),
    "LOOP_CLOSURE_RATE": KPIDefinition(
        code="LOOP_CLOSURE_RATE",
        label="Loop Closure Rate",
        description=(
            "Pourcentage d'Issues nécessitant une action (necessite_action=true) détectées "
            "dans la période et dont le statut ACTUEL est 'verifiee', parmi toutes les "
            "Issues nécessitant une action de la période. Basé sur le statut métier, jamais "
            "sur la seule présence de date_verification."
        ),
        unit="percent",
    ),
    "ISSUE_BACKLOG": KPIDefinition(
        code="ISSUE_BACKLOG", label="Issue Backlog",
        description="Nombre d'Issues actuellement ouvertes, en cours d'action ou rouvertes, dans le périmètre.", unit="count",
    ),
    "BACKLOG_AGE": KPIDefinition(
        code="BACKLOG_AGE", label="Backlog Age",
        description="Médiane en heures de l'âge du cycle ouvert actuel des Issues du backlog.", unit="hours",
    ),
    "ACTION_COMPLETION_RATE": KPIDefinition(
        code="ACTION_COMPLETION_RATE", label="Action Completion Rate",
        description="Pourcentage d'actions non annulées créées dans la période actuellement terminées.", unit="percent",
    ),
    "SLA_COMPLIANCE_RATE": KPIDefinition(
        code="SLA_COMPLIANCE_RATE",
        label="SLA Compliance Rate",
        description=(
            "Pourcentage des Issues résolues pendant la période avec une deadline SLA explicite "
            "qui ont été résolues au plus tard à cette deadline. Les Issues sans SLA sont exclues."
        ),
        unit="percent",
    ),
    "NPS": KPIDefinition(
        code="NPS",
        label="NPS",
        description=(
            "Score NPS = (% de promoteurs avec nps_note 9–10) − (% de détracteurs avec "
            "nps_note 0–6), parmi les feedbacks avec nps_note renseigné dans la période "
            "(date_soumission). Les passifs 7–8 restent au dénominateur. Sans réponse NPS, "
            "le statut est no_data."
        ),
        unit="points",
    ),
}
