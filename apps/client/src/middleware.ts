import { defineMiddleware } from 'astro:middleware';
import { enTetesSecurite } from './utils/securite';

const API_URL_PAR_DEFAUT = 'https://ikan-772d.onrender.com/api/v1';
const entetes = enTetesSecurite(import.meta.env.PUBLIC_API_URL || API_URL_PAR_DEFAUT);

/** En-têtes de sécurité sur TOUTES les réponses (pages, erreurs 404, redirections). */
export const onRequest = defineMiddleware(async (_context, next) => {
  const reponse = await next();
  for (const [nom, valeur] of Object.entries(entetes)) reponse.headers.set(nom, valeur);
  return reponse;
});
