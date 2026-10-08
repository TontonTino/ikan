import pytest
from scraping_service.config import settings


@pytest.fixture(autouse=True)
def isolate_test_directories(tmp_path, monkeypatch):
    """Garantit l'isolation stricte des tests : aucun test ne modifie state/ ou data/ réels."""
    test_state_dir = tmp_path / "test_state"
    test_data_dir = tmp_path / "test_data"
    test_state_dir.mkdir(parents=True, exist_ok=True)
    test_data_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(settings, "state_dir", test_state_dir)
    monkeypatch.setattr(settings, "data_dir", test_data_dir)
