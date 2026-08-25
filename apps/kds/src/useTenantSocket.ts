import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { io, type Socket } from 'socket.io-client';
import { WS_EVENTS } from '@sm/contracts';
import { DEMO } from './client';
import { API_URL } from './config';

/**
 * Socket temps réel du tenant — même contrat que le back-office
 * (`apps/web/src/lib/ws.ts` ↔ `orders.gateway.ts`) : le serveur vérifie le
 * JWT passé en `auth.token` et joint la room `tenant:<id>` d'après le contenu
 * DU JETON, jamais d'après un identifiant fourni par le client. Le jeton
 * d'équipe remis à l'ouverture par PIN est un JWT signé du même secret et
 * portant le tenant de l'appareil APPAIRÉ : la gateway l'accepte donc tel
 * quel, et la tablette ne peut pas plus écouter un autre restaurant ici que
 * lire ses tickets sur `/orders`.
 *
 * Ce hook ne fait que SIGNALER : « la socket est-elle connectée ? » et « il
 * s'est passé quelque chose sur les commandes ». Il n'applique jamais le
 * contenu d'un événement : le sondage de `useBoard` reste l'unique écrivain
 * du tableau — la socket ne fait qu'en changer la cadence et l'anticiper.
 * Une socket qui meurt sans bruit ne coûte donc RIEN de plus qu'avant
 * (voir `temps-reel.ts`).
 */
export function useTenantSocket(token: string | null, onOrderEvent: () => void): boolean {
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  // Toujours le dernier callback, sans reconstruire la socket (même motif que
  // les `handlersRef` du back-office).
  const handler = useRef(onOrderEvent);
  handler.current = onOrderEvent;

  useEffect(() => {
    // Démonstration : tout vit dans le navigateur du visiteur, il n'existe
    // aucun serveur à écouter — et un jeton « demo » se ferait éconduire.
    if (DEMO || !token) return;

    const socket: Socket = io(API_URL, {
      auth: { token },
      // WebSocket direct : le long-polling de secours de socket.io repose sur
      // XHR, fragile sous React Native. Si le WebSocket ne passe pas (proxy
      // d'un centre commercial…), la socket reste simplement déconnectée et
      // le sondage à 5 s fait le travail, comme il l'a toujours fait.
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
    });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    // Créée comme mise à jour : dans les deux cas la seule réponse est de
    // redemander l'état au serveur. `menu.updated` ne concerne pas la cuisine.
    socket.on(WS_EVENTS.orderCreated, () => handler.current());
    socket.on(WS_EVENTS.orderUpdated, () => handler.current());

    return () => {
      socketRef.current = null;
      setConnected(false);
      socket.disconnect();
    };
  }, [token]);

  // Une tablette qui sort de veille doit retrouver son temps réel tout de
  // suite, sans attendre le prochain essai de reconnexion — même motif que le
  // battement de cœur au retour au premier plan (cf. la caisse, `App.tsx`).
  // `connect()` est sans effet si la socket l'est déjà.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') socketRef.current?.connect();
    });
    return () => sub.remove();
  }, []);

  return connected;
}
