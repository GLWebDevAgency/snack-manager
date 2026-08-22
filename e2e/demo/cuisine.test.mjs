/**
 * SCÉNARIO 2 — LE TICKET EN CUISINE, ET SON AVANCEMENT.
 *
 * Un ticket qui n'arrive pas au passe, ou une colonne qui n'avance plus, arrête
 * un service aussi sûrement qu'une caisse morte : le comptoir encaisse, la
 * cuisine ne voit rien, et personne ne s'en aperçoit avant que le premier
 * client réclame.
 *
 * Ce que ce scénario vérifie, dans l'ordre :
 *   1. le tableau porte des tickets VENUS DU COMPTOIR, avec leur numéro, leurs
 *      lignes et leurs retraits d'ingrédients — pas des cartes vides ;
 *   2. « Accepter » fait passer le ticket de « Nouveau » à « En préparation » ;
 *   3. « Marquer prête » le fait passer en « Prêt » ;
 *   4. les compteurs des colonnes suivent le mouvement.
 *
 * ─── UNE LIMITE ASSUMÉE, ET ELLE EST ÉCRITE ICI PLUTÔT QUE CACHÉE ───
 *
 * La démonstration donne à CHAQUE document son propre service : la caisse et
 * l'écran cuisine sont deux applications servies par deux origines, donc deux
 * mondes qui ne communiquent pas (voir `demoTransport` dans
 * `packages/client-core/src/demo/transport.ts` — « rien ne traverse une
 * frontière de document »). Faire encaisser la caisse puis regarder le ticket
 * apparaître sur l'écran cuisine est donc IMPOSSIBLE en démonstration, par
 * construction et non par oubli.
 *
 * Le passage de relais est couvert des deux côtés séparément : la caisse
 * vérifie « Envoyée en cuisine » puis « Confirmée par le serveur »
 * (`caisse.test.mjs`) ; l'écran cuisine vérifie ici qu'il reçoit des tickets du
 * comptoir et les fait avancer. La jonction elle-même exige une vraie API et
 * deux appareils appairés — c'est noté comme travail restant.
 */
import assert from 'node:assert/strict';
import { cibles } from '../socle/cibles.mjs';
import { attendreTexte } from '../socle/attentes.mjs';
import { FORMATS, scenario } from '../socle/navigateur.mjs';

const { kds } = cibles();

/** Ce que porte l'étiquette d'un bouton, par colonne. */
const ACCEPTER = /^Accepter — commande numéro (\d+)$/;

scenario(
  'Cuisine — un ticket du comptoir passe de nouveau à prêt',
  { format: FORMATS.comptoir },
  async (page) => {
    await page.goto(`${kds}/?demo=1`, { waitUntil: 'domcontentloaded' });

    // ── Le service est en cours ──
    const aAccepter = page.getByRole('button', { name: ACCEPTER });
    await aAccepter.first().waitFor({ state: 'visible' });
    await attendreTexte(page, 'En préparation');
    await attendreTexte(page, 'Prêt');

    const nouveauxAvant = await aAccepter.count();
    assert.ok(
      nouveauxAvant >= 1,
      'le tableau de cuisine doit porter au moins un ticket à accepter',
    );

    // ── Le ticket est un VRAI ticket ──
    // On lit la carte entière, pas seulement son bouton : un tableau qui
    // afficherait des cartes sans lignes serait « vert » sur une simple
    // présence de bouton, et inutilisable en service.
    const bouton = aAccepter.first();
    const etiquette = (await bouton.getAttribute('aria-label')) ?? '';
    const numero = Number.parseInt(etiquette.match(ACCEPTER)?.[1] ?? '', 10);
    assert.ok(Number.isInteger(numero), `numéro de commande illisible dans « ${etiquette} »`);

    const carte = bouton.locator('xpath=..');
    const contenu = (await carte.textContent()) ?? '';
    assert.ok(
      new RegExp(`N°\\s*${numero}`).test(contenu),
      `la carte doit afficher le numéro de retrait ${numero} — lue : ${JSON.stringify(contenu.slice(0, 200))}`,
    );
    assert.ok(
      /\d+×/.test(contenu),
      `la carte doit détailler les articles à préparer — lue : ${JSON.stringify(contenu.slice(0, 200))}`,
    );

    // ── Nouveau → En préparation ──
    await bouton.click();
    const aPreparer = page.getByRole('button', { name: `Marquer prête — commande numéro ${numero}` });
    await aPreparer.waitFor({ state: 'visible' });

    // Le ticket a QUITTÉ la colonne « Nouveau » : il ne suffit pas qu'il soit
    // apparu ailleurs, il doit avoir disparu d'où il était.
    await page
      .getByRole('button', { name: `Accepter — commande numéro ${numero}` })
      .waitFor({ state: 'detached' });
    assert.equal(
      await aAccepter.count(),
      nouveauxAvant - 1,
      'la colonne « Nouveau » doit perdre exactement un ticket',
    );

    // ── En préparation → Prêt ──
    await aPreparer.click();
    await page
      .getByRole('button', { name: `Remise au client — commande numéro ${numero}` })
      .waitFor({ state: 'visible' });
    await page
      .getByRole('button', { name: `Marquer prête — commande numéro ${numero}` })
      .waitFor({ state: 'detached' });
  },
);
