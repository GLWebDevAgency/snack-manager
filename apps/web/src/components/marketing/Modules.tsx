"use client";

import { useId, useState } from "react";
import { MODULES, type ModuleKey } from "./content";
import { MkIcon } from "./icons";
import { Mockup } from "./Mockups";

/**
 * « Une plateforme, quatre métiers » — onglets accessibles (rôles tab/tabpanel,
 * navigation aux flèches). Les 4 panneaux sont montés en permanence et masqués
 * par `hidden` : le contenu reste dans le DOM pour le référencement.
 */
export function Modules() {
  const [active, setActive] = useState<ModuleKey>("pos");
  const base = useId().replace(/[:]/g, "");

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const i = MODULES.findIndex((m) => m.key === active);
    if (i < 0) return;
    let next = i;
    if (e.key === "ArrowRight") next = (i + 1) % MODULES.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + MODULES.length) % MODULES.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = MODULES.length - 1;
    else return;
    e.preventDefault();
    const target = MODULES[next];
    if (!target) return;
    setActive(target.key);
    document.getElementById(`${base}-tab-${target.key}`)?.focus();
  };

  return (
    <section className="mk-section" id="produit">
      <div className="mk-wrap">
        <div className="mk-head mk-head--center" data-rv>
          <span className="mk-eyebrow">La plateforme</span>
          <h2 className="mk-h2">Une plateforme, quatre métiers du service</h2>
          <p className="mk-lead">
            Caisse, cuisine, commande en ligne et back-office partagent la même carte, la même file de préparation et
            les mêmes chiffres. Rien à ressaisir, nulle part.
          </p>
        </div>

        <div style={{ marginTop: 32 }}>
          <div className="mk-tabs" role="tablist" aria-label="Les quatre modules" onKeyDown={onKeyDown} data-rv>
            {MODULES.map((m) => (
              <button
                key={m.key}
                id={`${base}-tab-${m.key}`}
                type="button"
                role="tab"
                className="mk-tab"
                aria-selected={active === m.key}
                aria-controls={`${base}-panel-${m.key}`}
                tabIndex={active === m.key ? 0 : -1}
                onClick={() => setActive(m.key)}
              >
                <MkIcon name={m.icon} size={16} />
                {m.tab}
              </button>
            ))}
          </div>

          <div style={{ marginTop: 16 }} data-rv>
            {MODULES.map((m, i) => (
              <div
                key={m.key}
                id={`${base}-panel-${m.key}`}
                role="tabpanel"
                aria-labelledby={`${base}-tab-${m.key}`}
                hidden={active !== m.key}
                className="mk-panel mk-module"
                data-flip={i % 2 === 1 ? "true" : undefined}
              >
                <div className="mk-module-copy">
                  <span className="mk-module-device">{m.device}</span>
                  <h3 className="mk-h3">{m.name}</h3>
                  <p className="mk-body">{m.pitch}</p>
                  <ul className="mk-feats">
                    {m.features.map((f) => (
                      <li key={`${f.a ?? ""}${f.b ?? ""}${f.c ?? ""}`}>
                        <span>
                          {f.a}
                          {f.b ? <b>{f.b}</b> : null}
                          {f.c}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <Mockup variant={m.key} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
