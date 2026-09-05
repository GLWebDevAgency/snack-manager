import { describe, expect, it } from 'vitest';
import {
  auditBillingMigration,
  billingCycleCoverage,
  billingObligationId,
  canEmitBillingObligation,
  type BillingMigrationInput,
  type MigrationObligation,
} from './billing-migration';

const START = '2026-09-07T12:00:00.000Z';
const END = '2027-09-07T12:00:00.000Z';
const scope = { tenantId: 'classfood', contractId: 'contract-1' };

function obligation(overrides: Partial<MigrationObligation> = {}): MigrationObligation {
  return {
    ...scope,
    streamId: 'software',
    coverage: { start: START, end: END },
    dueAt: START,
    amountCents: 79_500,
    taxCents: 15_900,
    totalCents: 95_400,
    ...overrides,
  };
}

function fixture(): BillingMigrationInput {
  const software = obligation();
  const atelier = obligation({
    streamId: 'atelier',
    coverage: { start: START, end: '2026-10-07T12:00:00.000Z' },
    amountCents: 3_450,
    taxCents: 690,
    totalCents: 4_140,
  });
  const signedSchedule = [software, atelier];
  return {
    context: { ...scope, platformAccountId: 'acct_platform', environment: 'test', currency: 'eur', amountBasis: 'ht' },
    contract: {
      ...scope,
      revision: 1,
      proposalId: 'signed-proposal-1',
      firstPaidServiceAt: START,
      streams: [
        { streamId: 'software', nature: 'software', cadence: 'annual', monthlyCents: 15_900 },
        { streamId: 'atelier', nature: 'atelier', cadence: 'monthly', monthlyCents: 6_900 },
      ],
      founder: {
        monthlyDiscountCents: 11_400,
        until: '2027-08-24T12:00:00.000Z',
        allocations: [
          { streamId: 'software', monthlyCents: 7_950 },
          { streamId: 'atelier', monthlyCents: 3_450 },
        ],
      },
    },
    cutoverAt: START,
    signedSchedule,
    observedSchedule: structuredClone(signedSchedule),
    assignments: signedSchedule.map((line) => ({ obligationId: billingObligationId(line), provider: 'legacy' })),
    history: [],
    stripeBinding: null,
  };
}

function withBinding(): BillingMigrationInput {
  const input = fixture();
  input.stripeBinding = {
    ...input.context,
    customerId: 'cus_classfood',
    streams: [
      { streamId: 'software', priceId: 'price_annual', subscriptionId: 'sub_software', subscriptionItemId: 'si_software', cadence: 'annual', unitAmountCents: 159_000 },
      { streamId: 'atelier', priceId: 'price_monthly', subscriptionId: 'sub_atelier', subscriptionItemId: 'si_atelier', cadence: 'monthly', unitAmountCents: 6_900 },
    ],
  };
  return input;
}

const codes = (input: BillingMigrationInput) => auditBillingMigration(input).issues.map((issue) => issue.code);

describe('B1 — rapprochement pur, pas une autorisation de mise en production', () => {
  it('accepte un instantané cohérent, sans changer ni émettre quoi que ce soit', () => {
    const input = fixture();
    const before = structuredClone(input);
    const result = auditBillingMigration(input);
    expect(result).toMatchObject({ status: 'consistent_snapshot', issues: [] });
    expect(result.obligationIds).toHaveLength(2);
    expect(input).toEqual(before);
  });

  it('détecte le contre-exemple réel : 795 €/an + 34,50 €/mois devient 450 €/an + 69 €/mois', () => {
    const input = fixture();
    input.observedSchedule = [
      obligation({ amountCents: 45_000, taxCents: 9_000, totalCents: 54_000 }),
      { ...input.signedSchedule[1]!, amountCents: 6_900, taxCents: 1_380, totalCents: 8_280 },
    ];
    expect(auditBillingMigration(input).status).toBe('reconciliation_required');
    expect(codes(input)).toContain('schedule_amount_mismatch');
  });

  it('détecte l’anniversaire avancé au mois de création au lieu de la fin d’essai', () => {
    const input = fixture();
    input.observedSchedule[0] = {
      ...input.observedSchedule[0]!,
      coverage: { start: '2026-08-24T12:00:00.000Z', end: '2027-08-24T12:00:00.000Z' },
      dueAt: '2026-08-24T12:00:00.000Z',
    };
    expect(codes(input)).toContain('schedule_coverage_mismatch');
    expect(auditBillingMigration(input).status).toBe('reconciliation_required');
  });

  it('ne fabrique pas une allocation de remise inconnue depuis l’offre courante', () => {
    const input = fixture();
    input.contract.founder!.allocations = null;
    expect(codes(input)).toContain('founder_allocation_unresolved');
  });

  it('refuse que deux calendriers identiquement faux prouvent le respect du devis', () => {
    const input = fixture();
    input.signedSchedule[0]!.amountCents = 45_000;
    input.signedSchedule[0]!.taxCents = 9_000;
    input.signedSchedule[0]!.totalCents = 54_000;
    input.observedSchedule = structuredClone(input.signedSchedule);
    expect(codes(input)).toContain('signed_amount_mismatch');
  });

  it('contrôle la remise à la date de l’échéance, sans horloge système', () => {
    const input = fixture();
    input.contract.founder!.until = START;
    expect(codes(input)).toContain('signed_amount_mismatch');
    input.contract.founder!.until = '2026-09-07T12:00:00.001Z';
    expect(codes(input)).not.toContain('signed_amount_mismatch');
  });

  it('rapproche 24 mois : annuel ×10, Atelier mensuel, puis expiration sans prolongation', () => {
    const input = fixture();
    const at = (month: number): string => new Date(Date.UTC(2026, 8 + month, 7, 12)).toISOString();
    const line = (streamId: string, month: number, duration: number, amountCents: number): MigrationObligation => obligation({
      streamId, coverage: { start: at(month), end: at(month + duration) }, dueAt: at(month),
      amountCents, taxCents: amountCents / 5, totalCents: amountCents + amountCents / 5,
    });
    input.signedSchedule = [line('software', 0, 12, 79_500), line('software', 12, 12, 159_000)];
    for (let month = 0; month < 24; month += 1) input.signedSchedule.push(line('atelier', month, 1, month < 12 ? 3_450 : 6_900));
    input.observedSchedule = structuredClone(input.signedSchedule);
    input.assignments = input.signedSchedule.map((item) => ({ obligationId: billingObligationId(item), provider: 'legacy' }));

    expect(auditBillingMigration(input)).toMatchObject({ status: 'consistent_snapshot', issues: [] });
    const yearTotal = (from: string, to: string): number => input.signedSchedule.filter((item) => item.dueAt >= from && item.dueAt < to).reduce((sum, item) => sum + item.amountCents, 0);
    expect(yearTotal(at(0), at(12))).toBe(120_900);
    expect(yearTotal(at(12), at(24))).toBe(241_800);
    expect(input.contract.founder!.until).toBe('2027-08-24T12:00:00.000Z');
    expect(input.contract.founder!.monthlyDiscountCents).toBe(11_400);
  });

  it('un flux ajouté après signature ne récupère aucune remise des flux initiaux', () => {
    const input = fixture();
    input.contract.revision = 2;
    input.contract.streams.push({ streamId: 'new-service', nature: 'atelier', cadence: 'monthly', monthlyCents: 6_000 });
    const added = obligation({ streamId: 'new-service', coverage: { start: START, end: '2026-10-07T12:00:00.000Z' }, amountCents: 6_000, taxCents: 1_200, totalCents: 7_200 });
    input.signedSchedule.push(added);
    input.observedSchedule.push(structuredClone(added));
    input.assignments.push({ obligationId: billingObligationId(added), provider: 'legacy' });
    expect(auditBillingMigration(input).status).toBe('consistent_snapshot');
    expect(input.contract.founder!.monthlyDiscountCents).toBe(11_400);
    input.observedSchedule[2] = { ...added, amountCents: 3_000, taxCents: 600, totalCents: 3_600 };
    expect(codes(input)).toContain('schedule_amount_mismatch');
  });

  it('ne transforme pas un dépassement de remise en avoir négatif', () => {
    const input = fixture();
    input.contract.streams[0]!.monthlyCents = 1_000;
    input.signedSchedule[0] = { ...input.signedSchedule[0]!, amountCents: 0, taxCents: 0, totalCents: 0 };
    input.observedSchedule = structuredClone(input.signedSchedule);
    expect(auditBillingMigration(input).status).toBe('consistent_snapshot');
    // Le résultat ne commande aucune facture à zéro : B1 n'émet aucune pièce.
    expect(input.contract.founder!.monthlyDiscountCents).toBe(11_400);
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('refuse un montant non monétaire : %s', (amountCents) => {
    const input = fixture();
    input.observedSchedule[0]!.amountCents = amountCents;
    expect(codes(input)).toContain('invalid_cents');
  });

  it('refuse le dépassement de capacité de la multiplication annuelle', () => {
    const input = fixture();
    input.contract.streams[0]!.monthlyCents = Number.MAX_SAFE_INTEGER;
    expect(codes(input)).toContain('invalid_cents');
  });

  it.each(['2026-02-30T12:00:00.000Z', '2026-09-07', '2026-09-07T14:00:00+02:00', 'invalid'])('refuse une date ambiguë ou inexistante : %s', (dueAt) => {
    const input = fixture();
    input.signedSchedule[0]!.dueAt = dueAt;
    expect(codes(input)).toContain('invalid_date');
  });

  it('refuse une annuelle dont la couverture n’est qu’un mois de classement historique', () => {
    const input = fixture();
    input.signedSchedule[0]!.coverage.end = '2026-10-07T12:00:00.000Z';
    expect(codes(input)).toContain('invalid_coverage');
  });

  it('refuse une obligation doublée même avec une révision de contrat différente', () => {
    const input = fixture();
    input.contract.revision = 2;
    input.observedSchedule.push(structuredClone(input.observedSchedule[0]!));
    expect(codes(input)).toContain('duplicate_obligation');
  });

  it('refuse des couvertures qui se chevauchent dans le même flux', () => {
    const input = fixture();
    input.observedSchedule.push({ ...input.observedSchedule[0]!, coverage: { start: '2027-08-07T12:00:00.000Z', end: '2028-08-07T12:00:00.000Z' } });
    expect(codes(input)).toContain('overlapping_coverage');
  });

  it('refuse un flux vendu mais absent du calendrier fourni', () => {
    const input = fixture();
    input.signedSchedule.pop();
    expect(codes(input)).toContain('missing_stream_schedule');
  });

  it('refuse un autre tenant ou un autre contrat sur une échéance', () => {
    const input = fixture();
    input.observedSchedule[0]!.tenantId = 'autre';
    expect(codes(input)).toContain('scope_mismatch');
    input.observedSchedule[0]!.tenantId = scope.tenantId;
    input.observedSchedule[0]!.contractId = 'autre';
    expect(codes(input)).toContain('scope_mismatch');
  });

  it('refuse deux propriétaires et un propriétaire absent pour une obligation', () => {
    const input = fixture();
    input.assignments.push({ ...input.assignments[0]!, provider: 'stripe' });
    expect(codes(input)).toContain('duplicate_assignment');
    input.assignments = [];
    expect(codes(input)).toContain('missing_assignment');
  });

  it('ne confond pas un snapshot migration_pending avec une émission autorisée', () => {
    const input = fixture();
    input.assignments[0]!.provider = 'migration_pending';
    expect(codes(input)).toContain('migration_pending');
    const assignment = input.assignments[0]!;
    expect(canEmitBillingObligation(assignment, assignment.obligationId, 'legacy')).toBe(false);
    expect(canEmitBillingObligation(assignment, assignment.obligationId, 'stripe')).toBe(false);
  });

  it.each(['unpaid', 'draft'] as const)('bloque une ancienne pièce %s, même hors du prochain calendrier', (status) => {
    const input = fixture();
    input.history = [{ ...scope, invoiceId: 'old', number: 'SM-2025-0001', status, paymentUnresolved: false, coverages: [{ streamId: 'software', coverage: { start: '2025-09-07T12:00:00.000Z', end: START } }] }];
    expect(codes(input)).toContain('legacy_unsettled');
  });

  it('bloque un Checkout historique non rapproché, même sur pièce annulée', () => {
    const input = fixture();
    input.history = [{ ...scope, invoiceId: 'old', number: 'SM-2025-0001', status: 'cancelled', paymentUnresolved: true, coverages: [] }];
    expect(codes(input)).toContain('legacy_payment_unresolved');
  });

  it('ne refacture pas une couverture annuelle déjà payée', () => {
    const input = fixture();
    input.history = [{ ...scope, invoiceId: 'old', number: 'SM-2026-0001', status: 'paid', paymentUnresolved: false, coverages: [{ streamId: 'software', coverage: { start: START, end: END } }] }];
    expect(codes(input)).toContain('legacy_coverage_overlap');
  });

  it('une ancienne pièce dont la couverture est inconnue ne devient pas migrable par défaut', () => {
    const input = fixture();
    input.history = [{ ...scope, invoiceId: 'old', number: 'SM-2026-0001', status: 'paid', paymentUnresolved: false, coverages: null }];
    expect(codes(input)).toContain('legacy_coverage_unresolved');
  });

  it('conserve une pièce réglée exactement jusqu’à la coupure sans chevauchement', () => {
    const input = fixture();
    input.history = [{ ...scope, invoiceId: 'old', number: 'SM-2025-0001', status: 'paid', paymentUnresolved: false, coverages: [{ streamId: 'software', coverage: { start: '2025-09-07T12:00:00.000Z', end: START } }] }];
    expect(auditBillingMigration(input).status).toBe('consistent_snapshot');
    expect(input.history[0]!.number).toBe('SM-2025-0001');
  });

  it('ne cache pas deux anciennes pièces couvrant la même obligation déjà payée', () => {
    const input = fixture();
    input.history = ['old-1', 'old-2'].map((invoiceId, index) => ({
      ...scope, invoiceId, number: `SM-2025-000${index + 1}`, status: 'paid', paymentUnresolved: false,
      coverages: [{ streamId: 'software', coverage: { start: '2025-09-07T12:00:00.000Z', end: START } }],
    }));
    expect(codes(input)).toContain('legacy_duplicate_coverage');
  });

  it('n’autorise pas la source Stripe sans correspondance de fournisseur', () => {
    const input = fixture();
    input.assignments[0]!.provider = 'stripe';
    expect(codes(input)).toContain('binding_mismatch');
  });

  it('ne confond pas une date d’échéance modifiée avec une nouvelle obligation', () => {
    const input = fixture();
    input.observedSchedule[0]!.dueAt = '2026-09-08T12:00:00.000Z';
    expect(codes(input)).toContain('schedule_due_mismatch');
    expect(billingObligationId(input.observedSchedule[0]!)).toBe(billingObligationId(input.signedSchedule[0]!));
  });

  it('refuse une taxe entière mais un total incohérent', () => {
    const input = fixture();
    input.observedSchedule[0]!.totalCents += 1;
    expect(codes(input)).toContain('invalid_totals');
  });

  it('ne permet pas à une coupure au milieu de la couverture de provoquer un nouveau débit', () => {
    const input = fixture();
    input.cutoverAt = '2026-09-08T12:00:00.000Z';
    expect(codes(input)).toContain('cutoff_overlap');
  });

  it.each(['before_cutover', 'before_first_paid_service'])('ne certifie pas une échéance anticipée %s sans preuve des conditions de règlement', (boundary) => {
    const input = fixture();
    if (boundary === 'before_cutover') input.contract.firstPaidServiceAt = '2025-09-07T12:00:00.000Z';
    else input.cutoverAt = '2026-08-01T12:00:00.000Z';
    for (const schedule of [input.signedSchedule, input.observedSchedule]) {
      for (const line of schedule) line.dueAt = '2026-09-06T12:00:00.000Z';
    }
    const before = structuredClone(input);
    expect(codes(input)).toContain('advance_terms_unresolved');
    expect(auditBillingMigration(input).status).toBe('reconciliation_required');
    expect(input).toEqual(before);
  });

  it('conserve les conditions de règlement décalées après le début de couverture', () => {
    const input = fixture();
    for (const schedule of [input.signedSchedule, input.observedSchedule]) {
      for (const line of schedule) line.dueAt = '2026-09-30T12:00:00.000Z';
    }
    expect(auditBillingMigration(input)).toMatchObject({ status: 'consistent_snapshot', issues: [] });
  });

  it('ne change pas l’instantané gelé et ne lui rattache aucun objet de résultat mutable', () => {
    const input = fixture();
    const freeze = (value: unknown): void => {
      if (value !== null && typeof value === 'object') {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
      }
    };
    freeze(input);
    const result = auditBillingMigration(input);
    result.obligationIds.length = 0;
    expect(auditBillingMigration(input).obligationIds).toHaveLength(2);
  });
});

describe('correspondances fournisseur déclarées — jamais vérifiées par un appel Stripe dans B1', () => {
  function withReusedPrice(): BillingMigrationInput {
    const input = withBinding();
    input.contract.streams.push({ streamId: 'software-second', nature: 'software', cadence: 'annual', monthlyCents: 15_900 });
    const second = obligation({ streamId: 'software-second', amountCents: 159_000, taxCents: 31_800, totalCents: 190_800 });
    input.signedSchedule.push(second);
    input.observedSchedule.push(structuredClone(second));
    input.assignments.push({ obligationId: billingObligationId(second), provider: 'stripe' });
    input.stripeBinding!.streams.push({ ...input.stripeBinding!.streams[0]!,
      streamId: second.streamId, subscriptionId: 'sub_second', subscriptionItemId: 'si_second' });
    return input;
  }

  it('accepte des abonnements distincts aux cadences effectivement signées', () => {
    expect(auditBillingMigration(withBinding()).status).toBe('consistent_snapshot');
  });

  it.each(['tenantId', 'contractId', 'platformAccountId', 'environment', 'currency', 'amountBasis'] as const)('refuse un binding divergent : %s', (field) => {
    const input = withBinding();
    Object.assign(input.stripeBinding!, { [field]: 'other' });
    expect(codes(input)).toContain('binding_mismatch');
  });

  it('refuse un prix annuel douze fois le mensuel au lieu des dix mensualités signées', () => {
    const input = withBinding();
    input.stripeBinding!.streams[0]!.unitAmountCents = 15_900 * 12;
    expect(codes(input)).toContain('binding_mismatch');
  });

  it('ne remplace pas un service Atelier mensuel par un abonnement annuel', () => {
    const input = withBinding();
    input.stripeBinding!.streams[1]!.cadence = 'annual';
    expect(codes(input)).toContain('binding_mismatch');
  });

  it('refuse un même item fournisseur affecté à deux flux facturés', () => {
    const input = withBinding();
    input.stripeBinding!.streams[1]!.subscriptionItemId = 'si_software';
    expect(codes(input)).toContain('binding_mismatch');
  });

  it('refuse une correspondance incomplète', () => {
    const input = withBinding();
    input.stripeBinding!.streams.pop();
    expect(codes(input)).toContain('binding_mismatch');
  });

  it('autorise un même prix réutilisé avec exactement le même montant et la même cadence', () => {
    expect(auditBillingMigration(withReusedPrice())).toMatchObject({ status: 'consistent_snapshot', issues: [] });
  });

  it.each(['amount', 'cadence'])('un même prix ne peut déclarer deux valeurs de %s incompatibles', (different) => {
    const input = withReusedPrice();
    const second = input.signedSchedule[2]!;
    if (different === 'amount') {
      input.contract.streams[2]!.monthlyCents = 16_900;
      input.stripeBinding!.streams[2]!.unitAmountCents = 169_000;
      Object.assign(second, { amountCents: 169_000, taxCents: 33_800, totalCents: 202_800 });
    } else {
      input.contract.streams[2] = { streamId: second.streamId, nature: 'software', cadence: 'monthly', monthlyCents: 159_000 };
      input.stripeBinding!.streams[2]!.cadence = 'monthly';
      second.coverage.end = '2026-10-07T12:00:00.000Z';
      input.assignments[2]!.obligationId = billingObligationId(second);
    }
    input.observedSchedule = structuredClone(input.signedSchedule);
    expect(codes(input)).toContain('binding_mismatch');
    expect(auditBillingMigration(input).status).toBe('reconciliation_required');
  });

  it.each(['test', 'live'] as const)('aucun environnement ne dispense de contrôle : %s', (environment) => {
    const input = withBinding();
    input.context.environment = environment;
    input.stripeBinding!.environment = environment;
    expect(auditBillingMigration(input).status).toBe('consistent_snapshot');
    input.stripeBinding!.platformAccountId = 'acct_restaurant_connect';
    expect(codes(input)).toContain('binding_mismatch');
  });
});

describe('identité et calendrier B1', () => {
  it('l’identité ignore fournisseur/révision et distingue tenant, contrat, flux et couverture', () => {
    const original = obligation();
    expect(billingObligationId({ ...original, provider: 'stripe', revision: 2 } as MigrationObligation)).toBe(billingObligationId(original));
    for (const variant of [{ tenantId: 'other' }, { contractId: 'other' }, { streamId: 'other' }]) {
      expect(billingObligationId({ ...original, ...variant })).not.toBe(billingObligationId(original));
    }
    expect(billingObligationId({ ...original, coverage: { start: END, end: '2028-09-07T12:00:00.000Z' } })).not.toBe(billingObligationId(original));
  });

  it('encode les segments sans collision de séparateur', () => {
    expect(billingObligationId(obligation({ tenantId: 'a:b', contractId: 'c' }))).not.toBe(billingObligationId(obligation({ tenantId: 'a', contractId: 'b:c' })));
  });

  it('une année couvre douze mois calendaires, pas 365 jours constants', () => {
    expect(billingCycleCoverage('2027-09-07T12:00:00.000Z', 'annual', 0)).toEqual({ start: '2027-09-07T12:00:00.000Z', end: '2028-09-07T12:00:00.000Z' });
  });

  it('l’ancre originale survit au repli de février, sans dérive vers le 28 chaque mois', () => {
    const anchor = '2027-01-31T09:00:00.000Z';
    expect(billingCycleCoverage(anchor, 'monthly', 1)).toEqual({ start: '2027-02-28T09:00:00.000Z', end: '2027-03-31T09:00:00.000Z' });
    expect(billingCycleCoverage('2028-02-29T09:00:00.000Z', 'annual', 3)).toEqual({ start: '2031-02-28T09:00:00.000Z', end: '2032-02-29T09:00:00.000Z' });
  });

  it.each([-1, 0.5, NaN, Number.MAX_SAFE_INTEGER])('refuse un ordinal non représentable : %s', (index) => {
    expect(() => billingCycleCoverage(START, 'annual', index)).toThrow(RangeError);
  });

  it('le prédicat exige le propriétaire ET la même obligation, mais ne prend aucun verrou', () => {
    const assignment = { obligationId: billingObligationId(obligation()), provider: 'legacy' as const };
    expect(canEmitBillingObligation(assignment, assignment.obligationId, 'legacy')).toBe(true);
    expect(canEmitBillingObligation(assignment, assignment.obligationId, 'stripe')).toBe(false);
    expect(canEmitBillingObligation(assignment, 'other', 'legacy')).toBe(false);
  });

  it('refuse une identité vide, une couverture inversée et un état propriétaire inconnu', () => {
    expect(() => billingObligationId(obligation({ tenantId: ' ' }))).toThrow(RangeError);
    expect(() => billingObligationId(obligation({ coverage: { start: END, end: START } }))).toThrow(RangeError);
    expect(canEmitBillingObligation({ obligationId: 'id', provider: 'unknown' as 'legacy' }, 'id', 'legacy')).toBe(false);
  });
});
