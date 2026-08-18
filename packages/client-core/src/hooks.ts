import { useCallback, useEffect, useRef, useState } from 'react';
import type { SmClient } from './api';
import type { QueueState } from './sync-queue';
import type { Menu, Order, OrderStatus } from './types';
import { mostAdvancedStatus } from './types';

/** État de la file de synchronisation (badge « N en attente » des barres hautes). */
export function useSyncState(client: SmClient): QueueState {
  const [state, setState] = useState<QueueState>(client.queue.getState());
  useEffect(() => client.queue.subscribe(setState), [client]);
  return state;
}

/**
 * Rejeu périodique de la file + à chaque retour de connexion.
 * Sans réseau, `flush` échoue silencieusement et les entrées restent.
 */
export function useAutoSync(client: SmClient, intervalMs = 15000) {
  useEffect(() => {
    const tick = () => void client.queue.flush();
    tick();
    const id = setInterval(tick, intervalMs);
    const onOnline = () => tick();
    globalThis.addEventListener?.('online', onOnline);
    return () => {
      clearInterval(id);
      globalThis.removeEventListener?.('online', onOnline);
    };
  }, [client, intervalMs]);
}

/** Menu du tenant, avec repli sur le cache local si le réseau est absent. */
export function useMenu(client: SmClient, tenantSlug: string) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await client.get<Menu>(`/public/tenants/${tenantSlug}/menu`, {
        cacheKey: `menu.${tenantSlug}`,
      });
      setMenu(data);
      setOffline(false);
      setError(null);
    } catch (e) {
      const cached = await client.cached<Menu>(`menu.${tenantSlug}`);
      if (cached) {
        setMenu(cached);
        setOffline(true);
      } else {
        setError(e instanceof Error ? e.message : 'Menu indisponible');
      }
    }
  }, [client, tenantSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  return { menu, error, offline, reload: load };
}

/** Horloge partagée — un seul intervalle pour tous les minuteurs affichés. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * Fusionne une commande reçue (temps réel ou rechargement) dans une liste
 * locale. Règle offline : le statut le plus avancé gagne, ce qui évite
 * qu'un rechargement en retard ne fasse « reculer » un ticket sous les yeux
 * de la cuisine.
 */
export function mergeOrder(list: Order[], incoming: Order): Order[] {
  const idx = list.findIndex(
    (o) => o._id === incoming._id || (o.clientId && o.clientId === incoming.clientId),
  );
  if (idx === -1) return [incoming, ...list];
  const current = list[idx]!;
  const keep = mostAdvancedStatus(current.status as OrderStatus, incoming.status as OrderStatus);
  const next = [...list];
  next[idx] = { ...current, ...incoming, status: keep };
  return next;
}

/** Déclenche `fn` une seule fois par identifiant (sons, notifications). */
export function useOncePerId() {
  const seen = useRef(new Set<string>());
  return useCallback((id: string, fn: () => void) => {
    if (seen.current.has(id)) return;
    seen.current.add(id);
    fn();
  }, []);
}
