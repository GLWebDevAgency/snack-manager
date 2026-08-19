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
 *   pnpm --filter @sm/db backfill:tracking
 */
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { config as dotenv } from 'dotenv';
import mongoose from 'mongoose';

dotenv({ path: resolve(__dirname, '../../../.env') });

const BATCH = 500;
const missing = { $or: [{ trackingToken: null }, { trackingToken: { $exists: false } }] };

async function main() {
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
  let ops: Parameters<typeof orders.bulkWrite>[0] = [];

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
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
