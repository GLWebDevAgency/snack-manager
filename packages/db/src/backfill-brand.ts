/**
 * Reprend les tenants d'AVANT le masque d'identité.
 *
 * Jusqu'au 01/09/2026, un tenant ne portait qu'un logo et une couleur. Le
 * masque (`brand`) stocke désormais cinq rôles, une paire typographique, une
 * forme, un mouvement et quatre logos. Sans reprise, ces tenants n'ont pas de
 * `brand` — le résolveur leur dérive Nuit à la lecture, donc RIEN ne casse ;
 * mais un `brand` explicite est ce que l'éditeur (plan B) modifiera, et ce que
 * les captures de référence documentent.
 *
 * ── Garanties ──────────────────────────────────────────────────────────────
 *
 * N'écrit RIEN sans `--appliquer`. `$set` ciblé sur `brand` seul. Idempotent
 * par construction : un tenant qui a déjà `brand` est hors du lot.
 *
 *   pnpm --filter @sm/db backfill:brand              # montre
 *   pnpm --filter @sm/db backfill:brand --appliquer  # écrit
 */
import { resolve } from 'node:path';
import { config as dotenv } from 'dotenv';
import mongoose from 'mongoose';
import { marqueDeRepli, type Brand } from '@sm/contracts';
import { MODELS } from './schemas';

dotenv({ path: resolve(__dirname, '../../../.env') });

/** La décision, pure — `null` quand il n'y a rien à faire. */
export function repriseMarque(tenant: {
  brand?: unknown;
  brandColor?: unknown;
  logoUrl?: unknown;
}): Brand | null {
  if (tenant.brand) return null;
  return marqueDeRepli(
    typeof tenant.brandColor === 'string' ? tenant.brandColor : null,
    typeof tenant.logoUrl === 'string' ? tenant.logoUrl : null,
  );
}

async function main(): Promise<void> {
  const appliquer = process.argv.includes('--appliquer');
  const uri = process.env.MONGO_URL;
  if (!uri) throw new Error('MONGO_URL manquante');

  await mongoose.connect(uri);
  const Tenant = mongoose.model(MODELS.Tenant.name, MODELS.Tenant.schema, MODELS.Tenant.collection);

  const aReprendre = await Tenant.find({ brand: { $in: [null, undefined] } }).lean();
  console.log(`\n${aReprendre.length} tenant(s) sans masque — base « ${mongoose.connection.name} »\n`);
  if (aReprendre.length === 0) {
    await mongoose.disconnect();
    return;
  }

  const lot: { _id: unknown; nom: string; brand: Brand }[] = [];
  for (const t of aReprendre) {
    const brand = repriseMarque(t);
    if (!brand) continue;
    console.log(`  ${String(t.name ?? t.slug)} → Nuit · accent ${brand.palette.accent} · logo ${brand.logo.mark.dark ? 'oui' : 'non'}`);
    lot.push({ _id: t._id, nom: String(t.name ?? t.slug), brand });
  }

  if (!appliquer) {
    console.log('\nRien écrit. Relancer avec --appliquer pour enregistrer.\n');
    await mongoose.disconnect();
    return;
  }

  for (const { _id, brand } of lot) {
    await Tenant.updateOne({ _id }, { $set: { brand } });
  }
  console.log(`\n${lot.length} tenant(s) repris.\n`);
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
