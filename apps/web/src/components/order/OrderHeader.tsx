"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, Stars, Verrou } from "@/components/ui";
import type { Site } from "./api";
import { hhmm, nextOpeningLabel, telHref } from "./helpers";
import { BrandMark, Dot, Tap } from "./primitives";

/** Presentation of the public restaurant identity; availability remains the
 * server's. An opening hour or review is never invented for the hero. */
export function OrderHeader({ site, logoUrl, lockupUrl, account, onHeightChange }: {
  site: Site; logoUrl: string | null; lockupUrl: string | null; account?: ReactNode; onHeightChange?: (height: number) => void;
}) {
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const header = headerRef.current;
    if (!header || !onHeightChange) return;
    const measure = () => onHeightChange(Math.ceil(header.getBoundingClientRect().height));
    measure(); const observer = new ResizeObserver(measure); observer.observe(header);
    return () => observer.disconnect();
  }, [onHeightChange]);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const view = headerRef.current?.ownerDocument.defaultView;
    if (!view) return;
    const update = () => setScrolled(view.scrollY > 8);
    update(); view.addEventListener("scroll", update, { passive: true });
    return () => view.removeEventListener("scroll", update);
  }, []);
  const firstSlot = site.slots?.slots.find(slot => !slot.full);
  const reopen = !site.openNow ? nextOpeningLabel(site.tenant.hours) : null;
  const status = site.ordering.paused ? "Commande en pause" : site.openNow
    ? "Ouvert" : "Fermé";
  const detail = site.ordering.paused ? null : site.openNow
    ? firstSlot ? `retrait dès ${hhmm(firstSlot.iso)}` : null : reopen;
  const subtitle = <p className="sm-order-status"><Dot tone={site.openNow && !site.ordering.paused ? "ok" : "mut"} />{status}{detail && <span> · {detail}</span>}</p>;
  return <header ref={headerRef} className="sm-order-header" data-scrolled={scrolled || undefined}>
    <div className="sm-order-header-inner">
      <Verrou balise="h1" src={lockupUrl} nom={site.tenant.name} hauteur={40} sous={subtitle}
        replier={<><BrandMark name={site.tenant.name} logoUrl={logoUrl} size={40} />
          <div className="sm-order-identity"><h1>{site.tenant.name}</h1>{subtitle}</div></>} />
      <div className="sm-order-header-actions">
        {site.tenant.phones[0] && <a href={telHref(site.tenant.phones[0])} className="sm-order-icon" aria-label={`Appeler ${site.tenant.name}`}><Icon name="phone" size={18} /></a>}
        {account}
      </div>
    </div>
  </header>;
}

export function OrderHero({ site, src, position, alt, onOrder, tagline, taglineSub }: {
  site: Site; src: string | null; position: string; alt: string; onOrder: () => void; tagline?: string | null; taglineSub?: string | null;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const photo = src && failed !== src;
  return <section className="sm-order-hero" data-photo={photo || undefined} aria-label="Bienvenue">
    {/* Tenant media URLs are not restricted to a single CDN. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {photo && <img src={src} alt={alt} fetchPriority="high" decoding="async" ref={node => { if (node?.complete && node.naturalWidth === 0) setFailed(src); }} onError={() => setFailed(src)} style={{ objectPosition: position }} />}
    <span className="sm-order-hero-veil" aria-hidden />
    <div className="sm-order-hero-copy">
      {site.reviews.count > 0 && <span className="sm-order-rating"><Stars value={site.reviews.avg} size={12} /><b>{site.reviews.avg.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}</b> ({site.reviews.count})</span>}
      <h2 className="font-display">{tagline || "Commandez. Récupérez. Régalez-vous."}</h2>
      <p>{site.ordering.paused ? "La carte reste consultable." : taglineSub || `Préparé chez ${site.tenant.name}, à l’heure que vous choisissez.`}</p>
    </div>
    <Tap onClick={onOrder} className="sm-order-hero-action">{site.ordering.paused ? "La carte" : "Commander"}<Icon name="arrow" size={17} /></Tap>
  </section>;
}
