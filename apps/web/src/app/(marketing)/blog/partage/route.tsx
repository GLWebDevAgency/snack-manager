import { ImageResponse } from "next/og";
export function GET() {
  return new ImageResponse(<div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#101510", color: "#f1eadb", padding: "64px 72px" }}>
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 24 }}><span>Snack Manager</span><span style={{ color: "#d7b573" }}>LE CARNET DES RESTAURATEURS</span></div>
    <div style={{ display: "flex", flexDirection: "column", fontSize: 76, fontWeight: 700, lineHeight: 1.05, letterSpacing: -3 }}><span>Votre restaurant.</span><span style={{ color: "#d7b573" }}>Des réponses concrètes.</span></div>
    <div style={{ display: "flex", borderTop: "1px solid #5a604c", paddingTop: 26, fontSize: 23, color: "#bbc0af" }}>Menus · Visibilité locale · Commande directe · Organisation du service</div>
  </div>, { width: 1200, height: 630 });
}
