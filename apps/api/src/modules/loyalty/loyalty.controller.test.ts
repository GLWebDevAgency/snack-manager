import 'reflect-metadata';
import { BadRequestException, RequestMethod } from '@nestjs/common';
import {
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';
import { ROLES } from '../../common/auth';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { LoyaltyAdminService } from './loyalty-admin.service';
import { LoyaltyMemberService } from './loyalty-member.service';
import { LoyaltyController } from './loyalty.controller';

const TENANT = '65f000000000000000000001';
const MEMBER = '11111111-1111-4111-8111-111111111111';

function harness() {
  const loyalty = {
    getProgram: vi.fn(),
    putProgram: vi.fn(),
    listRewards: vi.fn(),
    createReward: vi.fn(),
    updateReward: vi.fn(),
  };
  const members = {
    dashboard: vi.fn().mockResolvedValue({ view: 'dashboard' }),
    listMembers: vi.fn().mockResolvedValue({ view: 'members' }),
    getMemberDetail: vi.fn().mockResolvedValue({ view: 'member' }),
  };
  return {
    controller: new LoyaltyController(
      loyalty as unknown as LoyaltyAdminService,
      members as unknown as LoyaltyMemberService,
    ),
    members,
  };
}

function queryPipe(): ZodValidationPipe {
  const args = (Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    LoyaltyController,
    'listMembers',
  ) ?? {}) as Record<string, { pipes?: unknown[] }>;
  const query = Object.entries(args).find(([key]) => key.startsWith('4:'))?.[1];
  const pipe = query?.pipes?.[0];
  if (!(pipe instanceof ZodValidationPipe)) throw new Error('Pipe query fidélité absent');
  return pipe;
}

describe('LoyaltyController — pilotage manager', () => {
  it('réserve le module au propriétaire et au gérant', () => {
    expect(Reflect.getMetadata(PATH_METADATA, LoyaltyController)).toBe('loyalty');
    expect(Reflect.getMetadata(ROLES, LoyaltyController)).toEqual(['owner', 'gerant']);
  });

  it.each([
    ['dashboard', 'dashboard'],
    ['listMembers', 'members'],
    ['getMember', 'members/:id'],
  ] as const)('expose GET /loyalty/%s', (method, path) => {
    const handler = LoyaltyController.prototype[method];
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.GET);
  });

  it('branche tenant, pagination et fiche sans accepter de téléphone dans l’URL', async () => {
    const { controller, members } = harness();
    const query = queryPipe().transform({ limit: '25', status: 'active' });

    await expect(controller.dashboard(TENANT)).resolves.toEqual({ view: 'dashboard' });
    await expect(controller.listMembers(TENANT, query)).resolves.toEqual({ view: 'members' });
    await expect(controller.getMember(TENANT, MEMBER)).resolves.toEqual({ view: 'member' });
    expect(members.dashboard).toHaveBeenCalledWith(TENANT);
    expect(members.listMembers).toHaveBeenCalledWith(TENANT, {
      limit: 25,
      status: 'active',
    });
    expect(members.getMemberDetail).toHaveBeenCalledWith(TENANT, MEMBER);
    expect(() =>
      queryPipe().transform({ limit: '25', phone: '06 12 34 56 78' }),
    ).toThrow(BadRequestException);
  });
});
