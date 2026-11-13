/**
 * Adresse de l'équipe IKAN AI : aide, mise à niveau, mot de passe oublié d'un responsable expérience client.
 * Une seule constante, lue par le menu utilisateur et la page de connexion.
 */
export const SUPPORT_EMAIL = 'support@ikanai.app';

/** Lien « mailto: » vers le support, avec un objet prérempli. */
export const mailtoSupport = (objet: string): string => `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(objet)}`;
