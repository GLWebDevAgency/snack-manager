import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Types, type Model } from 'mongoose';
import {
  ADMIN_LOG_ACTION_LABELS,
  INSTALL_FEE_CENTS,
  INVOICE_LOG_ACTIONS,
  INVOICE_PAYMENT_METHODS,
  INVOICE_STATUSES,
  NO_OUTSTANDING,
  PLAN_MRR_CENTS,
  billingPeriod,
  effectiveInvoiceStatus,
  formatEuros,
  formatFrDate,
  formatInvoiceNumber,
  invoiceCounterId,
  isInvoiceNumberShape,
  monthKey,
  paiementAxis,
  shiftMonthKey,
  summarizeOutstanding,
  type BillingHistoryQuery,
  type CrmInvoice,
  type InvoiceIssue,
  type JwtPayload,
} from '@sm/contracts';
import type { AdminLog, Counter, Invoice, Tenant, User } from '@sm/db';
import { AdminService } from './admin.service';
import { BillingService } from './billing.service';
import { FakeCollection, type Row } from './admin.fakes';

// ─────────────────────────────────────────────────────────────
// Doublures propres à la facturation.
//
// `admin.fakes` suffit pour les tenants, le journal et les comptes d'équipe :
// `AdminService` et `BillingService` leur parlent le même vocabulaire étroit.
// Les FACTURES et le COMPTEUR, eux, exigent deux choses que cette doublure ne
// sait pas faire — un filtre `$in`, un chemin pointé `period.start`, et un
// `$inc` avec `upsert`. Les rejouer ici plutôt que d'élargir la doublure
// commune évite de laisser passer, ailleurs, un appel impossible en production.
// ─────────────────────────────────────────────────────────────

const deep = (row: Row, path: string): unknown =>
  path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, row);

const same = (a: unknown, b: unknown): boolean => String(a) === String(b);

function matches(row: Row, filter: Row): boolean {
  return Object.entries(filter).every(([key, expected]) => {
    const actual = deep(row, key);
    if (expected && typeof expected === 'object' && '$in' in (expected as object)) {
      const list = (expected as { $in: unknown[] }).$in;
      return list.some((candidate) => same(actual, candidate));
    }
    // `$ne` : le filtre des créances écarte les avoirs (`kind: { $ne: 'avoir' }`).
    if (expected && typeof expected === 'object' && '$ne' in (expected as object)) {
      return !same(actual, (expected as { $ne: unknown }).$ne);
    }
    return same(actual, expected);
  });
}

function order(rows: Row[], spec: Record<string, 1 | -1>): Row[] {
  const criteria = Object.entries(spec);
  return [...rows].sort((a, b) => {
    for (const [key, direction] of criteria) {
      const left = deep(a, key);
      const right = deep(b, key);
      const delta =
        left instanceof Date || right instanceof Date
          ? Number(new Date(left as Date)) - Number(new Date(right as Date))
          : String(left).localeCompare(String(right));
      if (delta !== 0) return delta * (direction === -1 ? -1 : 1);
    }
    return 0;
  });
}

class FakeQuery {
  constructor(private rows: Row[]) {}
  sort(spec: Record<string, 1 | -1>): this {
    this.rows = order(this.rows, spec);
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

/** Collection de factures : exactement ce que `BillingService` lui demande. */
class FakeInvoices {
  readonly rows: Row[] = [];
  /** Arme un échec d'écriture — sert à vérifier la restitution du numéro. */
  failNextCreate = false;

  async countDocuments(filter: Row = {}): Promise<number> {
    return this.rows.filter((r) => matches(r, filter)).length;
  }

  find(filter: Row = {}): FakeQuery {
    return new FakeQuery(this.rows.filter((r) => matches(r, filter)).map((r) => ({ ...r })));
  }

  findOne(filter: Row): FakeOne {
    const row = this.rows.find((r) => matches(r, filter));
    return new FakeOne(row ? { ...row } : null);
  }

  findOneAndUpdate(filter: Row, update: { $set?: Row; $push?: Row }): FakeOne {
    const row = this.rows.find((r) => matches(r, filter));
    if (!row) return new FakeOne(null);
    Object.assign(row, update.$set ?? {});
    // `$push` ajoute en fin de tableau, comme Mongo — c'est l'écriture des
    // relances, et une doublure qui l'écraserait masquerait la perte d'une
    // relance concurrente.
    for (const [key, value] of Object.entries(update.$push ?? {})) {
      const list = Array.isArray(row[key]) ? (row[key] as unknown[]) : [];
      list.push(value);
      row[key] = list;
    }
    return new FakeOne({ ...row });
  }

  async create(doc: Row): Promise<{ toObject: () => Row }> {
    if (this.failNextCreate) {
      this.failNextCreate = false;
      throw new Error('écriture refusée par le moteur');
    }
    const created: Row = { _id: new Types.ObjectId(), ...doc };
    this.rows.push(created);
    return { toObject: () => ({ ...created }) };
  }

  asModel(): Model<Invoice> {
    return this as unknown as Model<Invoice>;
  }
}

/** Compteur de séquence : `$inc` atomique avec `upsert`, et rien d'autre. */
class FakeCounters {
  readonly rows: Row[] = [];

  findOneAndUpdate(
    filter: Row,
    update: { $inc?: Record<string, number> },
    options?: { upsert?: boolean },
  ): Promise<Row | null> {
    let row = this.rows.find((r) => matches(r, filter));
    if (!row) {
      if (!options?.upsert) return Promise.resolve(null);
      row = { _id: filter._id, seq: 0 };
      this.rows.push(row);
    }
    for (const [key, delta] of Object.entries(update.$inc ?? {})) {
      row[key] = Number(row[key] ?? 0) + delta;
    }
    return Promise.resolve({ ...row });
  }

  seqOf(id: string): number {
    return Number(this.rows.find((r) => r._id === id)?.seq ?? 0);
  }

  asModel(): Model<Counter> {
    return this as unknown as Model<Counter>;
  }
}

// ─────────────────────────────────────────────────────────────

const CLASSFOOD = '65f000000000000000000001';
const VOISIN = '65f000000000000000000002';

const SM: JwtPayload = {
  sub: '65f00000000000000000ff01',
  tenantId: null,
  role: 'sm_admin',
  kind: 'user',
};

const TOUT = { limit: 200 } satisfies BillingHistoryQuery;
/**
 * Le tarif de Class'Food, LU DANS LA GRILLE et jamais recopié.
 *
 * Les phrases attendues plus bas s'écrivent donc `formatEuros(MRR)` et non
 * « 159,00 € » : la révision du 21/08/2026 (89/139/189 → 99/159/199) a fait
 * tomber une douzaine de cas qui ne disaient pourtant rien de faux, et un test
 * qui casse à chaque revision de prix est un test qu'on désactive un jour de
 * rush. Que `formatEuros` écrive bien « 159,00 € » se vérifie une fois pour
 * toutes dans « Rédaction », sur un montant arbitraire.
 */
const MRR = PLAN_MRR_CENTS.complet;

/** Corps d'émission par défaut — ce que la validation zod produit d'un `{}`. */
const emission = (over: Partial<InvoiceIssue> = {}): InvoiceIssue => ({
  kind: 'abonnement',
  label: '',
  draft: false,
  ...over,
});

describe('Facturation', () => {
  let tenants: FakeCollection;
  let logs: FakeCollection;
  let users: FakeCollection;
  let invoices: FakeInvoices;
  let counters: FakeCounters;
  let billing: BillingService;
  /** Le journal se relit AVEC son service : c'est lui qui rend les libellés. */
  let admin: AdminService;

  /** Un instant fixe : tout le raisonnement de cette surface porte sur le temps. */
  const LE_19_AOUT = new Date('2026-08-19T10:00:00Z');

  beforeEach(() => {
    tenants = new FakeCollection('tenant');
    logs = new FakeCollection('log');
    users = new FakeCollection('user');
    invoices = new FakeInvoices();
    counters = new FakeCounters();

    tenants.seed({
      _id: CLASSFOOD,
      slug: 'classfood',
      name: "Class'Food",
      plan: 'complet',
      founderSeat: true,
      account: { status: 'active', since: new Date('2026-08-18T15:06:44Z'), reason: '' },
      createdAt: new Date('2026-08-18T15:06:44Z'),
    });
    tenants.seed({
      _id: VOISIN,
      slug: 'voisin',
      name: 'Le Voisin',
      plan: 'essentiel',
      account: { status: 'active', since: new Date('2026-05-02T09:00:00Z'), reason: '' },
      createdAt: new Date('2026-05-02T09:00:00Z'),
    });
    users.seed({ _id: SM.sub, email: 'admin@snackmanager.fr' });

    admin = new AdminService(
      tenants.asModel<Tenant>(),
      new FakeCollection('device').asModel(),
      new FakeCollection('screen').asModel(),
      logs.asModel<AdminLog>(),
      users.asModel<User>(),
    );

    billing = new BillingService(
      invoices.asModel(),
      tenants.asModel<Tenant>(),
      counters.asModel(),
      admin,
    );
  });

  /**
   * Neutralise l'amorce de démonstration : ces tests écrivent leur propre
   * histoire. Une lecture la déclenche (et la mémorise, donc elle ne repartira
   * pas), puis on remet les trois collections à zéro.
   */
  const sansAmorce = async () => {
    await billing.overdue(LE_19_AOUT);
    invoices.rows.length = 0;
    counters.rows.length = 0;
    logs.rows.length = 0;
  };

  /**
   * LES LIGNES DE JOURNAL ÉCRITES PAR LA FACTURATION.
   *
   * Lues sur les trois actions DÉDIÉES (`invoice.issue`, `invoice.pay`,
   * `invoice.cancel`), et plus sur `tenant.note` : c'est tout l'objet du geste.
   * Une phrase d'encaissement qui repasserait par la note libre ferait échouer
   * ces tests, et c'est exactement ce qu'on veut qu'ils attrapent.
   */
  const billingLines = (): string[] =>
    logs.rows
      .filter((r) => (INVOICE_LOG_ACTIONS as readonly string[]).includes(String(r.action)))
      .map((r) => String(r.reason));

  /** Ce qui reste sous « Note interne » — la facturation n'y écrit plus rien. */
  const notes = (): string[] =>
    logs.rows.filter((r) => r.action === 'tenant.note').map((r) => String(r.reason));

  // ─── Numérotation ───

  describe('Numérotation continue et sans trou', () => {
    it('tire une séquence annuelle croissante, quel que soit le client', async () => {
      await sansAmorce();
      const a = await billing.issue(SM, CLASSFOOD, emission({ period: '2026-09' }), LE_19_AOUT);
      const b = await billing.issue(SM, VOISIN, emission({ period: '2026-09' }), LE_19_AOUT);
      const c = await billing.issue(SM, CLASSFOOD, emission({ period: '2026-10' }), LE_19_AOUT);

      expect([a.number, b.number, c.number]).toEqual([
        'SM-2026-0001',
        'SM-2026-0002',
        'SM-2026-0003',
      ]);
      // La séquence est GLOBALE : deux clients ne partagent jamais un numéro.
      expect(new Set([a.number, b.number, c.number]).size).toBe(3);
      expect(a.number).toSatisfy(isInvoiceNumberShape);
    });

    it('ne réutilise JAMAIS le numéro d’une facture annulée', async () => {
      await sansAmorce();
      const first = await billing.issue(SM, CLASSFOOD, emission({ period: '2026-09' }), LE_19_AOUT);
      await billing.cancel(SM, CLASSFOOD, first._id, { reason: 'Mauvaise période' }, LE_19_AOUT);
      const second = await billing.issue(SM, CLASSFOOD, emission({ period: '2026-09' }), LE_19_AOUT);

      expect(first.number).toBe('SM-2026-0001');
      expect(second.number).not.toBe(first.number);
      // Le numéro annulé reste consommé : c'est une pièce comptable, pas un brouillon.
      expect(second.number).toBe('SM-2026-0002');
    });

    it('rend le numéro quand l’écriture échoue — pas de trou dans la séquence', async () => {
      await sansAmorce();
      const before = counters.seqOf(invoiceCounterId(2026));

      invoices.failNextCreate = true;
      await expect(
        billing.issue(SM, CLASSFOOD, emission({ period: '2026-09' }), LE_19_AOUT),
      ).rejects.toThrow();

      expect(counters.seqOf(invoiceCounterId(2026))).toBe(before);

      const next = await billing.issue(SM, CLASSFOOD, emission({ period: '2026-09' }), LE_19_AOUT);
      expect(next.number).toBe(formatInvoiceNumber(2026, before + 1));
    });

    it('ne journalise rien quand l’émission échoue', async () => {
      await sansAmorce();
      invoices.failNextCreate = true;
      await expect(
        billing.issue(SM, CLASSFOOD, emission({ period: '2026-09' }), LE_19_AOUT),
      ).rejects.toThrow();
      // Un registre qui affirme une facture qui n'existe pas ment : la mutation
      // passe d'abord, le journal ensuite.
      expect(billingLines()).toEqual([]);
      expect(logs.rows).toHaveLength(0);
    });
  });

  // ─── Émission ───

  describe('Émettre', () => {
    it('facture le mois courant au tarif de la formule, corps vide', async () => {
      await sansAmorce();
      const invoice = await billing.issue(SM, CLASSFOOD, emission(), LE_19_AOUT);

      expect(invoice.amountCents).toBe(MRR);
      expect(invoice.amountLabel).toBe(formatEuros(MRR));
      expect(invoice.period.key).toBe('2026-08');
      expect(invoice.period.label).toBe('août 2026');
      expect(invoice.label).toBe('Abonnement Complet — août 2026');
      expect(invoice.status).toBe('en_retard'); // échéance au 1er août, on est le 19
      expect(invoice.storedStatus).toBe('envoyee');
    });

    it('refuse un second abonnement sur le même mois — jamais deux prélèvements', async () => {
      await sansAmorce();
      await billing.issue(SM, CLASSFOOD, emission({ period: '2026-09' }), LE_19_AOUT);
      await expect(
        billing.issue(SM, CLASSFOOD, emission({ period: '2026-09' }), LE_19_AOUT),
      ).rejects.toThrow(/déjà une facture d’abonnement pour septembre 2026/);
    });

    it('rouvre le mois après une annulation', async () => {
      await sansAmorce();
      const first = await billing.issue(SM, CLASSFOOD, emission({ period: '2026-09' }), LE_19_AOUT);
      await billing.cancel(SM, CLASSFOOD, first._id, { reason: 'Erreur de montant' }, LE_19_AOUT);
      await expect(
        billing.issue(SM, CLASSFOOD, emission({ period: '2026-09' }), LE_19_AOUT),
      ).resolves.toMatchObject({ status: 'envoyee' });
    });

    it('laisse cohabiter une mise en place et l’abonnement du même mois', async () => {
      await sansAmorce();
      await billing.issue(SM, CLASSFOOD, emission({ period: '2026-09' }), LE_19_AOUT);
      const install = await billing.issue(
        SM,
        CLASSFOOD,
        emission({ period: '2026-09', kind: 'mise_en_place' }),
        LE_19_AOUT,
      );
      expect(install.amountCents).toBe(INSTALL_FEE_CENTS);
      expect(install.kindLabel).toBe('Mise en place');
    });

    it('prépare un brouillon qui ne doit rien', async () => {
      await sansAmorce();
      const draft = await billing.issue(
        SM,
        CLASSFOOD,
        emission({ period: '2026-01', draft: true }),
        LE_19_AOUT,
      );
      expect(draft.status).toBe('brouillon');
      expect(draft.issuedAt).toBeNull();
      // Échéance largement dépassée, et pourtant : rien n'est parti chez le client.
      expect(draft.dueCents).toBe(0);
      expect(draft.overdueDays).toBe(0);

      const fiche = await billing.tenantBilling(SM, CLASSFOOD, TOUT, LE_19_AOUT);
      expect(fiche.outstanding.totalDueCents).toBe(0);
    });

    it('journalise l’émission avec numéro, montant et échéance', async () => {
      await sansAmorce();
      const invoice = await billing.issue(
        SM,
        CLASSFOOD,
        emission({ period: '2026-09' }),
        LE_19_AOUT,
      );
      expect(billingLines()).toEqual([
        `Facture ${invoice.number} émise — ${formatEuros(MRR)}, Abonnement Complet — septembre 2026, échéance le 01/09/2026.`,
      ]);
      // Le geste tombe dans le MÊME journal que les suspensions.
      expect(logs.rows.every((r) => String(r.tenantId) === CLASSFOOD)).toBe(true);

      // …mais sous SON nom, et rattaché à la PIÈCE : une émission n'est pas une
      // note libre, et « Note interne » est ce qu'affichait l'écran avant.
      const entry = logs.rows[0]!;
      expect(entry.action).toBe('invoice.issue');
      expect(entry.targetId).toBe(invoice._id);
      expect(notes()).toEqual([]);
      // Relisible par une machine, pas seulement par un œil : recompter une
      // année d'émissions ne doit pas demander d'analyser des phrases.
      expect(entry.meta).toEqual({
        number: invoice.number,
        kind: 'abonnement',
        period: '2026-09',
        amountCents: MRR,
        dueAt: invoice.dueAt,
        storedStatus: 'envoyee',
      });
    });
  });

  // ─── Envoi d'un brouillon ───

  describe('Envoyer un brouillon', () => {
    const brouillon = () =>
      billing.issue(SM, CLASSFOOD, emission({ period: '2026-09', draft: true }), LE_19_AOUT);

    it('fait passer la pièce « brouillon » → « envoyée », datée du jour du départ', async () => {
      await sansAmorce();
      const draft = await brouillon();
      const sent = await billing.send(SM, CLASSFOOD, draft._id, LE_19_AOUT);

      expect(sent.storedStatus).toBe('envoyee');
      expect(sent.status).toBe('envoyee'); // échéance au 1er septembre : rien d'échu le 19 août
      // `issuedAt` est la date où la pièce PART, pas celle où elle a été préparée.
      expect(sent.issuedAt).toBe(LE_19_AOUT.toISOString());
      // Même pièce, même numéro : l'envoi ne consomme pas la séquence.
      expect(sent.number).toBe(draft.number);
      expect(invoices.rows).toHaveLength(1);

      // La créance existe désormais — le brouillon ne devait rien.
      expect(sent.dueCents).toBe(MRR);
      const fiche = await billing.tenantBilling(SM, CLASSFOOD, TOUT, LE_19_AOUT);
      expect(fiche.outstanding.totalDueCents).toBe(MRR);
    });

    it('journalise l’envoi sous son nom, rattaché à la pièce', async () => {
      await sansAmorce();
      const draft = await brouillon();
      logs.rows.length = 0;
      const sent = await billing.send(SM, CLASSFOOD, draft._id, LE_19_AOUT);

      expect(billingLines()).toEqual([
        `Facture ${sent.number} envoyée — ${formatEuros(MRR)}, Abonnement Complet — septembre 2026, échéance le 01/09/2026.`,
      ]);
      const entry = logs.rows[0]!;
      expect(entry.action).toBe('invoice.send');
      expect(entry.targetId).toBe(sent._id);
      expect(entry.meta).toMatchObject({ number: sent.number, amountCents: MRR, dueAt: sent.dueAt });
      expect(notes()).toEqual([]);
    });

    it('refuse explicitement tout autre statut que « brouillon »', async () => {
      await sansAmorce();
      const emise = await billing.issue(SM, CLASSFOOD, emission({ period: '2026-09' }), LE_19_AOUT);
      await expect(billing.send(SM, CLASSFOOD, emise._id, LE_19_AOUT)).rejects.toThrow(
        /déjà émise/,
      );

      await billing.pay(SM, CLASSFOOD, emise._id, { method: 'virement', note: '' }, LE_19_AOUT);
      await expect(billing.send(SM, CLASSFOOD, emise._id, LE_19_AOUT)).rejects.toThrow(
        /déjà réglée/,
      );

      const annulee = await billing.issue(SM, CLASSFOOD, emission({ period: '2026-10' }), LE_19_AOUT);
      await billing.cancel(SM, CLASSFOOD, annulee._id, { reason: 'Doublon' }, LE_19_AOUT);
      await expect(billing.send(SM, CLASSFOOD, annulee._id, LE_19_AOUT)).rejects.toThrow(
        /annulée/,
      );
    });
  });

  // ─── Relance ───

  describe('Relancer', () => {
    /** Une créance échue depuis 79 jours — le cœur de cible de la relance. */
    const echue = () => billing.issue(SM, CLASSFOOD, emission({ period: '2026-06' }), LE_19_AOUT);

    it('pousse la relance sur la PIÈCE et rend la dernière relance', async () => {
      await sansAmorce();
      const invoice = await echue();
      const view = await billing.remind(
        SM,
        CLASSFOOD,
        invoice._id,
        { channel: 'appel', note: 'Le gérant promet de régler vendredi.' },
        LE_19_AOUT,
      );

      expect(view.reminders.count).toBe(1);
      expect(view.reminders.last).toEqual({
        at: LE_19_AOUT.toISOString(),
        channel: 'appel',
        channelLabel: 'Appel',
        note: 'Le gérant promet de régler vendredi.',
      });
      // Sur la pièce elle-même, pas dans une collection parallèle : la file de
      // recouvrement doit relire « déjà relancé ? » sans jointure.
      expect(invoices.rows[0]!.reminders as unknown[]).toHaveLength(1);
    });

    it('journalise la relance sous son nom, avec le canal et l’ancienneté', async () => {
      await sansAmorce();
      const invoice = await echue();
      logs.rows.length = 0;
      await billing.remind(
        SM,
        CLASSFOOD,
        invoice._id,
        { channel: 'sms', note: 'Relance avant l’écrit.' },
        LE_19_AOUT,
      );

      expect(billingLines()).toEqual([
        `Facture ${invoice.number} relancée par SMS — ${formatEuros(MRR)} dus, 79 jour(s) de retard. Relance avant l’écrit.`,
      ]);
      const entry = logs.rows[0]!;
      expect(entry.action).toBe('invoice.remind');
      expect(entry.targetId).toBe(invoice._id);
      expect(entry.meta).toMatchObject({ number: invoice.number, channel: 'sms', amountCents: MRR });
      // Une relance n'est pas une « Note interne » : c'est tout l'objet du geste.
      expect(notes()).toEqual([]);
    });

    it('cumule les relances — la vue rend la DERNIÈRE', async () => {
      await sansAmorce();
      const invoice = await echue();
      await billing.remind(SM, CLASSFOOD, invoice._id, { channel: 'appel', note: '' }, LE_19_AOUT);
      const plusTard = new Date('2026-08-27T09:00:00Z');
      const view = await billing.remind(
        SM,
        CLASSFOOD,
        invoice._id,
        { channel: 'courrier', note: 'Mise en demeure envoyée.' },
        plusTard,
      );

      expect(view.reminders.count).toBe(2);
      expect(view.reminders.last?.channel).toBe('courrier');
      expect(view.reminders.last?.at).toBe(plusTard.toISOString());
      expect(invoices.rows[0]!.reminders as unknown[]).toHaveLength(2);
    });

    it('refuse de relancer une facture réglée, annulée ou au brouillon', async () => {
      await sansAmorce();
      const reglee = await echue();
      await billing.pay(SM, CLASSFOOD, reglee._id, { method: 'virement', note: '' }, LE_19_AOUT);
      await expect(
        billing.remind(SM, CLASSFOOD, reglee._id, { channel: 'appel', note: '' }, LE_19_AOUT),
      ).rejects.toThrow(/plus rien à relancer/);

      const annulee = await billing.issue(SM, CLASSFOOD, emission({ period: '2026-07' }), LE_19_AOUT);
      await billing.cancel(SM, CLASSFOOD, annulee._id, { reason: 'Doublon' }, LE_19_AOUT);
      await expect(
        billing.remind(SM, CLASSFOOD, annulee._id, { channel: 'appel', note: '' }, LE_19_AOUT),
      ).rejects.toThrow(/ne se relance pas/);

      // Un brouillon n'est jamais parti chez le client : on ne relance pas une
      // somme qu'on n'a pas demandée.
      const brouillon = await billing.issue(
        SM,
        CLASSFOOD,
        emission({ period: '2026-05', draft: true }),
        LE_19_AOUT,
      );
      await expect(
        billing.remind(SM, CLASSFOOD, brouillon._id, { channel: 'appel', note: '' }, LE_19_AOUT),
      ).rejects.toThrow(/brouillon/);
    });

    it('expose la dernière relance dans la file des impayés du parc', async () => {
      await sansAmorce();
      const invoice = await echue();
      await billing.remind(SM, CLASSFOOD, invoice._id, { channel: 'email', note: '' }, LE_19_AOUT);

      const file = await billing.overdue(LE_19_AOUT);
      expect(file.invoices[0]!.reminders).toMatchObject({
        count: 1,
        last: { channel: 'email', channelLabel: 'E-mail', at: LE_19_AOUT.toISOString() },
      });
    });
  });

  // ─── Encaissement ───

  describe('Encaisser', () => {
    const emise = () => billing.issue(SM, CLASSFOOD, emission({ period: '2026-09' }), LE_19_AOUT);

    it('enregistre le moyen et la date, et solde la créance', async () => {
      await sansAmorce();
      const invoice = await emise();
      const paid = await billing.pay(
        SM,
        CLASSFOOD,
        invoice._id,
        { method: 'prelevement', paidAt: new Date('2026-08-19T09:00:00Z'), note: '' },
        LE_19_AOUT,
      );

      expect(paid.status).toBe('payee');
      expect(paid.method).toBe('prelevement');
      expect(paid.methodLabel).toBe('Prélèvement SEPA');
      expect(paid.paidAt).toBe('2026-08-19T09:00:00.000Z');
      expect(paid.dueCents).toBe(0);
    });

    it('refuse un second encaissement plutôt que d’écraser le premier', async () => {
      await sansAmorce();
      const invoice = await emise();
      await billing.pay(SM, CLASSFOOD, invoice._id, { method: 'carte', note: '' }, LE_19_AOUT);
      await expect(
        billing.pay(SM, CLASSFOOD, invoice._id, { method: 'cheque', note: '' }, LE_19_AOUT),
      ).rejects.toThrow(/déjà réglée/);
    });

    it('refuse d’encaisser un brouillon ou une facture annulée', async () => {
      await sansAmorce();
      const draft = await billing.issue(
        SM,
        CLASSFOOD,
        emission({ period: '2026-10', draft: true }),
        LE_19_AOUT,
      );
      await expect(
        billing.pay(SM, CLASSFOOD, draft._id, { method: 'virement', note: '' }, LE_19_AOUT),
      ).rejects.toThrow(/brouillon/);

      const invoice = await emise();
      await billing.cancel(SM, CLASSFOOD, invoice._id, { reason: 'Doublon' }, LE_19_AOUT);
      await expect(
        billing.pay(SM, CLASSFOOD, invoice._id, { method: 'virement', note: '' }, LE_19_AOUT),
      ).rejects.toThrow(/annulée/);
    });

    it('refuse une date de règlement dans le futur', async () => {
      await sansAmorce();
      const invoice = await emise();
      await expect(
        billing.pay(
          SM,
          CLASSFOOD,
          invoice._id,
          { method: 'virement', paidAt: new Date('2026-09-30T00:00:00Z'), note: '' },
          LE_19_AOUT,
        ),
      ).rejects.toThrow(/ne peut pas être dans le futur/);
    });

    it('journalise l’encaissement, note libre comprise', async () => {
      await sansAmorce();
      const invoice = await emise();
      logs.rows.length = 0;
      await billing.pay(
        SM,
        CLASSFOOD,
        invoice._id,
        { method: 'cheque', paidAt: new Date('2026-08-14T00:00:00Z'), note: 'Chèque n° 004512.' },
        LE_19_AOUT,
      );
      expect(billingLines()).toEqual([
        `Facture ${invoice.number} encaissée — ${formatEuros(MRR)} par chèque le 14/08/2026. Chèque n° 004512.`,
      ]);

      const entry = logs.rows[0]!;
      expect(entry.action).toBe('invoice.pay');
      expect(entry.targetId).toBe(invoice._id);
      expect(entry.meta).toMatchObject({
        number: invoice.number,
        amountCents: MRR,
        method: 'cheque',
        paidAt: '2026-08-14T00:00:00.000Z',
      });
      // Un encaissement ne doit PLUS pouvoir se lire « Note interne ».
      expect(notes()).toEqual([]);
    });
  });

  // ─── Annulation ───

  describe('Annuler', () => {
    it('conserve la pièce, son numéro et son motif — aucune suppression', async () => {
      await sansAmorce();
      const invoice = await billing.issue(
        SM,
        CLASSFOOD,
        emission({ period: '2026-09' }),
        LE_19_AOUT,
      );
      const cancelled = await billing.cancel(
        SM,
        CLASSFOOD,
        invoice._id,
        { reason: 'Période facturée en double' },
        LE_19_AOUT,
      );

      expect(cancelled.status).toBe('annulee');
      expect(cancelled.cancelReason).toBe('Période facturée en double');
      expect(cancelled.number).toBe(invoice.number);
      expect(cancelled.dueCents).toBe(0);
      expect(invoices.rows).toHaveLength(1);
      expect(billingLines()).toContain(
        `Facture ${invoice.number} annulée — ${formatEuros(MRR)}. Motif : Période facturée en double`,
      );

      const entry = logs.rows.find((r) => r.action === 'invoice.cancel')!;
      expect(entry.targetId).toBe(invoice._id);
      expect(entry.meta).toMatchObject({
        number: invoice.number,
        cancelReason: 'Période facturée en double',
      });
      expect(notes()).toEqual([]);
    });

    it('distingue les trois gestes à la lecture du journal', async () => {
      await sansAmorce();
      const encaissee = await billing.issue(
        SM,
        CLASSFOOD,
        emission({ period: '2026-09' }),
        LE_19_AOUT,
      );
      await billing.pay(SM, CLASSFOOD, encaissee._id, { method: 'virement', note: '' }, LE_19_AOUT);
      const annulee = await billing.issue(
        SM,
        CLASSFOOD,
        emission({ period: '2026-10' }),
        LE_19_AOUT,
      );
      await billing.cancel(SM, CLASSFOOD, annulee._id, { reason: 'Doublon' }, LE_19_AOUT);

      // Ce que l'équipe lit dans la fiche client : trois intitulés distincts,
      // et aucun « Note interne ». C'est la raison d'être de ces trois actions.
      const journal = await admin.journal(CLASSFOOD, TOUT);
      const gestes = journal.filter((e) =>
        (INVOICE_LOG_ACTIONS as readonly string[]).includes(e.action),
      );
      expect(gestes.map((e) => e.action)).toEqual([
        'invoice.cancel',
        'invoice.issue',
        'invoice.pay',
        'invoice.issue',
      ]);
      expect(new Set(gestes.map((e) => e.actionLabel))).toEqual(
        new Set([
          ADMIN_LOG_ACTION_LABELS['invoice.issue'],
          ADMIN_LOG_ACTION_LABELS['invoice.pay'],
          ADMIN_LOG_ACTION_LABELS['invoice.cancel'],
        ]),
      );
      expect(journal.some((e) => e.action === 'tenant.note')).toBe(false);
    });

    it('refuse d’annuler une facture réglée — c’est un avoir qu’il faut', async () => {
      await sansAmorce();
      const invoice = await billing.issue(
        SM,
        CLASSFOOD,
        emission({ period: '2026-09' }),
        LE_19_AOUT,
      );
      await billing.pay(SM, CLASSFOOD, invoice._id, { method: 'prelevement', note: '' }, LE_19_AOUT);
      await expect(
        billing.cancel(SM, CLASSFOOD, invoice._id, { reason: 'Erreur' }, LE_19_AOUT),
      ).rejects.toThrow(/avoir/);
    });
  });

  // ─── L'avoir ───

  describe('Avoir', () => {
    /** Une facture réglée — la seule pièce qui appelle un avoir. */
    const reglee = async () => {
      const invoice = await billing.issue(SM, CLASSFOOD, emission({ period: '2026-06' }), LE_19_AOUT);
      await billing.pay(SM, CLASSFOOD, invoice._id, { method: 'prelevement', note: '' }, LE_19_AOUT);
      return invoice;
    };

    it('crée une pièce NÉGATIVE, numérotée dans la même séquence annuelle', async () => {
      await sansAmorce();
      const origine = await reglee();
      const avoir = await billing.credit(
        SM,
        CLASSFOOD,
        origine._id,
        { reason: 'Service interrompu deux semaines' },
        LE_19_AOUT,
      );

      expect(avoir.kind).toBe('avoir');
      expect(avoir.kindLabel).toBe('Avoir');
      // MÊME séquence que les factures : l'origine a pris 0001, l'avoir prend
      // 0002 — pas de registre parallèle à défendre au contrôle.
      expect(avoir.number).toBe('SM-2026-0002');
      expect(avoir.amountCents).toBe(-MRR);
      expect(avoir.amountLabel).toBe(formatEuros(-MRR));
      expect(avoir.label).toBe(`Avoir sur ${origine.number} — Service interrompu deux semaines`);
      // ÉMIS, pas « payé » : un avoir n'est soldé que remboursé ou imputé.
      expect(avoir.status).toBe('envoyee');
      expect(avoir.storedStatus).toBe('envoyee');
      // La période CORRIGÉE est celle de l'origine.
      expect(avoir.period.key).toBe('2026-06');
      // Le régime de TVA de l'origine, figé sur l'avoir, ventilé en négatif.
      expect(avoir.totals.stamped).toBe(true);
      expect(avoir.totals.ratePercent).toBe(20);
      expect(avoir.totals.htCents).toBe(-MRR);

      // L'origine n'est PAS touchée : deux pièces, aucune gomme.
      expect(invoices.rows).toHaveLength(2);
      const fiche = await billing.tenantBilling(SM, CLASSFOOD, TOUT, LE_19_AOUT);
      expect(fiche.invoices.find((i) => i._id === origine._id)?.status).toBe('payee');
    });

    it('se journalise sous « invoice.credit », lié au numéro d’origine', async () => {
      await sansAmorce();
      const origine = await reglee();
      logs.rows.length = 0;
      const avoir = await billing.credit(
        SM,
        CLASSFOOD,
        origine._id,
        { reason: 'Geste commercial' },
        LE_19_AOUT,
      );

      expect(billingLines()).toEqual([
        `Avoir ${avoir.number} émis sur la facture ${origine.number} — ${formatEuros(-MRR)}. Motif : Geste commercial`,
      ]);
      const entry = logs.rows[0]!;
      expect(entry.action).toBe('invoice.credit');
      // Rattaché à la NOUVELLE pièce ; l'origine se lit dans `meta`.
      expect(entry.targetId).toBe(avoir._id);
      expect(entry.meta).toEqual({
        number: avoir.number,
        kind: 'avoir',
        period: '2026-06',
        amountCents: -MRR,
        originNumber: origine.number,
      });
      expect(notes()).toEqual([]);
    });

    it('refuse l’avoir sur tout ce qui n’est pas RÉGLÉ — là, c’est l’annulation', async () => {
      await sansAmorce();
      const envoyee = await billing.issue(SM, CLASSFOOD, emission({ period: '2026-07' }), LE_19_AOUT);
      await expect(
        billing.credit(SM, CLASSFOOD, envoyee._id, { reason: 'Erreur' }, LE_19_AOUT),
      ).rejects.toThrow(/pas réglée/);

      const brouillon = await billing.issue(
        SM,
        CLASSFOOD,
        emission({ period: '2026-05', draft: true }),
        LE_19_AOUT,
      );
      await expect(
        billing.credit(SM, CLASSFOOD, brouillon._id, { reason: 'Erreur' }, LE_19_AOUT),
      ).rejects.toThrow(/pas réglée/);

      await billing.cancel(SM, CLASSFOOD, envoyee._id, { reason: 'Doublon' }, LE_19_AOUT);
      await expect(
        billing.credit(SM, CLASSFOOD, envoyee._id, { reason: 'Erreur' }, LE_19_AOUT),
      ).rejects.toThrow(/pas réglée/);

      // Aucun refus n'a écrit quoi que ce soit : ni pièce, ni numéro consommé.
      expect(invoices.rows).toHaveLength(2);
      expect(counters.seqOf(invoiceCounterId(2026))).toBe(2);
    });

    it('refuse un avoir sur un avoir', async () => {
      await sansAmorce();
      const origine = await reglee();
      const avoir = await billing.credit(SM, CLASSFOOD, origine._id, { reason: 'Remboursement' }, LE_19_AOUT);
      // Le remboursement de l'avoir s'enregistre avec le geste d'encaissement
      // existant — et même soldé, un avoir ne se « corrige » pas par un second.
      await billing.pay(SM, CLASSFOOD, avoir._id, { method: 'virement', note: '' }, LE_19_AOUT);
      await expect(
        billing.credit(SM, CLASSFOOD, avoir._id, { reason: 'Erreur' }, LE_19_AOUT),
      ).rejects.toThrow(/déjà un avoir/);
    });

    it('n’entre JAMAIS dans la file des impayés ni dans l’ardoise', async () => {
      await sansAmorce();
      const origine = await reglee();
      await billing.credit(SM, CLASSFOOD, origine._id, { reason: 'Trop-perçu' }, LE_19_AOUT);

      // Des mois plus tard, la date de l'avoir est passée depuis longtemps : il
      // ne bascule pas « en retard » pour autant — rien n'est à recouvrer dessus,
      // c'est NOUS qui devons.
      const enNovembre = new Date('2026-11-15T00:00:00Z');
      const file = await billing.overdue(enNovembre);
      expect(file.count).toBe(0);
      expect(file.totalCents).toBe(0);

      const fiche = await billing.tenantBilling(SM, CLASSFOOD, TOUT, enNovembre);
      const avoir = fiche.invoices.find((i) => i.kind === 'avoir')!;
      expect(avoir.status).toBe('envoyee');
      expect(avoir.overdueDays).toBe(0);
      expect(avoir.dueCents).toBe(0);
      expect(fiche.outstanding.totalDueCents).toBe(0);
      // Et la « prochaine échéance » annoncée n'est jamais l'avoir.
      expect(fiche.nextDue?.invoiceNumber ?? null).not.toBe(avoir.number);
    });
  });

  // ─── Cloisonnement ───

  describe('Cloisonnement', () => {
    it('n’encaisse pas la facture d’un autre restaurant avec son identifiant', async () => {
      await sansAmorce();
      const chezLeVoisin = await billing.issue(
        SM,
        VOISIN,
        emission({ period: '2026-09' }),
        LE_19_AOUT,
      );
      await expect(
        billing.pay(SM, CLASSFOOD, chezLeVoisin._id, { method: 'carte', note: '' }, LE_19_AOUT),
      ).rejects.toThrow(/Facture introuvable/);
    });

    it('rend 404 sur un établissement ou une facture inexistants', async () => {
      await sansAmorce();
      await expect(billing.tenantBilling(SM, 'pas-un-objectid', TOUT, LE_19_AOUT)).rejects.toThrow(
        /Établissement introuvable/,
      );
      await expect(
        billing.cancel(SM, CLASSFOOD, 'pas-un-objectid', { reason: 'x' }, LE_19_AOUT),
      ).rejects.toThrow(/Facture introuvable/);
    });
  });

  // ─── Ardoise ───

  describe('Total dû et ancienneté', () => {
    it('additionne les créances et date la plus vieille', async () => {
      await sansAmorce();
      await billing.issue(SM, CLASSFOOD, emission({ period: '2026-06' }), LE_19_AOUT);
      await billing.issue(SM, CLASSFOOD, emission({ period: '2026-07' }), LE_19_AOUT);
      const aout = await billing.issue(SM, CLASSFOOD, emission({ period: '2026-08' }), LE_19_AOUT);
      await billing.pay(SM, CLASSFOOD, aout._id, { method: 'prelevement', note: '' }, LE_19_AOUT);

      const fiche = await billing.tenantBilling(SM, CLASSFOOD, TOUT, LE_19_AOUT);

      expect(fiche.outstanding.totalDueCents).toBe(MRR * 2);
      expect(fiche.outstanding.totalDueLabel).toBe(formatEuros(MRR * 2));
      expect(fiche.outstanding.overdueInvoices).toBe(2);
      expect(fiche.outstanding.oldestOverdueAt).toBe('2026-06-01T00:00:00.000Z');
      // 1er juin → 19 août : 79 jours pleins. C'est CE chiffre qui déclenche l'appel.
      expect(fiche.outstanding.oldestOverdueDays).toBe(79);
    });

    it('ne tronque pas le total dû quand l’historique est paginé', async () => {
      await sansAmorce();
      await billing.issue(SM, CLASSFOOD, emission({ period: '2026-06' }), LE_19_AOUT);
      await billing.issue(SM, CLASSFOOD, emission({ period: '2026-07' }), LE_19_AOUT);
      await billing.issue(SM, CLASSFOOD, emission({ period: '2026-08' }), LE_19_AOUT);

      const page = await billing.tenantBilling(SM, CLASSFOOD, { limit: 1 }, LE_19_AOUT);

      expect(page.invoices).toHaveLength(1);
      // Un montant dû qui rétrécit parce qu'on affiche moins de lignes serait un
      // mensonge — et c'est ce montant qui justifie une suspension.
      expect(page.outstanding.totalDueCents).toBe(MRR * 3);
    });

    it('rend l’historique du plus récent au plus ancien', async () => {
      await sansAmorce();
      await billing.issue(SM, CLASSFOOD, emission({ period: '2026-06' }), LE_19_AOUT);
      await billing.issue(SM, CLASSFOOD, emission({ period: '2026-08' }), LE_19_AOUT);
      await billing.issue(SM, CLASSFOOD, emission({ period: '2026-07' }), LE_19_AOUT);

      const fiche = await billing.tenantBilling(SM, CLASSFOOD, TOUT, LE_19_AOUT);
      expect(fiche.invoices.map((i) => i.period.key)).toEqual(['2026-08', '2026-07', '2026-06']);
    });

    it('annonce la prochaine échéance réelle, et sinon la théorique', async () => {
      await sansAmorce();
      const fiche = await billing.tenantBilling(SM, CLASSFOOD, TOUT, LE_19_AOUT);
      // Rien d'émis : le prochain prélèvement est une projection, sans numéro.
      expect(fiche.nextDue).toMatchObject({
        at: '2026-09-01T00:00:00.000Z',
        amountCents: MRR,
        invoiceNumber: null,
        daysUntil: 12,
      });

      const emise = await billing.issue(
        SM,
        CLASSFOOD,
        emission({ period: '2026-09' }),
        LE_19_AOUT,
      );
      const apres = await billing.tenantBilling(SM, CLASSFOOD, TOUT, LE_19_AOUT);
      expect(apres.nextDue?.invoiceNumber).toBe(emise.number);
    });

    it('compte une échéance dépassée en négatif, du même nombre de jours', async () => {
      await sansAmorce();
      await billing.issue(SM, CLASSFOOD, emission({ period: '2026-06' }), LE_19_AOUT);
      const fiche = await billing.tenantBilling(SM, CLASSFOOD, TOUT, LE_19_AOUT);

      // Deux arrondis indépendants afficheraient « −80 jours » à côté de
      // « 79 jours de retard » sur la même facture.
      expect(fiche.nextDue?.daysUntil).toBe(-79);
      expect(fiche.invoices[0]!.overdueDays).toBe(79);
      expect(fiche.outstanding.oldestOverdueDays).toBe(79);
    });

    it('n’annonce aucune échéance à un compte en essai', async () => {
      await sansAmorce();
      tenants.rows[1]!.account = { status: 'trial', since: new Date('2026-05-02T09:00:00Z') };
      const fiche = await billing.tenantBilling(SM, VOISIN, TOUT, LE_19_AOUT);
      expect(fiche.subscription.billable).toBe(false);
      expect(fiche.nextDue).toBeNull();
    });

    it('continue de facturer un compte suspendu', async () => {
      await sansAmorce();
      tenants.rows[0]!.account = { status: 'suspended', since: LE_19_AOUT, reason: 'Impayé' };
      const fiche = await billing.tenantBilling(SM, CLASSFOOD, TOUT, LE_19_AOUT);
      // Cesser de facturer un impayé reviendrait à l'effacer.
      expect(fiche.subscription.billable).toBe(true);
      expect(fiche.subscription.accessBlocked).toBe(true);
    });

    it('journalise la consultation de la fiche', async () => {
      await sansAmorce();
      await billing.tenantBilling(SM, CLASSFOOD, TOUT, LE_19_AOUT);
      expect(logs.rows.filter((r) => r.action === 'tenant.detail_view')).toHaveLength(1);
    });
  });

  // ─── Le retard se calcule ───

  describe('« En retard » est calculé, pas stocké', () => {
    it('bascule à l’échéance sans qu’aucune écriture n’ait lieu', async () => {
      await sansAmorce();
      const invoice = await billing.issue(
        SM,
        CLASSFOOD,
        emission({ period: '2026-09' }),
        LE_19_AOUT,
      );
      expect(invoice.status).toBe('envoyee');

      const stored = invoices.rows[0]!.status;
      const enOctobre = await billing.tenantBilling(
        SM,
        CLASSFOOD,
        TOUT,
        new Date('2026-10-05T00:00:00Z'),
      );

      expect(enOctobre.invoices[0]!.status).toBe('en_retard');
      expect(enOctobre.invoices[0]!.overdueDays).toBe(34);
      // Rien n'a été réécrit : aucune tâche de nuit n'est nécessaire pour que la
      // file des impayés soit juste.
      expect(invoices.rows[0]!.status).toBe(stored);
      expect(invoices.rows[0]!.status).toBe('envoyee');
    });
  });

  // ─── File du parc ───

  describe('Impayés du parc', () => {
    it('liste du plus ancien au plus récent, tous clients confondus', async () => {
      await sansAmorce();
      await billing.issue(SM, VOISIN, emission({ period: '2026-07' }), LE_19_AOUT);
      await billing.issue(SM, CLASSFOOD, emission({ period: '2026-05' }), LE_19_AOUT);
      await billing.issue(SM, CLASSFOOD, emission({ period: '2026-06' }), LE_19_AOUT);

      const file = await billing.overdue(LE_19_AOUT);

      expect(file.invoices.map((i) => i.period.key)).toEqual(['2026-05', '2026-06', '2026-07']);
      expect(file.count).toBe(3);
      expect(file.tenants).toBe(2);
      expect(file.totalCents).toBe(MRR * 2 + PLAN_MRR_CENTS.essentiel);
      expect(file.oldestDays).toBe(110);
      expect(file.invoices[0]!.tenant).toMatchObject({
        name: "Class'Food",
        slug: 'classfood',
        planLabel: 'Complet',
        accountStatusLabel: 'Actif',
      });
    });

    it('exclut ce qui n’est pas encore échu, réglé, annulé ou au brouillon', async () => {
      await sansAmorce();
      const future = await billing.issue(
        SM,
        CLASSFOOD,
        emission({ period: '2026-09' }),
        LE_19_AOUT,
      );
      const regle = await billing.issue(SM, CLASSFOOD, emission({ period: '2026-07' }), LE_19_AOUT);
      await billing.pay(SM, CLASSFOOD, regle._id, { method: 'virement', note: '' }, LE_19_AOUT);
      const annule = await billing.issue(SM, VOISIN, emission({ period: '2026-06' }), LE_19_AOUT);
      await billing.cancel(SM, VOISIN, annule._id, { reason: 'Geste commercial' }, LE_19_AOUT);
      await billing.issue(SM, VOISIN, emission({ period: '2026-05', draft: true }), LE_19_AOUT);

      const file = await billing.overdue(LE_19_AOUT);

      expect(file.count).toBe(0);
      expect(file.totalCents).toBe(0);
      expect(file.oldestDays).toBe(0);
      // La facture de septembre est bien due, mais son échéance n'est pas passée :
      // la mêler aux créances ferait décrocher le téléphone pour rien.
      expect(future.status).toBe('envoyee');
    });
  });

  // ─── Porte d'entrée de l'axe « paiement » ───

  describe('Alimentation de l’axe « paiement »', () => {
    it('rend l’ardoise d’un client sans passer par sa fiche', async () => {
      await sansAmorce();
      await billing.issue(SM, CLASSFOOD, emission({ period: '2026-06' }), LE_19_AOUT);
      const ardoise = await billing.outstandingFor(CLASSFOOD, LE_19_AOUT);

      expect(ardoise.overdueCents).toBe(MRR);
      expect(ardoise.oldestOverdueDays).toBe(79);
      // Et la consultation N'EST PAS journalisée : ce n'est pas l'ouverture d'un
      // dossier, c'est un calcul de score.
      expect(logs.rows.filter((r) => r.action === 'tenant.detail_view')).toHaveLength(0);
    });

    it('remplace « abonnement à jour » par un chiffre', async () => {
      await sansAmorce();
      await billing.issue(SM, CLASSFOOD, emission({ period: '2026-06' }), LE_19_AOUT);
      const axe = paiementAxis('active', await billing.outstandingFor(CLASSFOOD, LE_19_AOUT));

      expect(axe.measured).toBe(true);
      expect(axe.score).toBe(0); // 79 jours de retard
      expect(axe.detail).toBe(
        `1 facture en retard, ${formatEuros(MRR)} — la plus ancienne depuis 79 jour(s).`,
      );
    });
  });

  // ─── Jeu de démonstration ───

  describe('Jeu de démonstration Class’Food', () => {
    // L'amorçage n'écrit QUE si `SM_DEMO_SEED=on` est posé explicitement — la
    // production ne doit jamais se repeupler de factures inventées après une
    // purge. Ces deux cas décrivent l'amorçage lui-même : ils l'activent donc,
    // et le cas « rien sans le drapeau » est vérifié juste après.
    beforeEach(() => {
      process.env.SM_DEMO_SEED = 'on';
    });
    afterEach(() => {
      delete process.env.SM_DEMO_SEED;
    });

    it('écrit une histoire cohérente : des factures réglées et une en cours', async () => {
      const fiche = await billing.tenantBilling(SM, CLASSFOOD, TOUT);

      const mois =
        1 +
        (() => {
          let n = 0;
          let key = '2026-08';
          while (key !== monthKey(new Date())) {
            key = shiftMonthKey(key, 1);
            n += 1;
          }
          return n;
        })();

      // Mise en place + un abonnement par mois écoulé + celui du mois prochain.
      expect(fiche.invoices).toHaveLength(1 + mois + 1);

      const install = fiche.invoices.find((i) => i.kind === 'mise_en_place')!;
      expect(install.amountCents).toBe(INSTALL_FEE_CENTS);
      expect(install.status).toBe('payee');
      expect(install.methodLabel).toBe('Virement');

      const abonnements = fiche.invoices.filter((i) => i.kind === 'abonnement');
      expect(abonnements.every((i) => i.amountCents === MRR)).toBe(true);
      expect(abonnements.filter((i) => i.status === 'payee')).toHaveLength(mois);
      expect(abonnements.filter((i) => i.status === 'envoyee')).toHaveLength(1);
    });

    it('n’invente AUCUN impayé sur notre unique client réel', async () => {
      const fiche = await billing.tenantBilling(SM, CLASSFOOD, TOUT);
      expect(fiche.outstanding.overdueInvoices).toBe(0);
      expect(fiche.outstanding.overdueCents).toBe(0);
      expect(fiche.outstanding.oldestOverdueDays).toBe(0);
      // Une seule créance : celle du mois prochain, échéance à venir.
      expect(fiche.outstanding.totalDueCents).toBe(MRR);
      expect(fiche.nextDue?.daysUntil).toBeGreaterThan(0);

      const file = await billing.overdue();
      expect(file.count).toBe(0);
    });

    it('ne signe aucune fausse ligne de journal', async () => {
      await billing.overdue();
      // Personne n'a émis ces factures : elles décrivent un passé. Un « Facture
      // émise » au nom d'un compte d'équipe serait un faux dans un registre dont
      // toute la valeur tient à ce qu'il ne ment pas.
      expect(billingLines()).toEqual([]);
      expect(notes()).toEqual([]);
    });

    it('ne s’écrit qu’une fois, même sur deux consultations', async () => {
      await billing.tenantBilling(SM, CLASSFOOD, TOUT);
      const apresUne = invoices.rows.length;
      await billing.overdue();
      await billing.tenantBilling(SM, CLASSFOOD, TOUT);
      expect(invoices.rows).toHaveLength(apresUne);
    });

    it('numérote la série sans trou, de la mise en place au mois prochain', async () => {
      await billing.tenantBilling(SM, CLASSFOOD, TOUT);
      const numbers = invoices.rows.map((r) => String(r.number)).sort();
      expect(numbers).toEqual(numbers.map((_, i) => formatInvoiceNumber(2026, i + 1)));
    });
  });
});

// ─────────────────────────────────────────────────────────────
// Règles pures — elles se testent sans base et se relisent sans contexte.
// ─────────────────────────────────────────────────────────────

describe('Règles de facturation', () => {
  describe('Périodes', () => {
    it('borne un mois calendaire sans chevauchement ni trou', () => {
      const aout = billingPeriod('2026-08');
      const septembre = billingPeriod('2026-09');

      expect(aout.start.toISOString()).toBe('2026-08-01T00:00:00.000Z');
      expect(aout.end.toISOString()).toBe('2026-08-31T23:59:59.999Z');
      expect(aout.label).toBe('août 2026');
      expect(septembre.start.getTime() - aout.end.getTime()).toBe(1);
    });

    it('franchit l’année', () => {
      expect(shiftMonthKey('2026-12', 1)).toBe('2027-01');
      expect(shiftMonthKey('2026-01', -1)).toBe('2025-12');
      expect(billingPeriod('2027-01').label).toBe('janvier 2027');
    });

    it('refuse une période malformée', () => {
      expect(() => billingPeriod('2026-13')).toThrow(/Période de facturation invalide/);
      expect(() => billingPeriod('août')).toThrow();
    });
  });

  describe('Rédaction', () => {
    it('écrit les montants en français, à partir de centimes', () => {
      expect(formatEuros(13_900)).toBe('139,00 €');
      expect(formatEuros(0)).toBe('0,00 €');
      expect(formatEuros(149_050)).toBe('1 490,50 €');
      expect(formatEuros(-13_900)).toBe('-139,00 €');
    });

    it('écrit les dates en français', () => {
      expect(formatFrDate('2026-09-01T00:00:00.000Z')).toBe('01/09/2026');
    });

    it('produit un numéro complété à gauche', () => {
      expect(formatInvoiceNumber(2026, 7)).toBe('SM-2026-0007');
      expect(isInvoiceNumberShape('SM-2026-0007')).toBe(true);
      expect(isInvoiceNumberShape('2026-7')).toBe(false);
    });
  });

  describe('Statut effectif', () => {
    const due = '2026-09-01T00:00:00.000Z';

    it('ne touche pas aux statuts définitifs', () => {
      for (const status of ['payee', 'annulee', 'brouillon'] as const) {
        expect(effectiveInvoiceStatus(status, due, '2027-01-01T00:00:00Z')).toBe(status);
      }
    });

    it('bascule « envoyée » en « en retard » au passage de l’échéance', () => {
      expect(effectiveInvoiceStatus('envoyee', due, '2026-08-31T23:59:59Z')).toBe('envoyee');
      expect(effectiveInvoiceStatus('envoyee', due, '2026-09-01T00:00:01Z')).toBe('en_retard');
    });

    it('rend « envoyée » un « en retard » stocké dont l’échéance a été repoussée', () => {
      // La donnée fraîche l'emporte sur la donnée figée : c'est ce qui rend
      // inutile toute tâche de nuit.
      expect(effectiveInvoiceStatus('en_retard', due, '2026-08-01T00:00:00Z')).toBe('envoyee');
    });

    it('couvre tous les statuts déclarés', () => {
      expect(INVOICE_STATUSES).toHaveLength(5);
      expect(INVOICE_PAYMENT_METHODS).toContain('prelevement');
    });
  });

  describe('Ardoise', () => {
    const invoice = (over: Partial<CrmInvoice>): CrmInvoice =>
      ({
        _id: 'i',
        tenantId: 't',
        number: 'SM-2026-0001',
        kind: 'abonnement',
        kindLabel: 'Abonnement',
        label: '',
        period: { key: '2026-06', start: '', end: '', label: 'juin 2026' },
        amountCents: 13_900,
        amountLabel: '139,00 €',
        status: 'en_retard',
        statusLabel: 'En retard',
        storedStatus: 'envoyee',
        issuedAt: null,
        dueAt: '2026-06-01T00:00:00.000Z',
        paidAt: null,
        method: null,
        methodLabel: null,
        cancelledAt: null,
        cancelReason: '',
        overdueDays: 0,
        dueCents: 13_900,
        ...over,
      }) as CrmInvoice;

    it('retient l’échéance la plus ancienne, pas la plus grosse', () => {
      const summary = summarizeOutstanding(
        [
          invoice({ dueAt: '2026-07-01T00:00:00.000Z', amountCents: 90_000, dueCents: 90_000 }),
          invoice({ dueAt: '2026-06-01T00:00:00.000Z' }),
        ],
        new Date('2026-08-19T10:00:00Z'),
      );
      expect(summary.oldestOverdueAt).toBe('2026-06-01T00:00:00.000Z');
      expect(summary.oldestOverdueDays).toBe(79);
      expect(summary.totalDueCents).toBe(103_900);
    });

    it('sépare le total dû de la part échue', () => {
      const summary = summarizeOutstanding(
        [
          invoice({ status: 'en_retard' }),
          invoice({ status: 'envoyee', dueAt: '2026-09-01T00:00:00.000Z' }),
        ],
        new Date('2026-08-19T10:00:00Z'),
      );
      expect(summary.totalDueCents).toBe(27_800);
      expect(summary.overdueCents).toBe(13_900);
      expect(summary.overdueInvoices).toBe(1);
    });
  });

  describe('Axe « paiement »', () => {
    const ardoise = (days: number, cents = 13_900) =>
      summarizeOutstanding(
        [
          {
            ...({} as CrmInvoice),
            status: 'en_retard',
            dueAt: new Date(Date.now() - days * 86_400_000).toISOString(),
            dueCents: cents,
          } as CrmInvoice,
        ],
        new Date(),
      );

    it('note 100 un client sans rien à devoir', () => {
      expect(paiementAxis('active', NO_OUTSTANDING)).toMatchObject({
        score: 100,
        detail: 'Abonnement à jour.',
      });
    });

    it('note 100 une facture en cours non échue', () => {
      const summary = { ...NO_OUTSTANDING, totalDueCents: 13_900, totalDueLabel: '139,00 €' };
      expect(paiementAxis('active', summary).score).toBe(100);
      expect(paiementAxis('active', summary).detail).toMatch(/échéance non dépassée/);
    });

    it('descend par paliers avec l’ancienneté de la créance', () => {
      expect(paiementAxis('active', ardoise(3)).score).toBe(80);
      expect(paiementAxis('active', ardoise(10)).score).toBe(60);
      expect(paiementAxis('active', ardoise(20)).score).toBe(40);
      expect(paiementAxis('active', ardoise(45)).score).toBe(20);
      expect(paiementAxis('active', ardoise(90)).score).toBe(0);
    });

    it('note 0 un compte suspendu, quoi qu’il arrive', () => {
      expect(paiementAxis('suspended', NO_OUTSTANDING)).toMatchObject({ score: 0 });
      expect(paiementAxis('suspended', ardoise(90)).detail).toMatch(/Compte suspendu/);
    });

    it('garde le comportement d’origine quand rien n’est dû', () => {
      // Ces trois réponses sont celles de `scorePaiement` : le branchement ne
      // doit rien changer pour les clients qui n'ont pas d'ardoise.
      expect(paiementAxis('trial', NO_OUTSTANDING).detail).toBe(
        'Période d’essai — rien à facturer.',
      );
      expect(paiementAxis('churned', NO_OUTSTANDING)).toMatchObject({ score: 50 });
      expect(paiementAxis('active', NO_OUTSTANDING)).toMatchObject({ score: 100 });
    });

    it('mesure toujours l’axe — il ne sort jamais du dénominateur du score', () => {
      expect(paiementAxis('active').measured).toBe(true);
      expect(monthKey('2026-08-19T10:00:00Z')).toBe('2026-08');
      expect(invoiceCounterId(2026)).toBe('invoice:2026');
    });
  });
});
