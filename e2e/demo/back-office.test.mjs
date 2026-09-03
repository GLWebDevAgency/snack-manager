/**
 * SCÉNARIO 4a — LE BACK-OFFICE, CÔTÉ DÉMONSTRATION.
 *
 * Un gérant qui change un prix et le voit revenir à l'ancienne valeur au clic
 * suivant n'appelle pas le support : il arrête d'utiliser l'outil. Ce scénario
 * vérifie que l'écriture est ACCEPTÉE ET RELUE — pas seulement qu'un champ de
 * saisie a changé d'affichage sous les doigts.
 *
 * Le tarif est modifié, puis on quitte l'écran, puis on y revient. Si le
 * `PATCH /products/:id` avait échoué en silence — ou si l'écran ne relisait pas
 * la carte —, le prix d'origine reviendrait à ce moment-là.
 *
 * ─── LE PIÈGE QUE CE TEST GARDE, ET IL EST MORTEL ───
 *
 * `?demo=1` doit SURVIVRE À LA NAVIGATION INTERNE. Le back-office navigue avec
 * le routeur Next, qui réécrit l'adresse en n'y remettant que le chemin
 * canonique : sans les deux filets posés dans `lib/demo/mode.ts`, le visiteur
 * qui clique « Aujourd’hui » perd le paramètre, perd son jeton, et se fait
 * éjecter vers la page de connexion. La démonstration s'arrête alors AU PREMIER
 * CLIC — et c'est la vitrine commerciale du produit.
 *
 * Ce scénario clique donc réellement dans le menu, dans les deux sens, et
 * vérifie que l'adresse porte encore le paramètre à l'arrivée.
 *
 * ─── CE QUE CE SCÉNARIO NE PEUT PAS FAIRE ───
 *
 * « Vérifier que le nouveau prix ressort côté client » n'est pas jouable ici :
 * le back-office de démonstration et la commande en ligne de démonstration sont
 * deux mondes distincts, chacun sur sa fixture (`lib/demo` d'un côté,
 * `components/order/demo` de l'autre). Le trajet complet gérant → vitrine exige
 * une vraie base ; il est couvert par `e2e/reel/prix-public.test.mjs`.
 */
import assert from 'node:assert/strict';
import { cibles } from '../socle/cibles.mjs';
import { attendreTexte } from '../socle/attentes.mjs';
import { FORMATS, scenario } from '../socle/navigateur.mjs';

const { web } = cibles();

const PRODUIT = 'Kebab';
const NOUVEAU_PRIX = '8,40';

scenario(
  'Back-office — un changement de prix est enregistré et relu',
  { format: FORMATS.comptoir },
  async (page) => {
    await page.goto(`${web}/admin/menu?demo=1`, { waitUntil: 'domcontentloaded' });

    // ── Le gérant est déjà entré : la démonstration ouvre sur son back-office ──
    await page.getByRole('heading', { name: 'Carte', level: 1 }).waitFor({ state: 'visible' });

    // `exact: true` n'est pas un détail : sans lui, « Prix de Kebab » désigne
    // aussi « Prix de Kebab Fromage », et Playwright refuse de trancher.
    const champ = page.getByRole('textbox', { name: `Prix de ${PRODUIT}`, exact: true });
    await champ.waitFor({ state: 'visible' });

    const avant = await champ.inputValue();
    assert.match(avant, /^\d+,\d{2}$/, `prix initial illisible : ${JSON.stringify(avant)}`);
    assert.notEqual(
      avant,
      NOUVEAU_PRIX,
      `le scénario doit CHANGER le prix : il vaut déjà ${NOUVEAU_PRIX} — choisissez une autre valeur`,
    );

    // ── Le changement : saisie puis Entrée, comme au comptoir ──
    await champ.fill(NOUVEAU_PRIX);
    await champ.press('Enter');

    // La confirmation vient de l'API, pas du champ : le back-office n'affiche
    // ce message qu'après une réponse acceptée.
    await attendreTexte(page, `Prix mis à jour — ${NOUVEAU_PRIX} €`);

    // ── On quitte l'écran, on y revient ──
    await page.getByRole('link', { name: 'Aujourd’hui', exact: true }).click();
    await page.getByRole('heading', { name: 'Aujourd’hui', level: 1 }).waitFor({ state: 'visible' });

    assert.ok(
      page.url().includes('demo=1'),
      `le paramètre « demo=1 » doit survivre à la navigation interne — adresse : ${page.url()}`,
    );

    await page.getByRole('link', { name: 'Carte', exact: true }).click();
    const relu = page.getByRole('textbox', { name: `Prix de ${PRODUIT}`, exact: true });
    await relu.waitFor({ state: 'visible' });

    // ── Le prix relu est le nouveau ──
    // On ATTEND la valeur au lieu de la lire tout de suite : la carte est
    // rechargée depuis l'API au montage de l'écran, et lire avant cette réponse
    // renverrait l'ancienne valeur — un faux rouge une fois sur dix. La lecture
    // porte sur la PROPRIÉTÉ `value` du champ, pas sur l'attribut HTML : React
    // ne met à jour que la première sur un champ contrôlé.
    await page.waitForFunction(
      ({ etiquette, attendu }) =>
        document.querySelector(`input[aria-label="${etiquette}"]`)?.value === attendu,
      { etiquette: `Prix de ${PRODUIT}`, attendu: NOUVEAU_PRIX },
    );
    assert.equal(
      await relu.inputValue(),
      NOUVEAU_PRIX,
      'le prix relu après navigation doit être celui qu’on vient d’enregistrer',
    );
  },
);
