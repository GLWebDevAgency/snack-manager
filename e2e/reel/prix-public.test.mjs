/**
 * SCÉNARIO 4b — CONNEXION, CHANGEMENT DE PRIX, ET LE PRIX RESSORT CÔTÉ CLIENT.
 *
 * Le trajet complet, celui qu'aucune fixture ne peut simuler :
 *
 *   le gérant se connecte  →  il change un prix  →  le client le voit
 *
 * Trois systèmes différents sur ce chemin : le back-office, l'API et sa base,
 * la vitrine publique rendue par Next.js avec son cache. Chacun peut casser
 * sans que les deux autres s'en aperçoivent. Un prix qui reste bloqué à
 * l'ancienne valeur sur la page Google d'un restaurant, c'est de la vente à
 * perte à chaque commande, pendant des jours, sans aucune alerte.
 *
 * ─── CE SCÉNARIO ÉCRIT DANS UNE VRAIE BASE ───
 *
 * Il ne s'exécute donc que si le parc visé porte un établissement ET que les
 * identifiants sont fournis. Sinon : IGNORÉ, avec la raison. Jamais rouge —
 * un rouge qui ne désigne pas une panne apprend à ignorer le rouge.
 *
 * Et il REMET LE PARC EN ÉTAT. La restauration passe par l'API et non par
 * l'interface : elle doit réussir même si l'écran est cassé, puisque c'est
 * précisément le cas où le test échoue. Le prix d'origine est relu et vérifié
 * avant que le scénario rende la main.
 */
import assert from 'node:assert/strict';
import { DELAI_PROPAGATION, cibles } from '../socle/cibles.mjs';
import { attendreTexte, rechargerJusqua } from '../socle/attentes.mjs';
import { FORMATS, scenario } from '../socle/navigateur.mjs';
import { avecRemiseEnEtat, client, euros, produitDeLaCarte } from '../socle/api.mjs';
import { identifiants, raisonDeSauter } from '../socle/env.mjs';
import { classerJournal, noterARemettre, reparerParcSiNecessaire } from '../socle/parc.mjs';

const parc = cibles();
const sauter = raisonDeSauter(parc);

/** Produit modifié — surchargeable, au cas où la carte du client change. */
const PRODUIT = process.env.SM_E2E_PRODUIT ?? 'Kebab';

/**
 * Écart appliqué au prix, en centimes.
 *
 * 13 centimes, et pas 100 : la valeur obtenue ne ressemble à aucun prix rond
 * de la carte, donc si elle restait par accident dans la base après un plantage
 * de la machine, elle sauterait aux yeux du premier qui ouvre le back-office.
 */
const ECART = 13;

scenario(
  'Back-office réel — un prix changé par le gérant ressort sur la vitrine',
  { format: FORMATS.comptoir, sauter, delai: 240_000 },
  async (page) => {
    const { gerant } = identifiants();
    const api = client(parc.api);

    // Une exécution précédente a pu mourir entre l'écriture et la restauration.
    // On répare AVANT de lire quoi que ce soit : sans ça, le prix d'essai laissé
    // en base passerait pour le prix d'origine, et la dérive s'installerait.
    await reparerParcSiNecessaire();

    // ── L'état de départ, lu là où le client le lit ──
    const avant = await api.get(`/public/tenants/${parc.slug}/site`);
    const produit = produitDeLaCarte(avant, PRODUIT);
    const prixOrigine = produit.price;
    const prixEssai = prixOrigine + ECART;

    // Jeton de restauration obtenu AVANT toute écriture : si la connexion du
    // gérant est cassée, on le découvre sans avoir rien modifié.
    await api.connexion(gerant);

    // Le geste inverse est noté sur disque avant la première écriture : c'est
    // ce qui rattrape un processus tué en plein milieu (voir `socle/parc.mjs`).
    await noterARemettre([
      {
        acteur: 'gerant',
        methode: 'PATCH',
        chemin: `/products/${produit._id}`,
        corps: { price: prixOrigine },
        decrit: `${PRODUIT} remis à ${euros(prixOrigine)}`,
      },
    ]);

    await avecRemiseEnEtat(async () => {
      // ── 1 · La connexion, par le vrai formulaire ──
      await page.goto(`${parc.web}/admin`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('textbox', { name: 'E-mail' }).fill(gerant.email);
      await page.getByRole('textbox', { name: 'Mot de passe' }).fill(gerant.motDePasse);
      await page.getByRole('button', { name: 'Se connecter' }).click();
      await page.waitForURL(/\/admin\/(dashboard|menu)/);

      // ── 2 · Le changement de prix ──
      await page.goto(`${parc.web}/admin/menu`, { waitUntil: 'domcontentloaded' });
      const champ = page.getByRole('textbox', { name: `Prix de ${PRODUIT}`, exact: true });
      await champ.waitFor({ state: 'visible' });

      const saisie = euros(prixEssai).replace(' €', '');
      await champ.fill(saisie);
      await champ.press('Enter');
      await attendreTexte(page, `Prix mis à jour — ${euros(prixEssai)}`);

      // ── 3 · L'API publique porte le nouveau prix ──
      // Sans cache entre elle et la base : si elle ne l'a pas, l'écriture n'est
      // jamais arrivée et il est inutile d'attendre la vitrine une minute.
      const apres = await api.get(`/public/tenants/${parc.slug}/site`);
      assert.equal(
        produitDeLaCarte(apres, PRODUIT).price,
        prixEssai,
        'la carte publique servie par l’API doit porter le nouveau prix',
      );

      // ── 4 · Et le client le voit sur la page du restaurant ──
      // La vitrine est rendue avec un cache de 60 s : on sonde jusqu'à ce
      // qu'elle bascule, et on dit combien de temps ça a pris.
      const attendu = `${PRODUIT} — ${euros(prixEssai)}`;
      const delai = await rechargerJusqua(
        page,
        `${parc.web}/r/${parc.slug}`,
        async (p) => (await p.getByRole('button', { name: attendu }).count()) > 0,
        { delai: DELAI_PROPAGATION },
      );
      console.log(`   ↳ vitrine à jour après ${(delai / 1000).toFixed(1)} s (cache Next : 60 s)`);
    },
    // ── Le parc est remis en état, quoi qu'il soit arrivé ──
    async () => {
      await api.patch(`/products/${produit._id}`, { price: prixOrigine });
      const remis = await api.get(`/public/tenants/${parc.slug}/site`);
      assert.equal(
        produitDeLaCarte(remis, PRODUIT).price,
        prixOrigine,
        `LE PARC N’A PAS ÉTÉ REMIS EN ÉTAT : « ${PRODUIT} » doit revenir à ${euros(prixOrigine)}`,
      );
      await classerJournal();
    });
  },
);
