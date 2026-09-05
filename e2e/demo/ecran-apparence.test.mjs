/**
 * L'aperçu TV dans la vraie interface de démonstration : les tuiles sont
 * peintes, le transport arrête réellement le mouvement, et seul Enregistrer
 * change l'écran. Aucun jeton ni appel d'écriture vers une API réelle.
 */
import assert from 'node:assert/strict';
import { cibles } from '../socle/cibles.mjs';
import { attendreTexte } from '../socle/attentes.mjs';
import { FORMATS, scenario } from '../socle/navigateur.mjs';

const { web } = cibles();
const NOM = 'Écran comptoir';
const APERCU = '[data-testid="apercu-ecran"]';

function carteDe(page) {
  return page.locator('div')
    .filter({ has: page.getByRole('heading', { name: NOM, exact: true, includeHidden: true }) })
    .filter({ has: page.getByRole('button', { name: 'Apparence', exact: true, includeHidden: true }) })
    .last();
}

async function ouvrirApparence(page) {
  await carteDe(page).getByRole('button', { name: 'Apparence', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: `Apparence — ${NOM}`, exact: true });
  await attendreTexte(drawer, 'Aperçu à jour');
  await page.evaluate(() => document.fonts.ready);
  return drawer;
}

/** Échantillonne plusieurs frames : la stabilité dans le temps est ici l'assertion. */
async function mesurerProgression(progress, durationMs) {
  return progress.evaluate((element, duration) => new Promise((resolve) => {
    const start = performance.now();
    const samples = [];
    const sample = () => {
      samples.push(new DOMMatrixReadOnly(getComputedStyle(element).transform).a);
      if (performance.now() - start >= duration) resolve(samples);
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }), durationMs);
}

scenario(
  'Écrans TV — tuiles visibles, pause réelle et enregistrement explicite en démo',
  { format: FORMATS.comptoir, delai: 180_000 },
  async (page) => {
    // Le socle réduit habituellement les animations. Ce scénario vérifie leur
    // comportement normal : le mode réduit masquerait les régressions du transport.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const externalWrites = [];
    await page.route('**/*', (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && url.origin !== new URL(web).origin) {
        externalWrites.push(`${request.method()} ${url.pathname}`);
        return route.abort();
      }
      return route.continue();
    });

    await page.goto(`${web}/admin/screens?demo=1`, { waitUntil: 'domcontentloaded' });
    await carteDe(page).getByText('Ardoise', { exact: true }).waitFor({ state: 'visible' });
    let drawer = await ouvrirApparence(page);
    assert.ok(await page.evaluate(() => document.fonts.size > 0), 'la vraie application déclare ses polices');

    // `visible` de Playwright ne suffit pas à détecter une couche transparente.
    // On examine les styles composés, y compris chaque ancêtre de la scène.
    await page.waitForFunction(() => {
      const roots = [...document.querySelectorAll('.bd-root[data-still="1"]')];
      if (roots.length !== 2) return false;
      return roots.every((root) => {
        const layer = root.querySelector('.bd-stage[data-ready="1"] .bd-layer[data-phase="in"]');
        const title = layer?.querySelector('.bd-title, .ct-title, .bd-plate-title');
        if (!layer || !title?.textContent.trim()) return false;
        const box = layer.getBoundingClientRect();
        if (box.width <= 0 || box.height <= 0) return false;
        let opacity = 1;
        for (let element = title; element; element = element.parentElement) {
          const style = getComputedStyle(element);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          opacity *= Number(style.opacity);
        }
        return opacity > 0.98;
      });
    });

    // Le temps est déjà engagé avant Pause : le test distingue une pause
    // d'un redémarrage de l'animation ou d'une scène complète à la reprise.
    await page.waitForFunction((selector) => {
      const bar = document.querySelector(`${selector} .bd-progress-fill`);
      if (!bar) return false;
      const scale = new DOMMatrixReadOnly(getComputedStyle(bar).transform).a;
      return scale > 0.28 && scale < 0.48;
    }, APERCU);
    await drawer.getByRole('button', { name: 'Mettre en pause', exact: true }).click();
    await page.locator(`${APERCU} .bd-root[data-paused="1"]`).waitFor({ state: 'attached' });
    const progress = page.locator(`${APERCU} .bd-progress-fill`);
    const paused = await mesurerProgression(progress, 650);
    assert.ok(paused.length >= 2, 'plusieurs frames ont été observées pendant la pause');
    assert.ok(Math.max(...paused) - Math.min(...paused) < 0.002, 'la progression reste figée en pause');
    const heldScale = paused.at(-1);
    const durationMs = await progress.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).getPropertyValue('--bd-dur')));
    const originalBar = await progress.elementHandle();

    await drawer.getByRole('button', { name: 'Reprendre la boucle', exact: true }).click();
    const resumed = await mesurerProgression(progress, 350);
    assert.ok(Math.min(...resumed) >= heldScale - 0.002, 'la reprise conserve la position de lecture');
    assert.ok(resumed.at(-1) > heldScale + 0.01, 'la progression reprend effectivement');
    const remainingMs = durationMs * (1 - heldScale);
    await page.waitForFunction((element) => !element.isConnected, originalBar, {
      timeout: Math.ceil(remainingMs + 1_200),
    });

    // Choisir est un brouillon : même si l'aperçu a changé, la carte de
    // l'écran conserve Ardoise, puis Annuler / Abandonner la laisse intacte.
    await drawer.getByRole('button', { name: 'Comptoir', exact: true }).click();
    await page.locator(`${APERCU} .bd-root[data-scenography="comptoir"]`).waitFor({ state: 'attached' });
    await attendreTexte(drawer, 'Aperçu à jour');
    assert.equal(await carteDe(page).getByText('Ardoise', { exact: true }).count(), 1);
    await drawer.getByRole('button', { name: 'Annuler', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'Abandonner les modifications ?', exact: true });
    await confirmation.getByRole('button', { name: 'Abandonner', exact: true }).click();
    await drawer.waitFor({ state: 'hidden' });
    await carteDe(page).getByText('Ardoise', { exact: true }).waitFor({ state: 'visible' });

    drawer = await ouvrirApparence(page);
    await page.locator(`${APERCU} .bd-root[data-scenography="ardoise"]`).waitFor({ state: 'attached' });
    await drawer.getByRole('button', { name: 'Comptoir', exact: true }).click();
    await page.locator(`${APERCU} .bd-root[data-scenography="comptoir"]`).waitFor({ state: 'attached' });
    await attendreTexte(drawer, 'Aperçu à jour');
    await drawer.getByRole('button', { name: "Enregistrer l'apparence", exact: true }).click();
    await attendreTexte(page, 'Apparence enregistrée');
    await drawer.waitFor({ state: 'hidden' });
    await carteDe(page).getByText('Comptoir', { exact: true }).waitFor({ state: 'visible' });

    // Le lecteur relit bien le choix enregistré ; fermer sans changement
    // garde ce choix. Le contexte neuf du socle isole entièrement la démo.
    drawer = await ouvrirApparence(page);
    await page.locator(`${APERCU} .bd-root[data-scenography="comptoir"]`).waitFor({ state: 'attached' });
    await drawer.getByRole('button', { name: 'Fermer', exact: true }).filter({ hasText: /^Fermer$/ }).click();
    await drawer.waitFor({ state: 'hidden' });
    await carteDe(page).getByText('Comptoir', { exact: true }).waitFor({ state: 'visible' });
    assert.deepEqual(externalWrites, [], 'la démonstration ne tente aucune écriture vers une API réelle');
  },
);
