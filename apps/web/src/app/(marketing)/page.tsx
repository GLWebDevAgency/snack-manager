import { AppsShowcase } from "@/components/marketing/AppsShowcase";
import { Benefits } from "@/components/marketing/Benefits";
import { CaseStudy } from "@/components/marketing/CaseStudy";
import { Comparison } from "@/components/marketing/Comparison";
import { ContactSection } from "@/components/marketing/ContactSection";
import { Faq } from "@/components/marketing/Faq";
import { Founder } from "@/components/marketing/Founder";
import { Hero } from "@/components/marketing/Hero";
import { Intro } from "@/components/marketing/Intro";
import { Platform } from "@/components/marketing/Platform";
import { Pricing } from "@/components/marketing/Pricing";
import { Process } from "@/components/marketing/Process";
import { ProofBand } from "@/components/marketing/ProofBand";
import { RevealObserver } from "@/components/marketing/RevealObserver";
import { Revenue } from "@/components/marketing/Revenue";
import { Simulator } from "@/components/marketing/Simulator";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { SiteHeader } from "@/components/marketing/SiteHeader";
import { StickyBar } from "@/components/marketing/StickyBar";
import { Ticker } from "@/components/marketing/Ticker";
import { Vignettes } from "@/components/marketing/Vignettes";
import { CONTACT_EMAIL, FAQ } from "@/components/marketing/content";

/**
 * Landing commerciale Snack Manager (route `/`).
 *
 * L'ordre des sections est celui de la maquette « Snack Manager - Site
 * Vitrine » : hero + bandeau de confiance, manifeste, preuve chiffrée,
 * simulateur, méthode, plateforme, catalogue + démo 3D, revenus, avant/après,
 * bénéfices, quotidien, fondateur, comparatif, tarifs, FAQ, contact.
 *
 * Tout ce qui peut rester statique reste un composant serveur ; seuls les
 * carrousels, le simulateur, la FAQ, le formulaire et les deux observateurs
 * sont des îlots clients.
 */
export default function LandingPage() {
  return (
    <>
      <a href="#produit" className="mk-skip">
        Aller au contenu
      </a>

      <SiteHeader />

      <main id="top">
        <Hero />
        <Ticker />
        <Intro />
        <ProofBand />
        <Simulator />
        <Process />
        <Platform />
        <AppsShowcase />
        <Revenue />
        <CaseStudy />
        <Benefits />
        <Vignettes />
        <Founder />
        <Comparison />
        <Pricing />
        <Faq />
        <ContactSection />
      </main>

      <SiteFooter />
      <StickyBar />
      <RevealObserver />

      <script
        type="application/ld+json"
        // Données structurées : produit SaaS + FAQ, pour les extraits enrichis.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData()) }}
      />
    </>
  );
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
      // Les tarifs publics sont « sur devis » : on ne fabrique pas de prix pour Google.
      offers: {
        "@type": "Offer",
        priceCurrency: "EUR",
        availability: "https://schema.org/LimitedAvailability",
        description: "Lancement accompagné — tarif préférentiel à vie pour les 10 premiers restaurants.",
      },
      email: CONTACT_EMAIL,
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQ.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  ];
}
