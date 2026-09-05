"use client";

import { useState } from "react";
import { CTA_CALLBACK, SIM_CTA_NOTE, SIM_LEAD, SIM_NOTES, ancre, euros, section } from "./content";
import { currentOperatingCost } from "./cost-model";

const FIELDS = [
  { id: "coordinationHours", label: "Coordination par mois", unit: "heures", max: 400, step: 1 },
  { id: "hourlyCostEuros", label: "Votre coût horaire chargé", unit: "€/heure", max: 150, step: 0.5 },
  { id: "remakes", label: "Plats refaits par mois", unit: "plats", max: 500, step: 1 },
  { id: "remakeCostEuros", label: "Coût matière d’un plat refait", unit: "€/plat", max: 100, step: 0.5 },
] as const;

/** Mesure le coût déclaré de l'organisation actuelle, sans promettre sa disparition. */
export function Simulator() {
  const { badge, title } = section("simulateur");
  const [inputs, setInputs] = useState({
    coordinationHours: 0, hourlyCostEuros: 0, remakes: 0, remakeCostEuros: 0,
  });
  const result = currentOperatingCost(inputs);

  return (
    <section className="section sim-section" id="simulateur">
      {badge ? <span className="badge">{badge}</span> : null}
      <h2 className="h2 center-h2" style={{ maxWidth: 760 }}>{title}</h2>
      <div className="sim-lead rv">
        <p className="sim-leadtitle">{SIM_LEAD.title}</p>
        <p className="sim-leadline">{SIM_LEAD.line}</p>
      </div>
      <div className="sim-board rv">
        <div className="sim-controls spot">
          {FIELDS.map((field) => (
            <div className="sim-ctl" key={field.id}>
              <div className="sim-ctlhead">
                <label htmlFor={`s-${field.id}`}>{field.label}</label>
                <span>{field.unit}</span>
              </div>
              <input
                id={`s-${field.id}`}
                type="number"
                inputMode="decimal"
                min={0}
                max={field.max}
                step={field.step}
                value={inputs[field.id]}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setInputs((previous) => ({
                    ...previous,
                    [field.id]: Number.isFinite(value) ? Math.min(field.max, Math.max(0, value)) : 0,
                  }));
                }}
              />
            </div>
          ))}
        </div>
        <div className="sim-results spot">
          <p className="sim-reslabel">Coût actuel déclaré par mois</p>
          <p className="sim-resbig" aria-live="polite">{euros(result.totalCents)}</p>
          <div className="sim-resrows">
            <div className="sim-resrow"><span>Temps de coordination valorisé</span><b>{euros(result.coordinationCents)}</b></div>
            <div className="sim-resrow"><span>Coût matière des plats refaits</span><b>{euros(result.remakesCents)}</b></div>
          </div>
          <p className="sim-equiv">
            Ce montant décrit votre situation, pas une économie promise.
            L’essai permettra de mesurer ce qui change réellement.
          </p>
          <a className="btn light sim-cta" href={ancre("contact").href}>{CTA_CALLBACK}</a>
          <p className="sim-ctanote">{SIM_CTA_NOTE}</p>
        </div>
      </div>
      <details className="sim-fold rv">
        <summary className="sim-foldsum">Comment ce coût est calculé</summary>
        <p className="sim-foldtext">{SIM_NOTES}</p>
      </details>
    </section>
  );
}
