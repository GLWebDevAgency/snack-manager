"use client";

import { useEffect, useRef, useState } from "react";
import { WIDGET_PLATFORMS, WIDGET_POINTS, WIDGET_SNIPPET } from "./content";
import { MkIcon, MkTick } from "./icons";

/**
 * « Compatible avec votre site actuel » — argument commercial clé : une ligne de
 * code à coller, pas de refonte. Le bouton copier retombe sur une sélection
 * manuelle si l'API presse-papiers est refusée (http, permission bloquée).
 */
export function WidgetSection() {
  const [copied, setCopied] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(WIDGET_SNIPPET);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2200);
    } catch {
      const node = preRef.current;
      if (!node) return;
      const range = document.createRange();
      range.selectNodeContents(node);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  };

  return (
    <section className="mk-section" id="site">
      <div className="mk-wrap">
        <div className="mk-widget">
          <div data-rv>
            <span className="mk-eyebrow">Votre site actuel</span>
            <h2 className="mk-h2" style={{ marginTop: 16 }}>
              Vous gardez votre site. On y branche la commande.
            </h2>
            <p className="mk-lead" style={{ marginTop: 14 }}>
              Pas de refonte, pas de migration, pas de sous-domaine bricolé :{" "}
              <span className="mk-kw">une ligne de code à coller</span> et votre site encaisse des commandes le soir
              même.
            </p>

            <ul className="mk-contact-list" style={{ marginTop: 24, gap: 16 }}>
              {WIDGET_POINTS.map((p) => (
                <li key={p.title}>
                  <MkTick className="mk-tick" />
                  <span>
                    <strong style={{ display: "block", color: "#fff", fontWeight: 600, fontSize: 14 }}>
                      {p.title}
                    </strong>
                    <span style={{ display: "block", marginTop: 3 }}>{p.text}</span>
                  </span>
                </li>
              ))}
            </ul>

            <div className="mk-logos" style={{ marginTop: 22 }}>
              {WIDGET_PLATFORMS.map((p) => (
                <span className="mk-chip" key={p}>
                  {p}
                </span>
              ))}
            </div>
          </div>

          <div data-rv style={{ transitionDelay: "80ms" }}>
            <div className="mk-code">
              <div className="mk-code-bar">
                <span className="mk-code-file">index.html — juste avant &lt;/body&gt;</span>
                <button type="button" className="mk-copy" onClick={copy} data-done={copied || undefined}>
                  <MkIcon name={copied ? "check" : "copy"} size={13} />
                  {copied ? "Copié" : "Copier"}
                </button>
              </div>
              <pre ref={preRef}>
                <code>
                  <span className="t">&lt;script</span> <span className="a">src</span>=
                  <span className="v">&quot;https://app.snackmanager.fr/w.js&quot;</span>
                  {"\n        "}
                  <span className="a">data-tenant</span>=<span className="v">&quot;votre-restaurant&quot;</span>{" "}
                  <span className="a">defer</span>
                  <span className="t">&gt;&lt;/script&gt;</span>
                </code>
              </pre>
            </div>

            <div className="mk-card" style={{ marginTop: 16, padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <MkIcon name="code" size={17} />
                <strong style={{ fontSize: 14.5, fontWeight: 650 }}>Et si je n&apos;ai pas de site ?</strong>
              </div>
              <p className="mk-body">
                On vous en fournit un complet, à vos couleurs, avec la carte, les créneaux et le paiement — inclus dans
                les formules Complet et Multi-sites. Vous gardez votre nom de domaine.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
