"""Module Facebook pour le service de veille IKAN AI via Meta Graph API."""

from scraping_service.facebook.client import FacebookGraphClient
from scraping_service.facebook.parser import parse_comment_to_feedback, parse_post_to_feedback
from scraping_service.facebook.scraper import FacebookScraper, extract_page_identifier
from scraping_service.facebook.tokens import inspect_token

__all__ = [
    "FacebookGraphClient",
    "FacebookScraper",
    "extract_page_identifier",
    "parse_comment_to_feedback",
    "parse_post_to_feedback",
    "inspect_token",
]
