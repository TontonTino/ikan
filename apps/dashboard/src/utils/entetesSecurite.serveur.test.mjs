import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const NOMS = ['X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy', 'Content-Security-Policy-Report-Only'];
const racine = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('server.mjs : en-têtes sur toutes les réponses (200, 404, 405)', () => {
  let dossier = '';
  let processus;
  const port = 18000 + Math.floor(Math.random() * 1000);
  const url = (chemin) => `http://127.0.0.1:${port}${chemin}`;

  beforeAll(async () => {
    // Copie du serveur dans un dossier temporaire avec un faux dist/ : aucun fichier du dépôt n'est touché.
    dossier = mkdtempSync(path.join(tmpdir(), 'dash-'));
    mkdirSync(path.join(dossier, 'dist'));
    writeFileSync(path.join(dossier, 'dist', 'index.html'), '<!doctype html><title>x</title>');
    for (const f of ['server.mjs', 'entetes-securite.mjs']) copyFileSync(path.join(racine, f), path.join(dossier, f));
    processus = spawn(process.execPath, ['server.mjs'], {
      cwd: dossier,
      env: { ...process.env, PORT: String(port), APP_ENV: 'production' },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    await new Promise((resolve, reject) => {
      processus.stdout.on('data', (d) => String(d).includes('listening') && resolve());
      processus.on('error', reject);
      setTimeout(() => reject(new Error('serveur non démarré')), 8000);
    });
  });

  afterAll(async () => {
    if (processus) {
      const fini = new Promise((resolve) => processus.once('exit', resolve));
      processus.kill();
      await fini;
    }
    try {
      if (dossier) rmSync(dossier, { recursive: true, force: true });
    } catch {
      /* dossier temporaire : sans importance */
    }
  });

  it.each([
    ['page (200)', 'GET', '/login', 200],
    ['fichier absent (404)', 'GET', '/absent.png', 404],
    ['méthode refusée (405)', 'POST', '/login', 405],
  ])('%s : tous les en-têtes, HSTS en production', async (_nom, methode, chemin, code) => {
    const r = await fetch(url(chemin), { method: methode });
    expect(r.status).toBe(code);
    for (const nom of NOMS) expect(r.headers.get(nom), nom).toBeTruthy();
    expect(r.headers.get('strict-transport-security')).toBe('max-age=15552000');
    expect(r.headers.get('content-security-policy')).toBeNull();
    expect(r.headers.get('x-frame-options')).toBe('DENY');
  });
});
