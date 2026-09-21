"use client";

import { useEffect, useRef, useState } from 'react';
import { OrderRefundJournalSchema, type OrderRefundAllocation, type OrderRefundAllocationRequest, type OrderRefundJournal, type OrderRefundMutationRequest, type OrderRefundOperationView } from '@sm/contracts';
import { closeSupersededOrderRefundAllocationIntent, completeOrderRefundAllocationIntent, prepareOrderRefundAllocationIntent, readOrderRefundAllocationIntent, type OrderRefundAllocationIntent, completeOrderRefundIntent, prepareOrderRefundIntent, readOrderRefundIntent, type OrderRefundIntent } from '@sm/client-core';
import { api } from '@/lib/api';
import { fmtEuro } from '@/lib/format';
import { Btn, Field, Input, Modal } from '@/components/ui';
import type { Order } from './types';
import { refundAmountCents, refundAmountInput } from './refund-amount';
import { hasOnlinePaymentToRefund } from './refund-eligibility';
import { refundSession } from './refund-session';
import { emptyAllocationChoice, RefundAllocationFields, RefundAllocationSummary, selectedAllocation } from './RefundAllocationFields';
import { RefundAllocationForm } from './RefundAllocationForm';

function label(operation: OrderRefundOperationView): string {
  if (operation.state === 'withdrawn') return 'Abandonné avant envoi';
  if (operation.providerStatus === 'succeeded') return 'Confirmé';
  if (operation.providerStatus === 'failed' || operation.providerStatus === 'canceled') return 'Échoué';
  if (operation.providerStatus === 'pending') return 'En attente banque';
  if (operation.providerStatus === 'requires_action' || operation.state === 'review_required') return 'À vérifier';
  return 'Demande à reprendre';
}
const terminal = (operation: OrderRefundOperationView) => operation.state === 'known' || operation.state === 'withdrawn';
const message = (error: unknown) => error instanceof Error ? error.message : 'La réponse est indisponible. Conservez cette demande et vérifiez son journal avant de réessayer.';

export function RefundModal({ order, onClose, onRefunded }: {
  order: Order; onClose: () => void; onRefunded: (order: Order) => void;
}) {
  const [journal, setJournal] = useState<OrderRefundJournal | null>(null);
  const [intent, setIntent] = useState<OrderRefundIntent | null>(null);
  const [allocationIntent, setAllocationIntent] = useState<OrderRefundAllocationIntent | null>(null);
  const [historicalRefund, setHistoricalRefund] = useState<string | null>(null);
  const [allocationChoice, setAllocationChoice] = useState(emptyAllocationChoice);
  const [blocked, setBlocked] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [identityLost, setIdentityLost] = useState(false);
  const [draft, setDraft] = useState(false);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const mounted = useRef(false), working = useRef(false), revision = useRef(0);
  const session = useRef<ReturnType<typeof refundSession> | null>(null);

  function current(run: number) {
    if (!mounted.current || revision.current !== run) throw new Error('Cette fenêtre a été fermée. La demande conservée reste vérifiable à sa réouverture.');
    if (!session.current) throw new Error('Votre session ne permet pas de vérifier ce remboursement.');
    session.current.assertCurrent();
    return session.current;
  }
  function report(cause: unknown) { if (mounted.current) setError(message(cause)); }

  async function read(run: number, opening = false) {
    const auth = current(run);
    const raw = await api.get<unknown>(`/orders/${order._id}/refunds/journal`, { signal: AbortSignal.timeout(15_000) });
    current(run);
    const view = OrderRefundJournalSchema.parse(raw);
    if (view.orderId !== order._id) throw new Error('Le journal reçu ne correspond pas à cette commande.');
    setJournal(view);
    setStorageReady(false);
    const local = await readOrderRefundIntent(auth.store, auth.ownerId, order._id);
    current(run);
    let pending = local.state === 'pending' ? local.intent : null;
    if (pending) {
      const confirmed = view.operations.find(operation => operation.operationId === pending!.operationId && terminal(operation));
      if (confirmed) {
        await completeOrderRefundIntent(auth.store, pending, confirmed);
        current(run); pending = null;
        setNotice('La demande a été retrouvée dans le journal. Son état actuel est indiqué ci-dessus.');
      }
    }
    const localAllocation = await readOrderRefundAllocationIntent(auth.store, auth.ownerId, order._id);
    current(run);
    let pendingAllocation = localAllocation.state === 'pending' ? localAllocation.intent : null;
    if (pendingAllocation && view.allocations.some(entry => entry.operationId === pendingAllocation!.operationId)) {
      await completeOrderRefundAllocationIntent(auth.store, pendingAllocation, view);
      current(run); pendingAllocation = null; setHistoricalRefund(null);
      setNotice(view.allocations.find(entry => entry.operationId === (localAllocation.state === 'pending' ? localAllocation.intent.operationId : ''))?.state === 'withdrawn' ? 'La répartition a été abandonnée. Aucun mouvement bancaire ni fidélité n’a été ajouté.' : 'La répartition a été retrouvée dans le journal. Aucun nouvel envoi bancaire n’a été effectué.');
    }
    setAllocationIntent(pendingAllocation);
    setIntent(pending); setBlocked(local.state === 'blocked' && localAllocation.state !== 'pending'); setStorageReady(true);
    if (pending) { setAmount(refundAmountInput(pending.amountCents)); setReason(pending.reason); setDraft(false); }
    else if (opening) {
      setDraft(view.operations.length === 0 && local.state === 'none');
      setAmount(refundAmountInput(view.summary.remainingCents));
    }
    return view;
  }

  async function perform(action: (run: number) => Promise<void>) {
    if (working.current || identityLost) return;
    working.current = true; setBusy(true); setError(null);
    const run = revision.current;
    try { await action(run); }
    catch (cause) { if (revision.current === run) report(cause); }
    finally { working.current = false; if (mounted.current && revision.current === run) setBusy(false); }
  }

  useEffect(() => {
    mounted.current = true; const run = ++revision.current;
    // Read browser identity after mount. Each StrictMode lifetime has its own
    // generation; the discarded read cannot publish into the next one.
    void Promise.resolve().then(async () => {
      if (!mounted.current || revision.current !== run) return;
      try { session.current = refundSession(); await read(run, true); }
      catch (cause) { if (mounted.current && revision.current === run) { if (!session.current) setIdentityLost(true); report(cause); } }
      finally { if (mounted.current && revision.current === run) setBusy(false); }
    });
    const inspect = () => {
      try { session.current?.assertCurrent(); }
      catch { ++revision.current; setIdentityLost(true); setJournal(null); setIntent(null); setAllocationIntent(null); setHistoricalRefund(null); setPassword(''); setReason(''); setAmount(''); setError('Votre session a changé. Fermez cette fenêtre et reconnectez-vous avant de reprendre.'); }
    };
    window.addEventListener('storage', inspect); window.addEventListener('focus', inspect);
    const timer = setInterval(inspect, 1_000);
    return () => { stopPublication(); clearInterval(timer); window.removeEventListener('storage', inspect); window.removeEventListener('focus', inspect); };
    // This component is keyed by order id. Session and publication stay pinned until it closes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order._id]);

  const cents = refundAmountCents(amount);
  const allocation = selectedAllocation(cents, journal?.allocation.remaining ?? null, allocationChoice);
  const historical = journal?.allocation.unallocated.find(entry => entry.refundId === (allocationIntent?.refundId ?? historicalRefund));
  const serverIntent = journal?.operations.find(operation => operation.operationId === intent?.operationId);
  const unresolved = journal?.operations.some(operation => !terminal(operation)) ?? false;
  const resumable = intent && (!serverIntent || serverIntent.canResume);
  const canNew = storageReady && !!journal?.enabled && journal.operations.length < 128 && !blocked && !intent && !allocationIntent && !historicalRefund && !unresolved && journal.summary.remainingCents > 0 && hasOnlinePaymentToRefund(order.payment);
  const valid = storageReady && !identityLost && !blocked && journal?.enabled && password.length > 0 &&
    (intent ? resumable : draft && canNew && cents !== null && cents <= journal.summary.remainingCents && reason.trim().length >= 3 && allocation !== null);

  const canWithdraw = storageReady && !identityLost && !blocked && journal?.enabled && intent && password.length > 0
    && (!serverIntent || (serverIntent.state === 'prepared' && serverIntent.canResume));

  async function submit(run: number, withdraw = false) {
    if (withdraw ? !canWithdraw : !valid) return;
    const auth = current(run);
    const requested = intent ?? { ownerId: auth.ownerId, orderId: order._id, operationId: crypto.randomUUID(), amountCents: cents!, reason: reason.trim(), allocation };
    const saved = await prepareOrderRefundIntent(auth.store, requested);
    current(run); setIntent(saved); setDraft(false);
    const view = await read(run);
    current(run);
    const operation = view.operations.find(entry => entry.operationId === saved.operationId);
    if (operation && terminal(operation)) return;
    if (!view.enabled || (operation && (!operation.canResume || (withdraw && operation.state !== 'prepared')))) throw new Error('Cette demande ne peut pas être reprise ici. Vérifiez son état dans le journal.');
    if (!withdraw && !operation && view.operations.some(entry => !terminal(entry))) throw new Error('Une autre demande reste à vérifier. Aucun nouvel envoi effectué.');
    current(run);
    let failure: unknown;
    try {
      await api.post(`/orders/${order._id}/refunds${withdraw ? '/withdraw' : ''}`,  { clientProtocolVersion: 2, allocation: saved.allocation ?? null, operationId: saved.operationId, amountCents: saved.amountCents, reason: saved.reason, password } satisfies OrderRefundMutationRequest, { signal: AbortSignal.timeout(45_000) });
    } catch (cause) { failure = cause; }
    finally { if (mounted.current) setPassword(''); }
    current(run);
    const latest = await read(run);
    if (!latest.operations.some(entry => entry.operationId === saved.operationId && terminal(entry))) {
      throw failure ?? new Error('La demande reste à vérifier. Reprenez la même référence ; aucun nouveau remboursement n’a été préparé.');
    }
    // The exact financial receipt closes local uncertainty even when a later
    // server step (for example audit publication) failed. Do not hide that
    // secondary failure or turn it into permission to POST a new refund.
    if (failure) setNotice('La demande est enregistrée, mais la vérification complète n’a pas abouti. Consultez son état dans le journal et utilisez « Vérifier auprès de la banque » sans renvoyer cette demande.');
  }

  async function resume(operation: OrderRefundOperationView, run: number) {
    const auth = current(run);
    const saved = await prepareOrderRefundIntent(auth.store, { ownerId: auth.ownerId, orderId: order._id,
      operationId: operation.operationId, amountCents: operation.amountCents, reason: operation.reason, allocation: operation.allocation ?? null });
    current(run); setPassword(''); setDraft(false); setIntent(saved); setAmount(refundAmountInput(saved.amountCents)); setReason(saved.reason);
  }

  async function allocate(run: number, split: OrderRefundAllocation, allocationReason: string, secret: string, withdraw = false) {
    const auth = current(run);
    if (!storageReady || blocked || intent || (!allocationIntent && !historical?.canAllocate)) return;
    const requested: OrderRefundAllocationIntent = allocationIntent ?? {
      kind: 'allocation', ownerId: auth.ownerId, orderId: order._id, operationId: crypto.randomUUID(),
      refundId: historical!.refundId, amountCents: historical!.amountCents, allocation: split, reason: allocationReason,
    };
    const saved = await prepareOrderRefundAllocationIntent(auth.store, requested);
    current(run); setAllocationIntent(saved); setDraft(false);
    const view = await read(run);
    current(run);
    if (view.allocations.some(entry => entry.operationId === saved.operationId)) return;
    if (!withdraw && !view.allocation.unallocated.some(entry => entry.refundId === saved.refundId && entry.canAllocate)) {
      throw new Error('Cette répartition ne peut plus être envoyée. La demande conservée reste vérifiable dans le journal.');
    }
    current(run); let failure: unknown;
    try {
      await api.post(`/orders/${order._id}/refunds/${encodeURIComponent(saved.refundId)}/allocation${withdraw ? '/withdraw' : ''}`, {
        clientProtocolVersion: 2, operationId: saved.operationId, allocation: saved.allocation, reason: saved.reason, password: secret,
      } satisfies OrderRefundAllocationRequest, { signal: AbortSignal.timeout(45_000) });
    } catch (cause) { failure = cause; }
    current(run);
    const latest = await read(run);
    if (!latest.allocations.some(entry => entry.operationId === saved.operationId)) throw failure ?? new Error('La répartition reste à vérifier. Reprenez la même référence.');
    if (failure) setNotice('La répartition est enregistrée, mais la confirmation complète n’a pas abouti. Relisez le journal avant toute autre action.');
  }

  async function closeSupersededAllocation(run: number) {
    if (!allocationIntent) return;
    const saved = allocationIntent, auth = current(run);
    const view = await read(run); current(run);
    await closeSupersededOrderRefundAllocationIntent(auth.store, saved, view); current(run);
    setAllocationIntent(null); setHistoricalRefund(null); await read(run);
    current(run); setNotice('Cette demande a été fermée. La répartition déjà enregistrée reste inchangée.');
  }

  async function bank(run: number) {
    current(run); let failure: unknown;
    try { await api.get(`/orders/${order._id}/refunds`, { signal: AbortSignal.timeout(15_000) }); }
    catch (cause) { failure = cause; }
    current(run); await read(run);
    if (failure) throw new Error('La vérification complète n’a pas abouti. Le journal enregistré reste affiché ; aucun remboursement supplémentaire n’a été envoyé.');
    setNotice('La vérification est terminée. Consultez l’état actuel de la demande dans le journal.');
  }

  function stopPublication() { mounted.current = false; ++revision.current; }
  const close = () => { stopPublication(); onClose(); };

  return <Modal open destructive title={`Remboursements · commande n°${order.number}`} onClose={close} width={520} footer={<div className="flex w-full flex-wrap justify-end gap-2">
    <Btn className="max-w-full" style={{ whiteSpace: 'normal' }} variant="ghost" onClick={close}>Retour</Btn>
    {!identityLost && <Btn className="max-w-full" style={{ whiteSpace: 'normal' }} variant="ghost" disabled={busy} onClick={() => void perform(async run => {
      current(run); const updated = await api.get<Order>(`/orders/${order._id}`, { signal: AbortSignal.timeout(15_000) }); current(run);
      if (updated._id !== order._id) throw new Error('La commande reçue ne correspond pas.'); onRefunded(updated);
    })}>Actualiser la commande</Btn>}
  </div>}>
    <div className="flex min-w-0 flex-col gap-4 [overflow-wrap:anywhere]">
      <p className="text-sm text-mut">Le remboursement utilise le moyen de paiement d’origine et ne change pas l’avancement de la commande. Une réponse perdue se reprend avec la même référence.</p>
      {journal && <>
        <div className="rounded-ctrl border border-line2 p-3 text-sm">
          <div className="flex flex-wrap justify-between gap-2"><span>Déjà remboursé</span><strong>{fmtEuro(journal.summary.refundedCents)}</strong></div>
          <div className="flex flex-wrap justify-between gap-2"><span>En attente</span><strong>{fmtEuro(journal.summary.pendingRefundCents)}</strong></div>
          <div className="mt-2 flex flex-wrap justify-between gap-2"><span>Disponible</span><strong>{fmtEuro(journal.summary.remainingCents)}</strong></div>
        </div>
        {!journal.enabled && <p role="status" className="text-sm text-mut">Les remboursements sont désactivés. Le journal reste consultable ; aucune demande ne sera envoyée.</p>}
        <div className="flex flex-wrap gap-2">
          <Btn className="max-w-full" style={{ whiteSpace: 'normal' }} variant="ghost" disabled={busy} onClick={() => void perform(async run => { await read(run); })}>Relire le journal</Btn>
          {journal.enabled && <Btn className="max-w-full" style={{ whiteSpace: 'normal' }} variant="ghost" disabled={busy} onClick={() => void perform(bank)}>Vérifier auprès de la banque</Btn>}
        </div>
        {journal.operations.length > 0 && <section aria-label="Historique des remboursements" className="space-y-3">
          <h3 className="text-sm font-semibold">Demandes enregistrées</h3>
          {journal.operations.map(operation => <article key={operation.operationId} className="space-y-2 rounded-ctrl border border-line2 p-3 text-sm">
            <div className="flex flex-wrap justify-between gap-2"><strong>{label(operation)}</strong><strong>{fmtEuro(operation.amountCents)}</strong></div>
            <p className="break-words">{operation.reason}</p>
            <RefundAllocationSummary allocation={operation.allocation} />
            <p className="text-xs text-mut">{new Date(operation.preparedAt).toLocaleString('fr-FR')}</p>
            {!terminal(operation) && !operation.canResume && <p className="text-xs text-mut">Reprise indisponible ici : vérification nécessaire ou auteur différent.</p>}
            {storageReady && operation.canResume && !intent && !allocationIntent && !historicalRefund && !blocked && <Btn className="max-w-full" style={{ whiteSpace: 'normal' }} variant="ghost" disabled={busy} onClick={() => void perform(run => resume(operation, run))}>Reprendre cette demande</Btn>}
          </article>)}
        </section>}
      </>}
      {journal && journal.allocation.unallocated.length > 0 && <section aria-label="Remboursements à répartir" className="space-y-3">
        <h3 className="text-sm font-semibold">Répartition à préciser</h3>
        <p className="text-sm text-mut">Ces remboursements sont enregistrés. Leur part produits et livraison doit être précisée pour rapprocher la fidélité.</p>
        {journal.allocation.unallocated.map(refund => <article key={refund.refundId} className="space-y-2 rounded-ctrl border border-line2 p-3 text-sm">
          <strong>{fmtEuro(refund.amountCents)}</strong>
          <p className="text-xs text-mut">{refund.providerStatus === 'succeeded' ? 'Remboursement confirmé' : refund.providerStatus === 'pending' || refund.providerStatus === 'requires_action' ? 'En attente banque' : 'Remboursement non abouti'}</p>
          {refund.canAllocate && !intent && !allocationIntent && !blocked && journal.allocations.length < 128 && <Btn type="button" variant="ghost" disabled={busy || !storageReady || !journal.allocation.capacity} onClick={() => { setDraft(false); setHistoricalRefund(refund.refundId); }}>Préciser la répartition</Btn>}
        </article>)}
      </section>}
      {journal && journal.allocations.length > 0 && <section aria-label="Répartitions enregistrées" className="space-y-2">
        <h3 className="text-sm font-semibold">Répartitions enregistrées</h3>
        {journal.allocations.map(receipt => <article key={receipt.operationId} className="rounded-ctrl border border-line2 p-3 text-sm"><strong>{receipt.state === 'withdrawn' ? 'Répartition abandonnée' : 'Répartition enregistrée'}</strong><RefundAllocationSummary allocation={receipt.allocation} /><p>{receipt.reason}</p></article>)}
      </section>}
      {!identityLost && journal && (allocationIntent || historical) && <RefundAllocationForm key={allocationIntent?.operationId ?? historical!.refundId}
        amount={allocationIntent?.amountCents ?? historical!.amountCents} limits={journal.allocation.capacity} intent={allocationIntent} busy={busy}
        allowed={storageReady && !blocked && !intent && !!historical?.canAllocate}
        onSubmit={(split, allocationReason, secret) => perform(run => allocate(run, split, allocationReason, secret))}
        onWithdraw={secret => perform(run => allocate(run, allocationIntent!.allocation, allocationIntent!.reason, secret, true))}
        onCancel={() => setHistoricalRefund(null)} />}
      {!identityLost && allocationIntent && journal && (journal.allocations.length >= 128 || journal.allocations.some(entry => entry.state === 'recorded' && entry.refundId === allocationIntent.refundId && entry.operationId !== allocationIntent.operationId)) && <div className="space-y-2">
        <p className="text-sm text-mut">Le journal confirme que cette demande ne peut plus être appliquée. Vous pouvez la fermer sans modifier les répartitions enregistrées.</p>
        <Btn variant="ghost" disabled={busy || !storageReady} onClick={() => void perform(closeSupersededAllocation)}>Fermer cette demande</Btn>
      </div>}
      {!journal && !identityLost && !busy && <Btn className="max-w-full" style={{ whiteSpace: 'normal' }} variant="ghost" onClick={() => void perform(async run => { await read(run, true); })}>Réessayer la lecture du journal</Btn>}
      {notice && !identityLost && <p role="status" className="text-sm">{notice}</p>}
      {blocked && <p role="alert" className="text-sm text-alertt">Une demande conservée appartient à une autre session. Son auteur doit la vérifier avant toute nouvelle demande sur cet appareil.</p>}
      {!identityLost && !allocationIntent && !historicalRefund && (intent || draft) && <form className="space-y-3" onSubmit={event => { event.preventDefault(); void perform(submit); }}>
        <h3 className="text-sm font-semibold">{intent ? 'Reprendre la demande conservée' : 'Nouvelle demande'}</h3>
        {intent && <p className="text-xs text-mut">Montant et motif conservés. La reprise utilise exactement la même référence, même si ce montant est déjà réservé.</p>}
        <Field label="Montant à rembourser (€)" htmlFor="refund-amount"><Input id="refund-amount" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} disabled={!!intent || busy || !journal?.enabled} maxLength={11} /></Field>
        {intent ? <RefundAllocationSummary allocation={intent.allocation} /> : <RefundAllocationFields prefix="refund" amount={cents} limits={journal?.allocation.remaining ?? null} value={allocationChoice} onChange={setAllocationChoice} disabled={busy || !journal?.enabled} />}
        <Field label="Motif" htmlFor="refund-reason"><Input id="refund-reason" value={reason} onChange={event => setReason(event.target.value)} disabled={!!intent || busy || !journal?.enabled} maxLength={200} /></Field>
        <Field label="Votre mot de passe" htmlFor="refund-password"><Input id="refund-password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} disabled={busy || !journal?.enabled} maxLength={256} /></Field>
        {intent && (!serverIntent || serverIntent.state === 'prepared') && <p className="text-xs text-mut">Si aucun envoi bancaire n’a commencé, vous pouvez abandonner cette demande. Le serveur conservera son retrait définitif.</p>}
        <Btn className="max-w-full" style={{ whiteSpace: 'normal' }} type="submit" disabled={!valid || busy}>{busy ? 'Vérification en cours…' : intent ? 'Reprendre le remboursement' : 'Confirmer le remboursement'}</Btn>
        {intent && (!serverIntent || serverIntent.state === 'prepared') && <Btn className="max-w-full" style={{ whiteSpace: 'normal' }} type="button" variant="ghost" disabled={!canWithdraw || busy} onClick={() => void perform(run => submit(run, true))}>Abandonner cette demande</Btn>}
      </form>}
      {!identityLost && !draft && canNew && <Btn className="max-w-full" style={{ whiteSpace: 'normal' }} disabled={busy} variant="ghost" onClick={() => { setDraft(true); setAmount(refundAmountInput(journal!.summary.remainingCents)); setReason(''); setPassword(''); setAllocationChoice(emptyAllocationChoice()); setNotice(null); }}>Préparer un nouveau remboursement</Btn>}
      {busy && <p role="status" className="text-sm text-mut">Vérification en cours… Vous pouvez fermer cette fenêtre ; la demande conservée reste disponible.</p>}
      {error && <p role="alert" className="text-sm text-alertt">{error}</p>}
    </div>
  </Modal>;
}
