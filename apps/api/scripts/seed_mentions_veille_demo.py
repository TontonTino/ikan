"""Seed idempotent de mentions Veille démo pour Orange Burkina Faso.

Les lignes passent par ingest_mentions : masquage, déduplication et classification
restent ainsi identiques au flux normal.

Usage (depuis apps/api) :
    python scripts/seed_mentions_veille_demo.py
"""
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from app.db.session import SessionLocal
from app.models.agence import Agence
from app.models.mention_veille import MentionVeille
from app.models.organisation import Organisation
from app.services.veille_service import ingest_mentions


ORG_NAME = "Orange Burkina Faso"
ID_PREFIX = "demo-orange-bf-veille-"

# Texte entièrement fictif, sans auteurs ni coordonnées personnelles.
# agency_slot=None rattache la mention à l'organisation ; un entier sélectionne
# une agence active triée par nom, ce qui garde le choix stable entre exécutions.
DEMO_ROWS = [
    ("Excellent réseau 4G à Ouagadougou, la connexion reste stable même le soir. Bravo !", 0, 0),
    ("Le réseau coupe souvent à Bobo-Dioulasso et le débit devient très lent. Déçu.", 1, 1),
    ("La 4G est disponible dans le quartier de Karpala depuis ce matin.", 2, None),
    ("Forfait data abordable et recharge rapide, très bonne expérience.", 3, 2),
    ("Ma data a été facturée deux fois, c'est inadmissible ; j'attends un remboursement.", 4, 0),
    ("Le menu Orange Money affiche les frais avant validation du transfert.", 5, None),
    ("Transfert Orange Money rapide et opération réussie, merci beaucoup.", 6, 1),
    ("Transfert Orange Money bloqué, compte débité et aucun remboursement reçu. Arnaque.", 7, None),
    ("La fibre est enfin disponible près de notre secteur, c'est une excellente nouvelle.", 8, 2),
    ("La fibre est très lente depuis hier, plusieurs coupures et aucun retour du support.", 9, 0),
    ("Accueil aimable en agence et réponse rapide, personnel très professionnel.", 10, 1),
    ("Attente interminable en agence, service lent et personnel désagréable.", 11, None),
    ("Passage à l'agence de Koudougou ce lundi matin.", 12, 2),
    ("Le conseiller a bien expliqué les forfaits, je suis très satisfait. Merci.", 13, 0),
    ("Le service client ne répond jamais et mon problème n'est toujours pas résolu.", 14, None),
    ("Un nouveau point de vente a ouvert près du marché de Zogona cette semaine.", 15, 1),
    ("Recharge effectuée rapidement, parfait pour reprendre mes activités.", 16, 2),
    ("Mon crédit a disparu après la recharge, c'est vraiment nul et frustrant.", 18, None),
    ("La lune est claire au-dessus de Ouaga ce soir.", 21, 0),
    ("Merci beaucoup pour cette journée, à bientôt.", 29, None),
]


def construire_items(now: datetime, agences: list[Agence]) -> dict[object, list[dict]]:
    groupes: dict[object, list[dict]] = defaultdict(list)
    for index, (texte, age_jours, agency_slot) in enumerate(DEMO_ROWS, start=1):
        external_id = f"{ID_PREFIX}{index:04d}"
        agence_id = None
        if agency_slot is not None and agences:
            agence_id = agences[agency_slot % len(agences)].id
        date_publication = now - timedelta(days=age_jours, hours=(index * 3) % 24)
        groupes[agence_id].append({
            "source": "facebook",
            "source_id": external_id,
            "type_contenu": "commentaire",
            "text": texte,
            "date_publication": date_publication,
            # Mentions fictives : aucune publication réelle derrière, donc aucun lien source.
            "url_source": None,
        })
    return groupes


def main() -> int:
    db = SessionLocal()
    try:
        organisations = db.query(Organisation).filter(Organisation.nom == ORG_NAME).all()
        if len(organisations) != 1:
            raise RuntimeError(
                f"Référence non sûre : {len(organisations)} organisations nommées {ORG_NAME!r} trouvées ; aucune donnée insérée."
            )
        organisation = organisations[0]
        agences = (
            db.query(Agence)
            .filter(Agence.organisation_id == organisation.id, Agence.active.is_(True))
            .order_by(Agence.nom.asc())
            .all()
        )

        resume = Counter()
        now = datetime.now(timezone.utc)
        for agence_id, items in construire_items(now, agences).items():
            resultat = ingest_mentions(items, organisation.id, agence_id, db)
            resume.update(resultat)

        seed_mentions = (
            db.query(MentionVeille)
            .filter(
                MentionVeille.organisation_id == organisation.id,
                MentionVeille.external_id.like(f"{ID_PREFIX}%"),
            )
            .all()
        )
        sentiments = Counter(mention.sentiment.value for mention in seed_mentions)
        themes = Counter(mention.theme_principal or "Non classé" for mention in seed_mentions)

        print(f"Organisation : {ORG_NAME}")
        print(f"Agences actives disponibles : {len(agences)}")
        print(f"Créées lors de cette exécution : {resume['ingested_count']}")
        print(f"Doublons ignorés : {resume['duplicate_count']}")
        print(f"Total de mentions démo : {len(seed_mentions)}")
        print("Sentiments : " + ", ".join(f"{key}={sentiments.get(key, 0)}" for key in ("positif", "negatif", "neutre")))
        print("Thèmes : " + ", ".join(f"{key}={value}" for key, value in sorted(themes.items())))
        print(f"Non classé : {themes.get('Non classé', 0)}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
