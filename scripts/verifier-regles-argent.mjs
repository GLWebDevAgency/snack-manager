#!/usr/bin/env node
/**
 * LES TESTS PROTÈGENT-ILS ENCORE L'ARGENT ?
 *
 * Une suite verte prouve que le code passe les tests. Elle ne prouve pas que
 * les tests attraperaient une régression : un test qui ne vérifie rien reste
 * vert quoi qu'il arrive, et c'est précisément ce qu'on ne voit jamais.
 *
 * Ce harnais CASSE volontairement, une par une, les règles du produit qui
 * décident d'un montant, et vérifie qu'un test tombe. Une mutation qui passe
 * inaperçue est une protection qui n'existe pas — on croyait l'avoir écrite.
 *
 * ── Pourquoi seulement l'argent ───────────────────────────────────────────
 *
 * La mutation exhaustive d'un dépôt de cette taille prendrait des heures et
 * noierait le signal. Cette liste est écrite à la main et tenue à la main :
 * elle ne contient que des règles dont l'inversion coûte de l'argent au
 * restaurateur, à son client, ou à l'éditeur. Chaque entrée cite la règle et
 * dit ce qui se passerait si elle sautait.
 *
 * ── Quand le lancer ──────────────────────────────────────────────────────
 *
 * Avant une mise en production, et après tout remaniement qui touche à la
 * facturation, aux promotions ou aux remises. Pas en CI : il reconstruit les
 * paquets entre chaque mutation, il est lent par nature.
 *
 *     node scripts/verifier-regles-argent.mjs
 *
 * ── Sûreté ───────────────────────────────────────────────────────────────
 *
 * Chaque fichier est restauré dans un `finally`, y compris si la suite plante
 * ou si le script est interrompu. Il REFUSE de démarrer sur un dépôt qui a des
 * modifications non enregistrées : en cas d'arrêt brutal, `git checkout` doit
 * suffire à tout remettre en place, et il ne le peut pas si du travail en cours
 * se mêle aux mutations.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Chaque entrée : le fichier, le texte EXACT à remplacer, son remplacement, ce
 * que la règle protège, et la suite qui devrait s'en apercevoir.
 *
 * `build` est le paquet à reconstruire avant de lancer la suite — `@sm/domain`
 * et `@sm/contracts` sont consommés depuis leur `dist/`, une mutation de leur
 * source ne changerait rien sans cette étape. C'est le piège qui a déjà fait
 * croire à une règle appliquée alors qu'elle ne l'était pas.
 */
const REGLES = [
  {
    nom: 'la cuisine ne peut accorder aucune remise',
    casse: 'un code cuisine offrirait la commande entière',
    fichier: 'packages/contracts/src/index.ts',
    avant: '  cuisine: 0,',
    apres: '  cuisine: 99_999,',
    build: '@sm/contracts',
    cwd: 'apps/api',
    suite: 'src/modules/orders/remise-autorisee.test.ts',
  },
  {
    nom: 'la remise fondateur est un MONTANT figé, pas un taux',
    casse: 'un fondateur relancerait sa remise en changeant d’offre',
    fichier: 'packages/contracts/src/crm.ts',
    avant:
      'return Math.min(Math.max(0, offre.founderDiscountCents ?? 0), logicielCents + servicesCents);',
    apres: 'return remiseFondateurCents(logicielCents + servicesCents);',
    build: '@sm/contracts',
    cwd: 'packages/contracts',
    suite: 'src/fondateur.test.ts',
  },
  {
    nom: 'une promotion ne dépasse jamais le sous-total',
    casse: 'le total deviendrait négatif — de l’argent rendu au client',
    fichier: 'packages/domain/src/ordering/promotion.ts',
    avant: '  if (montant.cents > contexte.subtotal.cents) {\n    montant = contexte.subtotal;\n  }',
    apres: '  // borne retirée par le harnais',
    build: '@sm/domain',
    cwd: 'packages/domain',
    suite: 'src/ordering/promotion.test.ts',
  },
  {
    nom: 'le plafond « aucune remise » bloque effectivement',
    casse: 'le rôle du valideur cesserait d’être lu',
    fichier: 'packages/domain/src/ordering/discount.ts',
    avant: "    if (plafond === 0) {\n      return err(new AuthorizationRequired('remise'));\n    }",
    apres: '    // garde retirée par le harnais',
    build: '@sm/domain',
    cwd: 'apps/api',
    suite: 'src/modules/orders/remise-autorisee.test.ts',
  },
  {
    nom: 'le quota de promotion est arbitré EN BASE',
    casse: 'deux commandes simultanées dépasseraient le quota',
    fichier: 'apps/api/src/modules/orders/orders.service.ts',
    avant:
      "        $or: [{ maxUsage: { $lte: 0 } }, { $expr: { $lt: ['$usageCount', '$maxUsage'] } }],",
    apres: '        // garde retirée par le harnais',
    build: null,
    cwd: 'apps/api',
    suite: 'src/modules/orders/promotion-appliquee.test.ts',
  },
  {
    nom: 'le rendu monnaie suit le total DÛ, pas le sous-total',
    casse: 'la caisse refuserait le bon montant et garderait la monnaie du client',
    fichier: 'apps/api/src/modules/orders/orders.service.ts',
    avant: 'payment: resolvePayment(dto.channel, dto.payment, totalDu),',
    apres: 'payment: resolvePayment(dto.channel, dto.payment, subtotal),',
    build: null,
    cwd: 'apps/api',
    suite: 'src/modules/orders/promotion-appliquee.test.ts',
  },
  {
    nom: 'le MRR d’un client annuel est normalisé',
    casse: 'le MRR du parc serait surestimé de vingt pour cent par client annuel',
    fichier: 'apps/api/src/modules/crm/billing.service.ts',
    avant:
      'const mrrOf = (tenant: RawTenant, now: Date = new Date()): number =>\n  mrrNormaliseCents(offreClient(tenant), now);',
    apres:
      'const mrrOf = (tenant: RawTenant, now: Date = new Date()): number =>\n  abonnementMensuelCents(offreClient(tenant), now);',
    build: null,
    cwd: 'apps/api',
    suite: 'src/modules/crm/billing.test.ts',
  },
];

// `execFileSync` et non `execSync` : aucune de ces valeurs ne vient d'une
// entrée extérieure, mais passer par un shell pour rien c'est laisser la porte
// ouverte au jour où quelqu'un rendra cette liste configurable.
const muet = { cwd: RACINE, stdio: 'ignore' };

const construire = (paquet) => execFileSync('pnpm', ['--filter', paquet, 'build'], muet);

function propre() {
  const sortie = execFileSync('git', ['status', '--porcelain'], {
    cwd: RACINE,
    encoding: 'utf8',
  });
  return sortie.trim() === '';
}

function suiteTombe({ cwd, suite }) {
  const r = spawnSync('npx', ['vitest', 'run', suite], {
    cwd: join(RACINE, cwd),
    stdio: 'ignore',
  });
  return r.status !== 0;
}

function main() {
  if (!propre()) {
    console.error(
      '\nDépôt modifié. Ce harnais réécrit des fichiers source : sur un arrêt brutal,\n' +
        '« git checkout . » doit suffire à tout remettre en place, et il ne le peut pas\n' +
        'si du travail en cours se mêle aux mutations.\n\n' +
        'Enregistrez ou remisez vos modifications, puis relancez.\n',
    );
    process.exit(2);
  }

  console.log(`\n${REGLES.length} règles d'argent — on les casse une par une.`);
  console.log('Un ✓ veut dire qu’un test l’a vu. Un ✗ est une protection qui n’existe pas.\n');

  const manques = [];
  for (const regle of REGLES) {
    const chemin = join(RACINE, regle.fichier);
    const source = readFileSync(chemin, 'utf8');

    if (!source.includes(regle.avant)) {
      console.log(`  ⚠ RÈGLE INTROUVABLE   ${regle.nom}`);
      console.log(`     ${regle.fichier} a changé — mettez ce harnais à jour.`);
      manques.push(regle);
      continue;
    }

    try {
      writeFileSync(chemin, source.replace(regle.avant, regle.apres), 'utf8');
      if (regle.build) construire(regle.build);
      const vue = suiteTombe(regle);
      console.log(`  ${vue ? '✓ attrapée        ' : '✗ PASSÉE INAPERÇUE'}  ${regle.nom}`);
      if (!vue) {
        console.log(`     si elle saute : ${regle.casse}`);
        manques.push(regle);
      }
    } finally {
      writeFileSync(chemin, source, 'utf8');
      if (regle.build) construire(regle.build);
    }
  }

  const tenues = REGLES.length - manques.length;
  console.log(`\n${tenues} / ${REGLES.length} règles réellement protégées.`);
  if (manques.length > 0) {
    console.log('\nÉcrivez le test manquant AVANT de mettre en production :');
    for (const m of manques) console.log(`   · ${m.nom} — ${m.casse}`);
    process.exit(1);
  }
  console.log('Aucune règle d’argent ne peut sauter sans qu’un test le dise.\n');
}

main();
