"use client";

import { Fragment, useMemo, useState } from "react";
import { SIM_FLOW, SIM_NOTES } from "./content";

/* ── Hypothèses (identiques à la maquette, § « sim ») ───────────────── */
const HOURLY = 13; // coût horaire chargé, €/h
const DAYS = 30.4; // jours par mois
const WEEKS = 4.33; // semaines par mois
const FULLTIME = 151.67; // heures d'un temps plein mensuel

/*
 * Formatage maison plutôt que `toLocaleString` : le séparateur de milliers de
 * l'ICU français a changé d'espace selon les versions, et un écart entre le
 * rendu serveur et le rendu navigateur casserait l'hydratation.
 */
const NARROW_NBSP = " ";
const NBSP = " ";

function group(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, NARROW_NBSP);
}
function euro(n: number): string {
  return `${group(n)}${NBSP}€`;
}
function decimalEuro(n: number): string {
  return `${n.toFixed(2).replace(".", ",")}${NBSP}€`;
}

type Field = { id: string; label: string; hint?: string; min: number; max: number; step: number };

const FIELDS: Field[] = [
  { id: "cmd", label: "Commandes par jour", min: 20, max: 300, step: 5 },
  { id: "panier", label: "Panier moyen", min: 6, max: 25, step: 0.5 },
  {
    id: "err",
    label: "Commandes refaites par semaine",
    hint: "écriture mal relue, oublis, erreurs de prix",
    min: 0,
    max: 30,
    step: 1,
  },
  {
    id: "mins",
    label: "Minutes perdues par service en coordination",
    hint: "totaux calculés de tête, déchiffrage, re-annonces en cuisine",
    min: 0,
    max: 60,
    step: 5,
  },
  {
    id: "tel",
    label: "Commandes par téléphone par jour",
    hint: "décrochés en plein rush — en caisse, ou par quelqu'un qui quitte son poste",
    min: 0,
    max: 40,
    step: 1,
  },
];

/**
 * Simulateur de ROI de la maquette : cinq curseurs, un panneau de résultats
 * recalculé à chaque `input`. Les formules sont reprises telles quelles du
 * script de la maquette — on ne « corrige » pas les hypothèses du fondateur.
 */
export function Simulator() {
  const [cmd, setCmd] = useState(80);
  const [panier, setPanier] = useState(11.5);
  const [err, setErr] = useState(6);
  const [mins, setMins] = useState(20);
  const [tel, setTel] = useState(12);

  const r = useMemo(() => {
    const phone = Math.min(tel, cmd);

    // Erreurs évitées : −35 % des commandes refaites, valorisées à 50 % du panier.
    const errSave = err * WEEKS * panier * 0.5 * 0.35;
    // Coordination : minutes perdues × 2 services, converties en heures puis en euros.
    const coordHours = (mins * 2 * DAYS) / 60;
    const coordSave = coordHours * HOURLY;
    // Téléphone : 60 % des appels migrent en ligne, 4 min économisées par appel.
    const phoneMigrated = phone * 0.6;
    const phoneHours = (phoneMigrated * 4 * DAYS) / 60;
    const phoneSave = phoneHours * HOURLY;
    // CA additionnel : les commandes migrées + 10 % du comptoir, à +15 % de panier.
    const online = phoneMigrated + cmd * 0.1;
    const revenue = online * DAYS * panier * 0.15;

    const monthly = errSave + coordSave + phoneSave;
    const hours = coordHours + phoneHours;

    return {
      monthly,
      yearly: (monthly + revenue) * 12,
      errSave,
      coordSave,
      phoneSave,
      revenue,
      hours,
      fulltime: Math.round((hours / FULLTIME) * 100),
    };
  }, [cmd, panier, err, mins, tel]);

  const value: Record<string, number> = { cmd, panier, err, mins, tel };
  const setter: Record<string, (n: number) => void> = {
    cmd: setCmd,
    panier: setPanier,
    err: setErr,
    mins: setMins,
    tel: setTel,
  };
  const display: Record<string, string> = {
    cmd: String(cmd),
    panier: decimalEuro(panier),
    err: String(err),
    mins: `${mins} min`,
    tel: String(Math.min(tel, cmd)),
  };

  return (
    <section className="section sim-section" id="simulateur">
      <span className="badge">Le calcul</span>
      <h2 className="h2 center-h2" style={{ maxWidth: 620 }}>
        Combien vous coûte votre organisation actuelle ?
      </h2>
      <p className="body-text sim-esc rv">
        Sans vrai POS, tout repose sur des feuilles griffonnées et des totaux calculés de tête. Une commande mal relue,
        c&apos;est un plat refait : <strong>≈ 5,75 €</strong> à la poubelle. Deux par service, midi et soir, 7 j/7 :{" "}
        <strong>≈ 700 € par mois</strong> — sans compter les heures passées à former chaque nouvelle recrue à « votre »
        caisse. Faites le calcul avec vos chiffres :
      </p>

      <div className="sim-board rv">
        <div className="sim-controls spot">
          {FIELDS.map((f) => (
            <div className="sim-ctl" key={f.id}>
              <div className="sim-ctlhead">
                <label htmlFor={`s-${f.id}`}>
                  {f.label}
                  {f.hint ? <span className="sim-hint">{f.hint}</span> : null}
                </label>
                <output htmlFor={`s-${f.id}`}>{display[f.id]}</output>
              </div>
              <input
                type="range"
                id={`s-${f.id}`}
                min={f.min}
                max={f.max}
                step={f.step}
                value={value[f.id]}
                onChange={(e) => setter[f.id](Number(e.target.value))}
              />
            </div>
          ))}
        </div>

        <div className="sim-results spot">
          <p className="sim-reslabel">Récupérable chaque mois</p>
          <p className="sim-resbig" aria-live="polite">
            {euro(r.monthly)}
          </p>
          <p className="sim-resyear">
            soit <b>{euro(r.yearly)}</b> par an, CA additionnel du panier en ligne inclus
          </p>
          <div className="sim-resrows">
            <div className="sim-resrow">
              <span>Erreurs évitées (−35 %)</span>
              <b>{euro(r.errSave)}</b>
            </div>
            <div className="sim-resrow">
              <span>Totaux, déchiffrage &amp; re-annonces supprimés</span>
              <b>{euro(r.coordSave)}</b>
            </div>
            <div className="sim-resrow">
              <span>Téléphone déchargé — appels + interruptions de poste</span>
              <b>{euro(r.phoneSave)}</b>
            </div>
            <div className="sim-resrow accent">
              <span>CA additionnel — panier en ligne +15 %</span>
              <b>+ {euro(r.revenue)}</b>
            </div>
            <div className="sim-resrow">
              <span>Heures d&apos;équipe libérées</span>
              <b>
                {group(r.hours)}
                {NBSP}h
              </b>
            </div>
          </div>
          <p className="sim-equiv">
            ≈ {r.fulltime} % d&apos;un temps plein récupéré — hors gain des erreurs évitées.
          </p>
          <a className="btn light sim-cta" href="#contact">
            Vérifier ces chiffres avec nous
          </a>
        </div>
      </div>

      <div className="sim-flow rv">
        <p className="sim-flowtitle">Pourquoi ça tient : la commande en ligne ne passe plus par la caisse</p>
        <div className="sim-flowsteps">
          {/* Fragment (et non un span) : `.sim-flowstep:last-child` doit rester vrai. */}
          {SIM_FLOW.map((step, i) => (
            <Fragment key={step}>
              {i > 0 ? <span className="sim-flowarrow">→</span> : null}
              <span className="sim-flowstep">{step}</span>
            </Fragment>
          ))}
        </div>
        <p className="sim-flownote">
          Pendant ce temps, la personne en caisse reste avec les clients physiques — personne ne quitte son poste en
          cuisine pour décrocher, personne ne fait patienter la file.
        </p>
      </div>

      <p className="sim-notes rv">{SIM_NOTES}</p>
    </section>
  );
}
