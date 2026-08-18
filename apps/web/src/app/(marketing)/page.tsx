import { Compliance } from "@/components/marketing/Compliance";
import { ContactForm } from "@/components/marketing/ContactForm";
import { Faq } from "@/components/marketing/Faq";
import { Hero } from "@/components/marketing/Hero";
import { Modules } from "@/components/marketing/Modules";
import { Pillars } from "@/components/marketing/Pillars";
import { Pricing } from "@/components/marketing/Pricing";
import { ProofBand } from "@/components/marketing/ProofBand";
import { RevealObserver } from "@/components/marketing/RevealObserver";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { SiteHeader } from "@/components/marketing/SiteHeader";
import { SocialProof } from "@/components/marketing/SocialProof";
import { StickyBar } from "@/components/marketing/StickyBar";
import { WidgetSection } from "@/components/marketing/WidgetSection";
import { CONTACT_EMAIL, FAQ, PLANS } from "@/components/marketing/content";

/**
 * Landing commerciale Snack Manager (route `/`).
 *
 * Page statique : tout le contenu est rendu côté serveur, seuls les onglets, la
 * FAQ, les compteurs, le presse-papiers, le formulaire et la barre collante
 * sont des îlots clients.
 */
export default function LandingPage() {
  return (
    <>
      <a href="#produit" className="mk-skip">
        Aller au contenu
      </a>

      <SiteHeader />

      <main>
        <Hero />
        <ProofBand />
        <hr className="mk-rule" />
        <Modules />
        <hr className="mk-rule" />
        <WidgetSection />
        <hr className="mk-rule" />
        <Pillars />
        <hr className="mk-rule" />
        <Pricing />
        <hr className="mk-rule" />
        <SocialProof />
        <hr className="mk-rule" />
        <Compliance />
        <hr className="mk-rule" />
        <Faq />
        <hr className="mk-rule" />
        <ContactForm />
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
        "Suite de gestion pour snacks et fast-foods indépendants : caisse, cuisine (KDS), commande en ligne sans commission et back-office.",
      inLanguage: "fr-FR",
      offers: PLANS.map((p) => ({
        "@type": "Offer",
        name: p.name,
        price: p.price.replace(/[^\d]/g, ""),
        priceCurrency: "EUR",
        description: p.desc,
      })),
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
