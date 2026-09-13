"use client";

import type { BrandMode } from '@sm/contracts';
import type { ReactNode } from 'react';
import type { MenuCategory } from '../order/api';
import { CustomerAccountPanel } from './CustomerAccountPanel';
import { useCustomerAccount } from './useCustomerAccount';
import './customer-account.css';

/** An app destination, using the same protected session as checkout and the
 * contextual account sheet. Mount only when the visitor selects this screen. */
export function CustomerAccountPage({ slug, restaurantName, mode = 'light', loyaltyHref, section = 'profile', onBack,
  onLoyalty, onOrders, onDevicePreferences, onCatalogVerified, onNavigationLockedChange, loyaltyCard }: {
  slug: string; restaurantName: string; mode?: BrandMode; loyaltyHref?: string;
  section?: 'profile' | 'loyalty'; onBack?: () => void; onLoyalty?: () => void; onOrders?: () => void;
  onDevicePreferences?: () => void; onCatalogVerified?: (categories: MenuCategory[]) => void;
  onNavigationLockedChange?: (locked: boolean) => void;
  /** Existing QR access; the same controller remains mounted across account-state changes. */
  loyaltyCard?: ReactNode;
}) {
  const account = useCustomerAccount(slug, true);
  return <CustomerAccountPanel key={`${slug}:${section}`} open presentation="page" initialSection={section}
    slug={slug} restaurantName={restaurantName} mode={mode} loyaltyHref={loyaltyHref} account={account}
    onClose={onBack ?? (() => undefined)} onLoyalty={onLoyalty} onOrders={onOrders}
    onDevicePreferences={onDevicePreferences} onCatalogVerified={onCatalogVerified} onNavigationLockedChange={onNavigationLockedChange}
    loyaltyCard={loyaltyCard} />;
}
