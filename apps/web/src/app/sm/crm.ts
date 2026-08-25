"use client";

/**
 * Client du CRM interne (HQ). Toutes les lectures/écritures passent par
 * `/crm/*`, réservé au rôle `sm_admin` côté API.
 *
 * Rappel : les montants circulent en CENTIMES, la conversion en euros
 * n'existe qu'à l'affichage.
 */

import { createContext, useContext } from "react";
import type {
  CrmClient,
  CrmLead,
  CrmOverview,
  CrmProductionWeek,
  LeadConvert,
  LeadConversion,
  LeadCreate,
  LeadStage,
  LeadTouchCreate,
  LeadUpdate,
  ProductionTick,
} from "@sm/contracts";
import { api, getToken } from "@/lib/api";

// ─── Identité & cloisonnement ───

/** Rôle attendu pour entrer dans le back-office interne. */
export const HQ_ROLE = "sm_admin";

type JwtClaims = { sub: string; tenantId: string | null; role: string; exp?: number };

/**
 * Lit le rôle porté par le jeton, sans appel réseau.
 *
 * Ce n'est PAS la sécurité — la garde qui compte est `@Roles('sm_admin')` sur
 * le contrôleur, qui répond 403 quoi qu'affiche le navigateur. Ici on évite
 * seulement qu'un gérant voie clignoter une interface qui ne le concerne pas
 * avant d'être renvoyé chez lui.
 */
export function readClaims(token: string | null = getToken()): JwtClaims | null {
  const payload = token?.split(".")[1];
  if (!payload) return null;
  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as JwtClaims;
  } catch {
    return null;
  }
}

export const isHqSession = (token: string | null = getToken()): boolean =>
  readClaims(token)?.role === HQ_ROLE;

// ─── Appels ───

export const crm = {
  overview: () => api.get<CrmOverview>("/crm/overview"),
  clients: () => api.get<CrmClient[]>("/crm/tenants"),
  leads: (stage?: LeadStage) =>
    api.get<CrmLead[]>(`/crm/leads${stage ? `?stage=${stage}` : ""}`),
  createLead: (body: LeadCreate | Partial<LeadCreate>) =>
    api.post<CrmLead>("/crm/leads", body),
  updateLead: (id: string, body: LeadUpdate) =>
    api.patch<CrmLead>(`/crm/leads/${id}`, body),
  changeStage: (id: string, stage: LeadStage) =>
    api.patch<CrmLead>(`/crm/leads/${id}/stage`, { stage }),
  addTouch: (id: string, body: LeadTouchCreate) =>
    api.post<CrmLead>(`/crm/leads/${id}/touches`, body),
  /** SIGNER : le lead devient un restaurant — le mot de passe ne se relit jamais. */
  convertLead: (id: string, body: LeadConvert) =>
    api.post<LeadConversion>(`/crm/leads/${id}/convert`, body),
  /** Nouveau mot de passe gérant, remis une fois — remplace le script CLI. */
  resetOwner: (tenantId: string) =>
    api.post<{ ownerEmail: string; password: string }>(`/crm/tenants/${tenantId}/owner-reset`),
  /** « Traité » : sort le signal de la file quelques jours. */
  dismissSignal: (id: string) =>
    api.post<{ ok: true }>(`/crm/signals/${encodeURIComponent(id)}/dismiss`),
  /** La file de production de l'Atelier — la semaine courante sans paramètre. */
  production: (week?: string) =>
    api.get<CrmProductionWeek>(`/crm/production${week ? `?week=${encodeURIComponent(week)}` : ""}`),
  /** Cocher/décocher une tâche due de la file de production. */
  tickProduction: (tenantId: string, body: ProductionTick) =>
    api.post<{ done: boolean }>(`/crm/production/${tenantId}/tick`, body),
};

// ─── État partagé de la coquille ───

/**
 * L'aperçu HQ est lu par la coquille (compteur de places fondateur en barre de
 * titre, badge du pipeline) ET par le tableau de bord. Un contexte évite la
 * double requête et, surtout, garde les deux affichages d'accord : réserver
 * une place fondateur dans une fiche met à jour le compteur du bandeau.
 */
export type HqState = {
  overview: CrmOverview | null;
  loading: boolean;
  reload: () => void;
};

export const HqContext = createContext<HqState>({
  overview: null,
  loading: true,
  reload: () => {},
});

export const useHq = () => useContext(HqContext);

// ─── Formatage ───

/** 11900 → « 119 € ». Un abonnement mensuel se lit à l'euro, pas au centime. */
export const euroRound = (cents: number): string =>
  `${Math.round(cents / 100).toLocaleString("fr-FR")} €`;

export const int = (n: number): string => n.toLocaleString("fr-FR");

/** « 12 août » / « 12 août 2025 » si l'année n'est pas l'année courante. */
export function fmtDay(value: string | Date): string {
  const d = new Date(value);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** « août 2026 », première lettre capitalisée — date d'entrée d'un client. */
export function fmtMonth(value: string | Date): string {
  const s = new Date(value).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Ancienneté d'une commande / d'une relance, au grain qui intéresse le
 * commercial : « aujourd'hui », « hier », « il y a 4 j ».
 */
export function fmtDaysAgo(days: number | null): string {
  if (days === null) return "jamais";
  if (days === 0) return "aujourd'hui";
  if (days === 1) return "hier";
  return `il y a ${days} j`;
}
