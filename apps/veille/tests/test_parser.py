"""Tests unitaires pour le nettoyage et l'analyse de contenu Facebook."""

import pytest

from scraping_service.facebook.parser import (
    clean_facebook_url,
    detect_review_rating,
    filter_clean_content,
    generate_source_id,
)


def test_filter_clean_content_basic():
    sample = (
        "Awa Traoré\n"
        "J'aime beaucoup ce restaurant, le service est rapide\n"
        "Like many customers, I waited too long\n"
        "J'aime\nCommenter\nPartager\n12 k\nToutes les réactions : 12"
    )
    result = filter_clean_content(sample)
    assert "J'aime beaucoup ce restaurant" in result
    assert "Like many customers" in result
    assert "Commenter" not in result
    assert "Partager" not in result
    assert "12 k" not in result
    assert "Toutes les réactions" not in result


def test_clean_facebook_url():
    raw_url = (
        "https://www.facebook.com/example/posts/123456"
        "?__cft__[0]=AZX&__tn__=%2CO%2CP-R&ref=page_internal&fbclid=IwAR3abc"
    )
    cleaned = clean_facebook_url(raw_url)
    assert cleaned == "https://www.facebook.com/example/posts/123456"
    assert "fbclid" not in cleaned
    assert "__tn__" not in cleaned
    assert "ref" not in cleaned


def test_generate_source_id():
    id1 = generate_source_id("https://facebook.com/post/1", "texte de test")
    id2 = generate_source_id("https://facebook.com/post/1", "autre texte")
    id3 = generate_source_id(None, "texte de test")

    assert len(id1) == 24
    assert id1 == id2  # basé sur permalink en priorité
    assert id1 != id3


def test_detect_review_rating():
    # Avis positif
    r1, s1 = detect_review_rating("Amadou Koné recommande La Brioche Dorée.")
    assert r1 == 5.0
    assert s1 == "recommended"

    # Avis négatif
    r2, s2 = detect_review_rating("Fatou Diallo ne recommande pas Orange Burkina.")
    assert r2 == 1.0
    assert s2 == "not_recommended"

    # En anglais
    r3, s3 = detect_review_rating("John Doe doesn't recommend Brand X.")
    assert r3 == 1.0
    assert s3 == "not_recommended"

    # Note par étoiles
    r4, s4 = detect_review_rating("Note attribuée : 4,5 sur 5 étoiles")
    assert r4 == 4.5
    assert s4 == "star_rating"

    # Post ordinaire
    r5, s5 = detect_review_rating("Voici notre nouveau menu pour la semaine !")
    assert r5 is None
    assert s5 is None


def test_extract_comet_ssr_items():
    from scraping_service.facebook.parser import extract_comet_ssr_items

    mock_html = """
    <html>
    <head>
    <script type="application/json">
    {
      "require": [
        ["CometFeedStory", "render", [], [{
          "story": {
            "id": "post_12345",
            "message": {"text": "Superbe nouvelle offre disponible dans toutes nos agences !"},
            "url": "https://www.facebook.com/brand/posts/12345",
            "creation_time": 1726927200,
            "actors": [{"name": "Brand Burkina"}]
          }
        }]]
      ]
    }
    </script>
    </head>
    </html>
    """
    items = extract_comet_ssr_items(mock_html, "https://www.facebook.com/brand")
    assert len(items) == 1
    item = items[0]
    assert item.author_name == "Brand Burkina"
    assert "Superbe nouvelle offre" in item.text
    assert item.permalink == "https://www.facebook.com/brand/posts/12345"
    assert item.published_at is not None
