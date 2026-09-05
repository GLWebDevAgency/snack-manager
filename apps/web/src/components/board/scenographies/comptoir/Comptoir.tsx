"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  cadrageCss,
  type Brand,
  type ScreenContent,
  type ScreenProduct,
  type ScreenPromo,
  type ScreenScenePayload,
} from "@sm/contracts";
import { verrouPour } from "@/components/ui/verrou";
import { marqueSeule } from "../../board-header";
import { useRestaurantClock } from "../../board-runtime";
import type { ScenographyModule, ScenographyProps } from "../registry";
import { disposition, variablesDeScene, type Disposition } from "./composition";
import { FadeText } from "./FadeText";

/**
 * COMPTOIR — « le comptoir de nuit ».
 *
 * L'œil voit d'abord la nourriture : des boîtes photo pleines, posées sur un
 * fond profond, comme des plats sous la lampe du comptoir. Deuxième lecture,
 * le prix : étiquette collée en accent, un peu de travers, jamais discrète,
 * jamais animée. Troisième, le nom en capitales de titrage, puis la
 * composition en retrait. Le titre de scène ancre la catégorie ; son fantôme
 * tapisse le fond et donne de la matière sans rien ajouter.
 *
 * Le rythme : une entrée en cascade des boîtes, puis le calme — seule la
 * photo du héros dérive, sur toute la durée de la scène. Rien ne clignote,
 * rien ne saute quand un prix change (`FadeText`, clés par identifiant).
 *
 * Tout vient du masque et du contenu : aucune couleur, aucune police, aucune
 * durée ici. La même scénographie sert tous les restaurants.
 */

/** Le contrat plafonne à huit ; un panneau libre n'est pas paginé par le serveur. */
const MAX_PRODUITS = 8;
const MAX_OFFRES = 3;

/** « Les », « La », « L' » ne font pas une initiale. */
function initiale(nom: string): string {
  return (
    nom
      .replace(/^\s*(les?|la|l')\s*/i, "")
      .trim()
      .charAt(0)
      .toUpperCase() || "?"
  );
}

/** Le temps qu'on laisse à l'ancienne photo sous la neuve, une fois celle-ci chargée. */
const RELEVE_PHOTO_MS = 400;

/**
 * La photo d'un produit — et son remplacement SANS TROU.
 *
 * Quand le gérant change la photo, la neuve se charge PAR-DESSUS l'ancienne,
 * invisible tant qu'elle n'est pas arrivée, puis se fond ; l'ancienne reste
 * dessous jusque-là. Sans cela, l'écran montrerait un aplat de surface le
 * temps du téléchargement, sous les yeux des clients.
 */
function Photo({
  p,
  drift = false,
  durationMs = 0,
}: {
  p: ScreenProduct;
  drift?: boolean;
  durationMs?: number;
}) {
  const [precedente, setPrecedente] = useState<string | null>(null);
  const [courante, setCourante] = useState<string | null>(p.photoUrl);
  const [chargee, setChargee] = useState(true);
  const releve = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (p.photoUrl === courante) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- un remplacement de photo est un ENCHAÎNEMENT (garder l'ancienne, charger la neuve, relever l'ancienne) qui ne se dérive pas du rendu : il se joue après lui.
    setPrecedente(courante);
    setCourante(p.photoUrl);
    setChargee(p.photoUrl === null);
  }, [p.photoUrl, courante]);

  useEffect(
    () => () => {
      if (releve.current) clearTimeout(releve.current);
    },
    [],
  );

  const position = cadrageCss(p.photoPoint);
  if (!courante && !precedente) return <span className="ct-ghost">{initiale(p.name)}</span>;
  return (
    <>
      {precedente ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={precedente} alt="" decoding="async" style={{ objectPosition: position }} />
      ) : null}
      {courante ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={courante}
          alt=""
          decoding="async"
          data-loaded={chargee ? "1" : "0"}
          className={drift ? "ct-drift" : undefined}
          style={{
            objectPosition: position,
            ...(drift && durationMs > 0 ? { animationDuration: `${durationMs}ms` } : {}),
          }}
          onLoad={() => {
            setChargee(true);
            if (releve.current) clearTimeout(releve.current);
            releve.current = setTimeout(() => setPrecedente(null), RELEVE_PHOTO_MS);
          }}
        />
      ) : null}
    </>
  );
}

const etat = (p: ScreenProduct) => ({
  "data-oos": p.outOfStock ? "1" : "0",
  "data-photo": p.photoUrl ? "1" : "0",
});

/** Le prix change SANS animation — c'est la règle, pas un oubli. */
function Prix({ p, className = "ct-badge" }: { p: ScreenProduct; className?: string }) {
  return <span className={className}>{p.priceLabel}</span>;
}

function Etiquettes({ p }: { p: ScreenProduct }) {
  return (
    <>
      <span className="ct-new" hidden={!p.isNew}>
        Nouveau
      </span>
      <span className="ct-oos-tag">Épuisé</span>
    </>
  );
}

function Tuile({ p, i }: { p: ScreenProduct; i: number }) {
  return (
    <article className="ct-tile ct-it" {...etat(p)} style={{ "--i": i } as CSSProperties}>
      <div className="ct-ph">
        <Photo p={p} />
        <div className="ct-dim" />
        <Prix p={p} />
        <Etiquettes p={p} />
      </div>
      <div className="ct-tx">
        <FadeText as="h3" className="ct-name" value={p.name} />
        <FadeText as="p" className="ct-desc" value={p.description} />
      </div>
    </article>
  );
}

function Ligne({ p, i }: { p: ScreenProduct; i: number }) {
  return (
    <article className="ct-row ct-it" {...etat(p)} style={{ "--i": i } as CSSProperties}>
      <div className="ct-ph">
        <Photo p={p} />
        <div className="ct-dim" />
        <Etiquettes p={p} />
      </div>
      <div className="ct-tx">
        <FadeText as="h3" className="ct-name" value={p.name} />
        <FadeText as="p" className="ct-desc" value={p.description} />
      </div>
      <Prix p={p} />
    </article>
  );
}

function Heros({
  p,
  i,
  durationMs,
  echo = false,
}: {
  p: ScreenProduct;
  i: number;
  durationMs: number;
  /** Le produit porte le nom de la scène (« Le Boss » dans « Le Boss ») : on ne l'écrit pas deux fois. */
  echo?: boolean;
}) {
  return (
    <article className="ct-hero ct-it" {...etat(p)} style={{ "--i": i } as CSSProperties}>
      <div className="ct-ph">
        <Photo p={p} drift durationMs={durationMs} />
        <div className="ct-dim" />
        <span className="ct-oos-tag">Épuisé</span>
      </div>
      <Prix p={p} className="ct-badge ct-badge-hero" />
      <span className="ct-new" hidden={!p.isNew}>
        Nouveau
      </span>
      <div className="ct-cap">
        {echo ? null : <FadeText as="h3" className="ct-name ct-name-hero" value={p.name} />}
        <FadeText as="p" className="ct-desc" value={p.description} />
      </div>
    </article>
  );
}

function LigneLaterale({ p, i }: { p: ScreenProduct; i: number }) {
  return (
    <article className="ct-srow ct-it" {...etat(p)} style={{ "--i": i } as CSSProperties}>
      <div className="ct-thumb">
        <Photo p={p} />
      </div>
      <div className="ct-tx">
        <FadeText as="h3" className="ct-name" value={p.name} />
        <span className="ct-new" hidden={!p.isNew}>
          Nouveau
        </span>
        <span className="ct-oos-tag">Épuisé</span>
      </div>
      <Prix p={p} className="ct-price" />
    </article>
  );
}

function Offre({ o, i }: { o: ScreenPromo; i: number }) {
  return (
    <article className="ct-promo ct-it" style={{ "--i": i } as CSSProperties}>
      <div className="ct-ptx">
        <FadeText as="h3" className="ct-ptitle" value={o.title} />
        <FadeText as="p" className="ct-pdesc" value={o.description} />
      </div>
      <FadeText className="ct-plab" value={o.label} />
    </article>
  );
}

/** Le verrou s'il est posé, sinon la marque, sinon le nom en titrage. */
function Marque({
  content,
  masque,
  grand = false,
}: {
  content: ScreenContent;
  masque: Brand;
  grand?: boolean;
}) {
  const verrou = verrouPour(masque);
  const src = verrou ?? marqueSeule(masque);
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className={grand ? "ct-logo ct-logo-big" : "ct-logo"}
        src={src}
        alt={content.brand.name}
        decoding="async"
      />
    );
  }
  return <div className={grand ? "ct-bname ct-bname-big" : "ct-bname"}>{content.brand.name}</div>;
}

/** « 2 / 3 » devient des points, le courant allongé en accent. */
function Puces({ subtitle }: { subtitle: string | null }) {
  if (!subtitle) return <div className="ct-sub" />;
  const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(subtitle);
  if (!m) {
    return (
      <div className="ct-sub">
        <FadeText className="ct-subtxt" value={subtitle} />
      </div>
    );
  }
  const a = Number(m[1]);
  const n = Number(m[2]);
  return (
    <div className="ct-sub">
      <span className="ct-pips" aria-hidden>
        {Array.from({ length: n }, (_, i) => (
          <i key={i} className="ct-pip" data-on={i + 1 === a ? "1" : "0"} />
        ))}
      </span>
      <span className="ct-subtxt">
        {a} / {n}
      </span>
    </div>
  );
}

function Entete({
  scene,
  content,
  masque,
}: {
  scene: ScreenScenePayload;
  content: ScreenContent;
  masque: Brand;
}) {
  const heure = useRestaurantClock(content.timezone);
  return (
    <header className="ct-hd ct-it" style={{ "--i": 0 } as CSSProperties}>
      <div className="ct-hd-l">
        <div className="ct-eyebrow">
          <FadeText value={content.serviceLabel} />
        </div>
        <FadeText as="h1" className="ct-title" value={scene.title} />
        <Puces subtitle={scene.subtitle} />
      </div>
      <div className="ct-hd-r">
        <Marque content={content} masque={masque} />
        <div className="ct-svc">
          <span className="ct-dot" data-open={content.open ? "1" : "0"} />
          <span className="ct-clock">{heure}</span>
        </div>
      </div>
    </header>
  );
}

function Ferme({
  scene,
  content,
  masque,
  durationMs,
}: {
  scene: ScreenScenePayload;
  content: ScreenContent;
  masque: Brand;
  durationMs: number;
}) {
  const no = scene.nextOpening;
  return (
    <section className="ct-closed">
      <div className="ct-ring" style={{ animationDuration: `${durationMs}ms` }} />
      <div className="ct-cbox ct-it" style={{ "--i": 0 } as CSSProperties}>
        <Marque content={content} masque={masque} grand />
        <FadeText as="h1" className="ct-title" value={scene.title} />
        {no ? (
          <>
            <div className="ct-reopen">Réouverture {no.dayLabel}</div>
            <div className="ct-wins">
              {no.windows.map((w) => (
                <span key={w} className="ct-win">
                  {w}
                </span>
              ))}
            </div>
          </>
        ) : (
          <FadeText as="p" className="ct-subtxt ct-subtxt-big" value={scene.subtitle ?? ""} />
        )}
        <div className="ct-svc-line">{content.serviceLabel}</div>
      </div>
    </section>
  );
}

/** Panneau libre sans produit, carte vide : la plaque de marque, jamais un écran noir. */
function Vide({
  scene,
  content,
  masque,
}: {
  scene: ScreenScenePayload;
  content: ScreenContent;
  masque: Brand;
}) {
  return (
    <section className="ct-closed">
      <div className="ct-cbox ct-it" style={{ "--i": 0 } as CSSProperties}>
        <Marque content={content} masque={masque} grand />
        <FadeText as="h1" className="ct-title" value={scene.title || content.brand.name} />
        {scene.subtitle ? (
          <FadeText as="p" className="ct-subtxt ct-subtxt-big" value={scene.subtitle} />
        ) : null}
      </div>
    </section>
  );
}

function Corps({
  d,
  scene,
  products,
  promos,
}: {
  d: Disposition;
  scene: ScreenScenePayload;
  products: ScreenProduct[];
  promos: ScreenPromo[];
}) {
  const dur = Math.max(0, Math.round(scene.durationMs));
  if (d === "hero") {
    const p = products[0]!;
    const echo = p.name.trim().toLowerCase() === scene.title.trim().toLowerCase();
    return <Heros p={p} i={1} durationMs={dur} echo={echo} />;
  }
  if (d === "list") {
    return (
      <div className="ct-grid">
        {products.map((p, i) => (
          <Ligne key={p.id} p={p} i={i + 1} />
        ))}
      </div>
    );
  }
  if (d === "featured") {
    return (
      <div className="ct-feat">
        <Heros p={products[0]!} i={1} durationMs={dur} />
        <div className="ct-side">
          {products.slice(1).map((p, i) => (
            <LigneLaterale key={p.id} p={p} i={i + 2} />
          ))}
        </div>
      </div>
    );
  }
  if (d === "promo") {
    return (
      <div className="ct-promos" data-count={String(promos.length)}>
        {promos.map((o, i) => (
          <Offre key={o.id} o={o} i={i + 1} />
        ))}
      </div>
    );
  }
  return (
    <div className="ct-grid">
      {products.map((p, i) => (
        <Tuile key={p.id} p={p} i={i + 1} />
      ))}
    </div>
  );
}

function ComptoirScene({ scene, content, masque, orientation }: ScenographyProps) {
  const products = scene.products.slice(0, MAX_PRODUITS);
  const promos = scene.promos.slice(0, MAX_OFFRES);
  const d = disposition(scene.kind, products.length, orientation);
  const style = variablesDeScene(orientation, d, products.length);
  const mot = scene.kind === "closed" ? content.brand.name : scene.title;

  return (
    <div className="ct" data-disposition={d} data-o={orientation} style={style}>
      <div className="ct-bg" aria-hidden>
        <div className="ct-halo" />
        <div className="ct-bgword">{mot}</div>
      </div>
      <div className="ct-stage">
        {d === "closed" ? (
          <Ferme scene={scene} content={content} masque={masque} durationMs={scene.durationMs} />
        ) : d === "empty" ? (
          <Vide scene={scene} content={content} masque={masque} />
        ) : (
          <>
            <Entete scene={scene} content={content} masque={masque} />
            <section className="ct-body">
              <Corps d={d} scene={scene} products={products} promos={promos} />
            </section>
          </>
        )}
      </div>
    </div>
  );
}

export const Comptoir: ScenographyModule = { Component: ComptoirScene, chrome: "none" };
