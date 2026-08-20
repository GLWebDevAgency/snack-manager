#!/usr/bin/env node
/**
 * LE POINT D'ENTRÉE UNIQUE — `pnpm e2e`.
 *
 *     pnpm e2e                       les deux séries, contre staging
 *     pnpm e2e --demo                seulement ce qui tourne sur fixture
 *     pnpm e2e --reel                seulement ce qui touche une vraie API
 *     pnpm e2e --local               contre les serveurs de développement
 *     pnpm e2e --cible production     contre la production (lecture seule *)
 *     pnpm e2e --navigateur          installe Chromium et s'arrête
 *
 *   * en production, les scénarios « réel » s'annoncent IGNORÉS tant qu'aucun
 *     établissement n'y est déclaré (voir `socle/cibles.mjs`).
 *
 * ─── POURQUOI DEUX SÉRIES, ET DEUX EXÉCUTIONS SÉPARÉES ───
 *
 * `e2e/demo/` tourne sur une fixture, dans le navigateur : aucun état n'est
 * partagé, les fichiers peuvent donc s'exécuter EN PARALLÈLE — c'est ce qui
 * garde la série sous les dix secondes.
 *
 * `e2e/reel/` écrit dans une vraie base : suspendre un établissement pendant
 * qu'un autre scénario lui change un prix produirait des échecs qui ne
 * désignent rien. Cette série est donc EN FILE, un fichier à la fois.
 *
 * ─── POURQUOI `node --test` ET PAS `@playwright/test` ───
 *
 * Le périmètre de ce travail couvre `e2e/**` et l'ajout de scripts au
 * `package.json` racine — pas l'ajout d'une dépendance, qui toucherait
 * `pnpm-lock.yaml`. `playwright` est déjà présent à la racine ; le lanceur de
 * tests de Node suffit au reste. Contrepartie assumée et plutôt saine ici :
 * PAS DE REPRISE AUTOMATIQUE. Un scénario qui échoue échoue — ce qui est
 * exactement ce qu'on veut de tests dont la valeur tient à leur fiabilité.
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cibles } from './socle/cibles.mjs';
import { raisonDeSauter } from './socle/env.mjs';

const ICI = dirname(fileURLToPath(import.meta.url));
const RACINE = resolve(ICI, '..');

const args = process.argv.slice(2);
const veut = (nom) => args.includes(nom);

// ── Cible ──
if (veut('--local')) process.env.SM_E2E_CIBLE = 'local';
const posCible = args.indexOf('--cible');
if (posCible !== -1 && args[posCible + 1]) process.env.SM_E2E_CIBLE = args[posCible + 1];

// ── Installation du navigateur, puis sortie ──
if (veut('--navigateur')) {
  const code = await lancer(
    process.execPath,
    [
      resolve(RACINE, 'node_modules', 'playwright', 'cli.js'),
      'install',
      // Les bibliothèques système ne s'installent que sur Linux, et le geste
      // demande les droits d'administration : sur un poste de développement il
      // n'a pas lieu d'être, et il y échouerait bruyamment pour rien.
      ...(process.platform === 'linux' ? ['--with-deps'] : []),
      'chromium',
    ],
    'Installation de Chromium',
  );
  process.exit(code);
}

const parc = cibles();
const demoSeul = veut('--demo');
const reelSeul = veut('--reel');

const series = [];
if (!reelSeul) {
  series.push({
    nom: 'Démonstrations',
    quoi: 'caisse · cuisine · commande en ligne · back-office — fixture, aucun état partagé',
    // Un motif, pas un dossier : `node --test` n'accepte un répertoire que
    // dans certaines versions, alors qu'il développe un glob depuis Node 22
    // partout. Un lanceur qui ne trouve aucun test et sort en vert serait la
    // pire panne possible de ce dossier.
    motif: 'e2e/demo/*.test.mjs',
    concurrence: null, // parallèle : c'est sans danger et c'est ce qui va vite
  });
}
if (!demoSeul) {
  series.push({
    nom: 'Parc réel',
    quoi: 'prix public · suspension — vraie API, remise en état vérifiée',
    motif: 'e2e/reel/*.test.mjs',
    concurrence: 1, // en file : ces scénarios écrivent dans la même base
  });
}

console.log('');
console.log(`  Tests de bout en bout — cible « ${parc.nom} »`);
console.log(`     caisse  ${parc.pos}`);
console.log(`     cuisine ${parc.kds}`);
console.log(`     web     ${parc.web}`);
console.log(`     api     ${parc.api}`);
const raison = raisonDeSauter(parc);
if (raison && !demoSeul) {
  console.log('');
  console.log(`  ⚠  Parc réel : IGNORÉ — ${raison}`);
}
console.log('');

const resultats = [];
for (const serie of series) {
  const depart = Date.now();
  const code = await lancer(
    process.execPath,
    [
      '--test',
      '--test-reporter=spec',
      ...(serie.concurrence ? [`--test-concurrency=${serie.concurrence}`] : []),
      serie.motif,
    ],
    `${serie.nom} — ${serie.quoi}`,
  );
  resultats.push({ ...serie, code, duree: Date.now() - depart });
}

// ── Le récapitulatif ──
console.log('');
console.log('  ─────────────────────────────────────────────────────────────');
for (const r of resultats) {
  const verdict = r.code === 0 ? '✔ vert ' : '✘ ROUGE';
  console.log(`  ${verdict}  ${r.nom.padEnd(14)} ${(r.duree / 1000).toFixed(1).padStart(6)} s`);
}
const total = resultats.reduce((somme, r) => somme + r.duree, 0);
console.log(`           ${'total'.padEnd(14)} ${(total / 1000).toFixed(1).padStart(6)} s`);
console.log('  ─────────────────────────────────────────────────────────────');
console.log('');

process.exit(resultats.some((r) => r.code !== 0) ? 1 : 0);

/** Lance un processus enfant en héritant des flux, et rend son code de sortie. */
function lancer(commande, arguments_, titre) {
  console.log(`  ▸ ${titre}`);
  console.log('');
  return new Promise((tenu) => {
    const enfant = spawn(commande, arguments_, { cwd: RACINE, stdio: 'inherit' });
    enfant.on('close', (code) => tenu(code ?? 1));
  });
}
