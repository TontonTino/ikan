/**
 * Lien « click-to-chat » WhatsApp (wa.me). IKAN AI n'envoie rien : le lien ouvre WhatsApp
 * avec le message prérempli et c'est l'Agency Manager qui appuie sur « Envoyer ».
 *
 * Le numéro reçu ici est DÉJÀ normalisé par l'API (`telephone_whatsapp`, ex. « 22670123456 »,
 * règle dans apps/api/app/utils/phone.py) : on ne le re-devine pas, on vérifie seulement
 * qu'il a la forme attendue par wa.me (chiffres uniquement, 8 à 15 — E.164).
 */
const NUMERO_WHATSAPP = /^\d{8,15}$/;

export function estNumeroWhatsAppValide(numero: string | null | undefined): numero is string {
  return typeof numero === 'string' && NUMERO_WHATSAPP.test(numero);
}

/** URL wa.me, ou null si le numéro est invalide ou le message vide. */
export function construireLienWhatsApp(
  numero: string | null | undefined,
  message: string,
): string | null {
  const texte = message.trim();
  if (!estNumeroWhatsAppValide(numero) || !texte) return null;
  return `https://wa.me/${numero}?text=${encodeURIComponent(texte)}`;
}
