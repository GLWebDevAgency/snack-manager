import type { Metadata, Viewport } from "next";
import { DeliveryAccess } from "./delivery-access";
import { INVITATION_BOOTSTRAP } from "./invitation-bootstrap";
import "./livreur.css";

export const metadata: Metadata = {
  title: "SM Livreur",
  description: "Associez votre téléphone à l’accès livreur confié par votre restaurant.",
  manifest: "/livreur/manifest.webmanifest",
  appleWebApp: { capable: true, title: "SM Livreur", statusBarStyle: "black-translucent" },
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#000000" };

export default function DeliveryAccessPage() {
  return <><script dangerouslySetInnerHTML={{ __html: INVITATION_BOOTSTRAP }} /><DeliveryAccess /></>;
}
