import { describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import {
  EMPTY_SERVICES,
  FOUNDER_SEATS_TOTAL,
  type JwtPayload,
  type LeadProposal,
} from '@sm/contracts';
import type { Lead, Tenant, User } from '@sm/db';
import type { SecretHasher } from '@sm/domain/src/ports';
import type { AdminService } from './admin.service';
import { ConversionService, generatePassword } from './conversion.service';

/**
 * SIGNER — le geste complet, vérifié pièce par pièce : le tenant naît en
 * essai daté, le compte gérant naît haché, le lead se marque, le journal
 * s'écrit, et le mot de passe ne sort qu'UNE fois. Les doublures suivent la
 * règle maison : elles ne savent faire QUE ce que le service appelle.
 */

const NOW = new Date('2026-08-24T12:00:00.000Z');
const LEAD_ID = new Types.ObjectId().toHexString();
const ACTOR: JwtPayload = { sub: new Types.ObjectId().toHexString(), tenantId: null, role: 'sm_admin' } as JwtPayload;

const proposalDoc = (over: Partial<LeadProposal> = {}) => ({
  plan: 'complet' as const,
  onlineOrdering: true,
  billing: 'mensuel' as const,
  services: EMPTY_SERVICES,
  note: '',
  ...over,
  at: NOW,
});

const leadDoc = (
  over: {
    founderSeatReserved?: boolean;
    proposal?: ReturnType<typeof proposalDoc> | null;
  } = {},
) => ({
  _id: new Types.ObjectId(LEAD_ID),
  restaurantName: 'Chez Nicolas',
  stage: 'proposition',
  founderSeatReserved: over.founderSeatReserved ?? false,
  proposal: over.proposal === undefined ? proposalDoc() : over.proposal,
});

function build(over: {
  slugTaken?: boolean;
  emailTaken?: boolean;
  userCreateFails?: boolean;
  failIssue?: boolean;
  lead?: ReturnType<typeof leadDoc> | null;
  proposal?: ReturnType<typeof proposalDoc> | null;
  founderSeatReserved?: boolean;
  /** Places fondateur déjà prises au parc — dix au total. */
  founderSeatsTaken?: number;
} = {}) {
  const tenantId = new Types.ObjectId();
  const leads = {
    findById: vi.fn().mockReturnValue({
      lean: () =>
        Promise.resolve(
          over.lead === undefined
            ? leadDoc({
                proposal: over.proposal,
                founderSeatReserved: over.founderSeatReserved,
              })
            : over.lead,
        ),
    }),
    updateOne: vi.fn().mockResolvedValue({}),
  };
  const tenants = {
    findOne: vi.fn().mockReturnValue({ lean: () => Promise.resolve(over.slugTaken ? { _id: 'x' } : null) }),
    create: vi.fn().mockImplementation((doc: Record<string, unknown>) => Promise.resolve({ _id: tenantId, ...doc })),
    deleteOne: vi.fn().mockResolvedValue({}),
    // Les places fondateur déjà prises au parc — bornées à dix côté serveur.
    countDocuments: vi.fn().mockResolvedValue(over.founderSeatsTaken ?? 0),
  };
  const users = {
    findOne: vi.fn().mockReturnValue({ lean: () => Promise.resolve(over.emailTaken ? { _id: 'u' } : null) }),
    create: over.userCreateFails
      ? vi.fn().mockRejectedValue(new Error('duplicate key'))
      : vi.fn().mockResolvedValue({}),
    updateOne: vi.fn().mockResolvedValue({}),
  };
  const hasher: SecretHasher = {
    providerName: 'fake',
    hash: vi.fn().mockImplementation((s: string) => Promise.resolve(`empreinte(${s})`)),
    verify: vi.fn().mockResolvedValue(true),
  };
  const admin = {
    recordTenantCreation: vi.fn().mockResolvedValue({}),
    recordOwnerReset: vi.fn().mockResolvedValue({}),
  };
  // La facturation ne sait faire qu'ÉMETTRE — c'est tout ce que la signature
  // lui demande. `failIssue` simule la panne : la signature doit y survivre.
  const billing = {
    issue: over.failIssue
      ? vi.fn().mockRejectedValue(new Error('facturation en panne'))
      : vi.fn().mockResolvedValue({}),
  };
  const service = new ConversionService(
    leads as unknown as Model<Lead>,
    tenants as unknown as Model<Tenant>,
    users as unknown as Model<User>,
    hasher,
    admin as unknown as AdminService,
    billing as unknown as import('./billing.service').BillingService,
  );
  return { service, leads, tenants, users, admin, billing, tenantId };
}

const BODY = {
  slug: 'chez-nicolas',
  ownerEmail: 'Nicolas@Exemple.fr',
  ownerName: 'Nicolas',
  plan: 'complet' as const,
  // Un client ORDINAIRE par défaut : depuis que la place fondateur remise
  // réellement de 50 %, la laisser à `true` ici ferait passer tous les
  // montants de tous les tests par la remise, sans que ce soit le sujet.
  founderSeat: false,
  onlineOrdering: true,
  billing: 'mensuel' as const,
  services: EMPTY_SERVICES,
};

describe('Mot de passe généré', () => {
  it('trois groupes de quatre, alphabet sans ambiguïté', () => {
    const password = generatePassword();
    expect(password).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect(password).not.toMatch(/[01loi]/);
  });

  it('déterministe sous un tirage imposé — c’est bien le tirage qui décide', () => {
    expect(generatePassword(() => 0)).toBe('aaaa-aaaa-aaaa');
  });
});

describe('Convertir un lead en restaurant', () => {
  it.each([
    { plan: null, onlineOrdering: false, onlineDelivery: false, standaloneLoyalty: true, amounts: [3_900, 5_500] },
    { plan: null, onlineOrdering: true, onlineDelivery: false, standaloneLoyalty: true, amounts: [7_900, 5_500] },
    { plan: null, onlineOrdering: false, onlineDelivery: true, standaloneLoyalty: true, amounts: [11_900, 5_500] },
    { plan: 'boost' as const, onlineOrdering: true, onlineDelivery: true, standaloneLoyalty: true, amounts: [23_900] },
  ])('conserve les options signées et prépare leurs factures : $amounts', async ({ amounts, ...offre }) => {
    const { service, tenants, billing } = build({ proposal: proposalDoc(offre) });
    // Le navigateur n'est pas la source des termes signés.
    await service.convert(ACTOR, LEAD_ID, { ...BODY, onlineOrdering: !offre.onlineOrdering }, NOW);
    expect(tenants.create.mock.calls[0]?.[0]).toMatchObject(offre);
    expect(billing.issue.mock.calls.map((call) => (call[2] as { amountCents: number }).amountCents)).toEqual(amounts);
    const label = String((billing.issue.mock.calls[0]?.[2] as { label: string }).label);
    expect(label).toContain(offre.onlineDelivery ? 'livraison' : offre.onlineOrdering ? 'commande en ligne' : 'fidélité');
  });

  it('fige la remise fondateur sur la fidélité autonome signée', async () => {
    const { service, tenants, billing } = build({ founderSeatReserved: true, proposal: proposalDoc({ plan: null, onlineOrdering: false, standaloneLoyalty: true }) });
    await service.convert(ACTOR, LEAD_ID, BODY, NOW);
    expect(tenants.create.mock.calls[0]?.[0]).toMatchObject({ founderDiscountCents: 1_950 });
    expect(billing.issue.mock.calls.map((call) => (call[2] as { amountCents: number }).amountCents)).toEqual([1_950, 2_750]);
  });

  it('crée le tenant en essai daté, le compte haché, marque le lead, journalise', async () => {
    const { service, leads, tenants, users, admin, tenantId } = build();
    const result = await service.convert(ACTOR, LEAD_ID, BODY, NOW);

    // Le tenant : essai de 30 jours, échéance POSÉE, offre signée conservée.
    const tenant = tenants.create.mock.calls[0]?.[0] as Record<string, any>;
    expect(tenant.slug).toBe('chez-nicolas');
    expect(tenant.name).toBe('Chez Nicolas');
    expect(tenant.founderSeat).toBe(false);
    expect(tenant.account.status).toBe('trial');
    expect(tenant.account.trialEndsAt).toEqual(new Date('2026-09-23T12:00:00.000Z'));
    // Rien de vendu à l'Atelier : l'absence s'écrit null, pas un objet de faux.
    expect(tenant.atelier).toBeNull();

    // Le compte : e-mail abaissé, jamais le mot de passe en clair.
    const user = users.create.mock.calls[0]?.[0] as Record<string, any>;
    expect(user.email).toBe('nicolas@exemple.fr');
    expect(user.role).toBe('owner');
    // C'est la SORTIE DU HACHEUR qui est stockée, jamais le mot de passe nu
    // (la doublure encapsule exprès : l'égalité prouve le passage par hash()).
    expect(user.passwordHash).toBe(`empreinte(${result.password})`);
    expect(user.passwordHash).not.toBe(result.password);

    // Le lead : signé, la réservation s'éteint (la place vit sur le tenant).
    const update = leads.updateOne.mock.calls[0]?.[1] as Record<string, any>;
    expect(update.$set).toMatchObject({ stage: 'signe', founderSeatReserved: false });
    expect(update.$push.touches.note).toContain('chez-nicolas');

    expect(admin.recordTenantCreation).toHaveBeenCalledWith(
      ACTOR,
      String(tenantId),
      expect.objectContaining({ slug: 'chez-nicolas', ownerEmail: 'nicolas@exemple.fr' }),
    );
    expect(result.password).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect(result.trialEndsAt).toBe('2026-09-23T12:00:00.000Z');
  });

  it('refuse un slug déjà pris, un e-mail déjà connu, un lead fantôme', async () => {
    await expect(build({ slugTaken: true }).service.convert(ACTOR, LEAD_ID, BODY)).rejects.toThrow(
      ConflictException,
    );
    await expect(build({ emailTaken: true }).service.convert(ACTOR, LEAD_ID, BODY)).rejects.toThrow(
      ConflictException,
    );
    await expect(build({ lead: null }).service.convert(ACTOR, LEAD_ID, BODY)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('échoue sans proposition avant toute écriture', async () => {
    const { service, leads, tenants, users, admin, billing } = build({ proposal: null });

    await expect(service.convert(ACTOR, LEAD_ID, BODY)).rejects.toThrow(/Aucune proposition posée/);

    expect(tenants.findOne).not.toHaveBeenCalled();
    expect(tenants.countDocuments).not.toHaveBeenCalled();
    expect(tenants.create).not.toHaveBeenCalled();
    expect(tenants.deleteOne).not.toHaveBeenCalled();
    expect(users.findOne).not.toHaveBeenCalled();
    expect(users.create).not.toHaveBeenCalled();
    expect(users.updateOne).not.toHaveBeenCalled();
    expect(leads.updateOne).not.toHaveBeenCalled();
    expect(admin.recordTenantCreation).not.toHaveBeenCalled();
    expect(billing.issue).not.toHaveBeenCalled();
  });

  it('refuse une proposition persistée incohérente avant toute écriture', async () => {
    const { service, leads, tenants, users, admin, billing } = build({
      proposal: proposalDoc({
        plan: null,
        onlineOrdering: false,
        services: EMPTY_SERVICES,
      }),
    });

    await expect(service.convert(ACTOR, LEAD_ID, BODY)).rejects.toThrow(
      /proposition enregistrée est incohérente/,
    );

    expect(tenants.findOne).not.toHaveBeenCalled();
    expect(tenants.countDocuments).not.toHaveBeenCalled();
    expect(tenants.create).not.toHaveBeenCalled();
    expect(users.findOne).not.toHaveBeenCalled();
    expect(users.create).not.toHaveBeenCalled();
    expect(leads.updateOne).not.toHaveBeenCalled();
    expect(admin.recordTenantCreation).not.toHaveBeenCalled();
    expect(billing.issue).not.toHaveBeenCalled();
  });

  it('supprime le tenant orphelin si le compte gérant échoue', async () => {
    const { service, tenants } = build({ userCreateFails: true });
    await expect(service.convert(ACTOR, LEAD_ID, BODY)).rejects.toThrow('duplicate key');
    expect(tenants.deleteOne).toHaveBeenCalledOnce();
  });

  it('pose les brouillons de facture dérivés des termes signés — abonnement + mise en service', async () => {
    const { service, billing, tenantId } = build();
    const result = await service.convert(ACTOR, LEAD_ID, BODY, NOW);

    // Complet (159 €) + module (79 €) = 238 € HT par mois ; mise en service 55 €.
    const [abonnement, mise] = billing.issue.mock.calls.map((c) => c[2] as Record<string, any>);
    expect(billing.issue.mock.calls[0]?.[1]).toBe(String(tenantId));
    expect(abonnement).toMatchObject({
      kind: 'abonnement',
      draft: true,
      amountCents: 23_800,
      period: '2026-09', // le mois de la fin d'essai — rien n'est dû avant
    });
    expect(abonnement?.dueAt).toEqual(new Date('2026-09-23T12:00:00.000Z'));
    expect(abonnement?.label).toContain('commande en ligne');
    expect(mise).toMatchObject({ kind: 'mise_en_place', draft: true, amountCents: 5_500 });
    expect(result.draftInvoices).toBe(2);
  });

  it('ignore un body commercial contradictoire et applique partout la proposition du lead', async () => {
    const { service, tenants, users, admin, billing, tenantId } = build();

    await service.convert(
      ACTOR,
      LEAD_ID,
      {
        slug: 'identite-du-body',
        ownerEmail: 'Gerant@Exemple.fr',
        ownerName: 'La Gérante',
        // Tout ce qui suit contredit la proposition persistée Complet +
        // module, mensuelle, ordinaire et sans Atelier.
        plan: 'boost',
        founderSeat: true,
        onlineOrdering: false,
        billing: 'annuel',
        services: { ...EMPTY_SERVICES, siteVitrine: true, presenceInternet: true },
      },
      NOW,
    );

    const tenant = tenants.create.mock.calls[0]?.[0] as Record<string, any>;
    expect(tenant).toMatchObject({
      slug: 'identite-du-body',
      plan: 'complet',
      founderSeat: false,
      onlineOrdering: true,
      billingCycle: 'mensuel',
      atelier: null,
      founderDiscountCents: null,
    });
    expect(tenants.countDocuments).not.toHaveBeenCalled();
    expect(users.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'gerant@exemple.fr', name: 'La Gérante' }),
    );
    expect(admin.recordTenantCreation).toHaveBeenCalledWith(
      ACTOR,
      String(tenantId),
      expect.objectContaining({
        slug: 'identite-du-body',
        plan: 'complet',
        founderSeat: false,
      }),
    );
    expect(billing.issue.mock.calls.map((call) => call[2])).toEqual([
      expect.objectContaining({ kind: 'abonnement', amountCents: 23_800 }),
      expect.objectContaining({ kind: 'mise_en_place', amountCents: 5_500 }),
    ]);
  });

  it('facture l’annuel douze mois payés dix, sans mise en service hors module', async () => {
    const { service, billing } = build({
      proposal: proposalDoc({ plan: 'boost', onlineOrdering: false, billing: 'annuel' }),
    });
    const result = await service.convert(ACTOR, LEAD_ID, BODY, NOW);
    // Boost 199 € — module compris, donc pas de mise en service ; annuel = ×10.
    expect(billing.issue).toHaveBeenCalledOnce();
    const corps = billing.issue.mock.calls[0]?.[2] as Record<string, any>;
    expect(corps.amountCents).toBe(199_000);
    expect(corps.label).toContain('annuel');
    expect(result.draftInvoices).toBe(1);
  });

  it('l’Atelier signé : les mensuels sur leur pièce jamais annualisée, une pièce par ponctuel', async () => {
    const services = {
      ...EMPTY_SERVICES,
      siteVitrine: true,
      identiteVisuelle: true,
      presenceInternet: true,
      reseauxSociaux: 'hebdo' as const,
    };
    const { service, billing, tenants } = build({
      proposal: proposalDoc({
        onlineOrdering: false,
        billing: 'annuel',
        services,
      }),
    });
    const result = await service.convert(ACTOR, LEAD_ID, BODY, NOW);
    const corps = billing.issue.mock.calls.map((c) => c[2] as Record<string, any>);
    // Abonnement annuel ×10 (Complet seul) ; Atelier mensuel À PART, au mois ;
    // puis une pièce PAR service ponctuel — le site se relance sans l'identité.
    expect(corps.map((c) => [c.kind, c.amountCents])).toEqual([
      ['abonnement', 159_000],
      ['option', 6_900 + 14_900],
      ['autre', 69_000],
      ['autre', 39_000],
    ]);
    expect(corps[1]?.label).toContain('sans engagement');
    expect(result.draftInvoices).toBe(4);
    // Et l'Atelier vit sur le CLIENT : la fiche lira « qui a quoi » ici.
    const tenant = tenants.create.mock.calls[0]?.[0] as Record<string, any>;
    expect(tenant.atelier).toMatchObject({
      siteVitrine: true,
      identiteVisuelle: true,
      presenceInternet: true,
      reseauxSociaux: 'hebdo',
      signedAt: NOW,
    });
  });

  it('signé SANS formule : le tenant naît sans plan, aucune pièce d’abonnement', async () => {
    const { service, billing, tenants, admin, tenantId } = build({
      proposal: proposalDoc({
        plan: null,
        onlineOrdering: false,
        services: { ...EMPTY_SERVICES, siteVitrine: true, presenceInternet: true },
      }),
    });
    const result = await service.convert(ACTOR, LEAD_ID, BODY, NOW);
    // Le client Atelier seul entre au parc : plan null, Atelier sur la fiche.
    const tenant = tenants.create.mock.calls[0]?.[0] as Record<string, any>;
    expect(tenant.plan).toBeNull();
    expect(tenant.atelier).toMatchObject({ siteVitrine: true, presenceInternet: true });
    // Rien à abonner : que le mensuel Atelier et le ponctuel du site.
    const corps = billing.issue.mock.calls.map((c) => c[2] as Record<string, any>);
    expect(corps.map((c) => [c.kind, c.amountCents])).toEqual([
      ['option', 6_900],
      ['autre', 69_000],
    ]);
    expect(result.draftInvoices).toBe(2);
    // Le journal se lit seul : « aucune », jamais un null muet.
    expect(admin.recordTenantCreation).toHaveBeenCalledWith(
      ACTOR,
      String(tenantId),
      expect.objectContaining({ plan: 'aucune' }),
    );
  });

  it('module seul sur site existant : la pièce d’abonnement ne porte que le module', async () => {
    const { service, billing } = build({
      proposal: proposalDoc({
        plan: null,
        onlineOrdering: true,
        services: { ...EMPTY_SERVICES, integrationCommande: true },
      }),
    });
    await service.convert(ACTOR, LEAD_ID, BODY, NOW);
    // 79 € de module, 190 € d'intégration (mise en service COMPRISE) — et
    // jamais de pièce à 55 € ni d'abonnement de formule.
    const corps = billing.issue.mock.calls.map((c) => c[2] as Record<string, any>);
    expect(corps.map((c) => [c.kind, c.amountCents])).toEqual([
      ['abonnement', 7_900],
      ['autre', 19_000],
    ]);
    expect(corps[0]?.label).toContain('module commande en ligne');
  });

  it('la signature SURVIT à une facturation en panne — draftInvoices le dit', async () => {
    const { service, users } = build({ failIssue: true });
    const result = await service.convert(ACTOR, LEAD_ID, BODY, NOW);
    expect(users.create).toHaveBeenCalledOnce();
    expect(result.password).toMatch(/-/);
    expect(result.draftInvoices).toBe(0);
  });
});

describe('Réinitialiser le mot de passe gérant', () => {
  it('fabrique, hache, journalise — et rend le mot de passe une fois', async () => {
    const { service, users, admin } = build();
    const owner = {
      _id: new Types.ObjectId(),
      email: 'gerant@exemple.fr',
      sessionVersion: 'owner-v1',
    };
    users.findOne.mockReturnValue({ lean: () => Promise.resolve(owner) });

    const tenantId = new Types.ObjectId().toHexString();
    const result = await service.resetOwnerPassword(ACTOR, tenantId);

    expect(result.ownerEmail).toBe('gerant@exemple.fr');
    expect(result.password).toMatch(/^[a-z2-9]{4}-/);
    const update = users.updateOne.mock.calls[0]?.[1] as Record<string, any>;
    expect(update.$set.passwordHash).toBe(`empreinte(${result.password})`);
    expect(update.$set.sessionVersion).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(update.$set.sessionVersion).not.toBe(owner.sessionVersion);
    expect(admin.recordOwnerReset).toHaveBeenCalledWith(ACTOR, tenantId, 'gerant@exemple.fr');
  });

  it('404 sans compte gérant', async () => {
    const { service, users } = build();
    users.findOne.mockReturnValue({ lean: () => Promise.resolve(null) });
    await expect(service.resetOwnerPassword(ACTOR, new Types.ObjectId().toHexString())).rejects.toThrow(
      NotFoundException,
    );
  });
});

/**
 * L'OFFRE SIGNÉE SURVIT À LA SIGNATURE.
 *
 * Le lead porte le modèle complet : formule, module de commande en ligne,
 * services de l'Atelier, engagement mensuel ou annuel. Le devis l'honore, les
 * brouillons de facture aussi. Puis la conversion n'en gardait que la formule
 * et l'Atelier : le module et l'engagement disparaissaient — le champ
 * `onlineOrdering` n'existait même pas sur le tenant.
 *
 * Ce n'était pas un oubli d'affichage. En aval, TOUTE la facturation retombe
 * sur `tenant.plan` : le montant par défaut d'une facture, le MRR de la fiche,
 * la projection d'échéance, l'écran « Abonnement » du gérant, le MRR du parc.
 * Un client Complet avec le module était facturé 159 € au lieu de 238 €, et un
 * client sans formule n'avait jamais de prochaine échéance annoncée alors
 * qu'il payait tous les mois.
 */
describe('l’offre signée survit à la signature', () => {
  it('le module de commande en ligne est écrit sur le client', async () => {
    const { service, tenants } = build();
    await service.convert(ACTOR, LEAD_ID, { ...BODY, onlineOrdering: true }, NOW);
    const tenant = tenants.create.mock.calls[0]?.[0] as Record<string, any>;
    expect(tenant.onlineOrdering).toBe(true);
  });

  it('vendu sans le module, le client le dit aussi — false, jamais absent', async () => {
    const { service, tenants } = build({
      proposal: proposalDoc({ onlineOrdering: false }),
    });
    await service.convert(ACTOR, LEAD_ID, BODY, NOW);
    const tenant = tenants.create.mock.calls[0]?.[0] as Record<string, any>;
    expect(tenant.onlineOrdering).toBe(false);
  });

  it('l’engagement suit : c’est lui qui décide si l’on facture au mois ou à l’année', async () => {
    const { service, tenants } = build({ proposal: proposalDoc({ billing: 'annuel' }) });
    await service.convert(ACTOR, LEAD_ID, BODY, NOW);
    const tenant = tenants.create.mock.calls[0]?.[0] as Record<string, any>;
    expect(tenant.billingCycle).toBe('annuel');
  });

  it('sans formule mais avec le module greffé : les deux se lisent sur le client', async () => {
    const { service, tenants } = build({
      proposal: proposalDoc({
        plan: null,
        onlineOrdering: true,
        services: { ...EMPTY_SERVICES, integrationCommande: true },
      }),
    });
    await service.convert(ACTOR, LEAD_ID, BODY, NOW);
    const tenant = tenants.create.mock.calls[0]?.[0] as Record<string, any>;
    expect(tenant.plan).toBeNull();
    expect(tenant.onlineOrdering).toBe(true);
    expect(tenant.atelier).toMatchObject({ integrationCommande: true });
  });
});

/**
 * LA REMISE FONDATEUR EST DATÉE À LA SIGNATURE.
 *
 * `founderSeat` était un droit sans terme : le CRM promettait « tarif gelé à
 * vie » et rien ne l'appliquait. La règle du 27/08/2026 est une remise de 50 %
 * pendant douze mois — donc il lui faut une DATE DE FIN, posée au moment où le
 * contrat est signé et jamais recalculée après.
 *
 * Un booléen ne peut pas expirer. C'est toute la différence entre une remise
 * qui s'éteint toute seule et une dette perpétuelle qui pèse sur chaque
 * révision de grille.
 */
describe('la remise fondateur est datée', () => {
  it('signé avec une place fondateur : la remise court douze mois', async () => {
    const { service, tenants } = build({ founderSeatReserved: true });
    // Le body ment à `false` : seule la réservation persistée fait foi.
    await service.convert(ACTOR, LEAD_ID, { ...BODY, founderSeat: false }, NOW);
    const tenant = tenants.create.mock.calls[0]?.[0] as Record<string, any>;
    expect(tenant.founderSeat).toBe(true);
    // NOW = 2026-08-24T12:00:00Z
    expect((tenant.founderUntil as Date).toISOString()).toBe('2027-08-24T12:00:00.000Z');
  });

  it('signé sans place fondateur : aucune date, donc aucune remise', async () => {
    const { service, tenants } = build();
    // Le body ment à `true` : il ne peut pas s'octroyer une place.
    await service.convert(ACTOR, LEAD_ID, { ...BODY, founderSeat: true }, NOW);
    const tenant = tenants.create.mock.calls[0]?.[0] as Record<string, any>;
    expect(tenant.founderSeat).toBe(false);
    // `null` et non `undefined` : l'absence de remise se lit, elle ne se déduit pas.
    expect(tenant.founderUntil).toBeNull();
  });
});

/**
 * LES BROUILLONS DE SIGNATURE SUIVENT LA REMISE.
 *
 * Le devis promet moitié prix ; les premières factures doivent porter le même
 * montant, sinon le client reçoit une pièce qui contredit le document qu'il
 * vient de signer. C'est le genre d'écart qui se règle au téléphone, mal.
 */
describe('les premières factures d’un fondateur', () => {
  it('toutes les pièces sont à moitié prix', async () => {
    const services = { ...EMPTY_SERVICES, siteVitrine: true, presenceInternet: true };
    const { service, billing } = build({
      founderSeatReserved: true,
      proposal: proposalDoc({ services }),
    });
    await service.convert(ACTOR, LEAD_ID, BODY, NOW);
    const sansRemise = build({ proposal: proposalDoc({ services }) });
    await sansRemise.service.convert(ACTOR, LEAD_ID, BODY, NOW);
    const montants = (b: typeof billing) =>
      b.issue.mock.calls.map((c) => (c[2] as Record<string, any>).amountCents as number);
    const avec = montants(billing);
    const sans = montants(sansRemise.billing);
    expect(avec).toHaveLength(sans.length);
    avec.forEach((m, i) => expect(m).toBe(Math.round(sans[i]! / 2)));
  });

  it('le libellé dit la remise — une facture doit s’expliquer seule', async () => {
    const { service, billing } = build({ founderSeatReserved: true });
    await service.convert(ACTOR, LEAD_ID, BODY, NOW);
    const labels = billing.issue.mock.calls.map((c) => String((c[2] as Record<string, any>).label));
    expect(labels.some((l) => /fondateur/i.test(l))).toBe(true);
  });
});

/**
 * LES DIX PLACES, TENUES PAR LE SERVEUR.
 *
 * La landing les annonce, le CRM affiche le décompte — et rien n'empêchait d'en
 * signer une onzième. Une rareté qu'on vend doit être une rareté qu'on tient :
 * l'écart se découvre le jour où un client compte.
 */
describe('les dix places fondateur', () => {
  it('refuse la onzième, en nommant la raison', async () => {
    const { service } = build({
      founderSeatsTaken: FOUNDER_SEATS_TOTAL,
      founderSeatReserved: true,
    });
    await expect(service.convert(ACTOR, LEAD_ID, BODY)).rejects.toThrow(
      /places fondateur sont prises/,
    );
  });

  it('laisse passer la dixième', async () => {
    const { service } = build({
      founderSeatsTaken: FOUNDER_SEATS_TOTAL - 1,
      founderSeatReserved: true,
    });
    await expect(service.convert(ACTOR, LEAD_ID, BODY)).resolves.toMatchObject({
      slug: expect.any(String),
    });
  });

  it('un client ORDINAIRE passe même les places épuisées', async () => {
    const { service } = build({ founderSeatsTaken: 99 });
    await expect(service.convert(ACTOR, LEAD_ID, { ...BODY, founderSeat: true })).resolves.toMatchObject(
      { slug: expect.any(String) },
    );
  });
});
