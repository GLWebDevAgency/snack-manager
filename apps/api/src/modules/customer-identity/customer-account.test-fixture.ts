import { randomBytes } from 'node:crypto';

export function customerTestEnvironment(now = Date.now()): Record<string, string> {
  const parent = `AC${'a'.repeat(32)}`; const service = `VA${'b'.repeat(32)}`;
  return {
    RAILWAY_ENVIRONMENT_NAME: 'staging', RAILWAY_ENVIRONMENT_ID: '11111111-1111-4111-8111-111111111111',
    RAILWAY_PROJECT_ID: '22222222-2222-4222-8222-222222222222',
    SM_CUSTOMER_PILOT_ENVIRONMENT_ID: '11111111-1111-4111-8111-111111111111',
    SM_CUSTOMER_PILOT_PROJECT_ID: '22222222-2222-4222-8222-222222222222',
    SM_CUSTOMER_ACCOUNT_MODE: 'closed_trial', SM_CUSTOMER_PILOT_SLUGS: '["fixture"]',
    SM_CUSTOMER_PILOT_TENANT_ID: 'a'.repeat(24), SM_CUSTOMER_PILOT_ORIGINS: '["https://fixture.example"]',
    SM_CUSTOMER_IDENTITY_KEY: Buffer.alloc(32, 12).toString('base64'),
    SM_CUSTOMER_RELAY_SIGNING_KEY: Buffer.alloc(32, 15).toString('base64'),
    SM_CUSTOMER_VERIFY_ACCOUNT_SID: parent,
    SM_CUSTOMER_TURNSTILE_SECRET_KEY: randomBytes(32).toString('hex'),
    SM_CUSTOMER_VERIFY_API_KEY_SID: `SK${'c'.repeat(32)}`, SM_CUSTOMER_VERIFY_API_KEY_SECRET: randomBytes(32).toString('hex'),
    SM_CUSTOMER_VERIFY_POLICY: JSON.stringify({ mode: 'closed_trial', environment: 'staging', accountSid: parent,
      serviceSid: service, tenantRef: 'a'.repeat(24), allowedPhones: ['+33612345678'], maxSendReservations: 10, expiresAt: now + 86_400_000 }),
    SM_CUSTOMER_VERIFY_EVIDENCE: JSON.stringify({ reference: 'fixture-evidence', accountSid: parent, accountType: 'Trial',
      accountStatus: 'active', serviceSid: service, smsEnabled: true, fraudGuardEnabled: true, codeLength: 6,
      maxTokenValiditySeconds: 600, verifiedPhones: ['+33612345678'], freeSmsUnitsRemaining: 10,
      maxSmsSegmentsPerSend: 1, freeVerificationUnitsRemaining: 10, observedAt: now, trialExpiresAt: now + 86_400_000 }),
  };
}

/** Synthetic arithmetic only: neither provider tariffs nor founder approval. */
export function customerPaidTestEnvironment(now = Date.now()): Record<string, string> {
  const env = customerTestEnvironment(now);
  const target = { accountSid: env.SM_CUSTOMER_VERIFY_ACCOUNT_SID!, serviceSid: `VA${'b'.repeat(32)}`,
    tenantRef: env.SM_CUSTOMER_PILOT_TENANT_ID! };
  env.SM_CUSTOMER_ACCOUNT_MODE = 'closed_paid_pilot';
  env.SM_CUSTOMER_VERIFY_POLICY = JSON.stringify({
    mode: 'closed_paid_pilot', environment: 'staging', ...target, allowedPhones: ['+33612345678'],
    maxSendReservations: 10, expiresAt: now + 86_400_000, evidenceNotBefore: now - 60_000,
    costEvidenceReference: 'fixture-cost', authorization: { kind: 'one_off', reference: 'fixture-authorization',
      authorizedBy: 'fixture-owner', ...target, currency: 'USD', authorizedSpendMicrousd: 1_010,
      authorizedAt: now - 60_000, expiresAt: now + 86_400_000, recurring: false },
  });
  env.SM_CUSTOMER_VERIFY_EVIDENCE = JSON.stringify({ reference: 'fixture-evidence', ...target,
    accountType: 'Full', accountStatus: 'active', smsEnabled: true, fraudGuardEnabled: true, codeLength: 6,
    maxTokenValiditySeconds: 600, maxSmsSegmentsPerSend: 2, observedAt: now,
    costs: { reference: 'fixture-cost', currency: 'USD', smsSegmentUpperBoundMicrousd: 31,
      successfulVerificationUpperBoundMicrousd: 8, allFeesIncluded: true, observedAt: now, expiresAt: now + 86_400_000 },
  });
  return env;
}
