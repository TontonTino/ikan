import { FAIBLE_VOLUME_POINT, satisfactionTexte } from '../../pages/cx/siege/siegeData';

/**
 * Bande de synthèse de YAM sur la Vue réseau : fonction PURE, qui n'utilise QUE des données déjà chargées par la page.
 * Règles : une donnée absente (null) fait OMETTRE la phrase correspondante (jamais de 0 par défaut), aucune cause ni tendance n'est inventée,
 * le seuil « faible volume » est celui du graphique (FAIBLE_VOLUME_POINT, pas de second seuil).
 */
export interface EntreesSynthese {
  /** Période choisie sur la page (7, 30, 90 ou 365 jours). */
  jours: number;
  /** Nombre d'avis de la période ; null = inconnu. */
  nbAvis: number | null;
  /** Satisfaction en % ; null = inconnue. */
  satisfaction: number | null;
  /** Noms des agences actuellement sous leur seuil ; null = information indisponible (forfait sans alertes, erreur). */
  agencesSousSeuil: string[] | null;
  /** Avis critiques par agence (classement déjà chargé) ; null = indisponible. */
  agencesCritiques: { nom: string; critiques: number }[] | null;
}

export interface Synthese {
  /** « 30 derniers jours », « 12 derniers mois » : titre de la bande. */
  periode: string;
  /** Message ; chaîne vide si la donnée de base (nombre d'avis) est inconnue : la bande ne s'affiche alors pas. */
  message: string;
  /** Question à préremplir dans le panneau YAM (jamais envoyée automatiquement). */
  question: string;
}

const NBSP = ' ';
export const periodeCourte = (jours: number) => (jours === 365 ? '12 derniers mois' : `${jours} derniers jours`);
const nombre = (n: number) => n.toLocaleString('fr-FR');
const avisTexte = (n: number) => `${nombre(n)} avis`;

export const QUESTION_PAR_DEFAUT = 'Quelle agence rencontre le plus de difficultés ?';

function questionPourquoi(agencesSousSeuil: string[] | null): string {
  if (agencesSousSeuil?.length === 1) return `Pourquoi ${agencesSousSeuil[0]} est sous son seuil ?`;
  if (agencesSousSeuil && agencesSousSeuil.length > 1) return 'Pourquoi certaines agences sont sous leur seuil ?';
  return QUESTION_PAR_DEFAUT;
}

export function construireSynthese(e: EntreesSynthese): Synthese {
  const periode = periodeCourte(e.jours);
  const sur = e.jours === 365 ? 'les 12 derniers mois' : `les ${e.jours} derniers jours`;
  const question = questionPourquoi(e.agencesSousSeuil);
  const nb = e.nbAvis;

  if (nb == null || !Number.isFinite(nb)) return { periode, message: '', question };
  if (nb === 0) {
    return { periode, question, message: `Aucun avis reçu sur ${sur}. Dès que vos clients scanneront un QR code, je vous résumerai la situation ici.` };
  }
  if (nb < FAIBLE_VOLUME_POINT) {
    return { periode, question, message: `Seulement ${avisTexte(nb)} sur ${sur} : trop peu pour tirer une conclusion fiable.` };
  }

  const phrases: string[] = [];
  const sat = e.satisfaction != null && Number.isFinite(e.satisfaction) ? satisfactionTexte(e.satisfaction, nb).replace(' %', `${NBSP}%`) : null;
  phrases.push(sat ? `Sur ${sur}, ${avisTexte(nb)} et ${sat} de satisfaction.` : `Sur ${sur}, ${avisTexte(nb)}.`);

  if (e.agencesSousSeuil) {
    const k = e.agencesSousSeuil.length;
    phrases.push(k === 0 ? 'Aucune agence sous son seuil.' : k === 1 ? '1 agence sous son seuil.' : `${nombre(k)} agences sous leur seuil.`);
  }

  if (e.agencesCritiques) {
    const max = Math.max(0, ...e.agencesCritiques.map((a) => a.critiques));
    const tete = e.agencesCritiques.filter((a) => a.critiques === max);
    if (max > 0 && tete.length === 1) phrases.push(`${tete[0].nom} concentre le plus d'avis critiques (${nombre(max)}).`);
  }
  return { periode, message: phrases.join(' '), question };
}
