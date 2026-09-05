"use client";

/**
 * Tunnel de commande — panier → coordonnées → créneau → paiement → confirmation.
 *
 * Un seul composant sert les trois portes d’entrée (site public, embed, widget) :
 * il vit dans une feuille plein écran, donc le même code marche dans une page et
 * dans une iframe. Aucun compte n’est demandé : un nom et un téléphone suffisent.
 *
 * Forme reprise de la maquette (`docs/specs/commande-en-ligne.md` §5.4 à §5.7) :
 * une étape = un titre, un retour, un pied d’écran qui porte l’action et le
 * montant. La progression est nommée, pas seulement dessinée.
 *
 * Points de vigilance tenus ici :
 *  — aucun prix n’est envoyé à l’API, seulement des identifiants de produits ;
 *  — la clé d’idempotence (`clientId`) est stable sur toute une tentative :
 *    un double appui, un réseau qui bégaie ou un retour arrière ne créent
 *    jamais deux commandes ;
 *  — le retrait peut être réglé au comptoir si ce choix précède le paiement
 *    en ligne ; après une demande bancaire, toute reprise garde la même commande.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import type {
  BrandMode,
  OrderStatus,
  PaymentIntentResponse,
  SlotsResponse,
  PublicDeliverySettings,
  DeliveryAddress,
  DeliveryQuote,
  Fulfillment,
} from "@sm/contracts";
import { DeliveryAddressSchema } from "@sm/contracts";
import { cx } from "@/lib/cx";
import { Icon } from "@/components/ui";
import {
  isPaused,
  networkApi,
  PublicApiError,
  type CreatedOrder,
  type OrderingApi,
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
import { FideliteApresCommande } from "./FideliteVitrine";
import type { VitrineFidelite } from "./fidelite";
import { jalonFunnel } from "./funnel";
import { hhmm, parisParts, phoneOk, uid } from "./helpers";
import {
  Badge,
  Banner,
  ChoiceCard,
  Dot,
  ErrorState,
  GhostAction,
  Glyph,
  Money,
  Plate,
  PrimaryAction,
  Prix,
  RadioGroup,
  SectionLabel,
  Sheet,
  Spinner,
  Stepper,
  Tap,
} from "./primitives";
import { StripeCard, type ApparenceStripe } from "./StripeCard";
import { TurnstileCheck } from "./TurnstileCheck";
import { DeliveryFee, DeliveryFields, FreeDeliveryHint } from "./DeliveryFields";
import { PAYMENT_VERIFICATION_MESSAGE, checkoutPaymentDecision, requestExistingOrderPayment } from "./checkout-payment";

type Step = "cart" | "customer" | "slot" | "pay" | "card" | "done";

/**
 * Doit dépasser la durée d’animation de sortie de `Sheet`, qui vaut
 * `--sm-t-med` — donc 200 ms sous un masque « vif » et 320 ms sous un masque
 * « posé », les deux seuls profils de mouvement du contrat. 340 ms couvre le
 * plus lent : le panier ne se vide pas sous les yeux du client qui referme.
 */
const SHEET_EXIT_MS = 340;
const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";
const TURNSTILE_SITE_KEY =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ??
  (process.env.NODE_ENV === "production" ? "" : TURNSTILE_TEST_SITE_KEY);

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

export type CheckoutDeliveryQuoteState =
  | { status: "pending"; key: string; requestId: number }
  | { status: "ready"; key: string; requestId: number; value: DeliveryQuote }
  | { status: "error"; key: string; requestId: number; message: string }
  | null;

export type CheckoutDeliveryQuoteAction =
  | { type: "invalidate" }
  | { type: "start"; key: string; requestId: number }
  | { type: "resolve"; key: string; requestId: number; value: DeliveryQuote }
  | { type: "reject"; key: string; requestId: number; message: string };

/** Une réponse tardive ne remplace ni un devis plus récent ni une invalidation. */
export function checkoutDeliveryQuoteReducer(
  state: CheckoutDeliveryQuoteState,
  action: CheckoutDeliveryQuoteAction,
): CheckoutDeliveryQuoteState {
  if (action.type === "invalidate") return null;
  if (action.type === "start") return { status: "pending", key: action.key, requestId: action.requestId };
  if (state?.status !== "pending" || state.requestId !== action.requestId || state.key !== action.key) return state;
  return action.type === "resolve"
    ? { status: "ready", key: action.key, requestId: action.requestId, value: action.value }
    : { status: "error", key: action.key, requestId: action.requestId, message: action.message };
}

export function checkoutDeliveryQuoteKey(input: {
  slug: string; fulfillment: Fulfillment; address: DeliveryAddress; lines: CartLine[]; promoCode: string;
}): string {
  return JSON.stringify({
    slug: input.slug, fulfillment: input.fulfillment, address: input.address,
    lines: toOrderLines(input.lines), promoCode: input.promoCode.trim().toUpperCase(),
    // Même sélection mais prix catalogue rafraîchi : l'ancienne proposition
    // ne correspond plus non plus à ce que le client voit dans son panier.
    previewPrices: input.lines.map(line => line.unitPrice),
  });
}

/** Un devis n'est une proposition de prix que pour les entrées qui l'ont demandé. */
export function activeCheckoutDeliveryQuote(
  state: CheckoutDeliveryQuoteState,
  enabled: boolean,
  key: string,
): DeliveryQuote | null {
  return enabled && state?.key === key && state.status === "ready" ? state.value : null;
}

export function Checkout({
  open,
  slug,
  tenantName,
  tenantAddress,
  stripeApparence,
  mode,
  prixMono,
  cart,
  paused,
  pauseMessage,
  initialSlots,
  delivery,
  embed = false,
  loyalty = null,
  api = networkApi,
  demo = false,
  onClose,
  onBrowse,
  onEditLine,
}: {
  open: boolean;
  slug: string;
  tenantName: string;
  /** Adresse affichée sur la carte « où retirer » de l’étape créneau. */
  tenantAddress: string;
  /**
   * Le masque résolu pour le champ de carte Stripe. Il vient d'en haut plutôt
   * que d'ici : la référence doit rester stable, sinon le Payment Element se
   * remonte à chaque rendu du tunnel.
   */
  stripeApparence: ApparenceStripe;
  /**
   * Mode du masque. Il ne sert pas à peindre — les `--cf-*` s'en chargent —
   * mais à habiller les widgets TIERS rendus dans leur propre iframe, que
   * notre feuille de style n'atteint pas : ici le contrôle anti-robot.
   */
  mode: BrandMode;
  /** Paire typographique du masque qui pose les prix en chasse fixe. */
  prixMono: boolean;
  cart: CartApi;
  paused: boolean;
  pauseMessage: string | null;
  /** Créneaux déjà connus (rendus avec la page) — évite une attente à l’ouverture. */
  initialSlots: SlotsResponse | null;
  delivery?: PublicDeliverySettings;
  embed?: boolean;
  /**
   * Le programme de fidélité du restaurant, résumé — `null` s’il n’en a pas.
   * Il n’est lu qu’à la CONFIRMATION : le tunnel appartient à la commande, et
   * rien n’a à s’intercaler entre le panier et le paiement.
   */
  loyalty?: VitrineFidelite | null;
  /** Client des routes publiques — le réseau partout, sauf en démonstration. */
  api?: OrderingApi;
  /**
   * Démonstration de la vitrine.
   *
   * Change trois choses, et rien d’autre : le paiement par carte est
   * ENCAISSÉ SUR PLACE dans la fiction (aucun appel à Stripe, jamais), la
   * confirmation suit l’avancement en cuisine sans quitter le tunnel — la page
   * de suivi vit dans un autre document, et la mémoire de la démonstration ne
   * la suivrait pas —, et l’écran final dit ce qui vient de se passer pour de
   * faux.
   */
  demo?: boolean;
  onClose: () => void;
  /** « Voir la carte » depuis un panier vide. */
  onBrowse: () => void;
  onEditLine: (line: CartLine) => void;
}) {
  const [step, setStep] = useState<Step>("cart");
  const [customer, setCustomer] = useState<Customer>({ name: "", phone: "" });
  const [touched, setTouched] = useState(false);
  const [fulfillment, setFulfillment] = useState<Fulfillment>("pickup");
  const [address, setAddress] = useState<DeliveryAddress>({ line1: "", line2: "", postalCode: "", city: "", country: "FR" });
  const [deliveryInstructions, setDeliveryInstructions] = useState("");
  // Le code part avec le devis ET la commande. Seul le serveur calcule la
  // remise ; le devis ne réserve ni le quota promotionnel ni le prix final.
  const [promoCode, setPromoCode] = useState("");
  const normalizedPromoCode = promoCode.trim().toUpperCase();
  const [quoteState, dispatchQuote] = useReducer(checkoutDeliveryQuoteReducer, null);
  const quoteSequence = useRef(0);
  const isDelivery = fulfillment === "delivery";
  const quoteEnabled = isDelivery && Boolean(delivery?.available) && !demo;
  const quoteKey = checkoutDeliveryQuoteKey({ slug, fulfillment, address, lines: cart.lines, promoCode });
  const deliveryQuote = activeCheckoutDeliveryQuote(quoteState, quoteEnabled, quoteKey);
  const quoteBusy = quoteEnabled && quoteState?.key === quoteKey && quoteState.status === "pending";
  const quoteError = quoteEnabled && quoteState?.key === quoteKey && quoteState.status === "error" ? quoteState.message : null;
  const checkoutTotal = isDelivery ? deliveryQuote?.totalCents ?? null : cart.subtotal;

  const [date, setDate] = useState<string | null>(null);
  const [slots, setSlots] = useState<SlotsResponse | null>(initialSlots);
  const [slotsState, setSlotsState] = useState<"idle" | "loading" | "error">("idle");
  const [slotIso, setSlotIso] = useState<string | null>(null);

  const [wanted, setWanted] = useState<"online" | "counter">("online");
  const [probe, setProbe] = useState<"ready" | "off" | "unknown">("unknown");
  const [intent, setIntent] = useState<PaymentIntentResponse | null>(null);

  const [order, setOrder] = useState<CreatedOrder | null>(null);
  const [status, setStatus] = useState<OrderStatus>("new");
  const [paidOnline, setPaidOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  // La garde doit précéder le prochain rendu : un second clic, Échap ou un
  // callback de fermeture ne peut pas effacer une requête déjà partie.
  const requestInFlightRef = useRef(false);
  const resetTimerRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileReset, setTurnstileReset] = useState(0);
  // Clé d’idempotence : forgée au premier envoi, conservée pendant tous les
  // réessais de la même tentative — un double appui ne crée jamais deux
  // commandes. Elle n’est renouvelée qu’après une commande réellement passée.
  const clientIdRef = useRef<string | null>(null);

  useEffect(() => () => {
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
  }, []);

  // ── Coordonnées et disponibilité du paiement, relues à l’ouverture ──
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- `readCustomer()` lit la mémoire de session du navigateur, absente au rendu serveur, et la garde protège une saisie déjà commencée. Recalculé au rendu, ce prérenseignement écraserait le nom et le téléphone que le client est en train de taper.
    setCustomer((prev) => (prev.name || prev.phone ? prev : readCustomer()));
    // La démonstration ne consulte ni n’écrit la mémoire de session : elle
    // propose toujours les deux moyens de paiement, puisque c’est justement
    // ce choix-là qu’il s’agit de montrer.
    if (!demo) setProbe(readPayProbe(slug));
  }, [open, slug, demo]);

  // Un tenant sans paiement en ligne n’a qu’un mode : le comptoir.
  const method: "online" | "counter" = isDelivery ? "online" : !demo && probe === "off" ? "counter" : wanted;

  // ── Créneaux : toujours rechargés à l’entrée de l’étape (capacité vivante) ──
  const fetchSlots = useCallback(
    (target: string | null, signal?: AbortSignal) => {
      setSlotsState("loading");
      api
        .loadSlots(slug, target ?? undefined, signal, fulfillment)
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
    [api, slug, fulfillment],
  );

  useEffect(() => {
    if (!open || step !== "slot") return;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- appel réseau : la capacité des créneaux est vivante, elle doit être relue à chaque entrée dans l'étape et à chaque changement de date. Figée, le client choisirait un créneau déjà complet — commande acceptée puis impossible à honorer.
    fetchSlots(date, controller.signal);
    return () => controller.abort();
  }, [open, step, date, fetchSlots]);

  const nameOk = customer.name.trim().length >= 2;
  const contactOk = nameOk && phoneOk(customer.phone) && (!isDelivery || Boolean(deliveryQuote));
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
    if (requestInFlightRef.current) return;
    onClose();
    // Refermer la feuille ne signifie ni annuler Stripe ni abandonner sa
    // référence : la prochaine ouverture reprend le paiement de cette commande.
    if (step === "card") return;
    clearScheduledReset();
    resetTimerRef.current = window.setTimeout(() => {
      resetTimerRef.current = null;
      resetTunnel();
    }, SHEET_EXIT_MS);
  }

  function clearScheduledReset() {
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = null;
  }

  function resetTunnel() {
    if (requestInFlightRef.current) return;
    setStep("cart");
    setOrder(null);
    setStatus("new");
    setIntent(null);
    setPaidOnline(false);
    setError(null);
    setSlotIso(null);
    setDate(null);
    setTurnstileToken(null);
    setTurnstileReset((value) => value + 1);
    dispatchQuote({ type: "invalidate" });
    clientIdRef.current = null;
  }

  function changeFulfillment(next: Fulfillment) {
    if (requestInFlightRef.current || next === fulfillment) return;
    dispatchQuote({ type: "invalidate" });
    setFulfillment(next);
    setSlotIso(null);
    setSlots(null);
  }

  async function verifyDelivery() {
    if (!quoteEnabled) return;
    const requestId = ++quoteSequence.current;
    dispatchQuote({ type: "start", key: quoteKey, requestId });
    const parsed = DeliveryAddressSchema.safeParse(address);
    if (!parsed.success) {
      dispatchQuote({ type: "reject", key: quoteKey, requestId, message: parsed.error.issues[0]?.message ?? "Vérifiez votre adresse." });
      return;
    }
    try {
      const value = await api.quoteDelivery(slug, { address: parsed.data, lines: toOrderLines(cart.lines),
        ...(normalizedPromoCode ? { promoCode: normalizedPromoCode } : {}) });
      dispatchQuote({ type: "resolve", key: quoteKey, requestId, value });
    } catch (cause) {
      dispatchQuote({ type: "reject", key: quoteKey, requestId,
        message: cause instanceof PublicApiError ? cause.message : "La vérification n’a pas abouti. Réessayez." });
    }
  }

  async function retryPayment() {
    if (!order || requestInFlightRef.current || checkoutPaymentDecision(order, "online") === "verify") return;
    requestInFlightRef.current = true;
    clearScheduledReset();
    setBusy(true);
    setError(null);
    try {
      const next = await requestExistingOrderPayment(api, order);
      setIntent(next);
    } catch {
      setError(PAYMENT_VERIFICATION_MESSAGE);
    } finally { requestInFlightRef.current = false; setBusy(false); }
  }

  /**
   * Démonstration : la cuisine avance, et le visiteur la regarde avancer.
   *
   * Le suivi réel vit sur `/t/:id`, une autre page — et la mémoire de la
   * démonstration ne franchit pas la frontière d’un document. On interroge
   * donc le MÊME point d’entrée (`GET /public/orders/:id`) depuis l’écran de
   * confirmation : c’est le vrai chemin de code, avec le vrai jeton, et le
   * ticket passe « Reçue → En préparation → Prête » sous les yeux du visiteur.
   */
  useEffect(() => {
    // Le sondage s’arrête à « Prête » : plus rien ne bougera, et une
    // démonstration laissée ouverte dans un onglet ne doit pas tourner en fond.
    if (!demo || step !== "done" || !order || status === "ready") return;
    let alive = true;
    const tick = () => {
      api
        .loadTracking(order._id, order.trackingToken)
        .then((next) => {
          if (alive) setStatus(next.status);
        })
        .catch(() => {
          /* le suivi qui bégaie n’a rien à dire au client : dernier état gardé */
        });
    };
    tick();
    const timer = window.setInterval(tick, 4_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [api, demo, step, order, status]);

  // ── Jalon d'entonnoir : le client a SAISI ses coordonnées. ──
  //
  // Il était émis à l'OUVERTURE du panier, c'est-à-dire avant que le client
  // ait vu le moindre champ. L'entonnoir du back-office mesurait donc « a
  // ouvert son panier » sous le nom « a saisi ses coordonnées », et le taux
  // d'abandon de cette étape était structurellement faux — celui qui referme
  // aussitôt comptait comme un client qui s'est identifié.
  //
  // (En démonstration, `armeFunnel` n'a posé aucun contexte : ce jalon est
  // alors un no-op par construction.)
  useEffect(() => {
    if (open && step === "customer") jalonFunnel("coordonnees");
  }, [open, step]);

  // ── Passage de commande ──
  async function submit(chosenMethod: "online" | "counter") {
    if (requestInFlightRef.current || !slotIso || !contactOk || cart.lines.length === 0) return;
    const proof = demo ? "demo" : turnstileToken;
    if (!proof) {
      setError("La vérification de sécurité doit se terminer avant l’envoi.");
      return;
    }
    requestInFlightRef.current = true;
    clearScheduledReset();
    setBusy(true);
    setError(null);
    // Le fournisseur rend chaque preuve utilisable une seule fois. On relance
    // immédiatement un contrôle pour qu'un retry réseau dispose d'un jeton neuf.
    if (!demo) {
      setTurnstileToken(null);
      setTurnstileReset((value) => value + 1);
    }
    try {
      writeCustomer(customer);
      clientIdRef.current ??= uid();
      const created = await api.createOrder(slug, {
        clientId: clientIdRef.current,
        lines: toOrderLines(cart.lines),
        payment: { method: chosenMethod },
        ...(isDelivery ? { fulfillment: "delivery" as const, delivery: { address, instructions: deliveryInstructions.trim() } } : {}),
        turnstileToken: proof,
        pickup: {
          slot: slotIso,
          customerName: customer.name.trim(),
          customerPhone: customer.phone.trim(),
        },
        ...(cart.note.trim() ? { note: cart.note.trim() } : {}),
        ...(normalizedPromoCode ? { promoCode: normalizedPromoCode } : {}),
      });

      if (isPaused(created)) {
        setError(
          created.message ??
            "La commande en ligne vient d’être suspendue par le restaurant.",
        );
        return;
      }

      setOrder(created);
      jalonFunnel("commande");
      cart.clear(); // la commande existe : le panier ne doit plus pouvoir repartir
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate(60);
      }

      // ── Démonstration : le paiement s’arrête ici ──
      //
      // Aucune intention de paiement n’est demandée : pas de clé Stripe
      // chargée, pas de formulaire de carte monté, aucun montant envoyé chez
      // un prestataire. On ne feint pas davantage un encaissement — l’écran de
      // confirmation dit franchement où le vrai paiement se serait produit.
      if (demo) {
        setStep("done");
        return;
      }

      // Un rejeu peut renvoyer la commande du PREMIER envoi, avec un autre
      // moyen que celui affiché entre-temps. Seul le serveur permet d'annoncer
      // un règlement comptoir ; un état ancien ou terminal mène au suivi.
      const decision = checkoutPaymentDecision(created, chosenMethod);
      if (decision === "counter") {
        setStep("done");
        return;
      }

      // La commande existe. Figer l'étape AVANT la demande bancaire interdit
      // retour au choix comptoir et fausse confirmation, même si la réponse se perd.
      setStep("card");
      if (decision === "verify") {
        setError(PAYMENT_VERIFICATION_MESSAGE);
        return;
      }
      try {
        const res = await requestExistingOrderPayment(api, created);
        writePayProbe(slug, "ready");
        setProbe("ready");
        setIntent(res);
      } catch {
        setError(PAYMENT_VERIFICATION_MESSAGE);
      }
    } catch (err) {
      setError(
        err instanceof PublicApiError
          ? err.message
          : "La commande n’a pas pu être envoyée. Vérifiez votre connexion.",
      );
    } finally {
      requestInFlightRef.current = false;
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
    slot: isDelivery ? "Créneau de livraison" : "Créneau de retrait",
    pay: "Paiement",
    card: "Paiement par carte",
    done: "Commande confirmée",
  };

  const back: Partial<Record<Step, Step>> = {
    customer: "cart",
    slot: "customer",
    pay: "slot",
  };
  const backTo = back[step];

  return (
    <Sheet
      open={open}
      onClose={closeTunnel}
      navigationLocked={busy}
      maxHeight="100%"
      fill
      title={titles[step]}
      onBack={backTo ? () => { if (!requestInFlightRef.current) setStep(backTo); } : null}
      headerExtra={
        !finished ? (
          <Progress index={stepIndex} onJump={(target) => { if (!requestInFlightRef.current) setStep(target); }} step={step} delivery={isDelivery} disabled={busy} />
        ) : null
      }
      footer={
        <Footer
          step={step}
          busy={busy}
          cart={cart}
          fulfillment={fulfillment}
          total={checkoutTotal}
          contactOk={contactOk}
          slotIso={slotIso}
          slotLabel={chosenSlot ? hhmm(chosenSlot.iso) : null}
          blocked={blockedByPause}
          method={method}
          order={order}
          embed={embed}
          demo={demo}
          verified={demo || Boolean(turnstileToken)}
          prixMono={prixMono}
          onNext={(next) => {
            if (requestInFlightRef.current) return;
            if (next === "customer") setTouched(false);
            setStep(next);
          }}
          onSubmit={() => submit(method)}
          onFinish={closeTunnel}
        />
      }
    >
      <div className={step === "done" ? "" : "px-4 pb-8 pt-4"}>
        {blockedByPause && step !== "done" && (
          <div className="mb-4">
            <Banner tone="prep" icon="clock" title="Commande en ligne suspendue">
              {pauseMessage ??
                "Victimes de notre succès — la commande en ligne rouvre très vite. La carte reste consultable."}
            </Banner>
          </div>
        )}

        {error && step !== "done" && step !== "card" && (
          <div className="mb-4">
            <Banner tone="alert" icon="bell" title={order ? "Paiement à vérifier" : "Commande non envoyée"}>
              {error}
            </Banner>
          </div>
        )}

        {step === "cart" && (
          <>
          {delivery?.available && !demo && (
            <RadioGroup label="Recevoir votre commande" className="mb-5 flex flex-col gap-2.5">
              <ChoiceCard on={!isDelivery} tabIndex={!isDelivery ? 0 : -1} glyph="bag" title="Retrait au restaurant" sub="Sans frais de livraison" onClick={() => changeFulfillment("pickup")} />
              <ChoiceCard on={isDelivery} tabIndex={isDelivery ? 0 : -1} glyph="pin" title="Livraison chez vous" sub="Par le restaurant · paiement sécurisé en ligne" onClick={() => changeFulfillment("delivery")} />
            </RadioGroup>
          )}
          <CartStep
            cart={cart}
            onBrowse={onBrowse}
            onEditLine={onEditLine}
            promoCode={promoCode}
            prixMono={prixMono}
            onPromoCode={setPromoCode}
            delivery={isDelivery}
            quote={deliveryQuote}
          />
          </>
        )}

        {step === "customer" && (
          <>
          <CustomerStep
            customer={customer}
            onChange={setCustomer}
            touched={touched}
            onBlur={() => setTouched(true)}
            tenantName={tenantName}
          />
          {isDelivery && <DeliveryFields address={address} instructions={deliveryInstructions} quote={deliveryQuote} busy={quoteBusy} error={quoteError} onAddress={setAddress} onInstructions={setDeliveryInstructions} onVerify={verifyDelivery} />}
          </>
        )}

        {step === "slot" && (
          <SlotStep
            slots={slots}
            state={slotsState}
            selected={slotIso}
            onSelect={setSlotIso}
            onDate={setDate}
            onRetry={() => fetchSlots(date)}
            tenantName={isDelivery ? "Votre adresse de livraison" : tenantName}
            tenantAddress={isDelivery ? `${address.line1}, ${address.postalCode} ${address.city}` : tenantAddress}
            delivery={isDelivery}
          />
        )}

        {step === "pay" && (
          <div className="flex flex-col gap-6">
            <PayStep
              cart={cart}
              customer={customer}
              slotLabel={chosenSlot ? hhmm(chosenSlot.iso) : null}
              slotDate={slots?.date ?? null}
              method={method}
              onMethod={(next) => { if (!requestInFlightRef.current) setWanted(next); }}
              disabled={busy}
              cardAvailable={probe !== "off"}
              prixMono={prixMono}
              delivery={isDelivery}
              quote={deliveryQuote}
              total={checkoutTotal}
              address={isDelivery ? `${address.line1}, ${address.postalCode} ${address.city}` : null}
            />
            {!demo && (
              <TurnstileCheck
                siteKey={TURNSTILE_SITE_KEY}
                tenantSlug={slug}
                mode={mode}
                resetKey={turnstileReset}
                onToken={setTurnstileToken}
              />
            )}
          </div>
        )}

        {step === "card" && intent && !intent.unavailable && intent.publishableKey && (
          <StripeCard
            publishableKey={intent.publishableKey}
            clientSecret={intent.clientSecret}
            stripeAccount={intent.stripeAccount}
            amount={intent.amount}
            apparence={stripeApparence}
            prixMono={prixMono}
            returnUrl={
              typeof window === "undefined" || !order
                ? ""
                : `${window.location.origin}/t/${order._id}?t=${encodeURIComponent(order.trackingToken)}`
            }
            onPaid={() => {
              setPaidOnline(true);
              setStep("done");
            }}
          />
        )}
        {step === "card" && (!intent || intent.unavailable || !intent.publishableKey) && (
          <div className="flex flex-col gap-3">
            <ErrorState title={busy ? "Connexion au paiement" : "Paiement à vérifier"} message={busy ? "Connexion au paiement sécurisé…" : "Ne payez pas par un autre moyen. Consultez le suivi de votre commande pour vérifier son état."} onRetry={busy || !order || checkoutPaymentDecision(order, "online") === "verify" ? undefined : retryPayment} />
            {order && <Link
              href={`/t/${order._id}?t=${encodeURIComponent(order.trackingToken)}`}
              target={embed ? "_blank" : undefined}
              rel={embed ? "noopener noreferrer" : undefined}
              className="flex min-h-11 items-center justify-center text-center text-[13px] font-semibold text-mut underline underline-offset-4 transition-colors duration-fast hover:text-ink"
            >Suivre ma commande</Link>}
          </div>
        )}

        {step === "done" && order && (
          <DoneStep
            order={order}
            status={status}
            prixMono={prixMono}
            paidOnline={paidOnline}
            demo={demo}
            demoCard={demo && method === "online"}
            loyalty={loyalty}
          />
        )}
      </div>
    </Sheet>
  );
}

// ─────────────────────────────────────────────────────────────
// Fil d’étapes
// ─────────────────────────────────────────────────────────────

/**
 * Progression nommée : un trait par étape, son libellé dessous. Une étape
 * franchie reste cliquable — revenir corriger son numéro de téléphone ne doit
 * pas obliger à ressortir du tunnel.
 */
function Progress({
  index,
  step,
  onJump,
  delivery = false,
  disabled = false,
}: {
  index: number;
  step: Step;
  onJump: (target: Step) => void;
  delivery?: boolean;
  disabled?: boolean;
}) {
  return (
    <ol className="mt-2.5 flex items-start gap-1.5">
      {STEPS.map((entry, i) => {
        const done = i < index;
        const current = entry.id === step;
        return (
          <li key={entry.id} className="min-w-0 flex-1">
            <button
              type="button"
              disabled={disabled || !done}
              onClick={() => onJump(entry.id)}
              aria-current={current ? "step" : undefined}
              /* 44 px : revenir corriger son téléphone se fait au pouce. */
              className={cx("block min-h-11 w-full text-left", done && !disabled && "cursor-pointer", disabled && "cursor-wait")}
            >
              {/*
                `accentink` et non `accent` : cette barre de 1 px est un
                indicateur porté par la SEULE couleur, donc soumise au 3:1 de
                1.4.11 — or l'accent brut ne vaut que 2,55:1 sur le fond de
                Soleil et 2,68 sur sa carte. `accentink` est la même teinte
                ramenée par le résolveur jusqu'à 4,5:1 sur le fond comme sur la
                carte : l'étape franchie se distingue à coup sûr de `bg-ink/12`.
                `bg-accent` reste réservé aux aplats, qui portent `text-onaccent`.
              */}
              <span
                className={cx(
                  "block h-1 rounded-full transition-colors duration-med ease-sm",
                  current || done ? "bg-accentink" : "bg-ink/12",
                )}
              />
              {/*
                Les étapes à venir étaient en `text-ink/25` à 10 px, soit 1,5 à
                2,1:1. Le bouton est bien `disabled` — mais ces mots ne sont pas
                l'étiquette d'un contrôle grisé : ce sont l'information de
                progression du tunnel, et 1.4.3 s'y applique sans exemption.
              */}
              <span
                className={cx(
                  "mt-1.5 block truncate text-[10px] font-bold uppercase tracking-[0.1em] transition-colors duration-med",
                  current ? "text-ink" : "text-mut",
                )}
              >
                {entry.id === "slot" && delivery ? "Livraison" : entry.label}
              </span>
              <span className="sr-only">
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
  fulfillment,
  total,
  contactOk,
  slotIso,
  slotLabel,
  blocked,
  method,
  order,
  embed,
  demo,
  verified,
  prixMono,
  onNext,
  onSubmit,
  onFinish,
}: {
  step: Step;
  busy: boolean;
  cart: CartApi;
  fulfillment: Fulfillment;
  total: number | null;
  contactOk: boolean;
  slotIso: string | null;
  slotLabel: string | null;
  blocked: boolean;
  method: "online" | "counter";
  order: CreatedOrder | null;
  embed: boolean;
  demo: boolean;
  verified: boolean;
  /** Paire typographique du masque qui pose les prix en chasse fixe. */
  prixMono: boolean;
  onNext: (next: Step) => void;
  onSubmit: () => void;
  onFinish: () => void;
}) {
  if (step === "card") return null;

  if (step === "done") {
    return (
      <div className="flex flex-col gap-2.5">
        {/* Pas de lien de suivi en démonstration : la page `/t/:id` est un
            autre document, et la commande fictive n’existe que dans la mémoire
            de celui-ci. Le suivi se joue donc au-dessus, dans la frise. */}
        {order && !demo && (
          <Link
            href={`/t/${order._id}?t=${encodeURIComponent(order.trackingToken)}`}
            target={embed ? "_blank" : undefined}
            rel={embed ? "noopener noreferrer" : undefined}
            className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-pill bg-accent px-5 text-[15px] font-extrabold text-onaccent transition-transform duration-fast ease-sm active:scale-[0.97] active:duration-snap"
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
        amount={empty ? undefined : total ?? cart.subtotal}
        icon="arrow"
        mono={prixMono}
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
        mono={prixMono}
        onClick={() => onNext("slot")}
      >
        {contactOk ? "Choisir le créneau" : fulfillment === "delivery" ? "Coordonnées et adresse vérifiée requises" : "Nom et téléphone requis"}
      </PrimaryAction>
    );
  }

  if (step === "slot") {
    return (
      <PrimaryAction
        disabled={!slotIso || blocked}
        icon="arrow"
        mono={prixMono}
        onClick={() => onNext("pay")}
      >
        {slotLabel ? `Continuer · ${fulfillment === "delivery" ? "livraison" : "retrait"} ${slotLabel}` : "Choisissez un créneau"}
      </PrimaryAction>
    );
  }

  return (
    <PrimaryAction
      disabled={blocked || !slotIso || !contactOk || !verified}
      loading={busy}
      amount={total ?? undefined}
      icon={method === "online" ? "euro" : "check"}
      mono={prixMono}
      onClick={onSubmit}
    >
      {!verified
        ? "Vérification sécurisée…"
        : method === "online"
          ? "Payer"
          : "Confirmer la commande"}
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
  promoCode,
  prixMono,
  onPromoCode,
  delivery,
  quote,
}: {
  cart: CartApi;
  onBrowse: () => void;
  onEditLine: (line: CartLine) => void;
  promoCode: string;
  prixMono: boolean;
  onPromoCode: (v: string) => void;
  delivery: boolean;
  quote: DeliveryQuote | null;
}) {
  const noteId = useId();

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
        <span className="grid size-14 place-items-center rounded-panel bg-surface2 text-mut">
          <Icon name="cart" size={24} />
        </span>
        <p className="text-[17px] font-bold text-ink">Votre panier est vide</p>
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
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2.5">
        {cart.lines.map((line) => (
          <CartRow
            key={line.lineId}
            line={line}
            prixMono={prixMono}
            onQty={(qty) => cart.setQty(line.lineId, qty)}
            onEdit={() => onEditLine(line)}
            onRemove={() => cart.remove(line.lineId)}
          />
        ))}
      </div>

      <section className="flex flex-col gap-2.5">
        {/*
          Le titre de section NOMME le champ (`aria-labelledby`). Le
          `<textarea>` n'avait ni `<label>`, ni `aria-label`, ni relation avec
          le `<h3>` posé juste au-dessus : son nom accessible était vide, et un
          lecteur d'écran n'annonçait qu'« zone d'édition » (1.3.1, 4.1.2).
          Le `placeholder` ne compte pas comme un nom : il disparaît à la
          première frappe.
        */}
        <SectionLabel id={noteId} hint="facultatif">
          Instructions pour la cuisine
        </SectionLabel>
        <textarea
          value={cart.note}
          onChange={(e) => cart.setNote(e.target.value)}
          aria-labelledby={noteId}
          rows={2}
          maxLength={500}
          placeholder="Ex : sans oignons sur tout, sauces à part…"
          className="w-full resize-none rounded-card border border-linefirm bg-ink/5 px-3.5 py-3 text-[15px] text-ink outline-none transition-colors duration-fast ease-sm placeholder:text-mut focus:border-focus"
        />
      </section>

      {/*
        LE CODE PROMO — le champ qui n'existait nulle part.

        Le back-office savait créer un code, l'activer et l'imprimer sur des
        flyers ; aucune surface ne savait le RECEVOIR. Le restaurateur ne
        l'apprenait pas d'une erreur, il l'apprenait d'un client au téléphone.

        Volontairement discret et replié : la majorité des clients n'en a pas,
        et un champ vide mis en avant fait douter — « ai-je raté une offre ? ».
      */}
      <details className="group mb-3 rounded-panel border border-ink/8 bg-surface2 px-4 py-3">
        <summary className="flex min-h-11 cursor-pointer list-none items-center text-[14px] text-mut marker:content-none">
          <span className="underline decoration-ink/25 underline-offset-4 group-open:no-underline">
            J&apos;ai un code promo
          </span>
        </summary>
        <label className="mt-3 block">
          <span className="sr-only">Code promo</span>
          <input
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={24}
            placeholder="BIENVENUE10"
            value={promoCode}
            onChange={(e) => onPromoCode(e.target.value.toUpperCase())}
            /* `rounded-ctrl` — le rayon des contrôles, que le résolveur
               surcharge selon la forme choisie. Il était écrit `rounded-input`,
               qui ne correspond à aucun `--radius-*` de `@theme` : Tailwind v4
               n'émettait rien et le champ restait à angles vifs sur les formes
               `doux` et `rond`. Une classe morte, invisible au premier coup
               d'œil parce qu'elle ressemble à un jeton. */
            className="min-h-11 w-full rounded-ctrl border border-linefirm bg-surface px-3 py-2.5 text-[15px] uppercase tracking-[0.08em] text-ink placeholder:tracking-normal placeholder:text-mut focus:border-focus focus:outline-none"
          />
        </label>
        <p className="mt-2 text-[12px] leading-relaxed text-mut">
          {delivery ? "La remise et le minimum de livraison sont vérifiés à l’étape adresse." : "La remise est appliquée par le restaurant au moment de valider."}
        </p>
      </details>

      <section className="rounded-panel border border-ink/8 bg-surface2 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[14px] text-mut">
            Sous-total ·{" "}
            <span className="tabular-nums">
              {cart.count} article{cart.count > 1 ? "s" : ""}
            </span>
          </span>
          <Money cents={quote?.originalSubtotalCents ?? cart.subtotal} mono={prixMono} className="text-[15px] text-mut" />
        </div>
        {quote?.discount && <div className="mt-2 flex items-baseline justify-between gap-3 text-[14px] text-okt">
          <span>{quote.discount.reason}</span><span>−<Money cents={quote.discount.amount} mono={prixMono} /></span>
        </div>}
        {quote && <div className="mt-2 flex items-baseline justify-between gap-3 text-[14px] text-mut">
          <span>Livraison</span><DeliveryFee quote={quote} mono={prixMono} />
        </div>}
        {quote && <div className="mt-2 text-[12px] leading-relaxed text-mut"><FreeDeliveryHint quote={quote} /></div>}
        <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-ink/8 pt-3">
          <span className="text-[16px] font-extrabold uppercase tracking-[0.04em] text-ink">
            {delivery && !quote ? "Produits · hors livraison" : "Total"}
          </span>
          <Money
            cents={quote?.totalCents ?? cart.subtotal}
            mono={prixMono}
            className="text-[clamp(1.375rem,1.2rem+0.7vw,1.625rem)] text-ink"
          />
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-mut">
          {delivery && !quote ? "Frais de livraison et remise éventuelle à vérifier à l’étape adresse. " : "Prix TTC, service compris. "}
          Le montant est recalculé par le restaurant à la validation.
        </p>
      </section>
    </div>
  );
}

/** Ligne de panier : vignette, récap des options, quantité, reprise. */
function CartRow({
  line,
  prixMono,
  onQty,
  onEdit,
  onRemove,
}: {
  line: CartLine;
  prixMono: boolean;
  onQty: (qty: number) => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const summary = lineSummary(line);
  return (
    <article className="overflow-hidden rounded-panel border border-ink/6 bg-surface bg-[linear-gradient(180deg,var(--cf-surface-3),transparent_80px)] p-3 shadow-card">
      <div className="flex items-start gap-3">
        {/* Même plateau que la carte : le plat se reconnaît d'un écran à
            l'autre, et une photo morte n'y laisse jamais un cadre cassé. */}
        <Plate
          photoUrl={line.photoUrl}
          name={line.name}
          mono={17}
          pad="p-[4%]"
          className="size-[58px]"
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 text-[15px] font-bold leading-tight text-ink">
              {line.name}
            </p>
            <Money
              cents={lineTotal(line)}
              mono={prixMono}
              className="shrink-0 text-[16px] text-ink"
            />
          </div>
          {summary && (
            <p className="mt-1 text-[13px] leading-snug text-mut">{summary}</p>
          )}
          {line.note && (
            <p className="mt-1.5 flex items-start gap-1.5 text-[13px] italic leading-snug text-prept">
              <Icon name="edit" size={13} className="mt-0.5 shrink-0" />
              {line.note}
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-ink/6 pt-3">
        <Stepper value={line.qty} min={0} label={line.name} onChange={onQty} />
        <div className="flex items-center gap-1.5">
          <Tap
            onClick={onEdit}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-pill border border-ink/12 px-3 text-[13px] font-bold text-mut hover:text-ink"
          >
            <Icon name="edit" size={14} />
            Modifier
          </Tap>
          <Tap
            onClick={onRemove}
            aria-label={`Retirer ${line.name}`}
            className="grid size-11 place-items-center rounded-pill text-mut hover:text-alertt"
          >
            <Icon name="trash" size={16} />
          </Tap>
        </div>
      </div>
    </article>
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
  // `focus:border-focus` est DANS la base, pas dans la branche valide : avec
  // `outline-none`, la bordure EST l'indicateur de focus (1.4.11, 2.4.13), et
  // un champ en erreur en restait dépourvu — on ne voyait plus où l'on tapait
  // au moment précis où il fallait corriger.
  //
  // La bordure au repos est le filet FERME : le bord d'un champ EST la limite
  // du contrôle (1.4.11, 3:1). Il était posé à 8 % d'encre, soit 1,14 à
  // 1,26:1 selon la direction — un champ dont on ne voyait pas le cadre.
  const field =
    "min-h-11 w-full rounded-card border bg-ink/5 px-3.5 py-3.5 text-[16px] text-ink outline-none transition-colors duration-fast ease-sm placeholder:text-mut focus:border-focus";

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[14px] leading-relaxed text-mut">
        Pas de compte à créer. {tenantName} a juste besoin de savoir à qui remettre
        la commande, et comment vous prévenir quand elle est prête.
      </p>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="sm-name"
          className="text-[11px] font-bold uppercase tracking-[0.16em] text-mut"
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
          className={cx(field, nameError ? "border-alert" : "border-linefirm")}
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
          className="text-[11px] font-bold uppercase tracking-[0.16em] text-mut"
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
          className={cx(field, phoneError ? "border-alert" : "border-linefirm")}
        />
        {phoneError ? (
          <p id="sm-phone-err" role="alert" className="text-[13px] text-alertt">
            Un numéro d’au moins 8 chiffres est nécessaire.
          </p>
        ) : (
          <p id="sm-phone-hint" className="text-[13px] text-mut">
            {/*
              Le numéro sert au RESTAURANT, pas à un envoi automatique : aucun
              SMS n'est expédié aujourd'hui. Annoncer « pour vous prévenir »
              faisait attendre un message qui ne partait jamais.
            */}
            Pour que le restaurant puisse vous joindre en cas de besoin.
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
  tenantName,
  tenantAddress,
  delivery = false,
}: {
  slots: SlotsResponse | null;
  state: "idle" | "loading" | "error";
  selected: string | null;
  onSelect: (iso: string) => void;
  onDate: (ymd: string) => void;
  onRetry: () => void;
  tenantName: string;
  tenantAddress: string;
  delivery?: boolean;
}) {
  if (state === "error") {
    return (
      <ErrorState
        title="Créneaux indisponibles"
        message="Impossible de récupérer les créneaux pour le moment."
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
      {delivery && <p className="text-[13px] text-mut">L’heure choisie est une estimation de remise à votre adresse. Préparation et trajet sont compris dans le délai annoncé.</p>}
      {/* Où retirer — le client vérifie l’adresse avant de choisir l’heure. */}
      <div className="flex items-center gap-3 rounded-panel border border-ink/8 bg-surface2 p-3.5">
        <span className="grid size-11 shrink-0 place-items-center rounded-pill bg-accent text-onaccent">
          <Glyph name="pin" size={20} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[15px] font-bold text-ink">{tenantName}</p>
          <p className="truncate text-[13px] text-mut">
            {tenantAddress || "Retrait au comptoir"}
          </p>
        </div>
      </div>

      {dates.length > 1 && (
        <div className="flex gap-2">
          {dates.map((ymd) => (
            <Tap
              key={ymd}
              onClick={() => onDate(ymd)}
              aria-pressed={ymd === slots.date}
              className={cx(
                "min-h-11 flex-1 rounded-card border px-3 text-[14px] font-bold",
                ymd === slots.date
                  ? "border-accent bg-accent text-onaccent"
                  : "border-ink/8 bg-surface2 text-mut hover:text-ink",
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
          <Banner icon="clock" title={`Comptez ~${slots.leadTimeMin} min de préparation`}>
            Le restaurant lance votre commande pour l’heure choisie&nbsp;: elle
            vous attend chaude, pas depuis une heure.
          </Banner>

          {[...byService.entries()].map(([service, list]) => (
            <section key={service} className="flex flex-col gap-2.5">
              <SectionLabel hint={`${list.filter((s) => !s.full).length} libres`}>
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
                        "flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-card border",
                        on
                          ? "border-accent bg-accent"
                          : "border-ink/8 bg-surface2 hover:border-ink/25",
                        slot.full && "cursor-not-allowed opacity-30 active:scale-100",
                      )}
                    >
                      <span
                        className={cx(
                          "text-[15px] font-extrabold tabular-nums tracking-[-0.02em]",
                          on ? "text-onaccent" : "text-ink",
                        )}
                      >
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
  prixMono,
  delivery,
  quote,
  total,
  address,
  disabled,
}: {
  cart: CartApi;
  customer: Customer;
  slotLabel: string | null;
  slotDate: string | null;
  method: "online" | "counter";
  onMethod: (next: "online" | "counter") => void;
  cardAvailable: boolean;
  prixMono: boolean;
  delivery: boolean;
  quote: DeliveryQuote | null;
  total: number | null;
  address: string | null;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-panel border border-ink/8 bg-surface2 p-4">
        <SectionLabel className="mb-3">Récapitulatif</SectionLabel>
        <dl className="flex flex-col gap-2.5 text-[14px]">
          <Row label={delivery ? "Livraison estimée" : "Retrait"}>
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
          {address && <Row label="Adresse"><span className="whitespace-normal text-ink">{address}</span></Row>}
          {delivery && <Row label="Produits"><Money cents={quote?.originalSubtotalCents ?? cart.subtotal} mono={prixMono} /></Row>}
          {quote?.discount && <Row label={quote.discount.reason}><span className="text-okt">−<Money cents={quote.discount.amount} mono={prixMono} /></span></Row>}
          {quote?.discount && <Row label="Produits après remise"><Money cents={quote.subtotalCents} mono={prixMono} /></Row>}
          {delivery && <Row label="Frais de livraison">{quote ? <DeliveryFee quote={quote} mono={prixMono} /> : "À vérifier"}</Row>}
        </dl>
        <div className="mt-3.5 flex items-baseline justify-between border-t border-ink/8 pt-3.5">
          <span className="text-[15px] font-extrabold uppercase tracking-[0.04em] text-ink">
            Total à régler
          </span>
          {total === null ? <span className="text-[15px] font-semibold text-mut">À vérifier</span> : <Money
            cents={total}
            mono={prixMono}
            className="text-[clamp(1.25rem,1.1rem+0.6vw,1.5rem)] text-ink"
          />}
        </div>
        {quote && <div className="mt-2 text-[12px] leading-relaxed text-mut"><FreeDeliveryHint quote={quote} /></div>}
        {delivery && <p className="mt-2 text-[12px] leading-relaxed text-mut">Devis indicatif : prix et disponibilité de l’offre revérifiés à la validation.</p>}
      </section>

      <section className="flex flex-col gap-2.5">
        <SectionLabel>Mode de paiement</SectionLabel>
        {delivery ? (
          <Banner icon="euro" title="Paiement sécurisé en ligne">Le paiement confirme votre livraison. Les coordonnées de votre carte restent chez Stripe.</Banner>
        ) : cardAvailable ? (
          // `RadioGroup` et non une `<div role="radiogroup">` nue : les flèches
          // doivent parcourir le groupe, et une seule des deux cartes prend la
          // halte de tabulation (tabindex tournant, APG radiogroup). Sans cela,
          // le groupe se traversait touche à touche comme deux boutons isolés.
          <RadioGroup label="Mode de paiement" className="flex flex-col gap-2.5">
            <ChoiceCard
              disabled={disabled}
              on={method === "online"}
              tabIndex={method === "online" ? 0 : -1}
              icon="euro"
              title="Carte bancaire"
              sub="Paiement sécurisé en ligne · Visa, Mastercard, CB"
              onClick={() => onMethod("online")}
            />
            <ChoiceCard
              disabled={disabled}
              on={method === "counter"}
              tabIndex={method === "counter" ? 0 : -1}
              glyph="bag"
              title="Payer au comptoir"
              sub="Carte ou espèces au moment du retrait"
              onClick={() => onMethod("counter")}
            />
          </RadioGroup>
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

/** Les trois étapes que le client suit (le KDS en pilote la progression). */
const TIMELINE: { status: OrderStatus; label: string; hint: string }[] = [
  { status: "new", label: "Reçue", hint: "La cuisine a votre commande" },
  { status: "preparing", label: "En préparation", hint: "Ça chauffe" },
  { status: "ready", label: "Prête", hint: "À récupérer au comptoir" },
];

/**
 * Confirmation — la récompense du parcours (maquette §5.7).
 *
 * Bandeau accent plein cadre, médaillon, puis le numéro de retrait porté par
 * une carte qui chevauche le bandeau : c’est le seul chiffre que le client
 * devra montrer au comptoir, il domine tout le reste.
 */
function DoneStep({
  order,
  status,
  paidOnline,
  demo,
  demoCard,
  prixMono,
  loyalty,
}: {
  order: CreatedOrder;
  /** Avancement en cuisine — n’avance que là où un suivi alimente l’écran. */
  status: OrderStatus;
  paidOnline: boolean;
  demo: boolean;
  /** Démonstration où le visiteur avait choisi la carte bancaire. */
  demoCard: boolean;
  /** Paire typographique du masque qui pose les prix en chasse fixe. */
  prixMono: boolean;
  /** Programme de fidélité du restaurant — `null` s’il n’en a pas. */
  loyalty: VitrineFidelite | null;
}) {
  const delivery = order.type === "delivery";
  const timeline = delivery ? TIMELINE.map((entry) => entry.status === "ready" ? { ...entry, label: "Prête à partir", hint: "Le restaurant organise votre livraison" } : entry) : TIMELINE;
  const rank = Math.max(
    0,
    TIMELINE.findIndex((s) => s.status === status),
  );
  return (
    <div className="pb-8">
      <div className="sm-grain relative overflow-hidden bg-accent px-6 pb-16 pt-9 text-center text-onaccent">
        <span
          aria-hidden
          className="font-display pointer-events-none absolute -right-4 -top-6 select-none text-[clamp(6rem,4.5rem+4vw,8.25rem)] font-black leading-none tracking-[-0.05em] text-onaccent/15"
        >
          OK
        </span>
        {/*
          LA SEULE COCHE PEINTE À L'ACCENT PUR — et le garde l'interdirait à
          juste titre partout ailleurs. Ce disque est peint en `on-accent` :
          la coche dessus rejoue donc exactement le couple `onAccent/accent`,
          celui que `contraste()` vérifie sur les six directions. Ailleurs,
          l'accent posé en texte tombe sur le FOND, où il n'a aucune garantie
          (2,68:1 sur Soleil) — c'est `accentink` qui y va.

          Le jeton `accentonaccent` (globals.css) EST cette exception, et son
          nom dit sa condition d'emploi. Elle était écrite
          `text-[color:var(--cf-accent)]` : la même couleur, mais invisible au
          garde, dont le motif ne connaissait que la forme `text-accent`. Une
          porte de service dans une règle qui se voulait totale — le garde
          couvre désormais les deux formes.
        */}
        <span className="relative mx-auto mb-4 grid size-[76px] animate-pop place-items-center rounded-full bg-[color-mix(in_srgb,var(--cf-on-accent)_92%,transparent)] text-accentonaccent shadow-card">
          <Icon name="check" size={38} stroke={3} />
        </span>
        <h3 className="font-display relative text-[clamp(1.375rem,1.2rem+0.7vw,1.625rem)] font-extrabold tracking-[-0.035em]">
          C’est envoyé en cuisine
        </h3>
        {/*
          Aucune opacité : `text-onaccent` est déjà le MINIMUM que le résolveur
          garantit sur l'aplat d'accent (le couple onAccent/accent tombe à
          4,7:1 sur Marché). Rabattu à 90 %, ce paragraphe de 14 px passait à
          4,16 — sous le seuil de 1.4.3, sur la phrase qui explique au client
          ce qui va se passer maintenant.
        */}
        <p className="relative mx-auto mt-1.5 max-w-[280px] text-[14px] leading-relaxed">
          {/*
            AUCUN SMS NE PART. Le port `Notifier.notifyCustomer` est déclaré
            dans le domaine et n'a jamais eu d'adaptateur : le client lisait une
            promesse que rien ne tenait, et attendait un message qui ne
            viendrait pas. Ce qui existe VRAIMENT, c'est cette page — elle suit
            l'avancement en temps réel. On promet donc ce qu'on fait.
          */}
          {demo
            ? "Suivez la préparation juste en dessous, comme le ferait votre client."
            : "Suivez la préparation ici même — la page se met à jour toute seule."}
        </p>
      </div>

      <div className="px-4">
        {/* `relative` obligatoire : le bandeau accent est positionné, il
            passerait sinon par-dessus la carte qui le chevauche. */}
        <div className="relative -mt-11 rounded-panel border border-ink/10 bg-surface px-5 py-5 text-center shadow-deep">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-mut">
            {delivery ? "Numéro de commande" : "Numéro de retrait"}
          </p>
          <p className="font-display mt-1 text-[clamp(3.25rem,2.8rem+1.8vw,3.875rem)] font-black leading-none tracking-[-0.05em] tabular-nums text-accentink">
            {order.number}
          </p>
          {order.pickup?.slot && (
            <p className="mt-2 text-[14px] text-mut">
              {delivery ? "Livraison estimée à " : "Retrait à "}
              <span className="font-bold tabular-nums text-ink">
                {hhmm(order.pickup.slot)}
              </span>
            </p>
          )}
        </div>

        {/*
          LE CHANGEMENT DE STATUT DOIT S'ENTENDRE (4.1.3).

          La commande passe « Reçue → En préparation → Prête » par sondage, et
          rien n'annonçait ce changement : l'utilisateur de lecteur d'écran
          n'apprenait jamais que son plat l'attendait au comptoir. Une région
          vivante DISCRÈTE porte l'étape courante — plutôt qu'un `role=status`
          sur la frise entière, qui relirait les trois étapes et leurs indices
          à chaque avancement.
        */}
        <p aria-live="polite" aria-atomic="true" className="sr-only">
          {`Statut de la commande : ${timeline[rank]?.label ?? ""}. ${timeline[rank]?.hint ?? ""}`}
        </p>

        {/* Suivi : la première étape est acquise, les suivantes viennent du KDS. */}
        <ol className="mt-4 rounded-panel border border-ink/8 bg-surface2 px-4 py-2">
          {timeline.map((entry, i) => {
            const reached = i <= rank;
            const current = i === rank;
            return (
              /*
                Pas d'opacité sur la ligne : elle ramenait `text-ink` à 2,06:1
                et `text-mut` à 1,7 sur les étapes non atteintes — « En
                préparation · Ça chauffe » devenait illisible. Ce ne sont pas
                des contrôles désactivés, aucune exemption de 1.4.3 ne joue.
                L'état se lit à la pastille (verte contre `bg-ink/12`) et à
                l'encre du libellé, atténuée mais AA.
              */
              <li
                key={entry.label}
                className="flex items-center gap-3 border-b border-ink/6 py-3 last:border-b-0"
              >
                <span
                  className={cx(
                    "grid size-7 shrink-0 place-items-center rounded-full",
                    reached ? "bg-ok text-onok" : "bg-ink/12",
                  )}
                >
                  {i < rank ? (
                    <Icon name="check" size={14} stroke={3} />
                  ) : (
                    <span
                      className={cx(
                        "size-2 rounded-full",
                        reached ? "bg-onok" : "bg-ink/50",
                      )}
                    />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cx(
                      "block text-[15px] font-bold",
                      reached ? "text-ink" : "text-mut",
                    )}
                  >
                    {entry.label}
                  </span>
                  <span className="block text-[13px] text-mut">{entry.hint}</span>
                </span>
                {current && <Badge tone="ok">En cours</Badge>}
              </li>
            );
          })}
        </ol>

        {/*
          LA REMISE OBTENUE, NOMMÉE.

          Elle ne pouvait pas s'afficher avant validation — le montant est
          résolu par le serveur, jamais par le navigateur. C'est ici qu'elle se
          confirme, et le libellé porte le code : « BIENVENUE10 — Offre de
          bienvenue ». Un « −2,00 € » sans raison ferait rappeler le restaurant
          autant qu'une remise absente.
        */}
        {order.totals?.discount && (
          <div className="mt-4 flex items-baseline justify-between gap-3 rounded-panel border border-ok/25 bg-ok/8 px-4 py-3">
            <span className="min-w-0 text-[13px] text-okt">
              {order.totals.discount.reason}
            </span>
            <span className="shrink-0 text-[15px] font-extrabold text-okt">
              −<Prix cents={order.totals.discount.amount} mono={prixMono} />
            </span>
          </div>
        )}

        <div className="mt-4 flex flex-col gap-2.5">
          {demoCard ? (
            <Banner tone="prep" icon="euro" title="Paiement par carte — hors démonstration">
              En service réel, le paiement sécurisé s’ouvrirait ici et la
              commande arriverait déjà réglée en cuisine. La démonstration
              n’appelle aucun prestataire de paiement :{" "}
              <Prix cents={order.totals?.total ?? 0} mono={prixMono} /> resteraient
              dus au comptoir.
            </Banner>
          ) : paidOnline ? (
            <Banner tone="ok" icon="check" title="Paiement accepté">
              <Prix cents={order.totals?.total ?? 0} mono={prixMono} /> réglés en
              ligne. {delivery ? "Votre restaurant prépare votre livraison." : "Présentez votre numéro de retrait au comptoir."}
            </Banner>
          ) : (
            <Banner icon="euro" title="À régler au comptoir">
              <Prix cents={order.totals?.total ?? 0} mono={prixMono} /> à régler au
              moment du retrait.
            </Banner>
          )}

          {/*
            LE SEUL ENDROIT DU TUNNEL OÙ LA FIDÉLITÉ A SA PLACE.

            C’est le moment où l’achat existe déjà. Le contrat ne permet donc
            plus d’y rattacher une carte : on peut seulement expliquer que la
            commande en ligne ne crédite pas le programme pendant le pilote et
            ouvrir la consultation du solde et des récompenses. Placé plus tôt,
            ce rappel resterait une distraction dans le parcours d’achat.
          */}
          {loyalty && <FideliteApresCommande resume={loyalty} />}

          {demo && (
            <p className="text-center text-[12px] leading-relaxed text-mut">
              Démonstration&nbsp;: aucune commande n’est partie en cuisine et
              aucun SMS n’a été envoyé. Rechargez la page pour repartir de zéro.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
