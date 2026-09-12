import { customerTestEnvironment } from './customer-account.test-fixture';

/** Synthetic data only; no actual price, funding grant or provider observation. */
export function customerProductionFixture(now = Date.now(), environment: 'staging' | 'production' = 'production') {
  const env = customerTestEnvironment(now);
  const target = { accountSid: env.SM_CUSTOMER_VERIFY_ACCOUNT_SID!, serviceSid: `VA${'b'.repeat(32)}`,
    tenantRef: env.SM_CUSTOMER_PILOT_TENANT_ID! };
  env.RAILWAY_ENVIRONMENT_NAME = environment;
  env.SM_CUSTOMER_ACCOUNT_MODE = 'production_paid';
  env.SM_CUSTOMER_PRODUCTION_TARGET = JSON.stringify({ version: 1, environment,
    railwayProjectId: env.RAILWAY_PROJECT_ID, railwayEnvironmentId: env.RAILWAY_ENVIRONMENT_ID,
    tenantRef: target.tenantRef, slug: 'fixture', verifyAccountSid: target.accountSid,
    verifyServiceSid: target.serviceSid, origins: ['https://fixture.example'], apiOrigin: 'https://api.example' });
  const policy = { mode: 'production_paid', environment, ...target, authorizationRef: 'operator-budget-A',
    costEvidenceReference: 'operator-costs', evidenceNotBefore: now - 60_000, expiresAt: now + 86_400_000,
    globalSendReservations: 100, tenantSendReservations: 100, ipSendReservations: 30 };
  const observation = { reference: 'live-observation', ...target,
    codeLength: 6, observedAt: now, settingsFingerprint: 'a'.repeat(64) };
  const attestations = {
    account: { reference: 'operator-account', ...target, accountType: 'Full', accountStatus: 'active',
      attestedAt: now - 60_000, expiresAt: now + 86_400_000 },
    safeguards: { reference: 'operator-safeguards', ...target, smsEnabled: true, fraudGuardEnabled: true,
      maxTokenValiditySeconds: 600, maxSmsSegmentsPerSend: 1, settingsFingerprint: observation.settingsFingerprint,
      attestedAt: now - 60_000, expiresAt: now + 86_400_000 },
    costs: { reference: 'operator-costs', ...target, currency: 'USD', smsSegmentUpperBoundMicrousd: 10,
      successfulVerificationUpperBoundMicrousd: 5, allFeesIncluded: true,
      attestedAt: now - 60_000, expiresAt: now + 86_400_000 },
  };
  env.SM_CUSTOMER_VERIFY_POLICY = JSON.stringify(policy);
  env.SM_CUSTOMER_VERIFY_EVIDENCE = JSON.stringify(attestations);
  return { env, target, policy, attestations, observation, evidence: { ...attestations, serverObservation: observation } };
}
