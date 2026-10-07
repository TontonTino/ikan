"""
Configuration centrale de l'application IKAN AI.
Charge les variables d'environnement depuis le fichier .env
"""
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import AnyHttpUrl
from typing import List


from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent
ENV_PATH = BASE_DIR / ".env"


class Settings(BaseSettings):
    # Application
    APP_ENV: str = "development"
    # Active le garde-fou sur l'hôte de la base (app/db/session.py). Désactivé par défaut :
    # la production utilise encore Supabase au 29/09/2026 ; à activer lors du basculement
    # vers une base dédiée (voir commentaire dans session.py). Volontairement absent de
    # render.yaml pour rester à False en production tant que ce basculement n'a pas eu lieu.
    ENFORCE_DB_ISOLATION: bool = False
    APP_HOST: str = "0.0.0.0"
    APP_PORT: int = 8000
    DEBUG: bool = True
    PROJECT_NAME: str = "IKAN AI"
    API_V1_STR: str = "/api/v1"

    # URL du formulaire client public (ex: pour la génération du QR code)
    PUBLIC_CLIENT_URL: str = "http://localhost:4321"

    # Base de données
    DATABASE_URL: str = "postgresql://postgres:password@localhost:5432/ikanai"

    # JWT
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # CORS : liste séparée par des virgules (sans JSON). Une variable d'environnement REMPLACE ce défaut :
    # en production, ALLOWED_ORIGINS doit contenir toutes les origines voulues (client + dashboard).
    # Défaut = développement local + production actuelle (client ikan-1, dashboard ikanai-dashboard-fixs).
    ALLOWED_ORIGINS: str = "http://localhost:4321,http://localhost:5173,http://localhost:3000,http://127.0.0.1:4321,http://127.0.0.1:5173,https://ikan-1.onrender.com,https://ikanai-dashboard-fixs.onrender.com"

    @property
    def allowed_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.ALLOWED_ORIGINS.split(",")]

    # Agent IA YAM (optionnel — service séparé, port 8001). Vide = notification désactivée.
    # AGENT_WEBHOOK_URL = URL de BASE du service (ex. http://localhost:8001) ;
    # WEBHOOK_SECRET doit être IDENTIQUE à celui de apps/agent/.env.
    AGENT_WEBHOOK_URL: str = ""
    WEBHOOK_SECRET: str = ""

    # Microservice de Veille & Scraping (optionnel — service séparé, port 8002).
    # VEILLE_SERVICE_URL = URL de BASE du microservice (ex. http://localhost:8002) ;
    # VEILLE_API_KEY = Clé transmise dans le header X-API-Key.
    VEILLE_SERVICE_URL: str = "http://localhost:8002"
    VEILLE_API_KEY: str = "ikan_veille_secret_key_local_2026"

    # Email (optionnel — pour les alertes)
    MAIL_USERNAME: str = ""
    MAIL_PASSWORD: str = ""
    MAIL_FROM: str = "noreply@ikanai.app"
    MAIL_PORT: int = 587
    MAIL_SERVER: str = "smtp.gmail.com"
    MAIL_STARTTLS: bool = True
    MAIL_SSL_TLS: bool = False

    # Stripe (facturation en libre-service). Vide = paiement en ligne désactivé
    # (l'endpoint checkout répond 503 plutôt que de planter). AUCUNE distinction
    # test/production n'est stockée en base : le préfixe de la clé (sk_test_...
    # vs sk_live_...) suffit à lui seul — Stripe cloisonne strictement les
    # données test et live côté serveur, une clé de test ne peut techniquement
    # déclencher aucune transaction réelle.
    STRIPE_SECRET_KEY: str = ""
    STRIPE_PUBLISHABLE_KEY: str = ""
    # Secret de signature du webhook (Stripe Dashboard > Webhooks > Signing secret,
    # ou `stripe listen` en local). Vide = webhook refusé (400), jamais traité en clair.
    STRIPE_WEBHOOK_SECRET: str = ""

    # URL de base du dashboard, utilisée pour les redirections success/cancel de Stripe Checkout.
    PUBLIC_DASHBOARD_URL: str = "http://localhost:5173"

    model_config = SettingsConfigDict(
        env_file=ENV_PATH,
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )


settings = Settings()
