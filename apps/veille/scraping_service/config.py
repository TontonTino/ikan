from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuration du service de veille (variables VEILLE_*, ou fichier .env)."""

    model_config = SettingsConfigDict(env_prefix="VEILLE_", env_file=".env", extra="ignore")

    headless: bool = True           # auth.py force headless=False pour la saisie manuelle
    locale: str = "fr-FR"
    timezone: str = "Africa/Ouagadougou"
    nav_timeout_ms: int = 30_000
    action_timeout_ms: int = 5_000
    state_dir: Path = Path("state")  # cookies et sessions, jamais versionnés
    debug_dir: Path = Path("debug")  # captures et dumps HTML en cas d'anomalie
    log_level: str = "INFO"
    api_key: str = ""                # clé exigée par l'API (header X-API-Key)
    host: str = "0.0.0.0"
    port: int = 8002
    max_concurrent_scrapes: int = 2  # nombre de navigateurs lancés en parallèle par l'API
    stealth_enabled: bool = True     # masquage de l'automatisation Playwright
    save_debug_artifacts: bool = True # capture d'écran / HTML en cas d'erreur ou 0 résultat

    # Proxy optionnel (utile en production)
    proxy_server: str | None = None
    proxy_username: str | None = None
    proxy_password: str | None = None

    def storage_state_path(self, source: str) -> Path:
        """Fichier de session Playwright pour une source donnée (ex. 'facebook')."""
        self.state_dir.mkdir(parents=True, exist_ok=True)
        return self.state_dir / f"{source}_storage_state.json"

    def debug_artifact_path(self, category: str, filename: str) -> Path:
        """Génère un chemin horodaté pour enregistrer un artefact de débogage."""
        out_dir = self.debug_dir / category
        out_dir.mkdir(parents=True, exist_ok=True)
        return out_dir / filename


settings = Settings()
