/**
 * Capture les VRAIES surfaces du produit pour la vitrine.
 *
 * La landing montre nos applications dans des cadres d'appareils : ces images
 * doivent donc être de vraies captures, jamais des maquettes redessinées. Le
 * script se connecte comme un utilisateur (jeton gérant, PIN caisse/cuisine
 * tapé sur le VRAI pavé numérique, appairage d'écran) puis photographie chaque
 * surface à sa taille de référence.
 *
 *   node scripts/capture-shots.mjs [--local] [--only pos,kds] [--board-api URL]
 *
 * Sans argument, vise la production ; `--local` vise les serveurs de dev.
 *
 * `--board-api` : origine qui répond le CONTENU du Menu Board. Un écran de
 * salle n'affiche la carte que pendant un service ; entre midi et le soir il
 * affiche « Fermé », ce qui ne montre rien du produit. On lance alors une
 * seconde instance de la MÊME API sur la MÊME base, horloge décalée en plein
 * service (`scripts/demo-clock.mjs`), et on ne lui demande que cette réponse :
 *
 *   cd apps/api && SM_CLOCK_SHIFT_MS=… PORT=3009 \
 *     node --import ../../scripts/demo-clock.mjs dist/main.js
 *   node scripts/capture-shots.mjs --board-api http://localhost:3009
 *
 * La carte, les prix, la marque et le rendu restent ceux de production.
 *
 * Trois règles tiennent la qualité des images :
 *
 *  1. on ne photographie jamais un délai — on attend un MARQUEUR de contenu
 *     réel (« Ticket », « En préparation », un nom de produit), et on refuse
 *     une page qui affiche encore un squelette ou un écran de connexion ;
 *  2. le contexte est ouvert en `prefers-reduced-motion`, donc toutes les
 *     animations d'entrée sont déjà à leur état final : pas de carte à moitié
 *     fondue sur la photo ;
 *  3. chaque PNG est relu après écriture (taille non triviale) — un fichier
 *     vide en vitrine est pire que pas de capture du tout.
 */
import { chromium } from 'playwright';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { resolve, dirname, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, 'apps/web/public/shots');

const local = process.argv.includes('--local');
const API = local ? 'http://localhost:3001' : 'https://api-production-8949.up.railway.app';
const WEB = local ? 'http://localhost:3000' : 'https://web-production-99b58c.up.railway.app';
const POS = local ? 'http://localhost:8082' : 'https://pos-production-a9d8.up.railway.app';
const KDS = local ? 'http://localhost:8083' : 'https://kds-production-8991.up.railway.app';

const OWNER = { email: 'limame19@gmail.com', password: '***MOT-DE-PASSE-RETIRE***' };
const TENANT_SLUG = 'classfood';
const POS_PIN = '1111';
const KDS_PIN = '2222';

/** Sous-ensemble à recapturer : `--only board,menu`. */
const onlyArg = process.argv.indexOf('--only');
const ONLY =
  onlyArg >= 0 && process.argv[onlyArg + 1]
    ? new Set(process.argv[onlyArg + 1].split(',').map((s) => s.trim()))
    : null;

/** Origine qui sert le contenu du Menu Board (voir l'en-tête). */
const boardArg = process.argv.indexOf('--board-api');
const BOARD_API = boardArg >= 0 ? process.argv[boardArg + 1] : null;

/** Scène attendue avant de déclencher la photo de l'écran de salle. */
const sceneArg = process.argv.indexOf('--board-scene');
const BOARD_SCENE = sceneArg >= 0 ? process.argv[sceneArg + 1] : 'Gourmets Burgers';

/** Poids minimal d'un PNG plausible : en dessous, la surface était vide. */
const MIN_BYTES = 30_000;

/**
 * Photos de la carte, servies depuis le dépôt.
 *
 * Les fiches produits pointent `/photos/…` ; ces fichiers vivent dans
 * `apps/web/public/photos` et partent au prochain déploiement du site. Tant
 * qu'ils n'y sont pas, la production renvoie 404 et l'écran de salle affiche
 * une vignette cassée. On sert donc les VRAIS fichiers du dépôt : ce sont les
 * mêmes octets que ceux que le site rendra, pas des images de remplacement.
 *
 * Une exception ASSUMÉE : les `.jpeg` du dossier ne sont pas des visuels
 * produit mais des CLICHÉS DES PANNEAUX MURAUX du restaurant, pris au
 * comptoir — on y voit la salle, le piano, parfois un membre de l'équipe. Ils
 * servent de source pour saisir la carte, pas de vignette. On les laisse donc
 * au réseau : l'interface retombe alors sur sa pastille d'initiales, ce que la
 * production affiche déjà aujourd'hui, plutôt que de publier la photo d'une
 * personne sur une page de vitrine.
 */
const PHOTOS_DIR = resolve(root, 'apps/web/public/photos');
const MIME = {
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

async function servePhoto(route) {
  const { pathname } = new URL(route.request().url());
  const file = resolve(PHOTOS_DIR, basename(pathname));
  const mime = MIME[extname(file).toLowerCase()];
  if (!mime) return route.fallback();
  try {
    await route.fulfill({ status: 200, contentType: mime, body: await readFile(file) });
  } catch {
    await route.fallback(); // pas dans le dépôt : que le réseau réponde
  }
}

async function json(url, init) {
  const res = await fetch(url, init);
  const body = await res.text();
  if (!res.ok) throw new Error(`${url} → ${res.status} ${body.slice(0, 300)}`);
  return body ? JSON.parse(body) : null;
}

/**
 * Feuille de calme, posée AVANT le premier rendu (donc sans reflow visible) :
 * aucun curseur clignotant, aucune barre de défilement, aucune sélection.
 */
const CALM_CSS = `
  *, *::before, *::after { caret-color: transparent !important; }
  ::selection { background: transparent !important; }
  html, body { cursor: none !important; scroll-behavior: auto !important; }
  ::-webkit-scrollbar { width: 0 !important; height: 0 !important; background: transparent !important; }
`;

/**
 * Attend que le texte visible contienne TOUS ces marqueurs.
 *
 * La comparaison ignore la casse : nos surchapeaux (« TICKET », « CODE
 * ÉQUIPE ») sont mis en capitales par `text-transform`, que `innerText`
 * restitue transformées.
 */
function hasText(...needles) {
  return async (page) => {
    await page.waitForFunction(
      (list) => {
        const t = (document.body?.innerText ?? '').toLowerCase();
        return list.every((n) => t.includes(n.toLowerCase()));
      },
      needles,
      { timeout: 60_000 },
    );
  };
}

/** Aucun marqueur d'attente ne doit subsister sur la photo. */
const FORBIDDEN = ['Chargement', 'Connexion…', 'Vérification…', 'Une erreur', 'Réessayer'];

async function assertClean(name, page) {
  const text = await page.evaluate(() => document.body?.innerText ?? '');
  const lower = text.toLowerCase();
  const found = FORBIDDEN.filter((f) => lower.includes(f.toLowerCase()));
  if (found.length > 0) throw new Error(`${name} : écran non abouti (${found.join(', ')})`);
  if (text.trim().length < 40) throw new Error(`${name} : page quasi vide`);
}

async function main() {
  await mkdir(OUT, { recursive: true });

  console.log(`Cible : ${local ? 'LOCAL' : 'PRODUCTION'}`);

  const { token } = await json(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(OWNER),
  });

  // Un écran de salle éphémère : la vitrine montre le Menu Board en service.
  // Il est supprimé en fin de script, quoi qu'il arrive (bloc `finally`).
  const screen = await json(`${API}/screens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'Vitrine', orientation: 'landscape' }),
  });
  const paired = await json(`${API}/public/screens/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pairingCode: screen.pairing.code }),
  });
  console.log(`  écran éphémère « ${screen.name} » appairé (${paired.screenId})`);

  const browser = await chromium.launch();
  const failures = [];

  /** Une capture = un contexte neuf : pas de fuite d'état entre surfaces. */
  async function shoot({
    name,
    url,
    width,
    height,
    storage = [],
    route,
    clockAt,
    prepare,
    ready,
    settle = 1500,
    scale = 2,
  }) {
    if (ONLY && !ONLY.has(name)) return;
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: scale, // écrans Retina : la vitrine mérite du net
      locale: 'fr-FR',
      timezoneId: 'Europe/Paris',
      // Les animations d'entrée sont alors déjà à leur état final : on ne
      // photographie jamais une carte à moitié fondue.
      reducedMotion: 'reduce',
      isMobile: width < 500,
      hasTouch: width < 500,
    });

    // Le stockage est posé AVANT le premier script de la page : pas de
    // double navigation, donc pas d'écran de connexion fugace.
    if (storage.length > 0) {
      await context.addInitScript((entries) => {
        try {
          for (const [k, v] of entries) globalThis.localStorage?.setItem(k, v);
        } catch {
          /* stockage bloqué : la capture échouera bruyamment plus bas */
        }
      }, storage);
    }
    await context.addInitScript((css) => {
      const inject = () => {
        const style = document.createElement('style');
        style.textContent = css;
        document.head?.appendChild(style);
      };
      if (document.head) inject();
      else document.addEventListener('DOMContentLoaded', inject, { once: true });
    }, CALM_CSS);

    await context.route('**/photos/**', servePhoto);
    if (route) await context.route(route.match, route.handler);
    // L'horloge de l'appareil doit s'accorder avec celle qui a produit le
    // contenu — sinon l'écran affiche « Service du soir » à côté de 15 h.
    if (clockAt) await context.clock.setFixedTime(clockAt);

    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      if (prepare) await prepare(page);
      if (ready) await ready(page);
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
      // La souris est renvoyée hors des zones interactives : aucun état
      // « survolé » ne doit rester allumé sur la photo.
      await page.mouse.move(width - 2, height - 2);
      await page.waitForTimeout(settle);
      await assertClean(name, page);

      const path = resolve(OUT, `${name}.png`);
      await page.screenshot({ path, animations: 'disabled' });
      const { size } = await stat(path);
      if (size < MIN_BYTES) throw new Error(`${name}.png ne pèse que ${size} o — surface probablement vide`);
      console.log(`  ✓ ${name}.png — ${width}×${height} @${scale}x — ${(size / 1024).toFixed(0)} Ko`);
    } catch (e) {
      failures.push(`${name} : ${e.message}`);
      console.error(`  ✗ ${name} — ${e.message}`);
      if (errors.length > 0) console.error(`    erreurs page : ${errors.slice(0, 3).join(' | ')}`);
    } finally {
      await context.close();
    }
  }

  /**
   * Tape un PIN sur le VRAI pavé de l'application (un clic par touche), comme
   * l'équipe le fait en service. Les touches exposent leur `aria-label` ; à
   * défaut on retombe sur le clavier physique, que les deux écrans acceptent.
   */
  async function typePin(page, pin, { validate } = {}) {
    for (const digit of pin) {
      const key = page.locator(`[aria-label="${digit}"]`).first();
      if (await key.count()) {
        await key.click({ delay: 60 });
      } else {
        await page.keyboard.press(digit);
      }
      await page.waitForTimeout(120);
    }
    if (validate) {
      const ok = page.locator(`[aria-label="${validate}"]`).first();
      if (await ok.count()) await ok.click({ delay: 60 });
      else await page.keyboard.press('Enter');
    }
  }

  console.log('Captures en cours…');

  // ── Caisse : PIN 1111 tapé sur le pavé, envoi automatique au 4ᵉ chiffre ──
  await shoot({
    name: 'pos',
    url: POS,
    width: 1280,
    height: 800,
    prepare: async (page) => {
      await hasText('Poste de caisse')(page);
      await typePin(page, POS_PIN);
      await hasText('Ticket', 'Total')(page);

      /**
       * Un ticket en cours plutôt qu'un ticket vide : c'est l'écran que le
       * caissier a sous les yeux. On ne touche QUE des produits sans options
       * (les autres ouvrent la fiche de configuration), et on s'arrête là —
       * aucune commande n'est encaissée, rien n'est envoyé au serveur.
       */
      // Les tuiles s'annoncent « Kebab, 7,50 € » : on vise l'étiquette
      // d'accessibilité, seul repère stable (le texte, lui, est dans un enfant
      // qui intercepte le clic).
      for (const product of ['Végétarien', 'Kebab', 'Kebab']) {
        await page.locator(`[aria-label^="${product}, "]`).first().click();
        await page.waitForTimeout(700);
        // La fiche de configuration s'ouvre au premier appui : on valide
        // l'article tel quel, exactement comme au comptoir.
        const add = page.locator('[aria-label^="Ajouter · "]').first();
        if (await add.count()) {
          await add.click();
          await page.waitForTimeout(700);
        }
      }
      await page.waitForFunction(
        () => !(document.body?.innerText ?? '').includes('Tapez un produit pour démarrer'),
        undefined,
        { timeout: 15_000 },
      );
    },
    ready: hasText('Sous-total'),
    settle: 2500,
  });

  // ── Cuisine : PIN 2222 puis validation explicite (touche ✓) ──
  await shoot({
    name: 'kds',
    url: KDS,
    width: 1280,
    height: 800,
    prepare: async (page) => {
      await hasText('Code équipe')(page);
      await typePin(page, KDS_PIN, { validate: 'Valider le code' });
    },
    ready: hasText('Nouveau', 'En préparation', 'Prêt'),
    settle: 2500,
  });

  /**
   * Jeton gérant, comme après un login — et sidebar repliée sur son rail.
   *
   * Le panneau de navigation est une SURCOUCHE (il ne pousse pas le contenu) :
   * ouvert, il masque la première colonne de chaque page. Replié, la capture
   * montre l'écran de travail entier, ce que le gérant regarde réellement.
   */
  const asOwner = [
    ['sm.token', token],
    ['sm-bo-nav', 'closed'],
  ];

  await shoot({
    name: 'backoffice',
    url: `${WEB}/admin/dashboard`,
    width: 1440,
    height: 900,
    storage: asOwner,
    ready: hasText('Tableau de bord'),
    prepare: async (page) => {
      // « Aujourd'hui » est vide avant le service du soir : la période 7 jours
      // montre les vrais chiffres de la semaine, courbe et écarts compris.
      await hasText('7 jours')(page);
      await page.getByText('7 jours', { exact: true }).first().click();
      await page.waitForTimeout(1500);
    },
    settle: 2500,
  });

  await shoot({
    name: 'menu',
    url: `${WEB}/admin/menu`,
    width: 1440,
    height: 900,
    storage: asOwner,
    ready: hasText('Menu & prix'),
    settle: 2500,
  });

  // ── Menu Board : l'écran appairé plus haut, en service, paysage ──
  // L'appareil est mis à l'heure de l'API qui lui parle : l'horloge du bandeau
  // et le libellé du service racontent alors la même chose.
  const boardOrigin = BOARD_API ?? API;
  const boardContent =
    ONLY && !ONLY.has('board')
      ? null
      : await json(
          `${boardOrigin}/public/screens/content?token=${encodeURIComponent(paired.deviceToken)}`,
        ).catch(() => null);
  if (boardContent) {
    console.log(`  écran : ${boardContent.serviceLabel} · ${boardContent.scenes.length} scènes`);
  }

  await shoot({
    name: 'board',
    clockAt: boardContent ? new Date(boardContent.generatedAt) : undefined,
    url: `${WEB}/board/display`,
    width: 1280,
    height: 720,
    storage: [
      ['sm.board.token', paired.deviceToken],
      [
        'sm.board.screen',
        JSON.stringify({
          screenId: paired.screenId,
          name: paired.name,
          orientation: paired.orientation,
          theme: paired.theme,
        }),
      ],
    ],
    route: BOARD_API
      ? {
          match: '**/public/screens/content**',
          handler: async (r) => {
            const { pathname, search } = new URL(r.request().url());
            const relay = await fetch(`${BOARD_API}${pathname}${search}`);
            await r.fulfill({
              status: relay.status,
              contentType: 'application/json',
              body: await relay.text(),
            });
          },
        }
      : undefined,
    ready: async (page) => {
      // Une scène montée ET remplie : le carrousel a du contenu à afficher.
      await page.waitForSelector('.bd-layer', { timeout: 60_000 });
      await page.waitForFunction(
        () => (document.querySelector('.bd-layer')?.textContent ?? '').trim().length > 20,
        undefined,
        { timeout: 60_000 },
      );
      // Un écran fermé ne montre rien du produit : on refuse la photo.
      const closed = await page.evaluate(() => (document.body?.innerText ?? '').includes('Réouverture'));
      if (closed) throw new Error('restaurant fermé à cette heure — relancer avec --board-api');

      /**
       * On laisse le carrousel tourner jusqu'à cette scène.
       *
       * Plusieurs catégories illustrent leurs produits avec la PHOTO DU
       * PANNEAU MURAL du restaurant — un cliché pris au comptoir, où l'on
       * distingue la salle et parfois un membre de l'équipe. Ces vignettes
       * n'ont rien à faire sur une page publique. On attend donc une scène
       * dont les produits portent de vraies photos détourées.
       */
      await page.waitForFunction(
        (title) => document.querySelector('.bd-layer .bd-title')?.textContent?.trim() === title,
        BOARD_SCENE,
        { timeout: 120_000 },
      );
    },
    settle: 3000,
  });

  // Le client commande depuis son téléphone : on le photographie ainsi.
  await shoot({
    name: 'commande',
    url: `${WEB}/r/${TENANT_SLUG}`,
    width: 430,
    height: 932,
    ready: hasText('Commander en ligne', 'Sandwichs'),
    prepare: async (page) => {
      /**
       * Le client choisit un rayon dans la barre d'onglets, et la carte s'y
       * rend. On ouvre « Gourmets Burgers » : c'est la catégorie dont les
       * fiches portent de vraies photos produit détourées.
       *
       * Le haut de page (enseigne, bouton « Commander en ligne ») serait un
       * plus beau portrait de marque, mais la moitié des sandwichs y sont
       * illustrés par le cliché du panneau mural, invendable en vitrine.
       */
      await hasText('Gourmets Burgers')(page);
      await page.getByText('Gourmets Burgers', { exact: true }).first().click();
      await page.waitForTimeout(2000);
    },
    settle: 2000,
  });

  await browser.close();

  // L'écran de vitrine ne doit pas rester dans le parc du restaurant.
  const res = await fetch(`${API}/screens/${screen.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => null);
  console.log(`  écran éphémère supprimé (${res ? res.status : 'échec réseau'})`);

  if (failures.length > 0) {
    console.error(`\n${failures.length} capture(s) en échec :\n  - ${failures.join('\n  - ')}`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nCaptures écrites dans ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
