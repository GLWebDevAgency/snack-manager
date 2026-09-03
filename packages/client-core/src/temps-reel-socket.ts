import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { WS_EVENTS } from '@sm/contracts';

/**
 * Socket temps réel du tenant — la MÊME pour la cuisine et pour la caisse.
 *
 * Elle était écrite dans `apps/kds`. Le jour où la caisse a eu une vue du
 * service à tenir à jour, la recopier aurait fait deux politiques de
 * reconnexion, deux listes d'événements écoutés et deux endroits où corriger
 * le prochain défaut. Elle vit donc ici, et les deux surfaces la consomment.
 *
 * ─── CE QUE LE SERVEUR VÉRIFIE ───
 *
 * Même contrat que le back-office (`apps/web/src/lib/ws.ts` ↔
 * `orders.gateway.ts`) : la passerelle vérifie le JWT passé en `auth.token` et
 * joint la room `tenant:<id>` d'après le contenu DU JETON, jamais d'après un
 * identifiant fourni par le client. Elle n'inspecte PAS le rôle — seulement la
 * présence d'un `tenantId` valide. Le jeton d'équipe remis à l'ouverture par
 * PIN en porte un, qu'il ait été délivré à une caisse ou à un écran cuisine :
 * la passerelle l'accepte donc tel quel, et un poste ne peut pas plus écouter
 * un autre restaurant ici que lire ses commandes sur `/orders`.
 *
 * ─── CE QUE CE HOOK FAIT, ET SURTOUT CE QU'IL NE FAIT PAS ───
 *
 * Il ne fait que SIGNALER : « la socket est-elle connectée ? » et « il s'est
 * passé quelque chose sur les commandes ». Il n'applique JAMAIS le contenu
 * d'un événement — la charge reçue n'est pas une source de vérité, c'est un
 * réveil. Le sondage de la surface reste l'unique écrivain de son état ; la
 * socket ne fait qu'en changer la cadence et l'anticiper. Une socket qui meurt
 * sans bruit ne coûte donc RIEN de plus qu'avant (voir `temps-reel.ts`).
 *
 * ─── POURQUOI `react-native` N'APPARAÎT PAS ICI ───
 *
 * Le noyau partagé est délibérément sans react-native : c'est ce qui le rend
 * chargeable par un harnais de test sans preset natif. Le réveil au retour au
 * premier plan est donc RENDU à l'appelant (`reveiller`), qui le branche sur
 * son `AppState` — trois lignes côté application, contre un paquet entier
 * d'écart de portabilité côté noyau.
 *
 * ─── NOTE DE CAPACITÉ ───
 *
 * La passerelle est MONO-RÉPLIQUE et ne plafonne pas le nombre de sockets
 * (`orders.gateway.ts` : « Passer plusieurs répliques exigera l'adapter Redis
 * socket.io — prévu, pas câblé »). Chaque surface qui se connecte ajoute une
 * socket par appareil : un restaurant à deux caisses et deux écrans cuisine en
 * tient quatre. C'est le prix, assumé, de diviser le trafic de sondage par
 * douze — mais c'est un plafond à surveiller avant d'y brancher une cinquième
 * surface.
 */
export interface TenantSocket {
  /** La socket est établie — la surface peut étirer son sondage. */
  connectee: boolean;
  /**
   * Force une tentative de connexion immédiate. Sans effet si la socket l'est
   * déjà. À brancher sur le retour au premier plan de l'application.
   */
  reveiller: () => void;
}

export function useTenantSocket({
  url,
  token,
  onEvent,
}: {
  /** Origine de l'API — la même que celle du client HTTP de la surface. */
  url: string;
  /** Jeton d'équipe. `null` coupe le temps réel (démonstration, session fermée). */
  token: string | null;
  /** Appelé à chaque événement `order.*` du tenant. JAMAIS avec la charge. */
  onEvent: () => void;
}): TenantSocket {
  const [connectee, setConnectee] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  // Toujours le dernier callback, sans reconstruire la socket (même motif que
  // les `handlersRef` du back-office).
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    if (!token) return;

    const socket: Socket = io(url, {
      auth: { token },
      // WebSocket direct : le long-polling de secours de socket.io repose sur
      // XHR, fragile sous React Native. Si le WebSocket ne passe pas (proxy
      // d'un centre commercial…), la socket reste simplement déconnectée et le
      // sondage de secours fait le travail, comme il l'a toujours fait.
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
    });
    socketRef.current = socket;

    socket.on('connect', () => setConnectee(true));
    socket.on('disconnect', () => setConnectee(false));

    // Créée comme mise à jour : dans les deux cas la seule réponse est de
    // redemander l'état au serveur. `menu.updated` ne concerne aucune des deux
    // surfaces de service.
    socket.on(WS_EVENTS.orderCreated, () => handler.current());
    socket.on(WS_EVENTS.orderUpdated, () => handler.current());

    return () => {
      socketRef.current = null;
      setConnectee(false);
      socket.disconnect();
    };
  }, [token, url]);

  const reveiller = useCallback(() => {
    socketRef.current?.connect();
  }, []);

  return { connectee, reveiller };
}
