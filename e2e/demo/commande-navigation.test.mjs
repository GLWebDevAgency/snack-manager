import assert from 'node:assert/strict';
import { cibles } from '../socle/cibles.mjs';
import { cliquerJusqua, deborde } from '../socle/attentes.mjs';
import { scenario } from '../socle/navigateur.mjs';

const { web } = cibles();

for (const width of [320, 820, 1440]) {
  scenario(`Commande — panier et recherche conservés entre onglets à ${width} px`, {
    format: { width, height: width === 320 ? 568 : 900 },
  }, async page => {
    await page.goto(`${web}/r/demo?demo=1`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Le Comptoir', level: 1 }).waitFor();
    const menu = page.getByRole('region', { name: 'Sandwichs', exact: true });
    const fiche = page.getByRole('dialog', { name: 'Kebab', exact: true });
    await cliquerJusqua(menu.getByRole('article', { name: 'Kebab', exact: true }).getByRole('button', { name: /composer$/ }), fiche);
    await fiche.getByRole('radio', { name: /^Galette/ }).click();
    await fiche.getByRole('button', { name: 'Samouraï' }).click();
    await fiche.getByRole('button', { name: /^Ajouter.*8,00\s*€/ }).click();
    await fiche.waitFor({ state: 'hidden' });
    const panier = page.getByRole('button', { name: /Voir mon panier/ });
    await panier.waitFor();
    for (const name of ['Rechercher', 'Commandes', 'Carte', 'Rechercher']) {
      await page.getByRole('tab', { name, exact: true }).click();
      await page.getByRole('tab', { name, exact: true }).and(page.locator('[aria-selected="true"]')).waitFor();
      if (name === 'Rechercher') {
        const input = page.getByRole('searchbox', { name: 'Rechercher dans la carte', exact: true });
        await input.waitFor();
        if (!await input.inputValue()) await input.fill('végétarien');
        assert.equal(await input.inputValue(), 'végétarien');
        await page.getByRole('article', { name: 'Végétarien', exact: true }).waitFor();
      }
      assert.equal(await deborde(page), false);
      assert.match(await panier.textContent(), /8,00\s*€/);
    }
    const commande = page.getByRole('dialog', { name: 'Votre commande', exact: true });
    await panier.click(); await commande.waitFor();
    await page.setViewportSize({ width: width === 1440 ? 390 : 1024, height: width === 1440 ? 844 : 768 });
    assert.equal(await deborde(page), false);
    const article = commande.getByRole('article').first();
    assert.match(await article.textContent(), /Galette.*Samouraï/);
    assert.match(await article.textContent(), /8,00\s*€/);
    await commande.getByRole('button', { name: 'Fermer', exact: true }).click();
    await commande.waitFor({ state: 'hidden' });
    await page.goBack();
    await page.getByRole('tab', { name: 'Carte', exact: true }).and(page.locator('[aria-selected="true"]')).waitFor();
    assert.match(await panier.textContent(), /8,00\s*€/);
  });
}
