/** Vrai POS et transport volatil démo ; aucune affectation sur une API réelle. */
import assert from 'node:assert/strict';
import { cibles } from '../socle/cibles.mjs';
import { FORMATS, scenario } from '../socle/navigateur.mjs';
const { pos } = cibles();
scenario('Caisse — affecter une livraison prête sans confirmer son départ', { format: FORMATS.comptoir }, async (page, { incidents }) => {
  const writes = [];
  page.on('request', request => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push([request.method(), new URL(request.url()).pathname]); });
  await page.goto(`${pos}/?demo=1`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: /^Le service/ }).first().click();
  await page.getByRole('button', { name: /^Commande 900,/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Commande 900', exact: true });
  const confirm = dialog.getByRole('button', { name: 'Confirmer l’affectation', exact: true });
  await confirm.waitFor();
  assert.equal(await confirm.isDisabled(), true, 'un livreur doit être choisi explicitement');
  await dialog.getByRole('radio', { name: 'Choisir le livreur Samir', exact: true }).click();
  await confirm.focus(); await page.keyboard.press('Enter');
  await dialog.getByText('Affectation confirmée.', { exact: true }).waitFor();
  await dialog.getByText('Samir', { exact: true }).waitFor();
  assert.match(await dialog.innerText(), /Le départ reste à confirmer/);
  assert.equal(await dialog.getByRole('radio').count(), 0, 'la caisse ne remplace pas une affectation confirmée');
  assert.equal(await dialog.getByRole('button', { name: /Confirmer la remise/ }).count(), 0);
  await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: /^Commande 900,/ }).click();
  await dialog.getByText('Samir', { exact: true }).waitFor();
  assert.match(await dialog.innerText(), /Le départ reste à confirmer/);
  assert.deepEqual(writes, [], 'les écritures de démonstration restent entièrement en mémoire');
  assert.equal(incidents.filter(message => message.startsWith('page:')).length, 0);
});
