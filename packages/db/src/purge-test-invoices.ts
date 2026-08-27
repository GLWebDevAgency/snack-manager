import { resolve } from 'node:path';
import { config as dotenv } from 'dotenv';
import mongoose from 'mongoose';
import { MODELS } from './schemas';

dotenv({ path: resolve(__dirname, '../../../.env') });

/**
 * RÉPARATION PONCTUELLE — retirer les factures nées de vérifications
 * automatisées.
 *
 * Le module de facturation ne SAIT PAS supprimer, et c'est délibéré : une
 * facture erronée s'annule avec un motif, elle ne s'efface pas. Cette règle
 * protège des pièces comptables réelles.
 *
 * Or ces lignes-là n'en sont pas. Elles ont été écrites par des agents de
 * vérification qui exerçaient les routes d'émission, d'encaissement et
 * d'annulation — sur la base de PRODUCTION, l'environnement de développement
 * pointant dessus. Les laisser reviendrait à garder « Verification interne du
 * bouton Encaisser » dans l'historique commercial d'un vrai restaurant : c'est
 * plus faux que le trou qu'on laisse en les retirant.
 *
 * Ce script est donc un correctif ponctuel, pas une capacité offerte au
 * produit. Il ne touche RIEN au-delà de la borne qu'on lui donne, il affiche
 * ce qu'il s'apprête à faire, et il exige `--go` pour écrire.
 *
 *   pnpm --filter @sm/db exec tsx src/purge-test-invoices.ts          (aperçu)
 *   pnpm --filter @sm/db exec tsx src/purge-test-invoices.ts --go     (exécution)
 */

/**
 * Dernière facture LÉGITIME, posée par l'amorce de démonstration.
 *
 * 0001 mise en place réglée · 0002 abonnement d'août réglé · 0003 abonnement
 * de septembre émis. Tout ce qui porte un numéro supérieur vient des
 * vérifications.
 */
const LAST_LEGITIMATE = 3;
const YEAR = 2026;

async function main(): Promise<void> {
  const write = process.argv.includes('--go');
  const uri = process.env.MONGO_URL;
  if (!uri) throw new Error('MONGO_URL manquant (racine .env)');

  await mongoose.connect(uri);
  const Invoices = mongoose.model(
    MODELS.Invoice.name,
    MODELS.Invoice.schema,
    MODELS.Invoice.collection,
  );
  const Counters = mongoose.model(
    MODELS.Counter.name,
    MODELS.Counter.schema,
    MODELS.Counter.collection,
  );

  const all = await Invoices.find({}, { number: 1, label: 1, status: 1, amountCents: 1 })
    .sort({ number: 1 })
    .lean<{ number: string; label: string; status: string; amountCents: number }[]>();

  const doomed = all.filter((invoice) => {
    const match = /^SM-(\d{4})-(\d{4})$/.exec(invoice.number);
    if (!match) return false;
    return Number(match[1]) === YEAR && Number(match[2]) > LAST_LEGITIMATE;
  });

  console.log(`${all.length} facture(s) en base, ${doomed.length} issue(s) des vérifications :\n`);
  for (const invoice of doomed) {
    console.log(`  ${invoice.number}  ${invoice.status.padEnd(10)} ${invoice.label}`);
  }
  const keep = all.length - doomed.length;
  console.log(`\n${keep} facture(s) conservée(s).`);

  if (!doomed.length) {
    await mongoose.disconnect();
    return;
  }

  if (!write) {
    console.log('\nAperçu seulement. Relancez avec --go pour appliquer.');
    await mongoose.disconnect();
    return;
  }

  const numbers = doomed.map((invoice) => invoice.number);
  const { deletedCount } = await Invoices.deleteMany({ number: { $in: numbers } });

  // La séquence repart au dernier numéro légitime : ces numéros-là n'ont jamais
  // figuré sur un document remis à qui que ce soit, les réattribuer ne peut
  // donc créer aucun doublon dans la comptabilité réelle.
  await Counters.updateOne(
    { _id: `invoice:${YEAR}` },
    { $set: { seq: LAST_LEGITIMATE } },
    { upsert: true },
  );

  await mongoose.disconnect();
  console.log(`\n${deletedCount} facture(s) retirée(s). Séquence ${YEAR} ramenée à ${LAST_LEGITIMATE}.`);
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
