import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { marqueEffective } from "@sm/contracts";
import { loadBrand, PublicApiError } from "@/components/order/api";
import { Tracking } from "@/components/order/Tracking";
import { loadTicket, loadTracking, readToken } from "./tracking-api";

/**
 * Suivi de commande — `/t/[id]?t=<trackingToken>`.
 *
 * Aucun compte : le couple identifiant + jeton fait office de clé. L’ObjectId
 * seul n’en est pas une — ses quatre premiers octets sont l’horodatage de
 * création et ses trois derniers un compteur, donc les commandes voisines se
 * devinent. Le jeton ajoute 192 bits tirés au hasard avant d’exposer le nom et
 * le téléphone du client.
 *
 * Le statut est la seule donnée indispensable ; le récapitulatif détaillé et
 * la couleur de marque sont des bonus qui ne doivent jamais empêcher un client
 * de voir « votre commande est prête ».
 *
 * Rendu dynamique — un statut de cuisine ne se met jamais en cache.
 */

type Params = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export const metadata: Metadata = {
  title: "Suivi de commande",
  robots: { index: false, follow: false },
};

export default async function TrackingPage({ params, searchParams }: Params) {
  const { id } = await params;
  const token = readToken((await searchParams).t);

  // Lien tronqué (copié à la main, coupé par une messagerie) : ce n’est pas une
  // commande introuvable, et le client n’a rien à corriger de son côté.
  if (!token) return <IncompleteLink />;

  let state;
  try {
    state = await loadTracking(id, token);
  } catch (err) {
    if (
      err instanceof PublicApiError &&
      (err.status === 404 || err.status === 400)
    ) {
      notFound();
    }
    throw err;
  }

  const ticket = await loadTicket(id, token).catch(() => null);
  // Sans ticket, pas de slug pour interroger l'API : le masque de repli seul.
  const brand = ticket
    ? await loadBrand(ticket.header.slug)
    : marqueEffective({ brand: null, brandColor: null, logoUrl: null });

  return (
    <Tracking
      orderId={id}
      trackingToken={token}
      ticket={ticket}
      initial={state}
      brand={brand}
    />
  );
}

/** Lien de suivi sans jeton — message clair, pas une erreur technique. */
function IncompleteLink() {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-6 text-center">
      <div className="max-w-[360px]">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-mut">
          Lien incomplet
        </p>
        <h1 className="mt-2 text-[24px] font-extrabold tracking-[-0.035em] text-ink">
          Suivi indisponible
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-mut">
          Ce lien a perdu sa partie sécurisée en chemin. Ouvrez celui reçu à la
          commande, sans le raccourcir ni le recopier à la main.
        </p>
        <p className="mt-3 text-[15px] leading-relaxed text-mut">
          Votre commande, elle, est bien enregistrée : votre numéro de retrait
          suffit au comptoir.
        </p>
      </div>
    </main>
  );
}
