import type {
  LoyaltyAdminAdjustment,
  LoyaltyConsentEvent,
  LoyaltyConsentMutationResult,
  LoyaltyDashboard,
  LoyaltyEnrollmentAcknowledgement,
  LoyaltyEnrollmentAcknowledgementResult,
  LoyaltyEnrollmentPrepare,
  LoyaltyEnrollmentPrepareResult,
  LoyaltyEnrollmentRecovery,
  LoyaltyEnrollmentRecoveryResult,
  LoyaltyMemberCreate,
  LoyaltyMemberCreateResult,
  LoyaltyMemberDetail,
  LoyaltyMemberLifecycle,
  LoyaltyMemberLifecycleResult,
  LoyaltyMemberList,
  LoyaltyMemberListQuery,
  LoyaltyMemberResolve,
  LoyaltyMemberQrReplace,
  LoyaltyMemberQrReplaceResult,
  LoyaltyMemberSummary,
  LoyaltyMutationResult,
  LoyaltyProgramPut,
  LoyaltyProgramView,
  LoyaltyRewardCreate,
  LoyaltyRewardUpdate,
  LoyaltyRewardView,
} from "@sm/contracts";
import { api } from "../../../lib/api";

/**
 * Façade HTTP unique de la fidélité manager.
 *
 * Les composants ne reconstruisent jamais une URL eux-mêmes. En particulier,
 * téléphone et QR restent dans le corps du POST `/resolve` : ni historique
 * navigateur, ni logs de proxy, ni analytics d'URL ne voient ces secrets.
 */
export const loyaltyApi = {
  getProgram: () => api.get<LoyaltyProgramView | null>("/loyalty/program"),
  updateProgram: (body: LoyaltyProgramPut) =>
    api.put<LoyaltyProgramView>("/loyalty/program", body),

  listRewards: () => api.get<LoyaltyRewardView[]>("/loyalty/rewards"),
  createReward: (body: LoyaltyRewardCreate) =>
    api.post<LoyaltyRewardView>("/loyalty/rewards", body),
  updateReward: (id: string, body: LoyaltyRewardUpdate) =>
    api.patch<LoyaltyRewardView>(`/loyalty/rewards/${encodeURIComponent(id)}`, body),

  dashboard: () => api.get<LoyaltyDashboard>("/loyalty/dashboard"),
  listMembers: (
    query: LoyaltyMemberListQuery = { limit: 30 },
    signal?: AbortSignal,
  ) => {
    const search = new URLSearchParams();
    if (query.status) search.set("status", query.status);
    if (query.memberRef) search.set("memberRef", query.memberRef);
    if (query.cursor) search.set("cursor", query.cursor);
    search.set("limit", String(query.limit ?? 30));
    const path = `/loyalty/members?${search.toString()}`;
    return signal
      ? api.get<LoyaltyMemberList>(path, { signal })
      : api.get<LoyaltyMemberList>(path);
  },
  getMember: (id: string) =>
    api.get<LoyaltyMemberDetail>(`/loyalty/members/${encodeURIComponent(id)}`),
  createMember: (body: LoyaltyMemberCreate) =>
    api.post<LoyaltyMemberCreateResult>("/loyalty/members", body),
  prepareEnrollment: (body: LoyaltyEnrollmentPrepare) =>
    api.post<LoyaltyEnrollmentPrepareResult>(
      "/loyalty/members/enrollments/prepare",
      body,
    ),
  recoverEnrollment: (body: LoyaltyEnrollmentRecovery) =>
    api.post<LoyaltyEnrollmentRecoveryResult>(
      "/loyalty/members/enrollments/recover",
      body,
    ),
  acknowledgeEnrollment: (body: LoyaltyEnrollmentAcknowledgement) =>
    api.post<LoyaltyEnrollmentAcknowledgementResult>(
      "/loyalty/members/enrollments/acknowledge",
      body,
    ),
  resolveMember: (body: LoyaltyMemberResolve, signal?: AbortSignal) =>
    signal
      ? api.post<LoyaltyMemberSummary>("/loyalty/members/resolve", body, { signal })
      : api.post<LoyaltyMemberSummary>("/loyalty/members/resolve", body),
  adjust: (memberId: string, body: LoyaltyAdminAdjustment) =>
    api.post<LoyaltyMutationResult>(
      `/loyalty/members/${encodeURIComponent(memberId)}/adjustments`,
      body,
    ),
  recordConsent: (memberId: string, body: LoyaltyConsentEvent) =>
    api.post<LoyaltyConsentMutationResult>(
      `/loyalty/members/${encodeURIComponent(memberId)}/consents`,
      body,
    ),
  changeLifecycle: (memberId: string, body: LoyaltyMemberLifecycle) =>
    api.post<LoyaltyMemberLifecycleResult>(
      `/loyalty/members/${encodeURIComponent(memberId)}/lifecycle`,
      body,
    ),
  replaceQr: (memberId: string, body: LoyaltyMemberQrReplace) =>
    api.post<LoyaltyMemberQrReplaceResult>(
      `/loyalty/members/${encodeURIComponent(memberId)}/qr/replace`,
      body,
    ),
};

/** Un identifiant est créé au début d'une intention puis conservé au retry. */
export function newLoyaltyOperationId(): string {
  return globalThis.crypto.randomUUID();
}
