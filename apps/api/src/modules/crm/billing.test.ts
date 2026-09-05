import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_LOG_ACTION_LABELS,
  INSTALL_FEE_CENTS,
  INVOICE_LOG_ACTIONS,
  INVOICE_PAYMENT_METHODS,
  INVOICE_STATUSES,
  NO_OUTSTANDING,
  PLAN_MRR_CENTS,
  MODULE_ORDERING_CENTS,
  SOCIAL_CADENCE_CENTS,
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
  EMPTY_SERVICES,
  ATELIER_PRESENCE_CENTS,
} from '@sm/contracts';
import type { AdminLog, Tenant, User } from '@sm/db';
import { testOriginesImages } from '../tenants/tenants.fakes';
import { AdminService } from './admin.service';
import { BillingService } from './billing.service';
import { DuplicateInvoiceException, InvoiceWriterService } from './invoice-writer.service';
import { InvoiceNumberingService } from './invoice-numbering.service';
import { FakeCounters, FakeInvoices, FakeIssuances } from './billing.fakes';
import type { InvoiceCheckoutGateway } from '../billing/invoice-checkout.gateway';
import { FakeCollection } from './admin.fakes';

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
  let issuances: FakeIssuances;
  let writer: InvoiceWriterService;
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
    issuances = new FakeIssuances();
    writer = new InvoiceWriterService(invoices.asModel(), issuances.asModel(), new InvoiceNumberingService(invoices.asModel(), counters.asModel()));

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
      testOriginesImages(),
    );

    billing = new BillingService(
      invoices.asModel(),
      tenants.asModel<Tenant>(),
      writer,
      admin,
    );
  });

  /**
   * Une fiche vide reste vide : aucune lecture n'amorce la comptabilité.
   * Les tests métier commencent avec un registre et des réservations vierges.
   */
  const sansAmorce = async () => {
    await billing.overdue(LE_19_AOUT);
    invoices.rows.length = 0;
    counters.rows.length = 0;
    issuances.rows.length = 0;
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

  describe('concurrence Checkout et gestes manuels', () => {
    async function withSession(gateway: { retrieve: ReturnType<typeof vi.fn>; expire: ReturnType<typeof vi.fn> }) {
      await sansAmorce();
      const invoice = await billing.issue(SM, CLASSFOOD, emission(), LE_19_AOUT);
      const row = invoices.rows.find((r) => String(r._id) === invoice._id)!;
      row.stripeCheckoutSessionId = 'cs_invoice';
      billing = new BillingService(invoices.asModel(), tenants.asModel<Tenant>(), writer, admin, gateway as unknown as InvoiceCheckoutGateway);
      return { invoice, row };
    }

    it('expire puis revérifie Stripe avant un règlement manuel', async () => {
      const gateway = { retrieve: vi.fn().mockResolvedValueOnce({ status: 'open', payment_status: 'unpaid' }).mockResolvedValue({ status: 'expired', payment_status: 'unpaid' }), expire: vi.fn().mockResolvedValue(undefined) };
      const { invoice } = await withSession(gateway);
      const paid = await billing.pay(SM, CLASSFOOD, invoice._id, { method: 'virement', note: '' }, LE_19_AOUT);
      expect(gateway.expire).toHaveBeenCalledWith('cs_invoice');
      expect(gateway.retrieve).toHaveBeenCalledTimes(2);
      expect(paid.status).toBe('payee');
    });

    it('refuse d’annuler une session Stripe déjà payée même si le webhook tarde', async () => {
      const gateway = { retrieve: vi.fn().mockResolvedValue({ status: 'complete', payment_status: 'paid' }), expire: vi.fn() };
      const { invoice, row } = await withSession(gateway);
      await expect(billing.cancel(SM, CLASSFOOD, invoice._id, { reason: 'Erreur' }, LE_19_AOUT)).rejects.toThrow('rapprochement');
      expect(row.status).toBe('envoyee');
      expect(gateway.expire).not.toHaveBeenCalled();
    });

    it('un échec d’expiration ne peut pas annuler un paiement en course', async () => {
      const gateway = { retrieve: vi.fn().mockResolvedValue({ status: 'open', payment_status: 'unpaid' }), expire: vi.fn().mockRejectedValue(new Error('already complete')) };
      const { invoice, row } = await withSession(gateway);
      await expect(billing.cancel(SM, CLASSFOOD, invoice._id, { reason: 'Erreur' }, LE_19_AOUT)).rejects.toThrow('en cours');
      expect(row.status).toBe('envoyee');
    });

    it('le CAS refuse si une nouvelle session apparaît avant la mutation manuelle', async () => {
      const gateway = { retrieve: vi.fn(), expire: vi.fn() };
      const { invoice, row } = await withSession(gateway);
      gateway.retrieve.mockImplementation(async () => { row.stripeCheckoutSessionId = 'cs_new'; return { status: 'expired', payment_status: 'unpaid' }; });
      await expect(billing.pay(SM, CLASSFOOD, invoice._id, { method: 'virement', note: '' }, LE_19_AOUT)).rejects.toThrow('changé');
      expect(row.status).toBe('envoyee');
    });
  });

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

    it('conserve le numéro réservé et reprend la même facture après un échec d’écriture', async () => {
      await sansAmorce();
      const before = counters.seqOf(invoiceCounterId(2026));

      invoices.failNextCreate = true;
      await expect(
        billing.issue(SM, CLASSFOOD, emission({ period: '2026-09' }), LE_19_AOUT),
      ).rejects.toThrow();

      expect(counters.seqOf(invoiceCounterId(2026))).toBe(before + 1);
      expect(invoices.rows).toHaveLength(0);
      const pending = counters.rows[0]?.pendingInvoice as { snapshot: { _id: unknown }; number: string };
      expect(pending.number).toBe(formatInvoiceNumber(2026, before + 1));

      // Une autre instance aide la réservation existante ; le conflit invite
      // l'opérateur à relire la pièce récupérée au lieu d'en émettre une seconde.
      const restarted = new BillingService(invoices.asModel(), tenants.asModel<Tenant>(),
        new InvoiceWriterService(invoices.asModel(), issuances.asModel(), new InvoiceNumberingService(invoices.asModel(), counters.asModel())), admin);
      await expect(restarted.issue(SM, CLASSFOOD, emission({ period: '2026-09', amountCents: MRR + 1000 }), LE_19_AOUT)).rejects.toThrow(DuplicateInvoiceException);
      expect(invoices.rows).toHaveLength(1);
      expect(String(invoices.rows[0]?._id)).toBe(String(pending.snapshot._id));
      expect(invoices.rows[0]?.number).toBe(pending.number);
      expect(invoices.rows[0]?.amountCents).toBe(MRR);
      expect(counters.seqOf(invoiceCounterId(2026))).toBe(before + 1);
      expect(counters.rows[0]?.pendingInvoice).toBeNull();
    });

    it('une réponse perdue après insertion ne réattribue pas le numéro à un autre client', async () => {
      await sansAmorce();
      invoices.failAfterNextCreate = true;
      await expect(billing.issue(SM, CLASSFOOD, emission({ period: '2026-09' }), LE_19_AOUT)).rejects.toThrow('réponse perdue');
      const first = (await invoices.find({}).lean())[0]!;
      expect(first.number).toBe('SM-2026-0001');
      expect(counters.rows[0]?.pendingInvoice).not.toBeNull();
      await expect(billing.issue(SM, CLASSFOOD, emission({ period: '2026-09' }), LE_19_AOUT)).rejects.toThrow(DuplicateInvoiceException);

      // La prochaine émission termine le pending existant avant son allocation.
      const next = await billing.issue(SM, VOISIN, emission({ period: '2026-09' }), LE_19_AOUT);
      expect(next.number).toBe('SM-2026-0002');
      expect(invoices.rows).toHaveLength(2);
      expect(invoices.rows.find((row) => row.number === first.number)).toEqual(first);
      expect(counters.seqOf(invoiceCounterId(2026))).toBe(2);
      expect(counters.rows[0]?.pendingInvoice).toBeNull();
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
    it('arbitre deux émissions concurrentes de la même échéance en base', async () => {
      await sansAmorce();
      const other = new BillingService(invoices.asModel(), tenants.asModel<Tenant>(),
        new InvoiceWriterService(invoices.asModel(), issuances.asModel(), new InvoiceNumberingService(invoices.asModel(), counters.asModel())), admin);
      const results = await Promise.allSettled([
        billing.issue(SM, CLASSFOOD, emission({ period: '2026-09' }), LE_19_AOUT),
        other.issue(SM, CLASSFOOD, emission({ period: '2026-09' }), LE_19_AOUT),
      ]);
      expect(invoices.rows.filter((row) => row.kind === 'abonnement' && row.status !== 'annulee')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(counters.seqOf(invoiceCounterId(2026))).toBe(1);
    });

    it('le propriétaire initial réussit si un helper matérialise avant sa lecture de la facture', async () => {
      await sansAmorce();
      const helper = new BillingService(invoices.asModel(), tenants.asModel<Tenant>(),
        new InvoiceWriterService(invoices.asModel(), issuances.asModel(), new InvoiceNumberingService(invoices.asModel(), counters.asModel())), admin);
      let reached!: () => void;
      let release!: () => void;
      const atPrevious = new Promise<void>((resolve) => { reached = resolve; });
      const resumePrevious = new Promise<void>((resolve) => { release = resolve; });
      const original = invoices.findOne.bind(invoices);
      const read = vi.spyOn(invoices, 'findOne').mockImplementationOnce((filter) => {
        const query = original(filter);
        const lean = query.lean.bind(query);
        vi.spyOn(query, 'lean').mockImplementationOnce(async () => {
          // Le claim existe, mais cette lecture n'a pas encore interrogé le
          // store. Le helper peut donc matérialiser la facture avant elle.
          reached();
          await resumePrevious;
          return lean();
        });
        return query;
      });
      const ownerResult = Promise.allSettled([
        billing.issue(SM, CLASSFOOD, emission({ period: '2026-09' }), LE_19_AOUT),
      ]);
      try {
        await atPrevious;
        expect(issuances.rows).toHaveLength(1);
        expect(invoices.rows).toHaveLength(0);
        await expect(helper.issue(SM, CLASSFOOD, emission({ period: '2026-09' }), LE_19_AOUT))
          .rejects.toThrow(DuplicateInvoiceException);
        expect(invoices.rows).toHaveLength(1);
        release();
        const [result] = await ownerResult;
        expect(result?.status).toBe('fulfilled');
        if (result?.status === 'fulfilled') expect(result.value._id).toBe(String(invoices.rows[0]?._id));
        expect(invoices.rows).toHaveLength(1);
        expect(counters.seqOf(invoiceCounterId(2026))).toBe(1);
        expect(counters.rows[0]?.pendingInvoice).toBeNull();
        expect(billingLines()).toHaveLength(1);
      } finally {
        release();
        await ownerResult;
        read.mockRestore();
      }
    });

    it('une ancienne pièce annulée ne masque pas son remplacement actif', async () => {
      await sansAmorce();
      const ancienne = await billing.issue(SM, CLASSFOOD, emission({ period: '2026-09' }), LE_19_AOUT);
      await billing.cancel(SM, CLASSFOOD, ancienne._id, { reason: 'À remplacer' }, LE_19_AOUT);
      await billing.issue(SM, CLASSFOOD, emission({ period: '2026-09' }), LE_19_AOUT);
      await expect(billing.issue(SM, CLASSFOOD, emission({ period: '2026-09' }), LE_19_AOUT)).rejects.toThrow('déjà une facture');
      expect(invoices.rows.filter((row) => row.status !== 'annulee')).toHaveLength(1);
    });

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
      ).rejects.toThrow(DuplicateInvoiceException);
    });

    it('un seul remplacement gagne après une annulation, sans perdre la pièce annulée', async () => {
      await sansAmorce();
      const first = await billing.issue(SM, CLASSFOOD, emission({ period: '2026-09' }), LE_19_AOUT);
      await billing.cancel(SM, CLASSFOOD, first._id, { reason: 'Montant à corriger' }, LE_19_AOUT);
      const results = await Promise.allSettled([
        billing.issue(SM, CLASSFOOD, emission({ period: '2026-09', amountCents: MRR + 100 }), LE_19_AOUT),
        billing.issue(SM, CLASSFOOD, emission({ period: '2026-09', amountCents: MRR + 200 }), LE_19_AOUT),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(invoices.rows).toHaveLength(2);
      expect(invoices.rows.find((row) => String(row._id) === first._id)?.status).toBe('annulee');
      expect(invoices.rows.filter((row) => row.status !== 'annulee')).toHaveLength(1);
      expect(counters.seqOf(invoiceCounterId(2026))).toBe(2);
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
    it('ne ressuscite pas un brouillon annulé entre la lecture et l’envoi', async () => {
      await sansAmorce();
      const draft = await billing.issue(SM, CLASSFOOD, emission({ draft: true }), LE_19_AOUT);
      const original = invoices.findOneAndUpdate.bind(invoices);
      const update = vi.spyOn(invoices, 'findOneAndUpdate').mockImplementationOnce((filter, changes, options) => {
        const row = invoices.rows.find((invoice) => String(invoice._id) === draft._id)!;
        row.status = 'annulee';
        return original(filter, changes, options);
      });
      await expect(billing.send(SM, CLASSFOOD, draft._id, LE_19_AOUT)).rejects.toThrow('changé');
      expect(invoices.rows.find((invoice) => String(invoice._id) === draft._id)?.status).toBe('annulee');
      update.mockRestore();
    });

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

    /**
     * L'OFFRE COMPLÈTE, PAS SEULEMENT LA FORMULE.
     *
     * Toute la facturation lisait `tenant.plan` seul. Un client Complet avec
     * le module de commande en ligne était donc facturé 159 € au lieu de
     * 238 €, et un client sans formule — qui paie pourtant ses services tous
     * les mois — n'apparaissait dans aucune projection d'échéance.
     *
     * `abonnementMensuelCents` est la source unique : ce qui a été devisé est
     * ce qui est facturé.
     */
    it('le MRR de la fiche compte le module de commande en ligne', async () => {
      await sansAmorce();
      tenants.rows[0]!.onlineOrdering = true;
      const fiche = await billing.tenantBilling(SM, CLASSFOOD, TOUT, LE_19_AOUT);
      expect(fiche.subscription.mrrCents).toBe(MRR + MODULE_ORDERING_CENTS);
    });

    it('le MRR de la fiche compte les services mensuels de l’Atelier', async () => {
      await sansAmorce();
      tenants.rows[0]!.atelier = { presenceInternet: true, reseauxSociaux: 'hebdo', signedAt: new Date() };
      const fiche = await billing.tenantBilling(SM, CLASSFOOD, TOUT, LE_19_AOUT);
      expect(fiche.subscription.mrrCents).toBe(MRR + 6_900 + SOCIAL_CADENCE_CENTS.hebdo);
    });

    it('la facture d’abonnement sans montant saisi porte l’offre entière', async () => {
      await sansAmorce();
      tenants.rows[0]!.onlineOrdering = true;
      const emise = await billing.issue(SM, CLASSFOOD, emission({ period: '2026-09' }), LE_19_AOUT);
      expect(emise.amountCents).toBe(MRR + MODULE_ORDERING_CENTS);
    });

    it('un client SANS formule a bien une prochaine échéance : ses services se paient', async () => {
      await sansAmorce();
      tenants.rows[0]!.plan = null;
      tenants.rows[0]!.atelier = { presenceInternet: true, signedAt: new Date() };
      const fiche = await billing.tenantBilling(SM, CLASSFOOD, TOUT, LE_19_AOUT);
      expect(fiche.nextDue).not.toBeNull();
      expect(fiche.nextDue?.amountCents).toBe(6_900);
    });

    it('un client qui n’a vraiment rien de récurrent n’a pas d’échéance', async () => {
      await sansAmorce();
      tenants.rows[0]!.plan = null;
      tenants.rows[0]!.atelier = null;
      const fiche = await billing.tenantBilling(SM, CLASSFOOD, TOUT, LE_19_AOUT);
      expect(fiche.nextDue).toBeNull();
    });

    /**
     * LA REMISE FONDATEUR DESCEND JUSQU'À LA FACTURE.
     *
     * Le drapeau `founderSeat` ne changeait aucun prix : le CRM promettait
     * « tarif gelé à vie » et facturait le tarif public. La règle du 27/08/2026
     * — moitié prix pendant douze mois — doit se voir partout où un montant
     * sort : le MRR de la fiche, la facture émise, la prochaine échéance.
     *
     * TROIS champs, et les trois sont nécessaires : `founderSeat` dit le droit,
     * `founderUntil` le terme, `founderDiscountCents` la PORTÉE. Un client
     * fondateur à qui il manque le montant n'est pas remisé — c'est voulu, et
     * `backfill-founder.ts` reprend ceux d'avant. La portée est un montant figé
     * et non un taux : ce qu'on ajoute après la signature se paie plein tarif,
     * et le test plus bas le verrouille.
     */
    /** Le fondateur tel qu'il sort de la conversion : droit, terme ET montant. */
    const fondateur = (): void => {
      tenants.rows[0]!.founderSeat = true;
      tenants.rows[0]!.founderUntil = new Date('2027-08-19T00:00:00.000Z');
      tenants.rows[0]!.founderDiscountCents = MRR / 2;
    };

    it('un fondateur voit son MRR à moitié prix', async () => {
      await sansAmorce();
      fondateur();
      const fiche = await billing.tenantBilling(SM, CLASSFOOD, TOUT, LE_19_AOUT);
      expect(fiche.subscription.mrrCents).toBe(MRR / 2);
    });

    it('sa facture d’abonnement porte le montant remisé, pas le tarif public', async () => {
      await sansAmorce();
      fondateur();
      const emise = await billing.issue(SM, CLASSFOOD, emission({ period: '2026-09' }), LE_19_AOUT);
      expect(emise.amountCents).toBe(MRR / 2);
    });

    /**
     * L'INVARIANT QUI COÛTE LE PLUS CHER S'IL TOMBE.
     *
     * Tant que la remise était un pourcentage appliqué à l'offre courante, un
     * fondateur qui ajoutait un service au onzième mois l'obtenait à moitié
     * prix — et le CRM offre un bouton pour le faire en un clic. Le montant
     * figé rend la règle vraie sans qu'aucun code n'ait à distinguer « signé »
     * de « ajouté depuis » : le dû grossit, la remise non.
     */
    it('un service ajouté APRÈS la signature se paie plein tarif', async () => {
      await sansAmorce();
      fondateur();
      // Le client souscrit la présence internet après coup : 69 € qui
      // s'ajoutent ENTIERS au montant déjà remisé.
      tenants.rows[0]!.atelier = { ...EMPTY_SERVICES, presenceInternet: true };
      const fiche = await billing.tenantBilling(SM, CLASSFOOD, TOUT, LE_19_AOUT);
      expect(fiche.subscription.mrrCents).toBe(MRR / 2 + ATELIER_PRESENCE_CENTS);
    });

    it('la remise expirée, il repasse au tarif public sans qu’on fasse un geste', async () => {
      await sansAmorce();
      tenants.rows[0]!.founderSeat = true;
      tenants.rows[0]!.founderDiscountCents = MRR / 2;
      // Terme dépassé : LE_19_AOUT est en 2026, la remise s'est éteinte en 2025.
      tenants.rows[0]!.founderUntil = new Date('2025-08-19T00:00:00.000Z');
      const fiche = await billing.tenantBilling(SM, CLASSFOOD, TOUT, LE_19_AOUT);
      expect(fiche.subscription.mrrCents).toBe(MRR);
    });

    it('la place fondateur sans date ne remise rien — un booléen n’expire pas', async () => {
      await sansAmorce();
      tenants.rows[0]!.founderSeat = true;
      tenants.rows[0]!.founderUntil = null;
      tenants.rows[0]!.founderDiscountCents = MRR / 2;
      const fiche = await billing.tenantBilling(SM, CLASSFOOD, TOUT, LE_19_AOUT);
      expect(fiche.subscription.mrrCents).toBe(MRR);
    });

    /**
     * LA FACTURATION DU MOIS, EN UN GESTE.
     *
     * Rien n'émettait l'abonnement du mois suivant : ni écran, ni planificateur.
     * La file de recouvrement pouvait rester vide non parce que le parc était à
     * jour, mais parce que rien n'avait jamais été facturé.
     *
     * Un geste de masse plutôt qu'un cron : un automate qui émet des créances
     * tout seul se découvre le jour où il a facturé un client parti. Avec un
     * parc de cette taille, une revue mensuelle de trente secondes vaut mieux
     * qu'un automate à surveiller.
     */
    it('émet l’abonnement du mois pour chaque client facturable', async () => {
      await sansAmorce();
      const bilan = await billing.runMensuel(SM, { period: '2026-09', draft: false }, LE_19_AOUT);
      expect(bilan.emises.map((e) => e.slug).sort()).toEqual(['classfood', 'voisin']);
      expect(bilan.emises.every((e) => e.number)).toBe(true);
    });

    it.each([
      { plan: null, onlineOrdering: false, onlineDelivery: false, standaloneLoyalty: true, amount: 3_900 },
      { plan: null, onlineOrdering: true, onlineDelivery: false, standaloneLoyalty: true, amount: 7_900 },
      { plan: null, onlineOrdering: false, onlineDelivery: true, standaloneLoyalty: true, amount: 11_900 },
      { plan: 'boost', onlineOrdering: true, onlineDelivery: true, standaloneLoyalty: true, amount: 23_900 },
    ])('facture les options autonomes persistées, sans doublon : $amount', async ({ amount, ...offre }) => {
      await sansAmorce();
      Object.assign(tenants.rows[1]!, offre);
      const bilan = await billing.runMensuel(SM, { period: '2026-09', draft: true }, LE_19_AOUT);
      expect(bilan.emises.find((invoice) => invoice.slug === 'voisin')?.amountCents).toBe(amount);
      const fiche = await billing.tenantBilling(SM, VOISIN, { limit: 20 }, LE_19_AOUT);
      expect(fiche.subscription.mrrCents).toBe(amount);
    });

    it('est IDEMPOTENT : relancé, il ne double aucune facture', async () => {
      await sansAmorce();
      await billing.runMensuel(SM, { period: '2026-09', draft: false }, LE_19_AOUT);
      const second = await billing.runMensuel(SM, { period: '2026-09', draft: false }, LE_19_AOUT);
      expect(second.emises).toHaveLength(0);
      expect(second.ignores.map((i) => i.raison)).toEqual([
        'deja_facture',
        'deja_facture',
      ]);
    });

    it('saute un compte en essai, et dit pourquoi', async () => {
      await sansAmorce();
      tenants.rows[1]!.account = { status: 'trial', since: new Date('2026-05-02T09:00:00Z') };
      const bilan = await billing.runMensuel(SM, { period: '2026-09', draft: false }, LE_19_AOUT);
      expect(bilan.emises.map((e) => e.slug)).toEqual(['classfood']);
      expect(bilan.ignores).toEqual([
        { slug: 'voisin', name: 'Le Voisin', raison: 'non_facturable' },
      ]);
    });

    /**
     * L'ESSAI ÉCHU SE CLÔT ICI, ET NULLE PART AILLEURS.
     *
     * `trialEndsAt` était écrit à la conversion et lu par aucune garde ; aucun
     * planificateur ne closait l'essai, et `isBillable` exclut `trial`. Un
     * restaurant signé que personne ne basculait à la main n'était donc JAMAIS
     * facturé — accès complet, gratuit, permanent. Cette passe est le seul geste
     * qui parcourt tout le parc : c'est là que la colonne se réconcilie, au
     * moment même où l'on facture.
     */
    describe('L’essai qui s’achève', () => {
      const TERME = new Date('2026-07-31T09:00:00Z');
      /** Le Voisin, signé début juillet, terme dépassé au 19 août. */
      const enEssaiEchu = () => {
        tenants.rows[1]!.account = {
          status: 'trial',
          since: new Date('2026-07-01T09:00:00Z'),
          reason: 'Créé depuis le pipeline',
          suspendedAt: null,
          trialEndsAt: TERME,
        };
      };

      it('facture un essai dont le terme est passé — le trou que ça ferme', async () => {
        await sansAmorce();
        enEssaiEchu();
        const bilan = await billing.runMensuel(SM, { period: '2026-09', draft: false }, LE_19_AOUT);
        expect(bilan.emises.map((e) => e.slug).sort()).toEqual(['classfood', 'voisin']);
      });

      it('laisse tranquille un essai encore en cours', async () => {
        await sansAmorce();
        tenants.rows[1]!.account = {
          status: 'trial',
          since: LE_19_AOUT,
          trialEndsAt: new Date('2026-09-18T09:00:00Z'),
        };
        const bilan = await billing.runMensuel(SM, { period: '2026-09', draft: false }, LE_19_AOUT);
        expect(bilan.emises.map((e) => e.slug)).toEqual(['classfood']);
        expect(bilan.ignores).toEqual([
          { slug: 'voisin', name: 'Le Voisin', raison: 'non_facturable' },
        ]);
        // Rien n'a été écrit : la passe ne touche QUE les essais réellement échus.
        expect((tenants.rows[1]!.account as { status: string }).status).toBe('trial');
      });

      it('réconcilie la colonne, datée du terme, et le dit au journal', async () => {
        await sansAmorce();
        enEssaiEchu();
        await billing.runMensuel(SM, { period: '2026-09', draft: false }, LE_19_AOUT);

        const compte = tenants.rows[1]!.account as { status: string; since: Date };
        expect(compte.status).toBe('active');
        // Le terme, pas le jour de la passe : la fiche affichait déjà cette
        // date par dérivation, elle ne doit pas sauter.
        expect(compte.since).toEqual(TERME);

        const ligne = (await admin.journal(VOISIN, TOUT)).find(
          (e) => e.action === 'tenant.trial_end',
        );
        expect(ligne?.actionLabel).toBe('Fin de la période d’essai');
        expect(ligne?.meta).toMatchObject({ trialEndsAt: TERME.toISOString() });
      });

      it('relancée, elle n’écrit pas une seconde ligne de fin d’essai', async () => {
        await sansAmorce();
        enEssaiEchu();
        await billing.runMensuel(SM, { period: '2026-09', draft: false }, LE_19_AOUT);
        await billing.runMensuel(SM, { period: '2026-10', draft: false }, LE_19_AOUT);

        const lignes = (await admin.journal(VOISIN, TOUT)).filter(
          (e) => e.action === 'tenant.trial_end',
        );
        expect(lignes).toHaveLength(1);
      });

      it('ne ressuscite pas un client PARTI dont l’essai était échu', async () => {
        // Le piège de cette dérivation : un départ acté par un humain ne
        // s'annule pas parce qu'une date est passée. Le facturer de nouveau
        // serait une créance sur un client qui nous a quittés.
        await sansAmorce();
        tenants.rows[1]!.account = {
          status: 'churned',
          since: LE_19_AOUT,
          trialEndsAt: TERME,
        };
        const bilan = await billing.runMensuel(SM, { period: '2026-09', draft: false }, LE_19_AOUT);
        expect(bilan.emises.map((e) => e.slug)).toEqual(['classfood']);
        expect((tenants.rows[1]!.account as { status: string }).status).toBe('churned');
      });

      it('sort de l’essai un client sans rien à facturer — le fait est indépendant', async () => {
        // Un client Atelier ponctuel n'a rien de récurrent : la passe le saute
        // pour la facture, mais son essai s'est bien achevé, et sa fiche doit
        // le dire.
        await sansAmorce();
        enEssaiEchu();
        tenants.rows[1]!.plan = null;
        tenants.rows[1]!.atelier = null;
        const bilan = await billing.runMensuel(SM, { period: '2026-09', draft: false }, LE_19_AOUT);
        expect(bilan.ignores.map((i) => i.raison)).toEqual(['rien_a_facturer']);
        expect((tenants.rows[1]!.account as { status: string }).status).toBe('active');
      });

      it('rend la fiche facturation d’un essai échu FACTURABLE, avant même la passe', async () => {
        // La lecture n'attend pas l'écriture : c'est tout l'objet de
        // `statutEffectif`. La fiche annonce donc la prochaine échéance le jour
        // du terme, pas le jour où la passe tourne.
        await sansAmorce();
        enEssaiEchu();
        const fiche = await billing.tenantBilling(SM, VOISIN, TOUT, LE_19_AOUT);
        expect(fiche.subscription.accountStatus).toBe('active');
        expect(fiche.subscription.billable).toBe(true);
        expect(fiche.nextDue).not.toBeNull();
      });
    });

    it('saute un client qui n’a rien de récurrent — un Atelier ponctuel ne s’abonne pas', async () => {
      await sansAmorce();
      tenants.rows[1]!.plan = null;
      tenants.rows[1]!.atelier = null;
      const bilan = await billing.runMensuel(SM, { period: '2026-09', draft: false }, LE_19_AOUT);
      expect(bilan.emises.map((e) => e.slug)).toEqual(['classfood']);
      expect(bilan.ignores.map((i) => i.raison)).toEqual(['rien_a_facturer']);
    });

    it('en brouillon, rien n’est dû : les pièces attendent d’être envoyées', async () => {
      await sansAmorce();
      const bilan = await billing.runMensuel(SM, { period: '2026-09', draft: true }, LE_19_AOUT);
      expect(bilan.emises).toHaveLength(2);
      const fiche = await billing.tenantBilling(SM, CLASSFOOD, TOUT, LE_19_AOUT);
      const piece = fiche.invoices.find((i) => i.period.key === '2026-09');
      expect(piece?.status).toBe('brouillon');
    });

    it('un client remisé est facturé à son prix, pas au tarif public', async () => {
      await sansAmorce();
      fondateur();
      const bilan = await billing.runMensuel(SM, { period: '2026-09', draft: false }, LE_19_AOUT);
      const ligne = bilan.emises.find((e) => e.slug === 'classfood');
      expect(ligne?.amountCents).toBe(MRR / 2);
    });

    /**
     * L'ENGAGEMENT ANNUEL, ENFIN LU.
     *
     * `billingCycle` était écrit à la signature, montré sur la fiche client, et
     * lu par aucun calcul de facturation : un client ayant signé « douze mois
     * payés dix » recevait douze mensualités pleines — vingt pour cent de trop,
     * en silence. Ces trois tests verrouillent la règle du devis, qui fait foi
     * puisque c'est lui que le client a signé : l'engagement porte sur le
     * LOGICIEL, les services de l'Atelier restent mensuels.
     *
     * Le tenant `classfood` est créé le 18 août : son mois anniversaire est
     * donc août, et septembre tombe hors échéance.
     */
    it('un client à l’année n’est pas facturé hors de son mois anniversaire', async () => {
      await sansAmorce();
      tenants.rows[0]!.billingCycle = 'annuel';
      const bilan = await billing.runMensuel(SM, { period: '2026-09', draft: false }, LE_19_AOUT);
      expect(bilan.emises.map((e) => e.slug)).not.toContain('classfood');
      expect(bilan.ignores.find((i) => i.slug === 'classfood')?.raison).toBe(
        'hors_echeance_annuelle',
      );
    });

    it('à son mois anniversaire, il paie dix mensualités et pas douze', async () => {
      await sansAmorce();
      tenants.rows[0]!.billingCycle = 'annuel';
      const bilan = await billing.runMensuel(SM, { period: '2026-08', draft: false }, LE_19_AOUT);
      const ligne = bilan.emises.find((e) => e.slug === 'classfood');
      // Dix, jamais douze : les deux mois offerts sont la remise vendue.
      expect(ligne?.amountCents).toBe(MRR * 10);
      expect(ligne?.amountCents).not.toBe(MRR * 12);
    });

    it('l’émission manuelle sans montant suit l’échéancier annuel, pas le MRR normalisé', async () => {
      await sansAmorce();
      tenants.rows[0]!.billingCycle = 'annuel';
      const facture = await billing.issue(SM, CLASSFOOD, emission({ period: '2026-08' }), LE_19_AOUT);
      expect(facture.amountCents).toBe(MRR * 10);
      expect(facture.label).toContain('annuel');
      await expect(billing.issue(SM, CLASSFOOD, emission({ period: '2026-09' }), LE_19_AOUT)).rejects.toThrow('Aucune échéance');
    });

    it('l’émission manuelle hors anniversaire conserve seulement les services mensuels dus', async () => {
      await sansAmorce();
      tenants.rows[0]!.billingCycle = 'annuel';
      tenants.rows[0]!.atelier = { ...EMPTY_SERVICES, presenceInternet: true };
      const facture = await billing.issue(SM, CLASSFOOD, emission({ period: '2026-09' }), LE_19_AOUT);
      expect(facture.amountCents).toBe(ATELIER_PRESENCE_CENTS);
    });

    it('ses services de l’Atelier restent mensuels — ils ne s’annualisent pas', async () => {
      await sansAmorce();
      tenants.rows[0]!.billingCycle = 'annuel';
      tenants.rows[0]!.atelier = { ...EMPTY_SERVICES, presenceInternet: true };
      // Septembre : hors échéance logicielle, mais la présence internet est due.
      const bilan = await billing.runMensuel(SM, { period: '2026-09', draft: false }, LE_19_AOUT);
      const ligne = bilan.emises.find((e) => e.slug === 'classfood');
      expect(ligne?.amountCents).toBe(ATELIER_PRESENCE_CENTS);
    });

    it('le libellé cesse de nommer la formule dès que la pièce porte autre chose', async () => {
      await sansAmorce();
      tenants.rows[0]!.atelier = { ...EMPTY_SERVICES, presenceInternet: true };
      const bilan = await billing.runMensuel(SM, { period: '2026-09', draft: false }, LE_19_AOUT);
      const piece = invoices.rows.find((i) => String(i.label ?? '').includes('septembre'));
      // Exigé AVANT le `not.toContain` : sans cette ligne, une pièce absente
      // ferait passer l'assertion suivante sans que rien n'ait été vérifié.
      expect(piece).toBeDefined();
      // « Abonnement Complet — septembre » sur 228 € ferait appeler un client
      // qui sait que Complet vaut 159 €.
      expect(String(piece!.label)).not.toContain('Complet');
      expect(String(piece!.label)).toContain('services');
      expect(bilan.emises.find((e) => e.slug === 'classfood')?.amountCents).toBe(
        MRR + ATELIER_PRESENCE_CENTS,
      );
    });

    /**
     * LA PROJECTION SE FAIT À SA PROPRE DATE, PAS À CELLE D'AUJOURD'HUI.
     *
     * « Prochaine échéance » annonçait le montant du jour appliqué au mois
     * suivant. Un fondateur dans son douzième mois lisait donc la moitié de ce
     * qui allait réellement être prélevé, et découvrait le tarif public sur son
     * relevé bancaire — le seul endroit où on ne veut pas qu'il l'apprenne.
     */
    it('un fondateur dont la remise s’éteint voit la VRAIE prochaine échéance', async () => {
      await sansAmorce();
      tenants.rows[0]!.founderSeat = true;
      tenants.rows[0]!.founderDiscountCents = MRR / 2;
      // Elle court le 19 août, elle est éteinte au 1er septembre.
      tenants.rows[0]!.founderUntil = new Date('2026-08-31T23:59:59.000Z');
      const fiche = await billing.tenantBilling(SM, CLASSFOOD, TOUT, LE_19_AOUT);
      // Ce qu'il paie ce mois-ci : la moitié. Ce qu'on lui prélèvera : tout.
      expect(fiche.subscription.mrrCents).toBe(MRR / 2);
      expect(fiche.nextDue?.amountCents).toBe(MRR);
    });

    it('la prochaine échéance d’un client annuel hors anniversaire n’annonce que ses services', async () => {
      await sansAmorce();
      tenants.rows[0]!.billingCycle = 'annuel';
      tenants.rows[0]!.atelier = { ...EMPTY_SERVICES, presenceInternet: true };
      // Signé en août, on projette septembre : le logiciel n'est pas dû.
      const fiche = await billing.tenantBilling(SM, CLASSFOOD, TOUT, LE_19_AOUT);
      expect(fiche.nextDue?.amountCents).toBe(ATELIER_PRESENCE_CENTS);
    });

    /**
     * LE CAS QUE LE TEST PRÉCÉDENT NE VOYAIT PAS.
     *
     * Avec des services mensuels, le mois prochain doit toujours quelque chose
     * et la projection tombe juste par accident. SANS services, un client à
     * l'engagement annuel ne doit rien onze mois sur douze : projeter le seul
     * mois suivant lui affichait « aucune échéance » presque toute l'année,
     * alors que son prélèvement existe et tombe à sa date anniversaire.
     *
     * La projection avance donc jusqu'au premier mois qui doit quelque chose.
     */
    it('un client annuel SANS services garde une échéance — à son anniversaire', async () => {
      await sansAmorce();
      tenants.rows[0]!.billingCycle = 'annuel';
      tenants.rows[0]!.atelier = null;
      const fiche = await billing.tenantBilling(SM, CLASSFOOD, TOUT, LE_19_AOUT);
      // Dix mensualités, et la date est le 1er août SUIVANT — pas septembre,
      // et surtout pas « aucune échéance ».
      expect(fiche.nextDue?.amountCents).toBe(MRR * 10);
      expect(fiche.nextDue?.at.slice(0, 7)).toBe('2027-08');
    });

    /**
     * LE MRR D'UN CLIENT ANNUEL N'EST PAS SA MENSUALITÉ FACIALE.
     *
     * « Douze mois payés dix » à 159 € rapporte 1 590 € l'an, soit 132,50 € par
     * mois. Sommer les mensualités faciales gonflait le MRR du parc de vingt
     * pour cent à chaque client annuel — et le MRR est le chiffre sur lequel on
     * décide d'embaucher ou de baisser un prix.
     */
    it('le MRR d’un client annuel est normalisé, pas sa mensualité faciale', async () => {
      await sansAmorce();
      tenants.rows[0]!.billingCycle = 'annuel';
      tenants.rows[0]!.atelier = null;
      const fiche = await billing.tenantBilling(SM, CLASSFOOD, TOUT, LE_19_AOUT);
      // Dix douzièmes de la mensualité, pas la mensualité entière.
      expect(fiche.subscription.mrrCents).toBe(Math.floor((MRR * 10) / 12));
      expect(fiche.subscription.mrrCents).not.toBe(MRR);
    });

    it('les services de l’Atelier entrent au mois, engagement ou pas', async () => {
      await sansAmorce();
      tenants.rows[0]!.billingCycle = 'annuel';
      tenants.rows[0]!.atelier = { ...EMPTY_SERVICES, presenceInternet: true };
      const fiche = await billing.tenantBilling(SM, CLASSFOOD, TOUT, LE_19_AOUT);
      // Le logiciel normalisé + la présence internet ENTIÈRE : sans
      // engagement, elle ne s'annualise jamais.
      expect(fiche.subscription.mrrCents).toBe(
        Math.floor((MRR * 10) / 12) + ATELIER_PRESENCE_CENTS,
      );
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

  // ─── Les lectures n'amorcent jamais le registre comptable ───

  describe('Aucune facture de démonstration créée par consultation', () => {
    afterEach(() => { vi.unstubAllEnvs(); });

    const expectEmptyLedger = () => {
      expect(invoices.rows).toHaveLength(0);
      expect(issuances.rows).toHaveLength(0);
      expect(counters.rows).toHaveLength(0);
      expect(billingLines()).toEqual([]);
    };

    it.each([undefined, 'on'])('garde la fiche vide avec SM_DEMO_SEED=%s', async (seed) => {
      vi.stubEnv('SM_DEMO_SEED', seed);
      const fiche = await billing.tenantBilling(SM, CLASSFOOD, TOUT, LE_19_AOUT);
      expect(fiche.invoices).toHaveLength(0);
      expect(fiche.outstanding.totalDueCents).toBe(0);
      expectEmptyLedger();
    });

    it('ne crée ni créance ni réservation depuis les lectures de recouvrement', async () => {
      vi.stubEnv('SM_DEMO_SEED', 'on');
      const [file, outstanding] = await Promise.all([
        billing.overdue(LE_19_AOUT),
        billing.outstandingFor(CLASSFOOD, LE_19_AOUT),
      ]);
      expect(file.count).toBe(0);
      expect(outstanding.totalDueCents).toBe(0);
      expectEmptyLedger();
    });

    it('deux instances et plusieurs consultations simultanées ne sèment aucune facture', async () => {
      vi.stubEnv('SM_DEMO_SEED', 'on');
      const other = new BillingService(invoices.asModel(), tenants.asModel<Tenant>(),
        new InvoiceWriterService(invoices.asModel(), issuances.asModel(), new InvoiceNumberingService(invoices.asModel(), counters.asModel())), admin);
      await Promise.all([
        billing.tenantBilling(SM, CLASSFOOD, TOUT, LE_19_AOUT),
        other.tenantBilling(SM, CLASSFOOD, TOUT, LE_19_AOUT),
        billing.overdue(LE_19_AOUT),
        other.outstandingFor(CLASSFOOD, LE_19_AOUT),
      ]);
      expectEmptyLedger();
    });

    it('conserve uniquement les pièces réellement émises lors des consultations suivantes', async () => {
      vi.stubEnv('SM_DEMO_SEED', 'on');
      const emitted = await billing.issue(SM, CLASSFOOD, emission({ period: '2026-09' }), LE_19_AOUT);
      const before = await invoices.find({}).lean();
      await Promise.all([
        billing.tenantBilling(SM, CLASSFOOD, TOUT, LE_19_AOUT),
        billing.overdue(LE_19_AOUT),
        billing.outstandingFor(CLASSFOOD, LE_19_AOUT),
      ]);
      expect(invoices.rows).toEqual(before);
      expect(invoices.rows.map((row) => row.number)).toEqual([emitted.number]);
      expect(counters.seqOf(invoiceCounterId(2026))).toBe(1);
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
