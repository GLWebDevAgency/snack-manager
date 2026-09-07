import { describe, expect, it } from "vitest";
import { managerMissionScope } from "./delivery-mission-scope";

const tenantId = "507f1f77bcf86cd799439011";
const sub = "507f1f77bcf86cd799439012";
const token = (claims: object) => `header.${btoa(JSON.stringify(claims))}.signature`;
describe("identité du journal missions BO", () => {
  it("partitionne par restaurant, type et personne sans conserver le JWT", () => {
    const base = { tenantId, sub, kind: "user" };
    expect(managerMissionScope(token(base), tenantId)).toBe(`bo:${tenantId}:user:${sub}`);
    expect(managerMissionScope(token({ ...base, iat: 500 }), tenantId)).toBe(managerMissionScope(token(base), tenantId));
    expect(managerMissionScope(token({ ...base, kind: "staff" }), tenantId)).not.toBe(managerMissionScope(token(base), tenantId));
    expect(managerMissionScope(token({ ...base, sub: "a".repeat(24) }), tenantId)).not.toBe(managerMissionScope(token(base), tenantId));
  });
  it.each([null, "bad", token({ tenantId, sub }), token({ tenantId, sub: "legacy", kind: "user" }), token({ tenantId: "a".repeat(24), sub, kind: "user" })])("refuse l’identité incomplète ou étrangère", value => {
    expect(() => managerMissionScope(value, tenantId)).toThrow("identité");
  });
});
