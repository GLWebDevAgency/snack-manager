/**
 * Maquettes CSS des 4 apps — aucune capture produit n'était disponible dans
 * `screenshots/` (le dossier ne contient que des visuels d'imprimerie).
 *
 * Ces blocs sont purement décoratifs (`aria-hidden`) : le contenu utile est
 * porté par la liste de fonctionnalités à côté. Les couleurs fonctionnelles y
 * gardent leur sens : vert = prêt, ambre = en préparation, rouge = en retard.
 */

import type { ModuleKey } from "./content";
import { MkIcon } from "./icons";

export function Mockup({ variant }: { variant: ModuleKey }) {
  if (variant === "pos") return <PosMock />;
  if (variant === "kds") return <KdsMock />;
  if (variant === "shop") return <ShopMock />;
  return <BackofficeMock />;
}

/* ── Caisse ──────────────────────────────────────────────────── */

const POS_PRODUCTS = [
  { name: "Tacos M", price: "8,50", hot: true },
  { name: "Tacos L", price: "10,50" },
  { name: "Menu Maxi", price: "13,00" },
  { name: "Burger Signature", price: "9,90" },
  { name: "Frites", price: "3,20" },
  { name: "Boisson 33 cl", price: "1,80" },
];

function PosMock() {
  return (
    <div className="mk-mock" aria-hidden="true">
      <div className="mk-mock-bar">
        <div>
          <div className="mk-mock-title">Caisse — À emporter</div>
          <div className="mk-mock-sub">Comptoir 1 · Karim</div>
        </div>
        <span className="mk-chip">Ticket #128</span>
      </div>

      <div className="mk-pos">
        <div className="mk-pos-grid">
          {POS_PRODUCTS.map((p) => (
            <div key={p.name} className="mk-pos-prod" data-hot={p.hot ? "true" : undefined}>
              <span>{p.name}</span>
              <b className="mk-num">{p.price} €</b>
            </div>
          ))}
        </div>

        <div className="mk-pos-ticket">
          <div className="mk-pos-line">
            <b>2 × Tacos M</b>
            <span className="mk-num">17,00 €</span>
          </div>
          <div className="mk-pos-note">sans oignons · sauce blanche</div>
          <div className="mk-pos-line">
            <b>1 × Menu Maxi</b>
            <span className="mk-num">13,00 €</span>
          </div>
          <div className="mk-pos-line">
            <b>2 × Boisson 33 cl</b>
            <span className="mk-num">3,60 €</span>
          </div>
          <div className="mk-pos-total">
            <span>Total</span>
            <b className="mk-num">33,60 €</b>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Cuisine ─────────────────────────────────────────────────── */

function KdsMock() {
  return (
    <div className="mk-mock" aria-hidden="true">
      <div className="mk-mock-bar">
        <div>
          <div className="mk-mock-title">Cuisine — Service du soir</div>
          <div className="mk-mock-sub">6 commandes en cours</div>
        </div>
        <span className="mk-chip">
          <i className="mk-dot" />
          En ligne
        </span>
      </div>

      <div className="mk-kds">
        <div className="mk-kds-col">
          <h5>Nouveau</h5>
          <div className="mk-kds-card" data-tone="red">
            <div className="mk-kds-head">
              <span className="mk-kds-no mk-num">N°44</span>
              <span className="mk-kds-time mk-num" data-tone="red">
                11:20
              </span>
            </div>
            <ul className="mk-kds-items">
              <li>2 × Tacos L</li>
              <li>
                1 × Frites — <em>sans sel</em>
              </li>
            </ul>
          </div>
          <div className="mk-kds-card" data-tone="amber">
            <div className="mk-kds-head">
              <span className="mk-kds-no mk-num">N°45</span>
              <span className="mk-kds-time mk-num" data-tone="amber">
                06:04
              </span>
            </div>
            <ul className="mk-kds-items">
              <li>1 × Menu Maxi</li>
            </ul>
          </div>
        </div>

        <div className="mk-kds-col">
          <h5>En prépa</h5>
          <div className="mk-kds-card" data-tone="amber">
            <div className="mk-kds-head">
              <span className="mk-kds-no mk-num">N°43</span>
              <span className="mk-kds-time mk-num" data-tone="amber">
                07:38
              </span>
            </div>
            <ul className="mk-kds-items">
              <li>1 × Burger Signature</li>
              <li>
                1 × Tacos M — <em>sans oignons</em>
              </li>
            </ul>
          </div>
        </div>

        <div className="mk-kds-col">
          <h5>Prêt</h5>
          <div className="mk-kds-card" data-tone="green">
            <div className="mk-kds-head">
              <span className="mk-kds-no mk-num">N°42</span>
              <span className="mk-kds-time mk-num" data-tone="green">
                Prête
              </span>
            </div>
            <ul className="mk-kds-items">
              <li>Sticker sac imprimé</li>
              <li>Client prévenu</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="mk-kds-launch">
        <MkIcon name="bolt" size={14} />À lancer maintenant : 3 frites · 2 tacos · 1 burger
      </div>
    </div>
  );
}

/* ── Commande en ligne ───────────────────────────────────────── */

function ShopMock() {
  return (
    <div className="mk-mock" aria-hidden="true">
      <div className="mk-mock-bar">
        <div>
          <div className="mk-mock-title">Commande en ligne</div>
          <div className="mk-mock-sub">votre-restaurant.fr · à vos couleurs</div>
        </div>
        <span className="mk-chip mk-chip--brass">0 % commission</span>
      </div>

      <div className="mk-shop">
        <div className="mk-phone">
          <div className="mk-phone-notch" />
          <div className="mk-shop-hero">
            <span>Class&apos;Food · Perriers</span>
          </div>

          <div className="mk-shop-cats">
            <span className="mk-shop-cat" data-on="true">
              Tacos
            </span>
            <span className="mk-shop-cat">Burgers</span>
            <span className="mk-shop-cat">Menus</span>
            <span className="mk-shop-cat">Desserts</span>
          </div>

          <div className="mk-shop-item">
            <div className="mk-shop-thumb" />
            <div className="mk-shop-txt">
              <strong>Tacos Signature</strong>
              <small>Taille M · 2 viandes</small>
            </div>
            <b className="mk-num">8,50 €</b>
          </div>
          <div className="mk-shop-item">
            <div className="mk-shop-thumb" />
            <div className="mk-shop-txt">
              <strong>Menu Maxi</strong>
              <small>Frites + boisson</small>
            </div>
            <b className="mk-num">13,00 €</b>
          </div>
          <div className="mk-shop-item">
            <div className="mk-shop-thumb" />
            <div className="mk-shop-txt">
              <strong>Wings ×6</strong>
              <small>Sauce signature</small>
            </div>
            <b className="mk-num">6,90 €</b>
          </div>

          <div className="mk-shop-cta">
            <span>Retrait 19h45</span>
            <span className="mk-num">Payer 18,90 €</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Back-office ─────────────────────────────────────────────── */

const BO_ROWS = [
  { label: "Signatures", pct: 82, value: "412 €", tone: "brass" as const },
  { label: "Tacos", pct: 70, value: "356 €" },
  { label: "Boissons", pct: 45, value: "210 €" },
  { label: "Desserts", pct: 30, value: "140 €" },
];

function BackofficeMock() {
  return (
    <div className="mk-mock" aria-hidden="true">
      <div className="mk-mock-bar">
        <div>
          <div className="mk-mock-title">Back-office — Aujourd&apos;hui</div>
          <div className="mk-mock-sub">Mise à jour il y a 4 s</div>
        </div>
        <span className="mk-chip">
          <i className="mk-dot" />
          Temps réel
        </span>
      </div>

      <div className="mk-bo">
        <div className="mk-bo-kpis">
          <div className="mk-bo-kpi" data-accent="true">
            <span>CA du jour</span>
            <b className="mk-num">1 290 €</b>
          </div>
          <div className="mk-bo-kpi">
            <span>Encaissé</span>
            <b className="mk-num">1 180 €</b>
          </div>
          <div className="mk-bo-kpi">
            <span>Commandes</span>
            <b className="mk-num">86</b>
          </div>
        </div>

        <div className="mk-bo-chart">
          <svg viewBox="0 0 320 60" preserveAspectRatio="none" width="100%" height="52" aria-hidden="true">
            <defs>
              <linearGradient id="mk-bo-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(201,161,90,.34)" />
                <stop offset="100%" stopColor="rgba(201,161,90,0)" />
              </linearGradient>
            </defs>
            <path
              d="M0 50 L40 38 L80 44 L120 24 L160 34 L200 14 L240 30 L280 8 L320 20 L320 60 L0 60 Z"
              fill="url(#mk-bo-grad)"
            />
            <path
              d="M0 50 L40 38 L80 44 L120 24 L160 34 L200 14 L240 30 L280 8 L320 20"
              fill="none"
              stroke="rgba(255,255,255,.38)"
              strokeWidth="1.2"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </div>

        <div className="mk-bo-rows">
          {BO_ROWS.map((r) => (
            <div key={r.label} className="mk-bo-row">
              <span>{r.label}</span>
              <span className="mk-bar">
                <i style={{ width: `${r.pct}%` }} data-tone={r.tone} />
              </span>
              <b className="mk-num">{r.value}</b>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
