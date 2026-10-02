import { createReadStream, promises as fs } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const indexFile = path.join(root, 'index.html');
const port = Number(process.env.PORT || 10000);
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

async function resolveFile(pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const candidate = path.resolve(root, `.${decodedPath}`);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) return null;

  try {
    const stat = await fs.stat(candidate);
    if (stat.isFile()) return candidate;
    if (stat.isDirectory()) {
      const directoryIndex = path.join(candidate, 'index.html');
      await fs.access(directoryIndex);
      return directoryIndex;
    }
  } catch {
    // Les routes React sans fichier correspondant sont traitées plus bas.
  }

  // Une URL avec extension représente un fichier attendu (script, image, etc.),
  // tandis qu'une route sans extension appartient au routeur React.
  return path.extname(decodedPath) ? null : indexFile;
}

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }

  const pathname = new URL(request.url || '/', 'http://localhost').pathname;
  const file = await resolveFile(pathname);
  if (!file) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not Found');
    return;
  }

  try {
    const stat = await fs.stat(file);
    response.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'X-Content-Type-Options': 'nosniff',
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(file).pipe(response);
  } catch {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Server Error');
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`IKAN AI dashboard listening on port ${port}`);
});
