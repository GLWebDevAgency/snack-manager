"use client";

import { useEffect, useRef, useState } from 'react';
import { LoyaltySaleSettlementListSchema, LoyaltySaleSettlementSchema, type LoyaltySaleSettlement } from '@sm/contracts';
import { closeSupersededLoyaltySaleResolutionIntent, completeLoyaltySaleResolutionIntent, prepareLoyaltySaleResolutionIntent, readLoyaltySaleResolutionIntent, type LoyaltySaleResolutionLocalIntent } from '@sm/client-core';
import { api, getToken } from '@/lib/api';
import { Btn, Field, Input, Modal, Panel } from '@/components/ui';
import type { Order } from '../orders/types';
import { RefundModal } from '../orders/RefundModal';
import { refundSession } from '../orders/refund-session';
import { loyaltyApi } from './data';

const REASON: Record<NonNullable<LoyaltySaleSettlement['reason']>, string> = {
  not_observed: 'Le gain sera vérifié automatiquement.', observation_superseded: 'Le remboursement a changé. Une nouvelle vérification est en attente.',
  payment_or_handoff_pending: 'En attente du paiement et de la remise confirmés.', refund_pending: 'En attente de la confirmation du remboursement bancaire.',
  program_inactive: 'Le programme doit être actif pour enregistrer ce gain.', member_inactive: 'La carte client doit être active.',
  allocation_unknown: 'Précisez la part produits et livraison du remboursement pour rapprocher la fidélité.',
  insufficient_balance: 'Le solde disponible ne permet pas de retirer toutes les unités dues. Aucun retrait partiel ni dette ne sont appliqués.',
  historical_proof_conflict: 'Les informations historiques doivent être vérifiées. Aucun nouveau mouvement n’est autorisé ici.',
  canonical_sale_conflict: 'Un gain existe déjà pour cette vente. Une vérification est nécessaire pour éviter un doublon.',
  financial_regression: 'Les remboursements observés ne concordent plus avec le journal. Une vérification est nécessaire.',
  financial_proof_too_large: 'Le détail financier dépasse la taille vérifiable automatiquement. Une vérification est nécessaire.',
  financial_proof_conflict: 'Le paiement, la remise ou la répartition doit être vérifié avant tout mouvement.',
};
const label = (view: LoyaltySaleSettlement) => view.state === 'recorded' ? 'À jour' : view.state === 'waiting' ? 'En attente' : 'À vérifier';
const problem = (cause: unknown) => cause instanceof Error ? cause.message : 'La lecture des ventes fidélité est indisponible.';

export function LoyaltySales() {
  const [items, setItems] = useState<LoyaltySaleSettlement[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<LoyaltySaleSettlement | null>(null), [refundOrder, setRefundOrder] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [ready, setReady] = useState(false);
  const scope = useRef<string | null>(null), alive = useRef(false), working = useRef(false);
  function current() { if (alive.current && getToken() !== scope.current) { setItems([]); setSelected(null); setRefundOrder(null); } if (!alive.current || !scope.current || getToken() !== scope.current) throw new Error('Votre session a changé. Rechargez cette page.'); }
  async function load(more = false) {
    if (working.current) return; working.current = true; setBusy(true); setError(null);
    try { current(); const view = LoyaltySaleSettlementListSchema.parse(await loyaltyApi.sales(more ? cursor : null)); current();
      setItems(previous => more ? [...previous.filter(item => !view.items.some(next => next.orderId === item.orderId)), ...view.items] : view.items); setCursor(view.nextCursor); setReady(true);
    } catch (cause) { if (alive.current) setError(problem(cause)); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  }
  useEffect(() => {
    alive.current = true; scope.current = getToken();
    void Promise.resolve().then(() => { if (alive.current) return load(); });
    const inspect = () => { if (getToken() !== scope.current) { setItems([]); setSelected(null); setRefundOrder(null); setError('Votre session a changé. Rechargez cette page.'); } };
    window.addEventListener('storage', inspect); window.addEventListener('focus', inspect);
    return () => { alive.current = false; window.removeEventListener('storage', inspect); window.removeEventListener('focus', inspect); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one pinned authenticated lifetime
  }, []);
  async function openRefund(view: LoyaltySaleSettlement) {
    if (working.current) return; working.current = true; setBusy(true); setError(null);
    try { current(); const auth = refundSession(); auth.assertCurrent();
      const order = await api.get<Order>(`/orders/${view.orderId}`, { signal: AbortSignal.timeout(15_000) }); current(); auth.assertCurrent();
      if (order._id !== view.orderId) throw new Error('Commande reçue incohérente'); setRefundOrder(order);
    } catch (cause) { if (alive.current) setError(problem(cause)); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  }
  return <div className="space-y-4 p-4 md:p-[26px]">
    <Panel title="Gains sur les ventes web" sub="Ventes attribuées à un compte client. Les reçus du journal fidélité confirment les mouvements." actions={<Btn variant="ghost" disabled={busy} onClick={() => void load()}>Actualiser</Btn>}>
      <p className="mb-4 text-sm text-mut">Les produits après remise donnent des unités selon la règle conservée à la commande. La livraison est exclue. Un remboursement peut corriger le gain initial.</p>
      {ready && items.length === 0 && <p className="text-sm text-mut">Aucune vente web attribuée à afficher.</p>}
      <div className="space-y-3">{items.map(view => <article key={view.orderId} className="space-y-3 rounded-card border border-line2 p-4">
        <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">Commande n°{view.orderNumber}</h3><strong className="text-sm">{label(view)}</strong></div>
        {view.reason && <p className="text-sm text-mut">{REASON[view.reason]}</p>}
        <SaleAmounts view={view} />
        <div className="flex flex-wrap gap-2"><Btn variant="ghost" size="sm" disabled={busy} onClick={() => setSelected(view)}>Consulter le dossier</Btn>
          {view.canAllocate && <Btn variant="ghost" size="sm" disabled={busy} onClick={() => void openRefund(view)}>Répartir le remboursement</Btn>}</div>
      </article>)}</div>
      {cursor && <Btn className="mt-4" variant="ghost" disabled={busy} onClick={() => void load(true)}>Voir les ventes précédentes</Btn>}
      {busy && <p role="status" className="mt-3 text-sm text-mut">Lecture en cours…</p>}
      {error && <p role="alert" className="mt-3 text-sm text-alertt">{error}</p>}
    </Panel>
    {selected && <Resolution key={selected.orderId} initial={selected} onClose={() => setSelected(null)} onUpdated={view => setItems(previous => previous.map(item => item.orderId === view.orderId ? view : item))} />}
    {refundOrder && <RefundModal key={refundOrder._id} order={refundOrder} onClose={() => { setRefundOrder(null); void load(); }} onRefunded={() => { setRefundOrder(null); void load(); }} />}
  </div>;
}
function SaleAmounts({ view }: { view: LoyaltySaleSettlement }) {
  return <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
    <div><dt className="text-mut">Gain initial</dt><dd className="font-semibold">{view.initialUnits ?? 'À confirmer'}</dd></div>
    <div><dt className="text-mut">Unités retirées</dt><dd className="font-semibold">{view.reversedUnits}</dd></div>
    <div><dt className="text-mut">Conservées par décision</dt><dd className="font-semibold">{view.waivedUnits}</dd></div>
    <div><dt className="text-mut">Retrait à traiter</dt><dd className="font-semibold">{view.dueUnits}</dd></div>
  </dl>;
}
function Resolution({ initial, onClose, onUpdated }: { initial: LoyaltySaleSettlement; onClose: () => void; onUpdated: (view: LoyaltySaleSettlement) => void }) {
  const [view, setView] = useState(initial), [intent, setIntent] = useState<LoyaltySaleResolutionLocalIntent | null>(null), [blocked, setBlocked] = useState(false);
  const [decision, setDecision] = useState<'retry' | 'waive_current'>('retry'), [reason, setReason] = useState(''), [password, setPassword] = useState('');
  const [busy, setBusy] = useState(true), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null), [sessionLost, setSessionLost] = useState(false);
  const alive = useRef(false), working = useRef(false), token = useRef<string | null>(null), session = useRef<ReturnType<typeof refundSession> | null>(null);
  function current() { if (alive.current && getToken() !== token.current) { setSessionLost(true); setPassword(''); } if (!alive.current || !token.current || getToken() !== token.current) throw new Error('Votre session a changé. Fermez ce dossier.'); session.current?.assertCurrent(); }
  async function read() {
    current();
    const local = session.current ? await readLoyaltySaleResolutionIntent(session.current.store, session.current.ownerId, initial.orderId) : null; current();
    const next = LoyaltySaleSettlementSchema.parse(await loyaltyApi.sale(initial.orderId, local?.state === 'pending' ? local.intent.request.operationId : undefined)); current();
    if (next.orderId !== initial.orderId) throw new Error('Dossier reçu incohérent');
    let pending: LoyaltySaleResolutionLocalIntent | null = null;
    if (session.current) {
      setBlocked(local!.state === 'blocked'); pending = local?.state === 'pending' ? local.intent : null;
      if (pending && next.resolutions.some(receipt => receipt.request.operationId === pending!.request.operationId)) {
        await completeLoyaltySaleResolutionIntent(session.current.store, pending, next); current(); pending = null;
        setNotice('Votre décision est enregistrée. Le dossier indique la situation actuelle.');
      }
    }
    setIntent(pending); if (pending) { setDecision(pending.request.decision); setReason(pending.request.reason); }
    setView(next); onUpdated(next); return next;
  }
  async function perform(action: () => Promise<void>) {
    if (working.current) return; working.current = true; setBusy(true); setError(null);
    try { current(); await action(); } catch (cause) { if (alive.current) setError(problem(cause)); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  }
  useEffect(() => {
    alive.current = true; token.current = getToken(); try { session.current = refundSession(); } catch { session.current = null; }
    void perform(async () => { await read(); });
    const inspect = () => { if (getToken() !== token.current) { alive.current = false; setSessionLost(true); setIntent(null); setPassword(''); setReason(''); setError('Votre session a changé. Fermez ce dossier.'); } };
    window.addEventListener('storage', inspect); window.addEventListener('focus', inspect);
    return () => { alive.current = false; window.removeEventListener('storage', inspect); window.removeEventListener('focus', inspect); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pinned order and authenticated lifetime
  }, []);
  const superseded = !!intent && (view.caseId !== intent.request.caseId || view.version !== intent.request.expectedVersion);
  const close = () => { alive.current = false; onClose(); };
  async function submit() {
    if (!session.current || blocked || !password || reason.trim().length < 3 || (!intent && !view.canResolve)) return;
    const requested = intent ?? { ownerId: session.current.ownerId, orderId: initial.orderId, dueUnits: view.dueUnits,
      request: { operationId: crypto.randomUUID(), caseId: view.caseId!, expectedVersion: view.version!, decision, reason: reason.trim() } };
    const saved = await prepareLoyaltySaleResolutionIntent(session.current.store, requested); current(); setIntent(saved);
    const fresh = await read(); current();
    if (fresh.resolutions.some(receipt => receipt.request.operationId === saved.request.operationId)) return;
    if (!fresh.canResolve || fresh.caseId !== saved.request.caseId || fresh.version !== saved.request.expectedVersion) throw new Error('Le dossier a changé. Conservez cette décision et relisez son reçu avant de continuer.');
    let failure: unknown; const secret = password; setPassword(''); current();
    try { await loyaltyApi.resolveSale(initial.orderId, { ...saved.request, password: secret }); } catch (cause) { failure = cause; }
    current(); const latest = await read(); current();
    if (!latest.resolutions.some(receipt => receipt.request.operationId === saved.request.operationId)) throw failure ?? new Error('La décision reste à vérifier. Reprenez la même demande.');
    if (failure) setNotice('La décision est enregistrée ; sa confirmation complète n’a pas abouti. Le journal conserve son reçu.');
  }
  if (sessionLost) return <Modal open title="Session modifiée" onClose={close}><p role="alert">Votre session a changé. Fermez ce dossier.</p></Modal>;
  return <Modal open title={`Fidélité · commande n°${initial.orderNumber}`} onClose={close} width={620} footer={<Btn variant="ghost" onClick={close}>Retour</Btn>}>
    <div className="space-y-4"><h3 className="font-semibold">{label(view)}</h3>{view.reason && <p className="text-sm text-mut">{REASON[view.reason]}</p>}<SaleAmounts view={view} />
      <Btn variant="ghost" disabled={busy} onClick={() => void perform(async () => { await read(); })}>Relire le dossier</Btn>
      {blocked && <p role="alert">Une autre session conserve une décision pour cette vente. Son auteur doit la vérifier.</p>}
      {!blocked && (view.canResolve || intent) && <form className="space-y-3" onSubmit={event => { event.preventDefault(); void perform(submit); }}>
        <fieldset disabled={busy || !!intent} className="space-y-2"><legend className="text-sm font-semibold">Décision pour les unités actuellement dues</legend>
          <label className="flex min-h-11 items-center gap-2"><input type="radio" name="resolution" checked={decision === 'retry'} onChange={() => setDecision('retry')} />Réessayer le retrait</label>
          <label className="flex min-h-11 items-center gap-2"><input type="radio" name="resolution" checked={decision === 'waive_current'} onChange={() => setDecision('waive_current')} />Laisser au client les unités actuellement dues</label>
        </fieldset>
        <p className="text-sm text-mut">{decision === 'waive_current' ? `Vous renoncez au retrait actuel de ${intent?.dueUnits ?? view.dueUnits} unités. Cette décision ne couvre aucun remboursement futur et ne crédite aucun point supplémentaire.` : 'Le retrait sera effectué uniquement si le solde permet de retirer toutes les unités dues. Aucun solde négatif ne sera créé.'}</p>
        <Field label="Motif de la décision" htmlFor="sale-resolution-reason"><Input id="sale-resolution-reason" value={reason} maxLength={500} disabled={busy || !!intent} onChange={event => setReason(event.target.value)} /></Field>
        <Field label="Votre mot de passe" htmlFor="sale-resolution-password"><Input id="sale-resolution-password" type="password" autoComplete="current-password" value={password} maxLength={256} disabled={busy} onChange={event => setPassword(event.target.value)} /></Field>
        <Btn type="submit" disabled={busy || superseded || !password || reason.trim().length < 3 || (!intent && !view.canResolve)}>{intent ? 'Reprendre la décision' : 'Confirmer la décision'}</Btn>
      </form>}
      {intent && view.caseId === intent.request.caseId && view.version !== null && view.version > intent.request.expectedVersion && <div className="space-y-2">
        <p className="text-sm text-mut">Le dossier a évolué. Cette ancienne décision ne peut plus être appliquée et ne couvre pas les nouveaux remboursements.</p>
        <Btn variant="ghost" disabled={busy} onClick={() => void perform(async () => {
          if (!session.current || !intent) return; const saved = intent, fresh = await read(); current();
          if (fresh.resolutions.some(receipt => receipt.request.operationId === saved.request.operationId)) return;
          await closeSupersededLoyaltySaleResolutionIntent(session.current.store, saved, fresh); current(); setIntent(null); setReason(''); setPassword('');
        })}>Fermer cette décision périmée</Btn>
      </div>}
      {view.resolutions.length > 0 && <section aria-label="Décisions enregistrées" className="space-y-2"><h3 className="font-semibold">Décisions enregistrées</h3>{view.resolutions.map(receipt => <article key={receipt.request.operationId} className="rounded-ctrl border border-line2 p-3 text-sm"><strong>{receipt.request.decision === 'waive_current' ? 'Unités dues conservées par décision' : 'Retrait réexaminé'}</strong><p>{receipt.request.reason}</p><p className="text-mut">{new Date(receipt.recordedAt).toLocaleString('fr-FR')}</p></article>)}</section>}
      {notice && <p role="status" className="text-sm">{notice}</p>}{busy && <p role="status" className="text-sm text-mut">Vérification en cours…</p>}{error && <p role="alert" className="text-sm text-alertt">{error}</p>}
    </div>
  </Modal>;
}
