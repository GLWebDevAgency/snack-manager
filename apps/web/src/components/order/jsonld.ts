/**
 * Données structurées schema.org de la page publique d’un restaurant.
 *
 * C’est ce bloc qui permet à Google d’afficher la note en étoiles, les
 * horaires et le lien « Commander » dans les résultats et dans la fiche
 * Google Business du restaurateur. Il n’est pas décoratif : c’est la moitié
 * de la valeur SEO de la page.
 *
 * Sérialisation : `JSON.stringify` ne neutralise pas les chaînes hostiles.
 * Les noms de produits viennent du back-office du restaurant — on échappe donc
 * `<` avant injection (recommandation officielle Next.js).
 */

import type { Site } from "./api";
import { splitAddress } from "./helpers";

/** Jour ISO (1 = lundi) → jour schema.org. */
const SCHEMA_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Retire les champs vides — un JSON-LD à moitié rempli dessert le référencement. */
function prune(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    const items = value.map(prune).filter((v) => v !== null && v !== undefined);
    return items;
  }
  if (value && typeof value === "object") {
    const out: { [key: string]: JsonValue } = {};
    for (const [key, raw] of Object.entries(value)) {
      const cleaned = prune(raw);
      if (cleaned === null || cleaned === "") continue;
      if (Array.isArray(cleaned) && cleaned.length === 0) continue;
      out[key] = cleaned;
    }
    return out;
  }
  return value;
}

/** Restaurant + Menu + horaires + note moyenne, prêt à injecter. */
export function restaurantJsonLd(site: Site, pageUrl: string): JsonValue {
  const { street, postalCode, city } = splitAddress(site.tenant.address);

  const openingHours = site.tenant.hours.flatMap((entry) =>
    [entry.lunch, entry.dinner]
      .filter((span): span is { open: string; close: string } => Boolean(span))
      .map((span) => ({
        "@type": "OpeningHoursSpecification",
        dayOfWeek: `https://schema.org/${SCHEMA_DAYS[entry.day - 1] ?? "Monday"}`,
        opens: span.open,
        closes: span.close,
      })),
  );

  const sections = site.categories.map((category) => ({
    "@type": "MenuSection",
    name: category.name,
    hasMenuItem: category.products.map((product) => ({
      "@type": "MenuItem",
      name: product.name,
      description: product.description || null,
      image: product.photoUrl,
      offers: {
        "@type": "Offer",
        price: (product.fromPrice / 100).toFixed(2),
        priceCurrency: "EUR",
        availability: product.outOfStock
          ? "https://schema.org/OutOfStock"
          : "https://schema.org/InStock",
      },
    })),
  }));

  const prices = site.categories
    .flatMap((c) => c.products)
    .map((p) => p.fromPrice)
    .filter((p) => p > 0);
  const cheapest = prices.length > 0 ? Math.min(...prices) : 0;

  return prune({
    "@context": "https://schema.org",
    "@type": "Restaurant",
    "@id": `${pageUrl}#restaurant`,
    name: site.tenant.name,
    url: pageUrl,
    image: site.tenant.logoUrl,
    telephone: site.tenant.phones[0] ?? null,
    servesCuisine: "Fast-food",
    // Fourchette de prix : Google l’affiche telle quelle sous le nom.
    priceRange: cheapest > 0 && cheapest < 1500 ? "€" : "€€",
    currenciesAccepted: "EUR",
    paymentAccepted: "Carte bancaire, Espèces",
    acceptsReservations: "False",
    address: {
      "@type": "PostalAddress",
      streetAddress: street || site.tenant.address,
      postalCode,
      addressLocality: city,
      addressCountry: "FR",
    },
    openingHoursSpecification: openingHours,
    aggregateRating:
      site.reviews.count > 0
        ? {
            "@type": "AggregateRating",
            ratingValue: site.reviews.avg,
            reviewCount: site.reviews.count,
            bestRating: 5,
            worstRating: 1,
          }
        : null,
    review: site.reviews.latest.map((review) => ({
      "@type": "Review",
      author: { "@type": "Person", name: review.author || "Client" },
      datePublished: review.createdAt,
      reviewRating: {
        "@type": "Rating",
        ratingValue: review.rating,
        bestRating: 5,
        worstRating: 1,
      },
      reviewBody: review.text || null,
    })),
    hasMenu: {
      "@type": "Menu",
      name: `Carte de ${site.tenant.name}`,
      inLanguage: "fr-FR",
      hasMenuSection: sections,
    },
    potentialAction: {
      "@type": "OrderAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: pageUrl,
        actionPlatform: [
          "https://schema.org/DesktopWebPlatform",
          "https://schema.org/MobileWebPlatform",
        ],
      },
      deliveryMethod: "https://schema.org/OnSitePickup",
    },
  });
}

/** Sérialisation sûre pour `dangerouslySetInnerHTML`. */
export function serializeJsonLd(data: JsonValue): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
