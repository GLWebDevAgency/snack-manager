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
import type { JwtPayload } from '@sm/contracts';
import { REDIS_SUB } from '../../redis.module';

/**
 * Passerelle temps réel : relaie les événements Redis `tenant:*:orders`
 * vers les rooms socket.io. KDS/back-office rejoignent leur room tenant
 * (JWT requis) ; un client anonyme peut suivre UNE commande via `track`.
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
  ) {}

  onModuleInit() {
    void this.sub.psubscribe('tenant:*:orders');
    this.sub.on('pmessage', (_pattern, channel, message) => {
      const tenantId = channel.split(':')[1];
      try {
        const { event, payload } = JSON.parse(message) as { event: string; payload: unknown };
        this.server.to(`tenant:${tenantId}`).emit(event, payload);
        const orderId = (payload as { _id?: string })?._id;
        if (orderId) this.server.to(`order:${orderId}`).emit(event, payload);
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

  /** Suivi public d'une commande précise (page de statut sans compte). */
  @SubscribeMessage('track')
  async track(@ConnectedSocket() socket: Socket, @MessageBody() body: { orderId?: string }) {
    if (body?.orderId) await socket.join(`order:${body.orderId}`);
    return { ok: true };
  }
}
