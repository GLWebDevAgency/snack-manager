"use client";

/**
 * Drawer « Fiche commande » (spec backoffice §6.4) : badges, téléphone,
 * articles avec options/notes, total accent, timeline 4 étapes, footer
 * Imprimer + Annuler la commande (ajout production).
 * Le contenu relit la commande dans l'état courant : les changements de
 * statut effectués derrière le drawer s'y reflètent en direct.
 */

import { Fragment } from "react";
import type { OrderStatus } from "@sm/contracts";
import { cx } from "@/lib/cx";
import { fmtEuro } from "@/lib/format";
import { Btn, Drawer, Icon, Pill, StatusBadge } from "@/components/ui";
import { hasOnlinePaymentToRefund } from "./refund-eligibility";
import {
  CHANNEL_LABELS,
  TYPE_LABELS,
  customerName,
  isPaid,
  shortId,
  slotHHMM,
  timeHHMM,
  type Order,
} from "./types";

/** Rang d'avancement pour la timeline (cancelled → seule « Reçue » est faite). */
const TIMELINE_RANK: Partial<Record<OrderStatus, number>> = {
  new: 0,
  preparing: 1,
  ready: 2,
  delivered: 3,
};

const STEPS: { label: string; status: OrderStatus | null }[] = [
  { label: "Reçue", status: null }, // toujours faite (horodatée par createdAt)
  { label: "En préparation", status: "preparing" },
  { label: "Prête", status: "ready" },
  { label: "Remise au client", status: "delivered" },
];

/** Date de la dernière entrée d'historique pour un statut donné. */
function historyAt(order: Order, status: string): string | null {
  for (let i = order.statusHistory.length - 1; i >= 0; i--) {
    const entry = order.statusHistory[i];
    if (entry && entry.status === status) return entry.at;
  }
  return null;
}

export function OrderDrawer({
  order,
  onClose,
  onPrint,
  onCancel,
  onRefund,
  onManageDelivery,
}: {
  order: Order;
  onClose: () => void;
  onPrint: (order: Order) => void;
  onCancel: (order: Order) => void;
  onRefund?: (order: Order) => void;
  onManageDelivery?: (order: Order) => void;
}) {
  const rank = TIMELINE_RANK[order.status] ?? 0;
  const cancelled = order.status === "cancelled";
  const cancellable = order.status !== "delivered" && !cancelled;
  const cancelledAt = historyAt(order, "cancelled");
  const slot = slotHHMM(order);
  const phone = order.pickup?.customerPhone;

  return (
    <Drawer
      open
      onClose={onClose}
      label={`Fiche commande n°${order.number}`}
      width={400}
      title={
        <span className="block whitespace-normal">
          <span className="cf-fig block text-[32px] font-black leading-none text-accent">
            n°{order.number}
          </span>
          <span className="mt-1 block text-base font-bold text-ink">
            {customerName(order)}
          </span>
          <span className="block text-[13px] font-normal text-mut">
            {shortId(order)} · {CHANNEL_LABELS[order.channel]}
          </span>
        </span>
      }
      footer={
        <div className="flex flex-wrap gap-2.5">
          <Btn
            variant="ghost"
            size="sm"
            icon="print"
            className="flex-1"
            onClick={() => onPrint(order)}
          >
            Imprimer
          </Btn>
          {cancellable && (
            <Btn
              variant="ink"
              size="sm"
              icon="close"
              className="flex-1"
              onClick={() => onCancel(order)}
            >
              Annuler la commande
            </Btn>
          )}
          {onRefund && hasOnlinePaymentToRefund(order.payment) && (
            <Btn variant="ghost" size="sm" className="w-full" onClick={() => onRefund(order)}>
              {order.payment.status === "refunded" ? "Voir le remboursement" : "Rembourser"}
            </Btn>
          )}
        </div>
      }
    >
      <div className="p-5">
        {/* ── Badges statut / paiement / retrait ── */}
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={order.status} />
          {isPaid(order) ? (
            <Pill className="bg-ok text-[#0B1F0E]">
              {order.payment.method === "online" ? "Payée en ligne" : "Payée"}
            </Pill>
          ) : order.payment.status === "refunded" ? (
            <Pill variant="out">Remboursée</Pill>
          ) : (
            <Pill variant="out">À encaisser</Pill>
          )}
          {(order.payment.refundedCents ?? 0) > 0 && order.payment.status !== "refunded" && <Pill variant="out">Remboursé : {fmtEuro(order.payment.refundedCents!)}</Pill>}
          {(order.payment.pendingRefundCents ?? 0) > 0 && <Pill variant="out">Remboursement en attente</Pill>}
          {slot ? (
            <Pill variant="out">
              {order.type === "delivery" ? "Livraison" : "Retrait"} <span className="cf-fig">{slot}</span>
            </Pill>
          ) : (
            <Pill variant="out">{TYPE_LABELS[order.type]}</Pill>
          )}
        </div>

        {order.delivery && <section className="mt-4 rounded-ctrl border border-line2 p-3" aria-label="Livraison">
          <h3 className="text-sm font-bold text-ink">{order.delivery.deliveredAt ? "Livrée" : order.delivery.dispatchedAt ? "En route" : "Adresse de livraison"}</h3>
          <address className="mt-2 text-sm not-italic text-ink">{order.delivery.address.line1}
            {order.delivery.address.line2 && <><br />{order.delivery.address.line2}</>}<br />
            {order.delivery.address.postalCode} {order.delivery.address.city}</address>
          {order.delivery.instructions && <p className="mt-2 text-sm text-prept">{order.delivery.instructions}</p>}
          {order.delivery.dispatchedAt && <p className="mt-2 text-xs text-mut">Départ à {timeHHMM(order.delivery.dispatchedAt)}{order.delivery.driverName ? ` · ${order.delivery.driverName}` : ""}</p>}
          {onManageDelivery && <Btn variant="ghost" className="mt-3 min-h-11" onClick={() => onManageDelivery(order)}>Gérer la livraison</Btn>}
        </section>}

        {/* ── Téléphone ── */}
        {phone && (
          <a
            href={`tel:${phone.replace(/\s/g, "")}`}
            className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-ink"
          >
            <Icon name="phone" size={15} className="text-accent" />
            <span className="cf-fig">{phone}</span>
          </a>
        )}

        {/* ── Articles ── */}
        <section className="mt-5" aria-label="Articles de la commande">
          <h3 className="mb-2 text-[11px] font-bold uppercase tracking-[0.06em] text-mut">
            Articles
          </h3>
          <ul className="flex flex-col gap-2">
            {order.lines.map((line, i) => {
              const details = [
                ...(line.variantName ? [line.variantName] : []),
                ...line.options.map((op) => op.name),
                ...line.removed.map((r) => `sans ${r}`),
              ];
              return (
                <li
                  key={`${line.productId}-${i}`}
                  className="flex items-start gap-2 rounded-ctrl border border-white/6 bg-[image:var(--cf-elev-gradient)] px-3 py-[9px]"
                >
                  <span className="cf-fig min-w-[22px] shrink-0 text-[15px] font-extrabold text-accent">
                    {line.qty > 0 ? `${line.qty}×` : "•"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-bold text-ink">{line.name}</div>
                    {details.length > 0 && (
                      <div className="text-[13px] text-mut">{details.join(" · ")}</div>
                    )}
                    {line.note && (
                      <div className="flex items-start gap-1.5 text-[13px] font-bold text-prept">
                        <Icon
                          name="arrow"
                          size={13}
                          className="mt-[3px] shrink-0"
                        />
                        {line.note}
                      </div>
                    )}
                  </div>
                  <span className="cf-fig shrink-0 text-sm font-extrabold text-ink">
                    {fmtEuro(line.lineTotal)}
                  </span>
                </li>
              );
            })}
          </ul>
          {order.note && (
            <p className="mt-2 flex items-start gap-1.5 text-[13px] font-bold text-prept">
              <Icon name="arrow" size={13} className="mt-[3px] shrink-0" />
              {order.note}
            </p>
          )}

          {/* ── Total ── */}
          <div className="mt-3 border-t border-line2 pt-3">
            {order.totals.discount && (
              <>
                <div className="flex items-baseline justify-between text-[13px] text-mut">
                  <span>Sous-total</span>
                  <span className="cf-fig">{fmtEuro(order.totals.subtotal)}</span>
                </div>
                <div className="mb-1 flex items-baseline justify-between text-[13px] text-mut">
                  <span>
                    Remise
                    {order.totals.discount.reason
                      ? ` — ${order.totals.discount.reason}`
                      : ""}
                  </span>
                  <span className="cf-fig">
                    − {fmtEuro(order.totals.discount.amount)}
                  </span>
                </div>
              </>
            )}
            {(order.totals.deliveryFee ?? 0) > 0 && <div className="mb-2 flex justify-between text-sm text-mut"><span>Livraison</span><span>{fmtEuro(order.totals.deliveryFee!)}</span></div>}
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-mut">
                Total
              </span>
              <span className="cf-fig text-[26px] font-extrabold leading-none text-accent">
                {fmtEuro(order.totals.total)}
              </span>
            </div>
          </div>
        </section>

        {/* ── Suivi (timeline 4 étapes) ── */}
        <section className="mt-6" aria-label="Suivi de la commande">
          <h3 className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.06em] text-mut">
            Suivi
          </h3>
          <ol className="flex flex-col">
            {STEPS.map((step, i) => {
              const done = i === 0 || (!cancelled && rank >= i);
              const at =
                i === 0 ? order.createdAt : step.status ? historyAt(order, step.status) : null;
              return (
                <Fragment key={step.label}>
                  {i > 0 && (
                    <li
                      aria-hidden
                      className={cx(
                        "ml-3 h-3 w-px bg-white/10",
                        !done && "opacity-40",
                      )}
                    />
                  )}
                  <li className={cx("flex items-center gap-3", !done && "opacity-40")}>
                    <span
                      className={cx(
                        "grid size-6 shrink-0 place-items-center rounded-full",
                        done ? "bg-ok" : "bg-white/10",
                      )}
                      aria-hidden
                    >
                      {done ? (
                        <Icon name="check" size={13} stroke={3} className="text-white" />
                      ) : (
                        <span className="size-1.5 rounded-full bg-white" />
                      )}
                    </span>
                    <span
                      className={cx("flex-1 text-[14.5px] text-ink", done && "font-bold")}
                    >
                      {step.status === "delivered" && order.type === "delivery" ? "Livrée" : step.label}
                      {done && <span className="sr-only"> — étape effectuée</span>}
                    </span>
                    {done && at && (
                      <span className="cf-fig text-xs text-mut">{timeHHMM(at)}</span>
                    )}
                  </li>
                </Fragment>
              );
            })}
          </ol>
          {cancelled && (
            <p className="mt-3 flex items-center gap-2 text-[13px] font-semibold text-alertt">
              <Icon name="close" size={14} />
              Commande annulée{cancelledAt ? ` à ${timeHHMM(cancelledAt)}` : ""}
            </p>
          )}
        </section>
      </div>
    </Drawer>
  );
}
