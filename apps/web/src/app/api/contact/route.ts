import { NextResponse } from "next/server";

/**
 * POST /api/contact — lead du site vitrine.
 *
 * Chaîne de traitement :
 *   1. honeypot + limitation de débit par IP (mémoire process, best effort) ;
 *   2. validation stricte (le client valide déjà, on ne lui fait pas confiance) ;
 *   3. transfert à l'API métier (`POST {API_URL}/public/leads`) qui écrit dans
 *      la collection MongoDB `leads`.
 *
 * ⚠️ Cet endpoint n'existe pas encore côté @sm/api (aucun module `leads` au
 * moment de l'écriture). Tant qu'il répond 404/405, on journalise le lead
 * proprement en sortie serveur et on renvoie un succès au visiteur — on ne lui
 * fait pas payer une lacune de notre back-end. Dès que la route existe, ce
 * fichier n'a pas besoin de changer.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const LEADS_PATH = process.env.LEADS_ENDPOINT ?? "/public/leads";

const PHONE_RE = /^[+0-9][0-9\s.\-()]{7,19}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SLOTS = new Set(["matin", "entre-services", "apres-21h"]);

const MAX = { name: 120, restaurant: 160, phone: 32, email: 180, message: 2000 } as const;

/* ── Limitation de débit (5 envois / 10 min / IP) ──────────────────── */

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear(); // garde-fou mémoire
  return recent.length > MAX_PER_WINDOW;
}

/* ── Validation ────────────────────────────────────────────────────── */

type Lead = {
  name: string;
  restaurant: string | null;
  phone: string;
  email: string | null;
  callbackSlot: string;
  message: string | null;
  /**
   * « Vous vendez déjà sur Uber Eats ou Deliveroo ? » — la case à cocher du
   * formulaire. C'est un signal de qualification, pas une commande : on regarde
   * les pages du restaurateur avec lui pendant l'appel. Aucun prix, aucune
   * promesse, aucun délai n'est attaché à ce booléen, ni ici ni dans la page.
   */
  platforms: boolean;
  source: "site-vitrine";
  createdAt: string;
};

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function parse(body: unknown): { lead: Lead } | { error: string } {
  if (typeof body !== "object" || body === null) {
    return { error: "Requête invalide." };
  }
  const b = body as Record<string, unknown>;

  // Honeypot : un humain ne voit jamais ce champ.
  if (str(b.company, 200).length > 0) return { error: "spam" };

  const name = str(b.name, MAX.name);
  const phone = str(b.phone, MAX.phone);
  const email = str(b.email, MAX.email);
  const slot = str(b.callbackSlot, 40);

  if (name.length < 2) return { error: "Indiquez votre nom." };
  if (!PHONE_RE.test(phone)) return { error: "Numéro de téléphone invalide." };
  if (email && !EMAIL_RE.test(email)) return { error: "Adresse e-mail invalide." };

  return {
    lead: {
      name,
      restaurant: str(b.restaurant, MAX.restaurant) || null,
      phone,
      email: email || null,
      callbackSlot: SLOTS.has(slot) ? slot : "matin",
      message: str(b.message, MAX.message) || null,
      // Une case décochée n'est pas envoyée par le navigateur : tout ce qui
      // n'est pas strictement `true` vaut « non », y compris un "on" en chaîne
      // ou un champ absent. Un booléen mal formé ne doit pas faire échouer un
      // rappel — le nom et le téléphone sont les seuls champs qui le peuvent.
      platforms: b.platforms === true,
      source: "site-vitrine",
      createdAt: new Date().toISOString(),
    },
  };
}

/* ── Handler ───────────────────────────────────────────────────────── */

export async function POST(request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  if (rateLimited(ip)) {
    return NextResponse.json(
      { ok: false, error: "Trop de demandes envoyées. Réessayez dans quelques minutes." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Requête invalide." }, { status: 400 });
  }

  const parsed = parse(body);
  if ("error" in parsed) {
    // Le spam reçoit un succès silencieux : inutile d'apprendre au robot ce qui l'a trahi.
    if (parsed.error === "spam") return NextResponse.json({ ok: true, stored: false });
    return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  const { lead } = parsed;

  try {
    const res = await fetch(`${API_URL}${LEADS_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(lead),
      signal: AbortSignal.timeout(8000),
    });

    if (res.ok) return NextResponse.json({ ok: true, stored: true });

    if (res.status === 404 || res.status === 405) {
      logFallback(lead, `endpoint absent (${res.status} ${API_URL}${LEADS_PATH})`);
      return NextResponse.json({ ok: true, stored: false });
    }

    console.error(`[contact] l'API a refusé le lead (${res.status})`);
    logFallback(lead, `réponse ${res.status}`);
    return NextResponse.json({ ok: true, stored: false });
  } catch (err) {
    logFallback(lead, err instanceof Error ? err.message : "erreur réseau");
    return NextResponse.json({ ok: true, stored: false });
  }
}

/**
 * Dernier filet : le lead part dans les logs du serveur (récupérables sur
 * Railway) plutôt que de disparaître. Le message est volontairement dense et
 * préfixé pour être grep-able : `grep '\[contact\] LEAD'`.
 */
function logFallback(lead: Lead, reason: string) {
  console.warn(
    `[contact] LEAD non persisté (${reason}) — ${JSON.stringify({
      ...lead,
      // On ne recopie pas le message complet dans les logs : juste sa taille.
      message: lead.message ? `<${lead.message.length} caractères>` : null,
    })}`,
  );
}
