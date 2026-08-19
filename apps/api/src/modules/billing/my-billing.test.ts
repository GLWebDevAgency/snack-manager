import { describe, expect, it } from 'vitest';
import { Types, type Model } from 'mongoose';
import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import {
  EMPTY_PARTY,
  INVOICE_DISCOUNT_MENTION,
  INVOICE_LATE_PENALTY_MENTION,
  INVOICE_LEGAL_PLACEHOLDER,
  INVOICE_RECOVERY_FEE_MENTION,
  INVOICE_VAT_EXEMPT_MENTION,
  PLAN_MRR_CENTS,
  buildInvoiceDocument,
  invoiceVat,
  invoiceView,
  isTenantVisibleInvoice,
  type BillingHistoryQuery,
  type InvoiceParty,
  type JwtPayload,
} from '@sm/contracts';
import type { Invoice, Tenant } from '@sm/db';
import { IssuerConfig } from './issuer.config';
import { MyBillingService } from './my-billing.service';
import { TenantSessionGuard } from './tenant-session.guard';
import { renderInvoicePdf } from './invoice-pdf';

// ─────────────────────────────────────────────────────────────
// Doublures — strictement le vocabulaire que le service emploie.
//
// Une doublure qui accepterait davantage que le vrai modèle laisserait passer
// un appel impossible en production. Celles-ci ne savent faire que ce que
// `MyBillingService` demande : `find({...}).sort().limit().lean()`,
// `findOne().lean()`, `findById().lean()`.
// ─────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

const same = (a: unknown, b: unknown): boolean => String(a) === String(b);

function matches(row: Row, filter: Row): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = row[key];
    if (expected && typeof expected === 'object' && '$in' in (expected as object)) {
      return (expected as { $in: unknown[] }).$in.some((candidate) => same(actual, candidate));
    }
    return same(actual, expected);
  });
}

class FakeQuery {
  constructor(private rows: Row[]) {}
  sort(spec: Record<string, 1 | -1>): this {
    const criteria = Object.entries(spec);
    this.rows = [...this.rows].sort((a, b) => {
      for (const [key, direction] of criteria) {
        const left = a[key];
        const right = b[key];
        const delta =
          left instanceof Date || right instanceof Date
            ? Number(new Date(left as Date)) - Number(new Date(right as Date))
            : String(left).localeCompare(String(right));
        if (delta !== 0) return delta * (direction === -1 ? -1 : 1);
      }
      return 0;
    });
    return this;
  }
  limit(n: number): this {
    this.rows = this.rows.slice(0, n);
    return this;
  }
  async lean(): Promise<Row[]> {
    return this.rows;
  }
}

class FakeOne {
  constructor(private readonly row: Row | null) {}
  async lean(): Promise<Row | null> {
    return this.row;
  }
}

class FakeInvoices {
  readonly rows: Row[] = [];
  seed(row: Row): Row {
    this.rows.push(row);
    return row;
  }
  find(filter: Row = {}): FakeQuery {
    return new FakeQuery(this.rows.filter((r) => matches(r, filter)).map((r) => ({ ...r })));
  }
  findOne(filter: Row): FakeOne {
    const row = this.rows.find((r) => matches(r, filter));
    return new FakeOne(row ? { ...row } : null);
  }
  asModel(): Model<Invoice> {
    return this as unknown as Model<Invoice>;
  }
}

class FakeTenants {
  readonly rows: Row[] = [];
  seed(row: Row): Row {
    this.rows.push(row);
    return row;
  }
  findById(id: unknown): FakeOne {
    const row = this.rows.find((r) => same(r._id, id));
    return new FakeOne(row ? { ...row } : null);
  }
  asModel(): Model<Tenant> {
    return this as unknown as Model<Tenant>;
  }
}

/** `ConfigService` réduit à ce qu'`IssuerConfig` lui demande : `get(key)`. */
const fakeConfig = (values: Record<string, string> = {}): ConfigService =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

// ─────────────────────────────────────────────────────────────

const CLASSFOOD = '65f000000000000000000001';
const VOISIN = '65f000000000000000000002';
const NOW = new Date('2026-09-15T10:00:00.000Z');
const TOUT = { limit: 200 } satisfies BillingHistoryQuery;

const invoiceRow = (over: Row = {}): Row => ({
  _id: new Types.ObjectId(),
  tenantId: CLASSFOOD,
  number: 'SM-2026-0002',
  kind: 'abonnement',
  label: 'Abonnement Complet — septembre 2026',
  period: { start: new Date('2026-09-01T00:00:00.000Z'), end: new Date('2026-09-30T23:59:59.999Z') },
  amountCents: PLAN_MRR_CENTS.complet,
  status: 'payee',
  issuedAt: new Date('2026-09-01T00:00:00.000Z'),
  dueAt: new Date('2026-09-01T00:00:00.000Z'),
  paidAt: new Date('2026-09-01T00:00:00.000Z'),
  method: 'prelevement',
  cancelledAt: null,
  cancelReason: '',
  ...over,
});

const tenantRow = (id: string, over: Row = {}): Row => ({
  _id: id,
  slug: id === CLASSFOOD ? 'classfood' : 'voisin',
  name: id === CLASSFOOD ? "CLASS'FOOD" : 'LE VOISIN',
  address: '63 rue du Général de Gaulle — 27910 Perriers-sur-Andelle',
  plan: 'complet',
  founderSeat: true,
  account: { status: 'active', since: NOW, reason: '', suspendedAt: null },
  createdAt: new Date('2026-07-20T00:00:00.000Z'),
  ...over,
});

function build(config: Record<string, string> = {}) {
  const invoices = new FakeInvoices();
  const tenants = new FakeTenants();
  const service = new MyBillingService(
    invoices.asModel(),
    tenants.asModel(),
    new IssuerConfig(fakeConfig(config)),
  );
  return { invoices, tenants, service };
}

// ─────────────────────────────────────────────────────────────

describe('Abonnement du gérant — isolation', () => {
  it('ne rend QUE les factures du tenant demandé', async () => {
    const { invoices, tenants, service } = build();
    tenants.seed(tenantRow(CLASSFOOD));
    tenants.seed(tenantRow(VOISIN));
    invoices.seed(invoiceRow({ number: 'SM-2026-0001' }));
    invoices.seed(invoiceRow({ tenantId: VOISIN, number: 'SM-2026-0099' }));

    const mine = await service.mine(CLASSFOOD, TOUT, NOW);

    expect(mine.invoices.map((i) => i.number)).toEqual(['SM-2026-0001']);
    expect(mine.invoices.every((i) => i.tenantId === CLASSFOOD)).toBe(true);
  });

  /**
   * LE TEST QUI COMPTE. Une facture est une donnée financière : connaître son
   * identifiant — il suffit de l'avoir vu passer dans le back-office interne —
   * ne doit pas suffire à l'ouvrir depuis le compte d'un autre restaurant.
   */
  it('refuse d’ouvrir la facture d’un autre établissement, même avec son identifiant exact', async () => {
    const { invoices, tenants, service } = build();
    tenants.seed(tenantRow(CLASSFOOD));
    tenants.seed(tenantRow(VOISIN));
    const chezLeVoisin = invoices.seed(invoiceRow({ tenantId: VOISIN, number: 'SM-2026-0099' }));

    // Le voisin, lui, la lit sans difficulté : la pièce existe bel et bien.
    await expect(service.document(VOISIN, String(chezLeVoisin._id), NOW)).resolves.toMatchObject({
      number: 'SM-2026-0099',
    });

    await expect(service.document(CLASSFOOD, String(chezLeVoisin._id), NOW)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('répond 404 — et non 403 — sur une facture inconnue : son existence ne se déduit pas', async () => {
    const { tenants, service } = build();
    tenants.seed(tenantRow(CLASSFOOD));
    await expect(
      service.document(CLASSFOOD, '65f0000000000000000000ff', NOW),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.document(CLASSFOOD, 'pas-un-identifiant', NOW)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('Abonnement du gérant — le garde', () => {
  const context = (authorization?: string): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ headers: { authorization } }) }),
    }) as unknown as ExecutionContext;

  const guardFor = (payload: JwtPayload | Error): TenantSessionGuard =>
    new TenantSessionGuard({
      verifyAsync: async () => {
        if (payload instanceof Error) throw payload;
        return payload;
      },
    } as unknown as JwtService);

  const OWNER: JwtPayload = { sub: 'u1', tenantId: CLASSFOOD, role: 'owner', kind: 'user' };

  /**
   * LE CAS QUI JUSTIFIE TOUT CE GARDE. Le garde global refuse un établissement
   * suspendu à chaque requête ; celui-ci ne lit PAS le statut de compte, et
   * c'est délibéré : sans facture, le gérant suspendu n'a plus ni le numéro de
   * pièce ni le montant pour régulariser.
   */
  it('laisse passer un gérant dont le compte est suspendu', async () => {
    const guard = guardFor(OWNER);
    const req = { headers: { authorization: 'Bearer jeton' } } as { headers: Record<string, string> };
    const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect((req as unknown as { user: JwtPayload }).user.tenantId).toBe(CLASSFOOD);
  });

  it('refuse une session de tablette (PIN) : la caisse du comptoir n’est pas le bureau du patron', async () => {
    const staff: JwtPayload = { sub: 's1', tenantId: CLASSFOOD, role: 'gerant', kind: 'staff' };
    await expect(guardFor(staff).canActivate(context('Bearer jeton'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuse l’équipe Snack Manager : son jeton ne porte aucun établissement', async () => {
    const sm: JwtPayload = { sub: 'a1', tenantId: null, role: 'sm_admin', kind: 'user' };
    await expect(guardFor(sm).canActivate(context('Bearer jeton'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuse un jeton absent, illisible, ou dont le tenant n’est pas castable', async () => {
    await expect(guardFor(OWNER).canActivate(context(undefined))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      guardFor(new Error('signature invalide')).canActivate(context('Bearer jeton')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    const forge: JwtPayload = { sub: 'u1', tenantId: '../autre', role: 'owner', kind: 'user' };
    await expect(guardFor(forge).canActivate(context('Bearer jeton'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

describe('Abonnement du gérant — la vue', () => {
  it('masque les brouillons : une pièce jamais envoyée n’existe pas pour le client', async () => {
    const { invoices, tenants, service } = build();
    tenants.seed(tenantRow(CLASSFOOD));
    const brouillon = invoices.seed(
      invoiceRow({ number: 'SM-2026-0007', status: 'brouillon', issuedAt: null, paidAt: null }),
    );
    invoices.seed(invoiceRow({ number: 'SM-2026-0001' }));

    const mine = await service.mine(CLASSFOOD, TOUT, NOW);
    expect(mine.invoices.map((i) => i.number)).toEqual(['SM-2026-0001']);
    await expect(service.document(CLASSFOOD, String(brouillon._id), NOW)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('garde une facture annulée APRÈS émission, écarte celle annulée avant', () => {
    expect(isTenantVisibleInvoice({ storedStatus: 'annulee', issuedAt: '2026-09-01' })).toBe(true);
    expect(isTenantVisibleInvoice({ storedStatus: 'annulee', issuedAt: null })).toBe(false);
    expect(isTenantVisibleInvoice({ storedStatus: 'brouillon', issuedAt: null })).toBe(false);
    expect(isTenantVisibleInvoice({ storedStatus: 'payee', issuedAt: null })).toBe(true);
  });

  /**
   * `limit` tronque l'AFFICHAGE, jamais la dette. C'est le chiffre que le
   * gérant règle : le voir rétrécir parce qu'on a demandé moins de lignes
   * serait un mensonge coûteux.
   */
  it('calcule l’ardoise sur toutes les impayées, même quand l’historique est tronqué', async () => {
    const { invoices, tenants, service } = build();
    tenants.seed(tenantRow(CLASSFOOD));
    for (let i = 0; i < 5; i += 1) {
      invoices.seed(
        invoiceRow({
          number: `SM-2026-000${i + 1}`,
          status: 'envoyee',
          paidAt: null,
          method: null,
          dueAt: new Date(Date.UTC(2026, 4 + i, 1)),
        }),
      );
    }

    const mine = await service.mine(CLASSFOOD, { limit: 1 }, NOW);

    expect(mine.invoices).toHaveLength(1);
    expect(mine.outstanding.invoices).toBe(5);
    expect(mine.outstanding.totalDueCents).toBe(5 * PLAN_MRR_CENTS.complet);
    // La prochaine échéance est la plus VIEILLE créance, pas la plus récente.
    expect(mine.nextDue?.invoiceNumber).toBe('SM-2026-0001');
  });

  it('rend la formule, la place fondateur et le statut de compte', async () => {
    const { tenants, service } = build();
    tenants.seed(tenantRow(CLASSFOOD, { account: { status: 'suspended', since: NOW } }));

    const mine = await service.mine(CLASSFOOD, TOUT, NOW);

    expect(mine.subscription.planLabel).toBe('Complet');
    expect(mine.subscription.mrrCents).toBe(PLAN_MRR_CENTS.complet);
    expect(mine.subscription.founderSeat).toBe(true);
    expect(mine.subscription.accessBlocked).toBe(true);
    // Un compte suspendu reste FACTURABLE : c'est parce qu'il doit de l'argent
    // qu'il est suspendu, et cesser de facturer reviendrait à effacer la dette.
    expect(mine.subscription.billable).toBe(true);
    expect(mine.tenant.slug).toBe('classfood');
  });

  it('donne la même vue d’une facture que la fiche de l’équipe (statut recalculé)', () => {
    const enRetard = invoiceView(
      invoiceRow({ status: 'envoyee', paidAt: null, method: null }) as never,
      new Date('2026-10-05T00:00:00.000Z'),
    );
    expect(enRetard.status).toBe('en_retard');
    expect(enRetard.storedStatus).toBe('envoyee');
    expect(enRetard.overdueDays).toBe(34);
    expect(enRetard.dueCents).toBe(PLAN_MRR_CENTS.complet);
  });
});

describe('Mentions légales', () => {
  const CUSTOMER: InvoiceParty = { ...EMPTY_PARTY, name: "CLASS'FOOD", address: 'Perriers-sur-Andelle' };
  const ISSUER_COMPLET: InvoiceParty = {
    ...EMPTY_PARTY,
    name: 'SNACK MANAGER',
    address: '1 rue de la Gare — 27000 Évreux',
    siret: '90000000000012',
    vatNumber: 'FR00900000000',
  };

  const facture = invoiceView(invoiceRow() as never, NOW);

  it('signale ce qui manque au lieu de l’inventer', () => {
    const doc = buildInvoiceDocument(facture, EMPTY_PARTY, { ...EMPTY_PARTY, name: 'X' });
    const fields = doc.gaps.map((g) => g.field);
    expect(fields).toContain('issuer.name');
    expect(fields).toContain('issuer.siret');
    expect(fields).toContain('issuer.vatNumber');
    expect(fields).toContain('issuer.address');
    expect(fields).toContain('customer.address');
    expect(fields).toContain('vat.regime');
    expect(fields).not.toContain('customer.name');
  });

  it('ne signale plus rien quand tout est renseigné', () => {
    const doc = buildInvoiceDocument(facture, ISSUER_COMPLET, CUSTOMER, {
      ratePercent: 20,
      amountsAre: 'ht',
    });
    expect(doc.gaps).toEqual([]);
    expect(doc.vat.baseCents).toBe(13_900);
    expect(doc.vat.vatCents).toBe(2_780);
    expect(doc.vat.totalCents).toBe(16_680);
  });

  it('porte les quatre mentions de règlement obligatoires', () => {
    const doc = buildInvoiceDocument(facture, ISSUER_COMPLET, CUSTOMER);
    expect(doc.settlement).toContain(INVOICE_LATE_PENALTY_MENTION);
    expect(doc.settlement).toContain(INVOICE_RECOVERY_FEE_MENTION);
    expect(doc.settlement).toContain(INVOICE_DISCOUNT_MENTION);
    expect(doc.settlement[0]).toContain('01/09/2026');
  });

  it('ne devine JAMAIS la ventilation de TVA', () => {
    const inconnu = invoiceVat(13_900);
    expect(inconnu.known).toBe(false);
    expect(inconnu.baseCents).toBeNull();
    expect(inconnu.vatCents).toBeNull();
    expect(inconnu.totalCents).toBeNull();
    expect(inconnu.mention).toContain(INVOICE_LEGAL_PLACEHOLDER);

    // Taux connu mais assiette non déclarée : toujours pas de calcul.
    const partiel = invoiceVat(13_900, { ratePercent: 20, amountsAre: null });
    expect(partiel.known).toBe(false);
    expect(partiel.baseCents).toBeNull();
  });

  it('ventile juste, dans les deux sens, sans jamais perdre un centime', () => {
    const ht = invoiceVat(13_900, { ratePercent: 20, amountsAre: 'ht' });
    expect([ht.baseCents, ht.vatCents, ht.totalCents]).toEqual([13_900, 2_780, 16_680]);

    const ttc = invoiceVat(13_900, { ratePercent: 20, amountsAre: 'ttc' });
    expect(ttc.baseCents! + ttc.vatCents!).toBe(13_900);
    expect(ttc.totalCents).toBe(13_900);

    // Taux à décimale, montant qui ne tombe pas rond : la somme reste exacte.
    const bancal = invoiceVat(9_999, { ratePercent: 5.5, amountsAre: 'ttc' });
    expect(bancal.baseCents! + bancal.vatCents!).toBe(9_999);
  });

  it('reconnaît la franchise en base et rend la mention de l’article 293 B', () => {
    const franchise = invoiceVat(13_900, { ratePercent: 0, amountsAre: null });
    expect(franchise.known).toBe(true);
    expect(franchise.vatCents).toBe(0);
    expect(franchise.baseCents).toBe(franchise.totalCents);
    expect(franchise.mention).toBe(INVOICE_VAT_EXEMPT_MENTION);
  });

  it('remonte les manques au gérant sur son écran', async () => {
    const { tenants, service } = build();
    tenants.seed(tenantRow(CLASSFOOD));
    const mine = await service.mine(CLASSFOOD, TOUT, NOW);
    expect(mine.legalGaps.map((g) => g.field)).toContain('issuer.siret');
    // L'adresse de l'établissement est connue : elle ne figure pas au rapport.
    expect(mine.legalGaps.map((g) => g.field)).not.toContain('customer.address');
  });

  it('lit le régime de TVA et l’identité de l’émetteur dans l’environnement', () => {
    const config = new IssuerConfig(
      fakeConfig({
        SM_BILLING_ISSUER_NAME: 'SNACK MANAGER',
        SM_BILLING_ISSUER_SIRET: '90000000000012',
        SM_BILLING_VAT_RATE: '20',
        SM_BILLING_AMOUNTS: 'HT',
      }),
    );
    expect(config.issuer().name).toBe('SNACK MANAGER');
    expect(config.issuer().rcs).toBeNull();
    expect(config.vat()).toEqual({ ratePercent: 20, amountsAre: 'ht' });

    // Une valeur illisible vaut une absence : jamais un zéro silencieux, qui
    // ferait passer une entreprise assujettie pour une franchise en base.
    const bancal = new IssuerConfig(fakeConfig({ SM_BILLING_VAT_RATE: 'vingt pour cent' }));
    expect(bancal.vat().ratePercent).toBeNull();
  });
});

describe('Rendu PDF', () => {
  const doc = buildInvoiceDocument(
    invoiceView(invoiceRow() as never, NOW),
    {
      ...EMPTY_PARTY,
      name: 'SNACK MANAGER',
      address: '1 rue de la Gare — 27000 Évreux',
      siret: '90000000000012',
      vatNumber: 'FR00900000000',
    },
    { ...EMPTY_PARTY, name: "CLASS'FOOD", address: 'Perriers-sur-Andelle' },
    { ratePercent: 20, amountsAre: 'ht' },
  );

  const pdf = renderInvoicePdf(doc);
  const text = pdf.toString('latin1');

  it('produit un PDF structurellement valide', () => {
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('/Type /Page');
    // Le décalage annoncé par `startxref` doit tomber sur la table elle-même.
    const startxref = Number(text.slice(text.lastIndexOf('startxref') + 9).trim().split('\n')[0]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    // La longueur déclarée du flux doit valoir sa longueur réelle.
    const declared = Number(/\/Length (\d+)/.exec(text)![1]);
    const start = text.indexOf('stream\n') + 'stream\n'.length;
    expect(text.indexOf('\nendstream') - start).toBe(declared);
  });

  it('imprime les mentions obligatoires françaises', () => {
    for (const attendu of [
      'FACTURE',
      'SM-2026-0002',
      'SNACK MANAGER',
      '90000000000012',
      'FR00900000000',
      'CLASS',
      'Perriers-sur-Andelle',
      '01/09/2026',
      'Total hors taxes',
      'TVA',
      'Total toutes taxes comprises',
      'Conditions de r',
      'nalit',
      '40',
    ]) {
      expect(text).toContain(attendu);
    }
  });

  it('écrit les accents et le symbole € en CP1252, pas en UTF-8', () => {
    // « Échéance » : É = 0xC9, é = 0xE9 en WinAnsi. En UTF-8 ils occuperaient
    // deux octets et le lecteur afficherait « Ã‰chÃ©ance ».
    expect(text).toContain('Échéance');
    expect(text).toContain(''); // € — 0x80 en CP1252
    expect(text).not.toContain('Ã©');
    // L'espace fine des milliers ne doit jamais sortir en « ? » dans un montant.
    const milliers = renderInvoicePdf({ ...doc, amountCents: 139_000 }).toString('latin1');
    expect(milliers).toContain('1 390,00 ');
  });

  it('imprime un emplacement là où la mention manque, et le dit en bas de page', () => {
    const incomplet = buildInvoiceDocument(
      invoiceView(invoiceRow() as never, NOW),
      EMPTY_PARTY,
      { ...EMPTY_PARTY, name: "CLASS'FOOD" },
    );
    const rendu = renderInvoicePdf(incomplet).toString('latin1');
    expect(rendu).toContain('COMPL');
    expect(rendu).toContain('Mentions obligatoires');
    // Aucun montant hors taxes n'est fabriqué tant que le régime est inconnu.
    expect(incomplet.vat.baseCents).toBeNull();
  });
});
