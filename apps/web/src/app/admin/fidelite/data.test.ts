import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../../lib/api";
import { loyaltyApi } from "./data";

describe("façade API fidélité", () => {
  afterEach(() => vi.restoreAllMocks());

  it("garde le téléphone dans le corps de la résolution", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({ id: "member" });
    await loyaltyApi.resolveMember({ by: "phone", phone: "06 12 34 56 78" });
    expect(post).toHaveBeenCalledWith("/loyalty/members/resolve", {
      by: "phone",
      phone: "06 12 34 56 78",
    });
    expect(post.mock.calls[0]?.[0]).not.toContain("06");
  });

  it("encode une pagination bornée sans donnée personnelle", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue({ items: [], nextCursor: null });
    await loyaltyApi.listMembers({
      limit: 30,
      status: "active",
      cursor: "joint+cursor=/",
    });
    expect(get).toHaveBeenCalledWith(
      "/loyalty/members?status=active&cursor=joint%2Bcursor%3D%2F&limit=30",
    );
  });

  it("n'expose ni gain manuel ni consommation hors ticket", () => {
    expect(loyaltyApi).not.toHaveProperty("earn");
    expect(loyaltyApi).not.toHaveProperty("redeem");
  });

  it("porte les trois étapes de remise uniquement dans le corps POST", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({});
    const body = { operationId: "7f298b7f-96d5-4f0d-8b10-c9069acaaec4" };

    await loyaltyApi.prepareEnrollment(body);
    expect(post).toHaveBeenLastCalledWith(
      "/loyalty/members/enrollments/prepare",
      body,
    );
    await loyaltyApi.recoverEnrollment(body);
    expect(post).toHaveBeenLastCalledWith(
      "/loyalty/members/enrollments/recover",
      body,
    );
    await loyaltyApi.acknowledgeEnrollment(body);
    expect(post).toHaveBeenLastCalledWith(
      "/loyalty/members/enrollments/acknowledge",
      body,
    );
    expect(post.mock.calls.map(([path]) => path).join("|")).not.toContain(
      body.operationId,
    );
  });

  it("garde lifecycle et remplacement QR derrière les routes manager", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({ replayed: false });
    const memberId = "97d7e8db-e90a-4fd1-86db-e0fd44101151";
    const lifecycle = {
      operationId: "7f298b7f-96d5-4f0d-8b10-c9069acaaec4",
      action: "block" as const,
      reasonCode: "suspected_sharing" as const,
    };
    await loyaltyApi.changeLifecycle(memberId, lifecycle);
    expect(post).toHaveBeenLastCalledWith(
      `/loyalty/members/${memberId}/lifecycle`,
      lifecycle,
    );

    const replacement = {
      operationId: "8f298b7f-96d5-4f0d-8b10-c9069acaaec5",
      reasonCode: "lost_or_compromised" as const,
      expectedGeneration: 3,
    };
    await loyaltyApi.replaceQr(memberId, replacement);
    expect(post).toHaveBeenLastCalledWith(
      `/loyalty/members/${memberId}/qr/replace`,
      replacement,
    );
  });
});
