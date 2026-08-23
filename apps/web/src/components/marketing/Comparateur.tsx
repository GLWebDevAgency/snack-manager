"use client";

import { useMemo, useState } from "react";
import {
  COMPARE,
  COMPARE_FIXED_CENTS,
  COMPARE_RATE,
  NARROW_NBSP,
  NBSP,
  PLAN_MONTHLY_CENTS,
} from "./content";

/*
 * Formatage local, pour la même raison que le simulateur : on compte ici en
 * euros et non en centimes, `euros()` ne convient pas — et `toLocaleString`
 * casserait l'hydratation (voir Simulator.tsx). Les deux espaces, elles,
 * viennent de content.ts : les redéclarer ici est la faute qui a déjà rendu
 * tous les montants du simulateur sécables sans que personne le voie.
 */
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
function pct(n: number): string {
  return `${(n * 100).toFixed(1).replace(".", ",")}${NBSP}%`;
}

/**
 * L'abonnement comparé se DÉRIVE de la grille, il ne se recopie pas : le jour
 * où Boost bouge, ce montant suit — la règle de toute la page (« un montant ne
 * s'écrit qu'une fois »).
 */
const BOOST_YEARLY_EUROS = (PLAN_MONTHLY_CENTS.boost * 12) / 100;

/**
 * Le comparateur de la « caisse gratuite » — la quatrième ligne du tableau des
 * commissions, rendue manipulable.
 *
 * Même contrat d'honnêteté que le simulateur : le seul chiffre de résultat est
 * celui que le visiteur fabrique de ses propres curseurs, à partir d'un taux
 * public qu'il peut vérifier — et remplacer en démo par celui qu'on lui a
 * réellement proposé.
 */
export function Comparateur() {
  const [volume, setVolume] = useState(20_000);
  const [ticket, setTicket] = useState(12);

  const r = useMemo(() => {
    // Le nombre de passages en caisse est toute l'histoire : c'est lui que
    // les frais fixes multiplient, et un snack en fait beaucoup pour de
    // petits montants.
    const transactions = volume / ticket;
    const monthly = volume * COMPARE_RATE + (transactions * COMPARE_FIXED_CENTS) / 100;
    return { yearly: monthly * 12, rate: monthly / volume };
  }, [volume, ticket]);

  const fields = [
    {
      ...COMPARE.fields.volume,
      id: "volume",
      value: volume,
      set: setVolume,
      display: euro(volume),
    },
    {
      ...COMPARE.fields.ticket,
      id: "ticket",
      value: ticket,
      set: setTicket,
      display: decimalEuro(ticket),
    },
  ];

  return (
    <>
      {/* La section est une colonne centrée (gap 40) : lead, board et
          dépliable y prennent chacun leur rang, comme au simulateur. */}
      <div className="sim-lead rv">
        <p className="sim-leadtitle">{COMPARE.lead}</p>
        <p className="sim-leadline">{COMPARE.line}</p>
      </div>

      <div className="sim-board rv" role="group" aria-label={COMPARE.lead}>
        <div className="sim-controls spot">
          {fields.map((f) => (
            <div className="sim-ctl" key={f.id}>
              <div className="sim-ctlhead">
                <label htmlFor={`c-${f.id}`}>{f.label}</label>
                <output htmlFor={`c-${f.id}`}>{f.display}</output>
              </div>
              <input
                type="range"
                id={`c-${f.id}`}
                min={f.min}
                max={f.max}
                step={f.step}
                value={f.value}
                onChange={(e) => f.set(Number(e.target.value))}
              />
            </div>
          ))}
        </div>

        <div className="sim-results spot">
          <p className="sim-reslabel">{COMPARE.resLabel}</p>
          <p className="sim-resbig" aria-live="polite">
            ≈{NBSP}
            {euro(r.yearly)}
          </p>
          <div className="sim-resrows">
            <div className="sim-resrow">
              <span>
                {COMPARE.rateRow} de {decimalEuro(ticket)}
              </span>
              <b>{pct(r.rate)}</b>
            </div>
            <div className="sim-resrow accent">
              <span>{COMPARE.boostRow}</span>
              <b>{euro(BOOST_YEARLY_EUROS)}</b>
            </div>
          </div>
        </div>
      </div>

      {/* Même contrat que « Nos hypothèses » au simulateur : la provenance du
          taux est disponible pour qui la cherche, silencieuse pour les autres. */}
      <details className="sim-fold rv">
        <summary className="sim-foldsum">D&apos;où sort ce taux ?</summary>
        <p className="sim-foldtext">{COMPARE.note}</p>
      </details>
    </>
  );
}
