import assert from 'node:assert/strict';

/**
 * L’identité est l’heure observée, jamais la position dans une grille vivante.
 * Si elle disparaît, le test échoue : il ne choisit pas une autre heure à sa place.
 */
export async function choisirCreneau(retrait, heure) {
  assert.match(heure ?? '', /^\d{2}:\d{2}$/, 'le créneau doit être une heure lisible');
  const choix = retrait.getByRole('button', { name: heure, exact: true });
  await choix.click();
  await choix.and(retrait.locator('[aria-pressed="true"]')).waitFor({ state: 'visible' });
  await retrait.getByRole('button', { name: `Continuer · retrait ${heure}`, exact: true }).click();
}
