"""Schéma de réponse de GET /secteurs."""
from pydantic import BaseModel


class SecteurInfo(BaseModel):
    code: str
    libelle: str
