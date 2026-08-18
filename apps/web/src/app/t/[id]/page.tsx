import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  loadBrandColor,
  loadTicket,
  loadTracking,
  PublicApiError,
} from "@/components/order/api";
import { Tracking } from "@/components/order/Tracking";

/**
 * Suivi de commande — `/t/[id]`.
 *
 * Aucun compte : l’identifiant de commande (ObjectId, non devinable) fait
 * office de clé. C’est le lien remis au client après paiement et l’URL de
 * retour de l’authentification 3-D Secure.
 *
 * Le statut (`GET /public/orders/:id`) est la seule donnée indispensable ; le
 * récapitulatif détaillé (`…/ticket`) et la couleur de marque sont des bonus
 * qui ne doivent jamais empêcher un client de voir « votre commande est prête ».
 *
 * Rendu dynamique — un statut de cuisine ne se met jamais en cache.
 */

type Params = { params: Promise<{ id: string }> };

export const metadata: Metadata = {
  title: "Suivi de commande",
  robots: { index: false, follow: false },
};

export default async function TrackingPage({ params }: Params) {
  const { id } = await params;

  let state;
  try {
    state = await loadTracking(id);
  } catch (err) {
    if (err instanceof PublicApiError && (err.status === 404 || err.status === 400)) {
      notFound();
    }
    throw err;
  }

  const ticket = await loadTicket(id).catch(() => null);
  const accent = ticket
    ? await loadBrandColor(ticket.header.slug)
    : "#c9a15a";

  return (
    <Tracking orderId={id} ticket={ticket} initial={state} accent={accent} />
  );
}
