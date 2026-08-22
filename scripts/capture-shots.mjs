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
 *
 * ─── CHAQUE SURFACE EST PHOTOGRAPHIÉE À LA TAILLE DE SON APPAREIL ───
 *
 * Ces dimensions ne sont pas un réglage de netteté : la vitrine embarque la
 * MÊME application, à la MÊME résolution, dans le même cadre, et remplace
 * l'affiche par elle au clic (`DEVICE_SCREEN`, apps/web/src/components/
 * marketing/content.ts). Toucher une largeur ici sans toucher là-bas, c'est
 * rogner l'affiche ou faire sauter la mise en page sous les yeux du visiteur.
 *
 *   pos 1280 × 800 (tablette) · kds 1920 × 1080 (mural) ·
 *   backoffice & menu 1440 × 900 (ordinateur) · commande 390 × 844 (téléphone)
 *
 * Le mot de passe gérant n'est demandé que par les captures qui en ont besoin
 * (`backoffice`, `menu`, `board`) : `--only pos,kds,commande` s'exécute sans.
 */
import { chromium } from 'playwright';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { resolve, dirname, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(root, 'apps/web/public/shots');

/*
 * TROIS CIBLES, ET UNE RAISON DE LES DISTINGUER.
 *
 * `--local` photographie ce qu'on est en train d'écrire ; sans rien, la
 * production ; `--staging` la préproduction.
 *
 * Cette troisième cible n'est pas un confort : une affiche doit montrer ce qui
 * est RÉELLEMENT servi, et un changement d'interface arrive toujours sur
 * staging avant la production. Photographier la production juste après avoir
 * modifié un écran produit une affiche périmée — et personne ne la regarde
 * assez pour s'en apercevoir. On photographie donc là où le changement est
 * déjà déployé, puis on promeut l'affiche avec le reste.
 */
const local = process.argv.includes('--local');
const staging = process.argv.includes('--staging');
const cible = (locale, prepro, prod) => (local ? locale : staging ? prepro : prod);

const API = cible('http://localhost:3001', 'https://api-staging-a5e8.up.railway.app', 'https://api-production-8949.up.railway.app');
const WEB = cible('http://localhost:3000', 'https://web-staging-6f5f.up.railway.app', 'https://web-production-99b58c.up.railway.app');
const POS = cible('http://localhost:8082', 'https://pos-staging-7f92.up.railway.app', 'https://pos-production-a9d8.up.railway.app');
const KDS = cible('http://localhost:8083', 'https://kds-staging-90da.up.railway.app', 'https://kds-production-8991.up.railway.app');

/**
 * L'écran cuisine EN MODE DÉMONSTRATION — la source de son affiche.
 *
 * Ce n'est pas `KDS` : la production ne sert pas encore `?demo=1`, et c'est
 * l'origine de STAGING que la vitrine embarque dans son cadre. L'affiche doit
 * montrer exactement ce que le clic « Essayer » fera apparaître — voir le
 * commentaire du bloc `kds` plus bas pour le raisonnement complet.
 *
 * Cette adresse est RECOPIÉE de `DEMO_ORIGINS.kds`
 * (apps/web/src/components/marketing/content.ts). Les deux doivent bouger
 * ensemble : le jour où la démonstration change d'origine, l'affiche cesserait
 * sinon de montrer l'application qu'on embarque.
 */
const KDS_DEMO = local
  ? 'http://localhost:8083/?demo=1'
  : 'https://kds-staging-90da.up.railway.app/?demo=1';

/**
 * Identifiants du gérant, lus dans l'environnement.
 *
 * Ce script se connecte réellement au back-office pour photographier des
 * écrans peuplés : il lui faut donc un vrai mot de passe. Il n'a pas à vivre
 * dans le dépôt pour autant — un secret committé reste lisible dans
 * l'historique même après qu'on l'a retiré du fichier.
 *
 *   CAPTURE_OWNER_PASSWORD='…' node scripts/capture-shots.mjs
 */
const OWNER = {
  email: process.env.CAPTURE_OWNER_EMAIL ?? 'limame19@gmail.com',
  password: process.env.CAPTURE_OWNER_PASSWORD ?? '',
};
const TENANT_SLUG = 'classfood';
const POS_PIN = '1111';

/** Sous-ensemble à recapturer : `--only board,menu`. */
const onlyArg = process.argv.indexOf('--only');
const ONLY =
  onlyArg >= 0 && process.argv[onlyArg + 1]
    ? new Set(process.argv[onlyArg + 1].split(',').map((s) => s.trim()))
    : null;

/**
 * Les surfaces qui EXIGENT une session gérant, et elles seules.
 *
 * Le mot de passe était réclamé au démarrage quoi qu'il arrive. Or la caisse
 * et la cuisine s'ouvrent avec un PIN d'équipe, et la page de commande est
 * publique : `--only kds` refusait de démarrer pour un jeton dont il n'aurait
 * rien fait. Pire, il obligeait à sortir un mot de passe de production pour
 * recapturer une affiche qui ne touche à aucune donnée — le genre de friction
 * qui finit par faire committer un secret.
 */
const NEEDS_TOKEN = ['backoffice', 'menu', 'board'];
const wants = (name) => !ONLY || ONLY.has(name);
const needsToken = NEEDS_TOKEN.some(wants);
if (needsToken && !OWNER.password) {
  console.error(
    'CAPTURE_OWNER_PASSWORD manquant — ces captures se connectent au back-office\n' +
      'pour photographier des écrans peuplés. Exemple :\n' +
      "  CAPTURE_OWNER_PASSWORD='…' node scripts/capture-shots.mjs\n" +
      'Inutile pour --only pos,kds,commande : PIN d’équipe ou page publique.',
  );
  process.exit(1);
}

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

  // Session gérant : seulement si une des surfaces demandées en a besoin.
  const token = needsToken
    ? (
        await json(`${API}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(OWNER),
        })
      ).token
    : null;

  /**
   * Un écran de salle éphémère : la vitrine montre le Menu Board en service.
   * Il est supprimé en fin de script, quoi qu'il arrive (bloc `finally`).
   *
   * UNIQUEMENT SI LE MENU BOARD EST AU PROGRAMME. Il l'était toujours, même
   * pour un `--only kds` : recapturer une seule affiche créait puis supprimait
   * un appareil dans le parc du restaurant — une trace dans son historique, et
   * un orphelin si le script mourait entre les deux. Une exécution qui ne
   * photographie pas l'écran de salle n'a rien à écrire dans ses données.
   */
  const needsScreen = wants('board');
  let screen = null;
  let paired = null;
  if (needsScreen) {
    screen = await json(`${API}/screens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'Vitrine', orientation: 'landscape' }),
    });
    paired = await json(`${API}/public/screens/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pairingCode: screen.pairing.code }),
    });
    console.log(`  écran éphémère « ${screen.name} » appairé (${paired.screenId})`);
  }

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
    if (!wants(name)) return;
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

  /**
   * ══════════════ Cuisine — le mural 24 pouces, en service ══════════════
   *
   * 1920 × 1080, ET NON LA TAILLE DE LA TABLETTE. L'écran cuisine d'un snack
   * est un moniteur accroché au-dessus du piano, lu à 2-4 mètres :
   * `apps/kds/src/config.ts` le dit, et l'application s'y adapte pour de bon
   * — trois colonnes plus le panneau « À lancer » au-delà de 1240 px, et une
   * typographie agrandie de 28 % dès que le petit côté atteint 1080. En
   * 1280 × 800, l'affiche vendait donc une cuisine de tablette là où la
   * vitrine promet un mural.
   *
   * Ces dimensions sont AUSSI celles que l'iframe de la vitrine donne à
   * l'application (`DEVICE_SCREEN.wall`, components/marketing/content.ts) et
   * celles du châssis `.dv-wall` qui l'encadre. Les trois doivent rester
   * d'accord : sinon l'affiche est rognée, ou la mise en page saute sous les
   * yeux du visiteur au moment où il clique « Essayer ».
   *
   * ─── POURQUOI CETTE CAPTURE PASSE PAR `?demo=1` ───
   *
   * Ce n'est pas un contournement, c'est la seule source qui garantit la
   * promesse ci-dessus, et il y a deux raisons.
   *
   * D'ABORD, LA VOIE PIN N'EXISTE PLUS. Ce bloc tapait le code équipe sur le
   * pavé de l'écran cuisine. Depuis que la tablette apprend son établissement
   * à l'APPAIRAGE (cf. l'en-tête d'apps/kds/src/config.ts), une instance
   * fraîche ouvre sur « Appairer cet appareil » et jamais sur « Code équipe » :
   * chaque capture partant d'un contexte neuf, l'attente expirait. Le rendre
   * possible demanderait de créer un appareil dans le parc du restaurant à
   * chaque capture, et d'y semer son jeton — le prix est disproportionné pour
   * une photo.
   *
   * ENSUITE, ET SURTOUT : l'affiche est le TENANT-LIEU de la démonstration.
   * Elle occupe le même cadre, aux mêmes dimensions, et le clic « Essayer » la
   * remplace par cette application-là — `DEMO_ORIGINS.kds` dans content.ts,
   * c'est-à-dire l'URL ci-dessous. Photographier la même chose, c'est garantir
   * que le clic n'échange pas le restaurant sous les yeux du visiteur : la
   * photo prend vie, elle ne se substitue pas.
   *
   * Ce n'est pas une maquette pour autant : `?demo=1` fait tourner LE binaire
   * de production, avec sa vraie mise en page et son vrai jeu de données de
   * démonstration (`packages/client-core/src/demo`). Tout se joue dans le
   * navigateur — aucune base, aucun identifiant, aucune trace chez le client,
   * et un résultat reproductible d'une exécution à l'autre.
   */
  await shoot({
    name: 'kds',
    url: KDS_DEMO,
    width: 1920,
    height: 1080,
    // Pas de PIN : la démonstration ouvre déjà appairée ET déjà en service
    // (`demoSeed()` dans apps/kds/src/client.ts).
    ready: hasText('Nouveau', 'En préparation', 'Prêt', 'À lancer'),
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
  //
  // Le bloc entier dépend de `needsScreen` : sans appairage, `paired` est nul
  // et ne pourrait même pas servir à composer les arguments de `shoot`.
  if (needsScreen) {
    const boardOrigin = BOARD_API ?? API;
    const boardContent = await json(
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
  } // fin du bloc Menu Board : voir `needsScreen` plus haut

  /**
   * Le client commande depuis son téléphone : on le photographie ainsi.
   *
   * 390 × 844 et non 430 × 932 : c'est la résolution que la vitrine donne à
   * l'iframe (`DEVICE_SCREEN.phone`), et le rapport d'écran doit être commun à
   * l'affiche, au châssis et à l'application. L'ancien format laissait 0,15 %
   * d'écart — invisible à l'œil, mais c'est par cette porte que le rognage
   * revient.
   */
  await shoot({
    name: 'commande',
    // La MÊME adresse que `DEMO_PATHS.order` de la vitrine : l'affiche et le
    // cadre vivant doivent montrer la même page, sinon le clic « Essayer »
    // change de restaurant sous les yeux du visiteur.
    url: `${WEB}/r/demo?demo=1`,
    width: 390,
    height: 844,
    ready: hasText('Commandez.', 'Commander maintenant'),
    prepare: async (page) => {
      /**
       * ON PHOTOGRAPHIE LA PAGE D'ACCUEIL, DEPUIS LE HAUT, EN MODE DÉMO.
       *
       * Deux corrections, et la seconde est la moins évidente.
       *
       * LE CADRAGE. Cette capture ouvrait « Gourmets Burgers » et
       * photographiait la carte EN PLEIN DÉFILEMENT : une fiche coupée au
       * bord supérieur, aucun en-tête, aucune marque — le visiteur de la
       * vitrine voyait une liste, pas une application. La justification
       * d'alors (« la moitié des sandwichs sont illustrés par le cliché du
       * panneau mural ») ne tient plus : les fiches portent des photos
       * produit détourées. Le haut de page est ce que le CLIENT du
       * restaurateur voit en premier, et c'est le meilleur portrait qu'on
       * ait.
       *
       * LA SOURCE. On vise `/r/demo?demo=1` et non la carte de Class'Food,
       * pour deux raisons qui vont dans le même sens. D'abord l'affiche doit
       * montrer ce que le clic « Essayer » fera apparaître : c'est CETTE
       * page-là que la vitrine embarque dans son cadre. Ensuite la démo a une
       * horloge figée en plein service — la vraie carte photographiée un soir
       * après 22h30 affiche « Fermé · réouvre demain à 18h00 », et une
       * vitrine ne montre pas le produit endormi.
       *
       * Les deux bandeaux de démonstration sont masqués LE TEMPS DE LA PHOTO :
       * ce sont des habillages de la page hôte, pas du contenu, et ils
       * mangeraient 111 px sur 844. Ils restent évidemment présents dans le
       * cadre vivant, dès la première interaction.
       */
      /*
       * UNE FEUILLE DE STYLE, ET UN CIBLAGE PAR CLASSE — pas par texte.
       *
       * Deux essais ont échoué avant celui-ci, et chacun apprend quelque chose.
       * Le premier posait `el.style.display = 'none'` : React réhydrate pendant
       * le `settle` qui suit et RECRÉE ces nœuds, emportant l'attribut. Une
       * règle CSS, elle, s'applique aussi au nœud qui n'existe pas encore.
       * Le second cherchait les bandeaux par leur TEXTE, et les deux libellés
       * mentent dans le DOM : la barre de retour vaut « ←Retour au site » sans
       * espace après la flèche, et « DÉMONSTRATION » s'écrit « Démonstration »
       * — les capitales viennent du CSS. On cible donc les classes, qui, elles,
       * disent la vérité.
       */
      await page.addStyleTag({
        content:
          '[class*="border-accent/25"], [class*="justify-between"][class*="border-b"]' +
          ' { display: none !important; }',
      });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(600);
    },
    settle: 2000,
  });

  await browser.close();

  // L'écran de vitrine ne doit pas rester dans le parc du restaurant.
  if (screen) {
    const res = await fetch(`${API}/screens/${screen.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => null);
    console.log(`  écran éphémère supprimé (${res ? res.status : 'échec réseau'})`);
  }

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
