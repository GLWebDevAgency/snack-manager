/**
 * La matrice du masque — 6 directions × 3 surfaces × 3 cadres = 54 captures.
 *
 * Preuve visuelle que `styleDuMasque()` retisse vraiment une surface client,
 * et pas seulement un jeton isolé : les six directions de
 * `packages/contracts/src/marque.ts` (`DIRECTIONS`), sur trois vues qui
 * portent chacune leur propre masque, à trois largeurs de référence.
 *
 *   pnpm --filter @sm/web build && pnpm --filter @sm/web start
 *   node scripts/capture-masque.mjs
 *
 * CONTRE UN BUILD, JAMAIS CONTRE `next dev` : le mode développement pose son
 * badge « N » en bas à gauche de CHAQUE page, et il se retrouve sur les 54
 * PNG — une preuve visuelle ne porte pas l'outillage de celui qui la produit.
 *
 * ─── LE LEVIER : `?masque=<direction>` ───
 *
 * La démonstration ne porte qu'UNE marque en fixture (Nuit,
 * `apps/web/src/components/order/demo/fixture.ts`) : prouver les six
 * directions exigerait sinon six tenants. Le patron maison (`capture-shots.mjs`)
 * intercepterait la réponse réseau du tenant — mais les trois surfaces d'ici
 * n'ont RIEN à intercepter :
 *
 *   - la vitrine et le tunnel (`Storefront`, via `DemoStorefront`) tournent
 *     sur un transport EN MÉMOIRE (`demo/transport.ts`), jamais sur le
 *     réseau ;
 *   - la fidélité de démonstration (`DemoLoyaltyCard`) ne lit même pas de
 *     marque : c'est un aperçu générique, jamais relié à un programme réel
 *     (le composant qui porte le vrai masque, `LoyaltyCardApp`, exige une
 *     carte réelle et un cookie de session — hors d'atteinte d'un script).
 *
 * D'où le second levier, ajouté aux deux composants
 * (`apps/web/src/components/masque/masqueDeCapture.ts`,
 * `Storefront.tsx`, `DemoLoyaltyCard.tsx`) : `?masque=<direction>`, lu
 * UNIQUEMENT côté client et UNIQUEMENT quand la page est en démonstration —
 * jamais sur la page d'un vrai restaurant.
 *
 * ─── LE TUNNEL NE S'OUVRE PAS PAR L'ADRESSE ───
 *
 * `tunnel` est un état React posé par un clic sur « Voir mon panier » — ni un
 * fragment `#panier`, ni aucun paramètre ne l'ouvrent. Le script reproduit
 * donc le geste du client : un produit SANS option (ajout direct au premier
 * appui, `Storefront.pick()`) puis le bouton flottant du panier.
 *
 * ─── TROIS RÈGLES DE QUALITÉ, REPRISES DE `capture-shots.mjs` ───
 *
 *  1. on attend un marqueur de contenu réel avant de photographier, jamais un
 *     délai fixe ;
 *  2. le contexte est ouvert en `prefers-reduced-motion` : les animations
 *     d'entrée sont déjà à leur état final sur la photo ;
 *  3. chaque PNG est relu après écriture — une surface vide en capture est
 *     pire que pas de capture du tout.
 *
 * Et une quatrième, propre à cette matrice : AUCUN débordement horizontal
 * n'est toléré — la matrice sert aussi de garde responsive. Il se mesure sur
 * les RECTANGLES des éléments, jamais sur `scrollWidth` (voir plus bas : les
 * racines client rognent, et une garde qui ne peut pas échouer n'en est pas
 * une).
 */
import { chromium } from 'playwright';
import { mkdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { DIRECTIONS, PRESET_KEYS } = require(resolve(root, 'packages/contracts/dist/index.js'));

const BASE = process.env.SM_WEB_URL ?? 'http://localhost:3000';
const OUT = resolve(root, 'docs/superpowers/captures/masque');
const MIN_BYTES = 30_000;

/** Trois cadres de référence — mêmes largeurs que `capture-shots.mjs`. */
const CADRES = {
  telephone: [390, 844],
  tablette: [768, 1024],
  ordinateur: [1440, 900],
};

/**
 * Trois surfaces. Chacune sait ATTEINDRE son état photographiable — un simple
 * marqueur de texte pour la vitrine et la fidélité, une petite chorégraphie
 * de clics pour le tunnel (voir plus haut).
 */
const SURFACES = {
  vitrine: {
    url: '/r/demo?demo=1',
    async ready(page) {
      await page.getByText('Commander', { exact: false }).first().waitFor({ timeout: 30_000 });
    },
  },
  tunnel: {
    url: '/r/demo?demo=1',
    async ready(page) {
      await page.getByText('Commander', { exact: false }).first().waitFor({ timeout: 30_000 });
      // Produit SANS option : un appui suffit, `Storefront.pick()` l'ajoute
      // directement — pas de fiche à composer.
      const produit = page.locator('[aria-label$="ajouter au panier"]').first();
      await produit.waitFor({ state: 'visible', timeout: 30_000 });
      const barrePanier = page.getByText('Voir mon panier', { exact: false }).first();
      /*
       * PIÈGE VÉRIFIÉ (deux échecs mesurés, sur deux cadres différents) : le
       * HTML du produit est déjà là au rendu serveur, donc `waitFor`
       * ({state:'visible'}) réussit AVANT que React n'ait attaché son
       * gestionnaire de clic — le premier appui tombe alors dans le vide, et
       * la barre de panier flottante n'apparaît jamais. On retente donc le
       * clic jusqu'à ce qu'elle apparaisse — un second appui sur un article
       * déjà au panier ne fait qu'incrémenter sa quantité, sans casser la
       * capture.
       */
      let ouverte = false;
      for (let tentative = 0; tentative < 10 && !ouverte; tentative++) {
        await produit.click();
        ouverte = await barrePanier
          .waitFor({ state: 'visible', timeout: 1_500 })
          .then(() => true)
          .catch(() => false);
      }
      if (!ouverte) throw new Error("le panier ne s'ouvre pas — page non hydratée après 10 tentatives");
      await barrePanier.click();
      // « Continuer » ne s'affiche qu'à l'étape « Panier » du tunnel, panier
      // non vide — la preuve que la feuille est bien ouverte et garnie.
      await page.getByText('Continuer', { exact: false }).first().waitFor({ timeout: 30_000 });
    },
  },
  fidelite: {
    url: '/r/demo/fidelite?demo=1',
    async ready(page) {
      await page
        .getByText('Récompenses du moment', { exact: false })
        .first()
        .waitFor({ timeout: 30_000 });
    },
  },
};

const failures = [];
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();

for (const direction of PRESET_KEYS) {
  if (!(direction in DIRECTIONS)) {
    failures.push(`${direction} : absente de DIRECTIONS — contrat rompu`);
    continue;
  }
  for (const [surface, { url, ready }] of Object.entries(SURFACES)) {
    for (const [cadre, [width, height]] of Object.entries(CADRES)) {
      const name = `${direction}-${surface}-${cadre}`;
      const context = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: 2,
        locale: 'fr-FR',
        timezoneId: 'Europe/Paris',
        // Les animations d'entrée sont alors déjà à leur état final : on ne
        // photographie jamais une carte à moitié fondue.
        reducedMotion: 'reduce',
        isMobile: width < 500,
        hasTouch: width < 500,
      });
      const page = await context.newPage();
      try {
        const sep = url.includes('?') ? '&' : '?';
        await page.goto(`${BASE}${url}${sep}masque=${direction}`, {
          waitUntil: 'domcontentloaded',
          timeout: 60_000,
        });
        await ready(page);
        await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
        // La souris est renvoyée hors des zones interactives : aucun état
        // « survolé » ne doit rester allumé sur la photo.
        await page.mouse.move(width - 2, height - 2);
        await page.waitForTimeout(800);
        // ── LA GARDE RESPONSIVE ──────────────────────────────────────
        // `documentElement.scrollWidth` ne pouvait JAMAIS dépasser le
        // viewport : chaque racine client pose `overflow-x-clip`, qui rogne
        // le débordement bien avant qu'il atteigne le document. La garde
        // était verte par construction. Les rectangles, eux, ignorent le
        // rognage : on cherche le bord droit le plus lointain de la page, et
        // on NOMME l'élément fautif — un pixel de trop sans son coupable
        // n'est pas actionnable. 1 px de tolérance : les demi-pixels d'un
        // deviceScaleFactor de 2 ne sont pas un défaut de mise en page.
        const deborde = await page.evaluate(() => {
          const limite = window.innerWidth;
          let pire = null;
          for (const el of document.querySelectorAll('body *')) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            const trop = Math.round(r.right - limite);
            if (trop <= 1 || (pire && trop <= pire.trop)) continue;
            const classes = typeof el.className === 'string' ? el.className.trim() : '';
            pire = {
              trop,
              quoi:
                el.tagName.toLowerCase() +
                (el.id ? `#${el.id}` : '') +
                (classes ? `.${classes.split(/\s+/).slice(0, 3).join('.')}` : ''),
            };
          }
          return pire;
        });
        if (deborde) {
          throw new Error(`débordement horizontal de ${deborde.trop}px — ${deborde.quoi}`);
        }
        const path = resolve(OUT, `${name}.png`);
        // `fullPage: false` — cadrer la FENÊTRE, pas la page. Mesuré (revue,
        // tour 1) : le tunnel est un `Sheet` en `position: fixed`, mais
        // Chromium compose `fullPage` contre la hauteur totale du DOM sous-
        // jacent, pas contre le viewport visible ; sur cette page-là, ce DOM
        // grimpe à 20 000+ px (ordinateur) et 39 000+ px (téléphone), et la
        // feuille se retrouve composée à 75–85 % de l'image — hors du cadre
        // que quiconque regarde. `fullPage: false` capture exactement ce que
        // montre le viewport déclaré plus haut (`CADRES`), là où la feuille
        // est réellement ancrée à l'écran.
        await page.screenshot({ path, fullPage: false, animations: 'disabled' });
        const { size } = await stat(path);
        if (size < MIN_BYTES) throw new Error(`${size} o — surface probablement vide`);
        console.log(`  ✓ ${name} — ${(size / 1024).toFixed(0)} Ko`);
      } catch (e) {
        failures.push(`${name} : ${e.message}`);
        console.error(`  ✗ ${name} — ${e.message}`);
      } finally {
        await context.close();
      }
    }
  }
}
await browser.close();

if (failures.length) {
  console.error(`\n${failures.length} capture(s) en échec :\n  ${failures.join('\n  ')}`);
  process.exitCode = 1;
} else {
  console.log(`\n54 captures dans ${OUT}`);
}
