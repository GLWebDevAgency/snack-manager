import 'reflect-metadata';
import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { JwtPayload } from '@sm/contracts';
import { describe, expect, it, vi } from 'vitest';
import { AuthGuard, IS_PUBLIC, ROLES } from '../../common/auth';
import { OrdersController } from './orders.controller';

function route(role: JwtPayload['role'], authenticated = true) {
  const actor: JwtPayload = { sub: 'operator', tenantId: '507f1f77bcf86cd799439011', role,
    kind: ['owner', 'cogerant', 'comptable', 'sm_admin'].includes(role) ? 'user' : 'staff' };
  const request = { headers: authenticated ? { authorization: 'Bearer test-only' } : {} };
  const context = { getClass: () => OrdersController, getHandler: () => OrdersController.prototype.byClientId,
    switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
  const sessions = { assertAllows: vi.fn(async () => undefined) };
  const guard = new AuthGuard({ verifyAsync: async () => actor } as never, new Reflector(), sessions as never);
  return { guard, context, sessions, actor };
}

describe('droits de la recherche exacte nécessaire à la reprise d’encaissement', () => {
  it('déclare explicitement le cogérant sans ouvrir la route à la cuisine', () => {
    expect(Reflect.getMetadata(ROLES, OrdersController.prototype.byClientId)).toEqual(['owner', 'cogerant', 'gerant', 'caisse']);
    expect(Reflect.getMetadata(IS_PUBLIC, OrdersController.prototype.byClientId)).not.toBe(true);
  });

  it.each(['owner', 'cogerant', 'gerant', 'caisse'] as const)('la vraie garde autorise %s après relecture de sa session', async (role) => {
    const { guard, context, sessions, actor } = route(role);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(sessions.assertAllows).toHaveBeenCalledExactlyOnceWith(actor);
  });

  it.each(['cuisine', 'comptable', 'sm_admin'] as const)('la vraie garde continue de refuser %s', async (role) => {
    const { guard, context } = route(role);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('reste inaccessible sans authentification', async () => {
    const { guard, context, sessions } = route('cogerant', false);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(sessions.assertAllows).not.toHaveBeenCalled();
  });
});
