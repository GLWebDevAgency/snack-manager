import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui";
import { SlotSettingsPanel } from "./SlotSettingsPanel";

describe("règles de publication des créneaux", () => {
  it("explique les journées figées, même vides, sans promettre une application dès demain", () => {
    const html = renderToStaticMarkup(createElement(ToastProvider, null,
      createElement(SlotSettingsPanel, { settings: { slotIntervalMin: 10, slotCapacity: 4, onlineOrderingPaused: false, pauseMessage: "", printTicketOn: "ready", printStickerOn: "ready" }, onSaved: vi.fn() }),
    ));
    expect(html).toContain("Les journées déjà préparées gardent leur intervalle et leur capacité, même sans commande.");
    expect(html).toContain("Vos changements s’appliquent aux journées encore non préparées.");
    expect(html).toContain("Cette capacité est commune au retrait et à la livraison.");
    expect(html).toContain('id="slot-interval"');
    expect(html).toContain('id="slot-capacity"');
    expect(html).not.toContain("dès demain");
  });
});
