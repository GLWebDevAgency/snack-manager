import { ancre, section } from "./content";

const NEEDS = [
  { number: "01", title: "Mieux organiser mon service", text: "Reliez la prise de commande, la préparation et le suivi de votre activité.", label: "Découvrir les applications", target: "produit", symbol: "service" },
  { number: "02", title: "Refaire mes menus papier ou TV", text: "Présentez une carte lisible et soignée. Confiez-nous la création ou une mise à jour.", label: "Voir les prestations menus", target: "menus", symbol: "menu" },
  { number: "03", title: "Développer ma commande directe", text: "Gardez votre caisse actuelle et proposez un parcours de commande à vos couleurs.", label: "Voir les applications seules", target: "applications-seules", symbol: "direct" },
] as const;

export function Comparison() {
  const { badge, title } = section("votre-service");
  return (
    <section className="section needs-v2" id="votre-service">
      <span className="badge">{badge}</span>
      <h2 className="h2 center-h2">{title}</h2>
      <p className="subheading needs-lead">Sur place, à emporter ou en livraison. Quelle que soit votre cuisine.</p>
      <div className="needs-grid">
        {NEEDS.map((need) => (
          <a href={ancre(need.target).href} className={`needs-item rv needs-${need.symbol}`} key={need.number}>
            <div className="needs-top"><span>{need.number}</span><span className="needs-glyph" aria-hidden="true"><i /><i /><i /></span></div>
            <h3>{need.title}</h3><p>{need.text}</p>
            <span className="needs-link">{need.label}<span aria-hidden="true">↗</span></span>
          </a>
        ))}
      </div>
    </section>
  );
}
