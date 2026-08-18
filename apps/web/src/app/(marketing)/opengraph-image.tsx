import { ImageResponse } from "next/og";

export const alt = "Snack Manager — On fait tourner votre restaurant. Pas l'inverse.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Image Open Graph générée à la construction : noir profond, accent laiton,
 * la promesse et les 4 modules. Aucune police externe (le rendu utilise la
 * police système de l'environnement de build) pour garder le build hermétique.
 */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#000",
          padding: 72,
          color: "#fff",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 56,
              height: 56,
              borderRadius: 16,
              background: "#1a1a1a",
              border: "1px solid rgba(255,255,255,.12)",
              color: "#c9a15a",
              fontSize: 30,
              fontWeight: 800,
            }}
          >
            S
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5 }}>Snack Manager</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 68, fontWeight: 800, letterSpacing: -2.5, lineHeight: 1.05, maxWidth: 900 }}>
            On fait tourner votre restaurant. Pas l&apos;inverse.
          </div>
          <div style={{ fontSize: 28, color: "#999", maxWidth: 820, lineHeight: 1.4 }}>
            Caisse, cuisine, commande en ligne et back-office — 0 % de commission, à vos couleurs.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {["Caisse", "Cuisine", "Commande en ligne", "Back-office"].map((label) => (
            <div
              key={label}
              style={{
                display: "flex",
                padding: "12px 22px",
                borderRadius: 999,
                background: "#111",
                border: "1px solid rgba(255,255,255,.1)",
                fontSize: 22,
                color: "#c9a15a",
              }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
