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

http
  .createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]);

    // Traversée de répertoire : on résout puis on vérifie qu'on est resté sous ROOT.
    const requested = path.normalize(path.join(ROOT, url));
    const target = requested.startsWith(ROOT) ? requested : ROOT;

    let file = target;
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(ROOT, 'index.html'); // repli SPA
    }

    const ext = path.extname(file);
    const isHashed = /-[a-f0-9]{16,}\./.test(path.basename(file));

    res.writeHead(200, {
      'Content-Type': TYPES[ext] ?? 'application/octet-stream',
      // Les bundles portent un hachage dans leur nom : cache long sans risque.
      // Le HTML, lui, doit toujours être revalidé pour livrer la nouvelle version.
      'Cache-Control': isHashed ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, '0.0.0.0', () => {
    console.log(`Bundle web servi sur le port ${PORT}`);
  });
