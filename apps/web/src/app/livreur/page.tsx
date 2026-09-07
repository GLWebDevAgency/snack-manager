import type { Metadata, Viewport } from "next";
import { DeliveryAccess } from "./delivery-access";
import { INVITATION_BOOTSTRAP } from "./invitation-bootstrap";

export const metadata: Metadata = {
  title: "Accès livreur · Snack Manager",
  description: "Associez votre téléphone à l’accès livreur confié par votre restaurant.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#000000" };

export default function DeliveryAccessPage() {
  return <><script dangerouslySetInnerHTML={{ __html: INVITATION_BOOTSTRAP }} /><DeliveryAccess /></>;
}
