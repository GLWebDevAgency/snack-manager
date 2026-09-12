import { z } from 'zod';
import { CustomerAccountSlugSchema } from './customer-account';

const origin = z.string().max(200).refine(value => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value;
  } catch { return false; }
});
const railwayId = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

/** Operator-owned deployment identity, shared by web and API. This is a
 * target to compare with native runtime identity, never a spending grant or
 * a client-provided tenant selector. Credentials are deliberately separate. */
export const CustomerAccountDeploymentTargetSchema = z.strictObject({
  version: z.literal(1),
  environment: z.enum(['staging', 'production']),
  railwayProjectId: railwayId,
  railwayEnvironmentId: railwayId,
  tenantRef: z.string().regex(/^[0-9a-f]{24}$/),
  slug: CustomerAccountSlugSchema.max(63),
  verifyAccountSid: z.string().regex(/^AC[0-9a-fA-F]{32}$/),
  verifyServiceSid: z.string().regex(/^VA[0-9a-fA-F]{32}$/),
  origins: z.array(origin).min(1).max(5).refine(values => new Set(values).size === values.length),
  apiOrigin: origin,
});
export type CustomerAccountDeploymentTarget = z.infer<typeof CustomerAccountDeploymentTargetSchema>;
