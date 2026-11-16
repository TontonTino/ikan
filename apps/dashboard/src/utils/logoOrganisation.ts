import orange from '../assets/org-logos/orange.png';

/** Logos officiels embarqués dans l'application : ils partent avec le bundle, quel que soit l'hébergeur. */
const LOGOS_EMBARQUES: { chemin: string; nom: RegExp; src: string }[] = [
  { chemin: '/org-logos/orange.png', nom: /^orange\b/i, src: orange },
];

export interface LogoOrganisation {
  src: string;
  /** Logo officiel embarqué : il remplit toute la vignette (pas de marge blanche autour). */
  officiel: boolean;
}

/**
 * Le logo à afficher pour une organisation.
 *  1. Un logo configuré (URL) est toujours respecté ; le chemin local d'un logo officiel pointe vers sa version embarquée.
 *  2. Sans logo configuré, une organisation dont le nom commence par une marque connue (« Orange … ») reçoit son logo officiel.
 *  3. Sinon : null, et l'appelant affiche les initiales.
 */
export function logoOrganisation(logo: string | null | undefined, nom: string | null | undefined): LogoOrganisation | null {
  const configure = logo?.trim();
  if (configure) {
    const embarque = LOGOS_EMBARQUES.find((l) => l.chemin === configure);
    return embarque ? { src: embarque.src, officiel: true } : { src: configure, officiel: false };
  }
  const connu = LOGOS_EMBARQUES.find((l) => l.nom.test((nom ?? '').trim()));
  return connu ? { src: connu.src, officiel: true } : null;
}
