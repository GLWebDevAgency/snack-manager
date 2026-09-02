import { loyaltyCardDeepLink } from "@sm/contracts";

/** Un secret à affichage unique impose un acquittement avant fermeture. */
export function mustConfirmQrHandoffClose(token: string | null): boolean {
  return token !== null;
}

/** Aucun alias, identifiant membre ou morceau de secret dans le nom exporté. */
export function loyaltyQrDownloadFilename(demo = false): string {
  return demo ? "carte-fidelite-demonstration.png" : "carte-fidelite.png";
}

export type QrHandoffPresentation =
  | { kind: "loading"; payload: null }
  | { kind: "demo-link"; payload: string }
  | { kind: "activation-link"; payload: string }
  | { kind: "opaque-code"; payload: string };

/**
 * La démonstration vit exclusivement dans l'onglet du back-office. Son jeton
 * n'existe donc pas dans l'application publique : le QR mène vers une carte
 * fictive dédiée, utilisable sur un autre téléphone mais explicitement
 * séparée de toute donnée créée dans cet onglet. Le vrai compte conserve le
 * deep-link d'activation sans secret dans la requête HTTP (fragment uniquement).
 */
export function qrHandoffPresentation(input: {
  demo: boolean;
  siteUrl: string;
  tenantSlug: string | null | undefined;
  token: string;
}): QrHandoffPresentation {
  if (input.demo) {
    return {
      kind: "demo-link",
      payload: `${input.siteUrl.replace(/\/+$/, "")}/r/demo/fidelite?demo=1#carte-fictive`,
    };
  }
  if (input.tenantSlug === undefined) return { kind: "loading", payload: null };
  if (input.tenantSlug === null) return { kind: "opaque-code", payload: input.token };
  return {
    kind: "activation-link",
    payload: loyaltyCardDeepLink(input.siteUrl, input.tenantSlug, input.token),
  };
}
