import { describe, expect, it } from 'vitest';
// @ts-ignore — pas de types Node dans ce projet ; le test lit les fichiers réels de l'API et de YAM.
import { readFileSync } from 'node:fs';
import { THEME_LABELS, enMajusculeInitiale, themeLabel } from './themeLabels';

const lire = (chemin: string): string => readFileSync(new URL(chemin, import.meta.url), 'utf8');
const dictPython = (source: string, nom: string): Record<string, string> => {
  const debut = source.indexOf(nom);
  const bloc = source.slice(debut, source.indexOf('}', debut));
  return Object.fromEntries([...bloc.matchAll(/"(\w+)":\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]));
};

describe('thèmes (lot 4) : un seul libellé par clé, partout', () => {
  it('chaque clé de l’API (categories.yaml) a son libellé', () => {
    const yaml = lire('../../../api/app/services/ai/categories.yaml');
    const cles = [...yaml.matchAll(/^\s*-\s*(\w+)\s*$/gm)].map((m) => m[1]);
    expect(cles.length).toBe(15);
    for (const cle of cles) expect(THEME_LABELS[cle], cle).toBeTruthy();
  });

  it('l’API (statistiques) et YAM affichent le même texte que le dashboard', () => {
    const api = dictPython(lire('../../../api/app/api/v1/endpoints/dashboard_statistics_shared.py'), 'THEME_LABELS_MAP');
    expect(api).toEqual(THEME_LABELS);
    const yam = dictPython(lire('../../../agent/app/agent/qa_service.py'), '_THEME_LABELS_VEILLE');
    for (const [cle, libelle] of Object.entries(yam)) expect(libelle, cle).toBe(THEME_LABELS[cle]);
  });

  it('majuscule initiale seulement, sigles gardés', () => {
    for (const libelle of Object.values(THEME_LABELS)) expect(enMajusculeInitiale(libelle)).toBe(libelle);
    expect(enMajusculeInitiale('Internet & Réseau Mobile')).toBe('Internet & réseau mobile');
    expect(enMajusculeInitiale('internet & réseau mobile')).toBe('Internet & réseau mobile');
    expect(enMajusculeInitiale('Carte SIM & Numéro')).toBe('Carte SIM & numéro');
    expect(enMajusculeInitiale('Réseau 4G/5G')).toBe('Réseau 4G/5G');
  });

  it('jamais de clé technique à l’écran', () => {
    expect(themeLabel('accueil')).toBe('Accueil & amabilité');
    expect(themeLabel('forfaits_recharge')).toBe('Forfaits recharge');
    expect(themeLabel('Équipements & Boutique')).toBe('Équipements & boutique');
    expect(themeLabel(null)).toBe('Non classé');
  });
});
