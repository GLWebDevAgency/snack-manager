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

/**
 * CE QU'UN CLIENT FONDATEUR DOIT RECEVOIR — décision pure, sans base.
 *
 * Extraite de la boucle pour être testable : elle décide d'un MONTANT de remise
 * sur de vrais clients, et une règle d'argent qui ne peut pas être exercée hors
 * de Mongo ne peut pas être vérifiée avant d'être lancée.
 *
 * IDEMPOTENTE PAR CONSTRUCTION : un champ déjà posé est repris tel quel, jamais
 * recalculé. C'est ce qui interdit à un second passage de relancer une remise
 * sur une offre entre-temps augmentée — précisément le défaut que le montant
 * figé existe pour empêcher.
 */
export function repriseFondateur(
  tenant: {
    createdAt?: Date | null;
    founderUntil?: Date | null;
    founderDiscountCents?: number | null;
    plan?: unknown;
    onlineOrdering?: unknown;
    atelier?: unknown;
  },
  now: Date,
): { until: Date; remise: number; eteinte: boolean; signeLe: Date } {
  // Sans date de création — un tenant d'avant le champ — on prend l'instant
  // courant : la remise part d'aujourd'hui plutôt que de n'exister jamais.
  const signeLe = tenant.createdAt ?? now;
  const until = tenant.founderUntil ?? finRemiseFondateur(signeLe);
  const remise =
    typeof tenant.founderDiscountCents === 'number'
      ? tenant.founderDiscountCents
      : remiseFondateurContrat(offreClient(tenant));
  return { until, remise, eteinte: until.getTime() <= now.getTime(), signeLe };
}

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
    const { signeLe, until, remise, eteinte } = repriseFondateur(t, now);
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

/**
 * N'EXÉCUTE QUE LANCÉ DIRECTEMENT — jamais à l'import.
 *
 * Sans cette garde, importer ce fichier pour tester `repriseFondateur` ouvrait
 * une connexion à la base pointée par `MONGODB_URI` : sur un poste dont le
 * `.env` vise la production, un test unitaire s'y serait connecté. Une décision
 * qui touche à de vrais montants doit pouvoir être exercée SANS base — c'est
 * tout l'objet de l'extraction ci-dessus, et cette ligne est ce qui la rend
 * vraie.
 */
if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
