"use client";

/**
 * Ticket minimal imprimé via window.print() : la zone est invisible à
 * l'écran et seule visible en @media print (tout le reste du back-office
 * est masqué). Noir sur blanc volontaire — sortie imprimante thermique,
 * hors thème écran (les tokens sombres ne s'appliquent pas au papier).
 */

import { fmtEuro } from "@/lib/format";
import {
  CHANNEL_LABELS,
  TYPE_LABELS,
  customerName,
  isPaid,
  slotHHMM,
  timeHHMM,
  type Order,
} from "./types";

const PRINT_CSS = `
#sm-print-ticket { display: none; }
@media print {
  body * { visibility: hidden !important; }
  #sm-print-ticket, #sm-print-ticket * { visibility: visible !important; }
  #sm-print-ticket {
    display: block !important;
    position: fixed;
    top: 0;
    left: 0;
    width: 72mm;
    padding: 4mm;
    background: #fff;
    color: #000;
    font: 12px/1.45 ui-monospace, "Courier New", monospace;
  }
  #sm-print-ticket .tk-num { font-size: 22px; font-weight: 800; }
  #sm-print-ticket .tk-strong { font-weight: 700; }
  #sm-print-ticket .tk-row {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    font-variant-numeric: tabular-nums;
  }
  #sm-print-ticket .tk-sub { font-size: 11px; padding-left: 14px; }
  #sm-print-ticket .tk-hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
  #sm-print-ticket .tk-total { font-size: 15px; font-weight: 800; }
  #sm-print-ticket .tk-pay { margin-top: 4px; font-weight: 700; text-transform: uppercase; }
}
`;

export function PrintTicket({ order }: { order: Order | null }) {
  const slot = order ? slotHHMM(order) : null;
  return (
    <>
      <style>{PRINT_CSS}</style>
      {order && (
        <div id="sm-print-ticket" aria-hidden>
          <div className="tk-num">n° {order.number}</div>
          <div>
            {new Date(order.createdAt).toLocaleDateString("fr-FR")} ·{" "}
            {timeHHMM(order.createdAt)}
          </div>
          <div className="tk-strong">{customerName(order)}</div>
          {order.pickup?.customerPhone && <div>{order.pickup.customerPhone}</div>}
          <div>
            {CHANNEL_LABELS[order.channel]} ·{" "}
            {slot ? `Retrait ${slot}` : TYPE_LABELS[order.type]}
          </div>
          <hr className="tk-hr" />
          {order.lines.map((line, i) => {
            const details = [
              ...(line.variantName ? [line.variantName] : []),
              ...line.options.map((op) => op.name),
              ...line.removed.map((r) => `sans ${r}`),
            ];
            return (
              <div key={`${line.productId}-${i}`}>
                <div className="tk-row">
                  <span>
                    {line.qty > 0 ? `${line.qty}× ` : ""}
                    {line.name}
                  </span>
                  <span>{fmtEuro(line.lineTotal)}</span>
                </div>
                {details.length > 0 && <div className="tk-sub">{details.join(" · ")}</div>}
                {line.note && <div className="tk-sub">➜ {line.note}</div>}
              </div>
            );
          })}
          {order.note && <div className="tk-sub">➜ {order.note}</div>}
          <hr className="tk-hr" />
          {order.totals.discount && (
            <>
              <div className="tk-row">
                <span>Sous-total</span>
                <span>{fmtEuro(order.totals.subtotal)}</span>
              </div>
              <div className="tk-row">
                <span>Remise</span>
                <span>− {fmtEuro(order.totals.discount.amount)}</span>
              </div>
            </>
          )}
          <div className="tk-row tk-total">
            <span>Total</span>
            <span>{fmtEuro(order.totals.total)}</span>
          </div>
          <div className="tk-pay">
            {isPaid(order)
              ? order.payment.method === "online"
                ? "Payé en ligne"
                : "Payée"
              : order.payment.status === "refunded"
                ? "Remboursée"
                : "À encaisser"}
          </div>
        </div>
      )}
    </>
  );
}
