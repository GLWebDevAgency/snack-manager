/**
 * LE NAVIGATEUR, ET CE QU'ON EN EXIGE.
 *
 * Un contexte neuf par scénario : ni cookie, ni stockage local, ni jeton hérité
 * du scénario précédent. C'est ce qui rend l'ordre d'exécution indifférent, et
 * donc les tests reproductibles quand ils tournent en parallèle.
 *
 * Quatre réglages tiennent la stabilité, et aucun n'est cosmétique :
 *
 *  1. `reducedMotion: 'reduce'` — les animations d'entrée sont à leur état
 *     final dès le premier rendu. Sans lui, un clic peut tomber sur une carte
 *     encore en train de glisser, et rater sa cible une fois sur vingt.
 *  2. `locale: 'fr-FR'` — les montants sont formatés « 9,90 € ». Un runner en
 *     `en-US` rendrait « €9.90 » et tous les tests de total seraient faux.
 *  3. `timezoneId: 'Europe/Paris'` — la caisse, l'écran cuisine et les créneaux
 *     de retrait raisonnent en heure du restaurant. Une machine en UTC
 *     afficherait un service décalé de deux heures l'été.
 *  4. `deviceScaleFactor: 1` et une fenêtre fixe — la caisse change de
 *     disposition sous un seuil de largeur ; un écran de runner différent
 *     changerait les éléments présents.
 *
 * ─── CE QUI ARRIVE QUAND UN TEST TOMBE ───
 *
 * Un échec en intégration continue sans trace est un échec qu'on ne corrige
 * pas : on le relance, il repasse, on l'oublie. Chaque échec dépose donc dans
 * `e2e/rapports/` une capture d'écran, l'arbre d'accessibilité au moment de la
 * chute, l'adresse et les erreurs de console. De quoi comprendre sans rejouer.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import { enrichir } from './attentes.mjs';
import { DELAI_ECRAN } from './cibles.mjs';
import { RACINE } from './env.mjs';

const RAPPORTS = resolve(RACINE, 'e2e', 'rapports');

/** Tailles de référence — celles des vrais postes, pas des valeurs rondes. */
export const FORMATS = {
  /** Tablette de comptoir et écran de cuisine, posés en paysage. */
  comptoir: { width: 1440, height: 900 },
  /** Le téléphone du client. 390 px : l'iPhone le plus étroit encore vendu. */
  telephone: { width: 390, height: 844 },
};

/**
 * Ouvre un navigateur et un onglet prêts à l'emploi.
 *
 * `SM_E2E_TETE=1` ouvre une vraie fenêtre — pour regarder un scénario se jouer
 * quand on le met au point.
 */
export async function ouvrir({ format = FORMATS.comptoir } = {}) {
  const navigateur = await chromium.launch({
    headless: process.env.SM_E2E_TETE !== '1',
  });
  const contexte = await navigateur.newContext({
    viewport: format,
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
  });
  contexte.setDefaultTimeout(DELAI_ECRAN);
  contexte.setDefaultNavigationTimeout(DELAI_ECRAN);

  const page = await contexte.newPage();

  // Journal des incidents du navigateur. On ne fait PAS échouer un test
  // dessus : une erreur de console est trop souvent du bruit d'extension ou de
  // ressource tierce, et un test qui rougit pour du bruit est un test qu'on
  // apprend à ignorer. En revanche, quand un test tombe pour une autre raison,
  // ce journal est presque toujours ce qui explique pourquoi.
  const incidents = [];
  page.on('console', (message) => {
    if (message.type() === 'error') incidents.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (erreur) => incidents.push(`page: ${erreur.message}`));

  return {
    navigateur,
    contexte,
    page,
    incidents,
    fermer: () => navigateur.close().catch(() => {}),
  };
}

/** Écrit tout ce qu'on saura jamais de cet échec. */
async function consigner(session, nom) {
  const base = resolve(RAPPORTS, nom.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase());
  try {
    await mkdir(RAPPORTS, { recursive: true });
    await session.page.screenshot({ path: `${base}.png`, fullPage: true }).catch(() => {});
    const arbre = await session.page
      .locator('body')
      .ariaSnapshot()
      .catch(() => '(arbre d’accessibilité illisible)');
    await writeFile(
      `${base}.txt`,
      [
        `Scénario : ${nom}`,
        `Adresse  : ${session.page.url()}`,
        '',
        '── Incidents du navigateur ──',
        session.incidents.length ? session.incidents.join('\n') : '(aucun)',
        '',
        '── Arbre d’accessibilité au moment de la chute ──',
        arbre,
        '',
      ].join('\n'),
      'utf8',
    );
    return base;
  } catch {
    return null;
  }
}

/**
 * Déclare un scénario de bout en bout.
 *
 * Enveloppe `node:test` pour trois choses qu'on ne veut écrire qu'une fois : le
 * navigateur ouvert et refermé quoi qu'il arrive, la trace déposée en cas
 * d'échec, et un DÉLAI MAXIMAL EXPLICITE. Ce dernier compte : sans lui, un
 * scénario bloqué sur une attente immobilise le job d'intégration continue
 * jusqu'au plafond de GitHub, et personne ne sait pourquoi.
 */
export function scenario(nom, options, corps) {
  const { format, delai = 180_000, sauter = null } = options ?? {};
  test(nom, { timeout: delai, skip: sauter ?? false }, async (t) => {
    const session = await ouvrir({ format });
    try {
      await corps(session.page, { ...session, t });
    } catch (erreur) {
      const trace = await consigner(session, nom);
      throw trace
        ? enrichir(erreur, `→ Trace de l’échec : ${trace}.png · ${trace}.txt`)
        : erreur;
    } finally {
      await session.fermer();
    }
  });
}
