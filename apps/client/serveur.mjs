/**
 * Serveur de production du client public (remplace `node ./dist/server/entry.mjs`, qui reste utilisable en secours).
 *
 * Il démarre le gestionnaire d'Astro (fichiers statiques + pages rendues côté serveur) tel quel, et l'entoure de
 * serveur/reponses.mjs : compression gzip/brotli des réponses texte, Cache-Control par type de fichier, en-têtes de sécurité
 * aussi sur les fichiers statiques. Aucune dépendance ajoutée (node:zlib). Variables lues : PORT, HOST, PUBLIC_API_URL.
 *
 * Lancement : npm run build && npm start        (Render : `node ./serveur.mjs`, voir render.yaml)
 */
import { createServer } from 'node:http';
import { API_URL_PAR_DEFAUT, enTetesSecurite } from './serveur/entetes-securite.mjs';
import { enveloppe } from './serveur/reponses.mjs';

// L'entrée d'Astro démarre normalement son propre serveur à l'import : on le désactive pour récupérer seulement `handler`.
process.env.ASTRO_NODE_AUTOSTART = 'disabled';
const { handler } = await import('./dist/server/entry.mjs');

const port = process.env.PORT ? Number(process.env.PORT) : 4321;
const hote = process.env.HOST || '0.0.0.0';
const entetes = enTetesSecurite(process.env.PUBLIC_API_URL || API_URL_PAR_DEFAUT, true);

const serveur = createServer(enveloppe(handler, { entetes }));
serveur.listen(port, hote, () => console.log(`[client] serveur démarré sur http://${hote}:${port} (compression et cache activés)`));

// Render arrête l'ancienne instance avec SIGTERM au déploiement : on laisse finir les requêtes en cours.
process.on('SIGTERM', () => {
  serveur.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
});
