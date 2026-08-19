import { BfBars, BfBolt, BfClock, BfEuro, BfTarget, BfTrend, LogoMark } from "./icons";

const LEFT = [
  { icon: <BfClock />, strong: "Gain de temps.", text: " Automatisez les tâches répétitives." },
  { icon: <BfEuro />, strong: "Économique.", text: " Réduisez la charge de travail manuelle." },
  { icon: <BfBolt />, strong: "Service plus fluide.", text: " Accélérez vos opérations." },
];

const RIGHT = [
  { icon: <BfTrend />, strong: "Meilleure visibilité.", text: " Comprenez vos chiffres rapidement." },
  { icon: <BfTarget />, strong: "Moins d'erreurs.", text: " Réduisez les erreurs humaines." },
  { icon: <BfBars />, strong: "Évolutif.", text: " Grandissez sans effort supplémentaire." },
];

function Tile({ icon, strong, text, right }: { icon: React.ReactNode; strong: string; text: string; right?: boolean }) {
  return (
    <div className={right ? "bf-tile right" : "bf-tile"}>
      <div className="bf-tileinner">
        <span className="bf-iconholder">{icon}</span>
        <p className="bf-tiletext">
          <strong>{strong}</strong>
          {text}
        </p>
      </div>
    </div>
  );
}

/**
 * « Ce qui change avec Snack Manager » — l'escalier de tuiles de la maquette :
 * trois tuiles décalées à gauche, le pilier au logo au centre (halo laiton
 * pulsé), trois tuiles décalées à droite.
 */
export function Benefits() {
  return (
    <section className="section">
      <div className="section-head rv">
        <span className="badge">Pourquoi nous</span>
        <h2 className="h2">Ce qui change avec Snack Manager</h2>
      </div>

      <div className="bf-grid">
        <div className="rv rv-x-l">
          <div className="bf-sidegrid bf-left">
            {LEFT.map((t) => (
              <Tile key={t.strong} {...t} />
            ))}
          </div>
        </div>

        <div className="rv" style={{ transitionDelay: "0.1s" }}>
          <div className="bf-pillar">
            <div className="bf-pillarinner">
              <div className="bf-logozone">
                <span className="bf-halo" />
                <span className="bf-logoborder">
                  <span className="bf-logoholder">
                    <LogoMark width={54} height={54} />
                  </span>
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="rv rv-x-r">
          <div className="bf-sidegrid bf-right">
            {RIGHT.map((t) => (
              <Tile key={t.strong} {...t} right />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
