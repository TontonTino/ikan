"""Test hors ligne du nettoyage de texte et du parsing (aucun accès à Facebook).

Usage : python -m scripts.test_parser
"""

from scraping_service.facebook.parser import (
    _filter_clean_content,
    _parse_relative_time,
    clean_facebook_url,
    detect_review_rating,
    filter_clean_content,
)

sample = (
    "Awa Traoré\n"
    "J'aime beaucoup ce restaurant, le service est rapide\n"
    "Like many customers, I waited too long\n"
    "J'aime\nCommenter\nPartager\n12 k\nToutes les réactions : 12"
)
result = filter_clean_content(sample)
assert "J'aime beaucoup ce restaurant" in result, result
assert "Like many customers" in result, result
assert "Commenter" not in result and "Partager" not in result, result
assert "12 k" not in result and "Toutes les réactions" not in result, result

# Dates relatives et absolues
assert _parse_relative_time("2 j") is not None
assert _parse_relative_time("3 h") is not None
assert _parse_relative_time("12 mars") is not None  # Désormais supporté !
assert _parse_relative_time("texte sans date") is None

# Détection de recommandation
rating_pos, status_pos = detect_review_rating("Awa Traoré recommande Restaurant Le Délice.")
assert rating_pos == 5.0 and status_pos == "recommended"

rating_neg, status_neg = detect_review_rating("Paul ne recommande pas Cet Hôtel.")
assert rating_neg == 1.0 and status_neg == "not_recommended"

# Nettoyage des paramètres de tracking Facebook
url_propre = clean_facebook_url("https://www.facebook.com/page/posts/123?fbclid=xyz&ref=page")
assert url_propre == "https://www.facebook.com/page/posts/123"

print("[SUCCÈS] Tous les tests hors-ligne du parser et des dates sont validés avec succès !")
print("Extrait nettoyé :", result)
