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
  return { brand, menu: brand && capabilities.includes('menu') };
}
