import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import { articleParSlug } from "../../_articles/registre";

const size = { width: 1200, height: 630 };

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const article = articleParSlug((await params).slug);
  if (!article) notFound();
  return new ImageResponse(<div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "64px 72px", background: "#101510", color: "#f1eadb" }}>
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 24 }}><span>Snack Manager</span><span style={{ color: "#d7b573" }}>LE CARNET</span></div>
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}><div style={{ fontSize: 20, color: "#d7b573", textTransform: "uppercase", letterSpacing: 2 }}>{article.categorie}</div><div style={{ fontSize: article.titre.length > 80 ? 52 : 62, lineHeight: 1.1, fontWeight: 700, letterSpacing: -2, maxWidth: 1020 }}>{article.titre}</div></div>
    <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #5a604c", paddingTop: 26, color: "#bbc0af", fontSize: 21 }}><span>Des réponses concrètes pour votre restaurant.</span><span>snackmanager.fr</span></div>
  </div>, size);
}
