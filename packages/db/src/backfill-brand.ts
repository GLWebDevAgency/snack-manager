/**
 * Reprend les tenants d'AVANT le masque d'identité — et RÉVÈLE ceux dont le
 * masque stocké ne satisfait plus le contrat.
 *
 * Jusqu'au 01/09/2026, un tenant ne portait qu'un logo et une couleur. Le
 * masque (`brand`) stocke désormais cinq rôles, une paire typographique, une
 * forme, un mouvement et quatre logos. Sans reprise, ces tenants n'ont pas de
 * `brand` — le résolveur leur dérive Nuit à la lecture, donc RIEN ne casse ;
 * mais un `brand` explicite est ce que l'éditeur (plan B) modifiera, et ce que
 * les captures de référence documentent.
 *
 * ── Pourquoi on classe au lieu de filtrer ─────────────────────────────────
 *
 * La reprise ne cherchait que `brand: null` et tenait tout `brand` non nul
 * pour « déjà repris ». Un masque stocké INVALIDE — valeur hors enum, objet
 * partiel, couleur illisible — n'était donc ni listé ni réparé : le compte
 * rendu annonçait « 0 tenant sans masque » pendant que ces tenants-là
 * tombaient en repli Nuit à CHAQUE lecture. `lireMarque` replie par
 * construction — c'est sa raison d'être — et il en dit désormais la cause,
 * mais seule une reprise corrige la BASE.
 *
 * Un script de reprise doit RÉVÉLER l'écart entre la base et le contrat, pas
 * le cacher. Celui-ci lit tous les tenants et les classe par le VERDICT de
 * `lireMarque` : valides, à reprendre, INVALIDES. Les invalides sont nommés
 * avec le chemin zod en échec et ne sont JAMAIS écrasés sans `--reparer` —
 * même discipline que les rapprochements ambigus de `backfill-contact` : une
 * donnée douteuse se montre avant d'être remplacée.
 *
 * ── Garanties ──────────────────────────────────────────────────────────────
 *
 * N'écrit RIEN sans `--appliquer`. `$set` ciblé sur `brand` seul. Chaque
 * écriture porte son invariant dans son filtre (voir `filtreReprise`) : elle
 * ne s'applique que si le tenant n'a pas bougé depuis la lecture. Idempotente
 * par construction : un tenant dont le masque est valide est hors du lot.
 *
 *   pnpm --filter @sm/db backfill:brand                # montre
 *   pnpm --filter @sm/db backfill:brand --appliquer    # écrit
 *   pnpm --filter @sm/db backfill:brand --reparer …    # remplace aussi les invalides
 *   pnpm --filter @sm/db backfill:brand --exiger-zero  # échoue s'il reste du travail
 */
import { resolve } from 'node:path';
import { config as dotenv } from 'dotenv';
import mongoose from 'mongoose';
import { BrandSchema, lireMarque, marqueDeRepli, type Brand } from '@sm/contracts';
import { exigerZero, lireDrapeaux } from './backfill-flags';
import { MODELS } from './schemas';

dotenv({ path: resolve(__dirname, '../../../.env') });

/** Ce qu'on lit d'un tenant pour juger son masque — rien d'autre n'entre ici. */
export type TenantLu = {
  brand?: unknown;
  brandColor?: unknown;
  logoUrl?: unknown;
};

/**
 * Le verdict sur un masque stocké.
 *
 * `a-reprendre` porte le masque à écrire ; `invalide` porte les chemins zod
 * en échec, parce qu'un compte rendu qui dit « invalide » sans dire OÙ oblige
 * à rouvrir la base à la main.
 */
export type MasqueClasse =
  | { etat: 'valide' }
  | { etat: 'a-reprendre'; brand: Brand }
  | { etat: 'invalide'; chemins: string[] };

/** Les deux champs plats, ramenés au type que `lireMarque` attend. */
const texte = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/**
 * OÙ le masque stocké s'écarte du contrat — pour le NOMMER dans le compte
 * rendu : « invalide » sans le chemin oblige à rouvrir la base à la main.
 *
 * Le verdict, lui, vient de `lireMarque` (ci-dessous) ; on ne rejoue
 * `safeParse` que sur le cas invalide, pour en extraire le détail qu'un
 * adaptateur de lecture n'a pas à porter. Même normalisation d'un
 * sous-document HYDRATÉ, dont les valeurs vivent derrière des accesseurs là où
 * un `.lean()` rend un objet nu.
 *
 * Une clé INCONNUE ne produit rien ici : le schéma de LECTURE est un objet nu,
 * qui l'ignore — un champ additif apparu en base ne fait pas basculer un
 * restaurant sur Nuit, il n'a donc pas à le faire compter comme à réparer.
 */
function cheminsEnEchec(brand: unknown): string[] {
  const brut = brand as { toObject?: () => unknown } | null | undefined;
  const nu = brut && typeof brut.toObject === 'function' ? brut.toObject() : brut;
  const lu = BrandSchema.safeParse(nu);
  if (lu.success) return [];
  const chemins = lu.error.issues.map((i) => i.path.map(String).join('.') || '(racine)');
  return [...new Set(chemins)].sort();
}

/**
 * LA DÉCISION, pure — sans base, donc exerçable en test.
 *
 * Le verdict est celui de `lireMarque`, le SEUL adaptateur de lecture : une
 * reprise qui jugerait autrement que ce que l'API lit réparerait des tenants
 * qui vont bien et laisserait passer les autres. Un masque à qui il manque un
 * défaut de schéma (`hero`, `preset`) est donc valide ici comme là-bas, et une
 * clé additive inconnue aussi.
 */
export function classerMasque(tenant: TenantLu): MasqueClasse {
  const lu = lireMarque({
    brand: tenant.brand,
    brandColor: texte(tenant.brandColor),
    logoUrl: texte(tenant.logoUrl),
  });
  if (lu.repli === null) return { etat: 'valide' };
  if (lu.repli === 'absent') return { etat: 'a-reprendre', brand: lu.brand };
  return { etat: 'invalide', chemins: cheminsEnEchec(tenant.brand) };
}

/**
 * LE FILTRE D'UNE REPRISE — l'invariant qui l'a motivée, porté dans la requête.
 *
 * `updateOne({ _id }, …)` écrivait un masque calculé depuis une lecture
 * ANTÉRIEURE : un gérant qui change sa couleur, ou un admin qui pose un masque
 * par `PATCH /tenants/me/marque` entre la lecture et l'écriture, se faisait
 * écraser par un repli Nuit déjà périmé. Les trois valeurs lues sont donc
 * reportées dans le filtre : l'écriture ne s'applique que si RIEN n'a bougé,
 * sinon elle ne touche rien, on le dit, et la relance de contrôle la reprend.
 *
 * `null` en filtre Mongo apparie aussi la CLÉ ABSENTE, et `undefined` n'est pas
 * une valeur BSON (le driver le sérialise en null) : une clé absente à la
 * lecture se filtre par `null`, et lister `undefined` ne changerait rien.
 */
export function filtreReprise(tenant: TenantLu & { _id: unknown }): Record<string, unknown> {
  return {
    _id: tenant._id,
    brand: null,
    brandColor: tenant.brandColor ?? null,
    logoUrl: tenant.logoUrl ?? null,
  };
}

/**
 * LE FILTRE D'UNE RÉPARATION (`--reparer`) — plus strict, faute de mieux.
 *
 * L'invariant qu'on voudrait — « le masque stocké est toujours celui que zod
 * vient de refuser » — ne s'exprime pas dans un filtre Mongo : zod ne s'exécute
 * pas dans la base, et comparer un sous-document entier dépend de l'ORDRE de
 * ses clés. On garde donc l'horodatage : `updatedAt` inchangé dit que rien n'a
 * bougé sur ce tenant depuis la lecture. C'est plus strict que nécessaire, et
 * l'erreur tombe du bon côté — une réparation sautée revient à la relance, un
 * masque fraîchement posé et écrasé est perdu.
 */
export function filtreReparation(tenant: {
  _id: unknown;
  updatedAt?: unknown;
}): Record<string, unknown> {
  return { _id: tenant._id, updatedAt: tenant.updatedAt ?? null };
}

async function main(): Promise<void> {
  const drapeaux = lireDrapeaux();
  const reparer = process.argv.includes('--reparer');
  // `MONGO_URL` — le nom que l'API et `seed.ts` lisent déjà, et celui que
  // Railway pose.
  const uri = process.env.MONGO_URL;
  if (!uri) throw new Error('MONGO_URL manquante');

  await mongoose.connect(uri);
  const Tenant = mongoose.model(MODELS.Tenant.name, MODELS.Tenant.schema, MODELS.Tenant.collection);

  // TOUS les tenants : ce qu'on cherche — un masque qui ne satisfait plus le
  // contrat — ne s'exprime pas dans un filtre Mongo, seul zod en juge. Le parc
  // se compte en dizaines de documents, il tient en mémoire (même lecture que
  // `backfill-contact`).
  //
  // `mongoose.model()` générique infère une union de TOUS les schémas du
  // dépôt : on lit ces documents comme des sacs de clés, ce qu'ils sont ici.
  type Doc = TenantLu & { _id: unknown; name?: unknown; slug?: unknown; updatedAt?: unknown };
  const tenants = (await Tenant.find({}).lean()) as unknown as Doc[];

  const aReprendre: { doc: Doc; nom: string; brand: Brand }[] = [];
  const invalides: { doc: Doc; nom: string; chemins: string[] }[] = [];
  let valides = 0;

  for (const doc of tenants) {
    const nom = String(doc.name ?? doc.slug ?? doc._id);
    const verdict = classerMasque(doc);
    if (verdict.etat === 'valide') valides += 1;
    else if (verdict.etat === 'a-reprendre') aReprendre.push({ doc, nom, brand: verdict.brand });
    else invalides.push({ doc, nom, chemins: verdict.chemins });
  }

  console.log(
    `\n${tenants.length} tenant(s) — base « ${mongoose.connection.name} »\n` +
      `  ${valides} masque(s) valide(s)\n` +
      `  ${aReprendre.length} sans masque, à reprendre\n` +
      `  ${invalides.length} masque(s) INVALIDE(S)\n`,
  );

  for (const { nom, brand } of aReprendre) {
    console.log(
      `  ${nom} → Nuit · accent ${brand.palette.accent} · logo ${brand.logo.mark.dark ? 'oui' : 'non'}`,
    );
  }

  if (invalides.length > 0) {
    console.log(
      `\n⚠  ${invalides.length} masque(s) stockés INVALIDES — à la lecture, ces tenants\n` +
        `   tombent en repli Nuit sans que rien ne le signale :`,
    );
    for (const { nom, chemins } of invalides) console.log(`   · ${nom} : ${chemins.join(', ')}`);
    console.log(
      reparer
        ? '   --reparer : ils seront REMPLACÉS par le repli (Nuit + accent + logo).'
        : "   Relancer avec --reparer pour les remplacer par le repli. Sans ce drapeau,\n" +
            '   ils sont montrés et laissés intacts — le masque posé à la main peut valoir\n' +
            '   mieux que ce que ce script sait recalculer.',
    );
  }

  const aEcrire = aReprendre.length + (reparer ? invalides.length : 0);
  if (!drapeaux.appliquer || aEcrire === 0) {
    if (drapeaux.appliquer) console.log('\nRien à écrire.\n');
    else console.log('\nRien écrit. Relancer avec --appliquer pour enregistrer.\n');
    exigerZero(drapeaux, aReprendre.length + invalides.length, 'tenant(s) restent à traiter');
    await mongoose.disconnect();
    return;
  }

  // `modifiedCount` et non la taille du lot : une écriture dont le filtre
  // n'apparie plus rien — le tenant a changé entre la lecture et ici — ne
  // compte pas comme une reprise. La compter aurait annoncé un parc à jour
  // qu'il n'est pas.
  let repris = 0;
  for (const { doc, brand } of aReprendre) {
    const r = await Tenant.updateOne(filtreReprise(doc), { $set: { brand } });
    repris += r.modifiedCount;
  }

  let reparees = 0;
  if (reparer) {
    for (const { doc } of invalides) {
      const brand = marqueDeRepli(texte(doc.brandColor), texte(doc.logoUrl));
      const r = await Tenant.updateOne(filtreReparation(doc), { $set: { brand } });
      reparees += r.modifiedCount;
    }
  }

  const ignores = aEcrire - repris - reparees;
  console.log(
    `\n✓ ${repris} tenant(s) repris${reparer ? ` · ${reparees} masque(s) réparé(s)` : ''}.`,
  );
  if (ignores > 0) {
    console.log(
      `⚠  ${ignores} écriture(s) sans effet : ces tenants ont changé entre la lecture et\n` +
        '   l\'écriture, ils n\'ont pas été écrasés. La relance de contrôle les reprendra.',
    );
  }
  console.log('');

  exigerZero(
    drapeaux,
    aReprendre.length + invalides.length - repris - reparees,
    'tenant(s) restent à traiter',
  );
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
