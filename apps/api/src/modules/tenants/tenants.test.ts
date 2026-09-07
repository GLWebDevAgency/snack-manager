import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import {
  CAPACITES_PAR_FORMULE,
  DIRECTIONS,
  ratioContraste,
  TenantSettingsUpdateSchema,
} from '@sm/contracts';
import { TenantSchema } from '@sm/db';
import { describe, expect, it } from 'vitest';
import { journalMuet } from '../audit/audit.fakes';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { TenantsController } from './tenants.controller';
import { testOriginesImages } from './tenants.fakes';
import {
  derivesDuMasque,
  identiteAvecAccent,
  identiteAvecLogo,
  REGLAGES_MODIFIABLES,
  TENANT_ME_FIELDS,
  TenantsService,
} from './tenants.service';

/**
 * La liste blanche des réglages a un angle mort : elle dit ce qu'on a le droit
 * d'écrire, jamais ce que la base sait recevoir.
 *
 * `dailyGoalCents` a vécu dans cette liste sans exister dans le schéma
 * Mongoose. Mongoose est en mode strict : le `$set` était jeté en silence, la
 * route répondait 200, et le gérant qui posait son objectif du jour depuis son
 * tableau de bord le voyait disparaître au rechargement. Aucune erreur, aucun
 * journal — le pire des défauts, celui qui ne se signale pas.
 *
 * Ce test relie les deux bouts. Il ne teste pas un champ : il teste que
 * l'ensemble des deux reste cohérent, aujourd'hui et à chaque ajout futur.
 */
describe('les réglages de service', () => {
  it('chaque réglage autorisé existe vraiment dans le schéma — sinon il est jeté en silence', () => {
    const absents = REGLAGES_MODIFIABLES.filter((clef) => !TenantSchema.path(`settings.${clef}`));
    expect(
      absents,
      `Ces réglages sont acceptés par l'API mais absents du schéma Mongoose : ` +
        `la route répondra 200 et rien ne sera enregistré. Ajoutez-les à ` +
        `TenantSchema.settings dans packages/db/src/schemas.ts.`,
    ).toEqual([]);
  });

  it('l’objectif du jour se stocke en centimes entiers, comme tous les montants du logiciel', () => {
    const chemin = TenantSchema.path('settings.dailyGoalCents');
    expect(chemin, 'settings.dailyGoalCents doit exister dans le schéma').toBeDefined();
    expect(chemin.instance).toBe('Number');
  });

  it('sans objectif posé, la valeur est absente — pas zéro', () => {
    // Zéro serait un objectif atteint dès l'ouverture, et le tableau de bord
    // afficherait 100 % avant la première commande. L'absence de valeur laisse
    // le front appliquer son propre défaut.
    //
    // On lit `options.default` et non `defaultValue` : le second n'est pas
    // exposé par les types de Mongoose, et un test qui ne compile pas est un
    // test qui finit par être supprimé.
    const chemin = TenantSchema.path('settings.dailyGoalCents');
    expect(chemin.options.default).toBeUndefined();
  });
});

/**
 * LES RÉGLAGES SONT VALIDÉS, PAS SEULEMENT FILTRÉS.
 *
 * `PATCH /tenants/me/settings` prenait un corps NU : une liste blanche de clés
 * recopiait les valeurs dans un `$set` sans regarder ce qu'elles contenaient.
 * Le service le disait lui-même — « cette liste est le seul rempart ». Une
 * liste de clés dit QUELS champs s'écrivent, jamais AVEC QUOI.
 *
 * Chaque borne répare un dégât précis, et aucune n'est décorative.
 */
describe('la validation des réglages', () => {
  const passe = (patch: Record<string, unknown>) => TenantSettingsUpdateSchema.safeParse(patch).success;

  it('refuse un intervalle de créneau à zéro — il divise par zéro en aval', () => {
    expect(passe({ slotIntervalMin: 0 })).toBe(false);
    expect(passe({ slotIntervalMin: 10 })).toBe(true);
  });

  it('refuse une capacité nulle ou négative — elle fermerait la commande sans le dire', () => {
    expect(passe({ slotCapacity: 0 })).toBe(false);
    expect(passe({ slotCapacity: -3 })).toBe(false);
    expect(passe({ slotCapacity: 4 })).toBe(true);
  });

  it('refuse un objectif du jour nul ou négatif', () => {
    // Zéro serait atteint dès l'ouverture : la jauge afficherait 100 % avant
    // la première commande.
    expect(passe({ dailyGoalCents: 0 })).toBe(false);
    expect(passe({ dailyGoalCents: -5_000 })).toBe(false);
    expect(passe({ dailyGoalCents: 30_000 })).toBe(true);
    // `null` efface l'objectif : le tableau de bord reprend le sien.
    expect(passe({ dailyGoalCents: null })).toBe(true);
    // La faute de frappe qui prend des euros pour des centimes.
    expect(passe({ dailyGoalCents: 100_000_001 })).toBe(false);
  });

  it('borne le message de pause, mais admet le vide', () => {
    // Effacer son message est un geste normal : l'interdire obligerait le
    // gérant à inventer un texte pour se taire.
    expect(passe({ pauseMessage: '' })).toBe(true);
    expect(passe({ pauseMessage: 'x'.repeat(201) })).toBe(false);
  });

  it('refuse un moment d’impression inconnu', () => {
    expect(passe({ printTicketOn: 'jamais' })).toBe(false);
    expect(passe({ printTicketOn: 'ready' })).toBe(true);
  });

  it('reste un PATCH : les clés absentes le restent', () => {
    // Un défaut appliqué ici réinitialiserait en silence ce que le gérant n'a
    // pas touché.
    const r = TenantSettingsUpdateSchema.parse({ onlineOrderingPaused: true });
    expect(Object.keys(r)).toEqual(['onlineOrderingPaused']);
  });

  it('chaque clé validée est écrite, et chaque clé écrite est validée', () => {
    // Une clé validée mais absente de la liste blanche serait acceptée puis
    // jetée en silence — la route répondrait 200 sans rien enregistrer. C'est
    // exactement ce qui est arrivé à `dailyGoalCents`.
    const valides = Object.keys(TenantSettingsUpdateSchema.shape).sort();
    expect(valides).toEqual([...REGLAGES_MODIFIABLES].sort());
  });
});

/**
 * CE QU'UNE TABLETTE DE COMPTOIR PEUT LIRE SUR SON RESTAURANT.
 *
 * `GET /tenants/me` rendait le document Mongo ENTIER. Or elle sert tout
 * l'équipage, y compris une session ouverte au code sur la tablette : un
 * équipier de cuisine lisait le SIRET, le numéro de TVA, l'identité de
 * facturation, l'identifiant du compte Stripe, le motif de suspension du
 * compte, et jusqu'au montant de la remise fondateur négociée.
 *
 * Aucun de ces champs n'est utilisé par les écrans.
 */
describe('la fiche établissement rendue aux tablettes', () => {
  it('ne laisse passer QUE ce que les écrans consomment', () => {
    // La liste du contrat côté web (`TenantMe`), à la clé près. `_id` sort
    // toujours d'une projection Mongo et n'a pas à y figurer.
    expect(Object.keys(TENANT_ME_FIELDS).sort()).toEqual(
      [
        'account.status',
        'address',
        'brand',
        'brandColor',
        'closures',
        // Lu pour CALCULER les capacités, puis retiré de la réponse : le motif
        // d'une dérogation est une phrase de négociation commerciale.
        'derogationsCapacite',
        'hours',
        'logoUrl',
        'name',
        'onlineOrdering',
        'onlineDelivery',
        'standaloneLoyalty',
        'websiteUrl',
        'phones',
        'plan',
        'settings',
        'slug',
      ].sort(),
    );
  });

  it('porte ce dont la barre de navigation a besoin, sur ses DEUX axes', () => {
    // Sans eux, le front n'a pas la donnée et montre la même barre à tout le
    // monde : « Encaissement en ligne » sur une tablette de comptoir (403 au
    // clic), les écrans de commande en ligne à qui n'a pas le module, et rien
    // du tout pour signaler un compte suspendu.
    //
    // `derogationsCapacite` s'y ajoute non pour être AFFICHÉ mais pour être
    // CALCULÉ : sans lui dans la projection, un client dont l'équipe SM a
    // ouvert une fonction hors formule la verrait verrouillée.
    for (const champ of ['plan', 'onlineOrdering', 'derogationsCapacite', 'account.status']) {
      expect(Object.keys(TENANT_ME_FIELDS), `« ${champ} » manque à la barre`).toContain(champ);
    }
  });

  /**
   * LES CAPACITÉS SORTENT, LES DÉROGATIONS NON — et c'est le même geste.
   *
   * Le front doit savoir CE QU'IL PEUT OUVRIR, jamais pourquoi. Le motif d'une
   * dérogation (« geste de reprise », « retiré le temps du litige ») est une
   * conversation entre l'équipe Snack Manager et le gérant ; il n'a rien à
   * faire dans une réponse que lit aussi la tablette du comptoir.
   */
  it('rend les capacités CALCULÉES, et jamais les dérogations qui les produisent', () => {
    const vue = derivesDuMasque({
      slug: 'chez-lima',
      plan: 'essentiel',
      onlineOrdering: false,
      derogationsCapacite: [
        {
          capacite: 'loyalty',
          sens: 'accordee',
          motif: 'reprise de son ancien logiciel de fidélité',
          auteur: 'Équipe SM',
        },
      ],
    });

    expect(vue.capacites).toEqual([...CAPACITES_PAR_FORMULE.essentiel, 'loyalty']);
    expect(vue).not.toHaveProperty('derogationsCapacite');
    // Et le motif ne se retrouve nulle part ailleurs dans la réponse.
    expect(JSON.stringify(vue)).not.toContain('ancien logiciel');
  });

  it('ne rend aucune capacité à un établissement sans formule', () => {
    // « Atelier seul » : il n'a pas de colonne dans la grille tarifaire. La
    // barre le lui dira en verrouillant, jamais en masquant.
    expect(derivesDuMasque({ slug: 'x', plan: null }).capacites).toEqual([]);
  });

  it('ne rend AUCUN des champs qui fuyaient', () => {
    // Nommés un par un : c'est la liste qu'un équipier de cuisine lisait, et
    // celle qu'une régression rouvrirait. `Object.keys` et non `toHaveProperty`
    // — un point y est un chemin, et `account.reason` passerait tout seul.
    const ouverts = Object.keys(TENANT_ME_FIELDS);
    for (const secret of [
      'billing',
      'siret',
      'tvaNumber',
      'stripe',
      'encaissement',
      'atelier',
      'founderDiscountCents',
      'founderUntil',
      'billingCycle',
    ]) {
      expect(ouverts, `« ${secret} » ne doit pas sortir sur une tablette`).not.toContain(secret);
    }
  });

  it('n’ouvre du compte que son statut — jamais le sous-document entier', () => {
    // `account` porte le motif de suspension (« Impayé de juillet »), la cause
    // de départ et le calendrier d'essai. Projeter `account: 1` pour le seul
    // statut rouvrirait la fuite, et la rouvrirait encore à chaque champ ajouté
    // demain au sous-document.
    const ouverts = Object.keys(TENANT_ME_FIELDS);
    expect(ouverts, 'le sous-document `account` ne s’ouvre pas en entier').not.toContain('account');
    for (const voisin of [
      'account.reason',
      'account.churnCause',
      'account.suspendedAt',
      'account.trialEndsAt',
      'account.since',
    ]) {
      expect(ouverts, `« ${voisin} » relève du litige commercial, pas de l’écran`).not.toContain(
        voisin,
      );
    }
  });
});

/**
 * LE SÉLECTEUR DE COULEUR DOIT SURVIVRE À LA REPRISE.
 *
 * `brandColor` est devenu un DÉRIVÉ du masque à la lecture. Tant qu'un tenant
 * n'a pas de `brand`, écrire la colonne suffit — le repli la relit. Dès que
 * `backfill:brand` a posé un masque, c'est `brand.palette.accent` qui est
 * rendu : le gérant changeait sa couleur dans `/admin/settings`, l'API
 * répondait 200, et la page se rechargeait sur l'ancienne. Aucune erreur,
 * aucun journal — le même défaut muet que `dailyGoalCents` plus haut.
 *
 * C'est le fragment `$set`, pur, qui est verrouillé ici ; le banc à Model
 * doublé, en bas de fichier, vérifie ce qu'il devient une fois écrit.
 */
describe('l’accent posé depuis l’admin', () => {
  it('sans masque posé, n’écrit que le champ plat — le repli le relira', () => {
    expect(identiteAvecAccent(null, '#2E9E4F')).toEqual({ brandColor: '#2E9E4F' });
  });

  it('avec un masque posé, écrit AUSSI l’accent du masque — sinon rien ne change à l’écran', () => {
    const $set = identiteAvecAccent(DIRECTIONS.soleil, '#2E9E4F');
    expect($set).toEqual({
      brandColor: '#2E9E4F',
      'brand.palette.accent': '#2e9e4f',
      // Noir : sur ce vert, il fait 6,2:1 quand le blanc n'en fait que 3,4.
      'brand.palette.onAccent': '#000000',
    });
  });

  it('recalcule onAccent : garder l’ancien ferait du texte illisible sur la couleur neuve', () => {
    // Nuit pose `onAccent: #1C1612` — presque noir. Un accent bordeaux le
    // rendrait invisible : le texte doit basculer au blanc avec l'accent.
    const $set = identiteAvecAccent(DIRECTIONS.nuit, '#5A1A16');
    expect($set['brand.palette.onAccent']).toBe('#ffffff');
    expect(
      ratioContraste(String($set['brand.palette.onAccent']), String($set['brand.palette.accent'])),
    ).toBeGreaterThanOrEqual(4.5);
  });
});

/**
 * LE LOGO DU BACK-OFFICE DOIT ARRIVER JUSQU'AUX SURFACES.
 *
 * `logoUrl` est dérivé de `brand.logo` à la lecture : n'écrire que la colonne
 * plate rendait le dépôt invisible et le retrait pire encore — l'objet parti
 * de R2, le masque pointant toujours dessus. Le fragment `$set` est verrouillé
 * ici, comme celui de l'accent.
 */
describe('le logo déposé depuis le back-office', () => {
  const LEGACY = 'https://api.test/public/tenants/chez-lima/logo?v=1';
  const NEUF = 'https://api.test/public/tenants/chez-lima/logo?v=2';
  const avecLogo = (url: string | null) => ({
    ...DIRECTIONS.nuit,
    logo: { ...DIRECTIONS.nuit.logo, mark: { light: null, dark: url } },
  });

  it('sans masque posé, n’écrit que le champ plat', () => {
    expect(identiteAvecLogo(null, LEGACY, NEUF)).toEqual({ logoUrl: NEUF });
  });

  it('avec un masque vide, remplit l’emplacement hérité — sinon le dépôt ne se voit nulle part', () => {
    expect(identiteAvecLogo(avecLogo(null), null, NEUF)).toEqual({
      logoUrl: NEUF,
      'brand.logo.mark.dark': NEUF,
    });
  });

  it('remplace l’URL héritée quand elle porte encore le logo qu’on change', () => {
    expect(identiteAvecLogo(avecLogo(LEGACY), LEGACY, NEUF)).toEqual({
      logoUrl: NEUF,
      'brand.logo.mark.dark': NEUF,
    });
  });

  it('au retrait, vide les DEUX : l’objet R2 disparaît, le masque ne doit plus le montrer', () => {
    expect(identiteAvecLogo(avecLogo(LEGACY), LEGACY, null)).toEqual({
      logoUrl: null,
      'brand.logo.mark.dark': null,
    });
  });

  it('épargne une déclinaison posée exprès dans l’éditeur', () => {
    const propre = 'https://cdn.test/chez-lima/marque-sombre.svg';
    expect(identiteAvecLogo(avecLogo(propre), LEGACY, NEUF)).toEqual({ logoUrl: NEUF });
  });
});

/**
 * `GET /tenants/me` ET `PATCH /tenants/me/marque` rendent LA MÊME FORME.
 *
 * La lecture rendait le document projeté tel quel : ses champs plats dormaient
 * en base d'avant la reprise. L'éditeur enregistrait un masque safran et
 * relisait un laiton dans la réponse même de son enregistrement — il fallait
 * recharger la page pour voir ce qu'on venait d'écrire.
 */
describe('les champs plats rendus par les routes du tenant', () => {
  it('dérivent du masque quand il existe', () => {
    const vue = derivesDuMasque({
      slug: 'x',
      name: 'X',
      brandColor: '#c9a15a',
      logoUrl: null,
      brand: {
        ...DIRECTIONS.soleil,
        logo: { mark: { light: null, dark: 'https://r2/l.png' }, lockup: { light: null, dark: null } },
      },
    });
    // L'accent DU MASQUE, pas la colonne du tenant (`#c9a15a` ci-dessus).
    expect(vue.brandColor).toBe(DIRECTIONS.soleil.palette.accent);
    expect(vue.logoUrl).toBe('https://r2/l.png');
    expect(vue.brand.preset).toBe('soleil');
    expect(vue.slug).toBe('x');
  });

  it('réduisent le compte à son statut — le motif d’une suspension n’est pas un affichage', () => {
    // La projection ne demande déjà que `account.status`. Cette réduction tient
    // la promesse une seconde fois, et surtout elle fixe LA FORME : sans elle,
    // un tenant d'avant le champ `account` verrait Mongoose matérialiser le
    // sous-document de défaut en entier, et la réponse changerait de forme d'un
    // restaurant à l'autre.
    const vue = derivesDuMasque({
      slug: 'z',
      brand: null,
      account: { status: 'suspended', reason: 'Impayé de juillet', suspendedAt: '2026-08-01' },
    });
    expect(vue.account).toEqual({ status: 'suspended' });
  });

  it('rendent le statut le plus permissif quand le compte manque', () => {
    // Les tenants créés avant le champ `account` n'en ont pas en base. Un champ
    // jamais écrit ne doit pas fermer un restaurant en plein service.
    expect(derivesDuMasque({ slug: 'z', brand: null }).account).toEqual({ status: 'trial' });
  });

  it('retombent sur le repli — l’accent BRUT du tenant — tant qu’aucun masque n’est posé', () => {
    const vue = derivesDuMasque({
      slug: 'y',
      name: 'Y',
      brandColor: '#7a2e2a',
      logoUrl: 'https://r2/legacy.png',
      brand: null,
    });
    // Brut, pas ajusté : spec §8.1, `accent = brandColor`.
    expect(vue.brandColor).toBe('#7a2e2a');
    expect(vue.logoUrl).toBe('https://r2/legacy.png');
    expect(vue.brand.preset).toBe('nuit');
  });
});

// ─────────────────────────────────────────────────────────────
// Le banc du service : un Model doublé, comme dans `admin.test.ts`
// ─────────────────────────────────────────────────────────────

const TENANT = '665f0d0a1c2b3d4e5f6a7b99';

/**
 * Doublure du modèle Tenant — gestes Mongo minimaux, PROJECTION comprise.
 *
 * La projection est rejouée pour de vrai (seules les clés à 1, plus `_id`) :
 * c'est précisément ce que ces tests doivent voir échouer si quelqu'un la
 * retire d'une des quatre routes. Une doublure qui rendrait le document entier
 * ferait passer la fuite pour une réussite.
 *
 * `$set` applique les CHEMINS POINTÉS dans le sous-objet, comme Mongo : sans
 * ça, `brand.palette.accent` remplacerait le masque au lieu d'y écrire.
 */
function fakeTenants(doc: Record<string, unknown>) {
  const etat: Record<string, unknown> = { _id: TENANT, ...structuredClone(doc) };
  const sets: Record<string, unknown>[] = [];
  const options: Record<string, unknown>[] = [];
  const filters: Record<string, unknown>[] = [];
  const reads: { id: string; steps: [string, unknown][] }[] = [];

  const at = (path: string): unknown => path.split('.').reduce<unknown>((value, key) =>
    value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, etat);

  const appliquer = ($set: Record<string, unknown>) => {
    for (const [chemin, valeur] of Object.entries($set)) {
      const segments = chemin.split('.');
      let cible = etat;
      for (const segment of segments.slice(0, -1)) {
        if (cible[segment] === null || typeof cible[segment] !== 'object') cible[segment] = {};
        cible = cible[segment] as Record<string, unknown>;
      }
      cible[segments[segments.length - 1]!] = valeur;
    }
  };

  /*
   * Les CHEMINS POINTÉS sont projetés comme Mongo le fait : `account.status`
   * rend `{ account: { status } }` et laisse le motif de suspension en base.
   * Une doublure qui recopierait le sous-document entier ferait passer pour
   * une réussite exactement la fuite que la projection ferme.
   */
  const projeter = (projection?: Record<string, unknown>) => {
    const vu = structuredClone(etat);
    if (!projection) return vu;
    const sortie: Record<string, unknown> = { _id: vu._id };
    for (const [chemin, garde] of Object.entries(projection)) {
      if (garde !== 1) continue;
      const segments = chemin.split('.');
      let source: unknown = vu;
      for (const segment of segments) {
        if (source === null || typeof source !== 'object' || !(segment in source)) {
          source = undefined;
          break;
        }
        source = (source as Record<string, unknown>)[segment];
      }
      if (source === undefined) continue;
      let cible = sortie;
      for (const segment of segments.slice(0, -1)) {
        if (cible[segment] === null || typeof cible[segment] !== 'object') cible[segment] = {};
        cible = cible[segment] as Record<string, unknown>;
      }
      cible[segments[segments.length - 1]!] = source;
    }
    return sortie;
  };

  return {
    sets,
    options,
    filters,
    reads,
    etat: () => etat,
    model: {
      findById: (id: string, projection?: Record<string, unknown>) => {
        const reading = { id, steps: [] as [string, unknown][] }; reads.push(reading);
        const query = Promise.resolve(id === TENANT ? projeter(projection) : null);
        return Object.assign(query, {
          select: (value: string) => { reading.steps.push(['select', value]); return query; },
          read: (value: string) => { reading.steps.push(['read', value]); return query; },
          readConcern: (value: string) => { reading.steps.push(['readConcern', value]); return query; },
          maxTimeMS: (value: number) => { reading.steps.push(['maxTimeMS', value]); return query; },
          lean: () => query,
        });
      },
      findByIdAndUpdate: async (
        id: string,
        update: { $set: Record<string, unknown> },
        opts: { new?: boolean; projection?: Record<string, unknown> },
      ) => {
        if (id !== TENANT) return null;
        sets.push(update.$set);
        options.push(opts);
        appliquer(update.$set);
        return projeter(opts.projection);
      },
      findOneAndUpdate: (
        filter: Record<string, unknown>, update: { $set: Record<string, unknown>; $inc?: Record<string, number> },
        opts: { new?: boolean; projection?: Record<string, unknown> },
      ) => {
        filters.push(filter);
        const matches = Object.entries(filter).every(([path, expected]) => {
          const actual = at(path);
          if (expected && typeof expected === 'object' && '$exists' in expected) return (actual !== undefined) === expected.$exists;
          return expected === null ? actual == null : actual === expected;
        });
        if (matches) {
          sets.push(update.$set); options.push(opts); appliquer(update.$set);
          for (const [path, amount] of Object.entries(update.$inc ?? {})) appliquer({ [path]: Number(at(path)) + amount });
        }
        const result = matches ? projeter(opts.projection) : null;
        const query = Promise.resolve(result);
        return Object.assign(query, { select: (value: string) => {
          expect(value).toBe('-capacityControl');
          if (result) delete result.capacityControl;
          return query;
        } });
      },
    },
  };
}

/** Le document tel qu'il dort en base : les champs utiles, le reste privé. */
const DOCUMENT = {
  slug: 'chez-lima',
  name: 'Chez Lima',
  // Sous le domaine public : c'est la forme que `logo.service.ts` fabrique, et
  // la seule que la liste blanche d'origines accepte de greffer.
  logoUrl: 'https://api.snackmanager.fr/public/tenants/chez-lima/logo?v=17',
  brandColor: '#c9a15a',
  brand: null as unknown,
  address: '12 rue du Marché',
  phones: ['0102030405'],
  hours: [],
  closures: [],
  plan: 'complet',
  onlineOrdering: true,
  onlineDelivery: false,
  standaloneLoyalty: false,
  websiteUrl: null,
  settings: { slotIntervalMin: 10, onlineOrderingPaused: false },
  // Ce qu'une tablette de comptoir n'a RIEN à lire.
  siret: '90210987600017',
  tvaNumber: 'FR12902109876',
  stripeAccountId: 'acct_1234567890',
  founderDiscountCents: 4_900,
  billingCycle: 'annuel',
  // Le statut sort, le motif reste : ce restaurant est suspendu pour impayé,
  // et son équipier de cuisine n'a pas à lire pourquoi.
  account: { status: 'suspended', reason: 'Impayé de juillet', suspendedAt: '2026-08-01' },
};

const service = (tenants: ReturnType<typeof fakeTenants>) =>
  new TenantsService(tenants.model as never, testOriginesImages(), journalMuet());

/** Les champs que la projection doit avoir laissés dehors, nommés un par un. */
const SECRETS = [
  'siret',
  'tvaNumber',
  'stripeAccountId',
  'founderDiscountCents',
  'billingCycle',
] as const;

/**
 * Les clés RACINE de la réponse : un chemin pointé se relit sous sa racine une
 * fois l'objet reconstruit — `account.status` arrive dans `account`.
 *
 * Deux clés font exception, et les deux dans le même sens — la projection n'est
 * pas la réponse :
 *
 *  · `derogationsCapacite` est LU pour calculer les capacités effectives, puis
 *    RETIRÉ. Ces lignes portent un motif écrit par l'équipe SM (« geste de
 *    reprise », « retiré le temps du litige ») : une phrase de négociation
 *    commerciale n'a rien à faire sur la tablette du comptoir ;
 *  · `capacites` n'est dans AUCUNE projection : il se calcule. C'est ce que le
 *    front consomme — la liste de ce qu'il peut ouvrir, jamais la formule.
 */
const CLES_RENDUES = [
  ...new Set(Object.keys(TENANT_ME_FIELDS).map((c) => c.split('.')[0]!)),
]
  .filter((c) => c !== 'derogationsCapacite')
  .concat('capacites');

/**
 * LA PROJECTION VAUT AUSSI SUR LES ÉCRITURES.
 *
 * `GET /tenants/me` projetait ; les quatre PATCH rendaient le document ENTIER
 * (`findByIdAndUpdate(…, { new: true })`). Poser un horaire, un téléphone ou
 * l'objectif du jour renvoyait donc au navigateur exactement ce qu'on venait
 * de fermer en lecture — vers la même session ouverte au code sur la tablette
 * du comptoir.
 *
 * Ces tests parlent au service, pas à un fragment : c'est la RÉPONSE de la
 * route qu'ils inspectent, seul endroit où la fuite se voyait. Les CINQ
 * chemins y passent — les quatre écritures et la lecture — parce qu'ils
 * doivent rendre une seule et même forme.
 */
describe('les réponses des cinq chemins de la vue de session', () => {
  const routes: [string, (svc: TenantsService) => Promise<Record<string, unknown>>][] = [
    ['settings', (svc) => svc.updateSettings(TENANT, { dailyGoalCents: 30_000 })],
    ['identity', (svc) => svc.updateIdentity(TENANT, { name: 'Chez Lima' })],
    ['hours', (svc) => svc.updateHours(TENANT, { hours: [{ day: 1, lunch: null, dinner: null }] })],
    ['marque', (svc) => svc.updateMarque(TENANT, DIRECTIONS.soleil)],
  ];

  for (const [nom, appel] of routes) {
    it(`${nom} ne rend aucun champ privé, et rend la forme entière de la lecture`, async () => {
      const tenants = fakeTenants(DOCUMENT);
      const vue = await appel(service(tenants));

      for (const secret of SECRETS) {
        expect(vue, `« ${secret} » ne doit pas repartir dans la réponse d'un PATCH`).not.toHaveProperty(
          secret,
        );
      }
      // Le compte sort RÉDUIT à son statut : le motif de la suspension
      // (« Impayé de juillet ») est un litige commercial, pas un affichage.
      expect(vue.account).toEqual({ status: 'suspended' });
      // La MÊME forme que `GET /tenants/me` : `_id` (toujours rendu par Mongo)
      // et la liste blanche, rien de plus.
      expect(Object.keys(vue).sort()).toEqual(['_id', ...CLES_RENDUES].sort());
    });

    it(`${nom} demande la projection à Mongo, pas seulement au retour`, async () => {
      // Filtrer après coup ferait quand même transiter les champs privés par
      // le réseau et par les journaux : c'est la REQUÊTE qui doit être étroite.
      const tenants = fakeTenants(DOCUMENT);
      await appel(service(tenants));
      expect(tenants.options[0]).toMatchObject({
        new: true,
        projection: TENANT_ME_FIELDS,
        // Mongoose n'applique NI `required` NI `enum` sur une requête de mise
        // à jour sans cette option : les gardes de `BrandSub` ne se
        // déclenchaient jamais en production.
        runValidators: true,
        context: 'query',
      });
    });
  }

  it('rend les champs plats DÉRIVÉS du masque, comme la lecture', async () => {
    const tenants = fakeTenants({ ...DOCUMENT, brand: DIRECTIONS.soleil });
    const vue = await service(tenants).updateSettings(TENANT, { slotCapacity: 4 });
    // Le tenant dort avec `brandColor: #c9a15a` (avant reprise) ; le masque dit
    // safran. Rendre la colonne ferait mentir la réponse.
    expect(vue.brandColor).toBe(DIRECTIONS.soleil.palette.accent);
  });

  it('lit l’autorité privée sur le primaire avant le CAS sans contrôle historique', async () => {
    const tenants = fakeTenants(DOCUMENT);
    await service(tenants).updateSettings(TENANT, { slotCapacity: 4 });
    expect(tenants.filters).toEqual([{ _id: TENANT, capacityControl: { $exists: false } }]);
    expect(tenants.reads.some((read) => read.id === TENANT && JSON.stringify(read.steps) === JSON.stringify([
      ['select', '_id capacityControl'], ['read', 'primary'], ['readConcern', 'majority'], ['maxTimeMS', 10_000],
    ]))).toBe(true);
    expect(tenants.options[0]).toMatchObject({ projection: TENANT_ME_FIELDS, runValidators: true,
      context: 'query', writeConcern: { w: 'majority', j: true } });
  });

  it('la vue de session reste projetée après une révision active du calendrier', async () => {
    const capacityControl = { version: 1, state: 'active', configRevision: 7,
      bootstrapId: '11111111-1111-4111-8111-111111111111', cutoverAt: new Date('2030-05-01T00:00:00Z'), dayIntent: null };
    const tenants = fakeTenants({ ...DOCUMENT, capacityControl, brand: DIRECTIONS.soleil });
    const view = await service(tenants).updateSettings(TENANT, { slotCapacity: 6 });
    expect(view).not.toHaveProperty('capacityControl');
    expect(view.brandColor).toBe(DIRECTIONS.soleil.palette.accent);
    expect(Object.keys(view).sort()).toEqual(['_id', ...CLES_RENDUES].sort());
    expect(tenants.etat().capacityControl).toMatchObject({ configRevision: 8 });
    expect(tenants.filters[0]).toMatchObject({ _id: TENANT, 'capacityControl.state': 'active',
      'capacityControl.configRevision': 7, 'capacityControl.bootstrapId': capacityControl.bootstrapId });
  });

  it('un PATCH sans rien de reconnu relit, projeté, sans écrire', async () => {
    const tenants = fakeTenants(DOCUMENT);
    const vue = await service(tenants).updateSettings(TENANT, {});
    expect(tenants.sets).toHaveLength(0);
    expect(vue).not.toHaveProperty('siret');
    expect(vue.slug).toBe('chez-lima');
  });

  it('la LECTURE rend la même forme que les écritures — cinquième chemin', async () => {
    // `byId` est le chemin qui a été projeté le premier, et le seul que ce banc
    // ne parcourait pas : les quatre PATCH y étaient comparés à une liste, pas
    // à la lecture elle-même.
    const tenants = fakeTenants(DOCUMENT);
    const vue = await service(tenants).byId(TENANT);

    // Ce dont la barre de navigation a besoin, et qu'elle n'avait pas.
    expect(vue.plan).toBe('complet');
    expect(vue.onlineOrdering).toBe(true);
    expect(vue.account).toEqual({ status: 'suspended' });
    // Et ce qu'elle CONSOMME désormais : la liste calculée par le serveur. Le
    // front ne rejoue jamais le catalogue — c'est la règle d'or du produit.
    expect(vue.capacites).toEqual([...CAPACITES_PAR_FORMULE.complet, 'online', 'loyalty']);

    for (const secret of SECRETS) {
      expect(vue, `« ${secret} » ne doit pas sortir sur une tablette`).not.toHaveProperty(secret);
    }
    expect(Object.keys(vue).sort()).toEqual(['_id', ...CLES_RENDUES].sort());
  });

  it('la lecture demande la projection à Mongo, pas seulement au retour', async () => {
    const tenants = fakeTenants(DOCUMENT);
    const lectures: unknown[] = [];
    const espion = {
      ...tenants.model,
      findById: async (id: string, projection?: Record<string, unknown>) => {
        lectures.push(projection);
        return tenants.model.findById(id, projection);
      },
    };
    await new TenantsService(espion as never, testOriginesImages(), journalMuet()).byId(TENANT);
    expect(lectures[0]).toEqual(TENANT_ME_FIELDS);
  });

  it('sans compte en base, la lecture retombe sur le statut le plus permissif', async () => {
    // Il en existe : tous les tenants créés avant le champ `account`.
    const sansCompte: Record<string, unknown> = { ...DOCUMENT };
    delete sansCompte.account;
    const vue = await service(fakeTenants(sansCompte)).byId(TENANT);
    expect(vue.account).toEqual({ status: 'trial' });
  });

  it('répond 404 sur un tenant disparu, plutôt qu’un corps vide en 200', async () => {
    const tenants = fakeTenants(DOCUMENT);
    const svc = service(tenants);
    await expect(svc.updateSettings('665f0d0a1c2b3d4e5f6a7b00', {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      svc.updateHours('665f0d0a1c2b3d4e5f6a7b00', { hours: [] }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

/**
 * LES HORAIRES SONT VALIDÉS À L'ENTRÉE — et le service n'écrit que ce qu'on
 * lui transmet.
 *
 * La route prenait un corps NU. Le schéma vit au contrat
 * (`TenantHoursUpdateSchema`, testé là-bas) ; ce qui se vérifie ICI, c'est le
 * CÂBLAGE — la route porte bien le pipe — et le geste du service : enregistrer
 * ses horaires ne doit pas effacer les congés d'été.
 */
describe('les horaires posés depuis le back-office restaurateur', () => {
  it('la route exige le schéma du contrat, pas un corps nu', () => {
    // Le pipe se lit sur les métadonnées de la route : sans lui, `hours` et
    // `closures` repartaient vers le public sans avoir été regardés. Le
    // préfixe « 3: » est celui du corps dans `RouteParamtypes` de Nest — même
    // lecture que `loyalty.controller.test.ts`, qui épingle « 4: » pour la
    // requête.
    const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, TenantsController, 'updateHours') ??
      {}) as Record<string, { pipes?: unknown[] }>;
    const corps = Object.entries(args).find(([clef]) => clef.startsWith('3:'))?.[1];
    expect(corps?.pipes?.[0], 'PATCH /tenants/me/hours doit valider son corps').toBeInstanceOf(
      ZodValidationPipe,
    );
  });

  it('n’écrit les fermetures que si le corps les porte', async () => {
    const tenants = fakeTenants({ ...DOCUMENT, closures: [{ from: new Date(), reason: 'Congés' }] });
    await service(tenants).updateHours(TENANT, { hours: [{ day: 1, lunch: null, dinner: null }] });
    expect(Object.keys(tenants.sets[0] ?? {})).toEqual(['hours']);
  });

  it('remplace la liste des fermetures quand elle est transmise', async () => {
    const tenants = fakeTenants(DOCUMENT);
    await service(tenants).updateHours(TENANT, {
      hours: [],
      closures: [{ from: '2026-08-14', to: '2026-08-16', reason: 'Congés d’été' }],
    });
    expect(tenants.sets[0]).toEqual({
      hours: [],
      closures: [{ from: '2026-08-14', to: '2026-08-16', reason: 'Congés d’été' }],
    });
  });
});

/**
 * LE MASQUE POSÉ PAR LE RESTAURATEUR — le comportement, pas le fragment.
 *
 * Le CRM avait son banc (`admin.test.ts`), la route du restaurateur non : ni
 * l'héritage du logo PERSISTÉ, ni le refus AA sans écriture. Or c'est le même
 * geste, sur le même document, et c'est celui que le client voit.
 */
describe('le masque posé depuis le back-office restaurateur', () => {
  it('hérite le logo legacy à la première pose — persisté, pas seulement rendu', async () => {
    // `DIRECTIONS.soleil` ne porte aucun logo dans ses quatre emplacements ;
    // le tenant, lui, en a un depuis toujours dans la colonne plate.
    const tenants = fakeTenants(DOCUMENT);
    const vue = await service(tenants).updateMarque(TENANT, DIRECTIONS.soleil);

    const persiste = tenants.etat().brand as { logo: { mark: { dark: unknown; light: unknown } } };
    expect(persiste.logo.mark.dark).toBe(DOCUMENT.logoUrl);
    expect(persiste.logo.mark.light).toBeNull();
    // Et la réponse le dit déjà : pas besoin de recharger la page.
    expect(vue.logoUrl).toBe(DOCUMENT.logoUrl);
  });

  it('ne lit du tenant que le logo — une fiche complète n’a rien à faire ici', async () => {
    // `updateIdentity` ne lit que `brand`, `byId` la liste blanche : la
    // lecture non projetée était la seule qui restait dans ce fichier.
    const tenants = fakeTenants(DOCUMENT);
    const lectures: unknown[] = [];
    const espion = {
      ...tenants.model,
      findById: async (id: string, projection?: Record<string, unknown>) => {
        lectures.push(projection);
        return tenants.model.findById(id, projection);
      },
    };
    await new TenantsService(espion as never, testOriginesImages(), journalMuet()).updateMarque(
      TENANT,
      DIRECTIONS.soleil,
    );
    expect(lectures[0]).toEqual({ logoUrl: 1 });
  });

  it('refuse en 400 un masque illisible, et n’écrit rien', async () => {
    const pale = {
      ...DIRECTIONS.marche,
      palette: { ...DIRECTIONS.marche.palette, ink: '#9aa79e' },
    };
    const tenants = fakeTenants(DOCUMENT);
    await expect(service(tenants).updateMarque(TENANT, pale)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(tenants.sets).toHaveLength(0);
    expect(tenants.etat().brand).toBeNull();
  });
});
