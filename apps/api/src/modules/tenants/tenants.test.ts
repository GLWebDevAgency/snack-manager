import { TenantSettingsUpdateSchema } from '@sm/contracts';
import { TenantSchema } from '@sm/db';
import { describe, expect, it } from 'vitest';
import { DIRECTIONS, ratioContraste } from '@sm/contracts';
import {
  derivesDuMasque,
  identiteAvecAccent,
  REGLAGES_MODIFIABLES,
  TENANT_ME_FIELDS,
} from './tenants.service';

/**
 * La route des réglages prend un corps NU — aucun schéma Zod ne la valide
 * (`tenants.controller.ts`, `@Body()` sans pipe). La liste blanche du service
 * est donc le seul rempart, et elle a un angle mort : elle dit ce qu'on a le
 * droit d'écrire, jamais ce que la base sait recevoir.
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
        'address',
        'brand',
        'brandColor',
        'closures',
        'hours',
        'logoUrl',
        'name',
        'phones',
        'plan',
        'settings',
        'slug',
      ].sort(),
    );
  });

  it('ne rend AUCUN des champs qui fuyaient', () => {
    // Nommés un par un : c'est la liste qu'un équipier de cuisine lisait, et
    // celle qu'une régression rouvrirait.
    for (const secret of [
      'billing',
      'siret',
      'tvaNumber',
      'stripe',
      'encaissement',
      'account',
      'atelier',
      'founderDiscountCents',
      'founderUntil',
      'onlineOrdering',
      'billingCycle',
    ]) {
      expect(TENANT_ME_FIELDS, `« ${secret} » ne doit pas sortir sur une tablette`).not.toHaveProperty(
        secret,
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
 * Le service n'a pas de banc d'essai (il parle à Mongoose) : c'est le
 * fragment `$set`, pur, qui est verrouillé ici.
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
    expect(vue.brandColor).toBe('#E07A1F');
    expect(vue.logoUrl).toBe('https://r2/l.png');
    expect(vue.brand.preset).toBe('soleil');
    expect(vue.slug).toBe('x');
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
