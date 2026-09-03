import type { RejectedEntry } from '@sm/client-core';
import type { DayEntry } from './pos-state';

/**
 * Verrou synchrone d'encaissement.
 *
 * React ne publie `busy` qu'au rendu suivant. Deux gestes dans le même tour
 * JavaScript doivent pourtant être arbitrés immédiatement, et aucune mutation
 * du ticket ne doit se glisser pendant que sa copie est mise en file.
 */
export interface SaleInFlightGate {
  readonly active: boolean;
  tryStart(): boolean;
  finish(): void;
  runWhenIdle(action: () => void): boolean;
  /** Exécute maintenant, ou juste après la vente durable en cours. */
  deferUntilIdle(action: () => void): boolean;
}

export function createSaleInFlightGate(): SaleInFlightGate {
  let active = false;
  let draining = false;
  let deferred: (() => void)[] = [];
  return {
    get active() {
      return active;
    },
    tryStart() {
      if (active || draining) return false;
      active = true;
      return true;
    },
    finish() {
      active = false;
      const ready = deferred;
      deferred = [];
      draining = true;
      try {
        for (const action of ready) action();
      } finally {
        draining = false;
      }
    },
    runWhenIdle(action) {
      if (active || draining) return false;
      action();
      return true;
    },
    deferUntilIdle(action) {
      if (active) {
        deferred.push(action);
        return false;
      }
      action();
      return true;
    },
  };
}

export interface JournalResetSafety {
  saleInFlight: boolean;
  offline: boolean;
  pendingSync: number;
  rejectedSync: number;
  pendingLoyalty: number;
  /** Une mutation locale n'a pas encore atteint le stockage durable. */
  journalDegraded: boolean;
}

export type JournalResetBlockReason =
  | 'sale_in_flight'
  | 'offline'
  | 'pending_sync'
  | 'rejected_sync'
  | 'pending_loyalty'
  | 'journal_degraded';

/** Un seul prédicat partagé par le bouton et le callback de reset local. */
export function journalResetBlockReason(
  safety: JournalResetSafety,
): JournalResetBlockReason | null {
  if (safety.saleInFlight) return 'sale_in_flight';
  if (safety.offline) return 'offline';
  if (safety.pendingSync > 0) return 'pending_sync';
  if (safety.rejectedSync > 0) return 'rejected_sync';
  if (safety.pendingLoyalty > 0) return 'pending_loyalty';
  if (safety.journalDegraded) return 'journal_degraded';
  return null;
}

export function journalResetStatus(safety: JournalResetSafety): string {
  switch (journalResetBlockReason(safety)) {
    case 'sale_in_flight':
      return 'Une vente finit de s’enregistrer — attendez sa confirmation avant de réinitialiser le journal.';
    case 'offline':
      return 'Caisse hors ligne — reconnectez-la avant de réinitialiser le journal du poste.';
    case 'pending_sync':
      return `${safety.pendingSync} mutation${safety.pendingSync > 1 ? 's' : ''} encore en file — attendez la synchronisation avant de réinitialiser le journal.`;
    case 'rejected_sync':
      return `${safety.rejectedSync} vente${safety.rejectedSync > 1 ? 's' : ''} refusée${safety.rejectedSync > 1 ? 's' : ''} à traiter — ressaisissez puis acquittez ${safety.rejectedSync > 1 ? 'ces ventes' : 'cette vente'} avant de réinitialiser le journal.`;
    case 'pending_loyalty':
      return `${safety.pendingLoyalty} traitement${safety.pendingLoyalty > 1 ? 's' : ''} fidélité encore en cours — attendez ${safety.pendingLoyalty > 1 ? 'leur issue' : 'son issue'} avant de réinitialiser le journal.`;
    case 'journal_degraded':
      return 'Journal local non durable — attendez une écriture réussie avant de le réinitialiser.';
    default:
      return 'Journal local durable et file de synchronisation vide.';
  }
}

export function pendingLoyaltyCount(entries: readonly DayEntry[]): number {
  return entries.filter(
    (entry) =>
      entry.loyalty &&
      entry.loyalty.state !== 'credited' &&
      entry.loyalty.state !== 'failed',
  ).length;
}

function clientIdFromBody(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const clientId = (body as { clientId?: unknown }).clientId;
  return typeof clientId === 'string' && clientId.length > 0 ? clientId : null;
}

/** Copie immuable des lignes que le gérant a effectivement sous les yeux. */
export function rejectedSnapshotIds(
  rejected: readonly Pick<RejectedEntry, 'id'>[],
): string[] {
  return rejected.map((entry) => entry.id);
}

/**
 * Montant réellement encaissé pour une création refusée.
 *
 * Le corps de `POST /orders` ne transporte volontairement aucun prix : le
 * serveur les recalcule. La file conserve donc un nombre local dédié, jamais
 * envoyé au serveur ni injecté au journal fiscal. Le journal courant ne sert
 * que de repli pour les rejets créés par une ancienne version du poste.
 */
export function rejectedSaleAmount(
  rejected: Pick<RejectedEntry, 'body' | 'displayAmountCents'>,
  entries: readonly DayEntry[],
): number | null {
  if (
    Number.isSafeInteger(rejected.displayAmountCents) &&
    (rejected.displayAmountCents ?? -1) >= 0
  ) {
    return rejected.displayAmountCents ?? null;
  }
  const clientId = clientIdFromBody(rejected.body);
  if (!clientId) return null;
  const entry = entries.find((candidate) => candidate.clientId === clientId);
  if (!entry) return null;
  const amount = entry.total - (entry.discount ?? 0);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}
