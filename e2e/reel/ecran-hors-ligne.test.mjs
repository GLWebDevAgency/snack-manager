/**
 * SCÉNARIO 6 — L'ÉCRAN DE SALLE CONTINUE SANS RÉSEAU.
 *
 * Une clé HDMI redémarre après une coupure de courant pendant que la box du
 * restaurant met une minute à revenir. La carte doit se réafficher : la
 * coquille, les scripts, les feuilles et les photos sont sur l'appareil.
 *
 * Le parcours : un écran est créé, appairé par l'adresse de démarrage, joue
 * une scène ; le worker et sa coquille sont prêts ; le réseau est COUPÉ ; la
 * page est rechargée ; une scène s'affiche encore ; le réseau revient ;
 * l'écran est supprimé.
 *
 * ─── CE SCÉNARIO ÉCRIT DANS UNE VRAIE BASE ───
 * La suppression est notée avant toute action dans l'interface.
 */
import assert from 'node:assert/strict';
import { cibles } from '../socle/cibles.mjs';
import { FORMATS, scenario } from '../socle/navigateur.mjs';
import { client } from '../socle/api.mjs';
import { identifiants, raisonDeSauter } from '../socle/env.mjs';
import { classerJournal, noterARemettre, reparerParcSiNecessaire } from '../socle/parc.mjs';

const parc = cibles();
const sauter = raisonDeSauter(parc);
const NOM = 'E2E · hors ligne';

/** Une couche de scène qui n'est pas la plaque « Chargement de la carte ». */
const SCENE = '.bd-stage[data-ready="1"] .bd-layer[data-phase="in"]:not(:has-text("Chargement de la carte"))';

scenario(
  'Écran de salle réel — la carte se réaffiche sans réseau après un redémarrage',
  { format: FORMATS.comptoir, sauter, delai: 240_000 },
  async (page) => {
    const { gerant } = identifiants();
    const api = client(parc.api);
    await reparerParcSiNecessaire();
    await api.connexion(gerant);

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
    const context = page.context();

    try {
      // ── 1 · L'appairage par l'adresse de démarrage, puis la carte ──
      assert.ok(cree.pairing?.code, 'l’écran créé doit porter un code d’appairage');
      await page.goto(`${parc.web}/board?code=${cree.pairing.code}`, { waitUntil: 'domcontentloaded' });
      await page.waitForURL(/\/board\/display/, { timeout: 60_000 });
      await page.locator(SCENE).first().waitFor({ state: 'visible', timeout: 60_000 });

      // ── 2 · Le worker est prêt, et la coquille est sur l'appareil ──
      await page.waitForFunction(
        async () => {
          if (!('serviceWorker' in navigator)) return false;
          const registration = await navigator.serviceWorker.getRegistration('/board');
          if (!registration || !registration.active) return false;
          const cache = await caches.open('sm-board:v1');
          return Boolean(await cache.match('/board/display'));
        },
        undefined,
        { timeout: 60_000 },
      );
      const medias = await page.evaluate(async () => (await (await caches.open('sm-board:media:v1')).keys()).length);
      console.log(`   ↳ ${medias} média(s) précaché(s)`);

      // ── 3 · Le réseau est coupé : la page se recharge et joue encore ──
      await context.setOffline(true);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator(SCENE).first().waitFor({ state: 'visible', timeout: 60_000 });
      const titre = await page.locator('.bd-stage').first().innerText();
      assert.ok(!titre.includes('Chargement de la carte'), 'sans réseau, l’écran doit rejouer sa carte');
      console.log('   ↳ hors ligne, une scène est affichée');
    } finally {
      await context.setOffline(false);
      await api.del(`/screens/${cree.id}`);
      await classerJournal();
    }
  },
);
