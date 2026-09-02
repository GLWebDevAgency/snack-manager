"use client";

/**
 * Suivi de commande sans compte — `/t/[id]`.
 *
 * Le client voit trois étapes : Reçue → En préparation → Prête. Le statut réel
 * vient de la cuisine (KDS) ; ici on interroge l’API toutes les 10 s. Le
 * rafraîchissement s’arrête dès que la commande est terminée ou annulée, et se
 * met en pause quand l’onglet passe en arrière-plan (pas de sondage inutile
 * pendant que le téléphone est dans la poche).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { TYPE_PAIRS, type Brand, type OrderStatus, type OrderTicket } from "@sm/contracts";
import { cx } from "@/lib/cx";
import { Icon } from "@/components/ui";
import { classesPolices } from "@/components/masque/polices";
import { styleDuMasque } from "@/components/masque/styleDuMasque";
import { loadTracking, type TrackingState } from "./api";
import { hhmm } from "./helpers";
import { Banner, Dot, Money, Prix, Surface } from "./primitives";

const POLL_MS = 10_000;

/** Les trois étapes montrées au client (« remise » et « annulée » à part). */
const TIMELINE: { status: OrderStatus; label: string; hint: string }[] = [
  { status: "new", label: "Reçue", hint: "La cuisine a votre commande" },
  { status: "preparing", label: "En préparation", hint: "Ça chauffe" },
  { status: "ready", label: "Prête", hint: "À récupérer au comptoir" },
];

const RANK: Record<OrderStatus, number> = {
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
  const timerRef = useRef<number | null>(null);

  const status: OrderStatus = state.status;
  const rank = RANK[status] ?? 0;
  const finished = status === "delivered" || status === "cancelled";

  const refresh = useCallback(async () => {
    try {
      const next = await loadTracking(orderId, trackingToken);
      setState(next);
      setStale(false);
    } catch {
      // Réseau capricieux : on garde le dernier état connu et on le signale.
      setStale(true);
    }
  }, [orderId, trackingToken]);

  useEffect(() => {
    if (finished) return;
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
  }, [finished, refresh]);

  const masque = styleDuMasque(brand);
  // La règle des prix vient du masque : cette page est une racine, elle la
  // lit — dans la paire typographique, pas en résolvant la marque une
  // deuxième fois (`styleDuMasque()` vient de le faire).
  const { prixMono } = TYPE_PAIRS[brand.type.pair];

  const slotIso = ticket?.pickup?.slotIso ?? state.pickupSlot;
  const slotLabel = slotIso ? hhmm(slotIso) : null;
  const pickupNumber = ticket?.pickupNumber ?? state.number;
  const phones = ticket?.header.phones ?? [];

  return (
    <main
      style={masque}
      // `clip` et non `hidden` : `overflow-x: hidden` ferait de cette racine
      // un conteneur de défilement (voir Storefront).
      className={cx(classesPolices, "font-body min-h-dvh overflow-x-clip bg-bg pb-16 text-ink")}
    >
      <header className="border-b border-ink/6 bg-surface px-4 pb-6 pt-6">
        <div className="mx-auto w-full max-w-[520px]">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-mut">
            {ticket?.header.tenantName ?? "Commande en ligne"}
          </p>
          <h1 className="font-display mt-1 text-[clamp(1.375rem,1.2rem+0.7vw,1.625rem)] font-extrabold tracking-[-0.035em] text-ink">
            {status === "cancelled"
              ? "Commande annulée"
              : status === "ready"
                ? "Votre commande est prête"
                : status === "delivered"
                  ? "Commande remise"
                  : "Commande en cours"}
          </h1>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[520px] flex-col gap-4 px-4 pt-5">
        {/* ── Numéro de retrait : l’information à voir de loin ── */}
        <Surface className="px-5 py-6 text-center">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-mut">
            Numéro de retrait
          </p>
          <p className="font-display mt-1 text-[clamp(3.5rem,3rem+2vw,4.25rem)] font-black leading-none tracking-[-0.05em] tabular-nums text-accent">
            {pickupNumber}
          </p>
          <p className="mt-3 flex items-center justify-center gap-2 text-[14px] text-mut">
            {slotLabel && (
              <>
                <Icon name="clock" size={15} />
                Retrait à{" "}
                <span className="font-bold tabular-nums text-ink">{slotLabel}</span>
              </>
            )}
          </p>
        </Surface>

        {status === "cancelled" ? (
          <Banner tone="alert" icon="close" title="Commande annulée">
            Le restaurant a annulé cette commande. Rapprochez-vous du comptoir
            {phones[0] ? ` ou appelez le ${phones[0]}` : ""}.
          </Banner>
        ) : (
          <Surface className="p-4">
            <ol className="flex flex-col">
              {TIMELINE.map((step, i) => {
                const reached = rank >= RANK[step.status];
                const current = rank === RANK[step.status] && !finished;
                return (
                  <li
                    key={step.status}
                    className={cx(
                      "flex items-center gap-3.5 py-2.5",
                      !reached && "opacity-40",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cx(
                        "relative grid size-8 shrink-0 place-items-center rounded-full transition-colors duration-300 ease-sm",
                        reached ? "bg-ok text-onok" : "bg-ink/10 text-mut",
                      )}
                    >
                      {reached && rank > RANK[step.status] ? (
                        <Icon name="check" size={15} stroke={3} />
                      ) : (
                        <span
                          className={cx(
                            "block size-2 rounded-full",
                            reached ? "bg-onok" : "bg-ink/40",
                          )}
                        />
                      )}
                      {i < TIMELINE.length - 1 && (
                        <span
                          className={cx(
                            "absolute left-1/2 top-full h-2.5 w-0.5 -translate-x-1/2",
                            rank > RANK[step.status] ? "bg-ok" : "bg-ink/10",
                          )}
                        />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-bold text-ink">
                        {step.label}
                      </span>
                      <span className="block text-[13px] text-mut">{step.hint}</span>
                    </span>
                    {current && (
                      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-pill border border-ok/40 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-okt">
                        <Dot tone="ok" />
                        En cours
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
        {ticket && (
        <Surface className="p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-mut">
            Votre commande
          </p>
          <ul className="mt-3 flex flex-col gap-3">
            {ticket.lines.map((line, i) => (
              <li key={`${line.name}-${i}`} className="flex items-start gap-3">
                <span className="min-w-6 shrink-0 text-[14px] font-extrabold tabular-nums text-accent">
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

          <div className="mt-4 flex items-center justify-between border-t border-ink/8 pt-3">
            <span className="text-[15px] font-semibold text-mut">Total</span>
            <Money
              cents={ticket.totals.total}
              mono={prixMono}
              className="text-[clamp(1.25rem,1.1rem+0.5vw,1.375rem)] text-ink"
            />
          </div>
          <p className="mt-1 text-right text-[12px] text-mut">
            {ticket.payment.methodLabel}
            {ticket.payment.paid && (
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
            Où récupérer
          </p>
          <p className="mt-2 text-[15px] font-semibold text-ink">
            {ticket.header.tenantName}
          </p>
          {ticket.header.address && (
            <p className="mt-0.5 text-[14px] leading-relaxed text-mut">
              {ticket.header.address}
            </p>
          )}
          {ticket.header.phones.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {ticket.header.phones.map((phone) => (
                <a
                  key={phone}
                  href={`tel:${phone.replace(/\s/g, "")}`}
                  className="inline-flex min-h-11 items-center gap-2 rounded-pill border border-ink/12 bg-surface2 px-3.5 py-2 text-[14px] font-bold tabular-nums text-ink transition-transform duration-200 ease-sm active:scale-[0.97]"
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
