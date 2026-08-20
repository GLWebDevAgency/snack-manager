import { describe, expect, it } from 'vitest';
import { Types, type Model } from 'mongoose';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import {
  EMPTY_BILLING_IDENTITY,
  EMPTY_PARTY,
  INVOICE_DISCOUNT_MENTION,
  INVOICE_LATE_PENALTY_MENTION,
  INVOICE_LEGAL_PLACEHOLDER,
  INVOICE_RECOVERY_FEE_MENTION,
  INVOICE_VAT_EXEMPT_MENTION,
  LEGACY_INVOICE_VAT,
  PLAN_MRR_CENTS,
  TenantBillingIdentitySchema,
  billingIdentityMismatch,
  buildInvoiceDocument,
  isFrenchVatShape,
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
  /**
   * `$set` À CHEMINS POINTÉS, comme Mongo — et surtout PAS un remplacement du
   * document. C'est la seule façon de faire échouer ici un service qui
   * écraserait `settings` ou `hours` en écrivant l'identité de facturation : la
   * doublure doit refuser ce que la production refuserait.
   */
  async updateOne(filter: Row, update: { $set: Record<string, unknown> }): Promise<void> {
    const row = this.rows.find((r) => matches(r, filter));
    if (!row) return;
    for (const [path, value] of Object.entries(update.$set)) {
      const keys = path.split('.');
      let target = row as Record<string, unknown>;
      for (const key of keys.slice(0, -1)) {
        if (typeof target[key] !== 'object' || target[key] === null) target[key] = {};
        target = target[key] as Record<string, unknown>;
      }
      target[keys[keys.length - 1]!] = value;
    }
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
    expect(fields).not.toContain('customer.name');
    // Le SIRET du CLIENT n'est pas une mention obligatoire : c'est celui de
    // l'émetteur que la loi exige. Le réclamer ferait croire au restaurateur
    // qu'il a mal rempli quelque chose.
    expect(fields).not.toContain('customer.siret');
  });

  /**
   * LE RÉGIME DE TVA N'EST PLUS UN TROU. Il fut un temps où il figurait dans
   * les manques, faute d'être stocké nulle part : la base ne portait qu'un
   * montant nu. Il est désormais décidé (`SM_INVOICE_VAT`) et figé sur chaque
   * pièce — il n'y a plus rien à collecter.
   */
  it('ne signale plus rien quand tout est renseigné', () => {
    const doc = buildInvoiceDocument(facture, ISSUER_COMPLET, CUSTOMER);
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

  it('lit l’identité de l’émetteur dans l’environnement, et rien de plus', () => {
    const config = new IssuerConfig(
      fakeConfig({
        SM_BILLING_ISSUER_NAME: 'SNACK MANAGER',
        SM_BILLING_ISSUER_SIRET: '90000000000012',
      }),
    );
    expect(config.issuer().name).toBe('SNACK MANAGER');
    // Ce qui n'est pas fourni vaut `null` et s'imprimera en emplacement vide —
    // jamais une valeur plausible.
    expect(config.issuer().rcs).toBeNull();
    expect(config.issuer().vatNumber).toBeNull();

    // Une chaîne vide n'est pas une identité : elle vaut absence.
    const vide = new IssuerConfig(fakeConfig({ SM_BILLING_ISSUER_NAME: '   ' }));
    expect(vide.issuer().name).toBeNull();
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
    const gros = buildInvoiceDocument(
      invoiceView(invoiceRow({ amountCents: 139_000 }) as never, NOW),
      EMPTY_PARTY,
      EMPTY_PARTY,
    );
    const milliers = renderInvoicePdf(gros).toString('latin1');
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
    expect(incomplet.gaps.map((g) => g.field)).toContain('issuer.siret');
    /*
     * L'IDENTITÉ DE L'ÉMETTEUR MANQUE, PAS LE RÉGIME DE TVA — et les deux ne se
     * traitent pas pareil. Le SIRET se CONSTATE : tant qu'il n'est pas fourni,
     * la facture porte un emplacement vide, parce qu'inventer un numéro
     * d'entreprise sur une pièce comptable est un faux. Le taux, lui, se
     * DÉCIDE, et la pièce le porte depuis son émission. Une facture peut donc
     * être ventilée juste tout en restant incomplète.
     */
    expect(incomplet.vat.baseCents).toBe(13_900);
    expect(incomplet.vat.totalCents).toBe(16_680);
  });
});

// ─────────────────────────────────────────────────────────────
// LE MONTANT DIT CE QU'IL EST
//
// C'est la réparation qui compte le plus dans ce module : `amountCents` était
// un nombre nu, et personne — ni le code, ni le PDF, ni le comptable — ne
// pouvait dire s'il était hors taxes. Les tests ci-dessous verrouillent les
// deux moitiés de la réponse : ce que porte une pièce émise depuis, et ce
// qu'on décide des pièces émises avant.
// ─────────────────────────────────────────────────────────────

describe('Hors taxes, TVA, toutes taxes comprises', () => {
  it('lit le taux FIGÉ SUR LA PIÈCE et ventile à partir de lui', () => {
    const vue = invoiceView(
      invoiceRow({ amountCents: 13_900, vat: { ratePercent: 20, amountsAre: 'ht' } }) as never,
      NOW,
    );
    expect(vue.totals.stamped).toBe(true);
    expect(vue.totals.basis).toBe('ht');
    expect([vue.totals.htCents, vue.totals.vatCents, vue.totals.ttcCents]).toEqual([
      13_900, 2_780, 16_680,
    ]);
    expect(vue.totals.ttcLabel).toBe('166,80 €');
  });

  /**
   * LE TAUX D'ÉPOQUE L'EMPORTE SUR LE TAUX COURANT. Une facture de 2025 émise
   * à 10 % reste à 10 % : la réimprimer au taux d'aujourd'hui fabriquerait une
   * seconde version d'une pièce déjà envoyée, peut-être payée, sûrement
   * déclarée.
   */
  it('n’applique JAMAIS le taux courant à une pièce qui en porte un autre', () => {
    const vue = invoiceView(
      invoiceRow({ amountCents: 10_000, vat: { ratePercent: 10, amountsAre: 'ht' } }) as never,
      NOW,
    );
    expect(vue.totals.ratePercent).toBe(10);
    expect(vue.totals.ttcCents).toBe(11_000);
  });

  /**
   * LES FACTURES DÉJÀ ÉMISES. Elles ne portent aucun taux — la base n'en
   * stockait pas. Le défaut documenté (`LEGACY_INVOICE_VAT`) dit sous quel
   * régime elles ont réellement été facturées, et la lecture SIGNALE qu'il
   * s'agit d'une reconstitution : `stamped` vaut `false`, un audit sait donc
   * toujours distinguer un taux lu d'un taux déduit.
   */
  it('traite les factures antérieures au champ par un défaut documenté, et le dit', () => {
    const ancienne = invoiceView(invoiceRow({ amountCents: 29_000 }) as never, NOW);
    expect(ancienne.totals.stamped).toBe(false);
    expect(ancienne.totals.ratePercent).toBe(LEGACY_INVOICE_VAT.ratePercent);
    expect(ancienne.totals.basis).toBe('ht');
    // 290 € de mise en place : du HT, donc 348 € réellement dus.
    expect(ancienne.totals.ttcCents).toBe(34_800);
  });

  /**
   * Un demi-marquage ne dit pas ce qu'est le montant : un taux sans assiette
   * laisse entière la question « 139 €, HT ou TTC ? ». Il vaut donc une
   * absence — et l'absence, elle, a une règle écrite.
   */
  it('refuse un marquage incomplet et retombe sur la règle écrite', () => {
    const bancale = invoiceView(
      invoiceRow({ vat: { ratePercent: 20, amountsAre: null } }) as never,
      NOW,
    );
    expect(bancale.totals.stamped).toBe(false);
    expect(bancale.totals.ratePercent).toBe(LEGACY_INVOICE_VAT.ratePercent);
  });

  it('ventile aussi un montant stocké TTC, sans perdre un centime', () => {
    const vue = invoiceView(
      invoiceRow({ amountCents: 9_999, vat: { ratePercent: 5.5, amountsAre: 'ttc' } }) as never,
      NOW,
    );
    expect(vue.totals.htCents + vue.totals.vatCents).toBe(9_999);
    expect(vue.totals.ttcCents).toBe(9_999);
  });

  /**
   * DEUX CHIFFRES, DEUX QUESTIONS. « Combien avons-nous gagné » se compte hors
   * taxes — la TVA n'est pas un revenu, elle est collectée pour l'État.
   * « Combien doit-il virer » se compte TTC. Les confondre, c'est soit gonfler
   * le chiffre d'affaires d'un cinquième, soit réclamer une somme qui ne solde
   * pas la facture.
   */
  it('sépare le reste dû HT (le revenu) du reste dû TTC (le virement)', async () => {
    const { invoices, tenants, service } = build();
    tenants.seed(tenantRow(CLASSFOOD));
    invoices.seed(
      invoiceRow({
        number: 'SM-2026-0001',
        status: 'envoyee',
        paidAt: null,
        method: null,
        dueAt: new Date('2026-09-01T00:00:00.000Z'),
        vat: { ratePercent: 20, amountsAre: 'ht' },
      }),
    );

    const mine = await service.mine(CLASSFOOD, TOUT, NOW);

    expect(mine.outstanding.totalDueCents).toBe(13_900);
    expect(mine.outstanding.totalDueTtcCents).toBe(16_680);
    expect(mine.outstanding.totalDueTtcLabel).toBe('166,80 €');
    expect(mine.nextDue?.amountCents).toBe(13_900);
    expect(mine.nextDue?.amountTtcCents).toBe(16_680);
  });

  it('projette l’échéance théorique au régime COURANT, TVA comprise', async () => {
    const { tenants, service } = build();
    tenants.seed(tenantRow(CLASSFOOD));
    const mine = await service.mine(CLASSFOOD, TOUT, NOW);
    // Aucune facture : le prochain prélèvement est une projection, sans numéro.
    expect(mine.nextDue?.invoiceNumber).toBeNull();
    expect(mine.nextDue?.amountCents).toBe(PLAN_MRR_CENTS.complet);
    expect(mine.nextDue?.amountTtcCents).toBe(16_680);
  });

  it('imprime les trois lignes sur le PDF, chiffrées', () => {
    const doc = buildInvoiceDocument(
      invoiceView(invoiceRow({ vat: { ratePercent: 20, amountsAre: 'ht' } }) as never, NOW),
      { ...EMPTY_PARTY, name: 'SNACK MANAGER' },
      { ...EMPTY_PARTY, name: "CLASS'FOOD" },
    );
    const rendu = renderInvoicePdf(doc).toString('latin1');
    expect(rendu).toContain('Total hors taxes');
    expect(rendu).toContain('139,00');
    // Le taux figure en toutes lettres, UNE fois : la ligne dit « TVA 20 % »,
    // pas « TVA (TVA 20 %) ».
    expect(rendu).toContain('TVA 20 %');
    expect(rendu).not.toContain('TVA \\(TVA');
    expect(rendu).toContain('27,80');
    expect(rendu).toContain('Total toutes taxes comprises');
    expect(rendu).toContain('166,80');
  });

  /**
   * CE QUE LE CLIENT VIRE, C'EST LE TTC. Annoncer « reste à régler 139,00 € »
   * ferait arriver un virement inférieur d'un cinquième, et la facture
   * resterait éternellement « partiellement réglée » pour une raison que
   * personne ne comprendrait au téléphone.
   */
  it('annonce le reste à régler en TTC, pas en HT', () => {
    const impayee = buildInvoiceDocument(
      invoiceView(
        invoiceRow({
          status: 'envoyee',
          paidAt: null,
          method: null,
          vat: { ratePercent: 20, amountsAre: 'ht' },
        }) as never,
        NOW,
      ),
      { ...EMPTY_PARTY, name: 'SNACK MANAGER' },
      { ...EMPTY_PARTY, name: "CLASS'FOOD" },
    );
    const rendu = renderInvoicePdf(impayee).toString('latin1');
    expect(rendu).toContain('Reste à régler : 166,80');
    expect(rendu).toContain('TTC');
  });
});

// ─────────────────────────────────────────────────────────────
// L'IDENTITÉ DE FACTURATION DU CLIENT
// ─────────────────────────────────────────────────────────────

describe('Identité de facturation du client', () => {
  const IDENTITE = {
    legalName: "CLASS'FOOD SARL",
    legalForm: 'SARL au capital de 10 000 €',
    // SIRET de démonstration, clé de Luhn valide.
    siret: '73282932000074',
    vatNumber: 'FR44732829320',
    address: '12 rue du Siège — 27000 Évreux',
    email: 'compta@classfood.fr',
  };

  const valide = (over: Partial<typeof IDENTITE> = {}) =>
    TenantBillingIdentitySchema.safeParse({ ...IDENTITE, ...over });

  it('accepte un SIRET et un numéro de TVA bien formés', () => {
    const parsed = valide();
    expect(parsed.success).toBe(true);
    expect(parsed.data?.siret).toBe('73282932000074');
  });

  it('refuse un SIRET dont la clé de contrôle ne tombe pas juste', () => {
    // Deux chiffres inversés : la forme reste bonne, la clé de Luhn non. C'est
    // exactement ce qui arrive à un numéro recopié depuis un Kbis.
    expect(valide({ siret: '73282932000047' }).success).toBe(false);
    expect(valide({ siret: '7328293200007' }).success).toBe(false);
    // Vide = « pas encore renseigné », jamais une erreur : on ne bloque pas un
    // restaurateur qui veut d'abord essayer le produit.
    expect(valide({ siret: '', vatNumber: '' }).success).toBe(true);
  });

  it('normalise les espaces d’un SIRET et la casse d’un numéro de TVA', () => {
    const parsed = valide({ siret: '732 829 320 00074', vatNumber: 'fr44 732829320' });
    expect(parsed.data?.siret).toBe('73282932000074');
    expect(parsed.data?.vatNumber).toBe('FR44732829320');
  });

  it('refuse un numéro de TVA dont la clé ne correspond pas au SIREN', () => {
    expect(valide({ vatNumber: 'FR99732829320' }).success).toBe(false);
    expect(isFrenchVatShape('FR44732829320')).toBe(true);
    // Les clés anciennes contiennent des lettres et ne se recalculent pas : on
    // vérifie la forme plutôt que de refuser un numéro valide.
    expect(isFrenchVatShape('FRK7732829320')).toBe(true);
  });

  /**
   * LA RÈGLE QUI SE VOIT LE MOINS À L'ŒIL NU. Un SIRET et un numéro de TVA qui
   * ne portent pas le même SIREN, c'est un copier-coller depuis le dossier d'un
   * autre client — et sur une facture, personne ne le remarquera jamais.
   */
  it('refuse un SIRET et un numéro de TVA qui ne désignent pas la même entreprise', async () => {
    const { tenants, service } = build();
    tenants.seed(tenantRow(CLASSFOOD));
    const parsed = TenantBillingIdentitySchema.parse({
      ...IDENTITE,
      vatNumber: 'FR40123456824',
    });
    expect(billingIdentityMismatch(parsed)).toMatch(/SIREN/);
    await expect(service.updateIdentity(CLASSFOOD, parsed)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('écrit champ par champ, sans toucher au reste de l’établissement', async () => {
    const { tenants, service } = build();
    const tenant = tenants.seed(tenantRow(CLASSFOOD));
    const parsed = TenantBillingIdentitySchema.parse(IDENTITE);

    await service.updateIdentity(CLASSFOOD, parsed);

    expect((tenant.billing as Record<string, unknown>).siret).toBe('73282932000074');
    // Le compte, la formule et l'adresse de l'établissement sont intacts : une
    // écriture large sur `tenants` est la façon dont on perd un réglage sans
    // s'en apercevoir.
    expect(tenant.plan).toBe('complet');
    expect(tenant.address).toContain('Perriers-sur-Andelle');
    expect((tenant.account as Record<string, unknown>).status).toBe('active');
  });

  it('rend l’identité saisie sur l’écran du gérant, et la dit modifiable', async () => {
    const { tenants, service } = build();
    tenants.seed(tenantRow(CLASSFOOD, { billing: { ...IDENTITE } }));
    const mine = await service.mine(CLASSFOOD, TOUT, NOW);
    expect(mine.identity.siret).toBe('73282932000074');
    expect(mine.identityEditable).toBe(true);
  });

  /**
   * Le compte suspendu garde l'ÉCRAN — c'est sa seule porte pour régulariser —
   * mais l'écriture repasse par le garde global, qui la refuse. L'écran le
   * sait d'avance plutôt que d'envoyer le gérant contre un 403 muet.
   */
  it('annonce le formulaire en lecture seule quand le compte est suspendu', async () => {
    const { tenants, service } = build();
    tenants.seed(tenantRow(CLASSFOOD, { account: { status: 'suspended', since: NOW } }));
    const mine = await service.mine(CLASSFOOD, TOUT, NOW);
    expect(mine.identityEditable).toBe(false);
  });

  it('n’invente rien : un établissement sans identité saisie n’en a pas', async () => {
    const { tenants, service } = build();
    tenants.seed(tenantRow(CLASSFOOD));
    const mine = await service.mine(CLASSFOOD, TOUT, NOW);
    expect(mine.identity).toEqual(EMPTY_BILLING_IDENTITY);
  });

  /**
   * LA RAISON SOCIALE SAISIE L'EMPORTE SUR L'ENSEIGNE, et l'adresse de
   * facturation sur celle du comptoir : c'est le gérant qui sait laquelle des
   * deux son comptable attend.
   */
  it('préfère ce que le gérant a saisi à ce que nous savions de lui', async () => {
    const { invoices, tenants, service } = build();
    tenants.seed(tenantRow(CLASSFOOD, { billing: { ...IDENTITE } }));
    const facture = invoices.seed(invoiceRow({ number: 'SM-2026-0001' }));

    const doc = await service.document(CLASSFOOD, String(facture._id), NOW);

    expect(doc.customer.name).toBe("CLASS'FOOD SARL");
    expect(doc.customer.address).toContain('rue du Siège');
    expect(doc.customer.siret).toBe('73282932000074');
    expect(doc.customer.vatNumber).toBe('FR44732829320');

    const rendu = renderInvoicePdf(doc).toString('latin1');
    expect(rendu).toContain('73282932000074');
    expect(rendu).toContain('FR44732829320');
  });

  /**
   * TANT QU'IL N'A RIEN SAISI, on imprime ce qu'on SAIT — son enseigne et
   * l'adresse de son établissement — et rien de plus. Une adresse
   * d'établissement exacte vaut mieux qu'un emplacement vide ; un SIRET
   * inventé ne vaut rien du tout.
   */
  it('retombe sur l’enseigne et l’adresse de l’établissement, sans combler le reste', async () => {
    const { invoices, tenants, service } = build();
    tenants.seed(tenantRow(CLASSFOOD));
    const facture = invoices.seed(invoiceRow({ number: 'SM-2026-0001' }));

    const doc = await service.document(CLASSFOOD, String(facture._id), NOW);

    expect(doc.customer.name).toBe("CLASS'FOOD");
    expect(doc.customer.address).toContain('Perriers-sur-Andelle');
    expect(doc.customer.siret).toBeNull();
    expect(doc.customer.vatNumber).toBeNull();
    // Et le PDF ne réclame RIEN au client : ce sont les mentions de l'ÉMETTEUR
    // qui sont obligatoires. Le seul « SIRET : [À COMPLÉTER] » de la page est
    // donc celui du bloc émetteur — le bloc client n'en ajoute pas un second,
    // qui ferait croire au restaurateur qu'il a mal rempli quelque chose.
    const rendu = renderInvoicePdf(doc).toString('latin1');
    expect(rendu.split('SIRET : [')).toHaveLength(2);
  });
});
