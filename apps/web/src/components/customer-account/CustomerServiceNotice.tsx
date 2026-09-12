"use client";

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Tap } from '../order/primitives';
import type { CustomerUnavailableService } from './customer-public-surfaces';

export type { CustomerUnavailableService } from './customer-public-surfaces';

/** Only a public-service status is serialized here, never an upstream error or
 * private session. Refresh preserves the current client state and cart. */
export function CustomerServiceNotice({ service, disabled = false }: { service: CustomerUnavailableService; disabled?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <section aria-label="Service temporairement indisponible" className="my-5 space-y-3 rounded-panel border border-prep/30 bg-prep/10 p-4 text-prept">
    <div role="status" className="space-y-1 text-sm leading-6">
      <p className="font-bold">{service === 'loyalty' ? 'La fidélité ne peut pas être vérifiée pour le moment.' : 'La carte du restaurant ne peut pas être chargée pour le moment.'}</p>
      <p>{service === 'loyalty' ? 'Votre compte et la carte du restaurant restent accessibles. Réessayez pour vérifier le programme.' : 'Votre compte et votre fidélité restent accessibles. Réessayez pour retrouver la carte du restaurant.'}</p>
    </div>
    <Tap disabled={disabled || pending} onClick={() => { if (!disabled && !pending) startTransition(() => router.refresh()); }}
      className="cf-press flex min-h-11 items-center justify-center gap-2 rounded-ctrl border border-current/25 px-4 py-2 text-sm font-bold disabled:opacity-40">
      {pending ? 'Actualisation…' : 'Réessayer'}
    </Tap>
  </section>;
}
