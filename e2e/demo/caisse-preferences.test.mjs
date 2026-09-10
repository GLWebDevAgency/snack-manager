/**
 * Les préférences de présentation ne doivent ni vider ni recalculer un ticket.
 * Ces scénarios jouent le transport de démonstration dans un contexte neuf :
 * ils prouvent les interactions du POS, sans prétendre valider une vraie API.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cibles } from '../socle/cibles.mjs';
import { attendreMontant, deborde } from '../socle/attentes.mjs';
import { FORMATS, scenario } from '../socle/navigateur.mjs';

const { pos } = cibles();
const PRODUIT = 'Compose ton Tacos';
const NOTE_LIGNE = 'Bien cuit, sauce à part';
const NOTE_TICKET = 'Commande à préparer ensemble';

function configuration(page) {
  return page.getByRole('dialog', { name: `Configurer ${PRODUIT}`, exact: true })
    .or(page.getByRole('region', { name: `Configurer ${PRODUIT}`, exact: true }));
}

async function ouvrirCaisse(page) {
  await page.goto(`${pos}/?demo=1`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Paramètres du poste', exact: true }).waitFor({ state: 'visible' });
  await page.evaluate(async () => { await document.fonts.ready; await document.fonts.load('700 16px Inter'); });
}

async function preferences(page, { disposition, theme } = {}) {
  await page.getByRole('button', { name: 'Paramètres du poste', exact: true }).click();
  const panneau = page.getByRole('dialog', { name: 'Paramètres du poste', exact: true });
  await panneau.waitFor({ state: 'visible' });
  if (disposition) {
    const nom = new RegExp(`^${disposition} · `);
    await panneau.getByRole('radio', { name: nom }).click();
    await panneau.getByRole('radio', { name: nom, checked: true }).waitFor({ state: 'visible' });
  }
  if (theme) {
    await panneau.getByRole('tab', { name: theme, exact: true }).click();
    await panneau.getByRole('tab', { name: theme, exact: true, selected: true }).waitFor({ state: 'visible' });
  }
  await panneau.getByRole('button', { name: 'Fermer', exact: true }).last().click();
  await panneau.waitFor({ state: 'hidden' });
}

async function composerTacos(page, { dense = false } = {}) {
  await page.getByRole('tab', { name: PRODUIT, exact: true }).click();
  await page.getByRole('button', {
    name: dense ? `Ajouter ${PRODUIT}` : new RegExp(`^${PRODUIT},`),
    exact: dense,
  }).click();
  const panneau = configuration(page);
  await panneau.waitFor({ state: 'visible' });
  assert.equal(await panneau.getByRole('button', { name: 'Complétez la configuration', exact: true }).isDisabled(), true,
    'le + de la liste dense doit ouvrir les options obligatoires, sans ajouter un produit incomplet');
  await panneau.getByRole('checkbox', { name: /^M — 1 viande/ }).click();
  await panneau.getByRole('checkbox', { name: 'Kebab, Inclus', exact: true }).click();
  await panneau.getByRole('checkbox', { name: /^Cheddar/ }).click();
  await panneau.getByRole('checkbox', { name: 'sans sauce fromagère', exact: true }).click();
  await panneau.getByRole('textbox', { name: 'Bien cuit, sauce à part…', exact: true }).fill(NOTE_LIGNE);
  await panneau.getByRole('button', { name: 'Ajouter · 9,90 €', exact: true }).click();
  await panneau.waitFor({ state: 'hidden' });
}

async function ticketIntact(portee, montant = '19,80 €', { note = true } = {}) {
  const ligne = portee.getByRole('button', { name: `Modifier ${PRODUIT}`, exact: true });
  await ligne.waitFor({ state: 'visible' });
  assert.equal(await ligne.count(), 1, 'modifier ou déplacer le ticket ne doit pas dupliquer sa ligne');
  const detail = await ligne.textContent();
  for (const attendu of ['M — 1 viande', 'Kebab', 'Cheddar', NOTE_LIGNE]) {
    assert.ok(detail?.includes(attendu), `la configuration doit conserver « ${attendu} » : ${JSON.stringify(detail)}`);
  }
  assert.match(detail ?? '', /sans\s+sauce/i, 'le retrait d’ingrédient doit rester présent');
  await attendreMontant(portee, 'Total', montant);
  if (note) {
    assert.equal(await portee.getByRole('textbox', { name: 'Note cuisine (allergie, à part…)', exact: true }).inputValue(), NOTE_TICKET,
      'la note du ticket doit survivre au changement de présentation');
  }
}

async function preuve(page, nom) {
  // Opt-in pour la recette locale ; aucun artefact supplémentaire dans le dépôt.
  if (!process.env.SM_E2E_CAPTURES) return;
  await page.evaluate(() => document.fonts.ready);
  await mkdir(process.env.SM_E2E_CAPTURES, { recursive: true });
  await page.screenshot({ path: resolve(process.env.SM_E2E_CAPTURES, `${nom}.png`), fullPage: true });
}

for (const [depart, arrivee] of [[1280, 820], [820, 1280]]) {
  scenario(`Caisse — modale persistante ${depart} vers ${arrivee}, focus et fermeture après rotation`,
    { format: { width: depart, height: 900 } }, async (page, { incidents }) => {
      await ouvrirCaisse(page);
      const declencheur = page.getByRole('button', { name: 'Paramètres du poste', exact: true });
      const panneau = page.getByRole('dialog', { name: 'Paramètres du poste', exact: true });
      const isolationInitiale = await page.evaluateHandle(() => ({
        inert: document.querySelectorAll('[inert]').length,
        overflow: document.body.style.overflow,
        // Les icônes décoratives diffèrent selon la largeur : comparer les
        // attributs des nœuds survivants, pas le nombre global d'aria-hidden.
        nodes: Array.from(document.querySelectorAll('[aria-hidden]')).map((element) => ({
          element, hidden: element.getAttribute('aria-hidden'),
        })),
      }));
      await declencheur.click();
      await panneau.waitFor({ state: 'visible' });
      await panneau.getByRole('tab', { name: 'Clair', exact: true }).click();
      await page.setViewportSize({ width: arrivee, height: 900 });
      // Le même dialogue reste ouvert, mais sa racine passe réellement d'un
      // enfant du POS à un portail body (ou inversement). Un test de panneau
      // inline remplacé par Overlay ne couvre pas ce cycle de vie.
      await page.waitForFunction((compact) => {
        const dialogue = document.querySelector('[role="dialog"][aria-label="Paramètres du poste"]');
        return !!dialogue && (dialogue.parentElement === document.body) === compact;
      }, arrivee < 900);
      await panneau.waitFor({ state: 'visible' });
      assert.equal(await panneau.evaluate((element) => !!element.closest('[inert], [aria-hidden="true"]')), false,
        'le dialogue déplacé ne doit pas rester sous une ancienne branche rendue inerte');
      await page.waitForFunction(() => {
        const dialogue = document.querySelector('[role="dialog"][aria-label="Paramètres du poste"]');
        return !!dialogue && dialogue.contains(document.activeElement);
      });
      for (const touche of ['Shift+Tab', 'Tab', 'Tab']) {
        await page.keyboard.press(touche);
        assert.equal(await panneau.evaluate((element) => element.contains(document.activeElement)), true,
          'le focus doit rester dans la modale après changement de racine');
      }
      await panneau.getByRole('tab', { name: 'Clair', exact: true, selected: true }).waitFor({ state: 'visible' });
      await preuve(page, `pos-modal-rotation-${depart}-${arrivee}`);
      await page.keyboard.press('Escape');
      await panneau.waitFor({ state: 'hidden' });
      await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Paramètres du poste');
      assert.equal(await page.evaluate((initial) =>
        document.querySelectorAll('[inert]').length === initial.inert &&
        document.body.style.overflow === initial.overflow &&
        initial.nodes.every(({ element, hidden }) => !element.isConnected || element.getAttribute('aria-hidden') === hidden),
      isolationInitiale), true, 'fermer doit restaurer l’isolation et le défilement antérieurs');
      await isolationInitiale.dispose();
      await declencheur.click();
      await panneau.getByRole('button', { name: 'Fermer', exact: true }).last().click();
      await panneau.waitFor({ state: 'hidden' });
      await declencheur.click();
      const fond = await panneau.boundingBox();
      assert.ok(fond);
      await page.mouse.click(fond.x + 2, fond.y + 2);
      await panneau.waitFor({ state: 'hidden' });
      assert.equal(await deborde(page), false);
      assert.deepEqual(incidents, [], 'aucune erreur de console ni exception navigateur');
    });
}

scenario('Caisse — espèces, double rotation et fermeture sans encaisser ni perdre le ticket',
  { format: { width: 1280, height: 900 } }, async (page, { incidents }) => {
    await ouvrirCaisse(page);
    await composerTacos(page);
    await page.getByRole('button', { name: 'Espèces', exact: true }).click();
    const especes = page.getByRole('dialog', { name: 'Encaissement espèces', exact: true });
    await especes.getByRole('checkbox', { name: '+ 20,00 €', exact: true }).click();
    for (const largeur of [820, 1280]) {
      await page.setViewportSize({ width: largeur, height: 900 });
      await page.waitForFunction((compact) => {
        const dialogue = document.querySelector('[role="dialog"][aria-label="Encaissement espèces"]');
        return !!dialogue && (dialogue.parentElement === document.body) === compact &&
          dialogue.contains(document.activeElement) && !dialogue.closest('[inert], [aria-hidden="true"]');
      }, largeur < 900);
      await attendreMontant(especes, 'Reçu', '20,00 €');
      await attendreMontant(especes, 'À rendre', '10,10 €');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await especes.evaluate((element) => element.contains(document.activeElement)), true);
      assert.equal(await especes.getByRole('button', { name: "Valider l'encaissement", exact: true }).isDisabled(), false);
    }
    await preuve(page, 'pos-modal-especes-double-rotation');
    await page.keyboard.press('Escape');
    await especes.waitFor({ state: 'hidden' });
    await attendreMontant(page, 'Total', '9,90 €');
    assert.equal(await page.getByRole('button', { name: `Modifier ${PRODUIT}`, exact: true }).count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Nouvelle commande', exact: true }).count(), 0,
      'la fermeture ne doit pas valider le paiement ni envoyer la commande');
    await page.getByRole('button', { name: 'Espèces', exact: true }).click();
    await attendreMontant(especes, 'Reçu', '0,00 €');
    await especes.getByRole('button', { name: 'Fermer', exact: true }).click();
    await especes.waitFor({ state: 'hidden' });
    assert.deepEqual(incidents, []);
  });

scenario('Caisse — préférences visuelles, édition, attente et retour du service sans perte du ticket',
  { format: FORMATS.comptoir }, async (page) => {
    await ouvrirCaisse(page);
    await preferences(page, { disposition: 'C', theme: 'Sombre' });
    await composerTacos(page, { dense: true });

    await page.getByRole('button', { name: `Modifier ${PRODUIT}`, exact: true }).click();
    const panneau = configuration(page);
    await panneau.getByRole('button', { name: 'Plus', exact: true }).click();
    await panneau.getByRole('button', { name: 'Mettre à jour · 19,80 €', exact: true }).click();
    await panneau.waitFor({ state: 'hidden' });
    await page.getByRole('textbox', { name: 'Note cuisine (allergie, à part…)', exact: true }).fill(NOTE_TICKET);
    await ticketIntact(page);

    for (const disposition of ['A', 'B', 'C']) {
      await preferences(page, { disposition });
      await ticketIntact(page);
      const ligne = await page.getByRole('button', { name: `Modifier ${PRODUIT}`, exact: true }).boundingBox();
      assert.ok(ligne, 'le ticket doit rester visible après changement de disposition');
      assert.equal(ligne.x < FORMATS.comptoir.width / 2, disposition === 'B',
        `la disposition ${disposition} doit placer le ticket du côté annoncé`);
      await preuve(page, `pos-${disposition.toLowerCase()}-ticket-conserve`);
    }

    const couleurSombre = await page.getByText('Total', { exact: true }).evaluate((element) => getComputedStyle(element).color);
    await preferences(page, { theme: 'Clair' });
    await ticketIntact(page);
    const couleurClaire = await page.getByText('Total', { exact: true }).evaluate((element) => getComputedStyle(element).color);
    assert.notEqual(couleurClaire, couleurSombre, 'le thème clair doit réellement changer l’encre du ticket');
    await preuve(page, 'pos-c-clair-ticket-conserve');
    await preferences(page, { theme: 'Sombre' });
    await ticketIntact(page);

    await page.getByRole('button', { name: 'En attente', exact: true }).click();
    await attendreMontant(page, 'Total', '0,00 €');
    const rappel = page.getByRole('button', { name: /^Rappeler le ticket P.+, 2 articles, 19,80 €/ });
    await rappel.waitFor({ state: 'visible' });
    await rappel.click();
    await ticketIntact(page);
    assert.equal(await page.getByRole('button', { name: /^Rappeler le ticket / }).count(), 0,
      'rappeler le ticket doit le retirer de la liste d’attente');

    await page.getByRole('tab', { name: /^Le service,/ }).click();
    await page.getByRole('button', { name: /^Commande \d+,/ }).first().waitFor({ state: 'visible' });
    await page.getByRole('button', { name: `Modifier ${PRODUIT}`, exact: true }).waitFor({ state: 'hidden' });
    await page.getByRole('tab', { name: 'Vendre', exact: true }).click();
    await ticketIntact(page);
    assert.equal(await deborde(page), false, 'le poste ne doit pas déborder horizontalement');
    await preuve(page, 'pos-c-retour-service-ticket-conserve');
  });

scenario('Caisse — édition inline, mutation du ticket et encaissement sans écraser le brouillon',
  { format: { width: 1280, height: 800 } }, async (page) => {
    await ouvrirCaisse(page);
    await preferences(page, { disposition: 'B' });
    await page.getByRole('tab', { name: PRODUIT, exact: true }).click();
    await page.getByRole('button', { name: new RegExp(`^${PRODUIT},`) }).click();
    const panneau = page.getByRole('region', { name: `Configurer ${PRODUIT}`, exact: true });
    await panneau.getByRole('checkbox', { name: 'Kebab, Inclus', exact: true }).click();
    await panneau.getByRole('button', { name: 'Ajouter · 8,90 €', exact: true }).click();

    const modifier = page.getByRole('button', { name: `Modifier ${PRODUIT}`, exact: true });
    await modifier.click();
    await panneau.getByRole('textbox', { name: 'Bien cuit, sauce à part…', exact: true }).fill(NOTE_LIGNE);
    // L’ancienne modale empêchait cette action ; le panneau inline la permet.
    await modifier.locator('xpath=../..').getByRole('button', { name: 'Plus', exact: true }).click();
    await panneau.waitFor({ state: 'hidden' });
    await page.getByText('La ligne a changé dans le ticket. Rouvrez-la pour poursuivre la modification.', { exact: true }).waitFor({ state: 'visible' });
    await attendreMontant(page, 'Total', '17,80 €');

    // Une autre ligne peut évoluer sans annuler le brouillon en cours.
    await page.getByRole('tab', { name: 'Barquettes', exact: true }).click();
    await page.getByRole('button', { name: /^Frites, / }).click();
    const frites = page.getByRole('region', { name: 'Configurer Frites', exact: true });
    await frites.getByRole('button', { name: 'Ajouter · 3,50 €', exact: true }).click();
    await modifier.click();
    await panneau.getByRole('textbox', { name: 'Bien cuit, sauce à part…', exact: true }).fill(NOTE_LIGNE);
    await page.getByRole('button', { name: 'Modifier Frites', exact: true }).locator('xpath=../..')
      .getByRole('button', { name: 'Plus', exact: true }).click();
    await attendreMontant(page, 'Total', '24,80 €');
    assert.equal(await panneau.getByRole('textbox', { name: 'Bien cuit, sauce à part…', exact: true }).inputValue(), NOTE_LIGNE);
    await panneau.getByRole('button', { name: 'Mettre à jour · 17,80 €', exact: true }).click();
    await panneau.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Supprimer Frites', exact: true }).click();
    await attendreMontant(page, 'Total', '17,80 €');

    // Ni Carte ni Espèces ne doivent confirmer l’ancienne quantité pendant
    // qu’une nouvelle quantité attend encore « Mettre à jour ».
    await modifier.click();
    await panneau.getByRole('button', { name: 'Plus', exact: true }).click();
    for (const paiement of ['Carte', 'Espèces']) {
      await page.getByRole('button', { name: paiement, exact: true }).click();
      await page.getByText('Validez ou fermez la configuration du produit avant de confirmer le ticket.', { exact: true }).last().waitFor({ state: 'visible' });
      await panneau.getByRole('button', { name: 'Mettre à jour · 26,70 €', exact: true }).waitFor({ state: 'visible' });
      assert.equal(await page.getByRole('dialog', { name: 'Encaissement espèces', exact: true }).count(), 0);
      assert.equal(await page.getByText('Envoyée en cuisine', { exact: true }).count(), 0);
      await attendreMontant(page, 'Total', '17,80 €');
    }
    await preuve(page, 'pos-inline-paiement-protege');
    await panneau.getByRole('button', { name: 'Mettre à jour · 26,70 €', exact: true }).click();
    await attendreMontant(page, 'Total', '26,70 €');
    await page.getByRole('button', { name: 'Carte', exact: true }).click();
    await page.getByText('Sur place · 26,70 € · Payé (carte bancaire)', { exact: true }).waitFor({ state: 'visible' });
    await preuve(page, 'pos-inline-paiement-montant-valide');
  });

scenario('Caisse — petit téléphone 320 × 568, configuration, espèces et pavé PIN accessibles',
  { format: { width: 320, height: 568 } }, async (page) => {
    await ouvrirCaisse(page);
    await preferences(page, { disposition: 'C', theme: 'Sombre' });
    await composerTacos(page, { dense: true });
    await page.getByRole('button', { name: 'Ouvrir le ticket, 1 article, total 9,90 €', exact: true }).waitFor({ state: 'visible' });
    assert.equal(await deborde(page), false);
    await preuve(page, 'pos-320-c-ticket-ajoute');

    await page.getByRole('button', { name: 'Encaisser 9,90 € en espèces', exact: true }).click();
    const especes = page.getByRole('dialog', { name: 'Encaissement espèces', exact: true });
    await especes.waitFor({ state: 'visible' });
    const valider = especes.getByRole('button', { name: "Valider l'encaissement", exact: true });
    assert.equal(await valider.isDisabled(), true);
    const bouton = await valider.boundingBox();
    assert.ok(bouton && bouton.x >= 0 && bouton.y >= 0 && bouton.x + bouton.width <= 321 && bouton.y + bouton.height <= 569,
      'la validation espèces doit rester à l’écran en 320 × 568');
    await especes.getByRole('checkbox', { name: '+ 20,00 €', exact: true }).click();
    await attendreMontant(especes, 'Reçu', '20,00 €');
    await attendreMontant(especes, 'À rendre', '10,10 €');
    await preuve(page, 'pos-320-c-especes');
    await valider.click();
    await page.getByText('Sur place · 9,90 € · Payé (espèces)', { exact: true }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Nouvelle commande', exact: true }).click();
    await page.getByRole('button', { name: 'Verrouiller', exact: true }).click();
    await page.getByText('Code équipier', { exact: true }).waitFor({ state: 'visible' });

    // Un chiffre à la fois, effacé immédiatement : on vérifie le pavé et son
    // défilement, sans tenter une authentification contre une vraie API.
    for (const chiffre of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']) {
      await page.getByRole('button', { name: chiffre, exact: true }).click();
      await page.getByRole('button', { name: 'Effacer', exact: true }).click();
    }
    await page.getByRole('button', { name: '0', exact: true }).click();
    await page.getByRole('button', { name: 'Corriger', exact: true }).click();
    assert.equal(await page.getByRole('dialog', { name: "Changer d'établissement", exact: true }).count(), 0,
      'le pied ne doit pas intercepter les touches basses du PIN');
    assert.equal(await deborde(page), false);
    await preuve(page, 'pos-320-pin-touches-accessibles');
  });

scenario('Caisse — téléphone 390 px, tiroir gauche B et édition modale sans perte du ticket',
  { format: FORMATS.telephone }, async (page) => {
    await ouvrirCaisse(page);
    await preferences(page, { disposition: 'B', theme: 'Sombre' });
    await preuve(page, 'pos-mobile-b-initial-inter');
    await composerTacos(page);

    const ouvrir = page.getByRole('button', { name: 'Ouvrir le ticket, 1 article, total 9,90 €', exact: true });
    await ouvrir.waitFor({ state: 'visible' });
    assert.equal(await page.getByRole('button', { name: 'Rattacher une carte fidélité', exact: true }).count(), 0,
      'sous 480 px seule l’icône fidélité du dock disparaît');
    await ouvrir.click();
    const tiroir = page.getByRole('dialog', { name: 'Ticket en cours', exact: true });
    await tiroir.waitFor({ state: 'visible' });
    await ticketIntact(tiroir, '9,90 €', { note: false });
    await tiroir.getByRole('button', { name: 'Rattacher une carte fidélité au ticket', exact: true }).waitFor({ state: 'visible' });
    const ligne = await tiroir.getByRole('button', { name: `Modifier ${PRODUIT}`, exact: true }).boundingBox();
    assert.ok(ligne && ligne.x < FORMATS.telephone.width * 0.1, 'le tiroir B doit bien s’ouvrir depuis le bord gauche');
    await preuve(page, 'pos-mobile-b-tiroir-gauche');

    await tiroir.getByRole('button', { name: `Modifier ${PRODUIT}`, exact: true }).click();
    const panneau = page.getByRole('dialog', { name: `Configurer ${PRODUIT}`, exact: true });
    await panneau.waitFor({ state: 'visible' });
    assert.equal(await panneau.getAttribute('aria-modal'), 'true', 'sur téléphone la configuration doit être une vraie modale');
    await panneau.getByRole('button', { name: 'Plus', exact: true }).click();
    await panneau.getByRole('button', { name: 'Mettre à jour · 19,80 €', exact: true }).waitFor({ state: 'visible' });
    await preuve(page, 'pos-mobile-b-edition-modale');
    await panneau.getByRole('button', { name: 'Mettre à jour · 19,80 €', exact: true }).click();
    await panneau.waitFor({ state: 'hidden' });
    await ticketIntact(tiroir, '19,80 €', { note: false });
    await tiroir.getByRole('button', { name: 'Replier le ticket', exact: true }).click();
    await tiroir.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Ouvrir le ticket, 2 articles, total 19,80 €', exact: true }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Encaisser 19,80 € par carte', exact: true }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Encaisser 19,80 € en espèces', exact: true }).waitFor({ state: 'visible' });
    assert.equal(await deborde(page), false, 'le dock compact doit rester dans les 390 px');
    await preuve(page, 'pos-mobile-b-dock-ticket-conserve');
  });

scenario('Caisse — rotation tablette 1280 vers 820 et retour du service conservent le brouillon de configuration',
  { format: { width: 1280, height: 800 } }, async (page) => {
    await ouvrirCaisse(page);
    await preferences(page, { disposition: 'B', theme: 'Sombre' });
    await page.getByRole('tab', { name: PRODUIT, exact: true }).click();
    await page.getByRole('button', { name: new RegExp(`^${PRODUIT},`) }).click();
    let panneau = page.getByRole('region', { name: `Configurer ${PRODUIT}`, exact: true });
    await panneau.waitFor({ state: 'visible' });
    await panneau.getByRole('checkbox', { name: 'Kebab, Inclus', exact: true }).click();
    await panneau.getByRole('checkbox', { name: /^Cheddar/ }).click();
    await panneau.getByRole('checkbox', { name: 'sans sauce fromagère', exact: true }).click();
    await panneau.getByRole('textbox', { name: 'Bien cuit, sauce à part…', exact: true }).fill(NOTE_LIGNE);
    await panneau.getByRole('button', { name: 'Plus', exact: true }).click();

    async function brouillonIntact() {
      await panneau.getByRole('checkbox', { name: /^M — 1 viande/, checked: true }).waitFor({ state: 'visible' });
      await panneau.getByRole('checkbox', { name: 'Kebab, Inclus', exact: true, checked: true }).waitFor({ state: 'visible' });
      await panneau.getByRole('checkbox', { name: /^Cheddar/, checked: true }).waitFor({ state: 'visible' });
      await panneau.getByRole('checkbox', { name: 'sans sauce fromagère', exact: true, checked: true }).waitFor({ state: 'visible' });
      assert.equal(await panneau.getByRole('textbox', { name: 'Bien cuit, sauce à part…', exact: true }).inputValue(), NOTE_LIGNE);
      const ajouter = panneau.getByRole('button', { name: 'Ajouter · 19,80 €', exact: true });
      await ajouter.waitFor({ state: 'visible' });
      const bouton = await ajouter.boundingBox();
      const ecran = page.viewportSize();
      assert.ok(bouton && ecran && bouton.x >= 0 && bouton.y >= 0 && bouton.x + bouton.width <= ecran.width + 1 && bouton.y + bouton.height <= ecran.height + 1,
        'le bouton qui valide la configuration doit rester entièrement dans l’écran après rotation');
    }

    await brouillonIntact();
    await page.getByRole('button', { name: 'Paramètres du poste', exact: true }).click();
    const parametres = page.getByRole('dialog', { name: 'Paramètres du poste', exact: true });
    for (const disposition of ['A', 'C', 'B']) {
      await parametres.getByRole('radio', { name: new RegExp(`^${disposition} · `) }).click();
      await parametres.getByRole('radio', { name: new RegExp(`^${disposition} · `), checked: true }).waitFor({ state: 'visible' });
      assert.equal(await configuration(page).count(), 0,
        'la configuration reste masquée pendant les paramètres, même si la disposition A la transforme en modale');
      await parametres.waitFor({ state: 'visible' });
    }
    await parametres.getByRole('button', { name: 'Fermer', exact: true }).last().click();
    await brouillonIntact();
    await page.getByRole('tab', { name: /^Le service,/ }).click();
    await panneau.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: /^Commande \d+,/ }).first().waitFor({ state: 'visible' });
    await page.getByRole('tab', { name: 'Vendre', exact: true }).click();
    await brouillonIntact();
    await preuve(page, 'pos-tablette-b-brouillon-retour-service');

    await page.setViewportSize({ width: 820, height: 1180 });
    panneau = page.getByRole('dialog', { name: `Configurer ${PRODUIT}`, exact: true });
    await panneau.waitFor({ state: 'visible' });
    await brouillonIntact();
    assert.equal(await panneau.getAttribute('aria-modal'), 'true');
    await preuve(page, 'pos-tablette-portrait-b-brouillon-modal');

    await page.setViewportSize({ width: 1280, height: 800 });
    panneau = page.getByRole('region', { name: `Configurer ${PRODUIT}`, exact: true });
    await panneau.waitFor({ state: 'visible' });
    await brouillonIntact();

    await page.setViewportSize({ width: 820, height: 1180 });
    panneau = page.getByRole('dialog', { name: `Configurer ${PRODUIT}`, exact: true });
    await panneau.getByRole('button', { name: 'Ajouter · 19,80 €', exact: true }).click();
    await panneau.waitFor({ state: 'hidden' });
    const ouvrir = page.getByRole('button', { name: 'Ouvrir le ticket, 2 articles, total 19,80 €', exact: true });
    await ouvrir.waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Rattacher une carte fidélité', exact: true }).waitFor({ state: 'visible' });
    assert.equal(await deborde(page), false, 'le dock tablette doit rester dans les 820 px');
    await preuve(page, 'pos-tablette-portrait-b-dock');
    await ouvrir.click();
    await ticketIntact(page.getByRole('dialog', { name: 'Ticket en cours', exact: true }), '19,80 €', { note: false });
    await preuve(page, 'pos-tablette-portrait-b-ticket-conserve');
  });
