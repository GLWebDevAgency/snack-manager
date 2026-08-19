"use client";

/**
 * Client API minimal du back-office. Le token JWT vit en localStorage
 * (session gérant 12 h) ; le tenantId est porté par le token, jamais envoyé.
 */
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * UNE SESSION PAR BACK-OFFICE, PAS UNE PAR NAVIGATEUR.
 *
 * Les deux back-offices vivent sur le MÊME domaine : `/admin` pour le gérant
 * du restaurant, `/sm` pour l'équipe Snack Manager. Le stockage local est
 * partagé par origine et par onglet — une clé unique faisait donc que la
 * seconde connexion écrasait la première.
 *
 * L'enchaînement observé, et il est vicieux : on se connecte à `/sm`, le
 * jeton d'équipe remplace celui du gérant ; l'onglet `/admin` appelle une
 * route rattachée à un établissement avec un jeton qui n'en désigne aucun,
 * reçoit un refus, EFFACE le jeton et redirige vers sa page de connexion —
 * tuant du même coup la session `/sm` qui venait pourtant de réussir. Les
 * deux onglets se déconnectent mutuellement, indéfiniment.
 *
 * Chaque surface a donc son propre emplacement. Ce n'est pas seulement un
 * confort : les deux identités sont distinctes — l'une administre un
 * restaurant, l'autre administre le parc — et rien ne justifie qu'ouvrir la
 * seconde ferme la première.
 */
const TOKEN_KEYS = {
  /** Équipe Snack Manager (rôle `sm_admin`), surface `/sm`. */
  hq: "sm.token.hq",
  /** Gérant et équipe d'un restaurant, surface `/admin`. */
  resto: "sm.token.resto",
} as const;

/** Ancienne clé unique — purgée au premier accès, voir `tokenKey`. */
const LEGACY_TOKEN_KEY = "sm.token";

/**
 * L'emplacement se déduit du chemin courant.
 *
 * Le déduire évite de faire passer la surface en paramètre à travers tout le
 * client : un appel oublié retomberait sur le mauvais jeton, et le défaut
 * serait invisible jusqu'au moment où deux sessions cohabitent.
 */
function tokenKey(): string {
  if (typeof window === "undefined") return TOKEN_KEYS.resto;
  // L'ancien jeton n'est jamais adopté : on ignore lequel des deux comptes
  // il désignait, et le rattacher au hasard recréerait exactement la collision
  // qu'on répare. Une reconnexion, une fois.
  try {
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    // Navigation privée verrouillée : sans stockage, il n'y a pas de collision.
  }
  return window.location.pathname.startsWith("/sm") ? TOKEN_KEYS.hq : TOKEN_KEYS.resto;
}

export const getToken = () =>
  typeof window === "undefined" ? null : localStorage.getItem(tokenKey());
export const setToken = (t: string) => localStorage.setItem(tokenKey(), t);
export const clearToken = () => localStorage.removeItem(tokenKey());

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(
      (body as { message?: string })?.message ?? `Erreur API (${status})`,
    );
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};

/** GET typé générique — raccourci de `api.get`. */
export const get = <T>(path: string) => api.get<T>(path);

/**
 * Télécharge un export (CSV…) authentifié et déclenche l'enregistrement
 * navigateur. Le nom de fichier vient de Content-Disposition, sinon du chemin.
 */
export async function csvDownload(
  path: string,
  filename?: string,
): Promise<void> {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    throw new ApiError(res.status, await res.json().catch(() => null));
  }
  const blob = await res.blob();
  const fromHeader = res.headers
    .get("content-disposition")
    ?.match(/filename="?([^";]+)"?/)?.[1];
  const fallback = path.split("?")[0]?.split("/").pop() || "export";
  const name =
    filename ??
    fromHeader ??
    (fallback.includes(".") ? fallback : `${fallback}.csv`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Tenant courant (GET /tenants/me) — champs consommés par le back-office. */
export type TenantMe = {
  _id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  brandColor: string;
  address: string;
  phones: string[];
  hours: {
    day: number;
    lunch: { open: string; close: string } | null;
    dinner: { open: string; close: string } | null;
  }[];
  closures: { from?: string; to?: string; reason?: string }[];
  plan: "essentiel" | "complet" | "boost";
  settings: {
    slotIntervalMin: number;
    slotCapacity: number;
    onlineOrderingPaused: boolean;
    pauseMessage: string;
    printTicketOn: "accept" | "ready";
    printStickerOn: "accept" | "ready";
    dailyGoalCents?: number;
  };
};

/** 950 → « 9,50 € » */
export const euros = (cents: number) =>
  (cents / 100).toFixed(2).replace(".", ",") + " €";
