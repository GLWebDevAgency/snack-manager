import { z } from 'zod';

const minute = 60_000;
const day = 24 * 60 * minute;
const evidenceFreshnessMs = 15 * minute;
const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - day);
const units = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const accountSid = z.string().regex(/^AC[0-9a-fA-F]{32}$/);
const serviceSid = z.string().regex(/^VA[0-9a-fA-F]{32}$/);
const tenantRef = z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/);
// Pilote fermé français uniquement ; aucune normalisation permissive ici.
// Le futur formulaire normalisera avant cette frontière, jamais vers un pays
// déduit silencieusement. Une extension internationale sera un autre choix.
const phone = z.string().regex(/^\+33[67]\d{8}$/);
const recipientList = z.array(phone).min(1).max(5)
  .refine((values) => new Set(values).size === values.length);

const policySchema = z.strictObject({
  mode: z.literal('closed_trial'),
  environment: z.literal('staging'),
  accountSid,
  serviceSid,
  tenantRef,
  allowedPhones: recipientList,
  // Plafond de recette, pas un forfait commercial ni un quota gratuit promis.
  maxSendReservations: z.number().int().min(1).max(50),
  expiresAt: timestamp,
});

/** Observation de confiance, obtenue côté opérateur/serveur, JAMAIS du body
 * public. Si le fournisseur ne permet pas d'attester l'une de ces données,
 * l'évidence est incomplète et la décision reste fermée. Ne pas déduire un
 * crédit Verify d'un simple solde monétaire ou d'un accès API fonctionnel. */
const evidenceSchema = z.strictObject({
  reference: z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/),
  accountSid,
  accountType: z.literal('Trial'),
  accountStatus: z.literal('active'),
  serviceSid,
  smsEnabled: z.literal(true),
  fraudGuardEnabled: z.literal(true),
  codeLength: z.literal(6),
  verifiedPhones: recipientList,
  freeSmsUnitsRemaining: units,
  // Borne attestée du template/service, pas déduite de la longueur du code.
  // Verify facture les segments SMS ; un seul OTP peut en utiliser plusieurs.
  maxSmsSegmentsPerSend: z.number().int().min(1).max(10),
  freeVerificationUnitsRemaining: units,
  observedAt: timestamp,
  trialExpiresAt: timestamp,
});

const requestSchema = z.strictObject({ tenantRef, phone });

export type TrialSendPlan =
  | { kind: 'denied'; reason: 'configuration' | 'evidence' | 'target' | 'allowance' }
  | {
      kind: 'reservation_required';
      accountSid: string;
      serviceSid: string;
      tenantRef: string;
      evidenceReference: string;
      expiresAt: number;
      limits: {
        trialSendReservations: number;
        freeSmsUnitsRemainingAtObservation: number;
        smsUnitsReservedPerSend: number;
        freeVerificationUnitsRemainingAtObservation: number;
        cooldownMs: number;
        windowMs: number;
        globalSendReservations: number;
        tenantSendReservations: number;
        phoneSendReservations: number;
        ipSendReservations: number;
        challengeCheckAttempts: number;
        challengeTtlMs: number;
      };
    };

/**
 * Préflight PUR, pas une réservation ni une autorisation d'appeler Twilio.
 *
 * Le raccordement devra réserver durablement et atomiquement toutes les
 * bornes AVANT chaque envoi, y compris les envois incertains. Rejouer ce calcul,
 * changer l'évidence ou redémarrer un processus ne remet jamais à zéro un
 * compteur. Redis seul et des compteurs en mémoire ne sont pas le budget.
 * La vérification humaine/source IP fiable et les challenges restent aussi
 * des préconditions indépendantes. Aucune route n'expose ce sous-lot.
 */
export function planTrialPhoneVerification(input: {
  policy: unknown;
  evidence: unknown;
  request: unknown;
  now: number;
}): TrialSendPlan {
  const policy = policySchema.safeParse(input.policy);
  if (!policy.success || !timestamp.safeParse(input.now).success
    || policy.data.expiresAt <= input.now) {
    return { kind: 'denied', reason: 'configuration' };
  }
  const evidence = evidenceSchema.safeParse(input.evidence);
  if (!evidence.success) return { kind: 'denied', reason: 'evidence' };
  const p = policy.data;
  const e = evidence.data;
  if (e.accountSid !== p.accountSid || e.serviceSid !== p.serviceSid
    || e.observedAt > input.now || e.observedAt + evidenceFreshnessMs <= input.now
    || e.trialExpiresAt <= input.now
    || !p.allowedPhones.every((recipient) => e.verifiedPhones.includes(recipient))) {
    return { kind: 'denied', reason: 'evidence' };
  }
  const request = requestSchema.safeParse(input.request);
  if (!request.success || request.data.tenantRef !== p.tenantRef
    || !p.allowedPhones.includes(request.data.phone)) {
    return { kind: 'denied', reason: 'target' };
  }
  const ceiling = Math.min(p.maxSendReservations,
    Math.floor(e.freeSmsUnitsRemaining / e.maxSmsSegmentsPerSend),
    e.freeVerificationUnitsRemaining);
  if (ceiling === 0) return { kind: 'denied', reason: 'allowance' };

  return {
    kind: 'reservation_required',
    accountSid: p.accountSid,
    serviceSid: p.serviceSid,
    tenantRef: p.tenantRef,
    evidenceReference: e.reference,
    expiresAt: Math.min(p.expiresAt, e.trialExpiresAt, e.observedAt + evidenceFreshnessMs),
    limits: {
      trialSendReservations: ceiling,
      freeSmsUnitsRemainingAtObservation: e.freeSmsUnitsRemaining,
      smsUnitsReservedPerSend: e.maxSmsSegmentsPerSend,
      freeVerificationUnitsRemainingAtObservation: e.freeVerificationUnitsRemaining,
      cooldownMs: minute,
      windowMs: day,
      globalSendReservations: 10,
      tenantSendReservations: 10,
      phoneSendReservations: 3,
      ipSendReservations: 5,
      challengeCheckAttempts: 5,
      challengeTtlMs: 10 * minute,
    },
  };
}
