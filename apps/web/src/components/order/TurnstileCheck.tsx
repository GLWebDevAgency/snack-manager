"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BrandMode } from "@sm/contracts";
import { cx } from "@/lib/cx";
import { Icon } from "@/components/ui";
import { Spinner } from "./primitives";

const TURNSTILE_JS =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileApi = {
  render(
    target: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      cData: string;
      /*
       * Le widget est un rectangle OPAQUE au milieu de l'étape paiement : son
       * thème doit suivre le masque, sinon il ouvre un trou sombre dans une
       * page crème sur Brasserie, Atelier, Marché et Soleil — précisément le
       * défaut que le masque d'identité existe pour fermer. Le type était
       * littéralement `"dark"`, ce qui rendait l'oubli indétectable.
       */
      theme: "dark" | "light";
      language: "fr";
      size: "flexible";
      appearance: "interaction-only";
      retry: "auto";
      "refresh-expired": "auto";
      "refresh-timeout": "auto";
      "response-field": false;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "timeout-callback": () => void;
      "error-callback": (code?: string) => void;
      "unsupported-callback": () => void;
    },
  ): string;
  remove(widgetId: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

type CheckState = "loading" | "ready" | "verified" | "error" | "unsupported";

/**
 * Verification humaine discrète, rendue explicitement car le tunnel est une
 * feuille dynamique. Le jeton ne quitte ce composant que par `onToken` et ne
 * vaut jamais autorisation : l'API le valide encore via Siteverify.
 */
export function TurnstileCheck({
  siteKey,
  tenantSlug,
  mode,
  resetKey,
  onToken,
}: {
  siteKey: string;
  tenantSlug: string;
  /** Mode du masque : le widget suit la peau du restaurant, pas la nôtre. */
  mode: BrandMode;
  /** Change après chaque tentative : un jeton Turnstile est à usage unique. */
  resetKey: number;
  onToken: (token: string | null) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [state, setState] = useState<CheckState>(siteKey ? "loading" : "error");

  const removeWidget = useCallback(() => {
    if (widget.current && window.turnstile) {
      try {
        window.turnstile.remove(widget.current);
      } catch {
        /* le script peut s'être rechargé entre-temps */
      }
    }
    widget.current = null;
  }, []);

  useEffect(() => {
    if (!scriptReady || !siteKey || !container.current || !window.turnstile) return;
    removeWidget();
    onToken(null);
    setState("ready");
    let active = true;
    try {
      widget.current = window.turnstile.render(container.current, {
        sitekey: siteKey,
        action: "public-order",
        cData: tenantSlug,
        theme: mode === "dark" ? "dark" : "light",
        language: "fr",
        size: "flexible",
        appearance: "interaction-only",
        retry: "auto",
        "refresh-expired": "auto",
        "refresh-timeout": "auto",
        "response-field": false,
        callback: (token) => {
          onToken(token);
          setState("verified");
        },
        "expired-callback": () => {
          onToken(null);
          setState("ready");
        },
        "timeout-callback": () => {
          onToken(null);
          setState("ready");
        },
        "error-callback": () => {
          onToken(null);
          setState("error");
        },
        "unsupported-callback": () => {
          onToken(null);
          setState("unsupported");
        },
      });
    } catch {
      // React 19 refuse une mise à jour synchrone dans l'effet. Le microtask
      // transforme l'échec impératif du SDK en événement, comme ses callbacks.
      queueMicrotask(() => {
        if (!active) return;
        onToken(null);
        setState("error");
      });
    }
    return () => {
      active = false;
      removeWidget();
    };
  }, [mode, onToken, removeWidget, resetKey, scriptReady, siteKey, tenantSlug]);

  const verified = state === "verified";
  const failed = state === "error" || state === "unsupported";
  const label = verified
    ? "Vérification réussie"
    : failed
      ? "Vérification indisponible"
      : "Sécurisation de la commande…";
  const detail = verified
    ? "Vous pouvez maintenant confirmer votre commande."
    : state === "unsupported"
      ? "Ce navigateur ne permet pas la vérification. Appelez le restaurant pour commander."
      : state === "error"
        ? "La protection anti-robot ne répond pas. Vérifiez votre réseau puis réessayez."
        : "Un contrôle anti-robot discret protège le restaurant des faux tickets.";

  return (
    <section
      aria-live="polite"
      className={cx(
        "overflow-hidden rounded-panel border bg-surface2 transition-colors duration-med ease-sm motion-reduce:transition-none",
        verified ? "border-ok/35" : failed ? "border-alert/35" : "border-ink/8",
      )}
    >
      {siteKey && (
        <Script
          id="snackmanager-turnstile"
          src={TURNSTILE_JS}
          strategy="afterInteractive"
          onReady={() => setScriptReady(true)}
          onError={() => setState("error")}
        />
      )}
      <div className="flex items-center gap-3 px-4 py-3.5">
        {/*
          `okt` / `alertt` et non `ok` / `alert` : les teintes brutes sont
          dessinées pour être des APLATS, et ces icônes sont posées SUR leur
          propre lavis à 10 % — le rouge brut y tombe à 2,97:1 sur Nuit, sous
          le 3:1 que 1.4.11 exige d'un pictogramme porteur de sens. Les teintes
          en `-t` sont les mêmes couleurs ramenées à l'AA sur ce lavis par le
          résolveur : elles existent exactement pour cet emploi.
        */}
        <span
          className={cx(
            "grid size-9 shrink-0 place-items-center rounded-full border",
            verified
              ? "border-ok/30 bg-ok/10 text-okt"
              : failed
                ? "border-alert/30 bg-alert/10 text-alertt"
                : "border-ink/8 bg-ink/[0.035] text-mut",
          )}
        >
          {verified ? (
            <Icon name="check" size={17} stroke={2.5} />
          ) : failed ? (
            <Icon name="bell" size={16} stroke={2.2} />
          ) : (
            <Spinner />
          )}
        </span>
        <span className="min-w-0">
          <strong className="block text-[13px] font-extrabold text-ink">{label}</strong>
          <span className="mt-0.5 block text-[11px] leading-relaxed text-mut">{detail}</span>
        </span>
      </div>
      <div ref={container} className="w-full px-3 pb-3 empty:hidden" />
    </section>
  );
}
