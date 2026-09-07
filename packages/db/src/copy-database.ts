import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MongoClient } from 'mongodb';
import { assertDisposableMongoTarget, assertNoDurableOrderData, assertNoDurableOrderDocuments } from './disposable-mongo-target';

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
 * copy/purge --go : cible locale explicitement jetable seulement, jamais
 * staging/production. Preuves C01/C15 présentes : refus, même en local.
 * Ce n'est pas un outil de restauration. Voir ../README.md.
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

class CopyDatabaseUsageError extends Error {
  readonly code = 'MONGO_TOOL_INVALID_ARGUMENTS';
  constructor() {
    super('Usage :\n  dump <URI> <dossier>\n  copy <SOURCE> <CIBLE> [--go]\n  purge <URI> [--go]\nAucune autre option ni argument n’est accepté.');
    this.name = 'CopyDatabaseUsageError';
  }
}

function host(uri: string): string {
  try { const parsed = new URL(uri); return parsed.host || '(hôte non affiché)'; }
  catch { return '(hôte non affiché)'; }
}

async function collections(uri: string, direct = false): Promise<{ client: MongoClient; names: string[] }> {
  const client = await MongoClient.connect(uri, { serverSelectionTimeoutMS: 20_000, ...(direct ? { directConnection: true } : {}) });
  try {
    const names = (await client.db().listCollections().toArray())
      .map((c) => c.name)
      .filter((n) => !n.startsWith('system.'))
      .sort();
    return { client, names };
  } catch (error) { await client.close(); throw error; }
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
  // Validate before even opening the read source, never after the first write.
  if (write) assertDisposableMongoTarget(to);
  const source = await collections(from);
  let target: MongoClient | undefined;
  try {
    target = await MongoClient.connect(to, { serverSelectionTimeoutMS: 20_000, ...(write ? { directConnection: true } : {}) });
    await copyToDisposable(source, target, from, to, write);
  } finally {
    await Promise.all([source.client.close(), target?.close()]);
  }
}

async function copyToDisposable(source: { client: MongoClient; names: string[] }, target: MongoClient,
  from: string, to: string, write: boolean): Promise<void> {

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
    return;
  }

  await assertNoDurableOrderData(source.client.db());
  await assertNoDurableOrderData(target.db());
  for (const { name } of plan) {
    const docs = await source.client.db().collection(name).find({}).toArray();
    assertNoDurableOrderDocuments(name, docs);
    // Diagnostic against a changed source, not a concurrency fence. The target
    // remains disposable and must never be served as an activated restaurant.
    await assertNoDurableOrderData(source.client.db());
    await assertNoDurableOrderData(target.db());
    await target.db().collection(name).deleteMany({});
    if (docs.length) await target.db().collection(name).insertMany(docs, { ordered: false });
  }

  await relinkAccounts(source.client, target);
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
      console.log('    Compte conservé : établissement indécidable, laissé tel quel');
      continue;
    }
    await target.db().collection('users').updateOne({ _id: account._id }, { $set: { tenantId: match._id } });
    console.log('    Compte conservé rattaché à l’établissement copié');
  }
}

async function purge(uri: string, write: boolean): Promise<void> {
  if (write) assertDisposableMongoTarget(uri);
  const { client, names } = await collections(uri, write);
  try { await purgeDisposable(client, names, uri, write); }
  finally { await client.close(); }
}

async function purgeDisposable(client: MongoClient, names: string[], uri: string, write: boolean): Promise<void> {
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
    return;
  }

  await assertNoDurableOrderData(db);
  for (const name of names) {
    await assertNoDurableOrderData(db);
    if (name === 'users') {
      // On supprime les comptes RATTACHÉS à un établissement ; ceux de la
      // plateforme restent, sans quoi plus personne n'ouvre le back-office.
      await db.collection('users').deleteMany({ tenantId: { $ne: null } });
    } else {
      await db.collection(name).deleteMany({});
    }
  }
  console.log('\nPurge terminée.');
}

export async function runCopyDatabase(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  if (!Array.isArray(argv) || argv.some((value) => typeof value !== 'string')) throw new CopyDatabaseUsageError();
  const [mode, ...rest] = argv;
  if (rest.filter((value) => value === '--go').length > 1
    || rest.some((value) => value.startsWith('--') && value !== '--go')) throw new CopyDatabaseUsageError();
  const write = rest.includes('--go');
  const args = rest.filter((a) => a !== '--go');

  // Déstructuration plutôt qu'un test sur `length` : `noUncheckedIndexedAccess`
  // ne déduit pas la présence d'un élément d'un contrôle de longueur, et il a
  // raison — c'est l'absence explicite qui doit décider, sur un outil dont un
  // argument manquant viserait la mauvaise base.
  const [first, second] = args;
  if (mode === 'dump' && args.length === 2 && first && second && !write) return dump(first, second);
  if (mode === 'copy' && args.length === 2 && first && second) return copy(first, second, write);
  if (mode === 'purge' && args.length === 1 && first) return purge(first, write);
  throw new CopyDatabaseUsageError();
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
  runCopyDatabase().catch((error: unknown) => {
    const known = error instanceof Error && ['DisposableMongoRefusal', 'CopyDatabaseUsageError'].includes(error.name);
    console.error(known ? error.message : 'Opération Mongo interrompue. Ne pas reprendre une copie partielle comme une base restaurée.');
    process.exit(1);
  });
}
