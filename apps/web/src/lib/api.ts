"use client";

/**
 * Client API minimal du back-office. Le token JWT vit en localStorage
 * (session gérant 12 h) ; le tenantId est porté par le token, jamais envoyé.
 */
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const TOKEN_KEY = "sm.token";

export const getToken = () =>
  typeof window === "undefined" ? null : localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

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
