import { Inject, Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
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
import { SessionAccessService } from '../../common/session-access';
import {
  parseSessionRevocation,
  SESSION_REVOCATION_CHANNEL,
  type SessionRevocation,
} from '../../common/session-revocation';
import { trackingFilter } from './tracking';

const SESSION_REVALIDATION_MS = 30_000;
const MAX_TIMER_MS = 2_147_483_647;

type SocketSessionControl = {
  generation: number;
  invalidated: boolean;
};

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
export class OrdersGateway implements OnModuleInit, OnModuleDestroy, OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(OrdersGateway.name);
  private readonly expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private revalidationTimer?: ReturnType<typeof setInterval>;
  private revalidationInFlight = false;

  constructor(
    @Inject(REDIS_SUB) private readonly sub: Redis,
    private readonly jwt: JwtService,
    @InjectModel('Order') private readonly orders: Model<Order>,
    private readonly sessions: SessionAccessService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.sub.on('pmessage', this.onOrderMessage);
    this.sub.on('message', this.onRevocationMessage);

    try {
      // Nest ne déclare pas l'API prête avant que les deux frontières Redis
      // aient confirmé leur abonnement. Ioredis les réinstalle ensuite lors
      // d'une reconnexion (`autoResubscribe`, activé par défaut).
      await Promise.all([
        this.sub.psubscribe('tenant:*:orders'),
        this.sub.subscribe(SESSION_REVOCATION_CHANNEL),
      ]);
    } catch (error) {
      this.sub.off('pmessage', this.onOrderMessage);
      this.sub.off('message', this.onRevocationMessage);
      this.logger.error(
        'Abonnement Redis du temps réel impossible',
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }

    this.revalidationTimer = setInterval(() => {
      void this.revalidateOpenSockets();
    }, SESSION_REVALIDATION_MS);
    this.revalidationTimer.unref?.();
  }

  onModuleDestroy() {
    this.sub.off('pmessage', this.onOrderMessage);
    this.sub.off('message', this.onRevocationMessage);
    if (this.revalidationTimer) clearInterval(this.revalidationTimer);
    for (const timer of this.expiryTimers.values()) clearTimeout(timer);
    this.expiryTimers.clear();
  }

  async handleConnection(socket: Socket) {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return; // connexion anonyme : suivi de commande uniquement
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      if (!Number.isFinite(payload.exp)) throw new Error('JWT sans échéance');
      const generation = this.openPendingSession(socket, payload);
      await this.sessions.assertAllows(payload);
      if (!this.isSessionCurrent(socket, payload, generation)) {
        this.disconnectSessionSocket(socket);
        return;
      }
      this.scheduleExpiry(socket, payload.exp! * 1_000);
      if (payload.tenantId) {
        await socket.join(`tenant:${payload.tenantId}`);
        // `join` lui-même est asynchrone : une révocation reçue pendant
        // l'opération ne doit pas laisser la socket dans la room ensuite.
        if (!this.isSessionCurrent(socket, payload, generation)) {
          this.disconnectSessionSocket(socket);
        }
      }
    } catch {
      this.disconnectSessionSocket(socket);
    }
  }

  private readonly onOrderMessage = (_pattern: string, channel: string, message: string) => {
    const match = /^tenant:([^:]+):orders$/.exec(channel);
    if (!match) return;
    try {
      const { event, payload } = JSON.parse(message) as { event?: unknown; payload: unknown };
      if (typeof event !== 'string') return;

      // Le suivi public reste une room séparée, avec sa liste blanche. Il ne
      // dépend pas d'une session restaurant et continue donc de fonctionner
      // pour le client qui possède son jeton de suivi.
      const orderId = (payload as { _id?: string })?._id;
      if (orderId) this.server.to(`order:${orderId}`).emit(event, versSuivi(payload));

      // Aucun broadcast aveugle sur la room tenant : chaque socket est
      // revalidée avant de recevoir le document complet.
      void this.relayToAuthorizedTenant(match[1]!, event, payload);
    } catch {
      // Message malformé — ignoré.
    }
  };

  private readonly onRevocationMessage = (channel: string, message: string) => {
    if (channel !== SESSION_REVOCATION_CHANNEL) return;
    const event = parseSessionRevocation(message);
    if (event) this.disconnectMatching(event);
  };

  private async relayToAuthorizedTenant(
    tenantId: string,
    event: string,
    payload: unknown,
  ): Promise<void> {
    try {
      const sockets = await this.server.in(`tenant:${tenantId}`).fetchSockets();
      await Promise.all(
        sockets.map(async (socket) => {
          const session = this.sessionFrom(socket.data);
          if (!session || session.tenantId !== tenantId) {
            this.disconnectSessionSocket(socket);
            return;
          }
          try {
            const generation = this.sessionControlFrom(socket.data)?.generation;
            if (generation === undefined) {
              this.disconnectSessionSocket(socket);
              return;
            }
            await this.sessions.assertAllows(session);
            // Une expiration, déconnexion ou révocation peut se produire
            // pendant les lectures Mongo. Aucun `await` ne sépare ce second
            // contrôle de l'émission : la décision et le sink sont atomiques
            // à l'échelle de la boucle JavaScript.
            if (!this.isSessionCurrent(socket, session, generation)) {
              this.disconnectSessionSocket(socket);
              return;
            }
            socket.emit(event, payload);
          } catch {
            this.disconnectSessionSocket(socket);
          }
        }),
      );
    } catch (error) {
      // Un problème d'adapter/Redis ne doit pas arrêter le consommateur. On
      // échoue fermé : aucune diffusion de secours non autorisée.
      this.logger.error(
        `Diffusion tenant impossible (${tenantId})`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private disconnectMatching(event: SessionRevocation): void {
    for (const socket of this.server.sockets.sockets.values()) {
      const session = this.sessionFrom(socket.data);
      if (!session || session.tenantId !== event.tenantId) continue;
      if (event.scope === 'staff' && session.sub !== event.staffId) continue;
      if (event.scope === 'device' && session.deviceId !== event.deviceId) continue;
      this.disconnectSessionSocket(socket);
    }
  }

  private async revalidateOpenSockets(): Promise<void> {
    if (this.revalidationInFlight) return;
    this.revalidationInFlight = true;
    try {
      await Promise.all(
        [...this.server.sockets.sockets.values()].map(async (socket) => {
          const session = this.sessionFrom(socket.data);
          if (!session) return; // suivi public anonyme
          try {
            const generation = this.sessionControlFrom(socket.data)?.generation;
            if (generation === undefined) throw new Error('Session sans contrôle');
            await this.sessions.assertAllows(session);
            if (!this.isSessionCurrent(socket, session, generation)) {
              this.disconnectSessionSocket(socket);
            }
          } catch {
            this.disconnectSessionSocket(socket);
          }
        }),
      );
    } finally {
      this.revalidationInFlight = false;
    }
  }

  private scheduleExpiry(socket: Socket, expiresAt: number): void {
    const schedule = () => {
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) {
        this.disconnectSessionSocket(socket);
        return;
      }
      const timer = setTimeout(schedule, Math.min(remaining, MAX_TIMER_MS));
      timer.unref?.();
      this.expiryTimers.set(socket.id, timer);
    };
    schedule();
    socket.once('disconnect', () => this.clearExpiry(socket.id));
  }

  private clearExpiry(socketId: string): void {
    const timer = this.expiryTimers.get(socketId);
    if (timer) clearTimeout(timer);
    this.expiryTimers.delete(socketId);
  }

  private openPendingSession(socket: Socket, payload: JwtPayload): number {
    const generation = (this.sessionControlFrom(socket.data)?.generation ?? 0) + 1;
    socket.data.session = payload;
    socket.data.sessionControl = { generation, invalidated: false } satisfies SocketSessionControl;
    return generation;
  }

  private isSessionCurrent(
    socket: { data: unknown; connected?: boolean },
    payload: JwtPayload,
    generation: number,
  ): boolean {
    const control = this.sessionControlFrom(socket.data);
    return (
      socket.connected !== false &&
      control?.invalidated === false &&
      control.generation === generation &&
      Number.isFinite(payload.exp) &&
      payload.exp! * 1_000 > Date.now()
    );
  }

  private disconnectSessionSocket(
    socket: {
      id: string;
      data: unknown;
      connected?: boolean;
      disconnect(close?: boolean): unknown;
    },
  ): void {
    const control = this.sessionControlFrom(socket.data);
    if (control) {
      control.invalidated = true;
      control.generation += 1;
    }
    this.clearExpiry(socket.id);
    if (socket.connected === false) return;
    socket.disconnect(true);
  }

  private sessionFrom(data: unknown): JwtPayload | null {
    const session = (data as { session?: unknown } | null)?.session;
    if (!session || typeof session !== 'object') return null;
    return session as JwtPayload;
  }

  private sessionControlFrom(data: unknown): SocketSessionControl | null {
    const control = (data as { sessionControl?: unknown } | null)?.sessionControl;
    if (!control || typeof control !== 'object') return null;
    const value = control as Partial<SocketSessionControl>;
    if (typeof value.generation !== 'number' || typeof value.invalidated !== 'boolean') return null;
    return value as SocketSessionControl;
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
