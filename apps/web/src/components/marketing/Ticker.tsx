import { TICKER } from "./content";
import { NotchFillet } from "./icons";

/**
 * Bandeau défilant accroché sous le hero — l'encoche inversée de la maquette.
 * La piste contient deux fois la liste : l'animation `translateX(-50%)` boucle
 * alors sans saut visible.
 */
export function Ticker() {
  return (
    <div className="ticker-wrap" aria-hidden="true">
      <span className="ticker-shoulder">
        <NotchFillet />
      </span>
      <div className="ticker-mid">
        <div className="ticker-track">
          {[0, 1].map((pass) =>
            TICKER.map((label) => (
              <span className="ticker-item" key={`${pass}-${label}`}>
                <span className="td" />
                {label}
              </span>
            )),
          )}
        </div>
      </div>
      <span className="ticker-shoulder">
        <NotchFillet flip flipY />
      </span>
    </div>
  );
}
