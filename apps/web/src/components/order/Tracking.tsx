"use client";

/**
 * Suivi de commande sans compte — `/t/[id]`.
 *
 * Le suivi distingue la confirmation du paiement livraison de la prise en
 * cuisine, puis de la remise par la caisse ou le livreur. L’API est interrogée
 * toutes les 10 s. Le rafraîchissement s’arrête une fois la commande terminée
 * ou annulée (sauf remboursement en attente), et se
 * met en pause quand l’onglet passe en arrière-plan (pas de sondage inutile
 * pendant que le téléphone est dans la poche).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TYPE_PAIRS, type Brand, type OrderStatus, type OrderTicket, type PaymentIntentReady } from "@sm/contracts";
import { cx } from "@/lib/cx";
import { Icon } from "@/components/ui";
import { classesPolices } from "@/components/masque/polices";
import { FeuilleDuMasque } from "@/components/masque/FeuilleDuMasque";
import { styleDuMasque } from "@/components/masque/styleDuMasque";
import { createPaymentIntent, loadTracking, networkApi, PublicApiError, type TrackingState } from "./api";
import { StripeCard, apparenceStripeDe, type StripePaymentOutcome } from "./StripeCard";
import { hhmm } from "./helpers";
import { Banner, Dot, Money, Prix, PrimaryAction, Surface } from "./primitives";
import { CounterPaymentAction } from "./CounterPaymentAction";
import { PAYMENT_VERIFICATION_MESSAGE, canRequestCounterPayment, paymentSummaryLabel, requestCounterPayment } from "./checkout-payment";
import { CustomerDeliveryProof } from "./CustomerDeliveryProof";
import { DeliveryPaymentReturnError, prepareDeliveryPaymentReturn } from "./delivery-payment-return";
import { readDeliveryProofAccessFragment } from "./delivery-proof-access";

const POLL_MS = 10_000;

type TimelineStep = { status: OrderStatus | "payment"; label: string; hint: string; upcomingHint: string };

const TIMELINE: TimelineStep[] = [
  { status: "new", label: "Reçue", hint: "La cuisine a votre commande", upcomingHint: "Après confirmation du paiement" },
  { status: "preparing", label: "En préparation", hint: "Ça chauffe", upcomingHint: "Préparation par le restaurant" },
  { status: "ready", label: "Prête", hint: "À récupérer au comptoir", upcomingHint: "Après la préparation" },
];

const RANK: Record<TimelineStep["status"], number> = {
  payment: -1,
  new: 0,
  preparing: 1,
  ready: 2,
  delivered: 3,
  cancelled: -1,
};

export function Tracking({
  orderId,
  trackingToken,
  ticket,
  initial,
  brand,
}: {
  orderId: string;
  /** Secret du lien de suivi : sans lui, le rafraîchissement reçoit un 404. */
  trackingToken: string;
  /**
   * Récapitulatif figé (lignes, totaux, restaurant). `null` quand l’API ne
   * publie pas encore la route ticket : le suivi reste utilisable, seul le
   * détail de la commande manque.
   */
  ticket: OrderTicket | null;
  /** Premier état connu — évite un écran vide au chargement. */
  initial: TrackingState;
  brand: Brand;
}) {
  const [state, setState] = useState<TrackingState>(initial);
  const [stale, setStale] = useState(false);
  const [paymentIntent, setPaymentIntent] = useState<PaymentIntentReady | null>(null);
  const [resuming, setResuming] = useState(false);
  const [switchingCounter, setSwitchingCounter] = useState(false);
  const [confirmingCard, setConfirmingCard] = useState(false);
  const [bankProcessing, setBankProcessing] = useState(false);
  const bankProcessingRef = useRef(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const paymentActionRef = useRef(false);
  const refreshSequence = useRef(0);

  const status: OrderStatus = state.status;
  const finished = status === "delivered" || status === "cancelled";
  const delivery = state.fulfillment === "delivery" || ticket?.type === "delivery";
  const dispatched = Boolean(state.delivery?.dispatchedAt);
  const payment = state.payment;
  const paymentBusy = resuming || switchingCounter || confirmingCard;
  const counterAvailable = !bankProcessing && canRequestCounterPayment(state,
    delivery ? "delivery" : state.fulfillment ?? (ticket?.type === "pickup" ? "pickup" : undefined));
  // Même règle que le KDS : une livraison n'est prise en cuisine qu'une
  // fois le paiement confirmé par le serveur. Pending inclut une éventuelle
  // confirmation bancaire en cours : ce n'est jamais la preuve d'un refus.
  // Une remise historique reste terminale, y compris après remboursement.
  const refundedDelivery = delivery && !finished && payment?.status === "refunded";
  const awaitingPayment = delivery && !finished && !refundedDelivery && payment?.status !== "paid";
  const rank = awaitingPayment ? RANK.payment : RANK[status];
  const fulfillmentSteps = TIMELINE.map((step) => {
    if (step.status === "ready" && delivery) return {
      ...step, label: dispatched && !finished && !awaitingPayment ? "En livraison" : "Prête à partir",
      hint: finished ? "Préparation terminée" : dispatched ? "Votre commande est en route" : "En attente du départ du livreur",
    };
    if (finished) return { ...step, hint: step.status === "new" ? "Commande reçue par le restaurant" : "Préparation terminée" };
    return step;
  });
  const timeline: TimelineStep[] = [
    ...(awaitingPayment ? [{ status: "payment" as const, label: "Confirmation du paiement",
      hint: "La préparation commencera après confirmation du paiement.", upcomingHint: "" }] : []),
    ...fulfillmentSteps,
    ...(status === "delivered" ? [{ status: "delivered" as const,
      label: delivery ? "Livrée" : "Remise", hint: "Remise confirmée", upcomingHint: "" }] : []),
  ];
  const title = status === "cancelled" ? "Commande annulée"
    : awaitingPayment ? "En attente de confirmation du paiement"
      : refundedDelivery ? "Commande remboursée"
        : status === "delivered" ? delivery ? "Commande livrée" : "Commande remise"
          : status === "ready" ? delivery
            ? dispatched ? "Votre commande est en route" : "Votre commande est prête à partir"
            : "Votre commande est prête"
            : "Commande en cours";

  const refresh = useCallback(async (force = false) => {
    if (paymentActionRef.current && !force) return;
    const sequence = ++refreshSequence.current;
    try {
      const next = await loadTracking(orderId, trackingToken);
      if (sequence !== refreshSequence.current || next._id !== orderId) return;
      setState(next);
      setStale(false);
      if ((next.payment && (next.payment.status !== "pending" || next.payment.method !== "online")) || ["cancelled", "delivered"].includes(next.status)) {
        setPaymentIntent(null);
        bankProcessingRef.current = false;
        setBankProcessing(false);
      }
    } catch {
      // Réseau capricieux : on garde le dernier état connu et on le signale.
      if (sequence === refreshSequence.current) setStale(true);
    }
  }, [orderId, trackingToken]);

  useEffect(() => {
    if (finished && !payment?.pendingRefundCents) return;
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
      timerRef.current = window.setTimeout(tick, POLL_MS);
    };
    timerRef.current = window.setTimeout(tick, POLL_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [finished, payment?.pendingRefundCents, refresh]);

  /*
   * MÉMORISÉ — `resoudreMarque()` recalcule une trentaine de mélanges et
   * jusqu'à quatre recherches d'AA par pas de 1/200 (~0,5 ms). Sans ce
   * `useMemo`, la facture était payée à CHAQUE rendu de la racine — donc à
   * chaque frappe dans le tunnel et à chaque tick du suivi — pour un objet
   * identique. Sa référence sert aussi de `style` : la recréer forçait React
   * à repeindre tout le sous-arbre.
   */
  const masque = useMemo(() => styleDuMasque(brand), [brand]);
  // La règle des prix vient du masque : cette page est une racine, elle la
  // lit — dans la paire typographique, pas en résolvant la marque une
  // deuxième fois (`styleDuMasque()` vient de le faire).
  const { prixMono } = TYPE_PAIRS[brand.type.pair];

  const slotIso = ticket?.pickup?.slotIso ?? state.pickupSlot;
  const slotLabel = slotIso ? hhmm(slotIso) : null;
  const pickupNumber = ticket?.pickupNumber ?? state.number;
  const phones = ticket?.header.phones ?? [];
  const appearance = useMemo(() => apparenceStripeDe(masque, brand), [masque, brand]);

  async function resumePayment() {
    if (paymentActionRef.current || bankProcessingRef.current || finished || payment?.method !== "online" || payment.status !== "pending") return;
    paymentActionRef.current = true;
    refreshSequence.current++;
    setResuming(true);
    setPaymentError(null);
    try {
      if (delivery) await prepareDeliveryPaymentReturn(ticket?.header.slug ?? null, orderId, trackingToken);
      const next = await createPaymentIntent(orderId, trackingToken);
      if (next.unavailable || !next.publishableKey) {
        setPaymentError(next.unavailable ? next.reason : "Paiement momentanément indisponible. Réessayez ou contactez le restaurant.");
        await refresh(true);
      } else setPaymentIntent(next);
    } catch (cause) {
      setPaymentError(cause instanceof PublicApiError || cause instanceof DeliveryPaymentReturnError ? cause.message : "Impossible de reprendre le paiement. Votre commande est conservée : réessayez sans en créer une nouvelle.");
      await refresh(true);
    } finally { paymentActionRef.current = false; setResuming(false); }
  }

  function startCardConfirmation() {
    if (paymentActionRef.current || bankProcessingRef.current || finished || payment?.method !== "online" || payment.status !== "pending") return false;
    if (delivery && readDeliveryProofAccessFragment(window.location.hash)) {
      setPaymentIntent(null); setPaymentError("Reprenez la vérification du paiement pour sauvegarder l’accès privé avant de continuer."); return false;
    }
    paymentActionRef.current = true;
    refreshSequence.current++;
    setConfirmingCard(true);
    return true;
  }

  function finishCardConfirmation(outcome: StripePaymentOutcome) {
    bankProcessingRef.current = outcome !== "idle";
    paymentActionRef.current = false;
    setConfirmingCard(false);
    // Même succeeded doit attendre la projection serveur : un webhook peut
    // arriver après la réponse Stripe, sans rouvrir un second moyen entretemps.
    setBankProcessing(outcome !== "idle");
    if (outcome !== "idle") void refresh();
  }

  async function switchCounterPayment() {
    if (paymentActionRef.current || bankProcessingRef.current || !counterAvailable) return;
    paymentActionRef.current = true;
    refreshSequence.current++;
    setSwitchingCounter(true);
    setPaymentError(null);
    try {
      const next = await requestCounterPayment(networkApi, { _id: orderId, trackingToken });
      setPaymentIntent(null);
      setState((previous) => ({ ...previous, payment: { ...next.payment,
        refundedCents: previous.payment?.refundedCents ?? 0, pendingRefundCents: previous.payment?.pendingRefundCents ?? 0 } }));
      setStale(false);
    } catch (cause) {
      setPaymentError(cause instanceof PublicApiError ? cause.message : PAYMENT_VERIFICATION_MESSAGE);
      if (cause instanceof PublicApiError && cause.status === 409) { bankProcessingRef.current = true; setBankProcessing(true); }
      setPaymentIntent(null);
      await refresh(true);
    } finally { paymentActionRef.current = false; setSwitchingCounter(false); }
  }

  return (
    <main
      style={masque}
      // `clip` et non `hidden` : `overflow-x: hidden` ferait de cette racine
      // un conteneur de défilement (voir Storefront).
      className={cx(classesPolices, "font-body min-h-dvh overflow-x-clip bg-bg pb-16 text-ink")}
    >
      {/* Le masque remonte au document : canevas, rebond iOS, ascenseur
          et contrôles natifs — voir `FeuilleDuMasque`. */}
      <FeuilleDuMasque brand={brand} />
      <header className="border-b border-ink/6 bg-surface px-4 pb-6 pt-6">
        <div className="mx-auto w-full max-w-[520px]">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-mut">
            {ticket?.header.tenantName ?? "Commande en ligne"}
          </p>
          {/*
            LE TITRE EST LA RÉGION VIVANTE (4.1.3).

            Le statut change par sondage — « Commande en cours » devient
            « Votre commande est prête » — et rien ne l'annonçait : le seul
            `aria-live` de la page entourait une phrase FIXE (« Statut
            actualisé toutes les 10 secondes »), qui ne change jamais et
            n'émet donc jamais rien. Un utilisateur de lecteur d'écran ne
            savait pas que son plat l'attendait au comptoir. `aria-atomic`
            parce que la phrase entière fait sens, pas le mot qui a changé.
          */}
          <h1
            aria-live="polite"
            aria-atomic="true"
            className="font-display mt-1 text-[clamp(1.375rem,1.2rem+0.7vw,1.625rem)] font-extrabold tracking-[-0.035em] text-ink"
          >
            {title}
          </h1>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[520px] flex-col gap-4 px-4 pt-5">
        {/* ── Numéro de retrait : l’information à voir de loin ── */}
        <Surface className="px-5 py-6 text-center">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-mut">
            {delivery ? "Numéro de commande" : "Numéro de retrait"}
          </p>
          <p className="font-display mt-1 text-[clamp(3.5rem,3rem+2vw,4.25rem)] font-black leading-none tracking-[-0.05em] tabular-nums text-accentink">
            {pickupNumber}
          </p>
          <p className="mt-3 flex items-center justify-center gap-2 text-[14px] text-mut">
            {slotLabel && (
              <>
                <Icon name="clock" size={15} />
                {finished || refundedDelivery ? "Créneau initial" : awaitingPayment ? "Créneau souhaité" : delivery ? "Arrivée estimée vers" : "Retrait à"}{" "}
                <span className="font-bold tabular-nums text-ink">{slotLabel}</span>
              </>
            )}
          </p>
        </Surface>

        {delivery && <CustomerDeliveryProof key={`${orderId}:${stale}:${dispatched}:${payment?.status}:${finished}`} orderId={orderId} tenant={ticket?.header.slug ?? null} ready={!stale && dispatched && payment?.status === "paid"} finished={finished} />}
        {status === "cancelled" ? (
          <Banner tone="alert" icon="close" title="Commande annulée">
            Le restaurant a annulé cette commande. Contactez le restaurant
            {phones[0] ? ` ou appelez le ${phones[0]}` : ""}.
          </Banner>
        ) : refundedDelivery ? (
          <Banner tone="prep" icon="clock" title="Paiement remboursé">
            Le paiement de cette commande a été remboursé. Contactez le restaurant pour faire le point sur votre commande.
          </Banner>
        ) : (
          <Surface className="p-4">
            <ol aria-label="Étapes de votre commande" className="flex flex-col">
              {timeline.map((step, i) => {
                const reached = rank >= RANK[step.status];
                const current = rank === RANK[step.status] && !finished;
                const waiting = step.status === "payment";
                return (
                  /*
                    Pas d'opacité sur les étapes à venir : à 40 %, le libellé
                    `text-ink` tombait à 2,06:1 et l'indice `text-mut` à 1,7.
                    Ce sont des lignes d'INFORMATION, pas des contrôles
                    désactivés — 1.4.3 s'applique sans exemption. La hiérarchie
                    vient de la pastille (verte contre `bg-ink/10`) et de
                    l'encre atténuée du libellé, qui reste AA.
                  */
                  <li key={step.status} aria-current={current ? "step" : undefined} className="flex items-center gap-3.5 py-2.5">
                    <span
                      aria-hidden
                      className={cx(
                        "relative grid size-8 shrink-0 place-items-center rounded-full transition-colors duration-med ease-sm",
                        waiting ? "bg-prep text-onprep" : reached ? "bg-ok text-onok" : "bg-ink/10 text-mut",
                      )}
                    >
                      {reached && rank > RANK[step.status] ? (
                        <Icon name="check" size={15} stroke={3} />
                      ) : (
                        <span
                          className={cx(
                            "block size-2 rounded-full",
                            waiting ? "bg-onprep" : reached ? "bg-onok" : "bg-ink/40",
                          )}
                        />
                      )}
                      {i < timeline.length - 1 && (
                        <span
                          className={cx(
                            "absolute left-1/2 top-full h-2.5 w-0.5 -translate-x-1/2",
                            rank > RANK[step.status] ? "bg-ok" : "bg-ink/10",
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
                        {step.label}
                      </span>
                      <span className="block text-[13px] text-mut">{reached ? step.hint : step.upcomingHint}</span>
                    </span>
                    {current && (
                      <span className={cx("inline-flex shrink-0 items-center gap-1.5 rounded-pill border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em]", waiting ? "border-prep/40 text-prept" : "border-ok/40 text-okt")}>
                        <Dot tone={waiting ? "prep" : "ok"} />
                        {waiting ? "À confirmer" : "En cours"}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>

            <p
              aria-live="polite"
              className="mt-3 border-t border-ink/8 pt-3 text-[12px] text-mut"
            >
              {finished
                ? "Suivi terminé."
                : stale
                  ? "Connexion perdue — dernier état connu affiché."
                  : "Statut actualisé automatiquement toutes les 10 secondes."}
            </p>
          </Surface>
        )}

        {/* ── Récapitulatif (absent si la route ticket n’est pas publiée) ── */}
        {!finished && payment?.status === "pending" && payment.method === "online" && (
          <Surface className="p-4">
            <h2 className="font-semibold text-ink">Paiement à vérifier</h2>
            <p className="mt-2 text-sm text-mut">{delivery ? "La préparation commencera après confirmation du paiement. Si vous venez de payer, la confirmation bancaire peut encore être en cours. Ne payez pas une deuxième fois." : "Reprenez votre paiement sur cette commande, sans la recréer."}</p>
            {paymentError && <p role="alert" className="mt-3 text-sm text-mut">{paymentError}</p>}
            {paymentIntent?.publishableKey ? <StripeCard
              {...paymentIntent} publishableKey={paymentIntent.publishableKey}
              apparence={appearance} prixMono={prixMono} returnUrl={typeof window === "undefined" ? "" : `${window.location.origin}/t/${encodeURIComponent(orderId)}?t=${encodeURIComponent(trackingToken)}`}
              disabled={switchingCounter} onConfirmStart={startCardConfirmation} onConfirmEnd={finishCardConfirmation}
              onPaid={() => { setPaymentIntent(null); }}
            /> : <div className="mt-4"><PrimaryAction onClick={() => void resumePayment()} disabled={paymentBusy || bankProcessing}>{resuming ? "Chargement…" : "Reprendre le paiement"}</PrimaryAction></div>}
            {bankProcessing && <p role="status" className="mt-3 text-sm text-mut">Paiement en cours de vérification. Ne payez pas une deuxième fois ; le suivi se mettra à jour automatiquement.</p>}
            {counterAvailable && <CounterPaymentAction disabled={paymentBusy} busy={switchingCounter} onConfirm={switchCounterPayment} />}
          </Surface>
        )}
        {payment && (payment.refundedCents > 0 || payment.pendingRefundCents > 0) && (
          <div aria-live="polite"><Surface className="p-4">
            <h2 className="font-semibold text-ink">Remboursement</h2>
            {payment.refundedCents > 0 && <p className="mt-2 text-sm text-mut"><Money cents={payment.refundedCents} mono={prixMono} /> remboursés. Le délai d’affichage dépend de votre banque.</p>}
            {payment.pendingRefundCents > 0 && <p className="mt-2 text-sm text-mut"><Money cents={payment.pendingRefundCents} mono={prixMono} /> en cours de remboursement.</p>}
          </Surface></div>
        )}
        {ticket && (
        <Surface className="p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-mut">
            Votre commande
          </p>
          <ul className="mt-3 flex flex-col gap-3">
            {ticket.lines.map((line, i) => (
              <li key={`${line.name}-${i}`} className="flex items-start gap-3">
                <span className="min-w-6 shrink-0 text-[14px] font-extrabold tabular-nums text-accentink">
                  {line.qty}×
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-ink">
                    {line.name}
                    {line.variantName ? ` · ${line.variantName}` : ""}
                  </span>
                  {(line.options.length > 0 || line.removed.length > 0) && (
                    <span className="block text-[13px] leading-snug text-mut">
                      {[
                        ...line.options.map((o) => o.name),
                        ...line.removed.map((r) => `sans ${r}`),
                      ].join(" · ")}
                    </span>
                  )}
                  {line.note && (
                    <span className="block text-[13px] italic text-prept">
                      « {line.note} »
                    </span>
                  )}
                </span>
                <Money cents={line.lineTotal} mono={prixMono} className="shrink-0 text-[14px]" />
              </li>
            ))}
          </ul>

          {ticket.note && (
            <p className="mt-3 rounded-card border-l-2 border-accent bg-ink/[0.03] px-3 py-2 text-[13px] leading-relaxed text-mut">
              <span className="font-bold text-ink">Note : </span>
              {ticket.note}
            </p>
          )}

          {ticket.totals.deliveryFee != null && ticket.totals.deliveryFee > 0 && <div className="mt-3 flex items-center justify-between text-sm text-mut"><span>Livraison incluse dans le total</span><Money cents={ticket.totals.deliveryFee} mono={prixMono} /></div>}
          <div className="mt-4 flex items-center justify-between border-t border-ink/8 pt-3">
            <span className="text-[15px] font-semibold text-mut">Total</span>
            <Money
              cents={ticket.totals.total}
              mono={prixMono}
              className="text-[clamp(1.25rem,1.1rem+0.5vw,1.375rem)] text-ink"
            />
          </div>
          <p className="mt-1 text-right text-[12px] text-mut">
            {paymentSummaryLabel(payment, ticket.payment)}
            {(payment ? payment.status === "paid" : ticket.payment.paid) && (
              <>
                {" · "}
                <Prix cents={ticket.totals.total} mono={prixMono} />
              </>
            )}
          </p>
        </Surface>
        )}

        {/* ── Où récupérer ── */}
        {ticket && (
        <Surface className="p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-mut">
            {delivery ? "Adresse de livraison" : "Où récupérer"}
          </p>
          <p className="mt-2 text-[15px] font-semibold text-ink">
            {delivery && ticket.delivery ? ticket.delivery.address.line1 : ticket.header.tenantName}
          </p>
          {(delivery ? ticket.delivery?.address : ticket.header.address) && (
            <p className="mt-0.5 text-[14px] leading-relaxed text-mut">
              {delivery && ticket.delivery ? `${ticket.delivery.address.line2 ?? ""} ${ticket.delivery.address.postalCode} ${ticket.delivery.address.city}` : ticket.header.address}
            </p>
          )}
          {ticket.header.phones.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {ticket.header.phones.map((phone) => (
                <a
                  key={phone}
                  href={`tel:${phone.replace(/\s/g, "")}`}
                  className="inline-flex min-h-11 items-center gap-2 rounded-pill border border-ink/12 bg-surface2 px-3.5 py-2 text-[14px] font-bold tabular-nums text-ink transition-transform duration-fast ease-sm active:scale-[0.97]"
                >
                  <Icon name="phone" size={15} />
                  {phone}
                </a>
              ))}
            </div>
          )}
        </Surface>
        )}
      </div>
    </main>
  );
}
