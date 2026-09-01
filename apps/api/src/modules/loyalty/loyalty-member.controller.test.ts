import 'reflect-metadata';
import {
  BadRequestException,
  GoneException,
  ParseUUIDPipe,
  RequestMethod,
  type ArgumentMetadata,
} from '@nestjs/common';
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import {
  type JwtPayload,
  type LoyaltyAdminAdjustment,
  type LoyaltyConsentEvent,
  type LoyaltyEnrollmentRecovery,
  type LoyaltyEarn,
  type LoyaltyLedgerReversal,
  type LoyaltyMemberCreate,
  type LoyaltyMemberLifecycle,
  type LoyaltyMemberQrReplace,
  type LoyaltyMemberResolve,
  type LoyaltyRedeem,
} from '@sm/contracts';
import { describe, expect, it, vi } from 'vitest';
import { ROLES } from '../../common/auth';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { LoyaltyAdminService } from './loyalty-admin.service';
import { LoyaltyMemberController } from './loyalty-member.controller';
import { LoyaltyMemberService } from './loyalty-member.service';
import { LoyaltyOrderEarnProcessor } from './loyalty-order-earn.processor';
import { LoyaltyPublicController } from './loyalty-public.controller';
import { LoyaltyPublicService } from './loyalty-public.service';
import { LoyaltyPurchaseVerifier } from './loyalty-purchase-verifier';
import { LoyaltyController } from './loyalty.controller';
import { LoyaltyModule } from './loyalty.module';

const TENANT = '65f000000000000000000001';
const DEVICE = '65f000000000000000000099';
const MEMBER = '11111111-1111-4111-8111-111111111111';
const REWARD = '22222222-2222-4222-8222-222222222222';

const OWNER: JwtPayload = {
  sub: '65f000000000000000000010',
  tenantId: TENANT,
  role: 'owner',
  kind: 'user',
};
const CASHIER: JwtPayload = {
  sub: '65f000000000000000000020',
  tenantId: TENANT,
  role: 'caisse',
  kind: 'staff',
  deviceId: DEVICE,
};
const MANAGER_AT_POS: JwtPayload = {
  sub: '65f000000000000000000030',
  tenantId: TENANT,
  role: 'gerant',
  kind: 'staff',
  deviceId: DEVICE,
};

const CREATE: LoyaltyMemberCreate = {
  operationId: '30000000-0000-4000-8000-000000000001',
  firstName: 'Leïla',
  phone: '+33 6 12 34 56 78',
  termsAccepted: true,
  termsNoticeVersion: 'loyalty-2026-09',
};
const RESOLVE: LoyaltyMemberResolve = { by: 'member_ref', memberRef: MEMBER };
const RECOVER: LoyaltyEnrollmentRecovery = { operationId: CREATE.operationId };
const EARN: LoyaltyEarn = {
  operationId: '30000000-0000-4000-8000-000000000002',
  purchaseCents: 1_850,
  externalRef: 'pos-order:40000000-0000-4000-8000-000000000042',
};
const REDEEM: LoyaltyRedeem = {
  operationId: '30000000-0000-4000-8000-000000000003',
  rewardId: REWARD,
  expectedCostUnits: 15,
  externalRef: 'pos-redemption:30000000-0000-4000-8000-000000000003',
};
const ADJUST: LoyaltyAdminAdjustment = {
  operationId: '30000000-0000-4000-8000-000000000004',
  units: 5,
  reason: 'Geste commercial validé',
};
const REVERSE: LoyaltyLedgerReversal = {
  operationId: '30000000-0000-4000-8000-000000000008',
  reason: 'Commande annulée après encaissement',
};
const CONSENT: LoyaltyConsentEvent = {
  operationId: '30000000-0000-4000-8000-000000000005',
  purpose: 'marketing_sms',
  decision: 'granted',
  noticeVersion: 'marketing-2026-09',
};
const LIFECYCLE: LoyaltyMemberLifecycle = {
  operationId: '30000000-0000-4000-8000-000000000006',
  action: 'block',
  reasonCode: 'suspected_sharing',
};
const REPLACE_QR: LoyaltyMemberQrReplace = {
  operationId: '30000000-0000-4000-8000-000000000007',
  reasonCode: 'lost_or_compromised',
  expectedGeneration: 1,
};

function harness() {
  const createMember = vi.fn().mockResolvedValue({ route: 'create' });
  const recoverEnrollment = vi.fn().mockResolvedValue({ route: 'recover' });
  const resolveMember = vi.fn().mockResolvedValue({ route: 'resolve' });
  const earn = vi.fn().mockResolvedValue({ route: 'earn' });
  const redeem = vi.fn().mockResolvedValue({ route: 'redeem' });
  const adjust = vi.fn().mockResolvedValue({ route: 'adjust' });
  const reverseLedgerEntry = vi.fn().mockResolvedValue({ route: 'reverse' });
  const recordConsent = vi.fn().mockResolvedValue({ route: 'consent' });
  const changeLifecycle = vi.fn().mockResolvedValue({ route: 'lifecycle' });
  const replaceQr = vi.fn().mockResolvedValue({ route: 'replaceQr' });
  const service = {
    createMember,
    recoverEnrollment,
    resolveMember,
    earn,
    redeem,
    adjust,
    reverseLedgerEntry,
    recordConsent,
    changeLifecycle,
    replaceQr,
  };
  const controller = new LoyaltyMemberController(
    service as unknown as LoyaltyMemberService,
  );
  return {
    controller,
    createMember,
    recoverEnrollment,
    resolveMember,
    earn,
    redeem,
    adjust,
    reverseLedgerEntry,
    recordConsent,
    changeLifecycle,
    replaceQr,
  };
}

type RouteMethod =
  | 'create'
  | 'recoverEnrollment'
  | 'resolve'
  | 'earn'
  | 'redeem'
  | 'adjust'
  | 'reverseLedgerEntry'
  | 'recordConsent'
  | 'changeLifecycle'
  | 'replaceQr';

function routeArguments(method: RouteMethod): Record<string, { pipes?: unknown[] }> {
  return (
    Reflect.getMetadata(ROUTE_ARGS_METADATA, LoyaltyMemberController, method) ?? {}
  ) as Record<string, { pipes?: unknown[] }>;
}

function bodyPipe(method: RouteMethod): ZodValidationPipe {
  const body = Object.entries(routeArguments(method)).find(([key]) => key.startsWith('3:'))?.[1];
  const pipe = body?.pipes?.[0];
  if (!(pipe instanceof ZodValidationPipe)) {
    throw new Error(`Pipe Zod absent de LoyaltyMemberController.${method}`);
  }
  return pipe;
}

describe('LoyaltyMemberController — frontière HTTP', () => {
  it('expose les dix POST sous /loyalty/members, avec les lectures en 200', () => {
    expect(Reflect.getMetadata(PATH_METADATA, LoyaltyMemberController)).toBe('loyalty/members');

    const routes = {
      create: '/',
      recoverEnrollment: 'enrollments/recover',
      resolve: 'resolve',
      earn: ':id/earn',
      redeem: ':id/redemptions',
      adjust: ':id/adjustments',
      reverseLedgerEntry: ':id/ledger/:entryId/reversals',
      recordConsent: ':id/consents',
      changeLifecycle: ':id/lifecycle',
      replaceQr: ':id/qr/replace',
    } as const;
    for (const [method, path] of Object.entries(routes) as [RouteMethod, string][]) {
      const handler = LoyaltyMemberController.prototype[method];
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
      expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.POST);
    }
    expect(
      Reflect.getMetadata(HTTP_CODE_METADATA, LoyaltyMemberController.prototype.resolve),
    ).toBe(200);
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        LoyaltyMemberController.prototype.recoverEnrollment,
      ),
    ).toBe(200);
  });

  it('autorise le propriétaire, le gérant et la caisse — jamais la cuisine', () => {
    expect(Reflect.getMetadata(ROLES, LoyaltyMemberController)).toEqual([
      'owner',
      'gerant',
      'caisse',
    ]);
    expect(
      Reflect.getMetadata(ROLES, LoyaltyMemberController.prototype.adjust),
    ).toEqual(['owner', 'gerant']);
    expect(
      Reflect.getMetadata(
        ROLES,
        LoyaltyMemberController.prototype.reverseLedgerEntry,
      ),
    ).toEqual(['owner', 'gerant']);
    expect(
      Reflect.getMetadata(ROLES, LoyaltyMemberController.prototype.changeLifecycle),
    ).toEqual(['owner', 'gerant']);
    expect(
      Reflect.getMetadata(ROLES, LoyaltyMemberController.prototype.replaceQr),
    ).toEqual(['owner', 'gerant']);
  });

  it('enregistre le contrôleur et son service dans LoyaltyModule', () => {
    const controllers = Reflect.getMetadata('controllers', LoyaltyModule) as unknown[];
    const providers = Reflect.getMetadata('providers', LoyaltyModule) as unknown[];
    expect(controllers).toEqual([
      LoyaltyController,
      LoyaltyMemberController,
      LoyaltyPublicController,
    ]);
    expect(providers).toEqual([
      LoyaltyAdminService,
      LoyaltyMemberService,
      LoyaltyOrderEarnProcessor,
      LoyaltyPublicService,
      LoyaltyPurchaseVerifier,
    ]);
  });

  it('dérive auteur et appareil du JWT lors de la création', async () => {
    const { controller, createMember } = harness();

    await expect(controller.create(TENANT, CASHIER, CREATE)).resolves.toEqual({ route: 'create' });
    expect(createMember).toHaveBeenCalledWith(TENANT, CREATE, {
      source: 'pos',
      actorRef: CASHIER.sub,
      deviceRef: DEVICE,
    });
  });

  it("reprend une adhésion dans le tenant sans retransmettre de profil", async () => {
    const { controller, recoverEnrollment } = harness();

    await expect(controller.recoverEnrollment(TENANT, RECOVER)).resolves.toEqual({
      route: 'recover',
    });
    expect(recoverEnrollment).toHaveBeenCalledWith(TENANT, RECOVER.operationId);
  });

  it('résout une carte dans le tenant du JWT, sans contexte falsifiable dans le body', async () => {
    const { controller, resolveMember } = harness();

    await expect(controller.resolve(TENANT, RESOLVE)).resolves.toEqual({ route: 'resolve' });
    expect(resolveMember).toHaveBeenCalledWith(TENANT, RESOLVE);
  });

  it('transmet le gain signé mais suspend tout débit sans ticket', async () => {
    const { controller, earn, redeem } = harness();

    await expect(controller.earn(TENANT, OWNER, MEMBER, EARN)).resolves.toEqual({ route: 'earn' });
    expect(earn).toHaveBeenCalledWith(TENANT, MEMBER, EARN, {
      source: 'pos',
      actorRef: OWNER.sub,
      deviceRef: null,
    });

    expect(() => controller.redeem(TENANT, CASHIER, MEMBER, REDEEM)).toThrow(
      GoneException,
    );
    expect(redeem).not.toHaveBeenCalled();
  });

  it('trace correction et consentement avec le contexte signé', async () => {
    const { controller, adjust, recordConsent } = harness();

    await expect(controller.adjust(TENANT, OWNER, MEMBER, ADJUST)).resolves.toEqual({
      route: 'adjust',
    });
    expect(adjust).toHaveBeenCalledWith(TENANT, MEMBER, ADJUST, {
      source: 'admin',
      actorRef: OWNER.sub,
      deviceRef: null,
    });

    await expect(
      controller.recordConsent(TENANT, CASHIER, MEMBER, CONSENT),
    ).resolves.toEqual({ route: 'consent' });
    expect(recordConsent).toHaveBeenCalledWith(TENANT, MEMBER, CONSENT, {
      source: 'pos',
      actorRef: CASHIER.sub,
      deviceRef: DEVICE,
    });
  });

  it('compense une écriture précise avec le tenant et le manager signés', async () => {
    const { controller, reverseLedgerEntry } = harness();

    await expect(
      controller.reverseLedgerEntry(TENANT, OWNER, MEMBER, REWARD, REVERSE),
    ).resolves.toEqual({ route: 'reverse' });
    expect(reverseLedgerEntry).toHaveBeenCalledWith(
      TENANT,
      MEMBER,
      REWARD,
      REVERSE,
      {
        source: 'admin',
        actorRef: OWNER.sub,
        deviceRef: null,
      },
    );
  });

  it("conserve l'autorité admin d'un gérant authentifié sur une caisse", async () => {
    const { controller, reverseLedgerEntry } = harness();

    await expect(
      controller.reverseLedgerEntry(TENANT, MANAGER_AT_POS, MEMBER, REWARD, REVERSE),
    ).resolves.toEqual({ route: 'reverse' });
    expect(reverseLedgerEntry).toHaveBeenCalledWith(
      TENANT,
      MEMBER,
      REWARD,
      REVERSE,
      {
        source: 'admin',
        actorRef: MANAGER_AT_POS.sub,
        deviceRef: DEVICE,
      },
    );
  });

  it('réserve lifecycle et remplacement QR au manager avec contexte signé', async () => {
    const { controller, changeLifecycle, replaceQr } = harness();

    await expect(
      controller.changeLifecycle(TENANT, OWNER, MEMBER, LIFECYCLE),
    ).resolves.toEqual({ route: 'lifecycle' });
    expect(changeLifecycle).toHaveBeenCalledWith(TENANT, MEMBER, LIFECYCLE, {
      source: 'admin',
      actorRef: OWNER.sub,
      deviceRef: null,
    });

    await expect(controller.replaceQr(TENANT, OWNER, MEMBER, REPLACE_QR)).resolves.toEqual({
      route: 'replaceQr',
    });
    expect(replaceQr).toHaveBeenCalledWith(TENANT, MEMBER, REPLACE_QR, {
      source: 'admin',
      actorRef: OWNER.sub,
      deviceRef: null,
    });
  });
});

describe('LoyaltyMemberController — contrats Zod réellement branchés', () => {
  it('applique les valeurs par défaut du contrat de création', () => {
    expect(
      bodyPipe('create').transform({
        operationId: CREATE.operationId,
        termsAccepted: true,
        termsNoticeVersion: CREATE.termsNoticeVersion,
      }),
    ).toEqual({
      operationId: CREATE.operationId,
      firstName: null,
      phone: null,
      termsAccepted: true,
      termsNoticeVersion: CREATE.termsNoticeVersion,
    });
  });

  it('branche une reprise stricte sans donnée personnelle', () => {
    expect(bodyPipe('recoverEnrollment').transform(RECOVER)).toEqual(RECOVER);
    expect(() =>
      bodyPipe('recoverEnrollment').transform({
        ...RECOVER,
        phone: '06 12 34 56 78',
      }),
    ).toThrow(BadRequestException);
  });

  it("exige l'acceptation des conditions et le coût affiché avant mutation", () => {
    expect(() =>
      bodyPipe('create').transform({
        operationId: CREATE.operationId,
        termsNoticeVersion: CREATE.termsNoticeVersion,
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      bodyPipe('create').transform({ ...CREATE, termsAccepted: false }),
    ).toThrow(BadRequestException);
    expect(() =>
      bodyPipe('redeem').transform({
        operationId: REDEEM.operationId,
        rewardId: REDEEM.rewardId,
      }),
    ).toThrow(BadRequestException);
  });

  it('refuse les champs de tenant, de source ou de solde injectés par le client', () => {
    expect(() =>
      bodyPipe('create').transform({
        ...CREATE,
        tenantRef: 'voisin',
        source: 'admin',
        balanceUnits: 999_999,
      }),
    ).toThrow(BadRequestException);
  });

  it('refuse les formes invalides sur resolve, earn, redeem, correction et consentement', () => {
    expect(() => bodyPipe('resolve').transform({ by: 'phone', phone: '12' })).toThrow(
      BadRequestException,
    );
    expect(() => bodyPipe('earn').transform({ ...EARN, purchaseCents: -1 })).toThrow(
      BadRequestException,
    );
    expect(() => bodyPipe('redeem').transform({ ...REDEEM, rewardId: 'pas-un-uuid' })).toThrow(
      BadRequestException,
    );
    expect(() =>
      bodyPipe('redeem').transform({
        ...REDEEM,
        externalRef: 'Téléphone client : 06 12 34 56 78',
      }),
    ).toThrow(BadRequestException);
    expect(() => bodyPipe('adjust').transform({ ...ADJUST, units: 0 })).toThrow(
      BadRequestException,
    );
    expect(() =>
      bodyPipe('reverseLedgerEntry').transform({ ...REVERSE, reason: 'x' }),
    ).toThrow(BadRequestException);
    expect(() =>
      bodyPipe('reverseLedgerEntry').transform({ ...REVERSE, deltaUnits: 999 }),
    ).toThrow(BadRequestException);
    expect(() =>
      bodyPipe('recordConsent').transform({ ...CONSENT, decision: 'peut-être' }),
    ).toThrow(BadRequestException);
    expect(() =>
      bodyPipe('changeLifecycle').transform({
        operationId: LIFECYCLE.operationId,
        action: 'anonymize',
        reasonCode: 'customer_request',
        confirmation: false,
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      bodyPipe('replaceQr').transform({
        ...REPLACE_QR,
        reasonCode: 'identity_verified',
      }),
    ).toThrow(BadRequestException);
  });

  it('branche aussi ParseUUIDPipe sur les identifiants membre', async () => {
    const param = Object.entries(routeArguments('earn')).find(([key]) => key.startsWith('5:'))?.[1];
    const pipe = param?.pipes?.[0];
    expect(pipe).toBeInstanceOf(ParseUUIDPipe);

    await expect(
      (pipe as ParseUUIDPipe).transform('pas-un-uuid', {
        type: 'param',
        metatype: String,
        data: 'id',
      } satisfies ArgumentMetadata),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
