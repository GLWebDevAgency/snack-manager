import { createHash, randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { OrderRewardSnapshotSchema, OrderRewardSelectionSchema, type OrderRewardSelection, type OrderRewardSnapshot } from '@sm/contracts';
import { orderRewardBenefit, type RewardPricedLine } from './order-reward-benefit';

const ownerSchema = z.strictObject({ tenantRef: z.string().regex(/^[a-f0-9]{24}$/), parentRef: z.string().min(1).max(160), accountId: z.uuid() });
export { OrderRewardSnapshotSchema, type OrderRewardSnapshot } from '@sm/contracts';
type Row = { id: string; tenant_ref: string; client_id: string; member_id: string; program_id: string; reward_id: string;
  rules_version: string; cost_units: string; request_hash: string; snapshot: unknown; state: 'reserved' | 'consumed' | 'released' | 'reversed';
  ledger_entry_id: string | null; reversal_entry_id: string | null };
const proofSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('admission_rejected'), payloadHash: z.string().regex(/^[a-f0-9]{64}$/) }),
  z.strictObject({ kind: z.literal('order_created'), orderId: z.string().regex(/^[a-f0-9]{24}$/), pricingHash: z.string().regex(/^[a-f0-9]{64}$/) }),
  z.strictObject({ kind: z.literal('order_reversed'), orderId: z.string().regex(/^[a-f0-9]{24}$/), orderVersion: z.number().int().nonnegative(),
    reason: z.enum(['cancelled_unpaid', 'fully_refunded']) }),
]);
type Proof = z.infer<typeof proofSchema>;
export const orderRewardHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)).digest('hex');
const conflict = (): never => { throw new ConflictException('La récompense doit être vérifiée avec cette même commande.'); };

/** All balances and receipts commit together. No external call belongs inside
 * this transaction; a lost COMMIT is recovered by reading the canonical row. */
export class OrderRewardStore {
  constructor(private readonly pool: Pool) {}
  private async tx<T>(tenantRef: string, clientId: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!/^[a-f0-9]{24}$/.test(tenantRef) || clientId !== clientId.toLowerCase() || !z.uuid().safeParse(clientId).success) return conflict();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_ref',$1,true)", [tenantRef]);
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`order-reward:${tenantRef}:${clientId.toLowerCase()}`]);
      const result = await work(client); await client.query('COMMIT'); return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  private async row(client: PoolClient, tenant: string, clientId: string): Promise<Row | undefined> {
    return (await client.query<Row>('SELECT * FROM loyalty.order_reward_reservations WHERE tenant_ref=$1 AND client_id=$2 FOR UPDATE', [tenant, clientId])).rows[0];
  }
  async reserve(input: { clientId: string; owner: OrderRewardSnapshot['owner']; selection: OrderRewardSelection;
    pricingHash: string; lines: readonly RewardPricedLine[]; subtotalCents: number }): Promise<OrderRewardSnapshot> {
    const owner = ownerSchema.parse(input.owner), selection = OrderRewardSelectionSchema.parse(input.selection);
    const fingerprint = orderRewardHash({ owner, clientId: input.clientId, selection, pricingHash: input.pricingHash });
    return this.tx(owner.tenantRef, input.clientId, async client => {
      if ((await client.query('SELECT 1 FROM loyalty.order_reward_closures WHERE tenant_ref=$1 AND client_id=$2', [owner.tenantRef, input.clientId])).rowCount) return conflict();
      const existing = await this.row(client, owner.tenantRef, input.clientId);
      if (existing) {
        if (existing.request_hash !== fingerprint || !['reserved','consumed'].includes(existing.state)) return conflict();
        return OrderRewardSnapshotSchema.parse(existing.snapshot);
      }
      await client.query("SELECT set_config('app.customer_parent_ref',$1,true)", [owner.parentRef]);
      const program = (await client.query<{ id: string; current_version: string }>("SELECT id,current_version FROM loyalty.programs WHERE tenant_ref=$1 AND status='active' FOR SHARE", [owner.tenantRef])).rows[0];
      if (!program) throw new ConflictException('Le programme de fidélité est indisponible.');
      const membership = (await client.query<{ member_id: string }>(`SELECT m.member_id FROM customer.loyalty_memberships m
        JOIN loyalty.members l ON l.tenant_ref=m.tenant_ref AND l.id=m.member_id
        WHERE m.tenant_ref=$1 AND m.parent_ref=$2 AND m.account_id=$3 AND l.status='active' FOR NO KEY UPDATE OF l`,
      [owner.tenantRef, owner.parentRef, owner.accountId])).rows[0];
      if (!membership) throw new ConflictException('Rattachez votre carte à votre compte avant de choisir une récompense.');
      const reward = (await client.query<{ id: string; name: string; cost_units: string; kind: string; value_cents: number | null; product_ref: string | null }>(
        'SELECT id,name,cost_units,kind,value_cents,product_ref FROM loyalty.rewards WHERE tenant_ref=$1 AND program_id=$2 AND id=$3 AND active=true FOR SHARE',
        [owner.tenantRef, program.id, selection.rewardId])).rows[0];
      if (!reward || Number(reward.cost_units) !== selection.expectedCostUnits) throw new ConflictException('Cette récompense a changé. Actualisez votre fidélité.');
      const benefit = orderRewardBenefit({ id: reward.id, name: reward.name, costUnits: Number(reward.cost_units), kind: reward.kind,
        valueCents: reward.value_cents, productRef: reward.product_ref }, input.lines, input.subtotalCents);
      const wallet = (await client.query<{ balance_units: string; reserved_units: string }>(`SELECT balance_units,reserved_units FROM loyalty.wallets
        WHERE tenant_ref=$1 AND member_id=$2 AND program_id=$3 FOR NO KEY UPDATE`, [owner.tenantRef, membership.member_id, program.id])).rows[0];
      if (!wallet || BigInt(wallet.balance_units) - BigInt(wallet.reserved_units) < BigInt(benefit.costUnits)) throw new ConflictException('Votre solde disponible ne permet pas cette récompense.');
      const snapshot = OrderRewardSnapshotSchema.parse({ version: 1, reservationId: randomUUID(), clientId: input.clientId, owner,
        memberId: membership.member_id, programId: program.id, rulesVersion: Number(program.current_version), pricingHash: input.pricingHash, benefit });
      await client.query(`INSERT INTO loyalty.order_reward_reservations(tenant_ref,client_id,id,member_id,program_id,reward_id,rules_version,cost_units,request_hash,snapshot)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [owner.tenantRef, input.clientId, snapshot.reservationId, snapshot.memberId,
        snapshot.programId, benefit.rewardId, snapshot.rulesVersion, benefit.costUnits, fingerprint, snapshot]);
      await client.query(`UPDATE loyalty.wallets SET reserved_units=reserved_units+$4,updated_at=now()
        WHERE tenant_ref=$1 AND member_id=$2 AND program_id=$3`, [owner.tenantRef, snapshot.memberId, snapshot.programId, benefit.costUnits]);
      return snapshot;
    });
  }
  async read(tenantRef: string, clientId: string): Promise<{ state: Row['state']; snapshot: OrderRewardSnapshot } | null> {
    return this.tx(tenantRef, clientId, async client => { const row = await this.row(client, tenantRef, clientId);
      return row ? { state: row.state, snapshot: OrderRewardSnapshotSchema.parse(row.snapshot) } : null; });
  }
  async reject(tenantRef: string, clientId: string, raw: Extract<Proof,{kind:'admission_rejected'}>): Promise<void> {
    const proof = proofSchema.parse(raw);
    await this.tx(tenantRef, clientId, async client => {
      await client.query('INSERT INTO loyalty.order_reward_closures(tenant_ref,client_id,proof) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [tenantRef, clientId, proof]);
      const row = await this.row(client, tenantRef, clientId);
      if (!row || row.state === 'released') return;
      if (row.state !== 'reserved') return conflict();
      await client.query(`UPDATE loyalty.wallets SET reserved_units=reserved_units-$4,updated_at=now()
        WHERE tenant_ref=$1 AND member_id=$2 AND program_id=$3`, [tenantRef, row.member_id, row.program_id, row.cost_units]);
      await client.query("UPDATE loyalty.order_reward_reservations SET state='released',decision_proof=$3,updated_at=now() WHERE tenant_ref=$1 AND client_id=$2", [tenantRef, clientId, proof]);
    });
  }
  async consume(snapshot: OrderRewardSnapshot, raw: Extract<Proof,{kind:'order_created'}>): Promise<void> {
    const expected = OrderRewardSnapshotSchema.parse(snapshot), proof = proofSchema.parse(raw);
    await this.tx(expected.owner.tenantRef, expected.clientId, async client => {
      const row = await this.row(client, expected.owner.tenantRef, expected.clientId);
      if (!row || orderRewardHash(row.snapshot) !== orderRewardHash(expected) || proof.kind !== 'order_created' || proof.pricingHash !== expected.pricingHash) return conflict();
      if (['consumed','reversed'].includes(row.state)) return;
      if (row.state !== 'reserved') return conflict();
      // Legacy earn/adjust also lock the member before its wallet. Keep this order
      // before inserting ledger rows whose FK takes a key-share member lock.
      await client.query('SELECT id FROM loyalty.members WHERE tenant_ref=$1 AND id=$2 FOR NO KEY UPDATE', [row.tenant_ref, row.member_id]);
      const wallet = (await client.query<{ balance_units: string; version: string }>(`UPDATE loyalty.wallets SET balance_units=balance_units-$4,
        reserved_units=reserved_units-$4,lifetime_redeemed_units=lifetime_redeemed_units+$4,version=version+1,updated_at=now()
        WHERE tenant_ref=$1 AND member_id=$2 AND program_id=$3 RETURNING balance_units,version`,
      [row.tenant_ref, row.member_id, row.program_id, row.cost_units])).rows[0];
      if (!wallet) return conflict();
      const ledgerId = randomUUID();
      await client.query(`INSERT INTO loyalty.operations(tenant_ref,operation_id,kind,request_fingerprint,status,result,completed_at)
        VALUES($1,$2,'redeem',$3,'completed',$4,now())`, [row.tenant_ref, row.id, row.request_hash, { orderReward: 'v1', clientId: row.client_id, ledgerEntryId: ledgerId }]);
      const reward = { id: expected.benefit.rewardId, name: expected.benefit.name, description: '', costUnits: expected.benefit.costUnits,
        kind: expected.benefit.kind, valueCents: expected.benefit.kind === 'fixed_discount' ? expected.benefit.amountCents : null, productRef: expected.benefit.productRef };
      const rewardSnapshot = { rulesVersion: expected.rulesVersion, reward };
      await client.query(`INSERT INTO loyalty.ledger_entries(id,tenant_ref,member_id,program_id,operation_id,kind,delta_units,balance_after,source,external_ref,rules_version,wallet_version,reason,reward_snapshot,occurred_at)
        VALUES($1,$2,$3,$4,$5,'redeem',-$6::bigint,$7,'online',$8,$9,$10,$11,$12,now())`,
      [ledgerId, row.tenant_ref, row.member_id, row.program_id, row.id, row.cost_units, wallet.balance_units, `online-redemption:${row.client_id}`,
        row.rules_version, wallet.version, expected.benefit.name, rewardSnapshot]);
      await client.query(`INSERT INTO loyalty.redemptions(tenant_ref,member_id,program_id,reward_id,operation_id,ledger_entry_id,external_ref,status,reward_snapshot,reserved_at,consumed_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,'consumed',$8,now(),now())`, [row.tenant_ref, row.member_id, row.program_id, row.reward_id, row.id, ledgerId, `online-redemption:${row.client_id}`, rewardSnapshot]);
      await client.query('UPDATE loyalty.members SET last_activity_at=now() WHERE tenant_ref=$1 AND id=$2', [row.tenant_ref, row.member_id]);
      await client.query("UPDATE loyalty.order_reward_reservations SET state='consumed',ledger_entry_id=$3,decision_proof=$4,updated_at=now() WHERE tenant_ref=$1 AND client_id=$2", [row.tenant_ref, row.client_id, ledgerId, proof]);
    });
  }
  async reverse(snapshot: OrderRewardSnapshot, raw: Extract<Proof,{kind:'order_reversed'}>): Promise<void> {
    const expected = OrderRewardSnapshotSchema.parse(snapshot), proof = proofSchema.parse(raw);
    await this.tx(expected.owner.tenantRef, expected.clientId, async client => {
      const row = await this.row(client, expected.owner.tenantRef, expected.clientId);
      if (!row || orderRewardHash(row.snapshot) !== orderRewardHash(expected)) return conflict();
      if (row.state === 'reversed') return;
      if (row.state !== 'consumed' || !row.ledger_entry_id) return conflict();
      const operationId = randomUUID(), ledgerId = randomUUID();
      await client.query('SELECT id FROM loyalty.members WHERE tenant_ref=$1 AND id=$2 FOR NO KEY UPDATE', [row.tenant_ref, row.member_id]);
      const wallet = (await client.query<{ balance_units: string; version: string }>(`UPDATE loyalty.wallets SET balance_units=balance_units+$4,
        lifetime_redeemed_units=lifetime_redeemed_units-$4,version=version+1,updated_at=now()
        WHERE tenant_ref=$1 AND member_id=$2 AND program_id=$3 RETURNING balance_units,version`,
      [row.tenant_ref, row.member_id, row.program_id, row.cost_units])).rows[0];
      if (!wallet) return conflict();
      await client.query(`INSERT INTO loyalty.operations(tenant_ref,operation_id,kind,request_fingerprint,status,result,completed_at)
        VALUES($1,$2,'reverse',$3,'completed',$4,now())`, [row.tenant_ref, operationId, orderRewardHash({ snapshot: expected, proof }), { orderRewardReversal: 'v1', clientId: row.client_id, ledgerEntryId: ledgerId }]);
      await client.query(`INSERT INTO loyalty.ledger_entries(id,tenant_ref,member_id,program_id,operation_id,kind,delta_units,balance_after,source,external_ref,rules_version,wallet_version,reason,reversed_entry_id,occurred_at)
        VALUES($1,$2,$3,$4,$5,'reverse',$6,$7,'online',$8,$9,$10,'Restitution de la récompense',$11,now())`,
      [ledgerId, row.tenant_ref, row.member_id, row.program_id, operationId, row.cost_units, wallet.balance_units,
        `online-redemption:${row.client_id}`, row.rules_version, wallet.version, row.ledger_entry_id]);
      await client.query("UPDATE loyalty.redemptions SET status='reversed',reversed_at=now() WHERE tenant_ref=$1 AND operation_id=$2", [row.tenant_ref, row.id]);
      await client.query('UPDATE loyalty.members SET last_activity_at=now() WHERE tenant_ref=$1 AND id=$2', [row.tenant_ref, row.member_id]);
      await client.query("UPDATE loyalty.order_reward_reservations SET state='reversed',reversal_entry_id=$3,decision_proof=$4,updated_at=now() WHERE tenant_ref=$1 AND client_id=$2", [row.tenant_ref, row.client_id, ledgerId, proof]);
    });
  }
}
