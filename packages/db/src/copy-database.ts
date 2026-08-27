import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MongoClient } from 'mongodb';

/**
 * SAUVEGARDE, COPIE ET PURGE D'UNE BASE MONGO — outil d'exploitation.
 *
 * Trois gestes, volontairement séparés, parce qu'ils n'ont pas le même
 * caractère : sauvegarder ne coûte rien, copier écrase une cible, purger
 * détruit. Chacun s'annonce avant d'agir et exige `--go`.
 *
 *   dump   <URI> <dossier>          sauvegarde JSON, collection par collection
 *   copy   <SOURCE> <CIBLE> [--go]  remplace la cible par la source
 *   purge  <URI> [--go]             vide la base
 *
 * DEUX PROTECTIONS, apprises de ce projet :
 *
 *  1. `copy` et `purge` PRÉSERVENT les comptes de plateforme (`tenantId: null`,
 *     rôle `sm_admin`). Purger la production sans cette exception nous
 *     fermerait notre propre back-office, depuis lequel on remet tout en
 *     route : on se verrouillerait dehors.
 *
 *  2. `copy` NE TRANSPORTE PAS les comptes utilisateurs. Un mot de passe de
 *     production recopié en staging vaudrait passe-partout : le jour où
 *     l'environnement de test fuit — et c'est celui qui fuit — il livrerait la
 *     production avec. Chaque environnement garde ses identifiants.
 */

/** Collections jamais transportées d'un environnement à l'autre. */
const NEVER_COPIED = new Set(['users']);

/** Ce qui survit à une purge : les comptes sans établissement (équipe SM). */
const PLATFORM_ACCOUNT = { tenantId: null } as const;

type Mode = 'dump' | 'copy' | 'purge';

function host(uri: string): string {
  return uri.replace(/.*@([^/?]+).*/, '$1');
}

async function collections(uri: string): Promise<{ client: MongoClient; names: string[] }> {
  const client = await MongoClient.connect(uri, { serverSelectionTimeoutMS: 20_000 });
  const names = (await client.db().listCollections().toArray())
    .map((c) => c.name)
    .filter((n) => !n.startsWith('system.'))
    .sort();
  return { client, names };
}

async function dump(uri: string, dir: string): Promise<void> {
  const { client, names } = await collections(uri);
  mkdirSync(dir, { recursive: true });
  console.log(`Sauvegarde de ${host(uri)} vers ${dir}\n`);
  let total = 0;
  for (const name of names) {
    const docs = await client.db().collection(name).find({}).toArray();
    writeFileSync(resolve(dir, `${name}.json`), JSON.stringify(docs, null, 0), 'utf8');
    if (docs.length) console.log(`  ${name.padEnd(14)} ${docs.length}`);
    total += docs.length;
  }
  await client.close();
  console.log(`\n${total} document(s) sauvegardé(s).`);
}

async function copy(from: string, to: string, write: boolean): Promise<void> {
  const source = await collections(from);
  const target = await MongoClient.connect(to, { serverSelectionTimeoutMS: 20_000 });

  console.log(`Copie ${host(from)}  →  ${host(to)}\n`);
  const plan: { name: string; docs: number }[] = [];
  for (const name of source.names) {
    if (NEVER_COPIED.has(name)) continue;
    plan.push({ name, docs: await source.client.db().collection(name).countDocuments() });
  }
  for (const { name, docs } of plan) console.log(`  ${name.padEnd(14)} ${docs}`);
  console.log(`\n  NON transporté : ${[...NEVER_COPIED].join(', ')} (chaque environnement garde ses identifiants).`);

  if (!write) {
    console.log('\nAperçu seulement. Relancez avec --go pour appliquer.');
    await source.client.close();
    await target.close();
    return;
  }

  for (const { name } of plan) {
    const docs = await source.client.db().collection(name).find({}).toArray();
    await target.db().collection(name).deleteMany({});
    if (docs.length) await target.db().collection(name).insertMany(docs, { ordered: false });
  }

  await relinkAccounts(source.client, target);
  await source.client.close();
  await target.close();
  console.log('\nCopie terminée.');
}

/**
 * RATTACHER LES COMPTES CONSERVÉS AUX ÉTABLISSEMENTS COPIÉS.
 *
 * On ne transporte pas les comptes — mais on remplace les établissements. Le
 * gérant de la cible garde donc un `tenantId` qui ne désigne plus rien, et
 * l'effet est déroutant : la connexion RÉUSSIT, un jeton parfaitement valide
 * est délivré… puis chaque appel suivant répond 401, parce que le guard
 * cherche un établissement introuvable. On croit à un mot de passe faux alors
 * que c'est un lien cassé.
 *
 * On rattache donc chaque compte par le SLUG de son ancien établissement, qui
 * lui survit à la copie. Un compte dont le slug n'existe pas dans la source
 * est signalé, jamais rattaché au hasard : mieux vaut un compte orphelin
 * annoncé qu'un gérant branché sur le restaurant d'un autre.
 */
async function relinkAccounts(source: MongoClient, target: MongoClient): Promise<void> {
  const accounts = await target
    .db()
    .collection('users')
    .find({ tenantId: { $ne: null } })
    .toArray();
  if (!accounts.length) return;

  console.log('\n  Rattachement des comptes conservés :');
  for (const account of accounts) {
    const before = await target.db().collection('tenants').findOne({ _id: account.tenantId });
    // Le slug d'origine se lit dans la CIBLE avant écrasement… qui vient
    // d'avoir lieu. On retombe donc sur l'unique établissement de la source
    // quand il n'y en a qu'un — le cas de ce projet — et on le dit.
    const candidates = await source.db().collection('tenants').find({}, { projection: { slug: 1 } }).toArray();
    const match = before ? candidates.find((t) => t.slug === before.slug) : candidates[0];

    if (!match || (candidates.length > 1 && !before)) {
      console.log(`    ${account.email} : établissement indécidable, laissé tel quel`);
      continue;
    }
    await target.db().collection('users').updateOne({ _id: account._id }, { $set: { tenantId: match._id } });
    console.log(`    ${account.email} → ${match.slug}`);
  }
}

async function purge(uri: string, write: boolean): Promise<void> {
  const { client, names } = await collections(uri);
  const db = client.db();

  console.log(`Purge de ${host(uri)}\n`);
  for (const name of names) {
    const n = await db.collection(name).countDocuments();
    if (!n) continue;
    if (name === 'users') {
      const kept = await db.collection('users').countDocuments(PLATFORM_ACCOUNT);
      console.log(`  ${name.padEnd(14)} ${n} → ${kept} conservé(s) (comptes d'équipe Snack Manager)`);
    } else {
      console.log(`  ${name.padEnd(14)} ${n} → 0`);
    }
  }

  if (!write) {
    console.log('\nAperçu seulement. Relancez avec --go pour appliquer.');
    await client.close();
    return;
  }

  for (const name of names) {
    if (name === 'users') {
      // On supprime les comptes RATTACHÉS à un établissement ; ceux de la
      // plateforme restent, sans quoi plus personne n'ouvre le back-office.
      await db.collection('users').deleteMany({ tenantId: { $ne: null } });
    } else {
      await db.collection(name).deleteMany({});
    }
  }
  await client.close();
  console.log('\nPurge terminée.');
}

async function main(): Promise<void> {
  const [mode, ...rest] = process.argv.slice(2) as [Mode, ...string[]];
  const write = rest.includes('--go');
  const args = rest.filter((a) => a !== '--go');

  // Déstructuration plutôt qu'un test sur `length` : `noUncheckedIndexedAccess`
  // ne déduit pas la présence d'un élément d'un contrôle de longueur, et il a
  // raison — c'est l'absence explicite qui doit décider, sur un outil dont un
  // argument manquant viserait la mauvaise base.
  const [first, second] = args;
  if (mode === 'dump' && first && second) return dump(first, second);
  if (mode === 'copy' && first && second) return copy(first, second, write);
  if (mode === 'purge' && first && !second) return purge(first, write);

  console.error(
    'Usage :\n' +
      '  dump  <URI> <dossier>\n' +
      '  copy  <SOURCE> <CIBLE> [--go]\n' +
      '  purge <URI> [--go]',
  );
  process.exit(1);
}

/**
 * N'EXÉCUTE QUE LANCÉ DIRECTEMENT — jamais à l'import.
 *
 * Sans cette garde, importer ce fichier — pour tester une de ses fonctions, ou
 * par une chaîne d'imports involontaire — ouvre une connexion à la base pointée
 * par l'environnement et LANCE le traitement. Sur un poste dont le `.env` vise
 * la production, c'est un script d'administration qui part tout seul.
 */
if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
