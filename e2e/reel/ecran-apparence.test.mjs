/**
 * SCÉNARIO 5 — L'APPARENCE D'UN ÉCRAN SE CHOISIT EN REGARDANT.
 *
 * Le gérant crée un écran, ouvre son tiroir « Apparence », voit un téléviseur
 * miniature qui joue sa vraie boucle, change de scénographie et enregistre.
 * Trois systèmes : le back-office, la route d'aperçu de l'API, et l'hôte de
 * l'écran de salle — le même code que la clé HDMI. C'est la première
 * couverture de bout en bout de l'écran de salle.
 *
 * ─── CE SCÉNARIO ÉCRIT DANS UNE VRAIE BASE ───
 *
 * Il crée un écran et le supprime. La suppression est notée AVANT toute
 * action dans l'interface, et rejouée par le socle si le processus meurt en
 * route ; un écran laissé par une exécution précédente porte ce nom et est
 * retiré avant de commencer.
 */
import assert from 'node:assert/strict';
import { cibles } from '../socle/cibles.mjs';
import { attendreTexte } from '../socle/attentes.mjs';
import { FORMATS, scenario } from '../socle/navigateur.mjs';
import { client } from '../socle/api.mjs';
import { identifiants, raisonDeSauter } from '../socle/env.mjs';
import { classerJournal, noterARemettre, reparerParcSiNecessaire } from '../socle/parc.mjs';

const parc = cibles();
const sauter = raisonDeSauter(parc);

/** Un nom qu'aucun restaurateur ne donne à un écran : il se repère et se nettoie. */
const NOM = 'E2E · apparence';

scenario(
  'Back-office réel — l’apparence d’un écran se choisit sur un téléviseur miniature vivant',
  { format: FORMATS.comptoir, sauter, delai: 180_000 },
  async (page) => {
    const { gerant } = identifiants();
    const api = client(parc.api);
    await reparerParcSiNecessaire();
    await api.connexion(gerant);

    // Une exécution précédente morte en route a pu laisser son écran.
    for (const ancien of await api.get('/screens')) {
      if (ancien.name === NOM) await api.del(`/screens/${ancien.id}`);
    }

    const cree = await api.post('/screens', {
      name: NOM,
      orientation: 'landscape',
      theme: 'brand',
      scenography: 'comptoir',
    });
    await noterARemettre([
      {
        acteur: 'gerant',
        methode: 'DELETE',
        chemin: `/screens/${cree.id}`,
        corps: undefined,
        decrit: `écran « ${NOM} » supprimé`,
      },
    ]);

    try {
      // ── 1 · La connexion, par le vrai formulaire ──
      await page.goto(`${parc.web}/admin`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('textbox', { name: 'E-mail' }).fill(gerant.email);
      await page.getByRole('textbox', { name: 'Mot de passe' }).fill(gerant.motDePasse);
      await page.getByRole('button', { name: 'Se connecter' }).click();
      await page.waitForURL(/\/admin\/(dashboard|menu)/);

      // ── 2 · Le tiroir de l'écran créé ──
      await page.goto(`${parc.web}/admin/screens`, { waitUntil: 'domcontentloaded' });
      // Le plus petit `div` qui contient À LA FOIS le titre et le bouton : la
      // carte. Le dernier `div` contenant le seul titre serait son enveloppe.
      // `exact` : la corbeille s'appelle « Supprimer l'écran « E2E · apparence » »,
      // et Playwright cherche un nom par sous-chaîne, sans casse.
      const carte = page
        .locator('div')
        .filter({ has: page.getByRole('heading', { name: NOM, exact: true }) })
        .filter({ has: page.getByRole('button', { name: 'Apparence', exact: true }) })
        .last();
      await carte.getByRole('button', { name: 'Apparence', exact: true }).click();

      // ── 3 · Le téléviseur joue une scène — le même hôte que la salle ──
      // La plaque « Chargement de la carte » est elle aussi une couche : on
      // attend une SCÈNE de Comptoir, qui n'existe qu'avec du contenu.
      const apercu = page.getByTestId('apercu-ecran');
      await apercu
        .locator('.bd-root[data-scenography="comptoir"] .bd-stage[data-ready="1"] .ct')
        .first()
        .waitFor({ state: 'visible' });

      // ── 4 · Changer de scénographie se voit AVANT d'enregistrer ──
      await page.getByRole('button', { name: /^Ardoise/ }).click();
      await apercu.locator('.bd-root[data-scenography="ardoise"]').waitFor({ state: 'attached' });

      // ── 5 · Enregistrer, et relire par l'API ──
      await page.getByRole('button', { name: "Enregistrer l'apparence" }).click();
      await attendreTexte(page, 'Apparence enregistrée');
      const relu = await api.get(`/screens/${cree.id}`);
      assert.equal(relu.scenography, 'ardoise', 'la scénographie enregistrée doit être relue par l’API');
    } finally {
      // ── Le parc est remis en état, quoi qu'il soit arrivé ──
      await api.del(`/screens/${cree.id}`);
      await classerJournal();
    }
  },
);
