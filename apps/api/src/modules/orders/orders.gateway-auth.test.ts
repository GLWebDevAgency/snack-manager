import type { JwtService } from '@nestjs/jwt';
import type { Socket } from 'socket.io';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JwtPayload } from '@sm/contracts';
import { SESSION_REVOCATION_CHANNEL } from '../../common/session-revocation';
import type { SessionAccessService } from '../../common/session-access';
import { OrdersGateway } from './orders.gateway';

const TENANT = '65f000000000000000000001';
const STAFF_A = '65f000000000000000000011';
const STAFF_B = '65f000000000000000000012';
const DEVICE = '65f000000000000000000021';

type Handler = (...args: string[]) => void;

class FakeSubscriber {
  readonly psubscribe = vi.fn().mockResolvedValue(1);
  readonly subscribe = vi.fn().mockResolvedValue(1);
  private readonly handlers = new Map<string, Set<Handler>>();

  on(event: string, handler: Handler): this {
    const set = this.handlers.get(event) ?? new Set<Handler>();
    set.add(handler);
    this.handlers.set(event, set);
    return this;
  }

  off(event: string, handler: Handler): this {
    this.handlers.get(event)?.delete(handler);
    return this;
  }

  fire(event: string, ...args: string[]): void {
    for (const handler of this.handlers.get(event) ?? []) handler(...args);
  }
}

class FakeSocket {
  readonly handshake: { auth: { token?: string } };
  readonly data: Record<string, unknown> = {};
  readonly rooms = new Set<string>();
  readonly emit = vi.fn();
  readonly disconnect = vi.fn(() => {
    this.connected = false;
    for (const handler of this.disconnectHandlers) handler();
    return this;
  });
  readonly join = vi.fn(async (room: string) => void this.rooms.add(room));
  private readonly disconnectHandlers: Array<() => void> = [];
  connected = true;

  constructor(
    readonly id: string,
    token?: string,
  ) {
    this.handshake = { auth: token ? { token } : {} };
  }

  once(event: string, handler: () => void): this {
    if (event === 'disconnect') this.disconnectHandlers.push(handler);
    return this;
  }

  asSocket(): Socket {
    return this as unknown as Socket;
  }
}

class FakeServer {
  readonly sockets = { sockets: new Map<string, Socket>() };
  readonly publicEmits: Array<{ room: string; event: string; payload: unknown }> = [];

  add(socket: FakeSocket): void {
    this.sockets.sockets.set(socket.id, socket.asSocket());
  }

  in(room: string) {
    return {
      fetchSockets: async () =>
        [...this.sockets.sockets.values()].filter((socket) =>
          (socket as unknown as FakeSocket).rooms.has(room),
        ),
    };
  }

  to(room: string) {
    return {
      emit: (event: string, payload: unknown) => {
        this.publicEmits.push({ room, event, payload });
      },
    };
  }
}

function staffPayload(sub = STAFF_A): JwtPayload {
  return {
    sub,
    tenantId: TENANT,
    role: 'caisse',
    kind: 'staff',
    exp: Math.floor(Date.now() / 1_000) + 3_600,
    staffSessionVersion: 'staff-v1',
    deviceId: DEVICE,
    deviceSessionVersion: 'device-v1',
  };
}

function build(payloads: Record<string, JwtPayload>) {
  const subscriber = new FakeSubscriber();
  const server = new FakeServer();
  const revoked = new Set<string>();
  const jwt = {
    verifyAsync: vi.fn(async (token: string) => {
      const payload = payloads[token];
      if (!payload) throw new Error('token invalide');
      return payload;
    }),
  } as unknown as JwtService;
  const sessions = {
    assertAllows: vi.fn(async (payload: JwtPayload) => {
      if (revoked.has(payload.sub)) throw new Error('session révoquée');
    }),
  } as unknown as SessionAccessService;
  const gateway = new OrdersGateway(subscriber as never, jwt, {} as never, sessions);
  gateway.server = server as never;
  return { gateway, subscriber, server, revoked, sessions };
}

describe('autorisation continue des rooms tenant', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('admet une session valide et refuse une session déjà révoquée', async () => {
    const { gateway, server, revoked } = build({ bon: staffPayload(), vole: staffPayload(STAFF_B) });
    revoked.add(STAFF_B);
    const bon = new FakeSocket('socket-bon', 'bon');
    const vole = new FakeSocket('socket-vole', 'vole');
    server.add(bon);
    server.add(vole);

    await gateway.handleConnection(bon.asSocket());
    await gateway.handleConnection(vole.asSocket());

    expect(bon.rooms).toContain(`tenant:${TENANT}`);
    expect(vole.disconnect).toHaveBeenCalledWith(true);
    gateway.onModuleDestroy();
  });

  it('ferme exactement à exp et ne laisse pas survivre la room', async () => {
    const payload = { ...staffPayload(), exp: Math.floor(Date.now() / 1_000) + 1 };
    const { gateway, server } = build({ court: payload });
    const socket = new FakeSocket('socket-court', 'court');
    server.add(socket);

    await gateway.handleConnection(socket.asSocket());
    await vi.advanceTimersByTimeAsync(999);
    expect(socket.disconnect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    gateway.onModuleDestroy();
  });

  it('déconnecte toutes les sockets concernées dès l’événement Redis', async () => {
    const { gateway, subscriber, server } = build({ a: staffPayload(), b: staffPayload() });
    const a = new FakeSocket('socket-a', 'a');
    const b = new FakeSocket('socket-b', 'b');
    const publicSocket = new FakeSocket('socket-public');
    server.add(a);
    server.add(b);
    server.add(publicSocket);
    await gateway.handleConnection(a.asSocket());
    await gateway.handleConnection(b.asSocket());
    await gateway.handleConnection(publicSocket.asSocket());
    await gateway.onModuleInit();

    subscriber.fire(
      'message',
      SESSION_REVOCATION_CHANNEL,
      JSON.stringify({ scope: 'device', tenantId: TENANT, deviceId: DEVICE }),
    );

    expect(a.disconnect).toHaveBeenCalledWith(true);
    expect(b.disconnect).toHaveBeenCalledWith(true);
    expect(publicSocket.disconnect).not.toHaveBeenCalled();
    gateway.onModuleDestroy();
  });

  it('revalide avant diffusion : la socket révoquée ne reçoit aucune commande', async () => {
    const { gateway, subscriber, server, revoked } = build({ a: staffPayload(), b: staffPayload(STAFF_B) });
    const a = new FakeSocket('socket-a', 'a');
    const b = new FakeSocket('socket-b', 'b');
    server.add(a);
    server.add(b);
    await gateway.handleConnection(a.asSocket());
    await gateway.handleConnection(b.asSocket());
    revoked.add(STAFF_A);
    await gateway.onModuleInit();

    const complet = {
      _id: '507f1f77bcf86cd799439011',
      number: 42,
      status: 'preparing',
      trackingToken: 'secret',
      pickup: { customerPhone: '0612345678' },
    };
    subscriber.fire(
      'pmessage',
      'tenant:*:orders',
      `tenant:${TENANT}:orders`,
      JSON.stringify({ event: 'order.created', payload: complet }),
    );

    await vi.waitFor(() => expect(a.disconnect).toHaveBeenCalledWith(true));
    expect(a.emit).not.toHaveBeenCalledWith('order.created', complet);
    expect(b.emit).toHaveBeenCalledWith('order.created', complet);
    expect(server.publicEmits).toContainEqual({
      room: `order:${complet._id}`,
      event: 'order.created',
      payload: { _id: complet._id, number: 42, status: 'preparing', pickupSlot: null },
    });
    gateway.onModuleDestroy();
  });

  it('ne rejoint pas la room si une révocation arrive pendant l’admission', async () => {
    const { gateway, subscriber, server, sessions } = build({ lent: staffPayload() });
    const socket = new FakeSocket('socket-lent', 'lent');
    server.add(socket);
    await gateway.onModuleInit();

    let release!: () => void;
    let started!: () => void;
    const admissionStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    (sessions.assertAllows as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
          started();
        }),
    );

    const connection = gateway.handleConnection(socket.asSocket());
    await admissionStarted;
    subscriber.fire(
      'message',
      SESSION_REVOCATION_CHANNEL,
      JSON.stringify({ scope: 'staff', tenantId: TENANT, staffId: STAFF_A }),
    );
    release();
    await connection;

    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(socket.join).not.toHaveBeenCalled();
    gateway.onModuleDestroy();
  });

  it('n’émet pas si la révocation arrive pendant la revalidation Mongo', async () => {
    const { gateway, subscriber, server, sessions } = build({ lent: staffPayload() });
    const socket = new FakeSocket('socket-lent', 'lent');
    server.add(socket);
    await gateway.handleConnection(socket.asSocket());
    await gateway.onModuleInit();

    let release!: () => void;
    let started!: () => void;
    const validationStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    (sessions.assertAllows as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
          started();
        }),
    );

    const complet = { _id: '507f1f77bcf86cd799439011', number: 7, status: 'new' };
    subscriber.fire(
      'pmessage',
      'tenant:*:orders',
      `tenant:${TENANT}:orders`,
      JSON.stringify({ event: 'order.created', payload: complet }),
    );
    await validationStarted;
    subscriber.fire(
      'message',
      SESSION_REVOCATION_CHANNEL,
      JSON.stringify({ scope: 'staff', tenantId: TENANT, staffId: STAFF_A }),
    );
    release();

    await vi.waitFor(() => expect(socket.disconnect).toHaveBeenCalledWith(true));
    expect(socket.emit).not.toHaveBeenCalledWith('order.created', complet);
    gateway.onModuleDestroy();
  });

  it('ne déclare pas le gateway prêt si l’abonnement de révocation échoue', async () => {
    const { gateway, subscriber } = build({});
    subscriber.subscribe.mockRejectedValueOnce(new Error('Redis indisponible'));

    await expect(gateway.onModuleInit()).rejects.toThrow(/Redis indisponible/);

    gateway.onModuleDestroy();
  });
});
