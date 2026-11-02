import { describe, expect, it } from 'vitest';
import { texteRecommandationAffiche } from './texteRecommandation';

describe('texteRecommandationAffiche : retire « URGENT — » à l’affichage seulement', () => {
  it.each([
    ['préfixe présent', 'URGENT — Des retours très négatifs.', 'Des retours très négatifs.'],
    ['casse indifférente', 'Urgent — Contactez le client.', 'Contactez le client.'],
    ['espaces insécables autour du tiret', 'URGENT\u00a0—\u00a0Régularisez le dossier.', 'Régularisez le dossier.'],
    ['fines insécables', 'URGENT\u202f—\u202fRemplacez le matériel.', 'Remplacez le matériel.'],
    ['sans espace', 'URGENT—Appelez.', 'Appelez.'],
    ['préfixe absent', 'Des retours très négatifs.', 'Des retours très négatifs.'],
    ['au milieu du texte : intact', 'Situation URGENT — à suivre.', 'Situation URGENT — à suivre.'],
    ['mot urgent sans tiret : intact', 'URGENT : appelez.', 'URGENT : appelez.'],
    ['tiret simple : intact', 'URGENT - appelez.', 'URGENT - appelez.'],
    ['texte vide', '', ''],
    ['préfixe seul : on garde le texte d’origine', 'URGENT —', 'URGENT —'],
    ['un seul préfixe est retiré', 'URGENT — URGENT — deux fois', 'URGENT — deux fois'],
  ])('%s', (_nom, entree, attendu) => {
    expect(texteRecommandationAffiche(entree)).toBe(attendu);
  });

  it('ne modifie pas la donnée : la fonction renvoie une nouvelle chaîne', () => {
    const donnee = 'URGENT — texte';
    texteRecommandationAffiche(donnee);
    expect(donnee).toBe('URGENT — texte');
  });
});
