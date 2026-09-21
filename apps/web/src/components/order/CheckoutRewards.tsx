"use client";

import { useEffect, useRef, useState } from 'react';
import { CustomerLoyaltyResponseSchema, LoyaltyPublicProgramSchema, type LoyaltyPublicProgram, type OrderRewardSelection } from '@sm/contracts';
import { customerAccountRequest } from '../customer-account/client';
import { API_URL } from './api';
import type { CheckoutAccountAccess } from './checkout-attempt';
import { checkoutAccessMatches } from './checkout-account';

export function rewardAccessKey(access: CheckoutAccountAccess | null): string {
  return access ? JSON.stringify([access.selection, access.expiresAt, access.privacyEpoch]) : '';
}
/** A private balance stays in this mounted view. A selection stores only the
 * public reward choice; the checkout server chooses the actual membership. */
export function CheckoutRewards({ slug, access, currentAccess, selected, disabled, onSelect }: {
  slug: string; access: CheckoutAccountAccess; currentAccess: () => CheckoutAccountAccess | null;
  selected: OrderRewardSelection | null; disabled: boolean; onSelect: (value: OrderRewardSelection | null, accessKey: string) => void;
}) {
  const [view, setView] = useState<{ rewards: LoyaltyPublicProgram['rewards']; available: number; unit: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null);
  const alive = useRef(true), pending = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!view) return;
    const timer = setTimeout(() => {
      setView(null);
      setMessage('Actualisez votre fidélité pour revoir votre solde et vos récompenses.');
    }, Math.max(0, view.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [view]);
  async function load() {
    if (pending.current || disabled || !checkoutAccessMatches({ kind: 'account', ...access }, currentAccess())) return; pending.current = true; setBusy(true); setMessage(null); setView(null);
    const pinned = { kind: 'account' as const, ...structuredClone(access) };
    try {
      const [raw, response] = await Promise.all([
        customerAccountRequest(slug)('loyalty', { step: 'view' }, access.selection, { orderRewards: true }),
        fetch(`${API_URL}/public/tenants/${encodeURIComponent(slug)}/loyalty?orderRewards=1`, { cache: 'no-store', credentials: 'omit' }),
      ]);
      const member = CustomerLoyaltyResponseSchema.parse(raw);
      const catalog = LoyaltyPublicProgramSchema.parse(await response.json());
      if (!alive.current || !checkoutAccessMatches(pinned, currentAccess()) || member.expiresAt <= Date.now()) return;
      if (!response.ok || !catalog.orderRewardsEnabled) { setMessage('Les récompenses en ligne sont momentanément indisponibles.'); return; }
      if (member.state !== 'member' && member.state !== 'card') { setMessage('Retrouvez votre carte dans Fidélité, puis revenez choisir votre récompense.'); return; }
      setView({ rewards: catalog.rewards.filter(r => r.kind === 'fixed_discount' || r.kind === 'product' && /^[a-f0-9]{24}$/.test(r.productRef ?? '')),
        available: Math.max(0, member.member.balanceUnits - (member.member.reservedUnits ?? 0)), unit: member.member.unitLabelPlural, expiresAt: Math.min(access.expiresAt, member.expiresAt) });
    } catch { if (alive.current) setMessage('Votre fidélité ne peut pas être vérifiée. Réessayez ou commandez sans récompense.'); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  function select(value: OrderRewardSelection | null) {
    if (!disabled && view && view.expiresAt > Date.now() && checkoutAccessMatches({ kind: 'account', ...access }, currentAccess())) onSelect(value, rewardAccessKey(access));
  }
  const current = checkoutAccessMatches({ kind: 'account', ...access }, currentAccess());
  return <section className="mt-5 rounded-card border border-ink/10 bg-surface2 p-4" aria-label="Récompense fidélité">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-bold">Utiliser mes points</h3>
      <button type="button" className="min-h-11 rounded-ctrl px-3 text-sm font-semibold text-accentink disabled:opacity-40"
        disabled={busy || disabled || !current} onClick={() => void load()}>{busy ? 'Vérification…' : view ? 'Actualiser' : 'Voir mes récompenses'}</button></div>
    {message && <p role="status" className="mt-2 text-sm text-mut">{message}</p>}
    {view && current && <fieldset className="mt-3 space-y-2" disabled={disabled}>
      <legend className="mb-3 text-sm text-mut">{view.available} {view.unit} disponibles</legend>
      <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-ctrl border border-ink/10 bg-surface p-3">
        <input type="radio" name="checkout-reward" checked={!selected} onChange={() => select(null)} />
        <span className="text-sm font-semibold">Conserver mes points</span></label>
      {view.rewards.map(reward => <label key={reward.id} className="flex min-h-12 cursor-pointer items-start gap-3 rounded-ctrl border border-ink/10 bg-surface p-3 has-disabled:opacity-50">
        <input className="mt-1" type="radio" name="checkout-reward" disabled={reward.costUnits > view.available} checked={selected?.rewardId === reward.id}
          onChange={() => select({ rewardId: reward.id, expectedCostUnits: reward.costUnits })} />
        <span className="min-w-0 text-sm"><span className="block font-semibold">{reward.name} · {reward.costUnits} {view.unit}</span>
          <span className="mt-1 block leading-5 text-mut">{reward.kind === 'product' ? 'Un produit de votre panier offert, hors suppléments. La base la moins chère est offerte.' : reward.description}
            {reward.costUnits > view.available ? ' Solde insuffisant.' : ''}</span></span></label>)}
      {!view.rewards.length && <p className="text-sm text-mut">Aucune récompense n’est actuellement disponible en commande en ligne.</p>}
      <p className="pt-2 text-xs leading-5 text-mut">Une récompense par commande, sans autre promotion. Les points sont réservés puis utilisés à l’acceptation de la commande. Leur restitution nécessite un refus ou une annulation confirmés avant paiement, ou un remboursement intégral confirmé. Fermer ce panier n’annule aucune commande.</p>
    </fieldset>}
  </section>;
}
