/**
 * Attribue un jeton de suivi aux commandes créées avant son introduction.
 *
 * Sans ce rattrapage, les liens de suivi et les tickets déjà en circulation
 * répondent 404 : la route publique exige désormais `?t=<trackingToken>`
 * (un ObjectId Mongo est partiellement prévisible, il ne peut pas servir de
 * secret pour exposer le nom et le téléphone d'un client).
 *
 * Idempotent : ne touche que les documents dépourvus de jeton.
 *
 * ATTENTION — seule reprise SANS mode lecture : elle écrit dès qu'elle est
 * lancée. C'est tenable parce qu'elle ne fait qu'AJOUTER un secret là où il
 * manque, sans jamais remplacer une valeur existante ; mais c'est ce qui la
 * sort du « lire d'abord » des autres `backfill:*`, et `docs/CI-CD.md` le dit
 * à l'opérateur plutôt que de la ranger dans la même colonne.
 *
 *   pnpm --filter @sm/db backfill:tracking
 *   pnpm --filter @sm/db backfill:tracking --exiger-zero  # échoue s'il en reste
 */
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { config as dotenv } from 'dotenv';
import mongoose from 'mongoose';
import { exigerZero, lireDrapeaux } from './backfill-flags';

dotenv({ path: resolve(__dirname, '../../../.env') });

const BATCH = 500;
const missing = { $or: [{ trackingToken: null }, { trackingToken: { $exists: false } }] };

async function main() {
  const drapeaux = lireDrapeaux();
  const uri = process.env.MONGO_URL;
  if (!uri) throw new Error('MONGO_URL manquant');
  await mongoose.connect(uri);

  const orders = mongoose.connection.db!.collection('orders');
  const total = await orders.countDocuments(missing);
  console.log(`Commandes sans jeton : ${total}`);
  if (total === 0) {
    await mongoose.disconnect();
    return;
  }

  const cursor = orders.find(missing, { projection: { _id: 1 } });
  let done = 0;
  // `bulkWrite` reçoit un tableau en lecture seule : on extrait le type
  // d'élément pour construire une file mutable sans transtypage.
  let ops: Parameters<typeof orders.bulkWrite>[0][number][] = [];

  const flush = async () => {
    if (ops.length === 0) return;
    await orders.bulkWrite(ops);
    done += ops.length;
    ops = [];
    console.log(`  ${done}/${total}`);
  };

  for await (const doc of cursor) {
    ops.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { trackingToken: randomBytes(24).toString('base64url') } },
      },
    });
    if (ops.length >= BATCH) await flush();
  }
  await flush();

  const rest = await orders.countDocuments(missing);
  console.log(rest === 0 ? '✓ Toutes les commandes ont un jeton' : `⚠ ${rest} restantes`);
  exigerZero(drapeaux, rest, 'commande(s) restent sans jeton');
  await mongoose.disconnect();
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
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
