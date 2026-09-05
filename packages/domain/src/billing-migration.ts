/**
 * B1 — audit d'instantanés normalisés et explicitement rapprochés du devis.
 * Aucun accès DB, SDK, prix catalogue courant, horloge ou écriture financière.
 * Un résultat cohérent n'autorise ni la migration ni un paiement : il ne prouve
 * pas l'exhaustivité de l'extraction ou la vérité des références fournisseur.
 * Périmètre : récurrents logiciel/Atelier ; les ponctuels relèvent de B4.
 */
export type BillingMigrationScope = { tenantId: string; contractId: string };
export type BillingCoverage = { start: string; end: string };
export type BillingCadence = 'monthly' | 'annual';
export type BillingIssuer = 'legacy' | 'stripe';

export type BillingMigrationContext = BillingMigrationScope & {
  platformAccountId: string;
  environment: 'test' | 'live';
  currency: 'eur';
  amountBasis: 'ht' | 'ttc';
};

export type MigrationChargeStream = {
  streamId: string;
  /** Référence mensuelle signée, avant remise. Jamais le MRR normalisé. */
  monthlyCents: number;
} & ({ nature: 'software'; cadence: BillingCadence } | { nature: 'atelier'; cadence: 'monthly' });

export type BillingContractSnapshot = BillingMigrationScope & {
  revision: number;
  proposalId: string;
  /** Ancre payante prouvée par le contrat/couverture, jamais tenant.createdAt. */
  firstPaidServiceAt: string;
  streams: MigrationChargeStream[];
  founder: {
    monthlyDiscountCents: number;
    /** Borne exclusive, conservée ; elle ne redémarre pas à la migration. */
    until: string;
    /** null = arbitrage nécessaire ; ne pas déduire depuis les options actuelles. */
    allocations: { streamId: string; monthlyCents: number }[] | null;
  } | null;
};

export type MigrationObligation = BillingMigrationScope & {
  streamId: string;
  /** Couverture réelle de service, distincte du mois de classement d'une facture. */
  coverage: BillingCoverage;
  dueAt: string;
  amountCents: number;
  taxCents: number;
  totalCents: number;
};

export type BillingProviderAssignment = {
  obligationId: string;
  provider: BillingIssuer | 'migration_pending';
};

export type StripeMigrationBinding = BillingMigrationContext & {
  customerId: string;
  streams: {
    streamId: string;
    priceId: string;
    /** Plusieurs abonnements sont possibles pour les échéances mixtes. */
    subscriptionId: string;
    subscriptionItemId: string;
    cadence: BillingCadence;
    /** Prix récurrent public signé avant coupon/remise, dans la base du contexte. */
    unitAmountCents: number;
  }[];
};

export type LegacyBillingEvidence = BillingMigrationScope & {
  invoiceId: string;
  number: string;
  status: 'paid' | 'unpaid' | 'draft' | 'cancelled';
  paymentUnresolved: boolean;
  /** Une pièce peut réunir logiciel et Atelier ; absence de preuve = null. */
  coverages: { streamId: string; coverage: BillingCoverage }[] | null;
};

export type BillingMigrationInput = {
  context: BillingMigrationContext;
  contract: BillingContractSnapshot;
  cutoverAt: string;
  /** Deux preuves explicites ; aucune extraction heuristique d'un libellé. */
  signedSchedule: MigrationObligation[];
  observedSchedule: MigrationObligation[];
  assignments: BillingProviderAssignment[];
  history: LegacyBillingEvidence[];
  /** Facultatif avant création d'objets ; un ID seul ne prouve pas sa réalité Stripe. */
  stripeBinding: StripeMigrationBinding | null;
};

export type BillingMigrationIssueCode =
  | 'invalid_identifier' | 'invalid_revision' | 'invalid_cents' | 'invalid_date'
  | 'invalid_context' | 'scope_mismatch' | 'invalid_cadence' | 'duplicate_stream'
  | 'unknown_stream' | 'founder_allocation_unresolved' | 'founder_allocation_mismatch'
  | 'invalid_coverage' | 'duplicate_obligation' | 'overlapping_coverage'
  | 'invalid_totals' | 'signed_amount_mismatch' | 'missing_stream_schedule'
  | 'schedule_coverage_mismatch' | 'schedule_amount_mismatch' | 'schedule_due_mismatch'
  | 'cutoff_overlap' | 'advance_terms_unresolved' | 'duplicate_assignment' | 'missing_assignment'
  | 'unknown_assignment' | 'invalid_provider' | 'migration_pending'
  | 'duplicate_legacy_invoice' | 'legacy_unsettled' | 'legacy_payment_unresolved'
  | 'legacy_coverage_unresolved' | 'legacy_coverage_overlap' | 'legacy_duplicate_coverage' | 'binding_mismatch';

export type BillingMigrationIssue = { code: BillingMigrationIssueCode; path: string };
export type BillingMigrationAudit = {
  status: 'consistent_snapshot' | 'reconciliation_required';
  issues: BillingMigrationIssue[];
  obligationIds: string[];
};

const cents = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;
const identifier = (value: string): boolean => typeof value === 'string' && value.length > 0 && value.trim() === value;
const instant = (value: string): boolean => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
};
const sameScope = (a: BillingMigrationScope, b: BillingMigrationScope): boolean => a.tenantId === b.tenantId && a.contractId === b.contractId;
const validCoverage = (coverage: BillingCoverage): boolean => instant(coverage.start) && instant(coverage.end) && coverage.start < coverage.end;
const overlaps = (a: BillingCoverage, b: BillingCoverage): boolean => a.start < b.end && b.start < a.end;

/** Identité stable entre moteurs/révisions. JSON évite les collisions de séparateurs. */
export function billingObligationId(obligation: Pick<MigrationObligation, 'tenantId' | 'contractId' | 'streamId' | 'coverage'>): string {
  if (![obligation.tenantId, obligation.contractId, obligation.streamId].every(identifier) || !validCoverage(obligation.coverage)) {
    throw new RangeError('Invalid billing obligation identity');
  }
  return JSON.stringify([obligation.tenantId, obligation.contractId, obligation.streamId, obligation.coverage.start, obligation.coverage.end]);
}

/**
 * Politique proposée pour B1 : anniversaires UTC de la première période payante,
 * repli au dernier jour du mois, toujours depuis l'ancre ORIGINALE. Un annuel
 * couvre 12 mois même s'il est facturé 10 mensualités. Ce helper ne migre ni ne
 * réécrit les dates historiques : leur preuve divergente doit être rapprochée.
 */
export function billingCycleCoverage(anchorAt: string, cadence: BillingCadence, index: number): BillingCoverage {
  if (!instant(anchorAt) || !Number.isSafeInteger(index) || index < 0 || !['monthly', 'annual'].includes(cadence)) {
    throw new RangeError('Invalid billing cycle');
  }
  const anchor = new Date(anchorAt);
  const stride = cadence === 'annual' ? 12 : 1;
  const at = (ordinal: number): string => {
    const months = ordinal * stride;
    if (!Number.isSafeInteger(months) || months > 119_999) throw new RangeError('Billing cycle outside supported calendar');
    const date = new Date(anchor.getTime());
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + months);
    if (date.getUTCFullYear() > 9999) throw new RangeError('Billing cycle outside supported calendar');
    const lastDay = new Date(date.getTime());
    lastDay.setUTCMonth(lastDay.getUTCMonth() + 1, 0);
    date.setUTCDate(Math.min(day, lastDay.getUTCDate()));
    return date.toISOString();
  };
  return { start: at(index), end: at(index + 1) };
}

/**
 * Prédicat de décision seulement. Aucune réservation, aucun CAS : un adaptateur
 * doit encore clôturer la course lecture/émission avec un arbitrage durable.
 */
export function canEmitBillingObligation(assignment: BillingProviderAssignment, obligationId: string, issuer: BillingIssuer): boolean {
  return identifier(obligationId) && assignment.obligationId === obligationId
    && (issuer === 'legacy' || issuer === 'stripe') && assignment.provider === issuer;
}

export function auditBillingMigration(input: Readonly<BillingMigrationInput>): BillingMigrationAudit {
  const issues: BillingMigrationIssue[] = [];
  const issue = (code: BillingMigrationIssueCode, path: string): void => { issues.push({ code, path }); };
  const money = (value: number, path: string): void => { if (!cents(value)) issue('invalid_cents', path); };
  const date = (value: string, path: string): void => { if (!instant(value)) issue('invalid_date', path); };
  const id = (value: string, path: string): void => { if (!identifier(value)) issue('invalid_identifier', path); };
  const scoped = (value: BillingMigrationScope, path: string): void => {
    if (!sameScope(input.context, value)) issue('scope_mismatch', path);
  };
  const { context, contract } = input;
  for (const key of ['tenantId', 'contractId', 'platformAccountId'] as const) id(context[key], `context.${key}`);
  if (!['test', 'live'].includes(context.environment) || context.currency !== 'eur' || !['ht', 'ttc'].includes(context.amountBasis)) issue('invalid_context', 'context');
  scoped(contract, 'contract');
  id(contract.proposalId, 'contract.proposalId');
  if (!Number.isSafeInteger(contract.revision) || contract.revision < 1) issue('invalid_revision', 'contract.revision');
  date(contract.firstPaidServiceAt, 'contract.firstPaidServiceAt');
  date(input.cutoverAt, 'cutoverAt');

  const streams = new Map<string, MigrationChargeStream>();
  for (const [index, stream] of contract.streams.entries()) {
    const path = `contract.streams.${index}`;
    id(stream.streamId, `${path}.streamId`);
    if (streams.has(stream.streamId)) issue('duplicate_stream', path);
    streams.set(stream.streamId, stream);
    money(stream.monthlyCents, `${path}.monthlyCents`);
    if (!['software', 'atelier'].includes(stream.nature) || !['monthly', 'annual'].includes(stream.cadence) || (stream.nature === 'atelier' && stream.cadence !== 'monthly')) issue('invalid_cadence', path);
    if (stream.cadence === 'annual') money(stream.monthlyCents * 10, `${path}.annualCents`);
  }

  const allocations = new Map<string, number>();
  if (contract.founder) {
    money(contract.founder.monthlyDiscountCents, 'contract.founder.monthlyDiscountCents');
    date(contract.founder.until, 'contract.founder.until');
    if (contract.founder.allocations === null) {
      issue('founder_allocation_unresolved', 'contract.founder.allocations');
    } else {
      let total = 0;
      for (const [index, allocation] of contract.founder.allocations.entries()) {
        const path = `contract.founder.allocations.${index}`;
        money(allocation.monthlyCents, `${path}.monthlyCents`);
        if (!streams.has(allocation.streamId) || allocations.has(allocation.streamId)) issue('founder_allocation_mismatch', path);
        allocations.set(allocation.streamId, allocation.monthlyCents);
        total += allocation.monthlyCents;
      }
      if (!cents(total) || total !== contract.founder.monthlyDiscountCents) issue('founder_allocation_mismatch', 'contract.founder.allocations');
    }
  }

  const inspectSchedule = (schedule: readonly MigrationObligation[], source: 'signedSchedule' | 'observedSchedule'): Map<string, MigrationObligation> => {
    const indexed = new Map<string, MigrationObligation>();
    for (const [index, obligation] of schedule.entries()) {
      const path = `${source}.${index}`;
      scoped(obligation, path);
      const stream = streams.get(obligation.streamId);
      if (!stream) issue('unknown_stream', path);
      date(obligation.dueAt, `${path}.dueAt`);
      // Une échéance anticipée peut être contractuellement légitime. B1 ne
      // représente pas ces conditions : il ne doit ni les inventer, ni
      // déplacer l'échéance, ni certifier leur reprise sans rapprochement.
      // Les délais de règlement après le début de couverture restent admis.
      if (instant(obligation.dueAt) && (
        (instant(input.cutoverAt) && obligation.dueAt < input.cutoverAt)
        || (instant(contract.firstPaidServiceAt) && obligation.dueAt < contract.firstPaidServiceAt)
      )) issue('advance_terms_unresolved', `${path}.dueAt`);
      date(obligation.coverage.start, `${path}.coverage.start`);
      date(obligation.coverage.end, `${path}.coverage.end`);
      for (const key of ['amountCents', 'taxCents', 'totalCents'] as const) money(obligation[key], `${path}.${key}`);
      const total = context.amountBasis === 'ht' ? obligation.amountCents + obligation.taxCents : obligation.amountCents;
      if (!cents(total) || total !== obligation.totalCents || (context.amountBasis === 'ttc' && obligation.taxCents > total)) issue('invalid_totals', path);
      if (!validCoverage(obligation.coverage)) {
        issue('invalid_coverage', path);
        continue;
      }
      if (instant(input.cutoverAt) && obligation.coverage.start < input.cutoverAt) issue('cutoff_overlap', path);
      if (stream && instant(contract.firstPaidServiceAt)) {
        const anchor = new Date(contract.firstPaidServiceAt);
        const start = new Date(obligation.coverage.start);
        const months = (start.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + start.getUTCMonth() - anchor.getUTCMonth();
        try {
          const expected = billingCycleCoverage(contract.firstPaidServiceAt, stream.cadence, months / (stream.cadence === 'annual' ? 12 : 1));
          if (expected.start !== obligation.coverage.start || expected.end !== obligation.coverage.end) issue('invalid_coverage', path);
        } catch {
          issue('invalid_coverage', path);
        }
      }
      if (source === 'signedSchedule' && stream && instant(obligation.dueAt)) {
        const founder = contract.founder;
        const reduction = founder && instant(founder.until) && obligation.dueAt < founder.until ? (allocations.get(stream.streamId) ?? 0) : 0;
        const expectedAmount = Math.max(0, stream.monthlyCents - reduction) * (stream.cadence === 'annual' ? 10 : 1);
        if (!cents(expectedAmount) || obligation.amountCents !== expectedAmount) issue('signed_amount_mismatch', path);
      }
      if (![obligation.tenantId, obligation.contractId, obligation.streamId].every(identifier)) {
        issue('invalid_identifier', path);
        continue;
      }
      const obligationId = billingObligationId(obligation);
      if (indexed.has(obligationId)) issue('duplicate_obligation', path);
      for (const previous of indexed.values()) {
        if (sameScope(previous, obligation) && previous.streamId === obligation.streamId && overlaps(previous.coverage, obligation.coverage)) issue('overlapping_coverage', path);
      }
      indexed.set(obligationId, obligation);
    }
    return indexed;
  };

  const signed = inspectSchedule(input.signedSchedule, 'signedSchedule');
  const observed = inspectSchedule(input.observedSchedule, 'observedSchedule');
  if (streams.size === 0) issue('missing_stream_schedule', 'contract.streams');
  for (const streamId of streams.keys()) {
    if (!input.signedSchedule.some((line) => line.streamId === streamId)) issue('missing_stream_schedule', `signedSchedule.${streamId}`);
  }
  for (const [obligationId, expected] of signed) {
    const actual = observed.get(obligationId);
    if (!actual) {
      issue('schedule_coverage_mismatch', obligationId);
      continue;
    }
    if (actual.dueAt !== expected.dueAt) issue('schedule_due_mismatch', obligationId);
    if (actual.amountCents !== expected.amountCents || actual.taxCents !== expected.taxCents || actual.totalCents !== expected.totalCents) issue('schedule_amount_mismatch', obligationId);
  }
  for (const obligationId of observed.keys()) if (!signed.has(obligationId)) issue('schedule_coverage_mismatch', obligationId);

  const assignments = new Set<string>();
  for (const [index, assignment] of input.assignments.entries()) {
    const path = `assignments.${index}`;
    if (assignments.has(assignment.obligationId)) issue('duplicate_assignment', path);
    assignments.add(assignment.obligationId);
    if (!signed.has(assignment.obligationId)) issue('unknown_assignment', path);
    if (!['legacy', 'stripe', 'migration_pending'].includes(assignment.provider)) issue('invalid_provider', path);
    if (assignment.provider === 'migration_pending') issue('migration_pending', path);
  }
  for (const obligationId of signed.keys()) if (!assignments.has(obligationId)) issue('missing_assignment', obligationId);

  const historicalIds = new Set<string>();
  const historicalNumbers = new Set<string>();
  const historicalCoverages: (BillingMigrationScope & { streamId: string; coverage: BillingCoverage })[] = [];
  for (const [index, invoice] of input.history.entries()) {
    const path = `history.${index}`;
    scoped(invoice, path);
    id(invoice.invoiceId, `${path}.invoiceId`);
    id(invoice.number, `${path}.number`);
    if (historicalIds.has(invoice.invoiceId) || historicalNumbers.has(invoice.number)) issue('duplicate_legacy_invoice', path);
    historicalIds.add(invoice.invoiceId);
    historicalNumbers.add(invoice.number);
    if (!['paid', 'cancelled'].includes(invoice.status)) issue('legacy_unsettled', path);
    if (invoice.paymentUnresolved !== false) issue('legacy_payment_unresolved', path);
    if (invoice.status === 'cancelled') continue;
    if (invoice.coverages === null || invoice.coverages.length === 0) {
      issue('legacy_coverage_unresolved', path);
      continue;
    }
    for (const covered of invoice.coverages) {
      if (!streams.has(covered.streamId)) issue('legacy_coverage_unresolved', path);
      if (!validCoverage(covered.coverage)) {
        issue('legacy_coverage_unresolved', path);
        continue;
      }
      for (const previous of historicalCoverages) {
        if (sameScope(previous, invoice) && previous.streamId === covered.streamId && overlaps(previous.coverage, covered.coverage)) issue('legacy_duplicate_coverage', path);
      }
      historicalCoverages.push({ tenantId: invoice.tenantId, contractId: invoice.contractId, ...covered });
      for (const planned of [...signed.values(), ...observed.values()]) {
        if (sameScope(invoice, planned) && covered.streamId === planned.streamId && overlaps(covered.coverage, planned.coverage)) issue('legacy_coverage_overlap', path);
      }
    }
  }

  const binding = input.stripeBinding;
  if (!binding && input.assignments.some((assignment) => assignment.provider === 'stripe')) issue('binding_mismatch', 'stripeBinding');
  if (binding) {
    for (const key of ['tenantId', 'contractId', 'platformAccountId', 'environment', 'currency', 'amountBasis'] as const) {
      if (binding[key] !== context[key]) issue('binding_mismatch', `stripeBinding.${key}`);
    }
    id(binding.customerId, 'stripeBinding.customerId');
    const mappedStreams = new Set<string>();
    const mappedItems = new Set<string>();
    const mappedPrices = new Map<string, { cadence: BillingCadence; unitAmountCents: number }>();
    for (const [index, mapping] of binding.streams.entries()) {
      const path = `stripeBinding.streams.${index}`;
      for (const key of ['priceId', 'subscriptionId', 'subscriptionItemId'] as const) id(mapping[key], `${path}.${key}`);
      money(mapping.unitAmountCents, `${path}.unitAmountCents`);
      const stream = streams.get(mapping.streamId);
      if (!stream || stream.cadence !== mapping.cadence || mapping.unitAmountCents !== stream.monthlyCents * (stream.cadence === 'annual' ? 10 : 1)
        || mappedStreams.has(mapping.streamId) || mappedItems.has(mapping.subscriptionItemId)) issue('binding_mismatch', path);
      // Un prix peut être réutilisé par plusieurs items, mais il décrit une
      // seule paire montant/cadence sur le compte et la devise du contexte.
      const price = mappedPrices.get(mapping.priceId);
      if (price && (price.cadence !== mapping.cadence || price.unitAmountCents !== mapping.unitAmountCents)) issue('binding_mismatch', `${path}.priceId`);
      if (!price) mappedPrices.set(mapping.priceId, { cadence: mapping.cadence, unitAmountCents: mapping.unitAmountCents });
      mappedStreams.add(mapping.streamId);
      mappedItems.add(mapping.subscriptionItemId);
    }
    for (const streamId of streams.keys()) if (!mappedStreams.has(streamId)) issue('binding_mismatch', `stripeBinding.streams.${streamId}`);
  }

  return { status: issues.length === 0 ? 'consistent_snapshot' : 'reconciliation_required', issues, obligationIds: [...signed.keys()] };
}
