/**
 * Serveur statique du bundle web Expo.
 *
 * Volontairement sans dépendance : servir un dossier et rabattre les routes
 * inconnues sur index.html (l'app est une SPA) tient en quelques lignes, et
 * une dépendance de moins est une faille de moins sur un poste de service.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, 'dist');
const PORT = Number(process.env.PORT ?? 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function sendError(res, status, message) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(message);
}

function createStaticServer({ root = ROOT } = {}) {
  const safeRoot = path.resolve(root);

  return http.createServer((req, res) => {
    let url;
    try {
      // La query ne désigne jamais un fichier et peut contenir des `%` légitimes.
      url = decodeURIComponent((req.url ?? '/').split('?')[0]);
    } catch (error) {
      if (error instanceof URIError) {
        sendError(res, 400, 'Bad Request');
        return;
      }
      throw error;
    }

    let file;
    try {
      // Traversée de répertoire : le séparateur évite qu'un dossier `dist-*`
      // soit pris pour un enfant de `dist` par une simple comparaison de préfixe.
      const requested = path.normalize(path.join(safeRoot, url));
      const insideRoot =
        requested === safeRoot || requested.startsWith(`${safeRoot}${path.sep}`);
      const target = insideRoot ? requested : safeRoot;

      file = target;
      try {
        if (fs.statSync(file).isDirectory()) file = path.join(safeRoot, 'index.html');
      } catch (error) {
        if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
          file = path.join(safeRoot, 'index.html'); // repli SPA
        } else {
          throw error;
        }
      }
    } catch {
      sendError(res, 500, 'Internal Server Error');
      return;
    }

    const ext = path.extname(file);
    const isHashed = /-[a-f0-9]{16,}\./.test(path.basename(file));
    const stream = fs.createReadStream(file);

    stream.once('error', () => sendError(res, 500, 'Internal Server Error'));
    stream.once('open', () => {
      if (res.destroyed) {
        stream.destroy();
        return;
      }
      res.writeHead(200, {
        'Content-Type': TYPES[ext] ?? 'application/octet-stream',
        // Les bundles portent un hachage dans leur nom : cache long sans risque.
        // Le HTML, lui, doit toujours être revalidé pour livrer la nouvelle version.
        'Cache-Control': isHashed ? 'public, max-age=31536000, immutable' : 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      stream.pipe(res);
    });
    res.once('close', () => stream.destroy());
  });
}

if (require.main === module) {
  createStaticServer().listen(PORT, '0.0.0.0', () => {
    console.log(`Bundle web servi sur le port ${PORT}`);
  });
}

module.exports = { createStaticServer };
