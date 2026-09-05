"use client";

/**
 * Temps réel back-office : socket.io vers l'API. Le serveur joint la room
 * `tenant:<id>` d'après le JWT passé en `auth.token` (jamais d'id côté client).
 * Événements relayés (contrats @sm/contracts WS_EVENTS) :
 * `order.created` · `order.updated` · `menu.updated`.
 */

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { WS_EVENTS, type WsEvent } from "@sm/contracts";
import { API_URL, getToken } from "./api";

export type TenantSocketHandlers = Partial<
  Record<WsEvent, (payload: unknown) => void>
>;

export type TenantSocketEvent = {
  event: WsEvent;
  payload: unknown;
  at: number;
};

/**
 * Ouvre (et maintient, reconnexion incluse) la socket tenant.
 * Retourne le dernier événement reçu + l'état de connexion ; les callbacks
 * passés en `handlers` sont appelés à chaque événement correspondant.
 */
export function useTenantSocket(handlers?: TenantSocketHandlers, enabled = true) {
  const handlersRef = useRef<TenantSocketHandlers | undefined>(handlers);
  const [last, setLast] = useState<TenantSocketEvent | null>(null);
  const [connected, setConnected] = useState(false);

  // Toujours la dernière version des callbacks, sans re-créer la socket.
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    if (!enabled) return;
    const token = getToken();
    if (!token) return; // pas de session → pas de room tenant

    const socket: Socket = io(API_URL, {
      auth: { token },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
    });

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));

    for (const event of Object.values(WS_EVENTS)) {
      socket.on(event, (payload: unknown) => {
        setLast({ event, payload, at: Date.now() });
        handlersRef.current?.[event]?.(payload);
      });
    }

    return () => {
      socket.disconnect();
    };
  }, [enabled]);

  return { last, connected };
}
