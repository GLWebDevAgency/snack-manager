/**
 * Extension fidélité du transport de démonstration POS.
 *
 * Elle reste volontairement dans l'application caisse : aucun état ne sort de
 * la mémoire du cadre de démo, et le transport partagé du produit n'est pas
 * modifié par cette première surface pilote.
 */
import type {
  LoyaltyConsentEvent,
  LoyaltyConsentMutationResult,
  LoyaltyEarn,
  LoyaltyEarnResult,
  LoyaltyEnrollmentAcknowledgementResult,
  LoyaltyEnrollmentPrepareResult,
  LoyaltyEnrollmentRecoveryResult,
  LoyaltyMemberCreate,
  LoyaltyMemberCreateResult,
  LoyaltyMemberResolve,
  LoyaltyMemberSummary,
  OrderLoyaltyEarnStatus,
  LoyaltyProgramView,
  LoyaltyRewardView,
} from '@sm/contracts';
import type { Transport, TransportRequest, TransportResponse } from '@sm/client-core';

const PROGRAM_ID = '70000000-0000-4000-8000-000000000001';
const INITIAL_MEMBER_ID = '70000000-0000-4000-8000-000000000002';
const INITIAL_QR = 'A'.repeat(43);
const ENROLLMENT_HANDOFF_WINDOW_MS = 30 * 60_000;
const ENROLLMENT_RECOVERY_RETRY_MS = 750;

const PROGRAM: LoyaltyProgramView = {
  id: PROGRAM_ID,
  name: 'Le Club Classfood',
  status: 'active',
  earn: {
    mechanism: 'points',
    minimumPurchaseCents: 500,
    maximumUnitsPerPurchase: 100,
    spendStepCents: 100,
    unitsPerStep: 1,
  },
  unitLabelSingular: 'point',
  unitLabelPlural: 'points',
  termsSummary: '1 point par euro dépensé dès 5 €. Catalogue consultable pendant le pilote.',
  rulesVersion: 1,
  createdAt: '2026-09-01T08:00:00.000Z',
  updatedAt: '2026-09-01T08:00:00.000Z',
};

const REWARDS: LoyaltyRewardView[] = [
  {
    id: '70000000-0000-4000-8000-000000000010',
    programId: PROGRAM_ID,
    name: 'Boisson offerte',
    description: 'Une boisson 33 cl au choix.',
    costUnits: 8,
    kind: 'product',
    valueCents: null,
    productRef: 'Boisson 33 cl',
    active: true,
    createdAt: '2026-09-01T08:00:00.000Z',
    updatedAt: '2026-09-01T08:00:00.000Z',
  },
  {
    id: '70000000-0000-4000-8000-000000000011',
    programId: PROGRAM_ID,
    name: '5 € de remise',
    description: 'À appliquer sur le ticket en cours.',
    costUnits: 20,
    kind: 'fixed_discount',
    valueCents: 500,
    productRef: null,
    active: true,
    createdAt: '2026-09-01T08:00:00.000Z',
    updatedAt: '2026-09-01T08:00:00.000Z',
  },
];

interface DemoMember {
  summary: LoyaltyMemberSummary;
  phone: string | null;
  qr: string;
  /** Une carte créée ne devient utilisable qu'après remise confirmée du QR. */
  handedOff: boolean;
}

interface DemoEnrollmentOperation {
  ownerRef: string;
  phase: 'prepared' | 'ready' | 'acknowledged' | 'rejected';
  expiresAt: string;
  enrollment: LoyaltyMemberCreateResult | null;
}

interface DemoOrderEarnIntent {
  orderId: string;
  clientId: string;
  memberId: string;
  operationId: string;
}

interface DemoLoyaltyState {
  members: DemoMember[];
  operations: Map<string, object>;
  enrollments: Map<string, DemoEnrollmentOperation>;
  orderEarns: Map<string, OrderLoyaltyEarnStatus>;
  orderEarnIntents: Map<string, DemoOrderEarnIntent>;
  sequence: number;
}

const response = (status: number, body: unknown): TransportResponse => ({ status, body });
const error = (status: number, message: string): TransportResponse =>
  response(status, { statusCode: status, message });

function digits(phone: string): string {
  const raw = phone.replace(/\D/g, '');
  return raw.startsWith('33') ? `0${raw.slice(2)}` : raw;
}

function makeState(): DemoLoyaltyState {
  return {
    members: [
      {
        phone: '0612345678',
        qr: INITIAL_QR,
        handedOff: true,
        summary: {
          id: INITIAL_MEMBER_ID,
          alias: 'Leïla',
          maskedPhone: '•• •• •• 56 78',
          status: 'active',
          balanceUnits: 24,
          lifetimeEarnedUnits: 38,
          lifetimeRedeemedUnits: 14,
          lastActivityAt: '2026-09-01T11:42:00.000Z',
          joinedAt: '2026-06-12T18:30:00.000Z',
        },
      },
    ],
    operations: new Map(),
    enrollments: new Map(),
    orderEarns: new Map(),
    orderEarnIntents: new Map(),
    sequence: 20,
  };
}

function nextUuid(state: DemoLoyaltyState): string {
  state.sequence += 1;
  return `70000000-0000-4000-8000-${String(state.sequence).padStart(12, '0')}`;
}

function tokenFor(sequence: number): string {
  return `DEMO${String(sequence).padStart(39, '0')}`;
}

function memberOf(state: DemoLoyaltyState, lookup: LoyaltyMemberResolve): DemoMember | undefined {
  const usable = state.members.filter(
    (member) => member.handedOff && member.summary.status === 'active',
  );
  if (lookup.by === 'member_ref') {
    return usable.find((member) => member.summary.id === lookup.memberRef);
  }
  if (lookup.by === 'qr_token') {
    return usable.find((member) => member.qr === lookup.qrToken);
  }
  return usable.find(
    (member) => member.phone !== null && digits(member.phone) === digits(lookup.phone),
  );
}

function enrollmentOwner(request: TransportRequest): string {
  const header = Object.entries(request.headers).find(
    ([name]) => name.toLowerCase() === 'authorization',
  )?.[1];
  // Le mode démo n'authentifie personne, mais deux sessions explicitement
  // distinctes ne peuvent pas reprendre la même intention d'adhésion.
  return header ?? 'demo-session';
}

function enrollmentExpired(operation: DemoEnrollmentOperation, now: () => number): boolean {
  return Date.parse(operation.expiresAt) <= now();
}

function assertEnrollmentOwner(
  operation: DemoEnrollmentOperation,
  request: TransportRequest,
): TransportResponse | null {
  return operation.ownerRef === enrollmentOwner(request)
    ? null
    : error(403, 'Cette adhésion appartient à une autre session');
}

function earnedUnits(purchaseCents: number): number {
  const rule = PROGRAM.earn;
  if (purchaseCents < rule.minimumPurchaseCents) return 0;
  return rule.mechanism === 'points'
    ? Math.min(
        rule.maximumUnitsPerPurchase ?? Number.MAX_SAFE_INTEGER,
        Math.floor(purchaseCents / rule.spendStepCents) * rule.unitsPerStep,
      )
    : Math.min(rule.maximumUnitsPerPurchase ?? Number.MAX_SAFE_INTEGER, rule.unitsPerVisit);
}

function entry(
  state: DemoLoyaltyState,
  input: {
    kind: 'earn' | 'redeem';
    deltaUnits: number;
    balanceAfter: number;
    reason: string;
    externalRef: string | null;
    at: string;
  },
) {
  return {
    id: nextUuid(state),
    kind: input.kind,
    deltaUnits: input.deltaUnits,
    balanceAfter: input.balanceAfter,
    source: 'pos' as const,
    reason: input.reason,
    externalRef: input.externalRef,
    recordedAt: input.at,
  };
}

function loyaltyRoute(
  state: DemoLoyaltyState,
  request: TransportRequest,
  now: () => number,
): TransportResponse | null {
  const path = request.path.split('?')[0]?.replace(/\/+$/, '') || '/';
  const method = request.method.toUpperCase();

  if (method === 'GET' && path === '/loyalty/program') return response(200, PROGRAM);
  if (method === 'GET' && path === '/loyalty/rewards') return response(200, REWARDS);

  const orderStatus = path.match(/^\/orders\/by-client\/([^/]+)\/loyalty$/);
  if (method === 'GET' && orderStatus) {
    const status = state.orderEarns.get(orderStatus[1] ?? '');
    return status ? response(200, status) : error(404, 'Commande introuvable');
  }

  if (method === 'POST' && path === '/loyalty/members/enrollments/prepare') {
    const operationId = (request.body as { operationId?: unknown })?.operationId;
    if (typeof operationId !== 'string') return error(400, "Identifiant d'adhésion invalide");

    const stored = state.enrollments.get(operationId);
    if (stored) {
      const forbidden = assertEnrollmentOwner(stored, request);
      if (forbidden) return forbidden;
      if (stored.phase === 'acknowledged' || stored.phase === 'rejected') {
        return error(410, "Cette adhésion n'est plus récupérable");
      }
      if (enrollmentExpired(stored, now)) {
        return error(410, 'Le délai de remise de cette carte a expiré');
      }
      const replay: LoyaltyEnrollmentPrepareResult = {
        operationId,
        status: stored.phase === 'ready' ? 'ready' : 'prepared',
        expiresAt: stored.expiresAt,
      };
      return response(200, replay);
    }

    const prepared: DemoEnrollmentOperation = {
      ownerRef: enrollmentOwner(request),
      phase: 'prepared',
      expiresAt: new Date(now() + ENROLLMENT_HANDOFF_WINDOW_MS).toISOString(),
      enrollment: null,
    };
    state.enrollments.set(operationId, prepared);
    const result: LoyaltyEnrollmentPrepareResult = {
      operationId,
      status: 'prepared',
      expiresAt: prepared.expiresAt,
    };
    return response(200, result);
  }

  if (method === 'POST' && path === '/loyalty/members/enrollments/recover') {
    const operationId = (request.body as { operationId?: unknown })?.operationId;
    const stored = typeof operationId === 'string' ? state.enrollments.get(operationId) : null;
    if (!stored || typeof operationId !== 'string') {
      return error(404, 'Adhésion fidélité introuvable');
    }
    const forbidden = assertEnrollmentOwner(stored, request);
    if (forbidden) return forbidden;
    if (stored.phase === 'acknowledged' || stored.phase === 'rejected') {
      return error(410, "Cette adhésion n'est plus récupérable");
    }
    if (enrollmentExpired(stored, now)) {
      return error(410, 'Le délai de remise de cette carte a expiré');
    }
    if (stored.phase === 'prepared' || !stored.enrollment) {
      const pending: LoyaltyEnrollmentRecoveryResult = {
        status: 'pending',
        operationId,
        retryAfterMs: ENROLLMENT_RECOVERY_RETRY_MS,
        expiresAt: stored.expiresAt,
      };
      return response(200, pending);
    }
    const ready: LoyaltyEnrollmentRecoveryResult = {
      status: 'ready',
      enrollment: { ...stored.enrollment, replayed: true },
    };
    return response(200, ready);
  }

  if (method === 'POST' && path === '/loyalty/members/enrollments/acknowledge') {
    const operationId = (request.body as { operationId?: unknown })?.operationId;
    const stored = typeof operationId === 'string' ? state.enrollments.get(operationId) : null;
    if (!stored || typeof operationId !== 'string') {
      return error(404, 'Adhésion fidélité introuvable');
    }
    const forbidden = assertEnrollmentOwner(stored, request);
    if (forbidden) return forbidden;
    if (stored.phase === 'acknowledged') {
      const replay: LoyaltyEnrollmentAcknowledgementResult = {
        operationId,
        acknowledged: true,
        replayed: true,
      };
      return response(200, replay);
    }
    if (stored.phase === 'rejected' || enrollmentExpired(stored, now)) {
      return error(410, 'Le délai de remise de cette carte a expiré');
    }
    if (stored.phase !== 'ready' || !stored.enrollment) {
      return error(409, "La carte n'est pas encore prête à être remise");
    }
    const member = state.members.find(
      (candidate) => candidate.summary.id === stored.enrollment?.member.id,
    );
    if (!member) return error(410, "Cette adhésion n'est plus récupérable");
    member.handedOff = true;
    stored.phase = 'acknowledged';
    const acknowledged: LoyaltyEnrollmentAcknowledgementResult = {
      operationId,
      acknowledged: true,
      replayed: false,
    };
    return response(200, acknowledged);
  }

  if (method === 'POST' && path === '/loyalty/members/resolve') {
    const found = memberOf(state, request.body as LoyaltyMemberResolve);
    return found ? response(200, found.summary) : error(404, 'Carte fidélité introuvable');
  }

  if (method === 'POST' && path === '/loyalty/members') {
    const body = request.body as LoyaltyMemberCreate;
    const prepared = state.enrollments.get(body.operationId);
    if (!prepared) return error(409, "Préparez l'adhésion avant de transmettre le profil");
    const forbidden = assertEnrollmentOwner(prepared, request);
    if (forbidden) return forbidden;
    if (prepared.phase === 'acknowledged' || prepared.phase === 'rejected') {
      return error(410, "Cette adhésion n'est plus récupérable");
    }
    if (enrollmentExpired(prepared, now)) {
      return error(410, 'Le délai de remise de cette carte a expiré');
    }
    if (prepared.phase === 'ready' && prepared.enrollment) {
      return response(201, { ...prepared.enrollment, replayed: true });
    }
    if (body.termsAccepted !== true) {
      prepared.phase = 'rejected';
      return error(400, 'Acceptation des conditions requise');
    }
    if (
      body.phone &&
      state.members.some(
        (member) => member.phone && digits(member.phone) === digits(body.phone!),
      )
    ) {
      prepared.phase = 'rejected';
      return error(409, 'Ce téléphone est déjà rattaché à une carte fidélité');
    }
    const id = nextUuid(state);
    const qrToken = tokenFor(state.sequence);
    const at = new Date(now()).toISOString();
    const created: DemoMember = {
      phone: body.phone,
      qr: qrToken,
      handedOff: false,
      summary: {
        id,
        alias: body.firstName || `Carte ${id.slice(-4)}`,
        maskedPhone: body.phone
          ? `•• •• •• ${digits(body.phone).slice(-4, -2)} ${digits(body.phone).slice(-2)}`
          : null,
        status: 'active',
        balanceUnits: 0,
        lifetimeEarnedUnits: 0,
        lifetimeRedeemedUnits: 0,
        lastActivityAt: null,
        joinedAt: at,
      },
    };
    state.members.push(created);
    const result: LoyaltyMemberCreateResult = {
      operationId: body.operationId,
      replayed: false,
      member: created.summary,
      qrToken,
      handoffExpiresAt: prepared.expiresAt,
    };
    prepared.phase = 'ready';
    prepared.enrollment = result;
    return response(201, result);
  }

  const match = path.match(/^\/loyalty\/members\/([^/]+)\/(earn|redemptions|consents)$/);
  if (method !== 'POST' || !match) return null;
  const member = state.members.find(
    (candidate) =>
      candidate.summary.id === match[1] &&
      candidate.handedOff &&
      candidate.summary.status === 'active',
  );
  if (!member) return error(404, 'Carte fidélité introuvable');
  const action = match[2];

  if (action === 'redemptions') {
    return error(410, 'La consommation fidélité exige désormais un ticket de vente');
  }

  if (action === 'consents') {
    const body = request.body as LoyaltyConsentEvent;
    const replay = state.operations.get(body.operationId) as LoyaltyConsentMutationResult | undefined;
    if (replay) return response(201, { ...replay, replayed: true });
    if (body.decision === 'granted') {
      return error(409, 'Le canal marketing SMS n’est pas activé pendant le pilote');
    }
    const result: LoyaltyConsentMutationResult = {
      operationId: body.operationId,
      replayed: false,
      consent: {
        purpose: body.purpose,
        decision: body.decision,
        noticeVersion: body.noticeVersion,
        updatedAt: new Date(now()).toISOString(),
      },
    };
    state.operations.set(body.operationId, result);
    return response(201, result);
  }

  const operationId = (request.body as { operationId: string }).operationId;
  const replay = state.operations.get(operationId);
  if (replay) return response(201, { ...replay, replayed: true });
  const at = new Date(now()).toISOString();

  if (action === 'earn') {
    const body = request.body as LoyaltyEarn;
    const units = earnedUnits(body.purchaseCents);
    member.summary = {
      ...member.summary,
      balanceUnits: member.summary.balanceUnits + units,
      lifetimeEarnedUnits: member.summary.lifetimeEarnedUnits + units,
      lastActivityAt: at,
    };
    const result: LoyaltyEarnResult = {
      operationId,
      replayed: false,
      outcome: units === 0 ? 'below_minimum' : 'earned',
      awardedUnits: units,
      rulesVersion: PROGRAM.rulesVersion,
      member: member.summary,
      entry:
        units === 0
          ? null
          : entry(state, {
              kind: 'earn',
              deltaUnits: units,
              balanceAfter: member.summary.balanceUnits,
              reason: 'Gain automatique sur achat',
              externalRef: body.externalRef,
              at,
            }),
    };
    state.operations.set(operationId, result);
    return response(201, result);
  }

  return null;
}

interface DemoOrderProjection {
  _id?: unknown;
  clientId?: unknown;
  status?: unknown;
  totals?: { total?: unknown };
  payment?: { status?: unknown };
}

function registerOrderEarn(
  state: DemoLoyaltyState,
  request: TransportRequest,
  delegated: TransportResponse,
): void {
  const body = request.body as {
    clientId?: unknown;
    loyaltyMemberId?: unknown;
    loyaltyEarnOperationId?: unknown;
  };
  if (
    typeof body.clientId !== 'string' ||
    typeof body.loyaltyMemberId !== 'string' ||
    typeof body.loyaltyEarnOperationId !== 'string' ||
    state.orderEarns.has(body.clientId)
  ) {
    return;
  }

  const order = delegated.body as DemoOrderProjection;
  if (typeof order._id !== 'string') {
    state.orderEarns.set(body.clientId, {
      state: 'failed',
      attempts: 1,
      errorCode: 'invalid_demo_order',
    });
    return;
  }

  state.orderEarnIntents.set(order._id, {
    orderId: order._id,
    clientId: body.clientId,
    memberId: body.loyaltyMemberId,
    operationId: body.loyaltyEarnOperationId,
  });
  // Comme Mongo en production, la création ne fait qu'enregistrer l'intention.
  // Même une réponse de POST atypiquement déjà livrée ne crédite rien ici.
  state.orderEarns.set(body.clientId, {
    state: 'pending',
    attempts: 0,
    errorCode: null,
  });
}

function cancelOrderEarn(state: DemoLoyaltyState, intent: DemoOrderEarnIntent): void {
  const current = state.orderEarns.get(intent.clientId);
  if (!current || (current.state !== 'pending' && current.state !== 'processing')) return;
  state.orderEarns.set(intent.clientId, {
    state: 'cancelled',
    attempts: current.attempts,
    errorCode: 'sale_cancelled',
  });
}

function completeOrderEarn(
  state: DemoLoyaltyState,
  intent: DemoOrderEarnIntent,
  order: DemoOrderProjection,
  now: () => number,
): void {
  const current = state.orderEarns.get(intent.clientId);
  if (!current || (current.state !== 'pending' && current.state !== 'processing')) return;
  if (order.status !== 'delivered' || order.payment?.status !== 'paid') return;

  const total = order.totals?.total;
  const member = state.members.find(
    (candidate) =>
      candidate.summary.id === intent.memberId &&
      candidate.handedOff &&
      candidate.summary.status === 'active',
  );
  if (!member || typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0) {
    state.orderEarns.set(intent.clientId, {
      state: 'failed',
      attempts: current.attempts + 1,
      errorCode: 'invalid_demo_order',
    });
    return;
  }

  const units = earnedUnits(total);
  if (units > 0) {
    member.summary = {
      ...member.summary,
      balanceUnits: member.summary.balanceUnits + units,
      lifetimeEarnedUnits: member.summary.lifetimeEarnedUnits + units,
      lastActivityAt: new Date(now()).toISOString(),
    };
  }
  state.orderEarns.set(intent.clientId, {
    state: 'completed',
    attempts: current.attempts + 1,
    errorCode: null,
  });
}

function reconcileOrderEarnMutation(
  state: DemoLoyaltyState,
  request: TransportRequest,
  delegated: TransportResponse,
  now: () => number,
): void {
  const path = request.path.split('?')[0]?.replace(/\/+$/, '') || '/';
  const statusMatch = path.match(/^\/orders\/([^/]+)\/status$/);
  const cancelMatch = path.match(/^\/orders\/([^/]+)\/cancel$/);
  const orderId = statusMatch?.[1] ?? cancelMatch?.[1];
  if (!orderId) return;
  const intent = state.orderEarnIntents.get(orderId);
  if (!intent) return;

  const order = delegated.body as DemoOrderProjection;
  if (cancelMatch || order.status === 'cancelled' || order.payment?.status === 'refunded') {
    cancelOrderEarn(state, intent);
    return;
  }
  if (statusMatch) completeOrderEarn(state, intent, order, now);
}

export function withDemoLoyalty(
  base: Transport,
  options: { now?: () => number } = {},
): Transport {
  const state = makeState();
  const now = options.now ?? (() => Date.now());
  return {
    async send(request) {
      const loyalty = loyaltyRoute(state, request, now);
      if (loyalty) return loyalty;

      const delegated = await base.send(request);
      const path = request.path.split('?')[0]?.replace(/\/+$/, '') || '/';
      const successful = delegated.status >= 200 && delegated.status < 300;
      if (successful && request.method.toUpperCase() === 'POST' && path === '/orders') {
        registerOrderEarn(state, request, delegated);
      } else if (successful) {
        reconcileOrderEarnMutation(state, request, delegated, now);
      }
      return delegated;
    },
  };
}

export const DEMO_LOYALTY_QR = INITIAL_QR;
