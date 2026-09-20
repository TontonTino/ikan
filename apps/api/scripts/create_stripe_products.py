"""
Script one-off : crée les Product + Price Stripe pour les forfaits payants
Starter et Pro (mode test tant que STRIPE_SECRET_KEY est une clé sk_test_...).

XOF (Franc CFA) est une devise Stripe native ZÉRO-DÉCIMALE : unit_amount=30000
représente exactement 30 000 FCFA, sans conversion ni multiplication par 100
(vérifié en conditions réelles avec ce compte de test : Price + Checkout Session
créés et acceptés avec succès en XOF avant d'écrire ce script).

Idempotent : réutilise le Price existant si son lookup_key existe déjà (une
ré-exécution accidentelle ne crée jamais de doublon).

Usage : python scripts/create_stripe_products.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import stripe  # noqa: E402

from app.core.config import settings  # noqa: E402

FORFAITS = [
    {"code": "starter", "nom": "IKAN AI — Starter", "montant_xof": 30000, "lookup_key": "starter_monthly_xof"},
    {"code": "pro", "nom": "IKAN AI — Pro", "montant_xof": 50000, "lookup_key": "pro_monthly_xof"},
]


def creer_ou_reutiliser(forfait: dict) -> str:
    existants = stripe.Price.list(lookup_keys=[forfait["lookup_key"]], limit=1)
    if existants.data:
        prix = existants.data[0]
        print(f"[{forfait['code']}] Price existant réutilisé : {prix.id} (produit {prix.product})")
        return prix.id

    produit = stripe.Product.create(name=forfait["nom"])
    prix = stripe.Price.create(
        product=produit.id,
        currency="xof",
        unit_amount=forfait["montant_xof"],
        recurring={"interval": "month"},
        lookup_key=forfait["lookup_key"],
    )
    print(f"[{forfait['code']}] Product {produit.id} + Price {prix.id} créés ({forfait['montant_xof']} XOF/mois)")
    return prix.id


if __name__ == "__main__":
    if not settings.STRIPE_SECRET_KEY:
        print("STRIPE_SECRET_KEY manquant dans .env — abandon.")
        sys.exit(1)

    stripe.api_key = settings.STRIPE_SECRET_KEY

    resultats = {f["code"]: creer_ou_reutiliser(f) for f in FORFAITS}

    print("\nÀ reporter dans app/services/plan_catalog.py (STRIPE_PRICE_IDS) :")
    for code, price_id in resultats.items():
        print(f'    "{code}": "{price_id}",')
