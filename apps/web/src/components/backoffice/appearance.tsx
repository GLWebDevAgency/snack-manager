"use client";

import { useSyncExternalStore } from "react";
import { Icon } from "@/components/ui/icons";
import type { BackofficeTheme } from "./visual-style";

export const BACKOFFICE_THEME_KEY = "sm.backoffice.theme.v1";
const EVENT = "sm:backoffice-theme";
let memoryTheme: BackofficeTheme = "light";
let memoryOnly = false;

export function parseBackofficeTheme(value: string | null): BackofficeTheme {
  return value === "dark" ? "dark" : "light";
}
function readTheme(): BackofficeTheme {
  if (memoryOnly) return memoryTheme;
  try {
    const saved = localStorage.getItem(BACKOFFICE_THEME_KEY);
    return saved === null ? memoryTheme : parseBackofficeTheme(saved);
  } catch { return memoryTheme; }
}
function subscribe(notify: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== BACKOFFICE_THEME_KEY && event.key !== null) return;
    memoryOnly = false;
    memoryTheme = parseBackofficeTheme(event.newValue);
    notify();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(EVENT, notify);
  return () => { window.removeEventListener("storage", onStorage); window.removeEventListener(EVENT, notify); };
}
export function useBackofficeTheme() {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "light" as const);
  function toggleTheme() {
    memoryTheme = theme === "light" ? "dark" : "light";
    try {
      localStorage.setItem(BACKOFFICE_THEME_KEY, memoryTheme);
      memoryOnly = false;
    } catch { memoryOnly = true; /* A readable stale value must not override this visit's choice. */ }
    window.dispatchEvent(new Event(EVENT));
  }
  return { theme, toggleTheme };
}

export function AppearanceButton({ theme, onToggle }: { theme: BackofficeTheme; onToggle: () => void }) {
  const label = theme === "light" ? "Activer le thème sombre" : "Activer le thème clair";
  return <button type="button" onClick={onToggle} aria-label={label} title={label}
    className="sm-appearance cf-press grid size-11 shrink-0 place-items-center rounded-ctrl border border-line bg-surface text-ink hover:bg-surface2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
    <Icon name={theme === "light" ? "moon" : "sun"} size={20} />
  </button>;
}
