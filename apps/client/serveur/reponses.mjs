/**
 * Enveloppe du serveur du client public : compression, cache, en-têtes de sécurité (CL-01).
 *
 * Le serveur Astro (adaptateur Node, mode « standalone ») sert les fichiers statiques et les pages sans compresser, envoie les
 * polices et images avec « Cache-Control: public, max-age=0 », ne pose aucun en-tête de sécurité sur les fichiers statiques et
 * aucun Cache-Control sur les pages. `enveloppe(handler)` entoure son gestionnaire de requêtes SANS en changer le contenu :
 *
 *  - compression gzip / brotli (node:zlib, aucune dépendance) des seuls types texte (HTML, CSS, JS, JSON, SVG, texte) ; jamais
 *    des images ni des polices (déjà compressées), jamais en dessous de SEUIL_COMPRESSION octets, jamais sur 204/206/304 ni HEAD,
 *    ni si la réponse est déjà encodée ou porte « no-transform » ; « Vary: Accept-Encoding » sur tout type compressible ;
 *  - cache : fichiers versionnés (/_astro/ avec empreinte dans le nom) = 1 an, immutable ; fichiers à nom stable = 7 jours avec
 *    revalidation ; pages = « no-cache » (elles dépendent de l'état de l'API) ; une réponse qui pose un cookie = « private, no-store » ;
 *    un Cache-Control posé explicitement par l'application n'est jamais écrasé ;
 *  - en-têtes de sécurité ajoutés quand ils manquent (jamais écrasés).
 */
import zlib from 'node:zlib';

export const SEUIL_COMPRESSION = 1024;
export const CACHE_VERSIONNE = 'public, max-age=31536000, immutable';
export const CACHE_STABLE = 'public, max-age=604800, must-revalidate';
export const CACHE_PAGE = 'no-cache';
export const CACHE_PRIVE = 'private, no-store';

const TYPES_COMPRESSIBLES = /^(text\/(html|css|plain|xml|javascript)|application\/(javascript|json|xml|manifest\+json)|image\/svg\+xml)\s*(;|$)/i;

export function typeCompressible(contentType) {
  return Boolean(contentType) && TYPES_COMPRESSIBLES.test(String(contentType).trim());
}

/** Encodage à utiliser d'après Accept-Encoding : 'br', 'gzip' ou null (q=0 refuse ; brotli l'emporte à qualité égale). */
export function choisirEncodage(acceptEncoding) {
  if (!acceptEncoding) return null;
  const qualites = new Map();
  for (const morceau of String(acceptEncoding).split(',')) {
    const [nom, ...params] = morceau.trim().toLowerCase().split(';');
    if (!nom) continue;
    let q = 1;
    for (const p of params) {
      const m = p.trim().match(/^q=([0-9.]+)$/);
      if (m) q = Number(m[1]);
    }
    qualites.set(nom.trim(), Number.isFinite(q) ? q : 0);
  }
  const joker = qualites.get('*');
  const qualite = (nom) => (qualites.has(nom) ? qualites.get(nom) : joker ?? 0);
  const br = qualite('br');
  const gzip = qualite('gzip');
  if (br > 0 && br >= gzip) return 'br';
  if (gzip > 0) return 'gzip';
  return null;
}

/** Fichier de /_astro/ dont le nom contient une empreinte (ex. « _code_.DckrCYVU.css », « …index_0_lang.UbhvZ-I9.js »). */
export function estVersionne(chemin) {
  return /^\/_astro\/.+\.[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$/.test(chemin);
}

/**
 * Cache-Control à appliquer, ou null pour ne rien changer.
 * `actuel` : valeur posée par l'application ou l'adaptateur (undefined si aucune).
 */
export function politiqueCache({ chemin, contentType, actuel, aCookie }) {
  if (aCookie) return CACHE_PRIVE;
  const html = /^text\/html/i.test(String(contentType || ''));
  if (chemin.startsWith('/_astro/')) {
    if (estVersionne(chemin)) return actuel === CACHE_VERSIONNE ? null : CACHE_VERSIONNE;
    return actuel === CACHE_STABLE ? null : CACHE_STABLE;      // nom non versionné : jamais « immutable »
  }
  if (actuel === undefined) return CACHE_PAGE;
  if (actuel === 'public, max-age=0') return html ? CACHE_PAGE : CACHE_STABLE;      // valeur par défaut de l'adaptateur pour les fichiers de /public
  return null;
}

function fusionnerVary(existant, valeur) {
  const actuel = Array.isArray(existant) ? existant.join(', ') : existant ? String(existant) : '';
  if (actuel === '*') return actuel;
  const liste = actuel.split(',').map((s) => s.trim()).filter(Boolean);
  if (!liste.some((v) => v.toLowerCase() === valeur.toLowerCase())) liste.push(valeur);
  return liste.join(', ');
}

function affaiblirEtag(res) {
  const etag = res.getHeader('etag');
  if (typeof etag === 'string' && !etag.startsWith('W/')) res.setHeader('ETag', `W/${etag}`);
}

/** Entoure `handler(req, res)` : compression, cache et en-têtes de sécurité (voir l'en-tête du fichier). */
export function enveloppe(handler, { entetes = {}, seuil = SEUIL_COMPRESSION, niveauGzip = 6, qualiteBrotli = 4 } = {}) {
  return (req, res) => {
    const chemin = (req.url || '/').split('?')[0];
    const encodage = choisirEncodage(req.headers['accept-encoding']);
    const ecrire = res.write.bind(res);
    const terminer = res.end.bind(res);
    const ecrireTete = res.writeHead.bind(res);

    let teteDiffere = false;      // writeHead appelé : l'envoi réel est repoussé jusqu'au premier octet de corps
    let statut = null;
    let message;
    let decide = false;
    let flux = null;              // flux zlib actif
    let tampon = [];              // octets gardés tant que le seuil n'est pas atteint
    let tailleTampon = 0;
    let candidat = false;         // la réponse peut être compressée (reste à vérifier la taille)

    res.writeHead = (code, a, b) => {
      statut = code;
      let entetesTete = b;
      if (typeof a === 'string') message = a;
      else if (a) entetesTete = a;
      if (entetesTete) {
        const paires = Array.isArray(entetesTete) ? entetesTete : Object.entries(entetesTete);
        if (Array.isArray(entetesTete) && entetesTete.length && !Array.isArray(entetesTete[0])) {
          for (let i = 0; i + 1 < entetesTete.length; i += 2) res.setHeader(entetesTete[i], entetesTete[i + 1]);
        } else {
          for (const [k, v] of paires) res.setHeader(k, v);
        }
      }
      teteDiffere = true;
      return res;
    };

    function preparer() {
      decide = true;
      const code = statut ?? res.statusCode;
      for (const [nom, valeur] of Object.entries(entetes)) if (!res.hasHeader(nom)) res.setHeader(nom, valeur);

      const type = res.getHeader('content-type');
      const cache = politiqueCache({
        chemin,
        contentType: type,
        actuel: res.getHeader('cache-control') === undefined ? undefined : String(res.getHeader('cache-control')),
        aCookie: res.hasHeader('set-cookie'),
      });
      if (cache && (code < 400 || res.getHeader('cache-control') === undefined)) res.setHeader('Cache-Control', cache);

      const compressible = typeCompressible(type);
      if (compressible) res.setHeader('Vary', fusionnerVary(res.getHeader('vary'), 'Accept-Encoding'));

      const longueur = Number(res.getHeader('content-length'));
      const controle = String(res.getHeader('cache-control') || '').toLowerCase();
      candidat = Boolean(
        compressible && encodage && req.method !== 'HEAD'
        && code >= 200 && code !== 204 && code !== 205 && code !== 206 && code !== 304
        && !res.hasHeader('content-encoding') && !res.hasHeader('content-range') && !controle.includes('no-transform')
        && !(Number.isFinite(longueur) && longueur > 0 && longueur < seuil),
      );
    }

    function envoyerTete() {
      if (res.headersSent) return;
      const code = statut ?? res.statusCode;
      if (message) ecrireTete(code, message);
      else ecrireTete(code);
    }

    function demarrerCompression() {
      res.setHeader('Content-Encoding', encodage);
      res.removeHeader('Content-Length');
      affaiblirEtag(res);
      envoyerTete();
      flux = encodage === 'br'
        ? zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: qualiteBrotli } })
        : zlib.createGzip({ level: niveauGzip });
      flux.on('data', (morceau) => { if (ecrire(morceau) === false) flux.pause(); });
      flux.on('end', () => terminer());
      flux.on('error', () => { try { terminer(); } catch { /* connexion déjà fermée */ } });
      res.on('drain', () => flux && flux.resume());
      res.on('close', () => { if (flux) flux.destroy(); });
      for (const morceau of tampon) flux.write(morceau);
      tampon = [];
    }

    function envoyerSansCompression() {
      if (tampon.length) {
        const total = Buffer.concat(tampon);
        if (!res.hasHeader('content-length') && !res.headersSent && !res.hasHeader('transfer-encoding')) res.setHeader('Content-Length', total.length);
        envoyerTete();
        tampon = [];
        return total;
      }
      envoyerTete();
      return null;
    }

    const versBuffer = (chunk, enc) => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof enc === 'string' ? enc : 'utf8'));

    res.write = (chunk, enc, cb) => {
      if (typeof enc === 'function') { cb = enc; enc = undefined; }
      if (!decide) preparer();
      if (chunk == null || chunk.length === 0) { if (cb) cb(); return true; }
      if (flux) { const ok = flux.write(versBuffer(chunk, enc)); if (cb) cb(); return ok; }
      if (!candidat) {
        envoyerTete();
        return ecrire(chunk, enc, cb);
      }
      const buf = versBuffer(chunk, enc);
      tampon.push(buf);
      tailleTampon += buf.length;
      if (tailleTampon >= seuil) demarrerCompression();
      if (cb) cb();
      return true;
    };

    res.end = (chunk, enc, cb) => {
      if (typeof chunk === 'function') { cb = chunk; chunk = undefined; enc = undefined; }
      if (typeof enc === 'function') { cb = enc; enc = undefined; }
      if (!decide) preparer();
      if (flux) {
        if (chunk != null && chunk.length) flux.write(versBuffer(chunk, enc));
        flux.end();
        if (cb) res.once('finish', cb);
        return res;
      }
      if (candidat) {
        if (chunk != null && chunk.length) { const buf = versBuffer(chunk, enc); tampon.push(buf); tailleTampon += buf.length; }
        if (tailleTampon >= seuil) {
          demarrerCompression();
          flux.end();
          if (cb) res.once('finish', cb);
          return res;
        }
        const total = envoyerSansCompression();
        return total ? terminer(total, cb) : terminer(cb);
      }
      envoyerTete();
      return terminer(chunk, enc, cb);
    };

    handler(req, res);
  };
}
