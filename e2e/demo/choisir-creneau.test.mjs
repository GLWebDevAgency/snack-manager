/** Contre-épreuves locales du harnais : aucune navigation ni API distante. */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { choisirCreneau } from '../socle/choisir-creneau.mjs';

let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

async function grille(run) {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  try {
    await context.route('**/*', (route) => route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(600);
    await page.setContent(`
      <section role="dialog" aria-label="Créneau de retrait">
        <div id="slots">
          <button aria-pressed="false">18:00</button>
          <button aria-pressed="false">18:10</button>
        </div>
        <button id="next" disabled>Choisissez un créneau</button>
        <output id="chosen"></output>
      </section>
    `);
    await page.evaluate(() => {
      const next = document.querySelector('#next');
      for (const button of document.querySelectorAll('#slots button')) {
        button.addEventListener('click', () => {
          for (const slot of document.querySelectorAll('#slots button')) {
            slot.setAttribute('aria-pressed', String(slot === button));
          }
          document.querySelector('#chosen').textContent = button.textContent;
          next.textContent = `Continuer · retrait ${document.body.dataset.wrongHour ?? button.textContent}`;
          next.disabled = false;
        });
      }
      next.addEventListener('click', () => { document.body.dataset.continued = 'true'; });
    });
    await run(page, page.getByRole('dialog', { name: 'Créneau de retrait' }));
  } finally {
    await context.close();
  }
}

test('Créneau — garde la même heure quand la grille change d’ordre après lecture', async () => {
  await grille(async (page, retrait) => {
    const heure = await retrait.getByRole('button', { name: /^\d{2}:\d{2}$/ }).first().textContent();
    // Barrière déterministe entre observation et clic : 18:10 devient premier.
    await page.evaluate(() => {
      const slots = document.querySelector('#slots');
      slots.append(slots.firstElementChild);
    });
    await choisirCreneau(retrait, heure);
    assert.equal(await page.locator('#chosen').textContent(), '18:00');
    assert.equal(await page.locator('body').getAttribute('data-continued'), 'true');
  });
});

test('Créneau — refuse une heure disparue au lieu de cliquer une autre disponibilité', async () => {
  await grille(async (page, retrait) => {
    const heure = await retrait.getByRole('button', { name: '18:00', exact: true }).textContent();
    await page.locator('#slots button').first().evaluate((button) => button.remove());
    await assert.rejects(choisirCreneau(retrait, heure), /18:00/);
    assert.equal(await page.locator('#chosen').textContent(), '');
    assert.equal(await page.locator('body').getAttribute('data-continued'), null);
  });
});

test('Créneau — refuse de continuer quand le bouton suivant rappelle une autre heure', async () => {
  await grille(async (page, retrait) => {
    await page.evaluate(() => { document.body.dataset.wrongHour = '18:10'; });
    await assert.rejects(choisirCreneau(retrait, '18:00'), /Continuer · retrait 18:00/);
    assert.equal(await page.locator('#chosen').textContent(), '18:00');
    assert.equal(await page.locator('body').getAttribute('data-continued'), null);
  });
});
