import { z } from 'zod';
import { intentBindingSchema } from './validation';
const uuid = z.string().uuid().regex(/^[a-f0-9-]+$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/).refine(value => Buffer.from(value, 'base64url').toString('base64url') === value);
const credentialId = z.string().regex(/^[A-Za-z0-9_-]{1,2048}$/).refine(value => Buffer.from(value, 'base64url').toString('base64url') === value);
const counter = z.number().int().min(0).max(4294967295);
const deviceType = z.enum(['singleDevice', 'multiDevice']);
const originRp = { origin: z.string().url().max(2048), rpId: z.string().min(1).max(253) };
function exactOrigin(value: { origin: string; rpId: string }) {
  try { const url = new URL(value.origin); return url.protocol === 'https:' && url.origin === value.origin
    && !url.username && !url.password && url.hostname === value.rpId && !url.port; } catch { return false; }
}
export const enrollmentBindingSchema = intentBindingSchema.extend({ checkId: uuid });
export const enrollmentReadKeySchema = enrollmentBindingSchema.extend({ registrationId: uuid });
export const enrollmentReadAssertionSchema = enrollmentBindingSchema.extend({ assertionId: uuid });
export const enrollmentKeySchema = enrollmentBindingSchema.extend({ registrationId: uuid, ...originRp, challenge: token, userHandle: token }).refine(exactOrigin);
export const enrollmentRecordKeySchema = enrollmentBindingSchema.extend({ registrationId: uuid, requestHash: hash, credential: z.strictObject({
  credentialId, publicKey: z.instanceof(Uint8Array).refine(value => value.byteLength >= 1 && value.byteLength <= 4096),
  counter, deviceType, backedUp: z.boolean(), transports: z.array(z.enum(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb'])).max(7),
}) });
export const enrollmentAssertionSchema = enrollmentBindingSchema.extend({ assertionId: uuid, ...originRp, challenge: token }).refine(exactOrigin);
export const enrollmentRecordAssertionSchema = enrollmentBindingSchema.extend({ assertionId: uuid, requestHash: hash,
  credentialId, counter, deviceType, backedUp: z.boolean() });
export const enrollmentCodeSchema = enrollmentBindingSchema.extend({ rotationId: uuid, expectedVersion: z.number().int().min(0).max(3), codeHash: hash });
export const enrollmentActivationRecoverySchema = enrollmentBindingSchema.extend({ activationId: uuid, sessionHash: hash });
export const enrollmentActivationSchema = enrollmentActivationRecoverySchema.extend({ requestHash: hash,
  recoveryVersion: z.number().int().min(1).max(3), codeHash: hash, accountId: uuid, sessionId: uuid,
  sessionExpiresAt: z.number().int().min(0).max(8_640_000_000_000_000) });
