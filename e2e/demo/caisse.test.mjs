/**
 * SCÉNARIO 1 — UNE COMMANDE COMPLÈTE À LA CAISSE.
 *
 * C'est le parcours dont la panne coûte le plus cher : un poste qui n'encaisse
 * plus, c'est un service arrêté, une file qui s'allonge et des clients qui
 * partent. Le contrôle de santé après déploiement dit que la caisse RÉPOND ;
 * ce fichier dit qu'elle MARCHE.
 *
 * ─── LE PRODUIT CHOISI N'EST PAS ANODIN ───
 *
 * « Compose ton Tacos » est le seul article de la carte qui réunisse, dans un
 * seul écran, TOUTES les mécaniques de tarification du produit :
 *
 *   · une VARIANTE qui porte le prix de base   → M — 1 viande, 8,90 €
 *   · un groupe OBLIGATOIRE                    → Viandes, 1 choix requis
 *   · un SUPPLÉMENT PAYANT                     → Cheddar, +1,00 €
 *   · un RETRAIT d'ingrédient, offert          → sans sauce fromagère
 *
 *   Total attendu : 8,90 + 1,00 = 9,90 €.
 *
 * Ce total est VÉRIFIÉ à quatre endroits successifs — bouton d'ajout, ticket,
 * écran d'encaissement, confirmation — parce que chacun le recalcule par un
 * chemin différent. Un supplément perdu entre le panier et la caisse est
 * exactement le genre de régression qui passe toutes les vérifications
 * actuelles et se découvre au comptoir.
 *
 * ─── ET LE RENDU DE MONNAIE ───
 *
 * On tend un billet de 20 € sur 9,90 € : la caisse doit annoncer 10,10 €. Un
 * arrondi flottant, une soustraction en euros au lieu de centimes, et le
 * commerçant rend faux toute la soirée sans qu'aucun test unitaire ne bronche.
 */
import assert from 'node:assert/strict';
import { cibles } from '../socle/cibles.mjs';
import { attendreMontant, attendreTexte, bloc, entierAffiche } from '../socle/attentes.mjs';
import { FORMATS, scenario } from '../socle/navigateur.mjs';

const { pos } = cibles();

const CATEGORIE = 'Compose ton Tacos';
const PRODUIT = 'Compose ton Tacos';
const TAILLE = /^M — 1 viande/;
const VIANDE = 'Kebab';
const SUPPLEMENT = /^Cheddar/;
const RETRAIT = 'sans sauce fromagère';

const TOTAL = '9,90 €';
const BILLET = '+ 20,00 €';
const RECU = '20,00 €';
const RENDU = '10,10 €';

scenario(
  'Caisse — commande complète, encaissement espèces et numéro de retrait',
  { format: FORMATS.comptoir },
  async (page) => {
    await page.goto(`${pos}/?demo=1`, { waitUntil: 'domcontentloaded' });

    // ── La caisse est ouverte, sans code d'appairage ni clavier de PIN ──
    // C'est la promesse du mode démonstration : si un écran de connexion
    // apparaît ici, la bascule `?demo=1` est cassée et la vitrine avec elle.
    const rail = page.getByRole('tab', { name: CATEGORIE });
    await rail.waitFor({ state: 'visible' });
    await attendreTexte(page, 'Ticket');

    const serviceAvant = await entierAffiche(page, 'Service');

    // ── Le produit ──
    await rail.click();
    await page.getByRole('button', { name: new RegExp(`^${PRODUIT}`) }).click();

    // ── L'option requise EST requise ──
    // Avant de choisir la viande, la caisse doit REFUSER l'ajout. Sans cette
    // vérification, un groupe obligatoire devenu facultatif par régression
    // partirait en cuisine incomplet, et la cuisine appellerait le comptoir.
    const bloque = page.getByRole('button', { name: 'Complétez la configuration' });
    await bloque.waitFor({ state: 'visible' });
    assert.equal(await bloque.isDisabled(), true, "l'ajout doit rester impossible tant que « Viandes » n'est pas choisi");

    await page.getByRole('checkbox', { name: TAILLE }).click();
    await page.getByRole('checkbox', { name: VIANDE, exact: true }).click();
    await page.getByRole('checkbox', { name: SUPPLEMENT }).click();
    await page.getByRole('checkbox', { name: RETRAIT }).click();

    // ── Total nº 1 : le bouton d'ajout, prix recalculé variante + supplément ──
    const ajouter = page.getByRole('button', { name: `Ajouter · ${TOTAL}` });
    await ajouter.waitFor({ state: 'visible' });
    await ajouter.click();

    // ── Le ticket porte la ligne, sa configuration et son total ──
    const ligne = page.getByRole('button', { name: `Modifier ${PRODUIT}` });
    await ligne.waitFor({ state: 'visible' });
    const detail = (await ligne.textContent()) ?? '';
    for (const attendu of ['M — 1 viande', 'Kebab', 'Cheddar']) {
      assert.ok(
        detail.includes(attendu),
        `la ligne du ticket doit rappeler « ${attendu} » — lue : ${JSON.stringify(detail)}`,
      );
    }
    assert.ok(
      /sans\s+sauce/i.test(detail),
      `le retrait d’ingrédient doit figurer sur la ligne — lue : ${JSON.stringify(detail)}`,
    );

    // ── Total nº 2 : le pied du ticket ──
    await attendreMontant(page, 'Total', TOTAL);

    // ── L'encaissement espèces ──
    await page.getByRole('button', { name: 'Espèces', exact: true }).click();

    // ── Total nº 3 : l'écran d'encaissement ──
    await page.getByText(`Total à encaisser · ${TOTAL}`, { exact: true }).waitFor({ state: 'visible' });

    const valider = page.getByRole('button', { name: /Valider l’encaissement|Valider l'encaissement/ });
    await valider.waitFor({ state: 'visible' });
    assert.equal(
      await valider.isDisabled(),
      true,
      'valider un encaissement sans avoir reçu un centime doit être impossible',
    );

    await page.getByRole('checkbox', { name: BILLET }).click();

    // ── Le rendu de monnaie ──
    await attendreMontant(page, 'Reçu', RECU);
    await attendreMontant(page, 'À rendre', RENDU);

    await valider.click();

    // ── La confirmation ──
    await attendreTexte(page, 'Envoyée en cuisine');

    const numero = await entierAffiche(page, 'Numéro de retrait');
    assert.ok(numero >= 1, `le numéro de retrait doit être un entier positif (lu : ${numero})`);

    // ── Total nº 4 : le récapitulatif, avec le moyen de paiement ──
    await page
      .getByText(`Sur place · ${TOTAL} · Payé (espèces)`, { exact: true })
      .waitFor({ state: 'visible' });
    await attendreMontant(page, 'À rendre', RENDU);

    // ── La commande est CONFIRMÉE PAR LE SERVEUR ──
    // La caisse affiche d'abord un numéro provisoire, puis le remplace par
    // celui du serveur quand la file de synchronisation est vidée. Attendre
    // cette bascule, c'est vérifier que l'écriture est réellement partie et
    // revenue — pas seulement qu'un écran optimiste s'est affiché.
    await attendreTexte(page, 'Confirmée par le serveur');
    const confirme = await entierAffiche(page, 'Numéro de retrait');
    assert.ok(confirme >= 1, `numéro de retrait confirmé illisible (lu : ${confirme})`);

    // ── Le journal du service a bougé ──
    const nouvelleCommande = page.getByRole('button', { name: 'Nouvelle commande' });
    await nouvelleCommande.waitFor({ state: 'visible' });
    await nouvelleCommande.click();
    await page.getByRole('button', { name: `Service ${serviceAvant + 1}` }).waitFor({ state: 'visible' });
  },
);
