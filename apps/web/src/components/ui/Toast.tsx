"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Icon, type IconName } from "./icons";

type ToastOptions = {
  /** Icône optionnelle (17px, gold). */
  icon?: IconName;
  /** Durée d'affichage en ms (défaut 2200). */
  ms?: number;
};

type ToastItem = { id: number; msg: string; icon?: IconName };

const ToastCtx = createContext<((msg: string, opts?: ToastOptions) => void) | null>(
  null,
);

/**
 * Toasts (spec design-system §6.11) : pilule bas centre, z-index 9000,
 * autodismiss 2200ms, animation pop. Envelopper l'app : <ToastProvider>…
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const toast = useCallback((msg: string, opts?: ToastOptions) => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, msg, icon: opts?.icon }]);
    window.setTimeout(
      () => setToasts((t) => t.filter((x) => x.id !== id)),
      opts?.ms ?? 2200,
    );
  }, []);

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-6 left-1/2 z-[9000] flex -translate-x-1/2 flex-col items-center gap-2"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            // `surface`, pas `bg` : le toast flotte AU-DESSUS du contenu — son
            // niveau est celui d'une carte, pas celui du canevas.
            className="flex animate-pop items-center gap-2 whitespace-nowrap rounded-pill border border-line bg-surface px-[18px] py-3 text-sm font-bold text-ink shadow-soft"
          >
            {t.icon && <Icon name={t.icon} size={17} className="text-gold" />}
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** `const toast = useToast(); toast("Enregistré", { icon: "check" });` */
export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx)
    throw new Error("useToast doit être appelé sous <ToastProvider>");
  return ctx;
}
