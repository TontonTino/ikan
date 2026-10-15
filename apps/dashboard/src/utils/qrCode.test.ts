import jsQR from 'jsqr';
import qrcode from 'qrcode-generator';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_URL, getFeedbackUrl } from '../config';
import {
  QR_MARGE_MODULES, QR_NIVEAU_CORRECTION, cheminSvgQr, creerMatriceQr, dessinerQrPdf, lienFeedbackAgence, pixelsQr, tailleAvecMarge,
  type DessinPdf, type MatriceQr,
} from './qrCode';

const URL_AGENCE = 'https://ikan-1.onrender.com/feedback/QR-AGENCE-AB12CD';

/** Lit le QR comme un téléphone : pixels noir/blanc -> texte décodé. */
function decoder(matrice: MatriceQr, pixelsParModule = 6): string | null {
  const { data, largeur } = pixelsQr(matrice, pixelsParModule);
  return jsQR(data, largeur, largeur)?.data ?? null;
}

const modulesSombres = (m: MatriceQr) => m.flat().filter(Boolean).length;

afterEach(() => vi.unstubAllGlobals());

describe('l’URL encodée est celle d’avant', () => {
  it('lienFeedbackAgence = getFeedbackUrl(code du QR) — même chaîne que l’ancien code des deux écrans', () => {
    const agence = { id: 'b3a1f0d2-0000-4000-8000-000000000001', qr_code_token: 'QR-AGENCE-AB12CD' };
    expect(lienFeedbackAgence(agence)).toBe(getFeedbackUrl('QR-AGENCE-AB12CD'));
    expect(lienFeedbackAgence(agence)).toBe(`${CLIENT_URL}/feedback/QR-AGENCE-AB12CD`);
  });

  it('agence sans QR actif (pas de code) : repli sur l’identifiant de l’agence, comme avant', () => {
    const agence = { id: 'b3a1f0d2-0000-4000-8000-000000000001', qr_code_token: null };
    expect(lienFeedbackAgence(agence)).toBe(`${CLIENT_URL}/feedback/b3a1f0d2-0000-4000-8000-000000000001`);
    expect(lienFeedbackAgence({ id: 'x' })).toBe(`${CLIENT_URL}/feedback/x`);
  });

  it('le QR généré se décode vers exactement cette URL (rien d’autre dans le QR)', () => {
    for (const url of [URL_AGENCE, `${CLIENT_URL}/feedback/QR-AGENCE-AB12CD`, 'http://192.168.1.20:4321/feedback/QR-X-000001',
      `${CLIENT_URL}/feedback/b3a1f0d2-0000-4000-8000-000000000001`, `${CLIENT_URL}/feedback/${'A'.repeat(100)}`]) {
      expect(decoder(creerMatriceQr(url))).toBe(url);
    }
  });

  it('la matrice ne dépend que de l’URL : mêmes données, mêmes modules ; données différentes, modules différents', () => {
    expect(creerMatriceQr(URL_AGENCE)).toEqual(creerMatriceQr(URL_AGENCE));
    expect(creerMatriceQr(URL_AGENCE)).not.toEqual(creerMatriceQr(`${URL_AGENCE}X`));
  });
});

describe('qualité pour l’impression', () => {
  it('correction d’erreur H : un QR abîmé au centre se lit encore, alors qu’au niveau L le même dommage le rend illisible', () => {
    expect(QR_NIVEAU_CORRECTION).toBe('H');
    const abimer = (m: MatriceQr) => {
      const n = m.length;
      const cote = Math.round(n * 0.4);
      const debut = Math.floor((n - cote) / 2);
      return m.map((ligne, y) => ligne.map((v, x) => (y >= debut && y < debut + cote && x >= debut && x < debut + cote ? false : v)));
    };
    expect(decoder(abimer(creerMatriceQr(URL_AGENCE)))).toBe(URL_AGENCE);
    const niveauL = qrcode(0, 'L');
    niveauL.addData(URL_AGENCE, 'Byte');
    niveauL.make();
    const matriceL = Array.from({ length: niveauL.getModuleCount() }, (_, y) => Array.from({ length: niveauL.getModuleCount() }, (_, x) => niveauL.isDark(y, x)));
    expect(decoder(abimer(matriceL))).not.toBe(URL_AGENCE); // le témoin est bien sensible : sans correction forte, la lecture échoue
  });

  it('marge blanche d’au moins 4 modules, en pixels comme en SVG', () => {
    expect(QR_MARGE_MODULES).toBeGreaterThanOrEqual(4);
    const matrice = creerMatriceQr(URL_AGENCE);
    const n = matrice.length;
    const ppm = 5;
    const { data, largeur } = pixelsQr(matrice, ppm);
    expect(largeur).toBe((n + 2 * QR_MARGE_MODULES) * ppm);
    const sombre = (x: number, y: number) => data[(y * largeur + x) * 4] === 0;
    const marge = QR_MARGE_MODULES * ppm;
    for (let y = 0; y < largeur; y += 1) {
      for (let x = 0; x < largeur; x += 1) {
        if (x < marge || y < marge || x >= largeur - marge || y >= largeur - marge) expect(sombre(x, y)).toBe(false);
      }
    }
    const { chemin, cote } = cheminSvgQr(matrice);
    expect(cote).toBe(tailleAvecMarge(matrice));
    const abscisses = [...chemin.matchAll(/M(\d+) (\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(Math.min(...abscisses.map((a) => a[0]))).toBeGreaterThanOrEqual(QR_MARGE_MODULES);
    expect(Math.min(...abscisses.map((a) => a[1]))).toBeGreaterThanOrEqual(QR_MARGE_MODULES);
    expect(Math.max(...abscisses.map((a) => a[0]))).toBeLessThan(cote - QR_MARGE_MODULES);
  });

  it('noir pur sur blanc pur, sans niveau de gris', () => {
    const { data } = pixelsQr(creerMatriceQr(URL_AGENCE), 3);
    for (let i = 0; i < data.length; i += 4) {
      const noir = data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 255;
      const blanc = data[i] === 255 && data[i + 1] === 255 && data[i + 2] === 255 && data[i + 3] === 255;
      expect(noir || blanc).toBe(true);
    }
  });

  it('le tracé SVG recouvre exactement les modules sombres, sans autre donnée (que des commandes de tracé)', () => {
    const matrice = creerMatriceQr(URL_AGENCE);
    const { chemin } = cheminSvgQr(matrice);
    expect(chemin).toMatch(/^[Mhvz0-9 -]+$/);
    const largeurs = [...chemin.matchAll(/h(\d+)v1/g)].map((m) => Number(m[1]));
    expect(largeurs.reduce((a, b) => a + b, 0)).toBe(modulesSombres(matrice));
  });

  it('dessin vectoriel du PDF : fond blanc marge comprise, puis un rectangle noir par suite de modules sombres', () => {
    const matrice = creerMatriceQr(URL_AGENCE);
    const appels: Array<{ type: string; args: unknown[] }> = [];
    const doc: DessinPdf = {
      setFillColor: (...args) => appels.push({ type: 'couleur', args }),
      rect: (...args) => appels.push({ type: 'rect', args }),
    };
    dessinerQrPdf(doc, matrice, 10, 20, 66);
    const rects = appels.filter((a) => a.type === 'rect').map((a) => a.args as [number, number, number, number, string]);
    expect(rects[0]).toEqual([10, 20, 66, 66, 'F']);
    const module = 66 / tailleAvecMarge(matrice);
    const surface = rects.slice(1).reduce((s, r) => s + r[2] / module, 0);
    expect(Math.round(surface)).toBe(modulesSombres(matrice));
    for (const [x, y, w] of rects.slice(1)) {
      expect(x).toBeGreaterThanOrEqual(10 + QR_MARGE_MODULES * module - 1e-9);
      expect(x + w).toBeLessThanOrEqual(10 + 66 - QR_MARGE_MODULES * module + 1e-9);
      expect(y).toBeGreaterThanOrEqual(20 + QR_MARGE_MODULES * module - 1e-9);
    }
    expect(appels.find((a) => a.type === 'couleur')?.args).toEqual([255, 255, 255]);
  });
});

describe('aucun appel réseau', () => {
  it('générer la matrice, le SVG, les pixels et le dessin PDF n’appelle ni fetch ni XMLHttpRequest ni Image', () => {
    const fetchEspion = vi.fn(() => { throw new Error('appel réseau interdit'); });
    const xhrEspion = vi.fn(() => { throw new Error('appel réseau interdit'); });
    const imageEspion = vi.fn(() => { throw new Error('appel réseau interdit'); });
    vi.stubGlobal('fetch', fetchEspion);
    vi.stubGlobal('XMLHttpRequest', xhrEspion);
    vi.stubGlobal('Image', imageEspion);
    const matrice = creerMatriceQr(URL_AGENCE);
    cheminSvgQr(matrice);
    pixelsQr(matrice, 2);
    dessinerQrPdf({ setFillColor: () => undefined, rect: () => undefined }, matrice, 0, 0, 60);
    expect(fetchEspion).not.toHaveBeenCalled();
    expect(xhrEspion).not.toHaveBeenCalled();
    expect(imageEspion).not.toHaveBeenCalled();
  });

  // Sources du dashboard lues telles quelles (hors tests) : la garantie « plus d'appel externe » porte sur le code réel.
  const SOURCES = import.meta.glob(['/src/**/*.{ts,tsx,css}', '!/src/**/*.test.*'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

  it('plus aucune référence à un service de QR externe dans le code du dashboard', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50);
    for (const [fichier, texte] of Object.entries(SOURCES)) expect(texte, fichier).not.toMatch(/qrserver|create-qr-code/i);
  });

  it('les modules de génération n’ont aucun accès réseau (ni fetch, ni XMLHttpRequest, ni URL externe codée en dur)', () => {
    const fichiers = Object.entries(SOURCES).filter(([chemin]) => chemin === '/src/utils/qrCode.ts' || chemin.startsWith('/src/components/qr/'));
    expect(fichiers.length).toBeGreaterThanOrEqual(3);
    for (const [fichier, texte] of fichiers) {
      expect(texte, fichier).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|axios|sendBeacon|new Image\b|window\.open/);
      expect(texte.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, ''), fichier).not.toMatch(/https?:\/\//);
    }
  });

  it('l’écran de l’agence ne télécharge plus le QR : plus de fetch d’image', () => {
    const texte = SOURCES['/src/pages/agency/MonAgencePage.tsx'];
    expect(texte).toBeTruthy();
    expect(texte).not.toMatch(/imageUrlEnDataUrl|qrImageUrl|window\.open\(source/);
  });
});

describe('getFeedbackUrl reste la seule source du domaine', () => {
  it('le domaine vient de VITE_CLIENT_URL, avec la valeur par défaut historique', () => {
    expect(getFeedbackUrl('QR-X')).toBe(`${CLIENT_URL}/feedback/QR-X`);
    expect(CLIENT_URL).toMatch(/^https?:\/\//);
  });
});
