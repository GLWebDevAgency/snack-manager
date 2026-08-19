import { IcoBag, IcoBolt, IcoClock, IcoPhone, IcoTray } from "./icons";

const TEAM = [
  { name: "Léa", role: "Cuisine" },
  { name: "Hugo", role: "Caisse" },
  { name: "Inès", role: "Manager" },
  { name: "Noah", role: "Service salle" },
  { name: "Jade", role: "Plonge" },
  { name: "Adam", role: "Ouverture" },
];

const WAVE = [20, 45, 35, 32, 70, 15, 40, 25];

const SALES = [
  { label: "Signatures", width: "82%", value: "412 €" },
  { label: "Tacos", width: "70%", value: "356 €" },
  { label: "Boissons", width: "45%", value: "210 €" },
  { label: "Desserts", width: "30%", value: "140 €" },
];

/** Un nœud du petit flux « Commande reçue → En préparation → Prête ». */
function WfStep({ icon, label, first }: { icon: React.ReactNode; label: string; first?: boolean }) {
  return (
    <div className="wf-step">
      {first ? null : (
        <svg className="wf-connector" width="2" height="22" aria-hidden="true">
          <line x1="1" y1="0" x2="1" y2="22" className="wf-dash" />
        </svg>
      )}
      <div className="wf-node">
        <span className="wf-icon">{icon}</span>
        <span className="wf-label">{label}</span>
        <span className="wf-spacer" />
        <span className="wf-status" />
      </div>
    </div>
  );
}

/**
 * « Une plateforme, quatre métiers du service » — la grille bento de la
 * maquette : six cartes d'ambiance (flux cuisine, équipe, téléphone, fidélité,
 * back-office, suivi client), animées uniquement en CSS.
 */
export function Platform() {
  return (
    <section className="section" id="produit">
      <span className="badge">La plateforme</span>
      <h2 className="h2 center-h2" style={{ maxWidth: 650 }}>
        Une plateforme, quatre métiers du service
      </h2>

      <div className="sol-grid">
        <div className="sol-col">
          <div className="sol-card rv">
            <div className="sol-mockup" aria-hidden="true">
              <div className="wf-nodes">
                <WfStep first icon={<IcoClock size={11} />} label="Commande reçue" />
                <WfStep icon={<IcoTray />} label="En préparation" />
                <WfStep icon={<IcoBag />} label="Prête à remettre" />
              </div>
            </div>
            <p className="sol-caption">
              <strong>Cuisine.</strong> « 3 frites à lancer » : la cuisine voit tout ce qu&apos;il faut lancer, en un coup
              d&apos;œil.
            </p>
          </div>

          <div className="sol-card rv">
            <div className="sol-mockup" aria-hidden="true">
              <div className="ag-ticker">
                <div className="ag-track">
                  {[0, 1].map((pass) =>
                    TEAM.map((m) => (
                      <div className="ag-row" key={`${pass}-${m.name}`}>
                        <span className="ag-avatar" />
                        <span className="ag-meta">
                          <span className="ag-name">{m.name}</span>
                          <span className="ag-role">{m.role}</span>
                        </span>
                        <span className="ag-dot" />
                      </div>
                    )),
                  )}
                </div>
              </div>
            </div>
            <p className="sol-caption">
              <strong>Équipe.</strong> Rôles, plannings et présences gérés au même endroit.
            </p>
          </div>
        </div>

        <div className="sol-col">
          <div className="sol-card rv">
            <div className="sol-mockup" aria-hidden="true">
              <div className="vo-waves">
                <div className="vo-track">
                  {[0, 1].map((pass) =>
                    WAVE.map((h, i) => <span className="vo-bar" key={`${pass}-${i}`} style={{ height: h }} />),
                  )}
                </div>
              </div>
              <span className="vo-icon">
                <IcoPhone />
              </span>
            </div>
            <p className="sol-caption">
              <strong>Téléphone.</strong> Prenez les commandes par téléphone sans perdre le fil.
            </p>
          </div>

          <div className="sol-card rv">
            <div className="sol-mockup" aria-hidden="true">
              <div className="mkt">
                <div className="mkt-header">
                  <IcoBolt />
                  <span className="mkt-title">Fidélité &amp; Promos</span>
                  <span className="mkt-dots">
                    <i />
                    <i />
                    <i />
                  </span>
                </div>
                <p className="mkt-line">Points cumulés à chaque passage…</p>
                <p className="mkt-line">Codes promo actifs…</p>
                <div className="mkt-chips">
                  {["Points", "Tampons", "SMS", "Email", "Anniversaire", "Parrainage"].map((c) => (
                    <span className="mkt-chip" key={c}>
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <p className="sol-caption">
              <strong>Fidélité.</strong> Points, tampons et codes promo qui donnent envie de revenir.
            </p>
          </div>
        </div>

        <div className="sol-col">
          <div className="sol-card rv">
            <div className="sol-mockup tall" aria-hidden="true">
              <div className="data-head">
                <span className="data-cell">
                  <span className="data-label">CA DU JOUR</span>
                  <span className="data-value">1 290 €</span>
                </span>
                <span className="data-right">
                  <span className="data-cell">
                    <span className="data-label">ENCAISSÉ</span>
                    <span className="data-value">1 180 €</span>
                  </span>
                  <span className="data-cell">
                    <span className="data-label">RESTE</span>
                    <span className="data-value">110 €</span>
                  </span>
                </span>
              </div>
              <svg className="data-graph" viewBox="0 0 320 60" preserveAspectRatio="none" aria-hidden="true">
                <defs>
                  <linearGradient id="sm-exp-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="rgba(201,161,90,.28)" />
                    <stop offset="1" stopColor="rgba(201,161,90,0)" />
                  </linearGradient>
                </defs>
                <path
                  d="M0 50 L40 38 L80 44 L120 24 L160 34 L200 14 L240 30 L280 8 L320 20 L320 60 L0 60 Z"
                  fill="url(#sm-exp-grad)"
                />
                <path
                  d="M0 50 L40 38 L80 44 L120 24 L160 34 L200 14 L240 30 L280 8 L320 20"
                  fill="none"
                  stroke="rgba(255,255,255,.35)"
                  strokeWidth="1"
                />
              </svg>
              <div className="data-rows">
                {SALES.map((s) => (
                  <div className="data-row" key={s.label}>
                    <span className="data-rowlabel">{s.label}</span>
                    <span className="data-track">
                      <span className="data-fill" style={{ width: s.width }} />
                    </span>
                    <span className="data-rowvalue">{s.value}</span>
                  </div>
                ))}
              </div>
            </div>
            <p className="sol-caption">
              <strong>Back-office.</strong> Chiffre d&apos;affaires et dépenses suivis en temps réel.
            </p>
          </div>

          <div className="sol-card rv">
            <div className="sol-mockup" aria-hidden="true">
              <div className="chat">
                <div className="chat-msgs">
                  <div className="msg-customer">
                    <span className="bubble-customer">Commande #42 envoyée ✓</span>
                  </div>
                  <div className="msg-agent">
                    <span className="chat-avatar" />
                    <span className="bubble-agent">Reçue en cuisine</span>
                  </div>
                  <div className="msg-agent">
                    <span className="chat-avatar" />
                    <span className="bubble-agent">Prête dans ~12 min</span>
                  </div>
                </div>
                <span className="chat-tag">Suivi de commande en direct</span>
              </div>
            </div>
            <p className="sol-caption">
              <strong>Site &amp; commande.</strong> Vos clients commandent, vous êtes prévenu instantanément.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
