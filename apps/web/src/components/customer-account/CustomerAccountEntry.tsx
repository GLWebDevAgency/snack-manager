"use client";

import { useState } from 'react';
import { Icon } from '../ui/icons';
import { Tap } from '../order/primitives';
import { useCustomerAccount } from './useCustomerAccount';
import { CustomerAccountPanel } from './CustomerAccountPanel';

export type CustomerAccountEntryProps = {
  slug: string;
  restaurantName: string;
  loyaltyHref?: string;
  onDeviceOrders?: () => void;
};

/** Existing-session entry, not a signup button. The first private read happens
 * only after opening; no profile is injected into the public restaurant HTML. */
export function CustomerAccountEntry({ slug, restaurantName, loyaltyHref, onDeviceOrders }: CustomerAccountEntryProps) {
  const [open, setOpen] = useState(false);
  const account = useCustomerAccount(slug, open);
  return <>
    <Tap onClick={() => setOpen(true)} aria-label="Mon compte" aria-haspopup="dialog"
      className="cf-press flex min-h-12 min-w-0 items-center justify-center gap-1.5 rounded-pill border border-ink/10 bg-surface px-3 text-left hover:border-ink/25">
      <Icon name="user" size={18} />
      <span className="text-[13px] font-bold">Mon compte</span>
    </Tap>
    <CustomerAccountPanel open={open} onClose={() => setOpen(false)} restaurantName={restaurantName}
      loyaltyHref={loyaltyHref} onDeviceOrders={onDeviceOrders} account={account} />
  </>;
}
