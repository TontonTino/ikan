from pathlib import Path
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuration du service de veille via l'API Meta Graph."""

    model_config = SettingsConfigDict(
        env_prefix="VEILLE_",
        env_file=".env",
        extra="ignore"
    )

    # Configuration Meta Graph API
    fb_app_id: str = ""
    fb_app_secret: str = ""
    fb_api_version: str = "v25.0"
    fb_page_access_token: str = ""
    fb_default_page_id: str = ""
    # Client (organisation IKAN AI) auquel rattacher la Page par défaut au démarrage.
    bootstrap_client_id: str = ""
    fb_login_config_id: str = ""
    fb_redirect_uri: str = ""
    fb_webhook_verify_token: str = ""

    # Sécurité & API Service IKAN AI
    env: str = "production"
    api_key: str = ""                # clé exigée pour l'API REST (header X-API-Key)
    log_level: str = "INFO"
    data_dir: Path = Path("data")    # Répertoire d'export JSON/CSV
    cors_origins: list[str] | str = []
    state_dir: Path = Path("state")
    token_encryption_key: str = ""
    state_secret: str = ""
    allowed_return_origins: list[str] | str = []
    lookback_days: int = 30
    sync_interval_minutes: int = 0
    store_author_name: bool = False
    token_warn_days: int = 7
    data_access_warn_days: int = 14
    token_check_interval_hours: int = 6
    alert_webhook_url: str = ""

    @field_validator("cors_origins", "allowed_return_origins", mode="before")
    @classmethod
    def parse_comma_separated_list(cls, value: object) -> list[str]:
        if isinstance(value, str):
            if not value.strip():
                return []
            if value.startswith("[") and value.endswith("]"):
                import json
                try:
                    return json.loads(value)
                except Exception:
                    pass
            return [item.strip() for item in value.split(",") if item.strip()]
        if isinstance(value, list):
            return [str(item).strip() for item in value if str(item).strip()]
        return []

    @field_validator("env")
    @classmethod
    def validate_env(cls, value: str) -> str:
        normalized = value.lower()
        if normalized not in {"dev", "production"}:
            raise ValueError("VEILLE_ENV doit être 'dev' ou 'production'.")
        return normalized

    @property
    def is_production(self) -> bool:
        return self.env == "production"

    def get_data_path(self, filename: str) -> Path:
        """Génère un chemin pour enregistrer des exports de données."""
        self.data_dir.mkdir(parents=True, exist_ok=True)
        return self.data_dir / filename


settings = Settings()
