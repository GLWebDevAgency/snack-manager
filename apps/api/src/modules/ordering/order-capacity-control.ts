import { createHash } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';
import type { OrderCapacityControl } from '@sm/db';
import { formatDay, parisYmd, parseDay } from './paris-time';

// Lecture stricte des preuves persistées, commune aux writers de réglages et de journées.
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export type Slot = { at: Date; kitchenCapacity: number; deliveryCapacity: number };
export type Plan = { day: string; sourceRevision: number; closedReason: 'no_service' | 'exceptional_closure' | null; slots: Slot[] };
export type Intent = Plan & { operationId: string; planHash: string };
export type Control = Omit<OrderCapacityControl, 'dayIntent'> & { dayIntent?: Intent | null };

export function unavailable() {
  return new ServiceUnavailableException({ code: 'ORDER_CAPACITY_CALENDAR_UNAVAILABLE',
    message: 'Le calendrier reste à vérifier. Conservez la même tentative de commande.' });
}

export function validRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Stable across helpers/settings changes; operationId is deliberately not part of the plan. */
export function orderCapacityCalendarPlanHash(plan: Plan): string {
  return createHash('sha256').update(JSON.stringify({
    day: plan.day, sourceRevision: plan.sourceRevision, closedReason: plan.closedReason,
    slots: plan.slots.map(({ at, kitchenCapacity, deliveryCapacity }) => ({
      at: at.toISOString(), kitchenCapacity, deliveryCapacity,
    })),
  })).digest('hex');
}

export function validatePlan(plan: Omit<Plan, 'closedReason'> & { closedReason?: Plan['closedReason'] }): asserts plan is Plan {
  if (!plan || typeof plan.day !== 'string' || !parseDay(plan.day) || !validRevision(plan.sourceRevision)
    || !Array.isArray(plan.slots) || plan.slots.length > 1_000) throw unavailable();
  if (plan.slots.length === 0) {
    if (!['no_service', 'exceptional_closure'].includes(plan.closedReason ?? '')) throw unavailable();
  } else if (plan.closedReason !== null) throw unavailable();
  for (const [index, slot] of plan.slots.entries()) {
    if (!slot || !(slot.at instanceof Date) || !Number.isFinite(slot.at.getTime())
      || formatDay(parisYmd(slot.at)) !== plan.day || (index > 0 && slot.at.getTime() <= plan.slots[index - 1]!.at.getTime())
      || !Number.isInteger(slot.kitchenCapacity) || slot.kitchenCapacity < 1 || slot.kitchenCapacity > 100
      || !Number.isInteger(slot.deliveryCapacity) || slot.deliveryCapacity < 1 || slot.deliveryCapacity > 50) throw unavailable();
  }
}

export function validateControl(control: OrderCapacityControl): asserts control is OrderCapacityControl & Control {
  if (!control || control.version !== 1 || !['seeding', 'active', 'blocked'].includes(control.state)
    || !validRevision(control.configRevision) || typeof control.bootstrapId !== 'string' || !UUID.test(control.bootstrapId)
    || !(control.cutoverAt instanceof Date) || !Number.isFinite(control.cutoverAt.getTime())) throw unavailable();
  const intent = control.dayIntent;
  if (intent !== undefined && intent !== null) {
    validatePlan(intent);
    if (typeof intent.operationId !== 'string' || !UUID.test(intent.operationId)
      || intent.sourceRevision > control.configRevision || intent.day < formatDay(parisYmd(control.cutoverAt))
      || typeof intent.planHash !== 'string'
      || intent.planHash !== orderCapacityCalendarPlanHash(intent)) throw unavailable();
  }
}
