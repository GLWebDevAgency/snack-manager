/**
 * La présentation cuisine ne doit ni perdre une commande ni modifier sa préparation.
 * Transport de démonstration uniquement : aucune preuve de backend ou de relais POS→KDS réel.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cibles } from '../socle/cibles.mjs';
import { deborde } from '../socle/attentes.mjs';
import { scenario } from '../socle/navigateur.mjs';

const { kds } = cibles();
const REGLAGES = /^Paramètres de l['’]écran$/;
const CARTES = /^Commande \d+$/;
const STATUTS = [
  { colonne: 'Nouveau', onglet: 'Nouveau' },
  { colonne: 'En préparation', onglet: 'En prépa' },
  { colonne: 'Prêt', onglet: 'Prêt' },
];

async function ouvrirCuisine(page) {
  await page.goto(`${kds}/?demo=1`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: REGLAGES }).waitFor({ state: 'visible' });
  await page.getByRole('button', { name: /^Accepter — commande numéro \d+$/ }).first().waitFor({ state: 'visible' });
  await page.evaluate(async () => { await document.fonts.ready; await document.fonts.load('700 16px Inter'); });
}

async function preferences(page, { densite, theme } = {}) {
  await page.getByRole('button', { name: REGLAGES }).click();
  const panneau = page.getByRole('dialog', { name: REGLAGES });
  await panneau.waitFor({ state: 'visible' });
  if (densite) {
    const nom = new RegExp(`^${densite}`);
    await panneau.getByRole('radio', { name: nom }).click();
    await panneau.getByRole('radio', { name: nom, checked: true }).waitFor({ state: 'visible' });
  }
  if (theme) {
    await panneau.getByRole('radio', { name: theme, exact: true }).click();
    await panneau.getByRole('radio', { name: theme, exact: true, checked: true }).waitFor({ state: 'visible' });
  }
  await panneau.getByRole('button', { name: 'Fermer', exact: true }).last().click();
  await panneau.waitFor({ state: 'hidden' });
}

/** Tout le texte métier, en excluant seulement le minuteur qui bat à la seconde. */
async function tickets(portee) {
  return portee.getByLabel(CARTES).evaluateAll((cartes) => cartes.map((carte) => {
    const copie = carte.cloneNode(true);
    copie.querySelectorAll('[aria-label^="Depuis "]').forEach((minuteur) => minuteur.remove());
    return {
      nom: carte.getAttribute('aria-label'),
      texte: (copie.textContent ?? '').replace(/\s+/g, ' ').trim(),
    };
  }).sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { numeric: true })));
}

function colonne(page, nom) {
  return page.getByLabel(new RegExp(`^Colonne ${nom}, \\d+ commande\\(s\\)$`));
}

function onglet(page, nom) {
  return page.getByRole('tab', { name: new RegExp(`^${nom}, \\d+ (commande|article)\\(s\\)$`) });
}

function canal(page, nom) {
  return page.getByRole('tab', { name: nom, exact: true })
    .or(page.getByRole('button', { name: nom, exact: true }));
}

async function preuve(page, nom) {
  if (!process.env.SM_E2E_CAPTURES) return;
  await mkdir(process.env.SM_E2E_CAPTURES, { recursive: true });
  await page.screenshot({ path: resolve(process.env.SM_E2E_CAPTURES, `${nom}.png`), fullPage: true });
}

scenario('Cuisine — thème et densité conservent les tickets, les options et la lisibilité des alertes',
  { format: { width: 1280, height: 800 } }, async (page) => {
    await ouvrirCuisine(page);
    const avant = await tickets(page);
    assert.ok(avant.length >= 3, 'le service doit porter plusieurs commandes et statuts');
    assert.ok(avant.some((ticket) => ticket.texte.includes('SANS OIGNONS')));
    assert.ok(avant.some((ticket) => ticket.texte.includes('Coupé en deux')));
    assert.ok(avant.some((ticket) => ticket.texte.includes('Cheddar')));
    assert.ok(avant.some((ticket) => ticket.texte.includes('À encaisser')));
    assert.ok(avant.some((ticket) => ticket.texte.includes('Payé')));

    const carte = page.getByRole('button', { name: /^Accepter — commande numéro \d+$/ }).first().locator('xpath=..');
    const noeud = await carte.elementHandle();
    const nom = await carte.getAttribute('aria-label');
    const numero = nom.match(/\d+/)?.[0];
    const mesures = async () => ({
      hauteur: (await page.getByLabel(nom, { exact: true }).boundingBox()).height,
      numero: await page.getByLabel(nom, { exact: true }).getByText(numero, { exact: true }).evaluate((el) => getComputedStyle(el).fontSize),
      minuteur: await page.getByLabel(nom, { exact: true }).getByLabel(/^Depuis \d+ minutes$/).evaluate((el) => getComputedStyle(el).fontSize),
      retrait: await page.getByLabel(nom, { exact: true }).getByText('SANS OIGNONS', { exact: true }).evaluate((el) => getComputedStyle(el).fontSize),
    });
    const confort = await mesures();
    const couleurSombre = await page.getByLabel(nom, { exact: true }).evaluate((el) => getComputedStyle(el).backgroundColor);
    await preuve(page, 'kds-confort-sombre-tablette');

    for (const theme of ['Sombre', 'Clair']) {
      await preferences(page, { densite: 'Dense', theme });
      assert.deepEqual(await tickets(page), avant, 'ni options, ni paiement, ni note, ni commande ne doivent disparaître en dense');
      assert.equal(await page.getByLabel(nom, { exact: true }).evaluate((el, ancien) => el === ancien, noeud), true,
        'les réglages ne doivent pas remonter la carte ou le tableau');
      const dense = await mesures();
      assert.ok(dense.hauteur < confort.hauteur, 'le mode dense doit réellement réduire les espacements');
      assert.equal(dense.numero, confort.numero);
      assert.equal(dense.minuteur, confort.minuteur);
      assert.equal(dense.retrait, confort.retrait);
      for (const action of await page.getByRole('button', { name: /^(Accepter|Marquer prête) — commande numéro \d+$/ }).all()) {
        const boite = await action.boundingBox();
        assert.ok(boite && boite.height >= 56, 'chaque action cuisine doit conserver sa hauteur tactile minimale');
      }
      const couleur = await page.getByLabel(nom, { exact: true }).evaluate((el) => getComputedStyle(el).backgroundColor);
      if (theme === 'Clair') assert.notEqual(couleur, couleurSombre, 'le thème clair doit effectivement changer le fond des cartes');
      assert.equal(await deborde(page), false);
      await preuve(page, `kds-dense-${theme === 'Clair' ? 'clair' : 'sombre'}-tablette`);
    }
    await preferences(page, { densite: 'Confort', theme: 'Clair' });
    assert.deepEqual(await tickets(page), avant);
    await preuve(page, 'kds-confort-clair-tablette');
  });

scenario('Cuisine — rotation, onglets et filtre compact conservent les commandes et le cumul à lancer',
  { format: { width: 1280, height: 800 } }, async (page) => {
    await ouvrirCuisine(page);
    const avant = await tickets(page);
    const parStatut = new Map();
    for (const statut of STATUTS) parStatut.set(statut.onglet, await tickets(colonne(page, statut.colonne)));
    await page.setViewportSize({ width: 820, height: 1180 });
    for (const statut of STATUTS) {
      await onglet(page, statut.onglet).click();
      assert.deepEqual(await tickets(page), parStatut.get(statut.onglet), `rotation : ${statut.colonne} doit garder toutes ses lignes`);
    }
    await preuve(page, 'kds-tablette-portrait-pret');

    await page.setViewportSize({ width: 390, height: 844 });
    await preferences(page, { densite: 'Dense', theme: 'Clair' });
    await canal(page, 'Comptoir').click();
    let articles = 0;
    for (const statut of STATUTS) {
      await onglet(page, statut.onglet).click();
      const attendus = parStatut.get(statut.onglet).filter((ticket) => ticket.texte.includes('Comptoir'));
      assert.deepEqual(await tickets(page), attendus, 'le filtre compact ne doit masquer que les autres canaux');
      if (statut.onglet !== 'Prêt') {
        // Lire chaque quantité séparément : textContent colle sinon une heure
        // « Reçue 14:19 » et le premier « 1× » en une fausse quantité « 191× ».
        for (const quantite of await page.getByLabel(CARTES).getByText(/^\d+×$/).allTextContents()) {
          articles += Number.parseInt(quantite, 10);
        }
      }
    }
    const cumul = onglet(page, 'À lancer');
    assert.equal(await cumul.getAttribute('aria-label'), `À lancer, ${articles} article(s)`,
      'À lancer compte les quantités de Nouveau + En préparation dans le canal actif');
    await cumul.click();
    await page.getByText('Cumul Nouveau + En préparation · Comptoir', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await deborde(page), false);
    await preuve(page, 'kds-mobile-clair-cumul-comptoir');

    await canal(page, 'Tous').click();
    await onglet(page, 'Nouveau').click();
    assert.deepEqual(await tickets(page), parStatut.get('Nouveau'));
    await preuve(page, 'kds-mobile-clair-nouveaux');
    await page.setViewportSize({ width: 1280, height: 800 });
    // Le redimensionnement du navigateur précède le rendu React : les anciens
    // boutons « Accepter » peuvent encore être présents dans la vue compacte.
    for (const statut of STATUTS) await colonne(page, statut.colonne).waitFor({ state: 'visible' });
    assert.deepEqual(await tickets(page), avant, 'le retour paysage ne doit pas perdre un ticket ou garder un filtre invisible');
  });

scenario('Cuisine — téléphone 320 × 568, réglages et progression jusqu’à Prêt sans remise',
  { format: { width: 320, height: 568 } }, async (page) => {
    await ouvrirCuisine(page);
    await preferences(page, { densite: 'Dense', theme: 'Clair' });
    const accepter = page.getByRole('button', { name: /^Accepter — commande numéro \d+$/ }).first();
    const numero = (await accepter.getAttribute('aria-label')).match(/\d+$/)?.[0];
    const avant = (await tickets(page)).find((ticket) => ticket.nom === `Commande ${numero}`);
    assert.ok(avant?.texte.includes('SANS OIGNONS'));
    await accepter.click();
    await onglet(page, 'En prépa').click();
    const prete = page.getByRole('button', { name: `Marquer prête — commande numéro ${numero}`, exact: true });
    await prete.waitFor({ state: 'visible' });
    assert.ok((await tickets(page)).find((ticket) => ticket.nom === `Commande ${numero}`)?.texte.includes('SANS OIGNONS'));
    await preuve(page, 'kds-320-dense-clair-preparation');
    await prete.click();
    await onglet(page, 'Prêt').click();
    const carte = page.getByLabel(`Commande ${numero}`, { exact: true });
    await carte.getByLabel(`Remise à confirmer par la caisse — commande numéro ${numero}`, { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await carte.getByRole('button').count(), 0, 'Prêt doit rester informatif, sans aucune écriture de remise');
    assert.equal(await page.getByRole('button', { name: /^Remise au client/ }).count(), 0);
    assert.equal(await deborde(page), false);
    await preferences(page, { densite: 'Confort', theme: 'Sombre' });
    await carte.waitFor({ state: 'visible' });
    await preuve(page, 'kds-320-confort-sombre-pret');
  });

scenario('Cuisine — clavier des réglages et PIN explicite 4 à 6 chiffres après fermeture du service',
  { format: { width: 1280, height: 800 } }, async (page) => {
    await ouvrirCuisine(page);
    const avant = await tickets(page);
    const reglages = page.getByRole('button', { name: REGLAGES });
    await reglages.click();
    const panneau = page.getByRole('dialog', { name: REGLAGES });
    const confort = panneau.getByRole('radio', { name: /^Confort\./ });
    const dense = panneau.getByRole('radio', { name: /^Dense\./ });
    await confort.focus();
    await confort.press('ArrowDown');
    await panneau.getByRole('radio', { name: /^Dense\./, checked: true }).waitFor({ state: 'visible' });
    assert.equal(await dense.evaluate((el) => el === document.activeElement), true);
    await dense.press('Home');
    await panneau.getByRole('radio', { name: /^Confort\./, checked: true }).waitFor({ state: 'visible' });
    await dense.focus();
    await dense.press('Space');
    await panneau.getByRole('radio', { name: /^Dense\./, checked: true }).waitFor({ state: 'visible' });

    const sombre = panneau.getByRole('radio', { name: 'Sombre', exact: true });
    const clair = panneau.getByRole('radio', { name: 'Clair', exact: true });
    await sombre.focus();
    await sombre.press('ArrowRight');
    await panneau.getByRole('radio', { name: 'Clair', exact: true, checked: true }).waitFor({ state: 'visible' });
    await clair.press('Home');
    await panneau.getByRole('radio', { name: 'Sombre', exact: true, checked: true }).waitFor({ state: 'visible' });
    await sombre.press('End');
    await panneau.getByRole('radio', { name: 'Clair', exact: true, checked: true }).waitFor({ state: 'visible' });
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      assert.equal(await panneau.evaluate((el) => el.contains(document.activeElement)), true,
        'le focus clavier doit rester dans les paramètres tant que la modale est ouverte');
    }
    await page.keyboard.press('Escape');
    await panneau.waitFor({ state: 'hidden' });
    // L’isolation de la modale est retirée avant la restitution du focus au
    // prochain rendu du navigateur. Attendre ce focus, pas seulement sa fermeture.
    await reglages.and(page.locator(':focus')).waitFor({ state: 'visible' });
    assert.equal(await reglages.evaluate((el) => el === document.activeElement), true,
      'Échap doit restituer le focus au bouton qui a ouvert les paramètres');
    assert.deepEqual(await tickets(page), avant, 'le réglage au clavier doit conserver les commandes');

    await page.getByRole('button', { name: 'Fermer le service', exact: true }).click();
    const titre = page.getByText('Code équipe', { exact: true });
    await titre.waitFor({ state: 'visible' });
    const valider = page.getByRole('button', { name: 'Valider le code', exact: true });
    const erreurDemo = page.getByText('Route indisponible en démonstration', { exact: true });
    const chiffres = (nombre) => page.getByLabel(`${nombre} chiffre(s) saisi(s)`, { exact: true });
    await chiffres(0).waitFor({ state: 'visible' });
    assert.equal(await valider.isDisabled(), true);
    for (const chiffre of ['1', '2', '3']) await page.getByRole('button', { name: chiffre, exact: true }).click();
    await chiffres(3).waitFor({ state: 'visible' });
    assert.equal(await valider.isDisabled(), true, 'trois chiffres ne suffisent pas');
    await page.getByRole('button', { name: '4', exact: true }).click();
    await chiffres(4).waitFor({ state: 'visible' });
    assert.equal(await valider.isDisabled(), false);
    assert.equal(await erreurDemo.count(), 0, 'le quatrième chiffre ne doit pas envoyer automatiquement le PIN');
    for (const chiffre of ['5', '6', '7']) await page.getByRole('button', { name: chiffre, exact: true }).click();
    await chiffres(6).waitFor({ state: 'visible' });
    assert.equal(await erreurDemo.count(), 0, 'six chiffres attendent eux aussi une validation explicite');
    await page.keyboard.press('Backspace');
    await chiffres(5).waitFor({ state: 'visible' });
    await page.keyboard.press('Backspace');
    await chiffres(4).waitFor({ state: 'visible' });
    await page.keyboard.press('Backspace');
    await chiffres(3).waitFor({ state: 'visible' });
    assert.equal(await valider.isDisabled(), true, 'le septième chiffre ignoré ne doit pas rester caché dans le code');
    await page.getByRole('button', { name: 'Effacer', exact: true }).click();
    await chiffres(0).waitFor({ state: 'visible' });
    await titre.click();
    await page.keyboard.type('12');
    await chiffres(2).waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await chiffres(0).waitFor({ state: 'visible' });

    await page.keyboard.type('1234');
    await chiffres(4).waitFor({ state: 'visible' });
    for (const format of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(format);
      await chiffres(4).waitFor({ state: 'visible' });
      for (const nom of ['0', '1', 'Effacer', 'Valider le code']) {
        const bouton = page.getByRole('button', { name: nom, exact: true });
        const boite = await bouton.boundingBox();
        assert.ok(boite && boite.width >= 44 && boite.height >= 44, `la touche ${nom} doit rester tactile en ${format.width} × ${format.height}`);
      }
      await valider.scrollIntoViewIfNeeded();
      await valider.click({ trial: true });
      const boite = await valider.boundingBox();
      assert.ok(boite && boite.x >= 0 && boite.y >= 0 && boite.x + boite.width <= format.width + 1 && boite.y + boite.height <= format.height + 1,
        'la validation doit rester atteignable par défilement après rotation');
      assert.equal(await deborde(page), false);
      await preuve(page, `kds-pin-${format.width}x${format.height}-quatre-chiffres`);
    }

    // Le transport démo refuse les routes appareil : ce refus attendu prouve
    // l’activation de la validation, sans prétendre authentifier une vraie session.
    await valider.click();
    await erreurDemo.waitFor({ state: 'visible' });
    await chiffres(0).waitFor({ state: 'visible' });
    assert.equal(await valider.isDisabled(), true);
    await titre.click();
    await page.keyboard.type('123456');
    await chiffres(6).waitFor({ state: 'visible' });
    assert.equal(await erreurDemo.count(), 0);
    await page.keyboard.press('Enter');
    await erreurDemo.waitFor({ state: 'visible' });
    await chiffres(0).waitFor({ state: 'visible' });
    assert.equal(await valider.isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: REGLAGES }).count(), 0, 'le refus démo ne doit pas rouvrir un service');
    await erreurDemo.scrollIntoViewIfNeeded();
    await preuve(page, 'kds-pin-refus-demo-code-efface');
  });
