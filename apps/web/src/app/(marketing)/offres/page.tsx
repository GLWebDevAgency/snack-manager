import type { Metadata } from "next";
import { RevealObserver } from "@/components/marketing/RevealObserver";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { SiteHeader } from "@/components/marketing/SiteHeader";
import {
  MODULE_MONTHLY_CENTS,
  MODULE_SETUP_CENTS,
  PLANS,
  PRICE_RANGE,
  YEARLY_MONTHS_BILLED,
  yearlyCents,
} from "@/components/marketing/content";
import { urlAbsolue } from "@/lib/site";
import { OFFRE_SECTIONS } from "./content";
import { OffresBody } from "./sections";
import { lireReseaux } from "@/lib/reseaux";

/**
 * Page Offres — route `/offres`.
 *
 * ═══ CE QU'ELLE EST, ET CE QU'ELLE N'EST PAS ═══
 *
 * Ce n'est pas la landing en plus long. La vitrine CONVAINC en onze sections ;
 * cette page DÉTAILLE pour qui est déjà convaincu et vient vérifier ce qu'il
 * achète. D'où des montants écrits partout où une question de prix se pose,
 * plutôt que renvoyés à un devis.
 *
 * CE COMMENTAIRE PLAIDAIT ENCORE POUR UNE SECTION QUI N'EXISTE PLUS. Il vantait
 * « une section entière consacrée à ce que nous ne faisons PAS — la seule chose
 * qu'une page de vente ne dit jamais ». Le fondateur l'a fait tomber : « tu en
 * dis trop, tu veux trop faire honnête au dépens du marketing et de la vente ».
 * Il avait raison, et la démonstration est dans les quatre entrées de cette
 * section : trois répétaient ce que la page dit déjà à sa place, et la
 * quatrième — aucun matériel propriétaire — était un ARGUMENT DE VENTE rangé
 * dans un inventaire de refus. Voir le détail dans `offres/content.ts`.
 *
 * ═══ POURQUOI L'EN-TÊTE ET LE PIED DE PAGE SONT RENDUS ICI ═══
 *
 * Le layout du groupe `(marketing)` ne pose que le conteneur `.mk`, ses jetons
 * de charte et la feuille de style ; chaque page monte elle-même `SiteHeader`,
 * `SiteFooter` et `RevealObserver`.
 *
 * ═══ ET CES QUATRE LIGNES RESTENT RÉPÉTÉES TROIS FOIS, DÉLIBÉRÉMENT ═══
 *
 * Les remonter dans le layout paraît évident et casse le LIEN D'ÉVITEMENT. Un
 * layout rend `<SiteHeader/>` PUIS `{children}` : le `.mk-skip` de la page,
 * premier enfant de `children`, se retrouverait derrière tous les liens de
 * l'en-tête dans l'ordre de tabulation. « Aller au contenu » atteint après six
 * tabulations n'évite plus rien — c'est la seule chose que ce lien sache faire,
 * et la panne serait invisible à l'écran.
 *
 * Le remonter lui aussi supposerait une cible commune, or les trois surfaces
 * visent trois endroits différents et choisis : la démonstration manipulable
 * sur la landing, la première section ici, l'article sur `/blog/[slug]`. Trois
 * lignes de rappel coûtent moins cher qu'un lien d'accessibilité mort.
 *
 * Cette page vit dans le groupe `(marketing)` : son chemin public ne porte donc
 * PAS le nom du groupe, et tout son contenu est à l'intérieur du `.mk` posé par
 * le layout — sans quoi aucune règle de `marketing.css` (toutes préfixées) ne
 * s'appliquerait.
 */

/**
 * Le chemin public de cette page — écrit une fois. Les métadonnées le donnent
 * en RELATIF (Next les résout contre le `metadataBase` du layout) ; le JSON-LD
 * le passe par `urlAbsolue()`, parce que schema.org veut des URL complètes.
 */
const OFFRES_PATH = "/offres";

/**
 * LE TITRE ET LA DESCRIPTION SONT DU TEXTE AFFICHÉ, et ils obéissent aux mêmes
 * règles que la page : aucun chiffre de résultat, aucune promesse de délai,
 * jamais « sans engagement » servi seul.
 *
 * La fourchette de prix est DÉRIVÉE (`PRICE_RANGE`) et non recopiée. C'est la
 * leçon du 21/08/2026 : la description de la vitrine vivait hors de
 * `components/marketing/`, donc une révision de grille la laissait intacte — et
 * Google a affiché l'ancienne grille pendant que la page affichait la nouvelle.
 * Un prix périmé lisible sans même ouvrir le site.
 *
 * `alternates.canonical` est indispensable ici : `/offres` reprend les mêmes
 * trois tarifs que la section 6 de la landing, et sans canonique explicite les
 * deux URL se disputent la même requête (« tarif logiciel caisse snack »).
 */
export const metadata: Metadata = {
  title: "Offres et tarifs — Snack Manager",
  description: `Le détail des trois formules Snack Manager, du module commande en ligne et des services : ce qui est compris, ce qui ne l'est pas. ${PRICE_RANGE}.`,
  keywords: [
    "tarif logiciel caisse snack",
    "prix logiciel restaurant",
    "abonnement caisse fast-food",
    "tarif click and collect restaurant",
    "logiciel snack sans commission",
  ],
  alternates: { canonical: OFFRES_PATH },
  openGraph: {
    type: "website",
    locale: "fr_FR",
    url: OFFRES_PATH,
    siteName: "Snack Manager",
    title: "Offres et tarifs — Snack Manager",
    description: `Trois formules, un module commande en ligne, trois services chiffrés. Zéro commission. ${PRICE_RANGE}.`,
  },
  twitter: {
    card: "summary_large_image",
    title: "Offres et tarifs — Snack Manager",
    description: "Le détail de chaque formule, du module commande en ligne et des services. Zéro commission.",
  },
  robots: { index: true, follow: true },
};

export default async function OffresPage() {
  // Les réseaux sont lus ICI plutôt que dans le pied de page : `SiteFooter`
  // est un îlot client. Si l'API ne répond pas, `lireReseaux` rend une liste
  // vide et la rangée disparaît — la page, elle, s'affiche.
  const reseaux = await lireReseaux();

  return (
    <>
      {/*
       * « Aller au contenu » atterrit sur la première section réelle de la page,
       * c'est-à-dire sur la grille des formules — ce que le visiteur est venu
       * chercher. L'ancre est nue et c'est correct : elle vise une section de
       * CETTE page. Toute ancre de la LANDING citée d'ici passe par `ancre()`.
       */}
      <a href={`#${OFFRE_SECTIONS[0].id}`} className="mk-skip">
        Aller au contenu
      </a>

      <SiteHeader />

      <main id="top">
        <OffresBody />
      </main>

      <SiteFooter reseaux={reseaux} />
      <RevealObserver />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData()) }}
      />
    </>
  );
}

/**
 * Le montant en euros, nu — « 99 », « 79 ». schema.org veut un nombre, pas
 * « 99 € » : `euros()` compose pour un lecteur humain (espace insécable et
 * symbole compris) et ne peut pas servir ici.
 *
 * On part des CENTIMES et jamais de la chaîne affichée. La landing dérive les
 * siens par `parseInt(plan.price)`, ce qui marche tant que la grille mensuelle
 * tient en trois chiffres mais s'arrêterait au séparateur de milliers d'un tarif
 * ANNUEL (« 1 590 € » donnerait 1). Cette page publie justement les deux
 * périodicités : elle ne pouvait pas se permettre cette lecture-là.
 */
const plain = (cents: number): string => String(cents / 100);

/**
 * ═══ DONNÉES STRUCTURÉES — COMPLÉTER LA LANDING, JAMAIS LA CONCURRENCER ═══
 *
 * `app/(marketing)/page.tsx` publie déjà deux entités de premier niveau : un
 * `SoftwareApplication` (avec son `AggregateOffer` sur les trois tarifs
 * mensuels) et une `FAQPage`. Republier ici un second `SoftwareApplication`
 * portant le même nom et un autre prix de référence, ce serait déclarer deux
 * produits homonymes à des URL différentes — exactement le conflit qu'on veut
 * éviter, et la meilleure façon de faire choisir à Google la mauvaise page.
 *
 * Cette page déclare donc :
 *
 *   · un `BreadcrumbList` — sa seule information propre : elle est une page
 *     fille de l'accueil, ce que la landing ne peut pas dire à sa place ;
 *   · un `OfferCatalog` — LE catalogue, c'est-à-dire ce que cette page est. Il
 *     porte quatre offres (les trois formules et le module vendu à part), et
 *     chaque offre pointe le produit par `itemOffered` : une RÉFÉRENCE imbriquée,
 *     pas une seconde déclaration de produit.
 *
 * PAS DE `FAQPage` ICI : la landing la porte, et deux FAQ concurrentes sur un
 * même site se neutralisent dans les extraits enrichis.
 *
 * LES OFFRES ANNUELLES SONT DÉCLARÉES, elles aussi. C'est la seule chose que
 * cette page publie de plus que la vitrine côté prix, et elle est vraie : douze
 * mois pour le prix de `YEARLY_MONTHS_BILLED`. Le montant se DÉDUIT du mensuel
 * par `yearlyCents()`, jamais saisi — deux grilles annuelles finiraient par
 * diverger, et c'est le genre d'écart qu'on découvre sur une facture.
 *
 * Aucun montant n'est écrit dans ce fichier : les quatre prix descendent de
 * `PLAN_MONTHLY_CENTS`, `MODULE_MONTHLY_CENTS` et `MODULE_SETUP_CENTS`, dont
 * l'assertion `GRILLES_ACCORDÉES` garantit qu'ils concordent avec les contrats.
 */
function structuredData() {
  /** Le produit, cité et non redéclaré — même nom que l'entité de la landing. */
  const produit = {
    "@type": "SoftwareApplication",
    name: "Snack Manager",
    applicationCategory: "BusinessApplication",
  };

  const offresFormules = PLANS.flatMap((plan) => [
    {
      "@type": "Offer",
      name: `${plan.name} — par mois`,
      description: plan.desc,
      price: plain(plan.monthlyCents),
      priceCurrency: "EUR",
      availability: "https://schema.org/InStock",
      itemOffered: produit,
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: plain(plan.monthlyCents),
        priceCurrency: "EUR",
        // UN/CEFACT : « MON » = le mois, « ANN » = l'année.
        unitCode: "MON",
      },
    },
    {
      "@type": "Offer",
      name: `${plan.name} — par an`,
      description: `${plan.desc} Douze mois réglés d'avance pour le prix de ${YEARLY_MONTHS_BILLED}.`,
      price: plain(yearlyCents(plan.monthlyCents)),
      priceCurrency: "EUR",
      availability: "https://schema.org/InStock",
      itemOffered: produit,
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: plain(yearlyCents(plan.monthlyCents)),
        priceCurrency: "EUR",
        unitCode: "ANN",
      },
    },
  ]);

  return [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Accueil", item: urlAbsolue("/") },
        { "@type": "ListItem", position: 2, name: "Offres", item: urlAbsolue(OFFRES_PATH) },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "OfferCatalog",
      name: "Offres Snack Manager",
      url: urlAbsolue(OFFRES_PATH),
      inLanguage: "fr-FR",
      itemListElement: [
        ...offresFormules,
        {
          "@type": "Offer",
          // Le module s'appelle « Commande en ligne & fidélité » et JAMAIS
          // « Livraison » : le mot Livraison en face d'un prix se lit comme un
          // livreur qu'on facture, et nous n'en fournissons aucun.
          name: "Commande en ligne & fidélité",
          description: `Module vendu à part, compris dans Boost. ${plain(
            MODULE_SETUP_CENTS,
          )} € de mise en service la première fois.`,
          price: plain(MODULE_MONTHLY_CENTS),
          priceCurrency: "EUR",
          availability: "https://schema.org/InStock",
          itemOffered: produit,
          priceSpecification: {
            "@type": "UnitPriceSpecification",
            price: plain(MODULE_MONTHLY_CENTS),
            priceCurrency: "EUR",
            unitCode: "MON",
          },
        },
      ],
    },
  ];
}
