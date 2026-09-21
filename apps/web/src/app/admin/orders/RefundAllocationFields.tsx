"use client";

import type { OrderRefundAllocation } from '@sm/contracts';
import { Field, Input } from '@/components/ui';
import { fmtEuro } from '@/lib/format';
import { refundAmountCents } from './refund-amount';

export type AllocationChoice = { kind: 'products' | 'delivery' | 'split' | ''; merchandise: string; delivery: string };
export const emptyAllocationChoice = (): AllocationChoice => ({ kind: '', merchandise: '', delivery: '' });
const zeroOrCents = (value: string) => /^0(?:[.,]0{1,2})?$/.test(value.trim()) ? 0 : refundAmountCents(value);

export function automaticAllocation(amount: number | null, limits: OrderRefundAllocation | null): OrderRefundAllocation | null {
  if (!amount || !limits) return null;
  if (amount === limits.merchandiseCents + limits.deliveryCents) return { ...limits };
  if (limits.deliveryCents === 0 && amount <= limits.merchandiseCents) return { version: 1, merchandiseCents: amount, deliveryCents: 0 };
  if (limits.merchandiseCents === 0 && amount <= limits.deliveryCents) return { version: 1, merchandiseCents: 0, deliveryCents: amount };
  return null;
}

export function selectedAllocation(amount: number | null, limits: OrderRefundAllocation | null, choice: AllocationChoice): OrderRefundAllocation | null {
  const auto = automaticAllocation(amount, limits);
  if (auto) return auto;
  if (!amount || !limits || !choice.kind) return null;
  const merchandiseCents = choice.kind === 'products' ? amount : choice.kind === 'delivery' ? 0 : zeroOrCents(choice.merchandise);
  const deliveryCents = choice.kind === 'delivery' ? amount : choice.kind === 'products' ? 0 : zeroOrCents(choice.delivery);
  if (merchandiseCents === null || deliveryCents === null || merchandiseCents + deliveryCents !== amount
    || merchandiseCents > limits.merchandiseCents || deliveryCents > limits.deliveryCents) return null;
  return { version: 1, merchandiseCents, deliveryCents };
}

export function RefundAllocationSummary({ allocation }: { allocation: OrderRefundAllocation | null | undefined }) {
  return <p className="text-sm text-mut">{allocation
    ? `Produits : ${fmtEuro(allocation.merchandiseCents)} · Livraison : ${fmtEuro(allocation.deliveryCents)}`
    : 'Répartition non renseignée. Cette demande conserve ses informations d’origine.'}</p>;
}

export function RefundAllocationFields({ amount, limits, value, onChange, disabled, prefix }: {
  amount: number | null; limits: OrderRefundAllocation | null; value: AllocationChoice;
  onChange: (next: AllocationChoice) => void; disabled: boolean; prefix: string;
}) {
  const auto = automaticAllocation(amount, limits), selected = selectedAllocation(amount, limits, value);
  if (!limits) return <p role="status" className="text-sm text-mut">La répartition disponible doit être vérifiée avant de préparer cette demande.</p>;
  if (auto) return <div><h4 className="text-sm font-semibold">Répartition du remboursement</h4><RefundAllocationSummary allocation={auto} /></div>;
  return <fieldset disabled={disabled} className="space-y-2">
    <legend className="text-sm font-semibold">Ce remboursement concerne</legend>
    <p className="text-xs text-mut">Disponible : produits {fmtEuro(limits.merchandiseCents)}, livraison {fmtEuro(limits.deliveryCents)}.</p>
    <div className="flex flex-wrap gap-2">{(['products', 'delivery', 'split'] as const).map((kind, index) =>
      <label key={kind} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-ctrl border border-line2 px-3 text-sm">
        <input type="radio" name={`${prefix}-allocation`} value={kind} checked={value.kind === kind} onChange={() => onChange({ ...value, kind })} />
        {['Produits', 'Livraison', 'Répartir'][index]}
      </label>)}</div>
    {value.kind === 'split' && <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
      <Field label="Part produits (€)" htmlFor={`${prefix}-merchandise`}><Input id={`${prefix}-merchandise`} inputMode="decimal" value={value.merchandise} maxLength={11} onChange={event => onChange({ ...value, merchandise: event.target.value })} /></Field>
      <Field label="Part livraison (€)" htmlFor={`${prefix}-delivery`}><Input id={`${prefix}-delivery`} inputMode="decimal" value={value.delivery} maxLength={11} onChange={event => onChange({ ...value, delivery: event.target.value })} /></Field>
    </div>}
    {selected ? <RefundAllocationSummary allocation={selected} /> : value.kind && <p role="status" className="text-sm text-mut">La somme doit correspondre au remboursement, sans dépasser la part disponible pour les produits ou la livraison.</p>}
  </fieldset>;
}
