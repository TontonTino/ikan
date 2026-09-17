"""
Enums utilisés dans les modèles IKAN AI.
"""
import enum


class UserRole(str, enum.Enum):
    """Rôles des utilisateurs dans le système."""
    ADMIN = "admin"
    CX_MANAGER = "cx_manager"
    AGENCY_MANAGER = "agency_manager"


class SentimentType(str, enum.Enum):
    """Type de sentiment détecté dans un commentaire."""
    POSITIF = "positif"
    NEUTRE = "neutre"
    NEGATIF = "negatif"


class CriticiteType(str, enum.Enum):
    """Niveau de criticité d'un feedback."""
    FAIBLE = "faible"
    MOYENNE = "moyenne"
    ELEVEE = "elevee"
    CRITIQUE = "critique"


class IdeaStatus(str, enum.Enum):
    """Statut d'une suggestion ou idée soumise par un client."""
    NOUVEAU = "nouveau"
    EN_COURS = "en_cours"
    TRAITE = "traite"
    REJETE = "rejete"


class PriorityLevel(str, enum.Enum):
    """Niveau de priorité d'une recommandation."""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"
