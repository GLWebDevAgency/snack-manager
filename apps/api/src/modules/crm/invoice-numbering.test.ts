import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { InvoiceNumberingService, validateInvoiceSnapshot } from './invoice-numbering.service';
import { copy, gate, invoiceSnapshot, numberingStore } from './invoice-numbering.fakes';

const SECOND_ID = '507f1f77bcf86cd799439013';
function setup() {
  const db = numberingStore();
  return { ...db, writer: () => new InvoiceNumberingService(db.invoices as never, db.counters as never) };
}

describe('numérotation durable des factures', () => {
  it('attribue une séquence annuelle continue à deux factures distinctes', async () => {
    const ctx = setup();
    expect((await ctx.writer().write(invoiceSnapshot())).number).toBe('SM-2026-0001');
    expect((await ctx.writer().write(invoiceSnapshot(SECOND_ID))).number).toBe('SM-2026-0002');
    expect(ctx.state.counter).toMatchObject({ _id: 'invoice:2026', seq: 2, pendingInvoice: null });
    expect(ctx.state.invoices.size).toBe(2);
  });

  it.each([false, true])('deux writers concurrents (identités différentes = %s) ne gaspillent aucun numéro', async (different) => {
    const ctx = setup();
    const parked = gate();
    const resume = gate();
    let firstRead = true;
    ctx.hooks.afterInvoiceRead = async (row) => {
      if (!row && firstRead) { firstRead = false; parked.release(); await resume.promise; }
    };
    const first = ctx.writer().write(invoiceSnapshot());
    await parked.promise;
    const second = await ctx.writer().write(invoiceSnapshot(different ? SECOND_ID : undefined));
    resume.release();
    const result = await first;
    expect(ctx.state.counter?.seq).toBe(different ? 2 : 1);
    expect(ctx.state.invoices.size).toBe(different ? 2 : 1);
    expect(ctx.state.counter?.pendingInvoice).toBeNull();
    if (!different) expect(result.number).toBe(second.number);
  });

  it('tolère la collision unique lors de l’initialisation du compteur', async () => {
    const ctx = setup();
    ctx.hooks.duplicateOnInit = true;
    expect((await ctx.writer().write(invoiceSnapshot())).number).toBe('SM-2026-0001');
  });

  it('reprend une réponse perdue après réservation sans décrément ni nouveau numéro', async () => {
    const ctx = setup();
    ctx.hooks.afterClaim = async () => { throw new Error('connection lost after claim'); };
    await expect(ctx.writer().write(invoiceSnapshot())).rejects.toThrow('connection lost');
    expect(ctx.state.counter?.seq).toBe(1);
    expect(ctx.state.counter?.pendingInvoice).toBeTruthy();
    ctx.hooks.afterClaim = undefined;
    expect((await ctx.writer().write(invoiceSnapshot())).number).toBe('SM-2026-0001');
    expect(ctx.state.counter?.seq).toBe(1);
    expect(ctx.state.counter?.pendingInvoice).toBeNull();
  });

  it.each(['before', 'after'] as const)('une panne %s insertion laisse le pending au prochain helper', async (moment) => {
    const ctx = setup();
    const hook = moment === 'before' ? 'beforeInvoiceInsert' : 'afterInvoiceInsert';
    ctx.hooks[hook] = async () => { throw new Error('insertion response lost'); };
    await expect(ctx.writer().write(invoiceSnapshot())).rejects.toThrow('response lost');
    expect(ctx.state.counter?.seq).toBe(1);
    expect(ctx.state.counter?.pendingInvoice).toBeTruthy();
    ctx.hooks[hook] = undefined;
    const next = await ctx.writer().write(invoiceSnapshot(SECOND_ID));
    expect(next.number).toBe('SM-2026-0002');
    expect(ctx.state.invoices.get(String(invoiceSnapshot()._id))?.number).toBe('SM-2026-0001');
    expect(ctx.state.counter).toMatchObject({ seq: 2, pendingInvoice: null });
  });

  it('un helper tardif ne ressuscite pas une facture annulée et ne nettoie pas le pending suivant', async () => {
    const ctx = setup();
    const snapshot = invoiceSnapshot();
    ctx.state.counter = { _id: 'invoice:2026', seq: 1, pendingInvoice: { snapshot: copy(snapshot), number: 'SM-2026-0001' } };
    ctx.state.invoices.set(String(snapshot._id), { ...copy(snapshot), number: 'SM-2026-0001' });
    const parked = gate();
    const resume = gate();
    let first = true;
    ctx.hooks.beforeInvoiceInsert = async () => {
      if (first) { first = false; parked.release(); await resume.promise; }
    };
    const late = ctx.writer().write(snapshot);
    await parked.promise;
    await ctx.writer().write(snapshot);
    const updatedAt = new Date('2026-09-05T00:00:00Z');
    Object.assign(ctx.state.invoices.get(String(snapshot._id))!, {
      status: 'annulee', cancelledAt: updatedAt, cancelReason: 'Erreur de contrat',
      issuedAt: updatedAt, updatedAt,
    });
    ctx.state.counter = { _id: 'invoice:2026', seq: 2,
      pendingInvoice: { snapshot: invoiceSnapshot(SECOND_ID), number: 'SM-2026-0002' } };
    resume.release();
    expect(await late).toMatchObject({ status: 'annulee', cancelReason: 'Erreur de contrat', updatedAt });
    expect(ctx.state.invoices.get(SECOND_ID)?.number).toBe('SM-2026-0002');
    expect(ctx.state.counter).toMatchObject({ seq: 2, pendingInvoice: null });
    expect(ctx.counters.updateOne).toHaveBeenCalledWith(expect.objectContaining({
      seq: 1, 'pendingInvoice.snapshot._id': snapshot._id, 'pendingInvoice.number': 'SM-2026-0001',
    }), { $set: { pendingInvoice: null } }, { writeConcern: { w: 'majority', j: true, wtimeout: 10000 } });
  });

  it('un numéro pending incohérent bloque sans insertion ni libération de réservation', async () => {
    const ctx = setup();
    ctx.state.counter = { _id: 'invoice:2026', seq: 1,
      pendingInvoice: { snapshot: invoiceSnapshot(), number: 'SM-2026-0099' } };
    await expect(ctx.writer().write(invoiceSnapshot())).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.invoices.updateOne).not.toHaveBeenCalled();
    expect(ctx.state.counter.pendingInvoice).toBeTruthy();
    expect(ctx.state.counter.seq).toBe(1);
  });

  it('une collision de numéro avec un autre ID n’est jamais traitée comme un rejeu', async () => {
    const ctx = setup();
    ctx.state.invoices.set(SECOND_ID, { ...invoiceSnapshot(SECOND_ID), number: 'SM-2026-0001' });
    await expect(ctx.writer().write(invoiceSnapshot())).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.state.counter).toMatchObject({ seq: 1, pendingInvoice: { number: 'SM-2026-0001' } });
    expect(ctx.state.invoices.size).toBe(1);
  });

  it.each([
    ['number', 'SM-2026-0010'], ['tenantId', invoiceSnapshot(SECOND_ID)._id],
    ['kind', 'option'], ['label', 'Autre contrat'], ['amountCents', 100],
    ['period', { start: new Date('2026-08-01'), end: new Date('2026-09-01') }],
    ['vat', { ratePercent: 10, amountsAre: 'ht' }], ['dueAt', new Date('2026-09-02')],
  ] as [string, unknown][])('ne libère pas un pending dont la facture matérialisée diverge sur %s', async (field, value) => {
    const ctx = setup();
    const snapshot = invoiceSnapshot();
    ctx.state.counter = { _id: 'invoice:2026', seq: 1,
      pendingInvoice: { snapshot, number: 'SM-2026-0001' } };
    ctx.state.invoices.set(String(snapshot._id), { ...copy(snapshot), number: 'SM-2026-0001', [field]: value });
    await expect(ctx.writer().write(snapshot)).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.state.counter.pendingInvoice).toBeTruthy();
    expect(ctx.state.invoices.get(String(snapshot._id))?.[field]).toEqual(value);
  });

  it('rejoue une facture payée sans réécrire son état ni réserver de numéro', async () => {
    const ctx = setup();
    const snapshot = invoiceSnapshot();
    await ctx.writer().write(snapshot);
    Object.assign(ctx.state.invoices.get(String(snapshot._id))!, { status: 'payee', method: 'carte', paidAt: new Date() });
    const updates = ctx.invoices.updateOne.mock.calls.length;
    expect(await ctx.writer().write(snapshot)).toMatchObject({ status: 'payee', method: 'carte' });
    expect(ctx.invoices.updateOne.mock.calls).toHaveLength(updates);
    expect(ctx.state.counter?.seq).toBe(1);
  });

  it('refuse le même identifiant avec un montant différent, même sans pending', async () => {
    const ctx = setup();
    await ctx.writer().write(invoiceSnapshot());
    await expect(ctx.writer().write({ ...invoiceSnapshot(), amountCents: 1000 })).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.state.counter?.seq).toBe(1);
  });

  it.each([
    ['amountCents', 1.2], ['amountCents', Number.MAX_SAFE_INTEGER + 1], ['dueAt', new Date('bad')],
    ['label', ''], ['_id', 'invalid'], ['_id', 42], ['status', 'unknown'], ['status', 'en_retard'],
    ['vat', { ratePercent: NaN, amountsAre: 'ht' }],
  ] as [string, unknown][])('valide %s avant toute réservation', async (field, value) => {
    const ctx = setup();
    const snapshot = { ...invoiceSnapshot(), [field]: value };
    expect(() => validateInvoiceSnapshot(snapshot)).toThrow(BadRequestException);
    await expect(ctx.writer().write(snapshot)).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.counters.updateOne).not.toHaveBeenCalled();
  });

  it('autorise un avoir négatif dans la même séquence sans corriger son signe', async () => {
    const ctx = setup();
    expect(await ctx.writer().write({ ...invoiceSnapshot(), kind: 'avoir', amountCents: -14900 }))
      .toMatchObject({ number: 'SM-2026-0001', amountCents: -14900, kind: 'avoir' });
  });

  it('demande un acquittement durable et des lectures primaires majoritaires bornées', async () => {
    const ctx = setup();
    await ctx.writer().write(invoiceSnapshot());
    const options = [
      ...ctx.counters.updateOne.mock.calls.map((call) => call[2]),
      ...ctx.invoices.updateOne.mock.calls.map((call) => call[2]),
    ];
    expect(options).toHaveLength(4);
    for (const value of options) {
      expect(value).toMatchObject({ writeConcern: { w: 'majority', j: true, wtimeout: 10000 } });
    }
    expect(ctx.readPreferences).toHaveLength(ctx.counters.findById.mock.calls.length + ctx.invoices.findById.mock.calls.length);
    expect(new Set(ctx.readPreferences)).toEqual(new Set(['primary']));
    expect(ctx.reads.every((options) => options.concern === 'majority' && options.maxTimeMS === 10_000)).toBe(true);
  });

  it('ne matérialise pas un pending visible localement mais perdu lors du basculement de primaire', async () => {
    const ctx = setup();
    const phantom = invoiceSnapshot();
    let first = true;
    ctx.hooks.counterView = (committed, options) => {
      if (!first) return committed;
      first = false;
      // Le nouveau primaire conserve seq0 : l'ancien primaire avait exposé
      // seq1/pending localement avant son acquittement majoritaire, puis rollback.
      return options.concern === 'majority' ? committed : {
        _id: 'invoice:2026', seq: 1,
        pendingInvoice: { snapshot: phantom, number: 'SM-2026-0001' },
      };
    };
    expect((await ctx.writer().write(invoiceSnapshot(SECOND_ID))).number).toBe('SM-2026-0001');
    expect(ctx.state.invoices.has(String(phantom._id))).toBe(false);
    expect(ctx.state.counter).toMatchObject({ seq: 1, pendingInvoice: null });
  });

  it('une lecture majoritaire indisponible échoue sans matérialiser ni libérer le pending', async () => {
    const ctx = setup();
    ctx.state.counter = { _id: 'invoice:2026', seq: 1,
      pendingInvoice: { snapshot: invoiceSnapshot(), number: 'SM-2026-0001' } };
    ctx.hooks.counterView = (committed, options) => {
      if (options.concern === 'majority') throw new Error('majority read timed out');
      return committed;
    };
    await expect(ctx.writer().write(invoiceSnapshot(SECOND_ID))).rejects.toThrow('majority read timed out');
    expect(ctx.invoices.updateOne).not.toHaveBeenCalled();
    expect(ctx.state.counter).toMatchObject({ seq: 1, pendingInvoice: { number: 'SM-2026-0001' } });
  });

  it('une réponse perdue après nettoyage ne réattribue pas le numéro à la reprise', async () => {
    const ctx = setup();
    ctx.hooks.afterClear = async () => { throw new Error('write concern timeout after clear'); };
    await expect(ctx.writer().write(invoiceSnapshot())).rejects.toThrow('write concern timeout');
    expect(ctx.state.counter).toMatchObject({ seq: 1, pendingInvoice: null });
    ctx.hooks.afterClear = undefined;
    expect((await ctx.writer().write(invoiceSnapshot())).number).toBe('SM-2026-0001');
    expect(ctx.state.counter?.seq).toBe(1);
  });

  it('borne la contention sans boucler ni modifier le compteur à l’aveugle', async () => {
    const ctx = setup();
    ctx.hooks.loseEveryClaim = true;
    await expect(ctx.writer().write(invoiceSnapshot())).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(ctx.counters.findById.mock.calls.length).toBeLessThanOrEqual(64);
    expect(ctx.state.counter).toMatchObject({ seq: 0, pendingInvoice: null });
    expect(ctx.invoices.updateOne).not.toHaveBeenCalled();
  });

  it('copie l’instantané avant le premier await pour ne pas figer des modifications du demandeur', async () => {
    const ctx = setup();
    const parked = gate();
    const resume = gate();
    let once = true;
    ctx.hooks.afterCounterRead = async () => {
      if (once) { once = false; parked.release(); await resume.promise; }
    };
    const snapshot = invoiceSnapshot();
    const writing = ctx.writer().write(snapshot);
    await parked.promise;
    snapshot.amountCents = 1;
    snapshot.dueAt.setUTCFullYear(2027);
    resume.release();
    expect(await writing).toMatchObject({ number: 'SM-2026-0001', amountCents: 14900 });
  });
});
