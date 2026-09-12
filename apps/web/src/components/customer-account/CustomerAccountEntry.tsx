"use client";

import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { BrandMode } from '@sm/contracts';
import { Icon } from '../ui/icons';
import type { MenuCategory } from '../order/api';
import { Tap } from '../order/primitives';
import { useCustomerAccount } from './useCustomerAccount';
import { CustomerAccountPanel } from './CustomerAccountPanel';
import './customer-account.css';

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
  initialSection?: 'profile' | 'loyalty';
  label?: string;
  primary?: boolean;
  /** Keeps fixed dialogs outside a filtered or transformed header, within the brand root. */
  dialogContainer?: HTMLElement | null;
};

/** Existing-session entry, not a signup button. The first private read happens
 * only after opening; no profile is injected into the public restaurant HTML. */
export function CustomerAccountEntry({ slug, restaurantName, mode = 'light', loyaltyHref, onDeviceOrders, onDevicePreferences, onCatalogVerified, returnLabel, compact = false, initialSection = 'profile', label = 'Mon compte', primary = false, dialogContainer }: CustomerAccountEntryProps) {
  const [open, setOpen] = useState(false);
  const [opening, setOpening] = useState(0);
  const account = useCustomerAccount(slug, open);
  const panel = <CustomerAccountPanel key={opening} initialSection={initialSection} open={open} onClose={() => setOpen(false)} restaurantName={restaurantName} slug={slug} mode={mode}
    loyaltyHref={loyaltyHref} onDeviceOrders={onDeviceOrders} onDevicePreferences={onDevicePreferences} onCatalogVerified={onCatalogVerified} account={account} returnLabel={returnLabel} />;
  return <>
    <Tap onClick={() => { setOpening(value => value + 1); setOpen(true); }} aria-label={label} aria-haspopup="dialog"
      className={primary ? "cf-press flex min-h-12 w-full items-center justify-center gap-2 rounded-ctrl bg-accent px-4 py-3 text-sm font-extrabold text-onaccent" : compact ? "sm-order-icon" : "cf-press flex min-h-12 min-w-0 items-center justify-center gap-1.5 rounded-pill border border-ink/10 bg-surface px-3 text-left hover:border-ink/25"}>
      <Icon name={initialSection === 'loyalty' ? 'gift' : 'user'} size={18} />
      {!compact && <span className="text-[13px] font-bold">{label}</span>}
    </Tap>
    {dialogContainer ? createPortal(panel, dialogContainer) : panel}
  </>;
}
