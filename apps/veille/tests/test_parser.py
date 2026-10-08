from datetime import datetime
import hashlib

from scraping_service.config import settings
from scraping_service.facebook.parser import parse_comment_to_feedback, parse_post_to_feedback


def test_parse_comment_to_feedback(monkeypatch):
    monkeypatch.setattr(settings, "state_secret", "")
    monkeypatch.setattr(settings, "store_author_name", False)

    sample_comment = {
        "id": "123456_789012",
        "message": "Service client rapide et très professionnel !",
        "created_time": "2026-09-30T10:15:30+0000",
        "from": {
            "name": "Jean Dupont",
            "id": "999888777",
        },
        "like_count": 5,
        "permalink_url": "https://www.facebook.com/123456/posts/789012",
    }

    item = parse_comment_to_feedback(
        comment=sample_comment,
        page_id="1618870513365355",
        post_id="123456",
        post_text="Publication de test",
    )

    assert item.source == "facebook"
    assert item.source_id == "123456_789012"
    assert item.author_name is None
    assert item.author_hash is None
    assert "author_id" not in item.metadata
    assert item.text == "Service client rapide et très professionnel !"
    assert item.published_at == datetime.fromisoformat("2026-09-30T10:15:30+00:00")
    assert item.metadata["like_count"] == 5
    assert item.metadata["post_id"] == "123456"


def test_parse_comment_hashes_author_without_storing_identity(monkeypatch):
    monkeypatch.setattr(settings, "state_secret", "test-salt")
    monkeypatch.setattr(settings, "store_author_name", False)
    item = parse_comment_to_feedback(
        comment={"id": "comment", "message": "hello", "from": {"id": "author-id", "name": "Author"}},
        page_id="page",
        post_id="post",
    )

    assert item.author_hash == hashlib.sha256(b"test-salt:author-id").hexdigest()
    assert item.author_name is None
    assert "author-id" not in str(item.model_dump())


def test_parse_comment_accepts_missing_message_and_author():
    # Par défaut (include_empty=False) : commentaire sans texte ignoré
    item_ignored = parse_comment_to_feedback(
        comment={"id": "comment", "message": None, "from": None},
        page_id="page",
        post_id="post",
        include_empty=False,
    )
    assert item_ignored is None

    # Avec include_empty=True : commentaire vide converti
    item = parse_comment_to_feedback(
        comment={"id": "comment", "message": None, "from": None},
        page_id="page",
        post_id="post",
        include_empty=True,
    )
    assert item is not None
    assert item.author_name is None
    assert item.author_hash is None
    assert item.text == "[Média ou commentaire sans texte]"


def test_parse_post_to_feedback():
    sample_post = {
        "id": "1618870513365355_1001",
        "message": "Bienvenue sur la plateforme IKAN AI !",
        "created_time": "2026-09-29T12:00:00+0000",
        "shares": {"count": 12},
        "reactions": {"summary": {"total_count": 45}},
        "comments": {"summary": {"total_count": 8}},
    }

    item = parse_post_to_feedback(post=sample_post, page_id="1618870513365355")

    assert item.source == "facebook"
    assert item.source_id == "1618870513365355_1001"
    assert item.text == "Bienvenue sur la plateforme IKAN AI !"
    assert item.metadata["total_reactions"] == 45
    assert item.metadata["total_comments"] == 8
    assert item.metadata["shares_count"] == 12
