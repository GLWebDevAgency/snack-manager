"use client";
import { useSyncExternalStore } from "react";
import { roleSatisfait } from "@sm/contracts";
import { isDemoActive } from "@/lib/demo";
import { roleAdmin } from "../session";
import { useAdminCapabilities } from "../access";
const subscribe = (notify: () => void) => { window.addEventListener('storage', notify); window.addEventListener('focus', notify); return () => { window.removeEventListener('storage', notify); window.removeEventListener('focus', notify); }; };
const currentRole = () => isDemoActive() ? 'owner' : roleAdmin();
export function useSitePermissions() {
  const role = useSyncExternalStore(subscribe, currentRole, () => null);
  const capabilities = useAdminCapabilities();
  const brand = role !== null && roleSatisfait(role, ['owner', 'gerant']);
  // La démo laisse les capacités absentes pour présenter tous les modules.
  // Attendre le snapshot de rôle conserve le même premier rendu côté serveur.
  const demo = role !== null && isDemoActive();
  return { brand, menu: brand && (demo || capabilities.includes('menu')), online: demo || capabilities.includes('online') };
}
