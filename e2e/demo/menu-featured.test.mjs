import assert from 'node:assert/strict';
import { cibles } from '../socle/cibles.mjs';
import { attendreTexte } from '../socle/attentes.mjs';
import { FORMATS, scenario } from '../socle/navigateur.mjs';

const { web } = cibles();

for (const format of [FORMATS.comptoir, FORMATS.telephone]) {
  scenario(`Carte — sélection éditoriale ordonnée, limite et brouillon préservé (${format.width}px)`, { format }, async (page) => {
    await page.goto(`${web}/admin/menu?demo=1`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Modifier Kebab', exact: true }).click();
    const description = page.locator('input[id^="edit-desc-"]');
    await description.fill('Brouillon de description à préserver');
    await page.getByRole('button', { name: 'Mettre en avant', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'À l’affiche · Sandwichs', exact: true });
    const selected = dialog.getByRole('list', { name: 'Produits mis en avant', exact: true });
    assert.equal(await selected.getByRole('listitem').count(), 1);
    await dialog.getByRole('button', { name: 'Mettre en avant Merguez', exact: true }).click();
    await dialog.getByRole('button', { name: 'Mettre en avant Végétarien', exact: true }).click();
    assert.equal(await selected.getByRole('listitem').count(), 3);
    assert.equal(await dialog.getByRole('button', { name: 'Mettre en avant 2 Steaks', exact: true }).isDisabled(), true);
    await dialog.getByRole('button', { name: 'Monter Merguez', exact: true }).click();
    assert.match(await selected.getByRole('listitem').first().textContent(), /Merguez/);
    await dialog.getByRole('button', { name: 'Enregistrer la sélection', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await attendreTexte(page, 'Sélection enregistrée · TV et en ligne');
    assert.equal(await description.inputValue(), 'Brouillon de description à préserver', 'la mise en avant ne doit pas réinitialiser la fiche ouverte');
    await page.getByRole('button', { name: 'Gérer la mise en avant', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'À l’affiche · Sandwichs', exact: true });
    const restored = dialog.getByRole('list', { name: 'Produits mis en avant', exact: true });
    assert.equal(await restored.getByRole('listitem').count(), 3);
    assert.match(await restored.getByRole('listitem').first().textContent(), /Merguez/);
    await dialog.getByRole('button', { name: 'Retirer Merguez de la sélection', exact: true }).click();
    await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
    await page.getByRole('button', { name: 'Gérer la mise en avant', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'À l’affiche · Sandwichs', exact: true });
    assert.equal(await dialog.getByRole('list', { name: 'Produits mis en avant', exact: true }).getByRole('listitem').count(), 3, 'Annuler ne modifie pas la sélection enregistrée');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false, 'la sélection reste utilisable sans débordement horizontal');
    await dialog.getByRole('button', { name: 'Annuler', exact: true }).click();
    await page.getByRole('button', { name: 'Nouveauté', exact: true }).click();
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await attendreTexte(page, 'Produit enregistré');
    await page.getByText('Kebab', { exact: true }).locator('..').getByText('Nouveau', { exact: true }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Modifier Kebab', exact: true }).click();
    assert.equal(await page.locator('input[id^="edit-desc-"]').inputValue(), 'Brouillon de description à préserver');
    assert.equal(await page.getByRole('button', { name: 'Nouveauté', exact: true }).getAttribute('aria-pressed'), 'true');
  });
}
