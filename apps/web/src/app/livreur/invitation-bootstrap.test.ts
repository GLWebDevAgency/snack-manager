import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { INVITATION_BOOTSTRAP } from "./invitation-bootstrap";

describe("invitation avant hydratation", () => {
  it("retire immédiatement le fragment et ne le livre qu’une fois en mémoire", () => {
    const token = "I".repeat(43);
    const location = { hash: `#invitation=${token}`, pathname: "/livreur", search: "" };
    const history = { state: { next: true }, replaceState: vi.fn(() => { location.hash = ""; }) };
    const window: { __smTakeDeliveryInvitation?: () => string | null } = {};
    runInNewContext(INVITATION_BOOTSTRAP, { window, location, history });
    expect(location.hash).toBe("");
    expect(history.replaceState).toHaveBeenCalledWith(history.state, "", "/livreur");
    expect(JSON.stringify(window)).not.toContain(token);
    const read = window.__smTakeDeliveryInvitation!;
    expect(read()).toBe(`#invitation=${token}`);
    expect(window.__smTakeDeliveryInvitation).toBeUndefined();
    expect(read()).toBeNull();
    expect(INVITATION_BOOTSTRAP).not.toContain(token);
  });

  it("ne fournit aucun secret lorsque retirer le fragment a échoué", () => {
    const window: { __smTakeDeliveryInvitation?: () => string | null } = {};
    runInNewContext(INVITATION_BOOTSTRAP, { window,
      location: { hash: `#invitation=${"I".repeat(43)}`, pathname: "/livreur", search: "" },
      history: { replaceState: () => { throw new Error("unavailable"); } },
    });
    expect(window.__smTakeDeliveryInvitation!()).toBeNull();
  });
});
