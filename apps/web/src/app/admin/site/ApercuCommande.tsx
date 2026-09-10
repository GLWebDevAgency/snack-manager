"use client";

import { useMemo, useState } from "react";
import { TYPE_PAIRS, logoPour, type Brand } from "@sm/contracts";
import { Btn, Icon, Modal, verrouPour } from "@/components/ui";
import { classesPolices } from "@/components/masque/polices";
import { styleDuMasque } from "@/components/masque/styleDuMasque";
import { OrderHeader, OrderHero } from "@/components/order/OrderHeader";
import { Highlights, MenuBoard } from "@/components/order/MenuBoard";
import { storefrontHighlights } from "@/components/order/highlights";
import { altDuHero, cadrageDuHero } from "@/components/order/hero";
import type { Site, MenuProduct } from "@/components/order/api";
import "@/components/order/order-v2.css";
import { CadreApercu } from "./CadreApercu";
import styles from "./pilotage.module.css";

export type ProductPreviewChanges = Record<string, Pick<Partial<MenuProduct>, "photoKind" | "photoCover" | "popular">>;
const noAction = () => {};
export function ApercuCommande({ brand, site, error, onRetry, changes = {} }: {
  brand: Brand; site: Site | null; error: boolean; onRetry: () => void; changes?: ProductPreviewChanges;
}) {
  const [device, setDevice] = useState<"phone" | "desktop">("phone");
  const [expanded, setExpanded] = useState(false);
  const width = device === "phone" ? 390 : 1280;
  const controls = <div className={styles.previewTools}>
    <div className={styles.segment} role="group" aria-label="Format de l’aperçu">
      {([['phone', 'Téléphone', 'phone'], ['desktop', 'Grand écran', 'tv']] as const).map(([key, label, icon]) =>
        <button key={key} type="button" aria-pressed={device === key} onClick={() => setDevice(key)}><Icon name={icon} size={17} />{label}</button>)}
    </div>
    <Btn variant="ghost" size="sm" className="min-h-11" onClick={() => setExpanded(true)}>Agrandir</Btn>
  </div>;
  const canvas = site ? <CadreApercu width={width} title={`Aperçu de la commande — ${device === "phone" ? "téléphone" : "grand écran"}`}>
    <CommandePeinte site={site} brand={brand} changes={changes} />
  </CadreApercu> : <div role="status" className={styles.previewEmpty}>
    {error ? <>L’aperçu n’a pas pu être chargé.<Btn variant="ghost" onClick={onRetry}>Réessayer l’aperçu</Btn></> : "Chargement de votre vraie carte…"}
  </div>;
  return <section className={styles.preview} aria-label="Aperçu de votre commande">
    <div className={styles.previewHeading}><div><h3>Votre commande</h3><p>Votre carte et vos prix réels. Brouillon visuel en lecture seule.</p></div><span>{width} px</span></div>
    {controls}{site && error && <p role="status" className="mb-3 text-xs text-mut">La dernière carte chargée est affichée ; l’actualisation n’a pas été confirmée. <button type="button" className="min-h-11 underline" onClick={onRetry}>Réessayer l’aperçu</button></p>}{!expanded && canvas}
    <p className={styles.previewNote}>Logo, couleurs, accueil et photos utilisent le même rendu que votre page publique. Aucun panier ni paiement n’est ouvert ici.</p>
    <Modal open={expanded} onClose={() => setExpanded(false)} title="Aperçu de votre commande" width={1360}>
      <div className="mb-4">{controls}</div>{expanded && canvas}
    </Modal>
  </section>;
}

function CommandePeinte({ site, brand, changes }: { site: Site; brand: Brand; changes: ProductPreviewChanges }) {
  const masque = useMemo(() => styleDuMasque(brand), [brand]);
  const categories = useMemo(() => site.categories.map(category => ({ ...category, products: category.products.map(product => ({ ...product, ...changes[product.id], popular: Boolean(product.photoUrl) && (changes[product.id]?.popular ?? product.popular) })) })), [site.categories, changes]);
  const highlights = useMemo(() => storefrontHighlights(categories, site.featuredConfigured), [categories, site.featuredConfigured]);
  const hero = brand.hero ?? highlights.find(product => product.photoUrl)?.photoUrl ?? null;
  const current = useMemo(() => ({ ...site, tenant: { ...site.tenant, brand } }), [site, brand]);
  const prixMono = TYPE_PAIRS[brand.type.pair].prixMono;
  return <div inert style={masque} className={`${classesPolices} sm-order font-body min-h-dvh overflow-x-clip bg-bg text-ink`}>
    <OrderHeader site={current} logoUrl={logoPour(brand, "mark")} lockupUrl={verrouPour(brand)} />
    <main className="mx-auto w-full max-w-[1080px] px-4">
      <OrderHero site={current} tagline={brand.tagline} taglineSub={brand.taglineSub} src={hero} position={cadrageDuHero(hero, site.medias)} alt={altDuHero(hero, site.medias)} onOrder={noAction} />
      <Highlights products={highlights} inCart={{}} disabled={site.ordering.paused || !site.openNow} prixMono={prixMono} onPick={noAction} onBrowse={noAction} />
      {categories.length ? <MenuBoard categories={categories} onPick={noAction} inCart={{}} prixMono={prixMono} stickyTop={72} disabled={site.ordering.paused || !site.openNow} /> :
        <p className="px-6 py-20 text-center">La carte arrive très bientôt</p>}
    </main>
  </div>;
}
