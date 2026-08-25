"use client";

/**
 * Paiement par carte — Stripe Payment Element.
 *
 * Stripe.js est chargé **à la demande** depuis `js.stripe.com` (exigence PCI :
 * le script doit venir de Stripe, il ne peut pas être empaqueté). Aucune
 * dépendance npm n’est ajoutée : le tunnel fonctionne à l’identique sur un
 * compte sans paiement en ligne, où cette étape n’est jamais montée.
 *
 * Les numéros de carte ne transitent JAMAIS par notre code ni par notre API :
 * ils sont saisis dans les iframes de Stripe et échangés contre un
 * `PaymentIntent` confirmé côté Stripe.
 */

import { useEffect, useRef, useState } from "react";
import { Banner, PrimaryAction, Spinner } from "./primitives";

// ─── Surface minimale de Stripe.js réellement utilisée ───

type StripeElement = {
  mount(target: HTMLElement): void;
  unmount(): void;
  destroy(): void;
  on(event: string, handler: (event: { complete?: boolean }) => void): void;
};

type StripeElements = {
  create(type: "payment", options?: Record<string, unknown>): StripeElement;
};

type ConfirmResult = {
  error?: { message?: string };
  paymentIntent?: { status?: string };
};

type StripeInstance = {
  elements(options: Record<string, unknown>): StripeElements;
  confirmPayment(options: {
    elements: StripeElements;
    confirmParams?: { return_url?: string };
    redirect?: "if_required" | "always";
  }): Promise<ConfirmResult>;
};

declare global {
  interface Window {
    Stripe?: (key: string, options?: Record<string, unknown>) => StripeInstance;
  }
}

const STRIPE_JS = "https://js.stripe.com/v3/";

let loader: Promise<void> | null = null;

/** Charge Stripe.js une seule fois par session. */
function loadStripeJs(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("SSR"));
  if (window.Stripe) return Promise.resolve();
  if (loader) return loader;
  loader = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${STRIPE_JS}"]`,
    );
    const script = existing ?? document.createElement("script");
    script.src = STRIPE_JS;
    script.async = true;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("Stripe.js n’a pas pu être chargé")),
      { once: true },
    );
    if (!existing) document.head.appendChild(script);
  });
  return loader;
}

/** Habillage sombre de l’iframe Stripe, aligné sur la charte du tunnel. */
function appearance(accent: string) {
  return {
    theme: "night",
    variables: {
      colorPrimary: accent,
      colorBackground: "#1a1a1a",
      colorText: "#ffffff",
      colorTextSecondary: "#999999",
      colorDanger: "#c94b3f",
      fontFamily: "Inter, system-ui, sans-serif",
      borderRadius: "10px",
      spacingUnit: "4px",
    },
    rules: {
      ".Input": { border: "1px solid rgba(255,255,255,0.1)", boxShadow: "none" },
      ".Input:focus": { border: `1px solid ${accent}`, boxShadow: "none" },
      ".Label": { color: "#999999", fontWeight: "600" },
    },
  };
}

export function StripeCard({
  publishableKey,
  clientSecret,
  stripeAccount,
  amount,
  accent,
  /** URL de retour après authentification 3-D Secure (suivi de commande). */
  returnUrl,
  onPaid,
  onGiveUp,
}: {
  publishableKey: string;
  clientSecret: string;
  /**
   * Le compte du restaurant (charges directes) — Stripe.js DOIT être
   * initialisé dessus. L'intention de paiement n'existe que sur ce compte :
   * sans lui, Stripe refuse le `client_secret` et le client voit son paiement
   * échouer au dernier clic, sans explication.
   */
  stripeAccount: string;
  amount: number;
  accent: string;
  returnUrl: string;
  onPaid: () => void;
  /** Repli explicite : « je réglerai au comptoir ». */
  onGiveUp: () => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stripeRef = useRef<StripeInstance | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);

  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let element: StripeElement | null = null;

    loadStripeJs()
      .then(() => {
        if (cancelled || !mountRef.current) return;
        const factory = window.Stripe;
        if (!factory) throw new Error("Stripe.js indisponible");
        const stripe = factory(publishableKey, { locale: "fr", stripeAccount });
        const elements = stripe.elements({
          clientSecret,
          appearance: appearance(accent),
        });
        element = elements.create("payment", {
          layout: { type: "tabs", defaultCollapsed: false },
        });
        element.mount(mountRef.current);
        stripeRef.current = stripe;
        elementsRef.current = elements;
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("failed");
      });

    return () => {
      cancelled = true;
      try {
        element?.destroy();
      } catch {
        /* démontage best-effort */
      }
    };
  }, [publishableKey, clientSecret, stripeAccount, accent]);

  async function pay() {
    const stripe = stripeRef.current;
    const elements = elementsRef.current;
    if (!stripe || !elements || paying) return;
    setPaying(true);
    setError(null);
    try {
      const result = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: returnUrl },
        // `if_required` évite un aller-retour de page quand le 3-DS n’est pas exigé.
        redirect: "if_required",
      });
      if (result.error) {
        setError(result.error.message ?? "Le paiement n’a pas abouti.");
        return;
      }
      const state = result.paymentIntent?.status;
      if (state === "succeeded" || state === "processing") {
        onPaid();
        return;
      }
      setError("Le paiement n’a pas été confirmé. Réessayez ou réglez au comptoir.");
    } catch {
      setError("Le paiement n’a pas pu être contacté. Réessayez.");
    } finally {
      setPaying(false);
    }
  }

  if (status === "failed") {
    return (
      <div className="flex flex-col gap-3">
        <Banner tone="alert" icon="bell" title="Paiement en ligne indisponible">
          Votre commande est enregistrée : vous pourrez régler au comptoir au
          moment du retrait.
        </Banner>
        <PrimaryAction icon="check" onClick={onGiveUp}>
          Continuer — je paie au comptoir
        </PrimaryAction>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-card border border-white/8 bg-surface2 p-3.5">
        {status === "loading" && (
          <p className="flex items-center gap-2.5 py-6 text-[14px] text-mut">
            <Spinner />
            Connexion au paiement sécurisé…
          </p>
        )}
        <div ref={mountRef} />
      </div>

      {error && (
        <Banner tone="alert" icon="bell" title="Paiement refusé">
          {error}
        </Banner>
      )}

      <PrimaryAction
        onClick={pay}
        disabled={status !== "ready"}
        loading={paying}
        icon="check"
        amount={amount}
      >
        Payer
      </PrimaryAction>

      <button
        type="button"
        onClick={onGiveUp}
        className="text-center text-[13px] font-semibold text-mut underline underline-offset-4 transition-colors duration-200 hover:text-ink"
      >
        Je préfère régler au comptoir
      </button>

      <p className="text-center text-[12px] text-mut">
        Paiement chiffré par Stripe · Visa · Mastercard · CB
      </p>
    </div>
  );
}
