import { describe, expect, it } from 'vitest';
import { politiqueCsp } from '../../entetes-securite.mjs';
import {
  VARIABLES_BUILD, VARIABLES_SERVEUR, messageVariablesManquantes, variablesManquantes,
} from '../../variables-requises.mjs';

const SOURCES = import.meta.glob(
  ['/src/config.ts', '/src/services/api.ts', '/entetes-securite.mjs', '/server.mjs', '/vite.config.ts'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;
const lire = (chemin: string) => {
  const texte = SOURCES[chemin];
  if (!texte) throw new Error(`source introuvable : ${chemin}`);
  return texte;
};

describe('adresses des services : toujours depuis l’environnement', () => {
  it('le build exige l’API, le formulaire client et l’agent ; le serveur exige l’API et l’agent', () => {
    expect(VARIABLES_BUILD).toEqual(['VITE_API_URL', 'VITE_CLIENT_URL', 'VITE_AGENT_URL']);
    expect(VARIABLES_SERVEUR).toEqual(['VITE_API_URL', 'VITE_AGENT_URL']);
  });

  it('une variable absente, vide ou faite d’espaces est manquante', () => {
    const env = { VITE_API_URL: 'https://api.exemple.org/api/v1', VITE_CLIENT_URL: '   ' };
    expect(variablesManquantes(env, VARIABLES_BUILD)).toEqual(['VITE_CLIENT_URL', 'VITE_AGENT_URL']);
    expect(variablesManquantes({ ...env, VITE_CLIENT_URL: 'https://c.exemple.org', VITE_AGENT_URL: 'https://y.exemple.org' }, VARIABLES_BUILD)).toEqual([]);
  });

  it('le message d’arrêt nomme chaque variable manquante', () => {
    const message = messageVariablesManquantes(['VITE_CLIENT_URL', 'VITE_AGENT_URL'], 'Build de production');
    expect(message).toContain('Build de production impossible');
    expect(message).toContain('VITE_CLIENT_URL, VITE_AGENT_URL');
    expect(messageVariablesManquantes(['VITE_API_URL'], 'Démarrage du serveur')).toContain('variable manquante VITE_API_URL');
  });

  it('sans adresse, la CSP n’ajoute aucune origine (et aucune adresse de déploiement)', () => {
    const csp = politiqueCsp();
    expect(csp).toMatch(/connect-src 'self' https:\/\/nominatim\.openstreetmap\.org;/);
    expect(csp).not.toMatch(/onrender|undefined|null/);
  });

  it('aucune adresse de déploiement codée dans le code du dashboard', () => {
    for (const fichier of ['/src/config.ts', '/src/services/api.ts', '/entetes-securite.mjs', '/server.mjs', '/vite.config.ts']) {
      expect(lire(fichier), fichier).not.toMatch(/onrender\.com|amazonaws\.com|cloudfront\.net/);
    }
  });

  it('le build de production et le serveur appliquent la vérification', () => {
    expect(lire('/vite.config.ts')).toMatch(/command === 'build' && mode === 'production'/);
    expect(lire('/server.mjs')).toMatch(/if \(estProduction\(process\.env\)\)[\s\S]*VARIABLES_SERVEUR[\s\S]*process\.exit\(1\)/);
  });
});
