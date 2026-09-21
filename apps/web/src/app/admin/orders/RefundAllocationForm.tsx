"use client";

import { useState } from 'react';
import type { OrderRefundAllocation } from '@sm/contracts';
import type { OrderRefundAllocationIntent } from '@sm/client-core';
import { Btn, Field, Input } from '@/components/ui';
import { fmtEuro } from '@/lib/format';
import { emptyAllocationChoice, RefundAllocationFields, RefundAllocationSummary, selectedAllocation } from './RefundAllocationFields';

export function RefundAllocationForm({ amount, limits, intent, busy, allowed, onSubmit, onWithdraw, onCancel }: {
  amount: number; limits: OrderRefundAllocation | null; intent: OrderRefundAllocationIntent | null;
  busy: boolean; allowed: boolean; onSubmit: (allocation: OrderRefundAllocation, reason: string, password: string) => Promise<void>;
  onWithdraw: (password: string) => Promise<void>; onCancel: () => void;
}) {
  const [choice, setChoice] = useState(emptyAllocationChoice), [reason, setReason] = useState(intent?.reason ?? ''), [password, setPassword] = useState('');
  const allocation = intent?.allocation ?? selectedAllocation(amount, limits, choice);
  return <form className="space-y-3 rounded-ctrl border border-line2 p-3" onSubmit={event => {
    event.preventDefault(); if (!allocation || !allowed || busy || !password || reason.trim().length < 3) return;
    const secret = password; setPassword(''); void onSubmit(allocation, reason.trim(), secret);
  }}>
    <h3 className="text-sm font-semibold">{intent ? 'Reprendre la répartition conservée' : 'Préciser la répartition'} · {fmtEuro(amount)}</h3>
    <p className="text-sm text-mut">Ce remboursement est déjà enregistré auprès du prestataire de paiement. Précisez la part produits et livraison pour vérifier son effet sur la fidélité. Cette action ne rembourse pas une deuxième fois.</p>
    {intent ? <RefundAllocationSummary allocation={intent.allocation} /> : <RefundAllocationFields prefix="historical" amount={amount} limits={limits} value={choice} onChange={setChoice} disabled={busy || !allowed} />}
    <Field label="Motif de la répartition" htmlFor="allocation-reason"><Input id="allocation-reason" value={reason} maxLength={200} disabled={!!intent || busy || !allowed} onChange={event => setReason(event.target.value)} /></Field>
    <Field label="Votre mot de passe" htmlFor="allocation-password"><Input id="allocation-password" type="password" autoComplete="current-password" value={password} maxLength={256} disabled={busy || (!allowed && !intent)} onChange={event => setPassword(event.target.value)} /></Field>
    <div className="flex flex-wrap gap-2">
      <Btn type="submit" className="max-w-full" style={{ whiteSpace: 'normal' }} disabled={!allowed || busy || !allocation || reason.trim().length < 3 || !password}>{intent ? 'Reprendre la répartition' : 'Confirmer la répartition'}</Btn>
      {intent && <Btn type="button" variant="ghost" disabled={busy || !password} onClick={() => { const secret = password; setPassword(''); void onWithdraw(secret); }}>Abandonner cette répartition</Btn>}
      {!intent && <Btn type="button" variant="ghost" disabled={busy} onClick={onCancel}>Annuler la saisie</Btn>}
    </div>
    {!allowed && <p role="status" className="text-sm text-mut">Cette répartition doit être vérifiée dans le journal avant de continuer.</p>}
  </form>;
}
