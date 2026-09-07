import type { OrderCapacityCalendarInput } from './order-capacity-calendar';
import type { Intent, Plan } from './order-capacity-control';

/** Projection interne explicite : IDs Mongo convertis en hex, Dates conservées.
 * Aucun DTO public, prix, ligne, adresse ou téléphone n'entre dans ce plan. */
export type BootstrapOrderEvidence = Readonly<{
  orderId: string;
  tenantId: string;
  clientId: string;
  channel: string;
  type: string;
  status: string;
  slot: Date | null;
  publicRecovery?: Readonly<{ version: number; proofHash: string; payloadHash: string }> | null;
}>;

export type BootstrapAdmissionEvidence = Readonly<{
  admissionId: string;
  tenantId: string;
  clientId: string;
  version: number;
  kind?: string | null;
  channel?: string | null;
  state: string;
  slot: Date;
  orderId?: string | null;
  proofHash: string;
  payloadHash: string;
  snapshot?: BootstrapOrderEvidence | null;
  capacity?: Readonly<{ slot: Date; kitchenSeat?: number; deliverySeat?: number; releasedAt?: Date }> | null;
}>;

export type BootstrapFrozenDay = Readonly<Plan & { tenantId: string; state: string }>;
export type CapacityBootstrapInput = Readonly<{
  tenantId: string;
  cutoverAt: Date;
  sourceRevision: number;
  settings: OrderCapacityCalendarInput;
  orders: readonly BootstrapOrderEvidence[];
  admissions: readonly BootstrapAdmissionEvidence[];
  frozenDays?: readonly BootstrapFrozenDay[];
  dayIntent?: Readonly<Intent> | null;
}>;

export type CapacityBootstrapIssueCode =
  | 'invalid_order' | 'invalid_admission' | 'foreign_tenant'
  | 'duplicate_order_identity' | 'duplicate_admission_identity'
  | 'admission_identity_mismatch' | 'recovery_binding_mismatch'
  | 'pending_validation' | 'terminal_admission_conflict'
  | 'missing_order' | 'missing_admission' | 'invalid_snapshot' | 'materialization_required'
  | 'invalid_capacity_claim' | 'capacity_release_required' | 'capacity_seat_collision'
  | 'invalid_calendar' | 'duplicate_calendar' | 'calendar_not_ready'
  | 'pending_calendar_intent' | 'calendar_intent_mismatch'
  | 'closed_day_order' | 'off_grid_order' | 'capacity_exceeded';

export type CapacityBootstrapIssue = Readonly<{
  code: CapacityBootstrapIssueCode;
  source: 'order' | 'admission' | 'calendar' | 'intent' | 'slot';
  index?: number;
  orderId?: string;
  admissionId?: string;
  day?: string;
  slot?: string;
  dimension?: 'kitchen' | 'delivery';
}>;

export type CapacityBootstrapOccupant = Readonly<{
  orderId: string;
  admissionId: string | null;
  channel: string;
  type: string;
  slot: string;
  source: 'order' | 'committing_snapshot';
}>;

export type CapacityBootstrapDay = Readonly<{
  day: string;
  sourceRevision: number;
  frozen: boolean;
  closedReason: Plan['closedReason'];
  slots: readonly Readonly<{
    at: string;
    kitchenCapacity: number;
    deliveryCapacity: number;
    kitchenUsed: number;
    deliveryUsed: number;
  }>[];
}>;

export type CapacityBootstrapReport = Readonly<{
  mode: 'analysis_only';
  canActivate: false;
  requiresExclusiveRescan: true;
  status: 'reviewed' | 'blocked';
  tenantId: string;
  cutoverAt: string;
  fromInclusive: string;
  days: readonly CapacityBootstrapDay[];
  occupants: readonly CapacityBootstrapOccupant[];
  issues: readonly CapacityBootstrapIssue[];
}>;
