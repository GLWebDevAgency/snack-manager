/**
 * SCÉNARIO 3 — UNE COMMANDE EN LIGNE, DE LA CARTE AU NUMÉRO DE RETRAIT.
 *
 * Sur un écran de 390 px, parce que c'est là que ça se joue : le client d'un
 * snack commande depuis son téléphone, debout, et une seule étape qui déborde
 * ou un bouton hors d'atteinte lui fait fermer l'onglet. Une commande perdue
 * ici ne se rattrape pas — elle ne laisse même pas de trace.
 *
 * ─── LE PRIX, ENCORE ───
 *
 *   Kebab                7,50 €
 *   + Galette            0,50 €   option payante d'un groupe obligatoire
 *   + Cheddar            1,00 €   supplément
 *   ─────────────────────────────
 *   Total                9,00 €
 *
 * Vérifié à trois étapes du tunnel (fiche produit, panier, paiement), chacune
 * recalculant de son côté. Le récapitulatif de paiement est le dernier rempart
 * avant que le client s'engage : s'il ment, on facture faux.
 *
 * ─── PAIEMENT AU COMPTOIR, PAS PAR CARTE ───
 *
 * Le tunnel propose les deux. On prend « au comptoir » : le paiement par carte
 * passe par Stripe, donc par un tiers, donc par un point de fragilité qui
 * n'appartient pas à ce dépôt. Un test qui rougit parce que Stripe est lent
 * n'apprend rien sur Snack Manager.
 *
 * ─── L'HYDRATATION ───
 *
 * Cette page est rendue par le serveur puis hydratée. Entre les deux, les
 * boutons existent et sont cliquables au sens de Playwright, mais leurs
 * gestionnaires ne sont pas encore posés : le premier clic peut partir dans le
 * vide. `cliquerJusqua` couvre exactement cet instant — voir le commentaire
 * détaillé dans `socle/attentes.mjs`.
 */
import assert from 'node:assert/strict';
import { cibles } from '../socle/cibles.mjs';
import { attendreTexte, cliquerJusqua, deborde, entierAffiche } from '../socle/attentes.mjs';
import { FORMATS, scenario } from '../socle/navigateur.mjs';
import { choisirCreneau } from '../socle/choisir-creneau.mjs';

const { web } = cibles();

const PRODUIT = 'Kebab';
const PAIN = /^Galette/; // +0,50 €
const SAUCE = 'Samouraï Inclus';
const SUPPLEMENT = /^Cheddar/; // +1,00 €
const TOTAL = /9,00\s*€/;

scenario(
  'Commande en ligne — parcours complet sur un écran de 390 px',
  { format: FORMATS.telephone },
  async (page) => {
    await page.goto(`${web}/r/demo?demo=1`, { waitUntil: 'domcontentloaded' });

    // ── La carte est dans le HTML, avant tout JavaScript ──
    await page.getByRole('heading', { name: 'Le Comptoir', level: 1 }).waitFor({ state: 'visible' });
    assert.equal(
      await deborde(page),
      false,
      'la carte ne doit pas déborder horizontalement à 390 px',
    );

    // ── La fiche produit ──
    const fiche = page.getByRole('dialog', { name: PRODUIT });
    const carteProduit = page
      .getByRole('region', { name: 'Sandwichs', exact: true })
      .getByRole('article', { name: PRODUIT, exact: true });
    await cliquerJusqua(
      carteProduit.getByRole('button', { name: /composer$/ }),
      fiche,
    );

    await fiche.getByRole('radio', { name: PAIN }).click();
    await fiche.getByRole('group', { name: 'Sauces', exact: true }).getByRole('checkbox', { name: SAUCE, exact: true }).click();
    await fiche.getByRole('checkbox', { name: SUPPLEMENT }).click();

    // ── Total nº 1 : la fiche produit ──
    const ajouter = fiche.getByRole('button', { name: new RegExp(`^Ajouter.*${TOTAL.source}`) });
    await ajouter.waitFor({ state: 'visible' });
    await ajouter.click();

    // ── Le panier ──
    const panier = page.getByRole('dialog', { name: 'Votre commande' });
    await cliquerJusqua(page.getByRole('button', { name: /Voir mon panier/ }), panier);

    const article = panier.getByRole('article').first();
    const detail = (await article.textContent()) ?? '';
    for (const attendu of ['Galette', 'Samouraï', 'Cheddar']) {
      assert.ok(
        detail.includes(attendu),
        `le panier doit rappeler « ${attendu} » — lu : ${JSON.stringify(detail)}`,
      );
    }

    // ── Total nº 2 : le panier ──
    const continuer = panier.getByRole('button', { name: new RegExp(`^Choisir le retrait.*${TOTAL.source}`) });
    await continuer.waitFor({ state: 'visible' });
    await continuer.click();

    // ── Le créneau de retrait ──
    const retrait = page.getByRole('dialog', { name: 'Créneau de retrait' });
    await retrait.waitFor({ state: 'visible' });
    await retrait.getByRole('radio', { name: /Choisir une heure/ }).click();

    // Un créneau libre porte l'heure et rien d'autre ; « 12:50 — complet » et
    // « 18:40 — créneau chargé » sont d'autres libellés, le premier désactivé.
    const libre = retrait.getByRole('button', { name: /^\d{2}:\d{2}$/ });
    const aucun = retrait.getByText('Aucun créneau ce jour-là');

    // Entre 23 h 40 et minuit, le délai de préparation pousse le dernier
    // créneau au lendemain : la page propose alors « Demain », et le client
    // suit ce chemin-là. Le test aussi — c'est un parcours du produit, pas un
    // cas dégradé.
    await libre.first().or(aucun).first().waitFor({ state: 'visible' });
    if ((await aucun.count()) > 0) {
      await retrait.getByRole('button', { name: 'Demain' }).click();
      await libre.first().waitFor({ state: 'visible' });
    }

    // La première borne peut expirer pendant le rechargement de la grille.
    // On choisit une heure plus éloignée, puis on garde cette identité exacte :
    // une disponibilité retirée ne doit jamais sélectionner sa voisine.
    const heure = (await libre.last().textContent())?.trim();
    assert.ok(/^\d{2}:\d{2}$/.test(heure ?? ''), `créneau illisible : ${JSON.stringify(heure)}`);
    await choisirCreneau(retrait, heure);

    // ── Le paiement ──
    const paiement = page.getByRole('dialog', { name: 'Paiement' });
    await paiement.waitFor({ state: 'visible' });
    await attendreTexte(paiement, heure);

    // Les coordonnées restent requises, sur la dernière étape du retrait.
    await paiement.getByRole('textbox', { name: 'Prénom et nom' }).fill('Camille Durand');
    await paiement.getByRole('textbox', { name: 'Téléphone' }).fill('0612345678');

    // ── Total nº 3 : le récapitulatif, dernier écran avant l'engagement ──
    const recapitulatif = (await paiement.textContent()) ?? '';
    assert.ok(
      TOTAL.test(recapitulatif),
      `le récapitulatif de paiement doit annoncer 9,00 € — lu : ${JSON.stringify(recapitulatif.slice(0, 300))}`,
    );
    assert.ok(
      await paiement.getByRole('textbox', { name: 'Prénom et nom' }).inputValue() === 'Camille Durand',
      'le récapitulatif doit rappeler au nom de qui la commande est passée',
    );

    await paiement.getByRole('radio', { name: /Payer au comptoir/ }).click();
    const confirmer = paiement.getByRole('button', {
      name: new RegExp(`^Confirmer la commande.*${TOTAL.source}`),
    });
    await confirmer.waitFor({ state: 'visible' });
    await confirmer.click();

    // ── Le numéro de retrait ──
    const confirmation = page.getByRole('dialog', { name: 'Commande confirmée' });
    await confirmation.waitFor({ state: 'visible' });

    const numero = await entierAffiche(confirmation, 'Numéro de retrait');
    assert.ok(numero >= 1, `le numéro de retrait doit être un entier positif (lu : ${numero})`);

    await attendreTexte(confirmation, `Retrait à ${heure}`);
    await attendreTexte(confirmation, 'C’est envoyé en cuisine');

    // Le suivi de préparation est ce que le client regarde après avoir payé.
    for (const etape of ['Reçue', 'En préparation', 'Prête']) {
      await attendreTexte(confirmation, etape);
    }

    assert.equal(
      await deborde(page),
      false,
      'la confirmation ne doit pas déborder horizontalement à 390 px',
    );
  },
);
