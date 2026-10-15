import qrcode from 'qrcode-generator';
import { getFeedbackUrl } from '../config';

/*
 * QR code de l'agence, généré dans le navigateur : AUCUN appel réseau (plus de service externe), aucune donnée autre que l'URL.
 *
 *  - Donnée encodée : strictement l'URL du formulaire client, `getFeedbackUrl(code)` — la même chaîne qu'avant, un QR déjà imprimé
 *    et collé en agence continue donc de fonctionner (l'image change, pas son contenu).
 *  - Correction d'erreur H (jusqu'à ~30 % de modules illisibles), marge blanche de 4 modules (minimum de la norme), noir sur blanc.
 *  - Rendu vectoriel (SVG / PDF) ou image à haute résolution (PNG) : net à toute taille d'impression.
 */

export const QR_NIVEAU_CORRECTION = 'H' as const;
export const QR_MARGE_MODULES = 4;
export const QR_COULEUR_SOMBRE = '#000000';
export const QR_COULEUR_CLAIRE = '#FFFFFF';

export type MatriceQr = boolean[][];

/** Lien du formulaire client d'une agence : le code du QR actif, à défaut l'identifiant de l'agence (lien historique, toujours accepté). */
export function lienFeedbackAgence(agence: { id: string; qr_code_token?: string | null }): string {
  return getFeedbackUrl(agence.qr_code_token || agence.id);
}

/** Modules du QR (true = sombre), SANS marge. Seule `url` est encodée. */
export function creerMatriceQr(url: string): MatriceQr {
  const qr = qrcode(0, QR_NIVEAU_CORRECTION); // 0 = plus petite version qui contient l'URL au niveau H
  qr.addData(url, 'Byte');
  qr.make();
  const taille = qr.getModuleCount();
  return Array.from({ length: taille }, (_, ligne) => Array.from({ length: taille }, (_, colonne) => qr.isDark(ligne, colonne)));
}

/** Côté, en modules, du QR avec ses marges blanches. */
export const tailleAvecMarge = (matrice: MatriceQr, marge = QR_MARGE_MODULES) => matrice.length + 2 * marge;

/** Tracé SVG (un rectangle 1×1 par module sombre, décalé de la marge) et côté total du dessin, marges comprises. */
export function cheminSvgQr(matrice: MatriceQr, marge = QR_MARGE_MODULES): { chemin: string; cote: number } {
  const morceaux: string[] = [];
  matrice.forEach((ligne, y) => {
    let x = 0;
    while (x < ligne.length) {
      if (!ligne[x]) { x += 1; continue; }
      let fin = x;
      while (fin < ligne.length && ligne[fin]) fin += 1; // suite de modules sombres : un seul rectangle
      morceaux.push(`M${x + marge} ${y + marge}h${fin - x}v1h${x - fin}z`);
      x = fin;
    }
  });
  return { chemin: morceaux.join(''), cote: tailleAvecMarge(matrice, marge) };
}

/** Pixels RGBA (noir sur blanc, marge comprise) pour un rendu en image ou pour la vérification de lecture. */
export function pixelsQr(matrice: MatriceQr, pixelsParModule: number, marge = QR_MARGE_MODULES): { data: Uint8ClampedArray; largeur: number } {
  const largeur = tailleAvecMarge(matrice, marge) * pixelsParModule;
  const data = new Uint8ClampedArray(largeur * largeur * 4).fill(255);
  matrice.forEach((ligne, y) => ligne.forEach((sombre, x) => {
    if (!sombre) return;
    for (let py = 0; py < pixelsParModule; py += 1) {
      for (let px = 0; px < pixelsParModule; px += 1) {
        const i = ((((y + marge) * pixelsParModule + py) * largeur) + (x + marge) * pixelsParModule + px) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
    }
  }));
  return { data, largeur };
}

/** Image PNG à haute résolution (≥ 1000 px de côté) du QR, dessinée localement dans un canvas. */
export function pngQr(url: string, cotePxMin = 1000): Promise<Blob> {
  const matrice = creerMatriceQr(url);
  const pixelsParModule = Math.max(1, Math.ceil(cotePxMin / tailleAvecMarge(matrice)));
  const cote = tailleAvecMarge(matrice) * pixelsParModule;
  const canvas = document.createElement('canvas');
  canvas.width = cote;
  canvas.height = cote;
  const contexte = canvas.getContext('2d');
  if (!contexte) return Promise.reject(new Error('Canvas indisponible'));
  contexte.fillStyle = QR_COULEUR_CLAIRE;
  contexte.fillRect(0, 0, cote, cote);
  contexte.fillStyle = QR_COULEUR_SOMBRE;
  matrice.forEach((ligne, y) => ligne.forEach((sombre, x) => {
    if (sombre) contexte.fillRect((x + QR_MARGE_MODULES) * pixelsParModule, (y + QR_MARGE_MODULES) * pixelsParModule, pixelsParModule, pixelsParModule);
  }));
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Export PNG impossible'))), 'image/png'));
}

/** Interface minimale de jsPDF utilisée pour dessiner le QR en vectoriel (testable sans jsPDF). */
export interface DessinPdf {
  setFillColor(r: number, g: number, b: number): void;
  rect(x: number, y: number, w: number, h: number, style: string): void;
}

/** Dessine le QR (marge blanche comprise) en vectoriel dans un PDF : `coteMm` = côté total en millimètres. */
export function dessinerQrPdf(doc: DessinPdf, matrice: MatriceQr, x: number, y: number, coteMm: number): void {
  const cote = coteMm / tailleAvecMarge(matrice);
  doc.setFillColor(255, 255, 255);
  doc.rect(x, y, coteMm, coteMm, 'F');
  doc.setFillColor(0, 0, 0);
  matrice.forEach((ligne, ligneIndex) => {
    let colonne = 0;
    while (colonne < ligne.length) {
      if (!ligne[colonne]) { colonne += 1; continue; }
      let fin = colonne;
      while (fin < ligne.length && ligne[fin]) fin += 1;
      doc.rect(x + (colonne + QR_MARGE_MODULES) * cote, y + (ligneIndex + QR_MARGE_MODULES) * cote, (fin - colonne) * cote, cote, 'F');
      colonne = fin;
    }
  });
}
