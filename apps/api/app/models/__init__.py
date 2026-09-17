"""
Modèles SQLAlchemy de la plateforme IKAN AI.
Tous les modèles sont importés ici pour faciliter la découverte par Alembic.
"""
from app.models.enums import (
    UserRole,
    SentimentType,
    CriticiteType,
    IdeaStatus,
    PriorityLevel,
)
from app.models.organisation import Organisation
from app.models.agence import Agence
from app.models.utilisateur import Utilisateur
from app.models.qr_code import QRCode
from app.models.feedback import Feedback
from app.models.suggestion import Suggestion, HistoriqueSuggestion
from app.models.analyse_ia import AnalyseIA
from app.models.recommandation import Recommandation
from app.models.historique_action import HistoriqueAction
from app.models.demande_contact import DemandeContact
from app.models.system_settings import SystemSettings
from app.models.historique_feedback import HistoriqueFeedback
from app.models.reponse_client import ReponseClient

__all__ = [
    # Enums
    "UserRole",
    "SentimentType",
    "CriticiteType",
    "IdeaStatus",
    "PriorityLevel",
    # Modèles
    "Organisation",
    "Agence",
    "Utilisateur",
    "QRCode",
    "Feedback",
    "Suggestion",
    "HistoriqueSuggestion",
    "AnalyseIA",
    "Recommandation",
    "HistoriqueAction",
    "DemandeContact",
    "SystemSettings",
    "HistoriqueFeedback",
    "ReponseClient",
]
