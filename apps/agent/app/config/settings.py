"""
Configuration centrale de l'agent IA IKAN AI — service FastAPI indépendant.
Charge les variables d'environnement depuis .env (voir .env.example).
"""
from pathlib import Path
from typing import List

from pydantic_settings import BaseSettings

BASE_DIR = Path(__file__).resolve().parent.parent.parent
ENV_PATH = BASE_DIR / ".env"


class Settings(BaseSettings):
    # Application
    APP_ENV: str = "development"
    APP_HOST: str = "0.0.0.0"
    APP_PORT: int = 8001
    DEBUG: bool = True
    PROJECT_NAME: str = "IKAN AI — Agent"
    API_STR: str = ""

    # Base de données — même instance PostgreSQL que le backend principal (apps/api)
    DATABASE_URL: str

    # JWT — identiques au backend principal : l'agent VÉRIFIE les tokens émis
    # au login par apps/api, il n'en émet jamais lui-même.
    SECRET_KEY: str
    ALGORITHM: str = "HS256"

    # Secret partagé pour authentifier les appels webhook du backend principal
    WEBHOOK_SECRET: str

    # CORS
    ALLOWED_ORIGINS: str = "http://localhost:4321,http://localhost:5173"

    @property
    def allowed_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.ALLOWED_ORIGINS.split(",") if origin.strip()]

    # Groq — provider LLM pour la génération de texte (Q&A, brouillons d'action)
    GROQ_API_KEY: str = ""
    # groq/compound-mini décommissionné par Groq le 21/09/2026 (404 en prod).
    # openai/gpt-oss-20b : accessible au plan gratuit, largement suffisant ici
    # (le LLM ne fait que rédiger à partir de données déjà extraites, jamais
    # de raisonnement complexe — voir app/agent/qa_service.py).
    GROQ_MODEL: str = "openai/gpt-oss-20b"
    # gpt-oss est un modèle à raisonnement : ses « reasoning tokens » sont décomptés de max_tokens. Vérifié par
    # appels réels : à max_tokens=600 et effort par défaut, finish_reason="length" avec réponse tronquée ou VIDE.
    # « low » rend le raisonnement négligeable pour ce cas d'usage (rédiger à partir de données déjà extraites).
    # Vide = paramètre non envoyé (autres modèles). Ignoré si le modèle n'est pas de la famille gpt-oss.
    GROQ_REASONING_EFFORT: str = "low"
    # Budget de sortie par défaut d'une réponse de Q&A, et plafond après un nouvel essai (réponse tronquée/vide).
    LLM_MAX_TOKENS_REPONSE: int = 1500
    LLM_MAX_TOKENS_PLAFOND: int = 4000

    # Hugging Face — réservé, non utilisé par le classifieur d'intention actuel
    # (moteur à mots-clés déterministe, voir app/agent/intent_classifier.py).
    HF_API_KEY: str = ""

    # WhatsApp Business (Meta Cloud API)
    WHATSAPP_ACCESS_TOKEN: str = ""
    WHATSAPP_PHONE_NUMBER_ID: str = ""
    WHATSAPP_TEMPLATE_NAME: str = "suivi_reclamation_client"
    WHATSAPP_TEMPLATE_LANG: str = "fr"

    class Config:
        env_file = (str(ENV_PATH), ".env")
        case_sensitive = True


settings = Settings()
