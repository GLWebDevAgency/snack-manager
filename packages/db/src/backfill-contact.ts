/**
 * Reprend le CONTACT DU GÉRANT sur les clients signés avant que le champ existe.
 *
 * DÉFAUT — le lead porte `contact { name, phone, email }` depuis la
 * prospection, et la conversion le JETAIT. La fiche client du CRM affiche donc
 * un bouton « Appeler » qui ne s'affiche jamais, faute de numéro à composer, et
 * le commercial rouvre le pipeline pour retrouver ce qu'il vient de signer.
 *
 * `tenant.phones` ne remplace pas ce contact : ce sont les numéros PUBLICS du
 * restaurant, une ligne de comptoir qui décroche en plein coup de feu, ou pas
 * du tout. Quand l'équipe doit joindre le restaurateur — impayé, incident,
 * relance — c'est son numéro à lui qu'il faut.
 *
 * ── Comment on retrouve le lead d'origine ─────────────────────────────────
 *
 * Par le JOURNAL d'administration : `recordTenantCreation` y écrit `leadId` à
 * chaque signature. C'est le lien exact, et il vaut mieux qu'un rapprochement
 * par nom — deux établissements peuvent porter la même enseigne, et un nom se
 * corrige après la signature.
 *
 * À défaut de ligne de journal — un client créé autrement, ou avant que ce
 * journal existe — on tente le nom d'enseigne, et on ne retient le lead que
 * s'il est le SEUL à porter ce nom. Un rapprochement ambigu est signalé et
 * laissé de côté : un mauvais numéro sur une fiche client est pire que pas de
 * numéro du tout.
 *
 * ── Garanties ─────────────────────────────────────────────────────────────
 *
 * N'écrit RIEN sans `--appliquer`. `$set` ciblé sur le seul `contact`.
 * Idempotent : un client qui a déjà un numéro n'est jamais retouché — le
 * commercial a pu le corriger à la main depuis, et sa saisie prime sur le
 * souvenir du pipeline.
 *
 *   pnpm --filter @sm/db backfill:contact              # montre
 *   pnpm --filter @sm/db backfill:contact --appliquer  # écrit
 */
import { resolve } from 'node:path';
import { config as dotenv } from 'dotenv';
import mongoose from 'mongoose';
import { MODELS } from './schemas';

dotenv({ path: resolve(__dirname, '../../../.env') });

/** Un contact vaut la peine d'être repris s'il porte au moins un moyen de joindre. */
export function contactUtile(contact: {
  name?: unknown;
  phone?: unknown;
  email?: unknown;
}): boolean {
  const texte = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  return texte(contact.phone) !== '' || texte(contact.email) !== '';
}

/**
 * Le tenant a-t-il DÉJÀ de quoi joindre son gérant ?
 *
 * Un client déjà renseigné n'est jamais retouché : le commercial a pu corriger
 * le numéro à la main depuis la signature, et sa saisie prime sur ce que disait
 * le pipeline il y a six mois.
 */
export function dejaJoignable(tenant: { contact?: { phone?: unknown; email?: unknown } }): boolean {
  return contactUtile(tenant.contact ?? {});
}

async function main(): Promise<void> {
  const appliquer = process.argv.includes('--appliquer');
  // `MONGO_URL` — le nom que l'API et `seed.ts` lisent déjà, et celui que
  // Railway pose. Un second nom aurait créé deux conventions, et un script de
  // reprise qui ne démarre pas sur l'environnement où on veut le lancer.
  const uri = process.env.MONGO_URL;
  if (!uri) throw new Error('MONGO_URL manquante');

  await mongoose.connect(uri);
  const modele = (cle: keyof typeof MODELS) =>
    mongoose.model(MODELS[cle].name, MODELS[cle].schema, MODELS[cle].collection);
  const Tenant = modele('Tenant');
  const Lead = modele('Lead');
  const AdminLog = modele('AdminLog');

  // `mongoose.model()` générique infère une union de TOUS les schémas du
  // dépôt : on lit ces documents comme des sacs de clés, ce qu'ils sont ici.
  type Doc = Record<string, unknown> & { _id: unknown };
  const tenants = (await Tenant.find({}).lean()) as unknown as Doc[];
  const aReprendre = tenants.filter((t) => !dejaJoignable(t as never));

  console.log(
    `\n${aReprendre.length} client(s) sans contact sur ${tenants.length} — base « ${mongoose.connection.name} »\n`,
  );
  if (aReprendre.length === 0) {
    await mongoose.disconnect();
    return;
  }

  const lot: { _id: unknown; nom: string; contact: Record<string, string>; via: string }[] = [];
  const ambigus: string[] = [];
  const sansTrace: string[] = [];

  for (const t of aReprendre) {
    const nom = String(t.name ?? t.slug ?? '?');

    // 1. Le journal de création porte le lien exact.
    const trace = (await AdminLog.findOne({
      action: 'tenant.create',
      tenantId: t._id,
    }).lean()) as unknown as Doc | null;
    const leadId = (trace as { meta?: { leadId?: unknown } } | null)?.meta?.leadId;

    let lead = leadId ? ((await Lead.findById(String(leadId)).lean()) as unknown as Doc | null) : null;
    let via = 'journal';

    // 2. À défaut, le nom — et seulement s'il ne désigne qu'un lead.
    if (!lead) {
      const homonymes = (await Lead.find({ restaurantName: nom }).lean()) as unknown as Doc[];
      if (homonymes.length === 1) {
        lead = homonymes[0]!;
        via = 'nom';
      } else if (homonymes.length > 1) {
        ambigus.push(`${nom} (${homonymes.length} leads du même nom)`);
        continue;
      } else {
        sansTrace.push(nom);
        continue;
      }
    }

    const c = (lead as { contact?: Record<string, unknown> }).contact ?? {};
    if (!contactUtile(c)) {
      sansTrace.push(`${nom} (lead sans numéro ni adresse)`);
      continue;
    }

    const contact = {
      name: String(c.name ?? '').trim(),
      phone: String(c.phone ?? '').trim(),
      email: String(c.email ?? '').trim(),
    };
    console.log(
      `  ${nom}\n    ${contact.phone || '—'} · ${contact.name || 'sans nom'} · ${contact.email || '—'}  (via ${via})`,
    );
    lot.push({ _id: t._id, nom, contact, via });
  }

  if (ambigus.length > 0) {
    console.log(`\n⚠  ${ambigus.length} rapprochement(s) AMBIGU(S), laissés de côté :`);
    for (const a of ambigus) console.log(`   · ${a}`);
    console.log('   Un mauvais numéro sur une fiche client est pire que pas de numéro.');
  }
  if (sansTrace.length > 0) {
    console.log(`\n${sansTrace.length} client(s) sans lead exploitable : ${sansTrace.join(', ')}`);
  }

  if (!appliquer) {
    console.log('\nRien écrit. Relancer avec --appliquer pour enregistrer.\n');
    await mongoose.disconnect();
    return;
  }

  for (const c of lot) {
    await Tenant.updateOne({ _id: c._id }, { $set: { contact: c.contact } });
  }
  console.log(`\n✓ ${lot.length} contact(s) repris.\n`);
  await mongoose.disconnect();
}

/**
 * N'EXÉCUTE QUE LANCÉ DIRECTEMENT — jamais à l'import.
 *
 * Sans cette garde, importer ce fichier pour tester ses règles ouvre une
 * connexion à la base pointée par l'environnement et lance le traitement.
 */
if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
