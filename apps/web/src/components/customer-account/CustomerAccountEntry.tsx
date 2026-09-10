"use client";

import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { BrandMode } from '@sm/contracts';
import { Icon } from '../ui/icons';
import type { MenuCategory } from '../order/api';
import { Tap } from '../order/primitives';
import { useCustomerAccount } from './useCustomerAccount';
import { CustomerAccountPanel } from './CustomerAccountPanel';

export type CustomerAccountEntryProps = {
  slug: string;
  restaurantName: string;
  mode?: BrandMode;
  loyaltyHref?: string;
  onDeviceOrders?: () => void;
  onDevicePreferences?: () => void;
  onCatalogVerified?: (categories: MenuCategory[]) => void;
  returnLabel?: 'Revenir au menu' | 'Revenir à la fidélité';
  compact?: boolean;
  /** Keeps fixed dialogs outside a filtered or transformed header, within the brand root. */
  dialogContainer?: HTMLElement | null;
};

/** Existing-session entry, not a signup button. The first private read happens
 * only after opening; no profile is injected into the public restaurant HTML. */
export function CustomerAccountEntry({ slug, restaurantName, mode = 'light', loyaltyHref, onDeviceOrders, onDevicePreferences, onCatalogVerified, returnLabel, compact = false, dialogContainer }: CustomerAccountEntryProps) {
  const [open, setOpen] = useState(false);
  const account = useCustomerAccount(slug, open);
  const panel = <CustomerAccountPanel open={open} onClose={() => setOpen(false)} restaurantName={restaurantName} slug={slug} mode={mode}
    loyaltyHref={loyaltyHref} onDeviceOrders={onDeviceOrders} onDevicePreferences={onDevicePreferences} onCatalogVerified={onCatalogVerified} account={account} returnLabel={returnLabel} />;
  return <>
    <Tap onClick={() => setOpen(true)} aria-label="Mon compte" aria-haspopup="dialog"
      className={compact ? "sm-order-icon" : "cf-press flex min-h-12 min-w-0 items-center justify-center gap-1.5 rounded-pill border border-ink/10 bg-surface px-3 text-left hover:border-ink/25"}>
      <Icon name="user" size={18} />
      {!compact && <span className="text-[13px] font-bold">Mon compte</span>}
    </Tap>
    {dialogContainer ? createPortal(panel, dialogContainer) : panel}
  </>;
}
