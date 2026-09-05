import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ORDER_CHANNEL_LABELS,
  ORDER_STATUS_LABELS,
  ORDER_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_TENDER_LABELS,
  type OrderChannel,
  type OrderStatus,
  type OrderTicket,
  type OrderType,
  type PaymentMethod,
  type PaymentStatus,
  type PaymentTender,
  type TicketLine,
  type TicketQuery,
} from '@sm/contracts';
import type { Order, Tenant } from '@sm/db';
import { trackingFilter } from '../orders/tracking';
import { EscPosBuilder } from './escpos';
import { pad2, parisHm, parisYmd } from './paris-time';

/** Centimes → « 12,50 € » (jamais de float dans les données, uniquement à l'affichage). */
export function formatEuros(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(abs / 100)},${pad2(abs % 100)} €`;
}

/** Supplément d'option : « +0,50 € » — le signe lève l'ambiguïté sur le ticket. */
function signedEuros(cents: number): string {
  return cents > 0 ? `+${formatEuros(cents)}` : formatEuros(cents);
}

/** « 18/08/2026 19:12 » en heure du restaurant. */
function formatStamp(at: Date): string {
  const { y, m, d } = parisYmd(at);
  return `${pad2(d)}/${pad2(m)}/${y} ${parisHm(at)}`;
}

const DEFAULT_WIDTH = 42;

/**
 * Ticket de commande : représentation JSON structurée (consommée par la caisse,
 * le KDS et les aperçus web) et rendu ESC/POS dérivé de cette même structure.
 */
@Injectable()
export class TicketService {
  constructor(
    @InjectModel('Order') private readonly orders: Model<Order>,
    @InjectModel('Tenant') private readonly tenants: Model<Tenant>,
  ) {}

  /**
   * Ticket d'une commande, identifiée par son id ET son jeton de suivi.
   *
   * Le ticket porte le nom et le téléphone du client : il ne s'ouvre pas sur
   * un simple ObjectId, qui est devinable. Jeton absent ou faux ⇒ 404, pour ne
   * pas confirmer l'existence de la commande.
   */
  async build(orderId: string, token: unknown): Promise<OrderTicket> {
    const filter = trackingFilter(orderId, token);
    if (!filter) throw new NotFoundException('Commande introuvable');
    const order = await this.orders.findOne(filter).lean();
    if (!order) throw new NotFoundException('Commande introuvable');

    const tenant = await this.tenants.findById(order.tenantId).lean();
    if (!tenant) throw new NotFoundException('Établissement introuvable');

    const channel = (order.channel ?? 'online') as OrderChannel;
    const type = (order.type ?? 'emporter') as OrderType;
    const status = (order.status ?? 'new') as OrderStatus;
    const method = (order.payment?.method ?? 'counter') as PaymentMethod;
    const paymentStatus = (order.payment?.status ?? 'pending') as PaymentStatus;
    const tender = (order.payment?.tender ?? null) as PaymentTender | null;

    const lines: TicketLine[] = (order.lines ?? []).map((line) => ({
      qty: Number(line.qty ?? 1),
      name: String(line.name ?? ''),
      variantName: line.variantName ?? null,
      options: (line.options ?? []).map((opt) => ({
        name: String(opt.name ?? ''),
        priceDelta: Number(opt.priceDelta ?? 0),
      })),
      removed: (line.removed ?? []).map(String),
      note: line.note ?? null,
      unitPrice: Number(line.unitPrice ?? 0),
      lineTotal: Number(line.lineTotal ?? 0),
    }));

    const discount = order.totals?.discount;
    const pickupSlot = order.pickup?.slot ? new Date(order.pickup.slot) : null;
    const createdAt = order.createdAt ? new Date(order.createdAt) : new Date();

    return {
      orderId: String(order._id),
      pickupNumber: Number(order.number ?? 0),
      header: {
        tenantName: String(tenant.name ?? ''),
        slug: String(tenant.slug ?? ''),
        address: String(tenant.address ?? ''),
        phones: (tenant.phones ?? []).map(String),
      },
      createdAt: createdAt.toISOString(),
      printedAt: new Date().toISOString(),
      channel,
      channelLabel: ORDER_CHANNEL_LABELS[channel] ?? channel,
      type,
      typeLabel: ORDER_TYPE_LABELS[type] ?? type,
      status,
      statusLabel: ORDER_STATUS_LABELS[status] ?? status,
      pickup:
        order.pickup && pickupSlot
          ? {
              slotIso: pickupSlot.toISOString(),
              slotLabel: parisHm(pickupSlot),
              customerName: String(order.pickup.customerName ?? ''),
              customerPhone: order.pickup.customerPhone ?? null,
            }
          : null,
      delivery: order.type === 'delivery' && order.delivery?.address ? {
        address: {
          line1: String(order.delivery.address.line1 ?? ''),
          line2: String(order.delivery.address.line2 ?? ''),
          postalCode: String(order.delivery.address.postalCode ?? ''),
          city: String(order.delivery.address.city ?? ''),
          country: 'FR',
        },
        instructions: String(order.delivery.instructions ?? ''),
        zoneId: String(order.delivery.zoneId ?? ''),
        zoneName: String(order.delivery.zoneName ?? ''),
        feeCents: Number(order.delivery.feeCents ?? 0),
        estimatedMinutes: Number(order.delivery.estimatedMinutes ?? 0),
        dispatchedAt: order.delivery.dispatchedAt?.toISOString() ?? null,
        deliveredAt: order.delivery.deliveredAt?.toISOString() ?? null,
        driverName: order.delivery.driverName ?? null,
      } : null,
      lines,
      totals: {
        subtotal: Number(order.totals?.subtotal ?? 0),
        deliveryFee: Number(order.totals?.deliveryFee ?? 0),
        discount: discount
          ? { amount: Number(discount.amount ?? 0), reason: String(discount.reason ?? '') }
          : null,
        total: Number(order.totals?.total ?? 0),
      },
      payment: {
        method,
        methodLabel: PAYMENT_METHOD_LABELS[method] ?? method,
        tender,
        tenderLabel: tender ? (PAYMENT_TENDER_LABELS[tender] ?? tender) : null,
        status: paymentStatus,
        statusLabel: PAYMENT_STATUS_LABELS[paymentStatus] ?? paymentStatus,
        paid: paymentStatus === 'paid',
        cashReceived: numberOrNull(order.payment?.cashReceived),
        changeGiven: numberOrNull(order.payment?.changeGiven),
      },
      note: order.note ?? null,
    };
  }

  /**
   * Rendu ESC/POS du ticket.
   * `variant: 'kitchen'` = bon cuisine : pas de prix, quantités agrandies.
   */
  render(ticket: OrderTicket, options: TicketQuery = {}): Buffer {
    const width = options.width ?? DEFAULT_WIDTH;
    const kitchen = options.variant === 'kitchen';
    const p = new EscPosBuilder(width);

    p.init();

    // ── Entête établissement ──
    p.align('center').bold(true).size(1, 2);
    p.wrapped(ticket.header.tenantName.toUpperCase(), 1);
    p.size(1, 1).bold(false);
    if (!kitchen) {
      if (ticket.header.address) p.wrapped(ticket.header.address);
      if (ticket.header.phones.length > 0) p.line(ticket.header.phones.join(' · '));
    }
    p.align('left').rule('=');

    // ── Numéro de retrait : l'information la plus lue du ticket ──
    p.align('center').bold(true).line(ticket.type === 'delivery' ? 'COMMANDE À LIVRER' : 'NUMÉRO DE RETRAIT').bold(false);
    p.size(3, 3).bold(true).line(String(ticket.pickupNumber)).bold(false).size(1, 1);
    p.size(1, 2).bold(true);
    p.line(ticket.typeLabel.toUpperCase());
    p.size(1, 1).bold(false);
    if (ticket.pickup) {
      p.line(`${ticket.type === 'delivery' ? 'Livraison estimée' : 'Retrait'} ${ticket.pickup.slotLabel} · ${ticket.pickup.customerName}`);
      if (ticket.pickup.customerPhone) p.line(ticket.pickup.customerPhone);
    }
    if (ticket.delivery) {
      p.align('left').bold(true).wrapped(ticket.delivery.address.line1).bold(false);
      if (ticket.delivery.address.line2) p.wrapped(ticket.delivery.address.line2);
      p.wrapped(`${ticket.delivery.address.postalCode} ${ticket.delivery.address.city}`);
      if (ticket.delivery.instructions) p.wrapped(`Instructions : ${ticket.delivery.instructions}`);
    }
    p.align('left').rule('=');

    // ── Métadonnées commande ──
    p.columns(`Cmd ${shortRef(ticket.orderId)}`, formatStamp(new Date(ticket.createdAt)));
    p.columns(ticket.channelLabel, ticket.statusLabel);
    p.rule();

    // ── Lignes ──
    for (const line of ticket.lines) {
      const title = `${line.qty}x ${line.name}${line.variantName ? ` ${line.variantName}` : ''}`;
      p.bold(true);
      if (kitchen) p.wrapped(title, 1, '   ');
      else p.columnsWrap(title, formatEuros(line.lineTotal), '   ');
      p.bold(false);

      for (const option of line.options) {
        const suffix =
          !kitchen && option.priceDelta !== 0 ? ` (${signedEuros(option.priceDelta)})` : '';
        p.wrapped(`  + ${option.name}${suffix}`, 1, '    ');
      }
      for (const removed of line.removed) p.wrapped(`  - sans ${removed}`, 1, '    ');
      if (line.note) p.wrapped(`  >> ${line.note}`, 1, '    ');
    }

    // ── Totaux (masqués sur le bon cuisine) ──
    if (!kitchen) {
      p.rule();
      p.columns('Sous-total', formatEuros(ticket.totals.subtotal));
      if (ticket.totals.deliveryFee) p.columns('Livraison', formatEuros(ticket.totals.deliveryFee));
      if (ticket.totals.discount) {
        const label = ticket.totals.discount.reason
          ? `Remise (${ticket.totals.discount.reason})`
          : 'Remise';
        p.columns(label, formatEuros(-ticket.totals.discount.amount));
      }
      p.bold(true).size(1, 2);
      p.columns('TOTAL', formatEuros(ticket.totals.total), 2);
      p.size(1, 1).bold(false);
      p.rule();
      // Le moyen réellement encaissé prime sur « à régler au comptoir » : c'est
      // la ligne que le gérant recoupe le soir avec son tiroir et son TPE.
      p.columns(ticket.payment.tenderLabel ?? ticket.payment.methodLabel, ticket.payment.statusLabel);
      if (ticket.payment.cashReceived !== null) {
        p.columns('Reçu', formatEuros(ticket.payment.cashReceived));
        p.columns('Rendu', formatEuros(ticket.payment.changeGiven ?? 0));
      }
    }

    // ── Instructions cuisine ──
    if (ticket.note) {
      p.rule();
      p.bold(true).line('NOTE CLIENT').bold(false);
      p.wrapped(ticket.note);
    }

    // ── Pied ──
    p.rule();
    p.align('center');
    if (!kitchen) p.line('Merci et à bientôt !');
    p.line(`Imprimé le ${formatStamp(new Date(ticket.printedAt))}`);
    p.reset();
    p.cut(options.cut ?? 'partial');

    return p.build();
  }
}

/** ObjectId → référence courte lisible au comptoir (« …4F2A »). */
function shortRef(id: string): string {
  return id.slice(-6).toUpperCase();
}

/** Centimes optionnels : `null` reste `null`, jamais un `0` trompeur. */
function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
