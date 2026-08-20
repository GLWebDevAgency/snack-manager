"use client";

/**
 * PORTE D'ENTRÉE DE LA DÉMONSTRATION DU BACK-OFFICE.
 *
 * `lib/api.ts` ne connaît que ce fichier : il demande « suis-je en
 * démonstration ? », et si oui il envoie ses requêtes ici au lieu du réseau.
 * Tout le reste — fixture, établissement en mémoire, routeur — est chargé
 * PARESSEUSEMENT, et c'est délibéré : la fixture pèse près de deux cents
 * kilo-octets, et un gérant qui ouvre son vrai back-office n'a aucune raison
 * de les télécharger. Le `import()` dynamique les isole dans un fragment que
 * seul un visiteur en démonstration va chercher.
 */

// Import de TYPE seulement : il est effacé à la compilation et ne tire donc
// pas la fixture dans le paquet du back-office réel.
import type { DemoWorld } from "./state";

export { DEMO_PARAM, DEMO_VALUE, isDemoActive, isDemoRequested, withDemoParam } from "./mode";

/**
 * Latence simulée.
 *
 * Une application qui répond en 0 ms ne fait pas vrai : les squelettes de
 * chargement ne s'affichent jamais et l'ensemble sent la maquette. On rend en
 * 70 à 200 ms — l'ordre de grandeur d'une bonne connexion.
 */
const LATENCY = { min: 70, max: 200 };

const wait = () =>
  new Promise<void>((resolve) =>
    setTimeout(resolve, LATENCY.min + Math.random() * (LATENCY.max - LATENCY.min)),
  );

/**
 * Répond à une requête du back-office depuis l'établissement de démonstration.
 * La forme du retour est celle qu'attend `request()` : un statut et un corps.
 */
export async function demoRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const [{ routeDemo }] = await Promise.all([import("./router"), wait()]);
  return routeDemo(method, path, body);
}

/**
 * Exports CSV — mêmes colonnes et même séparateur que l'API (point-virgule,
 * BOM UTF-8 pour qu'Excel en français ouvre le fichier sans se tromper
 * d'encodage). Un bouton « Exporter » qui échoue est pire qu'un bouton absent.
 */
export async function demoCsv(path: string): Promise<Blob> {
  const [{ demoWorld }] = await Promise.all([import("./router"), wait()]);
  const world = demoWorld();
  // L'écran Abonnement passe par la même fonction pour ses factures PDF (route
  // authentifiée, donc récupérée en blob). Lui rendre un CSV renommé en `.pdf`
  // donnerait un fichier illisible : le bouton aurait l'air de marcher et ne
  // marcherait pas — la pire des deux situations.
  if (path.endsWith("/pdf")) return invoicePdf(world, path);
  const csv = path.includes("menu.csv") ? menuCsv(world) : ordersCsv(world);
  return new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
}

const quote = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const euros = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

const CHANNEL_FR: Record<string, string> = { pos: "Comptoir", online: "En ligne", phone: "Téléphone" };
const TYPE_FR: Record<string, string> = { surplace: "Sur place", emporter: "À emporter", pickup: "Click & collect" };
const STATUS_FR: Record<string, string> = {
  new: "Nouvelle",
  preparing: "En préparation",
  ready: "Prête",
  delivered: "Servie",
  cancelled: "Annulée",
};
const PAY_METHOD_FR: Record<string, string> = { counter: "Au comptoir", online: "En ligne" };
const PAY_STATUS_FR: Record<string, string> = { pending: "À encaisser", paid: "Payée", refunded: "Remboursée" };

function ordersCsv(world: DemoWorld): string {
  const dateFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short" });
  const timeFmt = new Intl.DateTimeFormat("fr-FR", { timeStyle: "short" });
  const header = [
    "Numéro", "Date", "Heure", "Canal", "Type", "Statut", "Articles",
    "Sous-total (€)", "Remise (€)", "Total (€)", "Paiement", "Statut paiement", "Client",
  ];
  const rows = world.orders
    .slice()
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .map((o) =>
      [
        o.number,
        dateFmt.format(new Date(o.createdAt)),
        timeFmt.format(new Date(o.createdAt)),
        CHANNEL_FR[o.channel] ?? o.channel,
        TYPE_FR[o.type] ?? o.type,
        STATUS_FR[o.status] ?? o.status,
        o.lines.map((l) => `${l.qty}× ${l.name}${l.variantName ? ` (${l.variantName})` : ""}`).join(" · "),
        euros(o.totals.subtotal),
        "",
        euros(o.totals.total),
        PAY_METHOD_FR[o.payment.method] ?? o.payment.method,
        PAY_STATUS_FR[o.payment.status] ?? o.payment.status,
        o.pickup?.customerName ?? "",
      ]
        .map(quote)
        .join(";"),
    );
  return `${[header.map(quote).join(";"), ...rows].join("\r\n")}\r\n`;
}

function menuCsv(world: DemoWorld): string {
  const header = ["Catégorie", "Produit", "Description", "Variante", "Prix (€)", "Actif", "Rupture"];
  const byId = new Map(world.categories.map((c) => [c._id, c.name]));
  const bool = (v: boolean) => (v ? "Oui" : "Non");
  const rows = world.products.map((p) =>
    [
      p.categoryId ? (byId.get(p.categoryId) ?? "Non rattaché") : "Non rattaché",
      p.name,
      p.description,
      "",
      euros(p.price),
      bool(p.active),
      bool(p.outOfStock),
    ]
      .map(quote)
      .join(";"),
  );
  return `${[header.map(quote).join(";"), ...rows].join("\r\n")}\r\n`;
}

/** Nom de fichier proposé au téléchargement, comme le Content-Disposition. */
export const demoCsvName = (path: string): string =>
  path.endsWith("/pdf")
    ? "facture-demonstration.pdf"
    : path.includes("menu.csv")
      ? "carte-demonstration.csv"
      : "commandes-demonstration.csv";

// ─────────────────────────────────────────────────────────────
// Facture PDF de démonstration
// ─────────────────────────────────────────────────────────────

/**
 * Un PDF minimal mais VALIDE, écrit à la main.
 *
 * Le back-office de production sert un document composé côté serveur ; ici il
 * n'y a pas de serveur, et embarquer une bibliothèque de composition pour une
 * page de démonstration coûterait plus cher que tout le reste de la fixture.
 * On écrit donc les quelques centaines d'octets qu'exige le format — un
 * catalogue, une page, une police standard, un flux de texte — et le
 * navigateur l'ouvre comme n'importe quel autre PDF.
 *
 * Le document porte, en toutes lettres, qu'il s'agit d'une démonstration sans
 * valeur comptable : une facture d'apparence authentique n'a rien à faire dans
 * le dossier de téléchargements de quelqu'un.
 */
function invoicePdf(world: DemoWorld, path: string): Blob {
  const id = path.split("/").slice(-2)[0] ?? "";
  const billing = world.billing as {
    invoices?: Record<string, unknown>[];
    tenant?: { name?: string };
  };
  const invoice = billing.invoices?.find((i) => i._id === id) ?? billing.invoices?.[0] ?? {};
  const line = (k: string, fallback = "—") => String(invoice[k] ?? fallback);

  const body = [
    "SNACK MANAGER",
    "",
    "DOCUMENT DE DEMONSTRATION - SANS VALEUR COMPTABLE",
    "",
    `Facture ${line("number")}`,
    line("label"),
    "",
    `Etablissement : ${billing.tenant?.name ?? "Le Comptoir"}`,
    `Echeance : ${frDate(line("dueAt", ""))}`,
    `Statut : ${line("statusLabel")}`,
    `Montant : ${line("amountLabel")}`,
    "",
    "Cette page est produite dans votre navigateur, a partir de donnees",
    "de demonstration. Aucune facture reelle n'a ete emise.",
  ];

  return new Blob([pdfBytes(body)], { type: "application/pdf" });
}

const frDate = (iso: string): string => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Intl.DateTimeFormat("fr-FR").format(new Date(t)) : "—";
};

/** Échappement des caractères réservés d'une chaîne PDF. */
const pdfText = (s: string): string =>
  s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, "?");

/** Assemble un PDF 1.4 d'une page, table de références croisées comprise. */
function pdfBytes(lines: string[]): ArrayBuffer {
  const content = [
    "BT",
    "/F1 11 Tf",
    "14 TL",
    "56 780 Td",
    ...lines.map((l) => (l ? `(${pdfText(l)}) Tj T*` : "T*")),
    "ET",
  ].join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] " +
      "/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  // Un octet par caractère : les décalages de la table `xref` sont comptés en
  // octets, et un encodage UTF-8 les décalerait dès le premier accent.
  const buffer = new ArrayBuffer(pdf.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return buffer;
}
