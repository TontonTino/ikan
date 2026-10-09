import { describe, expect, it } from 'vitest';
import { construireLienWhatsApp, estNumeroWhatsAppValide } from './whatsapp';

const NUMERO = '22670123456';

describe('estNumeroWhatsAppValide', () => {
  it('accepte un numéro international normalisé', () => {
    expect(estNumeroWhatsAppValide(NUMERO)).toBe(true);
  });
  it.each([null, undefined, '', '7012345', '+22670123456', '226 70123456', '22670abc456', '1234567890123456'])(
    'refuse %s',
    (valeur) => {
      expect(estNumeroWhatsAppValide(valeur as string | null | undefined)).toBe(false);
    },
  );
});

describe('construireLienWhatsApp', () => {
  const texte = (lien: string | null) => decodeURIComponent((lien as string).split('?text=')[1]);

  it('construit https://wa.me/<numero>?text=<message>', () => {
    expect(construireLienWhatsApp(NUMERO, 'Bonjour')).toBe(`https://wa.me/${NUMERO}?text=Bonjour`);
  });

  it('encode les accents, apostrophes, retours à la ligne, & et #', () => {
    const message = "Bonjour M. Traoré,\nvotre dossier n°5 & #12 est réglé. Merci d'avoir patienté !";
    const lien = construireLienWhatsApp(NUMERO, message) as string;
    const query = lien.split('?text=')[1];
    expect(query).not.toMatch(/[\s&#]/); // rien de brut ne peut casser l'URL
    expect(query).toContain("d'avoir"); // l'apostrophe est légale dans une URL
    expect(query).toContain('%0A');
    expect(query).toContain('%26');
    expect(query).toContain('%23');
    expect(query).toContain('%C3%A9'); // é
    expect(texte(lien)).toBe(message);
  });

  it('encode les emojis', () => {
    const message = 'Merci pour votre patience 🙏😊';
    const lien = construireLienWhatsApp(NUMERO, message);
    expect(lien).toContain('%F0%9F%99%8F');
    expect(texte(lien)).toBe(message);
  });

  it('retire les espaces autour du message', () => {
    expect(construireLienWhatsApp(NUMERO, '  Salut  \n')).toBe(`https://wa.me/${NUMERO}?text=Salut`);
  });

  it('retourne null sans numéro valide ou sans message', () => {
    expect(construireLienWhatsApp(null, 'Bonjour')).toBeNull();
    expect(construireLienWhatsApp('7012', 'Bonjour')).toBeNull();
    expect(construireLienWhatsApp(NUMERO, '   ')).toBeNull();
  });
});
