import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { orderRewardReservations, orderRewardClosures } from './schema';

describe('order reward schema and migration snapshots', () => {
  it('declares the exact private tables, scoped keys and policy without an eager ledger for holds', () => {
    const reservations = getTableConfig(orderRewardReservations), closures = getTableConfig(orderRewardClosures);
    expect(reservations.name).toBe('order_reward_reservations'); expect(closures.name).toBe('order_reward_closures');
    expect(reservations.enableRLS).toBe(true); expect(closures.enableRLS).toBe(true);
    expect(reservations.foreignKeys.map(key => key.getName()).sort()).toEqual([
      'order_reward_ledger_fk', 'order_reward_reversal_fk', 'order_reward_reward_fk', 'order_reward_rule_fk', 'order_reward_wallet_fk',
    ]);
    expect(reservations.primaryKeys[0]!.columns.map(column => column.name)).toEqual(['tenant_ref', 'client_id']);
    expect(reservations.columns.find(column => column.name === 'ledger_entry_id')!.notNull).toBe(false);
    expect(reservations.indexes.map(index => index.config.name)).toContain('order_reward_active_wallet_idx');
  });
  it('keeps the 0007→0008→0009 snapshot chain and assigns POS origin only to 0009', () => {
    const read = (n: string) => JSON.parse(readFileSync(resolve(__dirname, `../drizzle/meta/${n}_snapshot.json`), 'utf8'));
    const seven = read('0007'), eight = read('0008'), nine = read('0009');
    expect(eight.prevId).toBe(seven.id); expect(nine.prevId).toBe(eight.id);
    expect(seven.tables['loyalty.order_reward_reservations']).toBeUndefined();
    expect(eight.tables['loyalty.order_reward_reservations']).toEqual(nine.tables['loyalty.order_reward_reservations']);
    expect(eight.tables['loyalty.wallets'].columns.reserved_units).toMatchObject({ type: 'bigint', notNull: true, default: 0 });
    expect(eight.tables['loyalty.sale_settlements'].columns.origin).toBeUndefined();
    expect(nine.tables['loyalty.sale_settlements'].columns.origin).toMatchObject({ type: 'text', notNull: true, default: "'web_attribution'" });
    const journal = JSON.parse(readFileSync(resolve(__dirname, '../drizzle/meta/_journal.json'), 'utf8'));
    expect(journal.entries.slice(-2).map((row: { tag: string }) => row.tag)).toEqual(['0008_order_reward_reservations', '0009_pos_sale_compensation']);
  });
});
