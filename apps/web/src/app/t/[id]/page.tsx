import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { marqueDeRepli } from "@sm/contracts";
import { PublicApiError } from "@/components/order/api";
import { Tracking } from "@/components/order/Tracking";
import { FeuilleDuMasque } from "@/components/masque/FeuilleDuMasque";
import { classesPolices } from "@/components/masque/polices";
import { styleDuMasque } from "@/components/masque/styleDuMasque";
import { cx } from "@/lib/cx";
import { restaurantMetadata } from "@/lib/restaurant-metadata";
import { loadTicket, loadTracking, marqueDuSuivi, readToken } from "./tracking-api";

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

export async function generateMetadata({ params, searchParams }: Params): Promise<Metadata> {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const token = readToken(query.t);
  const ticket = token ? await loadTicket(id, token).catch(() => null) : null;
  return {
    // Le lecteur de ticket est mémorisé par requête. Seul le slug public et
    // validé sert ici : ni identifiant, ni jeton, ni données client en asset.
    ...restaurantMetadata(ticket?.header?.slug),
    title: "Suivi de commande",
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

/*
 * Sans jeton, aucun slug : le restaurant est inconnu, donc son masque aussi.
 * C'est le REPLI NUIT et non la marque grise de Snack Manager — le pourquoi
 * complet est dans `app/r/[slug]/not-found.tsx`. Calculé au module : cette
 * peau-là ne dépend d'aucune donnée.
 */
const REPLI = marqueDeRepli(null, null);
const MASQUE_DE_REPLI = styleDuMasque(REPLI);

/**
 * La barre du navigateur mobile prend la couleur du MASQUE, pas notre noir.
 *
 * Le suivi est la page qu'on garde ouverte, en haut de l'écran, pendant que
 * la commande se prépare : sans `themeColor`, le chrome du navigateur restait
 * peint hors du masque juste au-dessus d'un en-tête à la marque du
 * restaurant. `colorScheme` fait suivre l'ascenseur et les contrôles natifs,
 * que le `style` posé sur la racine cliente n'atteint pas.
 *
 * `marqueDuSuivi` est mémorisé par `cache()` : ce viewport et la page se
 * partagent UN seul appel au ticket. Sans jeton — un lien tronqué en chemin —
 * il n'y a rien à interroger, et c'est le repli Nuit, exactement ce que peint
 * alors `IncompleteLink`.
 */
export async function generateViewport({ params, searchParams }: Params): Promise<Viewport> {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const token = readToken(query.t);
  const brand = token ? await marqueDuSuivi(id, token) : REPLI;
  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor: brand.palette.ground,
    colorScheme: brand.mode,
  };
}

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

  // `loadTicket` et `marqueDuSuivi` sont mémorisés pour la requête : le ticket
  // n'est demandé qu'une fois, ici comme dans `generateViewport`.
  const ticket = await loadTicket(id, token).catch(() => null);
  const brand = await marqueDuSuivi(id, token);

  return (
    <Tracking
      key={id}
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
    <main
      style={MASQUE_DE_REPLI}
      className={cx(
        classesPolices,
        "font-body grid min-h-dvh place-items-center bg-bg px-6 text-center text-ink",
      )}
    >
      {/* Le masque remonte au document : canevas, rebond iOS, ascenseur
          et contrôles natifs — voir `FeuilleDuMasque`. */}
      <FeuilleDuMasque brand={REPLI} />
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
