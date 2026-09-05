import { describe, expect, it } from 'vitest';
import { Mongoose, Types } from 'mongoose';
import { CounterSchema, InvoiceSchema, MODELS } from './schemas';
import { InvoiceIssuanceSchema } from './invoice-issuance.schema';

describe('réservations persistantes de facturation', () => {
  it('enregistre une collection indépendante à identité naturelle, sans TTL', () => {
    expect(MODELS.InvoiceIssuance.collection).toBe('invoiceIssuances');
    expect(InvoiceIssuanceSchema.path('_id').instance).toBe('String');
    expect(InvoiceIssuanceSchema.indexes().some(([, options]) => options.expireAfterSeconds !== undefined)).toBe(false);
    expect(CounterSchema.indexes().some(([, options]) => options.expireAfterSeconds !== undefined)).toBe(false);
  });

  it('ne transforme pas l’index historique des périodes en index unique', () => {
    const index = InvoiceSchema.indexes().find(([keys]) => keys['period.start'] === 1);
    expect(index?.[1].unique).not.toBe(true);
    expect(InvoiceSchema.indexes().find(([keys]) => keys.number === 1)?.[1].unique).toBe(true);
  });

  it('conserve un instantané typé dans le compteur annuel sans changer les compteurs POS', () => {
    const isolated = new Mongoose();
    const Counter = isolated.model('InvoiceCounterShape', CounterSchema);
    const daily = new Counter({ _id: 'restaurant:20260905', seq: 7 });
    expect(daily.validateSync()).toBeUndefined();
    expect(daily.pendingInvoice).toBeNull();
    const annual = new Counter({
      _id: 'invoice:2026', seq: 8, pendingInvoice: {
        number: 'SM-2026-0008', snapshot: {
          _id: new Types.ObjectId(), tenantId: new Types.ObjectId(),
          kind: 'abonnement', label: 'Abonnement septembre', amountCents: 7900,
          period: { start: new Date('2026-09-01'), end: new Date('2026-09-30T23:59:59.999Z') },
          dueAt: new Date('2026-09-01'), status: 'envoyee',
          vat: { ratePercent: 20, amountsAre: 'ht' },
        },
      },
    });
    expect(annual.validateSync()).toBeUndefined();
    expect(annual.toObject().pendingInvoice?.snapshot.amountCents).toBe(7900);
  });
});
