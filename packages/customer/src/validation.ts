import { z } from 'zod';
import { CustomerRepositoryError } from './client';

const ref = z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/);
const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const time = z.number().int().min(0).max(8_640_000_000_000_000);
const ciphertext = z.string().min(1).max(4096);
const bounded = (maximum: number) => z.number().int().min(1).max(maximum);
export const scopeSchema = z.object({ tenantRef: ref, parentRef: ref, now: time });
export const reservationSchema = scopeSchema.extend({ operationId: uuid, requestHash: hash, challengeId: uuid,
  browserHash: hash, phoneHash: hash, globalPhoneHash: hash, ipHash: hash, encryptedPhone: ciphertext,
  serviceSid: z.string().regex(/^VA[0-9a-fA-F]{32}$/), evidenceReference: z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/),
  planExpiresAt: time, expiresAt: time, limits: z.object({ trialSendReservations: bounded(50),
    smsUnitsReservedPerSend: bounded(10), freeSmsUnitsRemainingAtObservation: bounded(Number.MAX_SAFE_INTEGER),
    freeVerificationUnitsRemainingAtObservation: bounded(Number.MAX_SAFE_INTEGER), cooldownMs: bounded(86_400_000),
    windowMs: bounded(86_400_000), globalSendReservations: bounded(10), tenantSendReservations: bounded(10),
    phoneSendReservations: bounded(3), ipSendReservations: bounded(5), challengeCheckAttempts: bounded(5) })
    .refine(limits => limits.cooldownMs >= 60_000 && limits.windowMs >= 86_400_000),
});
export const settlementSchema = scopeSchema.extend({ challengeId: uuid,
  verificationSid: z.string().regex(/^VE[0-9a-fA-F]{32}$/).nullable() });
export const claimSchema = scopeSchema.extend({ challengeId: uuid, browserHash: hash, checkId: uuid });
export const sessionSchema = scopeSchema.extend({ sessionHash: hash });
export const recoverySchema = claimSchema.extend({ sessionHash: hash });
export const completionSchema = claimSchema.extend({ result: z.enum(['approved', 'pending', 'expired', 'locked', 'uncertain']),
  sessionId: uuid, sessionHash: hash, sessionExpiresAt: time, accountId: uuid, existingSessionHash: hash.nullable() });
export const nameSchema = sessionSchema.extend({ encryptedName: ciphertext.nullable(), expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) });
export const revocationSchema = sessionSchema.extend({ all: z.boolean() });

export function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new CustomerRepositoryError('invalid_input');
  return parsed.data;
}
