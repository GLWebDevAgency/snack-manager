import { AppsShowcase } from "@/components/marketing/AppsShowcase";
import { Canaux } from "@/components/marketing/Canaux";
import { Comparison } from "@/components/marketing/Comparison";
import { ContactSection } from "@/components/marketing/ContactSection";
import { Faq } from "@/components/marketing/Faq";
import { Founder } from "@/components/marketing/Founder";
import { Hero } from "@/components/marketing/Hero";
import { Jalons } from "@/components/marketing/Jalons";
import { Materiel } from "@/components/marketing/Materiel";
import { Pricing } from "@/components/marketing/Pricing";
import { RevealObserver } from "@/components/marketing/RevealObserver";
import { Simulator } from "@/components/marketing/Simulator";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { SiteHeader } from "@/components/marketing/SiteHeader";
import { CONTACT_EMAIL, FAQ, PLANS } from "@/components/marketing/content";

/**
 * Landing commerciale Snack Manager (route `/`).
 *
 * ONZE SECTIONS, ET L'ORDRE EST CELUI DES QUESTIONS QUE SE POSE UN PATRON DE
 * SNACK, dans l'ordre où il se les pose. Ce n'est plus l'ordre de la maquette
 * d'origine — elle empilait dix-sept sections, décrivait six fois la même
 * journée et rangeait la seule preuve manipulable en huitième position.
 *
 *  1. Hero ............ suis-je au bon endroit ?
 *  2. Comparison ...... est-ce que ça me parle ?
 *  3. AppsShowcase .... est-ce que ça existe vraiment ?  ← la preuve, et elle
 *                       porte l'ancre #produit, cible du lien d'évitement.
 *  4. Canaux .......... mes clients commandent comment ?
 *  5. Materiel ........ est-ce que ça marche dans MA cuisine ?
 *  6. Pricing ......... combien ?
 *  7. Simulator ....... et par rapport à ce que je paie déjà ?
 *  8. Jalons .......... si je dis oui, il se passe quoi ?
 *  9. Faq ............. qu'est-ce que je risque ?
 * 10. Founder ......... à qui je donne mon numéro ?
 * 11. ContactSection .. le seul point de conversion de la page.
 *
 * Chaque question est posée UNE fois : une section qui redit le travail d'une
 * autre n'a pas sa place ici. `SECTIONS` (content.ts) porte le même ordre et
 * sert de sommaire au menu burger — les deux listes doivent rester d'accord.
 *
 * Tout ce qui peut rester statique reste un composant serveur ; seuls le deck
 * du hero, la scène de démonstration, le simulateur, la FAQ, le formulaire et
 * les deux observateurs sont des îlots clients.
 */
export default function LandingPage() {
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
        <Hero />
        <Comparison />
        <AppsShowcase />
        <Canaux />
        <Materiel />
        <Pricing />
        <Simulator />
        <Jalons />
        <Faq />
        <Founder />
        <ContactSection />
      </main>

      <SiteFooter />
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
 * Le prix affiché, en nombre. `PLANS[i].price` vaut « 89 € » : la grille est
 * écrite pour un lecteur humain, schema.org veut un nombre nu. On le dérive
 * plutôt que de le recopier — deux endroits où vit le même prix, c'est deux
 * endroits qui finissent par diverger.
 */
function priceOf(plan: (typeof PLANS)[number]) {
  return String(Number.parseInt(plan.price, 10));
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
        "Suite de gestion pour snacks et fast-foods indépendants : caisse, cuisine (KDS), commande en ligne et back-office.",
      inLanguage: "fr-FR",
      /*
       * LES TROIS PRIX SONT PUBLICS, DONC ILS SONT ICI. La page disait
       * « sur devis » et l'offre structurée le répétait ; elle affiche
       * maintenant 89 / 139 / 189 € par mois, et un extrait enrichi qui porte
       * un prix vaut mieux qu'un extrait qui n'en porte aucun. La fourchette
       * est déclarée en `AggregateOffer` parce qu'il y a bien trois offres à
       * comparer, pas une seule à négocier.
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
