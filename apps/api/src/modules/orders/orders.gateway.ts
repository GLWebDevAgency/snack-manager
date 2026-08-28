import { Inject } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import Redis from 'ioredis';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type { JwtPayload, OrderStatus } from '@sm/contracts';
import type { Order } from '@sm/db';
import { REDIS_SUB } from '../../redis.module';
import { trackingFilter } from './tracking';

/**
 * Ce qu'une page de suivi a le droit de recevoir — la même forme que
 * `GET /public/orders/:id`, et rien de plus.
 *
 * Écrit en liste BLANCHE et non en retrait de champs : un champ ajouté demain
 * au document ne doit pas partir sur la page publique parce que personne n'a
 * pensé à l'exclure.
 */
export function versSuivi(payload: unknown): {
  _id: string;
  number: number;
  status: OrderStatus;
  pickupSlot: string | null;
} {
  const o = (payload ?? {}) as {
    _id?: unknown;
    number?: unknown;
    status?: unknown;
    pickup?: { slot?: unknown } | null;
  };
  const slot = o.pickup?.slot;
  return {
    _id: String(o._id ?? ''),
    number: typeof o.number === 'number' ? o.number : 0,
    status: (typeof o.status === 'string' ? o.status : 'new') as OrderStatus,
    pickupSlot: slot ? new Date(slot as string).toISOString() : null,
  };
}

/**
 * Passerelle temps réel : relaie les événements Redis `tenant:*:orders`
 * vers les rooms socket.io. KDS/back-office rejoignent leur room tenant
 * (JWT requis) ; un client anonyme peut suivre UNE commande via `track`.
 *
 * ── `track` EXIGE LE JETON DE SUIVI, comme les routes HTTP ────────────────
 *
 * Il ne demandait qu'un identifiant de commande, et la room recevait ensuite le
 * document ENTIER : nom du client, téléphone, et le jeton de suivi lui-même.
 * Or `tracking.ts` documente précisément pourquoi ce jeton existe — « un
 * ObjectId Mongo n'est pas un secret, ses quatre premiers octets sont
 * l'horodatage et ses trois derniers un compteur incrémental : à partir d'une
 * commande connue, les voisines se devinent ». La protection était écrite,
 * testée côté HTTP, et cette passerelle la contournait en diffusant en prime le
 * secret qui ouvre l'accès HTTP.
 *
 * ── Et la diffusion est RÉDUITE ───────────────────────────────────────────
 *
 * Même avec le jeton, une page de suivi n'a besoin que du numéro, du statut et
 * de l'heure de retrait. Elle n'a aucune raison de recevoir les lignes, les
 * montants, le téléphone du client ou le jeton. La room `tenant:*`, elle, garde
 * le document complet : le KDS en vit.
 *
 * Note scaling : mono-réplique. Passer plusieurs répliques exigera
 * l'adapter Redis socket.io (@socket.io/redis-adapter) — prévu, pas câblé.
 */
@WebSocketGateway({ cors: { origin: true } })
export class OrdersGateway implements OnModuleInit, OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  constructor(
    @Inject(REDIS_SUB) private readonly sub: Redis,
    private readonly jwt: JwtService,
    @InjectModel('Order') private readonly orders: Model<Order>,
  ) {}

  onModuleInit() {
    void this.sub.psubscribe('tenant:*:orders');
    this.sub.on('pmessage', (_pattern, channel, message) => {
      const tenantId = channel.split(':')[1];
      try {
        const { event, payload } = JSON.parse(message) as { event: string; payload: unknown };
        // La room de l'établissement reçoit tout — le KDS en vit.
        this.server.to(`tenant:${tenantId}`).emit(event, payload);
        // La room d'une commande ne reçoit que le suivi, jamais le document :
        // même authentifiée par jeton, une page publique n'a pas à connaître le
        // téléphone du client ni le secret qui donne accès à sa commande.
        const orderId = (payload as { _id?: string })?._id;
        if (orderId) this.server.to(`order:${orderId}`).emit(event, versSuivi(payload));
      } catch {
        // message malformé — ignoré
      }
    });
  }

  async handleConnection(socket: Socket) {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return; // connexion anonyme : suivi de commande uniquement
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      if (payload.tenantId) await socket.join(`tenant:${payload.tenantId}`);
    } catch {
      socket.disconnect(true);
    }
  }

  /**
   * Suivi public d'une commande précise (page de statut sans compte).
   *
   * Le jeton est vérifié EN BASE avant d'admettre dans la room — exactement le
   * contrôle de `GET /public/orders/:id`. Le refus ne dit pas si la commande
   * existe : un « introuvable » distinct d'un « jeton invalide » confirmerait
   * l'existence, ce que le jeton doit précisément empêcher.
   */
  @SubscribeMessage('track')
  async track(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { orderId?: string; token?: unknown },
  ) {
    const filtre = trackingFilter(String(body?.orderId ?? ''), body?.token);
    if (!filtre) return { ok: false };
    const existe = await this.orders.exists(filtre);
    if (!existe) return { ok: false };
    await socket.join(`order:${filtre._id}`);
    return { ok: true };
  }
}
