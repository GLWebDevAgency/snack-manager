import { sql, withLoyaltyTenant, type LoyaltyDb } from '@sm/loyalty';
import { z } from 'zod';

export interface LoyaltyEarnReceiptInput {
  tenantRef: string;
  clientId: string;
  memberId: string;
  operationId: string;
}

export type LoyaltyEarnReceiptObservation =
  | { kind: 'not_observed' }
  | { kind: 'recorded'; awardedUnits: number; operationId: string }
  | { kind: 'conflict' };

const uuid = z.string().length(36).regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const safeUnits = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const inputSchema = z.object({
  tenantRef: z.string().min(1).max(160).refine(value => value.trim() === value),
  clientId: uuid,
  memberId: uuid,
  operationId: uuid,
}).strict();
const receiptSchema = z.object({
  operationId: uuid, memberId: uuid, source: z.enum(['pos', 'online']), externalRef: z.string(),
}).strict();
const operationSchema = z.object({
  operationId: uuid, kind: z.literal('earn'), status: z.literal('completed'), completed: z.literal(true),
  result: z.object({
    memberId: uuid, outcome: z.enum(['earned', 'below_minimum']), awardedUnits: safeUnits,
    rulesVersion: safeUnits.positive(), ledgerEntryId: uuid.nullable(),
  }).strict(),
}).strict();
const ledgerSchema = z.object({
  id: uuid, operationId: uuid, memberId: uuid, kind: z.literal('earn'), deltaUnits: safeUnits.positive(),
  source: z.enum(['pos', 'online']), externalRef: z.string(), rulesVersion: safeUnits.positive(),
}).strict();
const snapshotSchema = z.object({
  receipts: z.array(receiptSchema).max(1), operations: z.array(operationSchema).max(1), ledger: z.array(ledgerSchema).max(1),
}).strict();
const canonicalReference = /^(pos-order|online-order|order):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * Observation historique uniquement : aucune réclamation d'opération, aucun
 * accès au profil/solde/programme courant, aucun verrou inter-base.
 * `not_observed` n'est JAMAIS une preuve d'absence définitive : une transaction
 * concurrente peut encore publier le reçu après ce snapshot SQL unique.
 */
export async function readLoyaltyEarnReceipt(
  db: LoyaltyDb,
  input: LoyaltyEarnReceiptInput,
): Promise<LoyaltyEarnReceiptObservation> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new Error('Invalid loyalty earn receipt observation');
  const { tenantRef } = parsed.data;
  const clientId = parsed.data.clientId.toLowerCase();
  const memberId = parsed.data.memberId.toLowerCase();
  const operationId = parsed.data.operationId.toLowerCase();
  return withLoyaltyTenant(db, tenantRef, async tx => {
    // Les trois projections partagent le même snapshot READ COMMITTED. Les
    // limites détectent les incohérences sans charger un historique complet.
    const result = await tx.execute<{ proof: unknown }>(sql`
      WITH receipt AS (
        SELECT operation_id, member_id, source, external_ref FROM loyalty.earn_receipts
        WHERE tenant_ref = ${tenantRef} AND (
          operation_id = ${operationId}::uuid OR (
            source IN ('pos', 'online')
            AND external_ref ~* '^(pos-order|online-order|order):[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
            AND lower(split_part(external_ref, ':', 2)) = ${clientId}
          )
        ) LIMIT 2
      ), ledger AS (
        SELECT id, operation_id, member_id, kind, delta_units, source, external_ref, rules_version FROM loyalty.ledger_entries
        WHERE tenant_ref = ${tenantRef} AND (
          operation_id = ${operationId}::uuid OR operation_id IN (SELECT operation_id FROM receipt) OR (
            kind = 'earn' AND source IN ('pos', 'online')
            AND external_ref ~* '^(pos-order|online-order|order):[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
            AND lower(split_part(external_ref, ':', 2)) = ${clientId}
          )
        ) LIMIT 2
      ), operation AS (
        SELECT operation_id, kind, status, completed_at, result FROM loyalty.operations
        WHERE tenant_ref = ${tenantRef} AND (
          operation_id = ${operationId}::uuid OR operation_id IN (SELECT operation_id FROM receipt)
          OR operation_id IN (SELECT operation_id FROM ledger)
        ) LIMIT 2
      )
      SELECT jsonb_build_object(
        'receipts', coalesce((SELECT jsonb_agg(jsonb_build_object(
          'operationId', operation_id, 'memberId', member_id, 'source', source, 'externalRef', external_ref
        )) FROM receipt), '[]'::jsonb),
        'operations', coalesce((SELECT jsonb_agg(jsonb_build_object(
          'operationId', operation_id, 'kind', kind, 'status', status, 'completed', completed_at IS NOT NULL,
          'result', jsonb_build_object('memberId', result->'memberId', 'outcome', result->'outcome',
            'awardedUnits', result->'awardedUnits', 'rulesVersion', result->'rulesVersion', 'ledgerEntryId', result->'ledgerEntryId')
        )) FROM operation), '[]'::jsonb),
        'ledger', coalesce((SELECT jsonb_agg(jsonb_build_object(
          'id', id, 'operationId', operation_id, 'memberId', member_id, 'kind', kind,
          'deltaUnits', delta_units, 'source', source, 'externalRef', external_ref, 'rulesVersion', rules_version
        )) FROM ledger), '[]'::jsonb)
      ) AS proof
    `);
    if (result.rows.length !== 1) return { kind: 'conflict' };
    const snapshot = snapshotSchema.safeParse(result.rows[0]?.proof);
    if (!snapshot.success) return { kind: 'conflict' };
    const { receipts, operations, ledger } = snapshot.data;
    if (!receipts.length && !operations.length && !ledger.length) return { kind: 'not_observed' };
    const receipt = receipts[0];
    const operation = operations[0];
    const reference = receipt && canonicalReference.exec(receipt.externalRef);
    if (!receipt || !operation
      || receipt.operationId !== operationId || operation.operationId !== operationId
      || receipt.memberId !== memberId || operation.result.memberId.toLowerCase() !== memberId
      || reference?.[0] !== receipt.externalRef || reference?.[2]?.toLowerCase() !== clientId) return { kind: 'conflict' };
    const stored = operation.result;
    if (stored.outcome === 'below_minimum') {
      if (stored.awardedUnits !== 0 || stored.ledgerEntryId !== null || ledger.length) return { kind: 'conflict' };
    } else {
      const entry = ledger[0];
      if (!entry || stored.awardedUnits <= 0 || stored.ledgerEntryId?.toLowerCase() !== entry.id
        || entry.operationId !== operationId || entry.memberId !== memberId
        || entry.source !== receipt.source || entry.externalRef !== receipt.externalRef
        || entry.deltaUnits !== stored.awardedUnits || entry.rulesVersion !== stored.rulesVersion) return { kind: 'conflict' };
    }
    return { kind: 'recorded', awardedUnits: stored.awardedUnits, operationId };
  });
}
