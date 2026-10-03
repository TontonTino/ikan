export const extraitCommentaire = (texte?: string, max = 140) => {
    if (!texte) return 'Aucun commentaire.';
    return texte.length > max ? `${texte.slice(0, max)}…` : texte;
  };

export const formatDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : null);

  // Badge combiné : total des éléments nécessitant une action dans cet onglet
  // fusionné (alertes actives + recommandations en attente), plus lisible
  // qu'un seul des deux compteurs isolément puisque le contenu des deux est
  // désormais présenté ensemble.
