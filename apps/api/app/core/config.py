"""
Configuration centrale de l'application IKAN AI.
Charge les variables d'environnement depuis le fichier .env
"""
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import AnyHttpUrl
from typing import List

from app.core.cors import origines_autorisees


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

    # CORS : liste séparée par des virgules (sans JSON). Si elle est renseignée, elle REMPLACE le défaut
    # (défini dans app/core/cors.py selon APP_ENV). En production, elle doit contenir client et dashboard.
    ALLOWED_ORIGINS: str | None = None

    @property
    def allowed_origins_list(self) -> List[str]:
        return origines_autorisees(self.ALLOWED_ORIGINS, self.APP_ENV)

    # Protection des endpoints publics (formulaire client). Compteurs EN MÉMOIRE : valables pour UNE instance.
    # 0 = limite désactivée. Une agence partage souvent un seul Wi-Fi : ne pas descendre ces seuils sans mesurer.
    RATE_LIMIT_FEEDBACK_PAR_IP: int = 10   # POST /feedbacks, par minute et par adresse IP
    RATE_LIMIT_FEEDBACK_PAR_QR: int = 30   # POST /feedbacks, par minute et par code QR
    RATE_LIMIT_PUBLIC_PAR_IP: int = 60     # /nps, /validate, /categories, par minute et par adresse IP
    # Corps maximal (octets) accepté par POST /feedbacks et POST /feedbacks/{id}/nps.
    PUBLIC_BODY_MAX_OCTETS: int = 16384
    # Nombre de proxys de confiance DEVANT l'API (0 = aucun : l'adresse du socket fait foi et X-Forwarded-For est
    # ignoré). À N > 0, l'adresse retenue est la N-ième en partant de la DROITE de X-Forwarded-For, c'est-à-dire celle
    # ajoutée par notre propre proxy, jamais une valeur envoyée par le client.
    TRUSTED_PROXY_HOPS: int = 0
    # Secret partagé avec le serveur SSR du client (apps/client) : s'il est présent et exact, l'API prend l'adresse
    # transmise dans X-Ikan-Client-Ip (sinon toutes les validations SSR compteraient pour l'IP du serveur client).
    SSR_FORWARD_SECRET: str = ""

    # Connexion : échecs tolérés sur la fenêtre ci-dessous, par couple (IP, e-mail normalisé) puis par IP seule. 0 = limite
    # désactivée. Compteurs EN MÉMOIRE (voir app/core/rate_limit.py). Le compte lui-même n'est JAMAIS verrouillé.
    LOGIN_MAX_ECHECS_PAR_COUPLE: int = 5
    LOGIN_MAX_ECHECS_PAR_IP: int = 30
    LOGIN_FENETRE_SECONDES: int = 900

    # Agent IA YAM (optionnel — service séparé, port 8001). Vide = notification désactivée.
    # AGENT_WEBHOOK_URL = URL de BASE du service (ex. http://localhost:8001) ;
    # WEBHOOK_SECRET doit être IDENTIQUE à celui de apps/agent/.env.
    AGENT_WEBHOOK_URL: str = ""
    WEBHOOK_SECRET: str = ""

    # Microservice de Veille & Scraping (optionnel — service séparé, port 8002).
    # VEILLE_SERVICE_URL = URL de BASE du microservice (ex. http://localhost:8002) ;
    # VEILLE_API_KEY = Clé transmise dans le header X-API-Key.
    VEILLE_SERVICE_URL: str = "http://localhost:8002"
    VEILLE_API_KEY: str = ""

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
