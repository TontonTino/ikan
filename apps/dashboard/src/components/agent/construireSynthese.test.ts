import { describe, expect, it } from 'vitest';
import { FAIBLE_VOLUME_POINT } from '../../pages/cx/siege/siegeData';
import { construireSynthese, QUESTION_PAR_DEFAUT, type EntreesSynthese } from './construireSynthese';

const base: EntreesSynthese = { jours: 30, nbAvis: 45, satisfaction: 87.5, agencesSousSeuil: [], agencesCritiques: [] };
const NBSP = ' ';

const MOTS_INTERDITS = ['undefined', 'NaN', 'null', 'Infinity'];
const propre = (texte: string) => MOTS_INTERDITS.every((m) => !texte.includes(m));

describe('construireSynthese : volume', () => {
  it('0 avis : message d’attente, rien d’autre', () => {
    const s = construireSynthese({ ...base, nbAvis: 0, satisfaction: null });
    expect(s.message).toBe('Aucun avis reçu sur les 30 derniers jours. Dès que vos clients scanneront un QR code, je vous résumerai la situation ici.');
    expect(s.periode).toBe('30 derniers jours');
  });

  it('3 avis : trop peu pour conclure, sans satisfaction ni agences', () => {
    const s = construireSynthese({ ...base, nbAvis: 3, agencesSousSeuil: ['Lyon'], agencesCritiques: [{ nom: 'Lyon', critiques: 2 }] });
    expect(s.message).toBe('Seulement 3 avis sur les 30 derniers jours : trop peu pour tirer une conclusion fiable.');
    expect(s.message).not.toContain('satisfaction');
    expect(s.message).not.toContain('Lyon');
  });

  it('1 avis : singulier', () => {
    expect(construireSynthese({ ...base, nbAvis: 1 }).message).toBe('Seulement 1 avis sur les 30 derniers jours : trop peu pour tirer une conclusion fiable.');
  });

  it('le seuil est celui du graphique (pas de second seuil) : limite basse et haute', () => {
    expect(FAIBLE_VOLUME_POINT).toBe(5);
    expect(construireSynthese({ ...base, nbAvis: FAIBLE_VOLUME_POINT - 1 }).message).toMatch(/^Seulement/);
    expect(construireSynthese({ ...base, nbAvis: FAIBLE_VOLUME_POINT }).message).toMatch(/^Sur les 30 derniers jours/);
  });
});

describe('construireSynthese : 45 avis', () => {
  it('aucune agence sous son seuil, pas d’agence critique', () => {
    expect(construireSynthese(base).message).toBe(`Sur les 30 derniers jours, 45 avis et 87,5${NBSP}% de satisfaction. Aucune agence sous son seuil.`);
  });

  it('une agence sous son seuil (singulier), une seule agence en tête des avis critiques', () => {
    const s = construireSynthese({ ...base, agencesSousSeuil: ['Ouaga 2000'], agencesCritiques: [{ nom: 'Ouaga 2000', critiques: 4 }, { nom: 'Bobo', critiques: 1 }, { nom: 'Koudougou', critiques: 0 }] });
    expect(s.message).toBe(`Sur les 30 derniers jours, 45 avis et 87,5${NBSP}% de satisfaction. 1 agence sous son seuil. Ouaga 2000 concentre le plus d'avis critiques (4).`);
    expect(s.question).toBe('Pourquoi Ouaga 2000 est sous son seuil ?');
  });

  it('plusieurs agences sous leur seuil (pluriel) : question « certaines agences »', () => {
    const s = construireSynthese({ ...base, agencesSousSeuil: ['A', 'B', 'C'] });
    expect(s.message).toContain('3 agences sous leur seuil.');
    expect(s.question).toBe('Pourquoi certaines agences sont sous leur seuil ?');
  });

  it('égalité sur le maximum d’avis critiques : aucune agence n’est nommée', () => {
    const s = construireSynthese({ ...base, agencesCritiques: [{ nom: 'A', critiques: 3 }, { nom: 'B', critiques: 3 }, { nom: 'C', critiques: 1 }] });
    expect(s.message).not.toContain('concentre');
    expect(s.message).not.toContain('A ');
  });

  it('aucun avis critique (maximum 0) : aucune agence n’est nommée', () => {
    expect(construireSynthese({ ...base, agencesCritiques: [{ nom: 'A', critiques: 0 }, { nom: 'B', critiques: 0 }] }).message).not.toContain('concentre');
  });

  it('satisfaction inconnue : la phrase de satisfaction est omise, jamais remplacée par 0', () => {
    const s = construireSynthese({ ...base, satisfaction: null });
    expect(s.message).toBe('Sur les 30 derniers jours, 45 avis. Aucune agence sous son seuil.');
    expect(s.message).not.toMatch(/\b0\b/);
  });

  it('agences sous seuil inconnues (forfait sans alertes, erreur) : la phrase est omise, pas « aucune agence »', () => {
    const s = construireSynthese({ ...base, agencesSousSeuil: null });
    expect(s.message).toBe(`Sur les 30 derniers jours, 45 avis et 87,5${NBSP}% de satisfaction.`);
    expect(s.question).toBe(QUESTION_PAR_DEFAUT);
  });

  it('classement indisponible : pas d’agence critique', () => {
    expect(construireSynthese({ ...base, agencesCritiques: null }).message).not.toContain('concentre');
  });

  it('tout inconnu sauf le nombre d’avis', () => {
    const s = construireSynthese({ jours: 7, nbAvis: 12, satisfaction: null, agencesSousSeuil: null, agencesCritiques: null });
    expect(s.message).toBe('Sur les 7 derniers jours, 12 avis.');
  });

  it('formats français : virgule décimale, séparateur de milliers, 12 mois', () => {
    const s = construireSynthese({ ...base, jours: 365, nbAvis: 1234, satisfaction: 66.67 });
    expect(s.periode).toBe('12 derniers mois');
    expect(s.message).toBe(`Sur les 12 derniers mois, 1${' '}234 avis et 66,7${NBSP}% de satisfaction. Aucune agence sous son seuil.`);
  });
});

describe('construireSynthese : robustesse', () => {
  it('nombre d’avis inconnu : message vide (la bande ne s’affiche pas)', () => {
    expect(construireSynthese({ ...base, nbAvis: null }).message).toBe('');
    expect(construireSynthese({ ...base, nbAvis: Number.NaN }).message).toBe('');
  });

  it('satisfaction non finie : omise', () => {
    expect(construireSynthese({ ...base, satisfaction: Number.NaN }).message).not.toContain('satisfaction');
  });

  it('aucune combinaison ne produit « undefined », « NaN » ou un 0 inventé', () => {
    const avis = [0, 1, 3, 5, 45, null, Number.NaN];
    const sats = [null, 0, 50, 87.5, Number.NaN];
    const sous = [null, [], ['A'], ['A', 'B']];
    const crit = [null, [], [{ nom: 'A', critiques: 2 }], [{ nom: 'A', critiques: 2 }, { nom: 'B', critiques: 2 }]];
    for (const nbAvis of avis) for (const satisfaction of sats) for (const agencesSousSeuil of sous) for (const agencesCritiques of crit) {
      for (const jours of [7, 30, 90, 365]) {
        const s = construireSynthese({ jours, nbAvis, satisfaction, agencesSousSeuil, agencesCritiques });
        expect(propre(s.message), s.message).toBe(true);
        expect(propre(s.question), s.question).toBe(true);
        expect(propre(s.periode)).toBe(true);
      }
    }
  });

  it('une satisfaction réellement à 0 % avec des avis est écrite telle quelle (c’est une donnée, pas un défaut)', () => {
    expect(construireSynthese({ ...base, satisfaction: 0 }).message).toContain(`0${NBSP}% de satisfaction`);
  });
});
