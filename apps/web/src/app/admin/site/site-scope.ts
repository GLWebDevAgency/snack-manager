"use client";
import { createContext, useContext, useState, useSyncExternalStore } from "react";
import { getToken } from "@/lib/api";
import { isDemoActive } from "@/lib/demo";
export const currentAdminScope = () => isDemoActive() ? '__demo__' : getToken();
const subscribe = (notify: () => void) => { window.addEventListener('storage', notify); window.addEventListener('focus', notify); return () => { window.removeEventListener('storage', notify); window.removeEventListener('focus', notify); }; };
export const useAdminScopeToken = () => useSyncExternalStore(subscribe, currentAdminScope, () => null);
/** Autorité capturée par la lecture /me qui a fourni les données à l'éditeur. */
export const SiteEditScopeContext = createContext<string | null | undefined>(undefined);
/** La source est fixée au montage, jamais remplacée par le nouveau token. */
export function useSiteEditScope() {
  const provided = useContext(SiteEditScopeContext);
  const [legacySource] = useState(currentAdminScope);
  const source = provided === undefined ? legacySource : provided;
  const live = useAdminScopeToken();
  return { valid: source !== null && source === live, current: () => source !== null && source === currentAdminScope() };
}
