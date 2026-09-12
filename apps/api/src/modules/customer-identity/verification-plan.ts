import { z } from 'zod';
import { planTrialPhoneVerification, type TrialSendPlan } from './trial-verification-policy';
import { planPaidPilotPhoneVerification, type PaidPilotSendPlan } from './paid-pilot-policy';
import { planProductionPhoneVerification, type ProductionSendPlan } from './production-verification-policy';

export const CustomerVerificationModeSchema = z.enum(['closed_trial', 'closed_paid_pilot', 'production_paid']);
export type CustomerVerificationMode = z.infer<typeof CustomerVerificationModeSchema>;
export type CustomerVerificationPlan = TrialSendPlan | PaidPilotSendPlan | ProductionSendPlan;
export type ReservedCustomerVerificationPlan = Extract<CustomerVerificationPlan, { kind: 'reservation_required' }>;

/** The operator-selected runtime mode binds the policy; neither mode is a fallback. */
export function planCustomerPhoneVerification(input: {
  mode: unknown; policy: unknown; evidence: unknown; request: unknown; now: number;
}): CustomerVerificationPlan {
  const mode = CustomerVerificationModeSchema.safeParse(input.mode);
  const policy = z.object({ mode: CustomerVerificationModeSchema }).safeParse(input.policy);
  if (!mode.success || !policy.success || mode.data !== policy.data.mode) {
    return { kind: 'denied', reason: 'configuration' };
  }
  return mode.data === 'closed_trial' ? planTrialPhoneVerification(input)
    : mode.data === 'closed_paid_pilot' ? planPaidPilotPhoneVerification(input) : planProductionPhoneVerification(input);
}

export function paidBudgetOf(plan: ReservedCustomerVerificationPlan) {
  return 'paidBudget' in plan.limits ? plan.limits.paidBudget : null;
}
export function productionBudgetOf(plan: ReservedCustomerVerificationPlan) {
  return 'productionBudget' in plan.limits ? plan.limits.productionBudget : null;
}
export function costEvidenceReferenceOf(plan: ReservedCustomerVerificationPlan) {
  return 'costEvidenceReference' in plan ? plan.costEvidenceReference : null;
}
