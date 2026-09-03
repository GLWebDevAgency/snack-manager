import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const SMOKE = fileURLToPath(new URL('./smoke.mjs', import.meta.url));
const serveurs = new Set();

afterEach(async () => {
  await Promise.all(
    [...serveurs].map(
      (serveur) =>
        new Promise((resolve) => {
          serveur.close(resolve);
        }),
    ),
  );
  serveurs.clear();
});

function catalogueValide() {
  return {
    restaurant: { slug: 'classfood', name: "CLASS'FOOD" },
    program: {
      name: 'La carte Classfood',
      mechanism: 'points',
      unitLabelSingular: 'point',
      unitLabelPlural: 'points',
      termsSummary: 'Conditions du programme.',
    },
    rewards: [],
  };
}

async function jouerSmoke({ environnement = 'staging', catalogue, pageFidelite } = {}) {
  const appels = [];
  const serveur = createServer((requete, reponse) => {
    const chemin = new URL(requete.url ?? '/', 'http://local').pathname;
    appels.push(chemin);
    reponse.setHeader('content-type', chemin.startsWith('/api/') ? 'application/json' : 'text/html');

    if (chemin === '/api/health') {
      reponse.end(JSON.stringify({ ok: true, service: 'snack-manager-api', revision: 'abc1234' }));
      return;
    }
    if (chemin === '/api/public/tenants/classfood/menu') {
      reponse.end(JSON.stringify({ categories: [] }));
      return;
    }
    if (chemin === '/api/public/tenants/classfood/loyalty') {
      reponse.end(JSON.stringify(catalogue ?? catalogueValide()));
      return;
    }
    if (chemin === '/web/r/classfood/fidelite') {
      reponse.end(
        pageFidelite ??
          '<!doctype html><title>La carte Classfood — CLASS\'FOOD</title><main>Chargement de votre carte fidélité</main>',
      );
      return;
    }
    const titres = {
      '/web/': 'Snack Manager',
      '/pos/': 'Snack Manager — Caisse',
      '/kds/': 'Snack Manager — Cuisine',
    };
    const titre = titres[chemin];
    if (titre) {
      reponse.end(`<!doctype html><title>${titre}</title>`);
      return;
    }
    reponse.statusCode = 404;
    reponse.end('introuvable');
  });
  serveurs.add(serveur);
  await new Promise((resolve) => serveur.listen(0, '127.0.0.1', resolve));
  const adresse = serveur.address();
  if (!adresse || typeof adresse === 'string') throw new Error('Adresse de test indisponible');
  const base = `http://127.0.0.1:${adresse.port}`;

  const enfant = spawn(process.execPath, [SMOKE, environnement], {
    env: {
      ...process.env,
      SM_URL_API: `${base}/api`,
      SM_URL_WEB: `${base}/web`,
      SM_URL_POS: `${base}/pos`,
      SM_URL_KDS: `${base}/kds`,
      SM_SLUG_CARTE: environnement === 'production' ? '' : 'classfood',
      SM_SLUG_CARTE_PRODUCTION: '',
      SM_REVISION_ATTENDUE: '',
      SM_TENTATIVES: '1',
      SM_ATTENTE_MS: '0',
      SM_DELAI_REQUETE_MS: '1000',
      GITHUB_ACTIONS: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let sortie = '';
  let erreur = '';
  enfant.stdout.setEncoding('utf8');
  enfant.stderr.setEncoding('utf8');
  enfant.stdout.on('data', (chunk) => {
    sortie += chunk;
  });
  enfant.stderr.on('data', (chunk) => {
    erreur += chunk;
  });
  const code = await new Promise((resolve, reject) => {
    enfant.once('error', reject);
    enfant.once('close', resolve);
  });
  await new Promise((resolve) => serveur.close(resolve));
  serveurs.delete(serveur);
  return { code, sortie, erreur, appels };
}

describe('smoke public', () => {
  it('vérifie le menu, le catalogue fidélité et sa vraie PWA', async () => {
    const resultat = await jouerSmoke();

    expect(resultat.code, resultat.erreur || resultat.sortie).toBe(0);
    expect(resultat.appels).toContain('/api/public/tenants/classfood/menu');
    expect(resultat.appels).toContain('/api/public/tenants/classfood/loyalty');
    expect(resultat.appels).toContain('/web/r/classfood/fidelite');
    expect(resultat.sortie).toContain('Le catalogue fidélité public se sert');
    expect(resultat.sortie).toContain('La PWA fidélité publique se sert');
  });

  it('refuse un catalogue fidélité mal formé', async () => {
    const resultat = await jouerSmoke({
      catalogue: { restaurant: { slug: 'classfood' }, program: {}, rewards: [] },
    });

    expect(resultat.code).toBe(1);
    expect(resultat.sortie).toContain('charge sans programme fidélité public valide');
  });

  it('refuse le faux vert HTTP 200 de la page fidélité indisponible', async () => {
    const resultat = await jouerSmoke({
      pageFidelite:
        '<!doctype html><title>Programme fidélité indisponible</title><main>Indisponible</main>',
    });

    expect(resultat.code).toBe(1);
    expect(resultat.sortie).toContain('la page de repli « Programme fidélité indisponible » est servie');
  });

  it('ignore les trois surfaces tenant en production tant que le slug est vide', async () => {
    const resultat = await jouerSmoke({ environnement: 'production' });

    expect(resultat.code, resultat.erreur || resultat.sortie).toBe(0);
    expect(resultat.sortie).toMatch(/La carte publique se sert — IGNORÉ/);
    expect(resultat.sortie).toMatch(/Le catalogue fidélité public se sert — IGNORÉ/);
    expect(resultat.sortie).toMatch(/La PWA fidélité publique se sert — IGNORÉ/);
    expect(resultat.appels.some((chemin) => chemin.includes('/tenants/'))).toBe(false);
    expect(resultat.appels.some((chemin) => chemin.includes('/fidelite'))).toBe(false);
  });
});
