import { defineMiddleware } from 'astro:middleware';
import { enTetesSecurite } from './utils/securite';
import { adresseApi } from '../serveur/adresse-api.mjs';

const entetes = enTetesSecurite(adresseApi(import.meta.env.PUBLIC_API_URL, import.meta.env.PROD), import.meta.env.PROD);

/** En-têtes de sécurité sur TOUTES les réponses (pages, erreurs 404, redirections). */
export const onRequest = defineMiddleware(async (_context, next) => {
  const reponse = await next();
  for (const [nom, valeur] of Object.entries(entetes)) reponse.headers.set(nom, valeur);
  return reponse;
});
