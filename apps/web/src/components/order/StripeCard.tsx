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

import { useEffect, useRef, useState, type ComponentProps, type CSSProperties } from "react";
import { fallbackDe, TYPE_PAIRS, type Brand } from "@sm/contracts";
import { Banner, PrimaryAction, Spinner } from "./primitives";

// ─── Surface minimale de Stripe.js réellement utilisée ───

type WalletConfirmEvent = { paymentFailed?: (payload: { reason: 'fail'; message?: string }) => void };
type StripeElementEvent = WalletConfirmEvent & { complete?: boolean; availablePaymentMethods?: Record<string, boolean> | null;
  paymentMethods?: Record<string, { available: boolean }> };
type StripeElement = {
  mount(target: HTMLElement): void;
  unmount(): void;
  destroy(): void;
  on(event: string, handler: (event: StripeElementEvent) => void): void;
};

type StripeElements = {
  create(type: "payment" | "expressCheckout", options?: Record<string, unknown>): StripeElement;
  submit(): Promise<{ error?: { message?: string } }>;
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
      () => { script.remove(); loader = null; reject(new Error("Stripe.js n’a pas pu être chargé")); },
      { once: true },
    );
    if (!existing) document.head.appendChild(script);
  });
  return loader;
}

/**
 * Habillage du champ de carte — les valeurs RÉSOLUES du masque, pas des jetons.
 *
 * Le Payment Element vit dans une iframe servie par Stripe : notre feuille de
 * style ne l'atteint pas, `var(--cf-*)` n'y résout rien. Il faut donc lui
 * passer des couleurs déjà calculées — c'est le seul endroit du produit où le
 * masque sort en valeurs plates.
 *
 * Et la police : Stripe ne peut pas charger nos familles `next/font` (elles
 * sont servies depuis notre origine, sous des noms hachés). On lui donne la
 * PILE DE REPLI de la famille de corps — le champ carte garde donc la police
 * système du genre choisi, ce qui est assumé : mieux vaut un repli cohérent
 * qu'une police qui ne chargera jamais.
 */
export type ApparenceStripe = ReturnType<typeof apparenceStripeDe>;
export type StripePaymentOutcome = "idle" | "processing" | "paid";

/**
 * `vars` ARRIVE, elle n'est pas recalculée.
 *
 * Cette fonction appelait `resoudreMarque(brand)` alors que la vitrine venait
 * de le faire à la ligne d'avant via `styleDuMasque()` : deux résolutions
 * complètes — une trentaine de mélanges et jusqu'à quatre recherches d'AA
 * chacune — pour le même objet, dans le même rendu. Le commentaire voisin
 * refusait pourtant « de payer une palette pour lire une police ». Les
 * variables déjà posées sur la racine suffisent ; il ne reste ici que le
 * `mode` et la paire typographique, qui se lisent sur la marque sans rien
 * résoudre.
 */
export function apparenceStripeDe(masque: CSSProperties, brand: Brand) {
  /*
   * `styleDuMasque()` rend la carte des `--cf-*` — c'est son contenu réel ;
   * elle n'est typée `CSSProperties` que parce que React exige ce type pour
   * un attribut `style` (le même transtypage y figure déjà). On la relit donc
   * telle qu'elle est, plutôt que de refaire la résolution pour cinq valeurs.
   */
  const vars = masque as Record<string, string | undefined>;
  const accent = vars["--cf-accent"] ?? "";
  const focus = vars["--cf-focus"] ?? accent;
  return {
    // Le thème de départ décide des valeurs que Stripe ne reçoit pas de nous
    // (icônes, états désactivés) : sur un masque clair, « night » les
    // laisserait blanches sur crème.
    theme: brand.mode === "dark" ? "night" : "stripe",
    variables: {
      colorPrimary: accent,
      colorBackground: vars["--cf-surface"] ?? "",
      colorText: vars["--cf-text"] ?? "",
      colorTextSecondary: vars["--cf-mut"] ?? "",
      colorDanger: vars["--cf-red"] ?? "",
      fontFamily: fallbackDe(TYPE_PAIRS[brand.type.pair].body),
      borderRadius: vars["--cf-r-md"] ?? "",
      spacingUnit: "4px",
    },
    rules: {
      ".Input": { border: `1px solid ${vars["--cf-line"] ?? ""}`, boxShadow: "none" },
      /*
        LE CHAMP DE CARTE GARDE UN FOCUS VISIBLE.
        `boxShadow: 'none'` supprimait l'anneau que Stripe pose par défaut, et
        le remplaçait par un filet d'accent de 1 px — 2,88:1 sur la surface de
        Soleil, sous le 3:1 de 1.4.11/2.4.13. Dans une iframe que notre feuille
        de style n'atteint pas, le client ne voyait plus où il tapait son
        numéro. `--cf-focus` est le seul jeton de marque qu'un résolveur
        garantisse OPAQUE et ≥ 3:1 sur le fond comme sur la carte : il porte
        donc le filet ET l'anneau, comme `focus:border-focus` ailleurs.
      */
      ".Input:focus": {
        border: `1px solid ${focus}`,
        boxShadow: `0 0 0 2px ${focus}`,
      },
      ".Label": { color: vars["--cf-mut"] ?? "", fontWeight: "600" },
    },
  };
}

export function StripeCard(props: ComponentProps<typeof StripeCardSession>) {
  return <StripeCardSession key={`${props.publishableKey}:${props.stripeAccount}:${props.clientSecret}`} {...props} />;
}

function StripeCardSession({
  publishableKey,
  clientSecret,
  stripeAccount,
  amount,
  apparence,
  prixMono,
  /** URL de retour après authentification 3-D Secure (suivi de commande). */
  returnUrl,
  onPaid,
  disabled = false,
  onConfirmStart,
  onConfirmEnd,
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
  /**
   * Le masque, déjà résolu par la vitrine. Il arrive en propriété — et non
   * calculé ici — pour que sa référence soit stable : elle entre dans les
   * dépendances de l'effet de montage, un objet neuf à chaque rendu
   * démonterait et remonterait le champ de carte à chaque frappe.
   */
  apparence: ApparenceStripe;
  /** Paire typographique du masque qui pose les prix en chasse fixe. */
  prixMono: boolean;
  returnUrl: string;
  onPaid: () => void;
  /** Verrou partagé avec un changement de moyen sur la même commande. */
  disabled?: boolean;
  onConfirmStart?: () => boolean;
  onConfirmEnd?: (outcome: StripePaymentOutcome) => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const walletMountRef = useRef<HTMLDivElement>(null);
  const walletConfirmRef = useRef<((event: WalletConfirmEvent) => Promise<void>) | null>(null);
  const stripeRef = useRef<StripeInstance | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);
  const confirmingRef = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [walletAvailable, setWalletAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let element: StripeElement | null = null;
    let wallet: StripeElement | null = null;
    const destroy = (item: StripeElement | null) => { try { item?.destroy(); } catch { /* A failed SDK cleanup must not prevent the other element's cleanup. */ } };

    loadStripeJs()
      .then(() => {
        if (cancelled || !mountRef.current) return;
        const factory = window.Stripe;
        if (!factory) throw new Error("Stripe.js indisponible");
        const stripe = factory(publishableKey, { locale: "fr", stripeAccount });
        const elements = stripe.elements({ clientSecret, appearance: apparence });
        element = elements.create("payment", {
          layout: { type: "tabs", defaultCollapsed: false },
        });
        element.mount(mountRef.current);
        stripeRef.current = stripe;
        elementsRef.current = elements;
        // Both surfaces confirm the SAME admitted order and PaymentIntent on
        // the restaurant's Connect account. Stripe decides wallet support.
        if (walletMountRef.current) {
          try {
            wallet = elements.create("expressCheckout", {
              buttonHeight: 52,
              layout: { maxColumns: 2, maxRows: 1 },
            });
            wallet.on("ready", event => {
              if (!cancelled) setWalletAvailable(Object.values(event.availablePaymentMethods ?? {}).some(Boolean));
            });
            wallet.on("availablepaymentmethodschange", event => {
              if (!cancelled) setWalletAvailable(Object.values(event.paymentMethods ?? {}).some(method => method.available));
            });
            wallet.on("confirm", event => {
              if (!cancelled) void walletConfirmRef.current?.(event);
            });
            wallet.mount(walletMountRef.current);
          } catch {
            // A wallet is optional: the existing secure card form remains.
            destroy(wallet); wallet = null;
            setWalletAvailable(false);
          }
        }
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("failed");
      });

    return () => {
      cancelled = true;
      stripeRef.current = null;
      elementsRef.current = null;
      destroy(element); destroy(wallet);
    };
  }, [publishableKey, clientSecret, stripeAccount, apparence, attempt]);

  async function pay(wallet?: WalletConfirmEvent) {
    const failWallet = (message: string) => {
      try { wallet?.paymentFailed?.({ reason: "fail", message }); } catch { /* Preserve the local payment guard even if the native sheet has closed. */ }
    };
    const stripe = stripeRef.current;
    const elements = elementsRef.current;
    if (!alive.current || confirmingRef.current || paying) return;
    if (!stripe || !elements || disabled || processing || status !== "ready") {
      failWallet("Ce paiement n’est pas disponible. Consultez le suivi de votre commande."); return;
    }
    if (onConfirmStart && !onConfirmStart()) {
      failWallet("La commande doit être vérifiée avant de régler. Consultez son suivi."); return;
    }
    confirmingRef.current = true;
    let outcome: StripePaymentOutcome = "idle";
    setPaying(true);
    setError(null);
    try {
      if (wallet) {
        const submitted = await elements.submit();
        if (!alive.current || elementsRef.current !== elements) return;
        if (submitted.error) {
          const message = submitted.error.message ?? "Le portefeuille n’a pas pu être validé. Réessayez sur cette commande.";
          setError(message); failWallet(message);
          return;
        }
      }
      const result = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: returnUrl },
        // `if_required` évite un aller-retour de page quand le 3-DS n’est pas exigé.
        redirect: "if_required",
      });
      if (!alive.current || elementsRef.current !== elements) return;
      if (result.error) {
        const message = result.error.message ?? "La confirmation bancaire n’a pas été reçue. Consultez le suivi avant tout autre règlement.";
        setError(message); failWallet(message);
        return;
      }
      const state = result.paymentIntent?.status;
      if (state === "succeeded") {
        outcome = "paid";
        onPaid();
        return;
      }
      if (state === "processing") {
        outcome = "processing";
        setProcessing(true);
        return;
      }
      const message = "La confirmation bancaire n’a pas été reçue. Réessayez sur ce paiement ou consultez le suivi. Ne payez pas une deuxième fois.";
      setError(message); failWallet(message);
    } catch {
      if (!alive.current || elementsRef.current !== elements) return;
      const message = "La réponse bancaire n’a pas été reçue. Consultez le suivi ou réessayez sur ce paiement, sans régler une deuxième fois.";
      setError(message); failWallet(message);
    } finally {
      confirmingRef.current = false;
      if (alive.current) { setPaying(false); onConfirmEnd?.(outcome); }
    }
  }

  // Event listeners outlive renders; use the current authority/disabled guard.
  useEffect(() => { walletConfirmRef.current = event => pay(event); });

  if (status === "failed") {
    return (
      <div className="flex flex-col gap-3" inert={disabled || undefined}>
        <Banner tone="alert" icon="bell" title="Paiement en ligne indisponible">
          Le formulaire sécurisé n’a pas pu être chargé. Votre commande reste enregistrée. Réessayez ou consultez son suivi. Ne réglez pas par un autre moyen tant que le changement n’est pas confirmé.
        </Banner>
        <PrimaryAction icon="check" mono={prixMono} disabled={disabled} onClick={() => { setStatus("loading"); setAttempt((value) => value + 1); }}>
          Réessayer le paiement
        </PrimaryAction>
        <a href={returnUrl} className="flex min-h-11 items-center justify-center text-center text-[13px] font-semibold text-mut underline underline-offset-4 transition-colors duration-fast hover:text-ink">Suivre ma commande</a>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" inert={disabled || undefined}>
      {processing && <Banner tone="prep" icon="clock" title="Confirmation bancaire en cours">Ne payez pas une deuxième fois. <a href={returnUrl} className="font-bold underline underline-offset-4">Suivre la confirmation de votre commande</a>.</Banner>}
      <div aria-label="Paiement express" aria-hidden={!walletAvailable || undefined} inert={!walletAvailable || paying || processing || undefined} style={{ height: walletAvailable ? undefined : 0, overflow: "hidden" }}>
        <div ref={walletMountRef} />
        {walletAvailable && <p className="mt-3 text-center text-xs text-mut">ou payer par carte</p>}
      </div>
      <div className="rounded-card border border-ink/8 bg-surface2 p-3.5">
        {status === "loading" && (
          <p className="flex items-center gap-2.5 py-6 text-[14px] text-mut">
            <Spinner />
            Connexion au paiement sécurisé…
          </p>
        )}
        <div ref={mountRef} />
      </div>

      {error && (
        <Banner tone="alert" icon="bell" title="Paiement à vérifier">
          {error}
        </Banner>
      )}

      <PrimaryAction
        onClick={() => void pay()}
        disabled={disabled || status !== "ready" || processing}
        loading={paying}
        icon="check"
        amount={amount}
        mono={prixMono}
      >
        Payer
      </PrimaryAction>

      <a
        href={returnUrl}
        className="flex min-h-11 items-center justify-center text-center text-[13px] font-semibold text-mut underline underline-offset-4 transition-colors duration-fast hover:text-ink"
      >
        Suivre ma commande
      </a>

      <p className="text-center text-[12px] text-mut">
        Paiement chiffré par Stripe · Visa · Mastercard · CB
      </p>
    </div>
  );
}
