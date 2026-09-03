import { describe, expect, it } from "vitest";
import { EMPTY_SERVICES, LeadConvertSchema, type CrmLead } from "@sm/contracts";
import { termesSignes } from "./signature";

/**
 * Ces cas gardent une règle commerciale, pas un rendu : la signature REPREND
 * ce qui a été proposé et accepté, elle ne le rejoue pas et ne l'invente pas.
 */

const lead = (
  patch: Partial<Pick<CrmLead, "proposal" | "founderSeatReserved">> = {},
): Pick<CrmLead, "proposal" | "founderSeatReserved"> => ({
  founderSeatReserved: false,
  proposal: {
    at: "2026-08-30T10:00:00.000Z",
    plan: "complet",
    onlineOrdering: true,
    billing: "annuel",
    services: { ...EMPTY_SERVICES, identiteVisuelle: true },
    note: "attend son associé",
  },
  ...patch,
});

describe("les termes que la signature envoie", () => {
  it("reprend la proposition telle quelle — formule, module, engagement, Atelier", () => {
    expect(termesSignes(lead())).toEqual({
      plan: "complet",
      onlineOrdering: true,
      billing: "annuel",
      services: { ...EMPTY_SERVICES, identiteVisuelle: true },
      founderSeat: false,
    });
  });

  it("prend la place fondateur dans le TIROIR, pas dans la modale", () => {
    // Elle se réserve pendant la prospection ; la signature la relit. Deux
    // contrôles pour un seul état, c'était la porte ouverte à deux vérités.
    expect(termesSignes(lead({ founderSeatReserved: true }))?.founderSeat).toBe(true);
  });

  it("signe SANS formule quand la proposition n’en portait pas", () => {
    // Le défaut d'origine : la modale retombait sur une formule par défaut, et
    // un client de l'Atelier seul naissait abonné à un logiciel qu'il n'avait
    // pas acheté — factures comprises.
    const atelierSeul = lead({
      proposal: {
        at: "2026-08-30T10:00:00.000Z",
        plan: null,
        onlineOrdering: false,
        billing: "mensuel",
        services: { ...EMPTY_SERVICES, siteVitrine: true },
        note: "",
      },
    });
    expect(termesSignes(atelierSeul)?.plan).toBeNull();
  });

  it("refuse de signer un prospect sans proposition", () => {
    // Rien sur la table : il n'y a pas d'offre à reprendre, et la modale n'en
    // propose plus aucune. L'écran le dit avant le clic ; le contrat le
    // refuserait après (voir le cas suivant).
    expect(termesSignes(lead({ proposal: null }))).toBeNull();
  });

  it("produit un corps que le contrat accepte — et le vide, il le refuse", () => {
    const corps = (termes: ReturnType<typeof termesSignes>) => ({
      slug: "le-comptoir",
      ownerEmail: "patron@le-comptoir.fr",
      ownerName: "Camille Fournier",
      ...termes,
    });
    expect(LeadConvertSchema.safeParse(corps(termesSignes(lead()))).success).toBe(true);
    // Ce qu'une signature sans proposition aurait envoyé si l'écran la laissait
    // faire : aucune formule, aucun module, aucun service.
    expect(
      LeadConvertSchema.safeParse(
        corps({
          plan: null,
          onlineOrdering: false,
          billing: "mensuel",
          services: EMPTY_SERVICES,
          founderSeat: false,
        }),
      ).success,
    ).toBe(false);
  });
});
