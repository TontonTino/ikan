"""
Génération de recommandations d'action pour l'Agency Manager (BF-17).
Approche basée sur des templates par thème et criticité pour les 15 catégories IKAN AI.
"""
from app.models.enums import CriticiteType, PriorityLevel

# Templates de recommandations par thème et criticité
RECOMMANDATIONS_TEMPLATES: dict[str, dict[str, str]] = {
    "attente": {
        "elevee": (
            "Optimisez la gestion des files d'attente. "
            "Analysez les pics d'affluence pour adapter les effectifs aux guichets. "
            "Envisagez un système de prise de rendez-vous ou de tickets prioritaires."
        ),
        "critique": (
            "URGENT — Les temps d'attente sont signalés comme inacceptables. "
            "Revoyez immédiatement l'organisation des guichets et renforcez les effectifs aux heures de pointe. "
            "Communiquez les délais estimés aux clients en attente."
        ),
    },
    "accueil": {
        "elevee": (
            "Revoir la formation à l'accueil client de l'équipe. "
            "Plusieurs retours indiquent un manque de courtoisie ou de disponibilité. "
            "Organisez un briefing d'équipe sur les standards de qualité d'accueil."
        ),
        "critique": (
            "URGENT — Des retours très négatifs signalent des problèmes graves de comportement ou d'accueil. "
            "Contactez immédiatement le responsable d'équipe et identifiez les agents concernés. "
            "Mettez en place un suivi individuel renforcé et un plan d'amélioration immédiat."
        ),
    },
    "disponibilite_accessibilite": {
        "elevee": (
            "Vérifiez l'accessibilité de l'agence et la clarté des horaires d'ouverture. "
            "Assurez-vous que les accès PMR et le stationnement sont fonctionnels et bien indiqués."
        ),
        "critique": (
            "URGENT — Blocage ou fermeture inopinée signalée par les clients. "
            "Vérifiez la signalétique d'accès, respectez scrupuleusement les horaires et informez la clientèle en amont."
        ),
    },
    "tarifs": {
        "elevee": (
            "Les clients expriment une incompréhension ou une insatisfaction sur la grille tarifaire. "
            "Formez les conseillers à expliquer clairement les frais et à proposer les formules adaptées."
        ),
        "critique": (
            "URGENT — Sentiment d'injustice tarifaire ou frais jugés abusifs. "
            "Prenez contact avec le client pour un geste commercial ou un audit du compte concerné."
        ),
    },
    "qualite_produit": {
        "elevee": (
            "Des dysfonctionnements ou limites sur les produits et offres ont été signalés. "
            "Remontez les anomalies récurrentes au chef de produit pour fiabiliser l'offre."
        ),
        "critique": (
            "URGENT — Défaillance majeure d'un produit (carte, box, forfait). "
            "Procédez immédiatement au remplacement du matériel défectueux et informez le support technique."
        ),
    },
    "proprete_cadre": {
        "elevee": (
            "Des problèmes de propreté, de température ou de confort de l'agence ont été rapportés. "
            "Planifiez un contrôle avec l'équipe d'entretien et vérifiez le fonctionnement de la climatisation/chauffage."
        ),
        "critique": (
            "URGENT — L'état des locaux ou du matériel d'accueil est jugé inacceptable par les clients. "
            "Faites intervenir immédiatement le service de nettoyage et d'intervention technique."
        ),
    },
    "application_mobile": {
        "elevee": (
            "Des bugs ou lenteurs sur l'application mobile ont été signalés. "
            "Guidez le client vers les bonnes pratiques (mise à jour) et transmettez un log d'erreur à l'équipe Mobile."
        ),
        "critique": (
            "URGENT — Blocage complet des opérations sur l'application mobile. "
            "Escaladez en priorité auprès de l'équipe technique et assurez une prise en charge manuelle en agence."
        ),
    },
    "reseau": {
        "elevee": (
            "Instabilité ou lenteur de connexion réseau signalée dans la zone de l'agence. "
            "Vérifiez l'état des infrastructures réseau et signalez l'incident aux équipes télécoms."
        ),
        "critique": (
            "URGENT — Coupure totale de réseau/connexion empêchant le service. "
            "Ouvrez un ticket d'incident prioritaire auprès des équipes d'exploitation réseau."
        ),
    },
    "facturation": {
        "elevee": (
            "Contestation ou incompréhension sur une facture ou un prélèvement. "
            "Éditez un duplicata explicatif et vérifiez l'exactitude des options facturées."
        ),
        "critique": (
            "URGENT — Erreur de facturation ou double prélèvement grave. "
            "Régularisez immédiatement le dossier financier du client et émettez un avoir si nécessaire."
        ),
    },
    "communication_information": {
        "elevee": (
            "Améliorez la clarté de l'information communiquée aux clients. "
            "Assurez-vous que les démarches, délais et conditions soient clairement affichés et expliqués."
        ),
        "critique": (
            "URGENT — Manque d'information critique ayant induit les clients en erreur. "
            "Rectifiez immédiatement les supports de communication et formez les conseillers."
        ),
    },
    "livraison_logistique": {
        "elevee": (
            "Retard ou manque de visibilité sur l'expédition d'un colis ou d'un équipement. "
            "Consultez le statut de livraison transporteur et tenez le client informé par SMS/email."
        ),
        "critique": (
            "URGENT — Colis perdu ou retard de livraison bloquant pour le client. "
            "Déclenchez une expédition express de remplacement sans frais."
        ),
    },
    "resolution_probleme": {
        "elevee": (
            "Le traitement de la réclamation client tarde à aboutir. "
            "Reprenez le dossier avec le conseiller en charge pour apporter une réponse sous 24 heures."
        ),
        "critique": (
            "URGENT — Réclamation bloquée ou sentiment d'abandon du client. "
            "Appelez directement le client et assignez un référent unique pour clore le litige."
        ),
    },
    "securite_confidentialite": {
        "elevee": (
            "Inquiétude exprimée quant à la sécurité des transactions ou la confidentialité des données. "
            "Rappelez les consignes de sécurité et vérifiez les procédures d'authentification en agence."
        ),
        "critique": (
            "URGENT — Suspicion de fraude, piratage ou faille de confidentialité. "
            "Bloquez immédiatement les accès compromis et alertez le responsable sécurité/DPO."
        ),
    },
    "disponibilite_produit": {
        "elevee": (
            "Rupture temporaire de stock sur un produit ou accessoire demandé. "
            "Passez commande de réapprovisionnement et proposez une réservation prioritaire au client."
        ),
        "critique": (
            "URGENT — Rupture de matériel essentiel à l'activité de l'agence. "
            "Sollicitez un transfert de stock d'urgence depuis une agence voisine ou le dépôt central."
        ),
    },
    "personnalisation_besoin": {
        "elevee": (
            "Le client a estimé que son besoin n'a pas été suffisamment écouté ou personnalisé. "
            "Encouragez les conseillers à pratiquer la découverte active des besoins avant toute proposition."
        ),
        "critique": (
            "URGENT — Sentiment d'offre inadaptée ou de vente forcée. "
            "Contactez le client pour réévaluer son dossier et réajuster les services à ses attentes réelles."
        ),
    },
    # Alias / Compatibilité
    "digital": {
        "elevee": (
            "Des problèmes ont été signalés sur les outils digitaux. "
            "Vérifiez le fonctionnement des automates, du réseau Wi-Fi et de l'application mobile. "
            "Transmettez un rapport technique à l'équipe IT."
        ),
        "critique": (
            "URGENT — Des pannes ou dysfonctionnements digitaux répétés sont rapportés. "
            "Escaladez immédiatement au service IT et informez les clients des délais de résolution."
        ),
    },
    "infrastructure": {
        "elevee": (
            "Des problèmes d'infrastructure ont été signalés (propreté, confort, accessibilité). "
            "Effectuez un audit rapide des locaux et planifiez les interventions nécessaires."
        ),
        "critique": (
            "URGENT — L'état des locaux est jugé inacceptable par plusieurs clients. "
            "Intervenez immédiatement sur les problèmes de propreté ou de sécurité signalés."
        ),
    },
    "autre": {
        "elevee": (
            "Un retour négatif a été reçu sans thème précis identifié. "
            "Relisez le commentaire et prenez les mesures appropriées selon le contexte."
        ),
        "critique": (
            "URGENT — Un retour très négatif nécessite votre attention immédiate. "
            "Analysez le commentaire et contactez si possible le client pour comprendre et résoudre le problème."
        ),
    },
}

# Recommandation générique pour la discordance
RECOMMANDATION_DISCORDANCE = (
    "Discordance détectée : le client a attribué une note favorable mais son commentaire révèle une insatisfaction. "
    "Ce signal qualité mérite une attention particulière. "
    "Analysez le commentaire pour identifier le problème sous-jacent et prenez les mesures correctives."
)


def generer_recommandations(
    theme: str,
    criticite: CriticiteType,
    discordance: bool,
) -> list[tuple[str, PriorityLevel]]:
    """
    Génère une liste de recommandations basée sur le thème et la criticité.

    Returns:
        Liste de tuples (contenu_recommandation, priorite)
    """
    recommandations = []

    # Ne générer des recommandations que pour criticité ELEVEE ou CRITIQUE (BF-17)
    if criticite in (CriticiteType.ELEVEE, CriticiteType.CRITIQUE):
        niveau = "critique" if criticite == CriticiteType.CRITIQUE else "elevee"
        priorite = PriorityLevel.CRITICAL if criticite == CriticiteType.CRITIQUE else PriorityLevel.HIGH

        theme_key = theme if theme in RECOMMANDATIONS_TEMPLATES else "autre"
        contenu = RECOMMANDATIONS_TEMPLATES[theme_key][niveau]
        recommandations.append((contenu, priorite))

    # Recommandation supplémentaire pour les discordances
    if discordance:
        recommandations.append((RECOMMANDATION_DISCORDANCE, PriorityLevel.MEDIUM))

    return recommandations
