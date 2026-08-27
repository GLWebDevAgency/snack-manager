/**
 * Reprend les clients FONDATEUR signés avant que la remise n'existe en code.
 *
 * INCIDENT — le CRM a porté pendant des mois une promesse de « tarif gelé à
 * vie » que rien n'appliquait : `founderSeat` était un booléen d'affichage, et
 * pas une ligne de code ne changeait un prix. Le 27/08/2026, l'offre est
 * devenue « moitié prix pendant douze mois » avec deux champs pour la porter —
 * `founderUntil` (le terme) et `founderDiscountCents` (la portée). Les clients
 * déjà au parc n'ont ni l'un ni l'autre.
 *
 * Sans cette reprise, leur propre écran « Abonnement » leur affiche la pastille
 * « Fondateur — moitié prix » à côté d'un montant plein tarif, et la passe
 * mensuelle leur facture le tarif public. La promesse est à l'écran, la remise
 * n'est nulle part.
 *
 * ── Ce que le script ne peut pas savoir ───────────────────────────────────
 *
 * L'offre SIGNÉE n'est conservée nulle part : le tenant ne porte que son offre
 * COURANTE. La remise est donc figée sur ce que le client possède aujourd'hui,
 * ce qui est exact pour tout client qui n'a rien changé depuis sa signature —
 * le cas de tout le parc actuel, puisque le bouton « changer l'offre » date
 * lui aussi du 27/08/2026. Le compte rendu affiche chaque montant pour qu'il
 * soit relu avant écriture, et non pris sur parole.
 *
 * De même, la date de signature est prise sur `createdAt`. Un fondateur créé il
 * y a plus de douze mois ressort donc avec une remise déjà ÉTEINTE : le script
 * le dit, et ne le corrige pas de lui-même. Rallonger une remise expirée est
 * une décision commerciale, pas une migration.
 *
 * ── Garanties ──────────────────────────────────────────────────────────────
 *
 * N'écrit RIEN sans `--appliquer` : lancé seul, il montre et sort. `$set` ciblé
 * sur les deux seuls champs concernés. Idempotent : un client déjà repris est
 * laissé tel quel, jamais recalculé — un second passage ne peut donc pas
 * relancer une remise sur une offre entre-temps augmentée.
 *
 *   pnpm --filter @sm/db backfill:founder              # montre
 *   pnpm --filter @sm/db backfill:founder --appliquer  # écrit
 */
import { resolve } from 'node:path';
import { config as dotenv } from 'dotenv';
import mongoose from 'mongoose';
import { finRemiseFondateur, offreClient, remiseFondateurContrat } from '@sm/contracts';
import { MODELS } from './schemas';

dotenv({ path: resolve(__dirname, '../../../.env') });

const euros = (cents: number): string =>
  `${(cents / 100).toFixed(2).replace('.', ',')} €`;

const jour = (d: Date): string => d.toISOString().slice(0, 10);

async function main(): Promise<void> {
  const appliquer = process.argv.includes('--appliquer');
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI manquante');

  await mongoose.connect(uri);
  const now = new Date();
  const Tenant = mongoose.model(
    MODELS.Tenant.name,
    MODELS.Tenant.schema,
    MODELS.Tenant.collection,
  );

  // Les fondateurs à qui il manque l'un des deux champs. Un client qui a déjà
  // les deux est hors du lot : le recalculer serait précisément le défaut
  // qu'on répare — une remise qui suit l'offre courante.
  const aReprendre = await Tenant.find({
    founderSeat: true,
    $or: [
      { founderUntil: { $in: [null, undefined] } },
      { founderDiscountCents: { $in: [null, undefined] } },
    ],
  }).lean();

  console.log(
    `\n${aReprendre.length} client(s) fondateur à reprendre — base « ${mongoose.connection.name} »\n`,
  );
  if (aReprendre.length === 0) {
    await mongoose.disconnect();
    return;
  }

  let expires = 0;
  const lot: { _id: unknown; nom: string; until: Date; remise: number }[] = [];

  for (const t of aReprendre) {
    const signeLe = (t.createdAt as Date | undefined) ?? now;
    const until = (t.founderUntil as Date | null) ?? finRemiseFondateur(signeLe);
    const offre = offreClient(t);
    const remise =
      typeof t.founderDiscountCents === 'number'
        ? t.founderDiscountCents
        : remiseFondateurContrat(offre);
    const eteinte = until.getTime() <= now.getTime();
    if (eteinte) expires += 1;

    console.log(
      `  ${String(t.name ?? t.slug)}\n` +
        `    signé le ${jour(signeLe)} · remise ${euros(remise)}/mois · ` +
        `jusqu'au ${jour(until)}${eteinte ? '  ⚠ DÉJÀ ÉTEINTE' : ''}`,
    );
    lot.push({ _id: t._id, nom: String(t.name ?? t.slug), until, remise });
  }

  if (expires > 0) {
    console.log(
      `\n⚠  ${expires} client(s) ressortent avec une remise déjà expirée : leur douze mois\n` +
        `   court depuis leur création. Les prolonger est une décision commerciale —\n` +
        `   ce script ne la prend pas.`,
    );
  }

  if (!appliquer) {
    console.log('\nRien écrit. Relancer avec --appliquer pour enregistrer.\n');
    await mongoose.disconnect();
    return;
  }

  for (const c of lot) {
    await Tenant.updateOne(
      { _id: c._id },
      { $set: { founderUntil: c.until, founderDiscountCents: c.remise } },
    );
  }
  console.log(`\n✓ ${lot.length} client(s) repris.\n`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
