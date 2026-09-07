/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FABRIQUE DES ACTIFS DE MARQUE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   node --experimental-strip-types scripts/generate-brand-assets.mjs
 *
 * Produit, depuis LA géométrie et elle seule
 * (`apps/web/src/components/brand/geometry.ts`) :
 *
 *   apps/web/public/icon.svg               favicon vectoriel
 *   apps/web/public/favicon.ico            favicon hérité (PNG 32 empaqueté)
 *   apps/web/public/apple-icon.png         180 × 180, écran d'accueil iOS
 *   apps/web/public/icons/icon-192.png     manifeste PWA
 *   apps/web/public/icons/icon-512.png     manifeste PWA
 *   apps/web/public/icons/maskable-512.png manifeste PWA, purpose maskable
 *   apps/pos/assets/icon.png               icône de la caisse (1024)
 *   apps/kds/assets/icon.png               icône de la cuisine (1024)
 *   apps/{pos,kds}/assets/adaptive-icon.png  Android, zone de sécurité
 *   apps/{pos,kds}/assets/splash-icon.png    écran d'ouverture
 *
 * ═══ POURQUOI UN SCRIPT ET PAS DES FICHIERS ÉCRITS À LA MAIN ═══
 *
 * Parce qu'un logo redessiné à la main quelque part est un logo qui divergera.
 * Le jour où le tracé bouge, une commande le repropage partout — et si on
 * l'oublie, le favicon et l'écran ne montrent plus le même signe, ce que
 * personne ne remarque avant des mois.
 *
 * ═══ POURQUOI PLAYWRIGHT ═══
 *
 * Il faut un rastériseur pour les PNG (iOS et Android n'acceptent pas de SVG).
 * Le dépôt en a déjà un, et c'est celui qui sert `capture-shots.mjs` : autant
 * garder une seule dépendance de rendu plutôt que d'ajouter sharp ou resvg.
 * Le navigateur a l'avantage d'être le moteur qui rendra RÉELLEMENT le SVG
 * chez l'utilisateur — ce qu'il produit ici est donc ce que l'on verra.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');

const {
  markSvg,
  LAITON,
  FOND_TUILE,
} = await import(join(RACINE, 'apps/web/src/components/brand/geometry.ts'));

/* ── Encre et fonds ─────────────────────────────────────────────────────── */

const BLANC = '#ffffff';

/**
 * Compose une tuile carrée : un fond, et le signe centré dedans.
 *
 * `occupation` est la part du côté que le signe occupe. Elle n'est pas
 * décorative — c'est elle qui décide si l'icône survit au rognage d'Android :
 *
 *   0,68 — tuile ordinaire (favicon, iOS, PWA « any »). Le signe respire.
 *   0,56 — tuile MASKABLE. Android peut rogner jusqu'au cercle inscrit ;
 *          tout ce qui dépasse de la zone de sécurité (les 80 % centraux)
 *          peut disparaître. À 0,68 le bord déchiré du ticket se ferait
 *          amputer sur les lanceurs en cercle.
 *
 * `rayon` à 0 pour iOS et pour maskable : les deux systèmes appliquent leur
 * PROPRE masque. Un arrondi de notre part y produirait un double arrondi, ce
 * coin blanc caractéristique des icônes mal préparées.
 */
function tuile({ cote, occupation = 0.68, rayon = 0, fond = FOND_TUILE, encre = BLANC, garniture, micro = false, masqueId = 'e' }) {
  const taille = cote * occupation;
  const marge = (cote - taille) / 2;
  const echelle = taille / 32;

  const fondBalise =
    rayon > 0
      ? `<rect width="${cote}" height="${cote}" rx="${rayon}" fill="${fond}"/>`
      : `<rect width="${cote}" height="${cote}" fill="${fond}"/>`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${cote}" height="${cote}" viewBox="0 0 ${cote} ${cote}">` +
    fondBalise +
    `<g transform="translate(${marge} ${marge}) scale(${echelle})">` +
    markSvg({ micro, encre, garniture, masqueId }) +
    `</g></svg>`
  );
}

/* ── Rastérisation ──────────────────────────────────────────────────────── */

async function enPng(page, svg, cote) {
  await page.setViewportSize({ width: cote, height: cote });
  // `background: transparent` sur la page : la tuile fournit son propre fond,
  // et une icône maskable doit pouvoir être opaque bord à bord sans qu'un
  // blanc de page vienne s'intercaler.
  await page.setContent(
    `<style>html,body{margin:0;padding:0;background:transparent}svg{display:block}</style>${svg}`,
    { waitUntil: 'load' },
  );
  return page.screenshot({ omitBackground: true, type: 'png' });
}

/**
 * Empaquette un PNG dans un conteneur ICO.
 *
 * Le format ICO accepte, depuis Vista, une entrée directement compressée en
 * PNG : six octets d'en-tête, seize de répertoire, puis le PNG tel quel. Cela
 * évite d'ajouter un encodeur BMP pour un fichier que seuls les navigateurs
 * anciens iront chercher — mais qu'il faut fournir, parce qu'ils le
 * demandent à `/favicon.ico` sans regarder le HTML.
 *
 * Une largeur de 256 s'écrit 0 dans ce format (un octet, donc 0-255 avec 0
 * pour 256) ; on reste à 32, où la question ne se pose pas.
 */
function empaqueterIco(png, cote) {
  const entete = Buffer.alloc(6);
  entete.writeUInt16LE(0, 0); // réservé
  entete.writeUInt16LE(1, 2); // type 1 = icône
  entete.writeUInt16LE(1, 4); // une seule image

  const repertoire = Buffer.alloc(16);
  repertoire.writeUInt8(cote === 256 ? 0 : cote, 0); // largeur
  repertoire.writeUInt8(cote === 256 ? 0 : cote, 1); // hauteur
  repertoire.writeUInt8(0, 2); // palette : sans objet en couleurs vraies
  repertoire.writeUInt8(0, 3); // réservé
  repertoire.writeUInt16LE(1, 4); // plans
  repertoire.writeUInt16LE(32, 6); // bits par pixel
  repertoire.writeUInt32LE(png.length, 8);
  repertoire.writeUInt32LE(entete.length + repertoire.length, 12);

  return Buffer.concat([entete, repertoire, png]);
}

/* ── Programme ──────────────────────────────────────────────────────────── */

async function ecrire(chemin, contenu) {
  const abs = join(RACINE, chemin);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, contenu);
  const poids = Buffer.isBuffer(contenu) ? contenu.length : Buffer.byteLength(contenu);
  console.log(`  ${chemin.padEnd(46)} ${String(poids).padStart(7)} o`);
}

const navigateur = await chromium.launch();
const page = await navigateur.newPage({ deviceScaleFactor: 1 });

console.log('\nFavicon et icônes du site');

/*
 * LE FAVICON EST EN GRAVURE MICRO, ET CE N'EST PAS UN CHOIX ESTHÉTIQUE.
 * Il est servi à 16 px dans un onglet. À cette taille l'éclair évidé mesure
 * moins d'un pixel de large : il ne se lit plus, il salit. La micro ferme
 * l'évidement et épaissit le cadre — c'est exactement le cas que la deuxième
 * gravure existe pour couvrir.
 */
const faviconSvg = tuile({ cote: 64, rayon: 14, occupation: 0.7, micro: true });
await ecrire('apps/web/public/icon.svg', faviconSvg);

const favicon32 = await enPng(page, tuile({ cote: 32, rayon: 7, occupation: 0.72, micro: true }), 32);
await ecrire('apps/web/public/favicon.ico', empaqueterIco(favicon32, 32));

// iOS n'arrondit rien lui-même sur `apple-touch-icon` : c'est à nous de le
// faire, et sans transparence — un PNG transparent y devient noir.
await ecrire(
  'apps/web/public/apple-icon.png',
  await enPng(page, tuile({ cote: 180, rayon: 40, occupation: 0.66 }), 180),
);

console.log('\nManifeste PWA');
await ecrire(
  'apps/web/public/icons/icon-192.png',
  await enPng(page, tuile({ cote: 192, rayon: 42, occupation: 0.68 }), 192),
);
await ecrire(
  'apps/web/public/icons/icon-512.png',
  await enPng(page, tuile({ cote: 512, rayon: 112, occupation: 0.68 }), 512),
);
await ecrire(
  'apps/web/public/icons/maskable-512.png',
  await enPng(page, tuile({ cote: 512, rayon: 0, occupation: 0.56 }), 512),
);

/*
 * ═══ CAISSE ET CUISINE ═══
 *
 * Les noms de fichiers ne sont pas libres : ce sont ceux qu'attend la
 * configuration Expo (`app.json`), et ils ont changé au SDK 52 — plus
 * d'`adaptive-icon.png`, mais un trio premier plan / fond / monochrome. Les
 * fichiers du gabarit d'origine portaient déjà ces noms sans qu'`app.json` ne
 * les référence : ils étaient morts. On les remplace ET on les branche.
 *
 * LA CAISSE ET LA CUISINE PORTENT LE SIGNE BICHROME. C'est le seul endroit de
 * la suite où notre marque s'affiche en grand chez le client — une icône sur
 * une tablette posée au comptoir. Le laiton y sert à distinguer les deux
 * applications d'un coup d'œil des dizaines d'autres icônes sombres d'un
 * écran d'accueil.
 */
console.log('\nIcônes des applications embarquées (caisse, cuisine)');
for (const app of ['pos', 'kds']) {
  await ecrire(
    `apps/${app}/assets/icon.png`,
    await enPng(page, tuile({ cote: 1024, rayon: 0, occupation: 0.66, garniture: LAITON }), 1024),
  );

  // Android compose l'icône thématique en superposant premier plan et fond,
  // puis rogne l'ensemble — jusqu'au cercle inscrit sur certains lanceurs.
  // D'où la zone de sécurité sur le premier plan, et un fond plein séparé.
  await ecrire(
    `apps/${app}/assets/android-icon-foreground.png`,
    await enPng(page, tuile({ cote: 1024, rayon: 0, occupation: 0.54, fond: 'transparent', garniture: LAITON }), 1024),
  );
  await ecrire(
    `apps/${app}/assets/android-icon-background.png`,
    await enPng(page, `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="${FOND_TUILE}"/></svg>`, 1024),
  );
  // L'icône monochrome sert les « icônes thématisées » d'Android 13+ : le
  // système la recolore lui-même d'après le fond d'écran. Elle doit donc être
  // d'UNE seule encre — le laiton y serait écrasé, et la garniture bichrome
  // deviendrait invisible.
  await ecrire(
    `apps/${app}/assets/android-icon-monochrome.png`,
    await enPng(page, tuile({ cote: 1024, rayon: 0, occupation: 0.54, fond: 'transparent' }), 1024),
  );

  // L'écran d'ouverture est posé sur le noir de la charte par `app.json` : la
  // tuile y ajouterait un carré visible sur le noir.
  await ecrire(
    `apps/${app}/assets/splash-icon.png`,
    await enPng(page, tuile({ cote: 512, rayon: 0, occupation: 0.62, fond: 'transparent', garniture: LAITON }), 512),
  );
  // L'onglet du navigateur : ces deux applications sont servies sur le web.
  // Gravure micro — même raison qu'à l'onglet de la vitrine.
  await ecrire(
    `apps/${app}/assets/favicon.png`,
    await enPng(page, tuile({ cote: 64, rayon: 14, occupation: 0.72, micro: true }), 64),
  );

  /*
   * LE SIGNE DÉTOURÉ, POUR L'INTÉRIEUR DES ÉCRANS.
   *
   * La caisse et la cuisine ne rendent que des `View` et des `Text` : aucun
   * SVG, et `react-native-svg` n'y est pas installé. On aurait pu l'ajouter —
   * mais c'est un module natif, à deux applications, pour un seul dessin.
   *
   * Un PNG GÉNÉRÉ DEPUIS LA MÊME GÉOMÉTRIE coûte une dépendance de moins et
   * ne crée PAS une seconde représentation du logo : il sort du même tracé
   * que l'écran et que le favicon. C'est la condition qui rendait le choix
   * acceptable — un logo redessiné pour la caisse aurait divergé.
   *
   * Fond transparent et occupation pleine : c'est l'écran qui décide de la
   * marge, comme pour un SVG. 512 px pour un affichage autour de 72 —
   * confortable jusqu'à un écran à 3×.
   */
  await ecrire(
    `apps/${app}/assets/mark.png`,
    await enPng(page, tuile({ cote: 512, rayon: 0, occupation: 1, fond: 'transparent', garniture: LAITON }), 512),
  );
}

await navigateur.close();
console.log('\nFait.\n');
