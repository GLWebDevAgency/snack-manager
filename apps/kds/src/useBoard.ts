import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  getStore,
  mergeOrder,
  NEXT_STATUS,
  SmApiError,
  type Order,
  type OrderStatus,
  type SmClient,
} from '@sm/client-core';
import { BOARD_STATUSES } from './ui';
import { KEY_BOARD, KEY_DELIVERED } from './config';
import { creerDebounce, pollCadenceMs } from './temps-reel';
import { useTenantSocket } from './useTenantSocket';

/**
 * Le tableau de la cuisine : les commandes `new` / `preparing` / `ready` du
 * tenant, tenues à jour par sondage et avancées de façon optimiste. La socket
 * temps réel (`useTenantSocket`) anticipe le sondage et en étire la cadence ;
 * elle ne le remplace jamais — voir `temps-reel.ts`.
 *
 * Trois règles gouvernent l'état :
 *
 * 1. **Le statut le plus avancé gagne** (`mergeOrder`). Une réponse serveur en
 *    retard ne fait jamais reculer un ticket sous les yeux du cuisinier.
 * 2. **L'avancement est immédiat, l'envoi est différé.** Un appui met à jour
 *    l'état local puis dépose un PATCH dans la file offline persistée. Sans
 *    réseau, le service continue ; la file rejoue au retour de la connexion.
 * 3. **On ne purge que sur un sondage réussi.** Une commande absente des trois
 *    listes serveur a été servie ou annulée ailleurs — mais tant que le réseau
 *    est coupé, on ne sait rien, donc on ne retire rien.
 *
 * Le tableau local (statuts locaux compris) est persisté à chaque changement :
 * une tablette qui redémarre hors ligne retrouve son service exactement où il
 * en était, sans que les tickets déjà avancés ne « rebondissent » en arrière.
 */

interface OrdersPage {
  rows: Order[];
  total: number;
}

export interface Board {
  orders: Order[];
  /** Premier chargement en cours (aucune donnée, même en cache). */
  loading: boolean;
  /** Le dernier sondage a échoué — l'écran affiche une photo locale. */
  offline: boolean;
  /** Message d'erreur réseau/serveur, pour la barre haute. */
  error: string | null;
  lastSyncAt: number | null;
  /** Fait avancer une commande au statut suivant (NEXT_STATUS). */
  advance(order: Order): void;
}

const isBoardStatus = (s: OrderStatus): boolean =>
  s === 'new' || s === 'preparing' || s === 'ready';

export function useBoard(
  client: SmClient,
  enabled: boolean,
  onUnauthorized: () => void,
  /** Jeton de la session d’équipe — sert UNIQUEMENT au handshake temps réel. */
  token: string | null,
): Board {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);

  /** Commandes remises localement : retirées du tableau avant confirmation serveur. */
  const delivered = useRef<Set<string>>(new Set());
  const hydrated = useRef(false);
  const unauthorized = useRef(onUnauthorized);
  unauthorized.current = onUnauthorized;

  // ─── Réhydratation : le service repart de sa dernière photo locale ───

  useEffect(() => {
    let alive = true;
    void (async () => {
      const store = getStore();
      const [rawBoard, rawDelivered] = await Promise.all([
        store.getItem(KEY_BOARD),
        store.getItem(KEY_DELIVERED),
      ]);
      if (!alive) return;
      try {
        if (rawDelivered) {
          const ids = JSON.parse(rawDelivered) as unknown;
          if (Array.isArray(ids)) delivered.current = new Set(ids.filter((i) => typeof i === 'string'));
        }
        if (rawBoard) {
          const parsed = JSON.parse(rawBoard) as unknown;
          // `prev.length ? prev : …` : si un sondage a déjà répondu pendant la
          // lecture du disque, on ne réécrit pas du frais avec du périmé.
          if (Array.isArray(parsed)) {
            setOrders((prev) => (prev.length > 0 ? prev : (parsed as Order[])));
          }
        }
      } catch {
        // photo corrompue : on repart du serveur plutôt que de bloquer le service
      }
      hydrated.current = true;
    })();
    return () => {
      alive = false;
    };
  }, []);

  // ─── Persistance du tableau local ───

  useEffect(() => {
    if (!hydrated.current) return;
    void getStore().setItem(KEY_BOARD, JSON.stringify(orders));
  }, [orders]);

  // ─── Sondage ───

  const poll = useCallback(async () => {
    try {
      // Volontairement SANS cache de repli : on veut que la panne réseau
      // remonte comme une panne, pas comme une réponse fraîche mais périmée.
      const pages = await Promise.all(
        BOARD_STATUSES.map((status) => client.get<OrdersPage>(`/orders?status=${status}`)),
      );
      const rows = pages.flatMap((p) => p?.rows ?? []);
      const serverIds = new Set(rows.map((r) => r._id));

      // Confirmé côté serveur : on peut oublier la remise locale.
      for (const id of [...delivered.current]) {
        if (!serverIds.has(id)) delivered.current.delete(id);
      }
      void getStore().setItem(KEY_DELIVERED, JSON.stringify([...delivered.current]));

      setOrders((prev) => {
        let next = prev;
        for (const row of rows) {
          if (delivered.current.has(row._id)) continue;
          next = mergeOrder(next, row);
        }
        return next.filter(
          (o) =>
            serverIds.has(o._id) &&
            !delivered.current.has(o._id) &&
            isBoardStatus(o.status as OrderStatus),
        );
      });

      setOffline(false);
      setError(null);
      setLastSyncAt(Date.now());
    } catch (err) {
      if (err instanceof SmApiError && err.status === 401) {
        unauthorized.current();
        return;
      }
      setOffline(true);
      setError(err instanceof Error ? err.message : 'Serveur injoignable');
    } finally {
      setLoading(false);
    }
  }, [client]);

  // ─── Temps réel : la socket anticipe, le sondage garantit ───

  /**
   * Rafraîchissement demandé par un événement `order.*`. Débouncé : une
   * commande génère volontiers une rafale d’événements, et chaque
   * rafraîchissement coûte trois GET (voir `temps-reel.ts`).
   */
  const rafale = useMemo(() => creerDebounce(() => void poll()), [poll]);
  useEffect(() => () => rafale.annuler(), [rafale]);

  const socketConnectee = useTenantSocket(enabled ? token : null, rafale.demander);

  /**
   * Socket connectée : 60 s — le sondage ne fait plus que rattraper un
   * événement perdu. Sinon : 5 s, le comportement historique à l’identique.
   */
  const cadence = pollCadenceMs(socketConnectee);

  useEffect(() => {
    if (!enabled) return;
    // Le premier tour est immédiat — y compris à chaque changement de
    // cadence : une socket qui vient de se (re)connecter rattrape ce qu’elle
    // a manqué, une socket qui vient de tomber revalide l’état sans attendre.
    void poll();
    const id = setInterval(() => void poll(), cadence);
    return () => clearInterval(id);
  }, [enabled, poll, cadence]);

  // Une tablette qui revient au premier plan a peut-être dormi des heures :
  // on resonde tout de suite, sans debounce — le cuisinier regarde déjà
  // l’écran. (La reconnexion de la socket, elle, vit dans `useTenantSocket`.)
  useEffect(() => {
    if (!enabled) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void poll();
    });
    return () => sub.remove();
  }, [enabled, poll]);

  // ─── Avancement optimiste ───

  const advance = useCallback(
    (order: Order) => {
      const next = NEXT_STATUS[order.status as OrderStatus];
      if (!next) return;

      if (next === 'delivered') {
        delivered.current.add(order._id);
        void getStore().setItem(KEY_DELIVERED, JSON.stringify([...delivered.current]));
        setOrders((prev) => prev.filter((o) => o._id !== order._id));
      } else {
        setOrders((prev) => mergeOrder(prev, { ...order, status: next }));
      }

      // `subject` = la commande : la file garde l'ordre de ses mutations et
      // n'applique jamais « prêt » avant « en préparation ».
      void client.patch(`/orders/${order._id}/status`, { status: next }, order._id);
    },
    [client],
  );

  return { orders, loading, offline, error, lastSyncAt, advance };
}
