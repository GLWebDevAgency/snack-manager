import { VS_WITH, VS_WITHOUT } from "./content";
import { CmpBolt, CmpCross, CrossDot, TickDot } from "./icons";

/**
 * « Sans vs avec Snack Manager » — deux colonnes séparées par le disque « VS ».
 * Au survol du plateau, la colonne « sans » s'éteint : le regard va tout seul
 * du côté qui gagne.
 */
export function Comparison() {
  return (
    <section className="section cmp-section">
      <span className="badge">Comparatif</span>
      <h2 className="h2 center-h2" style={{ maxWidth: 650 }}>
        Sans vs avec Snack Manager
      </h2>

      <div className="cmp-board">
        <div className="cmp-heads rv">
          <div className="cmp-headpill left">
            <CmpCross />
            <span>Sans Snack Manager</span>
          </div>
          <div className="cmp-headpill right">
            <CmpBolt />
            <span>Snack Manager</span>
          </div>
        </div>
        <span className="cmp-vs" aria-hidden="true">
          VS
        </span>
        <span className="cmp-divider" aria-hidden="true" />

        <div className="cmp-cols">
          <div className="rv rv-x-l">
            <ul className="cmp-col left">
              {VS_WITHOUT.map((t) => (
                <li key={t}>
                  <CrossDot />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rv rv-x-r">
            <ul className="cmp-col right">
              {VS_WITH.map((t) => (
                <li key={t}>
                  <TickDot />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
