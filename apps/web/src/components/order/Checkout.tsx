"use client";

/**
 * Tunnel de commande — panier → coordonnées → créneau → paiement → confirmation.
 *
 * Un seul composant sert les trois portes d’entrée (site public, embed, widget) :
 * il vit dans une feuille plein écran, donc le même code marche dans une page et
 * dans une iframe. Aucun compte n’est demandé : un nom et un téléphone suffisent.
 *
 * Points de vigilance tenus ici :
 *  — aucun prix n’est envoyé à l’API, seulement des identifiants de produits ;
 *  — la clé d’idempotence (`clientId`) est stable sur toute une tentative :
 *    un double appui, un réseau qui bégaie ou un retour arrière ne créent
 *    jamais deux commandes ;
 *  — le paiement en ligne est facultatif : si Stripe n’est pas configuré, le
 *    parcours se termine par « à régler au comptoir » sans jamais se bloquer.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import type { PaymentIntentResponse, SlotsResponse } from "@sm/contracts";
import { cx } from "@/lib/cx";
import { Icon } from "@/components/ui";
import {
  createOrder,
  createPaymentIntent,
  isPaused,
  loadSlots,
  PublicApiError,
  type CreatedOrder,
} from "./api";
import {
  lineSummary,
  lineTotal,
  readCustomer,
  toOrderLines,
  writeCustomer,
  type CartApi,
  type CartLine,
  type Customer,
} from "./cart";
import { euros, hhmm, parisParts, phoneOk, uid } from "./helpers";
import {
  Banner,
  Dot,
  ErrorState,
  GhostAction,
  Money,
  OptionRow,
  PrimaryAction,
  SectionLabel,
  Sheet,
  Spinner,
  Stepper,
  Tap,
} from "./primitives";
import { StripeCard } from "./StripeCard";

type Step = "cart" | "customer" | "slot" | "pay" | "card" | "done";

/** Doit dépasser la durée d’animation de sortie de `Sheet`. */
const SHEET_EXIT_MS = 320;

const STEPS: { id: Step; label: string }[] = [
  { id: "cart", label: "Panier" },
  { id: "customer", label: "Vous" },
  { id: "slot", label: "Retrait" },
  { id: "pay", label: "Paiement" },
];

/** Mémoire de session : un tenant sans Stripe n’affiche plus l’option carte. */
const payKey = (slug: string) => `sm.pay.${slug}`;

function readPayProbe(slug: string): "ready" | "off" | "unknown" {
  try {
    const value = sessionStorage.getItem(payKey(slug));
    return value === "ready" || value === "off" ? value : "unknown";
  } catch {
    return "unknown";
  }
}

function writePayProbe(slug: string, value: "ready" | "off") {
  try {
    sessionStorage.setItem(payKey(slug), value);
  } catch {
    /* non bloquant */
  }
}

export function Checkout({
  open,
  slug,
  tenantName,
  accent,
  cart,
  paused,
  pauseMessage,
  initialSlots,
  embed = false,
  onClose,
  onBrowse,
  onEditLine,
}: {
  open: boolean;
  slug: string;
  tenantName: string;
  accent: string;
  cart: CartApi;
  paused: boolean;
  pauseMessage: string | null;
  /** Créneaux déjà connus (rendus avec la page) — évite une attente à l’ouverture. */
  initialSlots: SlotsResponse | null;
  embed?: boolean;
  onClose: () => void;
  /** « Voir la carte » depuis un panier vide. */
  onBrowse: () => void;
  onEditLine: (line: CartLine) => void;
}) {
  const [step, setStep] = useState<Step>("cart");
  const [customer, setCustomer] = useState<Customer>({ name: "", phone: "" });
  const [touched, setTouched] = useState(false);

  const [date, setDate] = useState<string | null>(null);
  const [slots, setSlots] = useState<SlotsResponse | null>(initialSlots);
  const [slotsState, setSlotsState] = useState<"idle" | "loading" | "error">("idle");
  const [slotIso, setSlotIso] = useState<string | null>(null);

  const [wanted, setWanted] = useState<"online" | "counter">("online");
  const [probe, setProbe] = useState<"ready" | "off" | "unknown">("unknown");
  const [intent, setIntent] = useState<PaymentIntentResponse | null>(null);

  const [order, setOrder] = useState<CreatedOrder | null>(null);
  const [paidOnline, setPaidOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downgraded, setDowngraded] = useState(false);

  // Clé d’idempotence : forgée au premier envoi, conservée pendant tous les
  // réessais de la même tentative — un double appui ne crée jamais deux
  // commandes. Elle n’est renouvelée qu’après une commande réellement passée.
  const clientIdRef = useRef<string | null>(null);

  // ── Coordonnées et disponibilité du paiement, relues à l’ouverture ──
  useEffect(() => {
    if (!open) return;
    setCustomer((prev) => (prev.name || prev.phone ? prev : readCustomer()));
    setProbe(readPayProbe(slug));
  }, [open, slug]);

  // Un tenant sans paiement en ligne n’a qu’un mode : le comptoir.
  const method: "online" | "counter" = probe === "off" ? "counter" : wanted;

  // ── Créneaux : toujours rechargés à l’entrée de l’étape (capacité vivante) ──
  const fetchSlots = useCallback(
    (target: string | null, signal?: AbortSignal) => {
      setSlotsState("loading");
      loadSlots(slug, target ?? undefined, signal)
        .then((res) => {
          if (signal?.aborted) return;
          setSlots(res);
          setSlotsState("idle");
          setSlotIso((prev) =>
            prev && res.slots.some((s) => s.iso === prev && !s.full) ? prev : null,
          );
        })
        .catch(() => {
          if (!signal?.aborted) setSlotsState("error");
        });
    },
    [slug],
  );

  useEffect(() => {
    if (!open || step !== "slot") return;
    const controller = new AbortController();
    fetchSlots(date, controller.signal);
    return () => controller.abort();
  }, [open, step, date, fetchSlots]);

  const nameOk = customer.name.trim().length >= 2;
  const contactOk = nameOk && phoneOk(customer.phone);
  const blockedByPause = paused;

  const chosenSlot = useMemo(
    () => slots?.slots.find((s) => s.iso === slotIso) ?? null,
    [slots, slotIso],
  );

  /**
   * Referme le tunnel puis le remet à zéro — le nettoyage attend la fin de
   * l’animation de sortie, sinon l’écran de confirmation clignoterait en
   * « panier vide » sous les yeux du client au moment où il ferme.
   */
  function closeTunnel() {
    onClose();
    window.setTimeout(resetTunnel, SHEET_EXIT_MS);
  }

  function resetTunnel() {
    setStep("cart");
    setOrder(null);
    setIntent(null);
    setPaidOnline(false);
    setDowngraded(false);
    setError(null);
    setSlotIso(null);
    setDate(null);
    clientIdRef.current = null;
  }

  // ── Passage de commande ──
  async function submit(chosenMethod: "online" | "counter") {
    if (busy || !slotIso || !contactOk || cart.lines.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      writeCustomer(customer);
      clientIdRef.current ??= uid();
      const created = await createOrder(slug, {
        clientId: clientIdRef.current,
        channel: "online",
        type: "pickup",
        lines: toOrderLines(cart.lines),
        payment: { method: chosenMethod },
        pickup: {
          slot: slotIso,
          customerName: customer.name.trim(),
          customerPhone: customer.phone.trim(),
        },
        ...(cart.note.trim() ? { note: cart.note.trim() } : {}),
      });

      if (isPaused(created)) {
        setError(
          created.message ??
            "La commande en ligne vient d’être suspendue par le restaurant.",
        );
        return;
      }

      setOrder(created);
      cart.clear(); // la commande existe : le panier ne doit plus pouvoir repartir
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate(60);
      }

      if (chosenMethod === "counter") {
        setStep("done");
        return;
      }

      const res = await createPaymentIntent(created._id);
      if (res.unavailable || !res.publishableKey) {
        writePayProbe(slug, "off");
        setProbe("off");
        setDowngraded(true);
        setStep("done");
        return;
      }
      writePayProbe(slug, "ready");
      setProbe("ready");
      setIntent(res);
      setStep("card");
    } catch (err) {
      setError(
        err instanceof PublicApiError
          ? err.message
          : "La commande n’a pas pu être envoyée. Vérifiez votre connexion.",
      );
    } finally {
      setBusy(false);
    }
  }

  const stepIndex = Math.max(
    0,
    STEPS.findIndex((s) => s.id === step),
  );
  const finished = step === "done" || step === "card";

  const titles: Record<Step, string> = {
    cart: "Votre commande",
    customer: "Vos coordonnées",
    slot: "Créneau de retrait",
    pay: "Paiement",
    card: "Paiement par carte",
    done: "Commande confirmée",
  };

  const back: Partial<Record<Step, Step>> = {
    customer: "cart",
    slot: "customer",
    pay: "slot",
  };

  return (
    <Sheet
      open={open}
      onClose={closeTunnel}
      maxHeight="100%"
      fill
      title={titles[step]}
      headerExtra={
        !finished ? (
          <Progress index={stepIndex} onJump={(target) => setStep(target)} step={step} />
        ) : null
      }
      footer={
        <Footer
          step={step}
          busy={busy}
          cart={cart}
          contactOk={contactOk}
          slotIso={slotIso}
          blocked={blockedByPause}
          method={method}
          order={order}
          embed={embed}
          onNext={(next) => {
            if (next === "customer") setTouched(false);
            setStep(next);
          }}
          onSubmit={() => submit(method)}
          onFinish={closeTunnel}
        />
      }
    >
      <div className="px-4 pb-6 pt-4">
        {back[step] && (
          <Tap
            onClick={() => setStep(back[step]!)}
            className="mb-3 inline-flex items-center gap-1.5 rounded-pill border border-white/8 bg-surface2 py-1.5 pl-2 pr-3.5 text-[13px] font-bold text-mut hover:text-ink"
          >
            <Icon name="back" size={14} />
            Retour
          </Tap>
        )}

        {blockedByPause && step !== "done" && (
          <div className="mb-4">
            <Banner tone="prep" icon="clock" title="Commande en ligne suspendue">
              {pauseMessage ??
                "Victimes de notre succès — la commande en ligne rouvre très vite. La carte reste consultable."}
            </Banner>
          </div>
        )}

        {error && step !== "done" && (
          <div className="mb-4">
            <Banner tone="alert" icon="bell" title="Commande non envoyée">
              {error}
            </Banner>
          </div>
        )}

        {step === "cart" && (
          <CartStep cart={cart} onBrowse={onBrowse} onEditLine={onEditLine} />
        )}

        {step === "customer" && (
          <CustomerStep
            customer={customer}
            onChange={setCustomer}
            touched={touched}
            onBlur={() => setTouched(true)}
            tenantName={tenantName}
          />
        )}

        {step === "slot" && (
          <SlotStep
            slots={slots}
            state={slotsState}
            selected={slotIso}
            onSelect={setSlotIso}
            onDate={setDate}
            onRetry={() => fetchSlots(date)}
          />
        )}

        {step === "pay" && (
          <PayStep
            cart={cart}
            customer={customer}
            slotLabel={chosenSlot ? hhmm(chosenSlot.iso) : null}
            slotDate={slots?.date ?? null}
            method={method}
            onMethod={setWanted}
            cardAvailable={probe !== "off"}
          />
        )}

        {step === "card" && intent && !intent.unavailable && intent.publishableKey && (
          <StripeCard
            publishableKey={intent.publishableKey}
            clientSecret={intent.clientSecret}
            amount={intent.amount}
            accent={accent}
            returnUrl={
              typeof window === "undefined" || !order
                ? ""
                : `${window.location.origin}/t/${order._id}?t=${encodeURIComponent(order.trackingToken)}`
            }
            onPaid={() => {
              setPaidOnline(true);
              setStep("done");
            }}
            onGiveUp={() => setStep("done")}
          />
        )}

        {step === "done" && order && (
          <DoneStep
            order={order}
            paidOnline={paidOnline}
            downgraded={downgraded}
            tenantName={tenantName}
          />
        )}
      </div>
    </Sheet>
  );
}

// ─────────────────────────────────────────────────────────────
// Fil d’étapes
// ─────────────────────────────────────────────────────────────

function Progress({
  index,
  step,
  onJump,
}: {
  index: number;
  step: Step;
  onJump: (target: Step) => void;
}) {
  return (
    <ol className="mt-2 flex items-center gap-1.5">
      {STEPS.map((entry, i) => {
        const done = i < index;
        const current = entry.id === step;
        return (
          <li key={entry.id} className="flex flex-1 items-center gap-1.5">
            <button
              type="button"
              disabled={!done}
              onClick={() => onJump(entry.id)}
              aria-current={current ? "step" : undefined}
              className={cx(
                "h-1 flex-1 rounded-full transition-colors duration-200 ease-sm",
                current || done ? "bg-accent" : "bg-white/12",
                done && "cursor-pointer",
              )}
            >
              <span className="sr-only">
                {entry.label}
                {done ? " — terminé, revenir" : current ? " — étape en cours" : ""}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

// ─────────────────────────────────────────────────────────────
// Pied du tunnel
// ─────────────────────────────────────────────────────────────

function Footer({
  step,
  busy,
  cart,
  contactOk,
  slotIso,
  blocked,
  method,
  order,
  embed,
  onNext,
  onSubmit,
  onFinish,
}: {
  step: Step;
  busy: boolean;
  cart: CartApi;
  contactOk: boolean;
  slotIso: string | null;
  blocked: boolean;
  method: "online" | "counter";
  order: CreatedOrder | null;
  embed: boolean;
  onNext: (next: Step) => void;
  onSubmit: () => void;
  onFinish: () => void;
}) {
  if (step === "card") return null;

  if (step === "done") {
    return (
      <div className="flex flex-col gap-2.5">
        {order && (
          <Link
            href={`/t/${order._id}?t=${encodeURIComponent(order.trackingToken)}`}
            target={embed ? "_blank" : undefined}
            rel={embed ? "noopener noreferrer" : undefined}
            className="flex w-full items-center justify-center gap-2 rounded-pill bg-accent px-5 py-[15px] text-[15px] font-extrabold text-onaccent transition-transform duration-200 ease-sm active:duration-75 active:scale-[0.97]"
          >
            <Icon name="clock" size={17} stroke={2.4} />
            Suivre ma commande
          </Link>
        )}
        <GhostAction onClick={onFinish}>Fermer</GhostAction>
      </div>
    );
  }

  if (step === "cart") {
    const empty = cart.lines.length === 0;
    return (
      <PrimaryAction
        disabled={empty || blocked}
        amount={empty ? undefined : cart.subtotal}
        icon="arrow"
        onClick={() => onNext("customer")}
      >
        {empty ? "Votre panier est vide" : "Continuer"}
      </PrimaryAction>
    );
  }

  if (step === "customer") {
    return (
      <PrimaryAction
        disabled={!contactOk || blocked}
        icon="arrow"
        onClick={() => onNext("slot")}
      >
        {contactOk ? "Choisir le créneau" : "Nom et téléphone requis"}
      </PrimaryAction>
    );
  }

  if (step === "slot") {
    return (
      <PrimaryAction
        disabled={!slotIso || blocked}
        icon="arrow"
        onClick={() => onNext("pay")}
      >
        {slotIso ? "Continuer" : "Choisissez un créneau"}
      </PrimaryAction>
    );
  }

  return (
    <PrimaryAction
      disabled={blocked || !slotIso || !contactOk}
      loading={busy}
      amount={cart.subtotal}
      icon={method === "online" ? "euro" : "check"}
      onClick={onSubmit}
    >
      {method === "online" ? "Payer" : "Confirmer la commande"}
    </PrimaryAction>
  );
}

// ─────────────────────────────────────────────────────────────
// Étape 1 — panier
// ─────────────────────────────────────────────────────────────

function CartStep({
  cart,
  onBrowse,
  onEditLine,
}: {
  cart: CartApi;
  onBrowse: () => void;
  onEditLine: (line: CartLine) => void;
}) {
  if (!cart.hydrated) {
    return (
      <div className="flex items-center gap-2.5 py-10 text-[14px] text-mut">
        <Spinner />
        Chargement du panier…
      </div>
    );
  }

  if (cart.lines.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
        <span className="grid size-12 place-items-center rounded-panel bg-surface2 text-mut">
          <Icon name="cart" size={22} />
        </span>
        <p className="text-[16px] font-bold text-ink">Votre panier est vide</p>
        <p className="max-w-[260px] text-[13px] leading-relaxed text-mut">
          Ajoutez un plat depuis la carte, il n’y a pas de compte à créer.
        </p>
        <div className="mt-1 w-full max-w-[220px]">
          <GhostAction icon="grid" onClick={onBrowse}>
            Voir la carte
          </GhostAction>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2.5">
        {cart.lines.map((line) => (
          <div
            key={line.lineId}
            className="rounded-panel border border-white/6 bg-surface bg-[linear-gradient(180deg,rgba(255,255,255,0.035),transparent_80px)] p-3.5 shadow-card"
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-bold text-ink">{line.name}</p>
                {lineSummary(line) && (
                  <p className="mt-0.5 text-[13px] leading-snug text-mut">
                    {lineSummary(line)}
                  </p>
                )}
                {line.note && (
                  <p className="mt-1 text-[13px] italic text-prept">« {line.note} »</p>
                )}
              </div>
              <Money cents={lineTotal(line)} className="shrink-0 text-[16px] text-ink" />
            </div>

            <div className="mt-3 flex items-center justify-between gap-2">
              <Stepper
                value={line.qty}
                min={0}
                label={line.name}
                onChange={(qty) => cart.setQty(line.lineId, qty)}
              />
              <div className="flex items-center gap-1.5">
                <Tap
                  onClick={() => onEditLine(line)}
                  className="rounded-pill border border-white/10 px-3 py-1.5 text-[13px] font-bold text-mut hover:text-ink"
                >
                  Modifier
                </Tap>
                <Tap
                  onClick={() => cart.remove(line.lineId)}
                  aria-label={`Retirer ${line.name}`}
                  className="grid size-8 place-items-center rounded-pill text-mut hover:text-alertt"
                >
                  <Icon name="trash" size={16} />
                </Tap>
              </div>
            </div>
          </div>
        ))}
      </div>

      <section className="flex flex-col gap-2">
        <SectionLabel hint="facultatif">Instructions pour la cuisine</SectionLabel>
        <textarea
          value={cart.note}
          onChange={(e) => cart.setNote(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="Ex : sans oignons sur tout, sauces à part…"
          className="w-full resize-none rounded-card border border-white/8 bg-white/5 px-3.5 py-3 text-[15px] text-ink outline-none transition-colors duration-200 ease-sm placeholder:text-mut/70 focus:border-accent"
        />
      </section>

      <div className="flex items-center justify-between border-t border-white/8 pt-4">
        <span className="text-[15px] font-semibold text-mut">Total</span>
        <Money cents={cart.subtotal} className="text-[24px] text-ink" />
      </div>
      <p className="-mt-3 text-[12px] text-mut">
        Prix TTC. Le montant est recalculé par le restaurant à la validation.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Étape 2 — coordonnées
// ─────────────────────────────────────────────────────────────

function CustomerStep({
  customer,
  onChange,
  touched,
  onBlur,
  tenantName,
}: {
  customer: Customer;
  onChange: (next: Customer) => void;
  touched: boolean;
  onBlur: () => void;
  tenantName: string;
}) {
  const nameError = touched && customer.name.trim().length < 2;
  const phoneError = touched && !phoneOk(customer.phone);
  const field =
    "w-full rounded-card border bg-white/5 px-3.5 py-3.5 text-[16px] text-ink outline-none transition-colors duration-200 ease-sm placeholder:text-mut/70";

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[14px] leading-relaxed text-mut">
        Pas de compte à créer. {tenantName} a juste besoin de savoir à qui remettre
        la commande, et comment vous prévenir quand elle est prête.
      </p>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="sm-name"
          className="text-[11px] font-bold uppercase tracking-[0.14em] text-mut"
        >
          Prénom et nom
        </label>
        <input
          id="sm-name"
          value={customer.name}
          onChange={(e) => onChange({ ...customer, name: e.target.value })}
          onBlur={onBlur}
          autoComplete="name"
          enterKeyHint="next"
          placeholder="Camille Durand"
          aria-invalid={nameError || undefined}
          aria-describedby={nameError ? "sm-name-err" : undefined}
          className={cx(field, nameError ? "border-alert" : "border-white/8 focus:border-accent")}
        />
        {nameError && (
          <p id="sm-name-err" role="alert" className="text-[13px] text-alertt">
            Indiquez au moins deux caractères.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="sm-phone"
          className="text-[11px] font-bold uppercase tracking-[0.14em] text-mut"
        >
          Téléphone
        </label>
        <input
          id="sm-phone"
          value={customer.phone}
          onChange={(e) => onChange({ ...customer, phone: e.target.value })}
          onBlur={onBlur}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          enterKeyHint="done"
          placeholder="06 12 34 56 78"
          aria-invalid={phoneError || undefined}
          aria-describedby={phoneError ? "sm-phone-err" : "sm-phone-hint"}
          className={cx(field, phoneError ? "border-alert" : "border-white/8 focus:border-accent")}
        />
        {phoneError ? (
          <p id="sm-phone-err" role="alert" className="text-[13px] text-alertt">
            Un numéro d’au moins 8 chiffres est nécessaire.
          </p>
        ) : (
          <p id="sm-phone-hint" className="text-[13px] text-mut">
            Uniquement pour vous prévenir que la commande est prête.
          </p>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Étape 3 — créneau
// ─────────────────────────────────────────────────────────────

const SERVICE_LABELS: Record<string, string> = { lunch: "Midi", dinner: "Soir" };

/** « Aujourd’hui » · « Demain » · « Mar. 25 août ». */
function dayLabelOf(ymd: string): string {
  const today = parisParts().ymd;
  if (ymd === today) return "Aujourd’hui";
  const at = new Date(`${ymd}T12:00:00Z`);
  const tomorrow = new Date(`${today}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (at.getTime() === tomorrow.getTime()) return "Demain";
  const label = at.toLocaleDateString("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function SlotStep({
  slots,
  state,
  selected,
  onSelect,
  onDate,
  onRetry,
}: {
  slots: SlotsResponse | null;
  state: "idle" | "loading" | "error";
  selected: string | null;
  onSelect: (iso: string) => void;
  onDate: (ymd: string) => void;
  onRetry: () => void;
}) {
  if (state === "error") {
    return (
      <ErrorState
        title="Créneaux indisponibles"
        message="Impossible de récupérer les horaires de retrait pour le moment."
        onRetry={onRetry}
      />
    );
  }

  if (state === "loading" && !slots) {
    return (
      <div className="flex items-center gap-2.5 py-10 text-[14px] text-mut">
        <Spinner />
        Recherche des créneaux disponibles…
      </div>
    );
  }

  if (!slots) return null;

  const byService = new Map<string, typeof slots.slots>();
  for (const slot of slots.slots) {
    byService.set(slot.service, [...(byService.get(slot.service) ?? []), slot]);
  }

  const dates = [slots.date, ...(slots.nextOpenDate ? [slots.nextOpenDate] : [])];

  return (
    <div className={cx("flex flex-col gap-5", state === "loading" && "opacity-60")}>
      {dates.length > 1 && (
        <div className="flex gap-2">
          {dates.map((ymd) => (
            <Tap
              key={ymd}
              onClick={() => onDate(ymd)}
              aria-pressed={ymd === slots.date}
              className={cx(
                "flex-1 rounded-card border px-3 py-2.5 text-[14px] font-bold",
                ymd === slots.date
                  ? "border-accent bg-[color-mix(in_srgb,var(--cf-accent)_18%,transparent)] text-ink"
                  : "border-white/8 bg-surface2 text-mut hover:text-ink",
              )}
            >
              {dayLabelOf(ymd)}
            </Tap>
          ))}
        </div>
      )}

      {slots.paused && (
        <Banner tone="prep" icon="clock" title="Commande en ligne suspendue">
          Le restaurant a mis les commandes en pause. Réessayez d’ici quelques
          minutes.
        </Banner>
      )}

      {slots.closedToday ? (
        <Banner
          tone="prep"
          icon="clock"
          title={
            slots.closureReason
              ? `Fermé — ${slots.closureReason}`
              : "Aucun créneau ce jour-là"
          }
        >
          {slots.nextOpenDate
            ? `Prochaine ouverture : ${dayLabelOf(slots.nextOpenDate).toLowerCase()}.`
            : "Aucune ouverture prévue dans les prochains jours."}
        </Banner>
      ) : (
        <>
          <p className="text-[14px] leading-relaxed text-mut">
            Comptez au moins {slots.leadTimeMin} minutes de préparation. Le
            restaurant lance votre commande pour l’heure choisie.
          </p>

          {[...byService.entries()].map(([service, list]) => (
            <section key={service} className="flex flex-col gap-2.5">
              <SectionLabel
                hint={`${list.filter((s) => !s.full).length} libres`}
              >
                {SERVICE_LABELS[service] ?? service}
              </SectionLabel>
              <div className="grid grid-cols-4 gap-2">
                {list.map((slot) => {
                  const on = slot.iso === selected;
                  return (
                    <Tap
                      key={slot.iso}
                      onClick={() => onSelect(slot.iso)}
                      disabled={slot.full}
                      aria-pressed={on}
                      aria-label={`${hhmm(slot.iso)}${slot.full ? " — complet" : slot.load === "busy" ? " — créneau chargé" : ""}`}
                      className={cx(
                        "flex flex-col items-center gap-1 rounded-card border py-2.5",
                        on
                          ? "border-accent bg-[color-mix(in_srgb,var(--cf-accent)_20%,transparent)]"
                          : "border-white/8 bg-surface2 hover:border-white/25",
                        slot.full && "cursor-not-allowed opacity-30 active:scale-100",
                      )}
                    >
                      <span className="text-[15px] font-extrabold tabular-nums tracking-[-0.02em] text-ink">
                        {hhmm(slot.iso)}
                      </span>
                      <Dot
                        tone={slot.full ? "mut" : slot.load === "busy" ? "prep" : "ok"}
                      />
                    </Tap>
                  );
                })}
              </div>
            </section>
          ))}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-mut">
            <span className="inline-flex items-center gap-1.5">
              <Dot tone="ok" /> Tranquille
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Dot tone="prep" /> Créneau chargé
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Dot tone="mut" /> Complet
            </span>
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Étape 4 — paiement
// ─────────────────────────────────────────────────────────────

function PayStep({
  cart,
  customer,
  slotLabel,
  slotDate,
  method,
  onMethod,
  cardAvailable,
}: {
  cart: CartApi;
  customer: Customer;
  slotLabel: string | null;
  slotDate: string | null;
  method: "online" | "counter";
  onMethod: (next: "online" | "counter") => void;
  cardAvailable: boolean;
}) {
  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-panel border border-white/6 bg-surface2 p-4">
        <SectionLabel className="mb-3">Récapitulatif</SectionLabel>
        <dl className="flex flex-col gap-2 text-[14px]">
          <Row label="Retrait">
            <span className="font-bold text-ink">
              {slotDate ? `${dayLabelOf(slotDate)} · ` : ""}
              <span className="tabular-nums">{slotLabel ?? "—"}</span>
            </span>
          </Row>
          <Row label="Au nom de">
            <span className="font-semibold text-ink">{customer.name.trim()}</span>
          </Row>
          <Row label="Articles">
            <span className="font-semibold tabular-nums text-ink">{cart.count}</span>
          </Row>
        </dl>
        <div className="mt-3 flex items-center justify-between border-t border-white/8 pt-3">
          <span className="text-[15px] font-semibold text-mut">Total à régler</span>
          <Money cents={cart.subtotal} className="text-[22px] text-ink" />
        </div>
      </section>

      <section className="flex flex-col gap-2.5">
        <SectionLabel>Mode de paiement</SectionLabel>
        {cardAvailable ? (
          <div
            role="radiogroup"
            aria-label="Mode de paiement"
            className="rounded-card border border-white/8 bg-white/[0.02] px-3.5"
          >
            <OptionRow
              radio
              on={method === "online"}
              title="Carte bancaire"
              sub="Paiement sécurisé en ligne"
              onClick={() => onMethod("online")}
            />
            <OptionRow
              radio
              on={method === "counter"}
              title="Payer au comptoir"
              sub="Carte ou espèces sur place"
              onClick={() => onMethod("counter")}
            />
          </div>
        ) : (
          <Banner icon="euro" title="Paiement au comptoir">
            Ce restaurant encaisse au moment du retrait — carte ou espèces.
          </Banner>
        )}
      </section>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-mut">{label}</dt>
      <dd className="min-w-0 truncate text-right">{children}</dd>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Étape 5 — confirmation
// ─────────────────────────────────────────────────────────────

function DoneStep({
  order,
  paidOnline,
  downgraded,
  tenantName,
}: {
  order: CreatedOrder;
  paidOnline: boolean;
  downgraded: boolean;
  tenantName: string;
}) {
  return (
    <div className="flex flex-col items-center gap-5 pt-2 text-center">
      <span className="grid size-16 animate-pop place-items-center rounded-full bg-ok/15 text-ok">
        <Icon name="check" size={30} stroke={2.6} />
      </span>

      <div>
        <h3 className="text-[22px] font-extrabold tracking-[-0.03em] text-ink">
          C’est envoyé en cuisine
        </h3>
        <p className="mt-1 text-[14px] text-mut">
          {tenantName} vous prévient par SMS dès que c’est prêt.
        </p>
      </div>

      <div className="w-full rounded-panel border border-white/8 bg-surface2 px-5 py-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-mut">
          Numéro de retrait
        </p>
        <p className="mt-1 text-[64px] font-black leading-none tracking-[-0.04em] tabular-nums text-accent">
          {order.number}
        </p>
        {order.pickup?.slot && (
          <p className="mt-2 text-[14px] text-mut">
            Retrait à{" "}
            <span className="font-bold tabular-nums text-ink">
              {hhmm(order.pickup.slot)}
            </span>
          </p>
        )}
      </div>

      <div className="w-full">
        {downgraded ? (
          <Banner tone="prep" icon="euro" title="À régler au comptoir">
            Le paiement en ligne n’était pas disponible. Votre commande est bien
            enregistrée : réglez sur place au moment du retrait.
          </Banner>
        ) : paidOnline ? (
          <Banner tone="ok" icon="check" title="Paiement accepté">
            {euros(order.totals?.total ?? 0)} réglés en ligne. Présentez votre
            numéro de retrait au comptoir.
          </Banner>
        ) : (
          <Banner icon="euro" title="À régler au comptoir">
            {euros(order.totals?.total ?? 0)} à régler au moment du retrait.
          </Banner>
        )}
      </div>
    </div>
  );
}
