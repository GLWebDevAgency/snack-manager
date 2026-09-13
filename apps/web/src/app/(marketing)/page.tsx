import { AppsShowcase } from "@/components/marketing/AppsShowcase";
import { Canaux } from "@/components/marketing/Canaux";
import { Comparison } from "@/components/marketing/Comparison";
import { CommerceOffers } from "@/components/marketing/CommerceOffers";
import { ContactSection } from "@/components/marketing/ContactSection";
import { Faq } from "@/components/marketing/Faq";
import { Founder } from "@/components/marketing/Founder";
import { Hero } from "@/components/marketing/Hero";
import { RestaurantJourney } from "@/components/marketing/RestaurantJourney";
import { MenuStudio } from "@/components/marketing/MenuStudio";
import "@/components/marketing/communication-v2.css";
import { Materiel } from "@/components/marketing/Materiel";
import { Pricing } from "@/components/marketing/Pricing";
import { RevealObserver } from "@/components/marketing/RevealObserver";
import { Simulator } from "@/components/marketing/Simulator";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { SiteHeader } from "@/components/marketing/SiteHeader";
import { CONTACT_EMAIL, FAQ, PLANS } from "@/components/marketing/content";
import { lireReseaux } from "@/lib/reseaux";

/** Public V2: needs, product proof, menu services, clear offers and accompanied onboarding. */
export default async function LandingPage() {
  // Les réseaux sont lus ICI plutôt que dans le pied de page : `SiteFooter`
  // est un îlot client. Si l'API ne répond pas, `lireReseaux` rend une liste
  // vide et la rangée disparaît — la page, elle, s'affiche.
  const reseaux = await lireReseaux();

  return (
    <>
      {/*
       * « Aller au contenu » atterrit sur la démonstration manipulable. Elle a
       * repris l'ancre #produit, qui désignait hier six maquettes inventées :
       * le lien d'évitement mène désormais au produit lui-même.
       */}
      <a href="#produit" className="mk-skip">
        Aller au contenu
      </a>

      <SiteHeader />

      <main id="top">
        <Hero reseaux={reseaux} />
        <Comparison />
        <AppsShowcase />
        <MenuStudio />
        <Pricing />
        <CommerceOffers />
        <Canaux />
        <Materiel />
        <RestaurantJourney />
        <Simulator />
        <Founder />
        <Faq />
        <ContactSection />
      </main>

      <SiteFooter reseaux={reseaux} />
      <RevealObserver />

      <script
        type="application/ld+json"
        // Données structurées : produit SaaS + FAQ, pour les extraits enrichis.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData()) }}
      />
    </>
  );
}

/**
 * Le prix affiché, en nombre. `PLANS[i].price` est écrit pour un lecteur
 * humain (« 99 € », symbole compris) quand schema.org veut un nombre nu. On le
 * dérive plutôt que de le recopier — deux endroits où vit le même prix, c'est
 * deux endroits qui finissent par diverger.
 *
 * `parseInt` s'arrête à la première espace, ce qui suffit tant que la grille
 * mensuelle tient en trois chiffres. Un tarif à quatre chiffres porterait un
 * séparateur de milliers et ne se lirait plus ainsi — c'est le cas des prix
 * ANNUELS (`priceYearly`), qu'on ne passe donc jamais ici : `plan.monthlyCents`
 * et `plan.yearlyCents` existent pour ça.
 */
function priceOf(plan: (typeof PLANS)[number]) {
  return String(plan.monthlyCents / 100);
}

function structuredData() {
  return [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "Snack Manager",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web, iPadOS, Android",
      description:
        "Logiciels et accompagnement pour les restaurateurs indépendants : caisse, cuisine, gestion, commande directe et menus papier et TV.",
      inLanguage: "fr-FR",
      /*
       * LES TROIS PRIX SONT PUBLICS, DONC ILS SONT ICI. La page disait
       * « sur devis » et l'offre structurée le répétait ; elle affiche
       * maintenant les trois tarifs mensuels de `PLANS`, et un extrait enrichi
       * qui porte un prix vaut mieux qu'un extrait qui n'en porte aucun. La
       * fourchette est déclarée en `AggregateOffer` parce qu'il y a bien trois
       * offres à comparer, pas une seule à négocier.
       *
       * Aucun montant n'est recopié ici : les trois se lisent dans la grille,
       * qui est le seul endroit de la vitrine où ils s'écrivent.
       */
      offers: {
        "@type": "AggregateOffer",
        priceCurrency: "EUR",
        lowPrice: priceOf(PLANS[0]),
        highPrice: priceOf(PLANS[PLANS.length - 1]),
        offerCount: PLANS.length,
        offers: PLANS.map((plan) => ({
          "@type": "Offer",
          name: plan.name,
          description: plan.desc,
          price: priceOf(plan),
          priceCurrency: "EUR",
          availability: "https://schema.org/InStock",
          priceSpecification: {
            "@type": "UnitPriceSpecification",
            price: priceOf(plan),
            priceCurrency: "EUR",
            // UN/CEFACT : « MON » = le mois. `plan.period` dit « par mois ».
            unitCode: "MON",
          },
        })),
      },
      email: CONTACT_EMAIL,
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      /*
       * Cinq entrées et non plus huit : trois questions sont montées dans la
       * section où elles se posent (matériel, hors-ligne, délai de mise en
       * route), une est absorbée par les canaux, une part avec les marques
       * blanches. Le tri est fait dans `FAQ` — ce bloc suit tout seul.
       */
      mainEntity: FAQ.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  ];
}
