import { NotFoundException } from '@nestjs/common';
import { DIRECTIONS } from '@sm/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { TenantsService } from '../tenants/tenants.service';
import type { LoyaltyAdminService } from './loyalty-admin.service';
import type { LoyaltyMemberService } from './loyalty-member.service';
import { LoyaltyPublicService } from './loyalty-public.service';

const PROGRAM = {
  id: '37d0b9d8-3cff-44c6-b211-fc617c153f02',
  name: 'La carte Classfood',
  status: 'active' as const,
  earn: {
    mechanism: 'points' as const,
    minimumPurchaseCents: 0,
    maximumUnitsPerPurchase: null,
    spendStepCents: 100,
    unitsPerStep: 1,
  },
  unitLabelSingular: 'point',
  unitLabelPlural: 'points',
  termsSummary: 'Avantages non échangeables contre de l’argent.',
  rulesVersion: 1,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

const REWARD = {
  id: 'd6045d98-6974-43d0-b74a-ff5d0565411f',
  programId: PROGRAM.id,
  name: 'Menu offert',
  description: 'Un menu au choix',
  costUnits: 100,
  kind: 'custom' as const,
  valueCents: null,
  productRef: null,
  active: true,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

/**
 * `tenant` étale ce qu'on veut poser sur l'établissement de la fixture — le
 * masque, en pratique. Sans ce paramètre, seul le chemin de REPLI (tenant sans
 * `brand`) était couvert : un restaurant repris qui aurait rendu Nuit au lieu
 * de sa propre identité ne faisait rougir aucun test.
 *
 * `plan: 'boost'` et `account.status: 'active'` sont posés par DÉFAUT, et ce
 * n'est pas de la décoration : depuis que ces routes vérifient la souscription
 * et le compte, un tenant de fixture sans formule décrit un restaurant à qui la
 * fidélité n'a jamais été vendue — sa carte se fermerait, et tous les tests de
 * rendu ci-dessous vérifieraient un 404 en croyant vérifier un masque.
 */
function build(status: 'active' | 'blocked' = 'active', tenant: Record<string, unknown> = {}) {
  const tenants = {
    bySlug: vi.fn().mockResolvedValue({
      _id: 'tenant_classfood',
      slug: 'classfood',
      name: 'Classfood',
      brandColor: '#c9a15a',
      logoUrl: null,
      plan: 'boost',
      account: { status: 'active' },
      ...tenant,
    }),
  };
  const loyalty = {
    getProgram: vi.fn().mockResolvedValue(PROGRAM),
    listRewards: vi.fn().mockResolvedValue([REWARD, { ...REWARD, id: '78e40a07-5cbc-4a20-8269-fafc418c73dc', active: false }]),
  };
  const members = {
    resolveMember: vi.fn().mockResolvedValue({
      id: 'e7df64f1-1d35-4f73-9515-25c8d3fbb2de',
      alias: 'Maya',
      maskedPhone: '•• •• •• 42',
      status,
      balanceUnits: 125,
      lifetimeEarnedUnits: 180,
      lifetimeRedeemedUnits: 55,
      lastActivityAt: '2026-09-01T10:00:00.000Z',
      joinedAt: '2026-08-01T10:00:00.000Z',
    }),
    getMemberDetail: vi.fn().mockResolvedValue({
      member: {
        id: 'e7df64f1-1d35-4f73-9515-25c8d3fbb2de',
        alias: 'Maya',
        maskedPhone: '•• •• •• 42',
        status,
        balanceUnits: 125,
        lifetimeEarnedUnits: 180,
        lifetimeRedeemedUnits: 55,
        lastActivityAt: '2026-09-01T10:00:00.000Z',
        joinedAt: '2026-08-01T10:00:00.000Z',
      },
      consents: [],
      ledger: [
        {
          id: '168822a3-c068-47ac-9e46-2ec190d505b8',
          kind: 'earn',
          deltaUnits: 12,
          balanceAfter: 125,
          source: 'pos',
          reason: 'Détail opérateur non public',
          externalRef: 'ticket-secret-42',
          recordedAt: '2026-09-01T10:00:00.000Z',
        },
      ],
    }),
  };
  return {
    service: new LoyaltyPublicService(
      tenants as unknown as TenantsService,
      loyalty as unknown as LoyaltyAdminService,
      members as unknown as LoyaltyMemberService,
    ),
    tenants,
    loyalty,
    members,
  };
}

describe('LoyaltyPublicService', () => {
  it('rend un catalogue public limité aux récompenses actives', async () => {
    const { service } = build();
    const catalog = await service.catalog('classfood');
    // Ce tenant n'a pas été repris (pas de `brand`) : le masque effectif est le
    // repli Nuit avec son accent — valeurs concrètes, pas recalculées avec la
    // fonction sous test (ça ne vérifierait plus rien).
    expect(catalog.restaurant.slug).toBe('classfood');
    expect(catalog.restaurant.name).toBe('Classfood');
    expect(catalog.restaurant.brandColor).toBe('#c9a15a');
    expect(catalog.restaurant.logoUrl).toBeNull();
    expect(catalog.restaurant.brand.preset).toBe('nuit');
    expect(catalog.restaurant.brand.palette.accent).toBe('#c9a15a');
    expect(catalog.rewards).toHaveLength(1);
  });

  it('rend le masque du restaurant REPRIS, pas le repli Nuit', async () => {
    // Le seul cas couvert était celui du tenant sans `brand`. Or c'est le cas
    // repris qui compte : la carte fidélité est une surface CLIENT, et un
    // restaurant qui y verrait Nuit à la place de son enseigne le dirait —
    // après l'avoir montré à ses clients.
    const masque = {
      ...DIRECTIONS.soleil,
      logo: { mark: { light: null, dark: 'https://r2.test/soleil.png' }, lockup: { light: null, dark: null } },
    };
    const { service } = build('active', { brand: masque });
    const catalog = await service.catalog('classfood');

    expect(catalog.restaurant.brand).toEqual(masque);
    // Les champs plats DÉRIVENT du masque, jamais des colonnes : le tenant
    // dort avec `brandColor: #c9a15a` et `logoUrl: null`, et les rendre tels
    // quels ferait mentir la carte dès la première reprise.
    expect(catalog.restaurant.brandColor).toBe(DIRECTIONS.soleil.palette.accent);
    expect(catalog.restaurant.logoUrl).toBe('https://r2.test/soleil.png');
  });

  it('ne rend ni téléphone, identifiant interne, ticket ni jeton dans la carte client', async () => {
    const { service, members } = build();
    const token = 'A'.repeat(43);
    const card = await service.card('classfood', token);
    expect(members.resolveMember).toHaveBeenCalledWith('tenant_classfood', {
      by: 'qr_token',
      qrToken: token,
    });
    const serialized = JSON.stringify(card);
    expect(card.member).toEqual({ alias: 'Maya', balanceUnits: 125 });
    expect(serialized).not.toContain('maskedPhone');
    expect(serialized).not.toContain('e7df64f1-1d35-4f73-9515-25c8d3fbb2de');
    expect(serialized).not.toContain('ticket-secret-42');
    expect(serialized).not.toContain('Détail opérateur non public');
    expect(serialized).not.toContain(token);
    expect(card.activity[0]).toMatchObject({
      kind: 'earn',
      label: 'Achat enregistré',
      deltaUnits: 12,
    });
    expect(card.rewards[0]?.affordable).toBe(true);
  });

  it('habille la carte client du masque du restaurant', async () => {
    // `restaurant.brand` n'était assertionné NULLE PART sur la carte : c'est
    // pourtant l'écran que le client ouvre au comptoir, et le seul endroit où
    // le masque doit tenir sans `logoUrl` (absent de `LoyaltyCustomerCard`).
    const { service } = build('active', { brand: DIRECTIONS.soleil });
    const card = await service.card('classfood', 'A'.repeat(43));

    expect(card.restaurant.brand).toEqual(DIRECTIONS.soleil);
    expect(card.restaurant.brand?.preset).toBe('soleil');
    expect(card.restaurant.brandColor).toBe(DIRECTIONS.soleil.palette.accent);
  });

  it('retombe sur le repli Nuit tant que le restaurant n’est pas repris', async () => {
    const { service } = build();
    const card = await service.card('classfood', 'A'.repeat(43));

    expect(card.restaurant.brand?.preset).toBe('nuit');
    // L'accent BRUT du tenant, pas ajusté (spec §8.1).
    expect(card.restaurant.brand?.palette.accent).toBe('#c9a15a');
    expect(card.restaurant.brandColor).toBe('#c9a15a');
  });

  it('masque une carte bloquée derrière une indisponibilité uniforme', async () => {
    const { service } = build('blocked');
    await expect(service.card('classfood', 'A'.repeat(43))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

/**
 * CE QUE LE SLUG N'OUVRE PLUS.
 *
 * Ces routes ne posaient AUCUNE des deux questions que la vitrine pose déjà
 * (`publicBySlug`) : un restaurant suspendu servait sa carte pendant que sa
 * commande en ligne était fermée, et un restaurant sans le module de fidélité
 * servait un programme qu'il n'a jamais acheté.
 *
 * Les deux routes sont éprouvées à chaque fois — `catalog` ET `card` — parce
 * qu'elles partagent `context` mais pas leur chemin d'appel : une garde vérifiée
 * sur la seule première laisserait la seconde ouverte le jour où l'une des deux
 * cesserait de passer par là.
 */
describe('LoyaltyPublicService — compte et souscription', () => {
  const TOKEN = 'A'.repeat(43);
  const DEROGATION = {
    capacite: 'loyalty',
    sens: 'accordee',
    motif: 'Programme du pilote, ouvert hors formule',
    auteur: 'Équipe Snack Manager',
    le: '2026-09-03T09:00:00.000Z',
  };

  /** Les deux routes publiques, refusées de la même façon et sans détail. */
  async function attendreIndisponible(tenant: Record<string, unknown>) {
    const { service, loyalty, members } = build('active', tenant);
    await expect(service.catalog('classfood')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.card('classfood', TOKEN)).rejects.toBeInstanceOf(NotFoundException);
    // Fermé AVANT la lecture du programme : rien à lire chez un restaurant
    // qu'on ne sert pas.
    expect(loyalty.getProgram).not.toHaveBeenCalled();
    expect(loyalty.listRewards).not.toHaveBeenCalled();
    expect(members.resolveMember).not.toHaveBeenCalled();
    expect(members.getMemberDetail).not.toHaveBeenCalled();
    return service;
  }

  it('ferme les deux routes d’un compte SUSPENDU', async () => {
    await attendreIndisponible({ account: { status: 'suspended' } });
  });

  it.each(['suspended', 'churned'])('rend au compte %s le MÊME message qu’à un programme en brouillon', async (status) => {
    // Sans quoi la route deviendrait un oracle : n'importe qui, avec un slug,
    // saurait dire l'impayé du module non souscrit et du programme non publié.
    const ferme = build('active', { account: { status } }).service;
    const brouillon = build('active', {});
    brouillon.loyalty.getProgram.mockResolvedValue({ ...PROGRAM, status: 'draft' });
    const messages = await Promise.all(
      [ferme.catalog('classfood'), ferme.card('classfood', TOKEN), brouillon.service.catalog('classfood')].map((p) =>
        p.then(
          () => null,
          (error: unknown) => (error as Error).message,
        ),
      ),
    );
    expect(messages[0]).toBe('Programme de fidélité indisponible');
    expect(messages[1]).toBe(messages[0]);
    expect(messages[2]).toBe(messages[0]);
  });

  it('sert les essais, comptes actifs et statuts historiques absents', async () => {
    for (const account of [{ status: 'trial' }, { status: 'active' }, undefined, null, {}, { status: null }]) {
      const { service } = build('active', { account });
      await expect(service.catalog('classfood')).resolves.toMatchObject({
        restaurant: { slug: 'classfood' },
      });
      await expect(service.card('classfood', TOKEN)).resolves.toMatchObject({
        member: { alias: 'Maya' },
      });
    }
  });

  it('ferme les deux routes sans formule ou module incluant la fidélité', async () => {
    // LE PIÈGE DE DÉPLOIEMENT, épinglé ici : le restaurant pilote tourne en
    // Complet avec un programme actif. Sans la dérogation posée AVANT la mise
    // en ligne, ce test décrit exactement ce que ses clients verraient.
    await attendreIndisponible({ plan: 'complet' });
    await attendreIndisponible({ plan: 'essentiel' });
    await attendreIndisponible({ plan: null });
  });

  it.each([{ onlineOrdering: true }, { onlineDelivery: true }, { standaloneLoyalty: true }])(
    'ouvre la carte pour un module autonome souscrit : %j', async (offre) => {
      const { service } = build('active', { plan: null, ...offre });
      await expect(service.catalog('classfood')).resolves.toMatchObject({
        program: { name: 'La carte Classfood' },
      });
      await expect(service.card('classfood', TOKEN)).resolves.toMatchObject({
        member: { balanceUnits: 125 },
      });
    },
  );

  it.each([
    { plan: 'boost' },
    { plan: null, standaloneLoyalty: true },
    { plan: null, onlineOrdering: true },
    { plan: null, onlineDelivery: true },
    { plan: 'complet', derogationsCapacite: [DEROGATION] },
  ])('ferme catalogue et carte après résiliation sans lire le programme ou le porteur : %j', async (offre) => {
    await attendreIndisponible({ ...offre, account: { status: 'churned' } });
  });

  it.each([{ onlineOrdering: true }, { onlineDelivery: true }, { standaloneLoyalty: true }])(
    'un module souscrit ne publie pas un programme absent, brouillon ou en pause : %j', async (offre) => {
      for (const program of [null, { ...PROGRAM, status: 'draft' }, { ...PROGRAM, status: 'paused' }]) {
        const { service, loyalty, members } = build('active', { plan: null, ...offre });
        loyalty.getProgram.mockResolvedValue(program);
        await expect(service.catalog('classfood')).rejects.toBeInstanceOf(NotFoundException);
        await expect(service.card('classfood', TOKEN)).rejects.toBeInstanceOf(NotFoundException);
        expect(members.resolveMember).not.toHaveBeenCalled();
        expect(members.getMemberDetail).not.toHaveBeenCalled();
      }
      await attendreIndisponible({ plan: null, ...offre,
        derogationsCapacite: [{ ...DEROGATION, sens: 'retiree' }],
      });
    },
  );

  it('sert un Complet dont la fidélité est ACCORDÉE hors formule', async () => {
    const { service } = build('active', {
      plan: 'complet',
      derogationsCapacite: [DEROGATION],
    });
    await expect(service.catalog('classfood')).resolves.toMatchObject({
      program: { name: 'La carte Classfood' },
    });
    await expect(service.card('classfood', TOKEN)).resolves.toMatchObject({
      member: { balanceUnits: 125 },
    });
  });

  it('ferme un Boost dont la fidélité est RETIRÉE, et un Complet dont la dérogation est levée', async () => {
    // Un retrait l'emporte toujours sur ce que la formule comprend…
    await attendreIndisponible({
      plan: 'boost',
      derogationsCapacite: [{ ...DEROGATION, sens: 'retiree', motif: 'Retirée le temps du litige' }],
    });
    // …et une levée efface la ligne, rendant la capacité à la formule.
    await attendreIndisponible({ plan: 'complet', derogationsCapacite: [] });
  });

  it('ferme la carte d’un compte suspendu MÊME quand la fidélité est accordée', async () => {
    // Les deux conditions sont un ET : une dérogation ouvre un module, elle
    // n'annule pas un impayé.
    await attendreIndisponible({
      plan: 'complet',
      derogationsCapacite: [DEROGATION],
      account: { status: 'suspended' },
    });
  });
});
