"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { ancre, euros, section } from "./content";
import { MENUS_OFFERS, MENU_PRINT_NOTE, MENU_STUDIO_FUTURE } from "./menu-offers";

const FORMATS = [
  { id: "papier", label: "Menu papier", title: "Une carte agréable à lire. Et simple à faire évoluer.", body: "Nouveaux prix, nouvelles recettes, nouvelle saison : nous adaptons votre présentation, puis préparons votre fichier pour l’imprimeur.", offer: "papier" },
  { id: "tv", label: "Menus TV", title: "Vos plats à l’écran, au bon moment du service.", body: "Nous préparons vos compositions dans la bibliothèque TV existante, avec vos produits, vos photos et vos prix. Vous validez l’aperçu et les horaires de diffusion.", offer: "tv" },
  { id: "ensemble", label: "Les deux", title: "La même identité, du menu en main à l’écran en salle.", body: "Réunissez votre carte papier et deux compositions TV. Notre équipe examine les données disponibles et vous propose trois actions à tester sur votre carte.", offer: "ensemble" },
] as const;

/** Illustrative paper/TV scene; it never represents an available paper builder. */
export function MenuStudio() {
  const [active, setActive] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const format = FORMATS[active];
  const offer = MENUS_OFFERS.find((item) => item.id === format.offer)!;
  const { badge, title } = section("menus");
  function onKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === "ArrowRight" ? (index + 1) % FORMATS.length : event.key === "ArrowLeft" ? (index + FORMATS.length - 1) % FORMATS.length : event.key === "Home" ? 0 : event.key === "End" ? FORMATS.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault(); setActive(next); tabs.current[next]?.focus();
  }
  return (
    <section className="section ms-section" id="menus" aria-labelledby="menus-title">
      <span className="badge">{badge}</span>
      <h2 className="h2 center-h2" id="menus-title">{title}</h2>
      <p className="subheading ms-intro">Un prix à changer, une nouvelle recette à lancer, une carte à repenser.<br />Faites évoluer vos supports avec un interlocuteur qui connaît votre activité.</p>
      <div className="ms-tabs" role="tablist" aria-label="Votre support de menu">
        {FORMATS.map((item, i) => <button type="button" role="tab" id={`ms-tab-${item.id}`} aria-controls="ms-panel" aria-selected={i === active} tabIndex={i === active ? 0 : -1} key={item.id} ref={(node) => { tabs.current[i] = node; }} onKeyDown={(event) => onKey(event, i)} onClick={() => setActive(i)}>{item.label}</button>)}
      </div>
      <div className={`ms-stage ms-view-${format.id}`}>
        <div className="ms-art" aria-hidden="true">
          <div className="ms-orbit" /><div className="ms-orbit inner" />
          <div className="ms-source"><span className="ms-source-dot" /><span>Votre carte</span><span className="ms-source-lines"><i /><i /><i /></span></div>
          <div className="ms-connector"><span /></div>
          <div className="ms-paper">
            <div className="ms-fold ms-fold-left"><small>À partager</small><span className="ms-dish" /><i /><i /><i /><small>Les entrées</small><i /><i /></div>
            <div className="ms-fold ms-fold-middle"><span className="ms-menu-emblem">M</span><small>Votre restaurant</small><strong>La carte<br />du moment.</strong><span className="ms-paper-rule" /><small>Fait avec soin.<br />Servi avec plaisir.</small></div>
            <div className="ms-fold ms-fold-right"><small>Nos plats</small><i /><i /><i /><small>Les douceurs</small><i /><i /><span className="ms-qr" /></div>
          </div>
          <div className="ms-tv"><div className="ms-tv-screen"><div><small>Votre restaurant</small><strong>Le goût<br />de la saison.</strong><span>Notre sélection du moment</span><i /><i /><i /></div><div className="ms-tv-dish"><span /><small>À découvrir<br />à la carte</small></div></div><div className="ms-tv-stand" /></div>
          <span className="ms-art-label">Illustration de supports · création réalisée par notre Atelier</span>
        </div>
        <div className="ms-copy" id="ms-panel" role="tabpanel" tabIndex={0} aria-labelledby={`ms-tab-${format.id}`}>
          <span className="ms-eyebrow">Création par notre équipe</span>
          <h3>{format.title}</h3><p>{format.body}</p>
          <p className="ms-price"><strong>{euros(offer.priceCents)}</strong><span>HT · prestation ponctuelle</span></p>
          <p className="ms-scope">{format.id === "papier" ? "Trois volets, six faces · jusqu’à 40 références · deux séries de corrections." : format.id === "tv" ? "Deux compositions existantes · une orientation · jusqu’à 40 références · deux séries de corrections." : "Le trois-volets guidé + deux compositions TV + un diagnostic · deux séries de corrections."}</p>
          <a className="btn light" href={ancre("contact").href}>{offer.cta}<span aria-hidden="true"> ↗</span></a>
          <a className="ms-details" href="/atelier#menus-atelier">Voir le détail et les autres prestations →</a>
        </div>
      </div>
      <div className="ms-terms">
        <p><strong>La maquette, puis l’impression.</strong> {MENU_PRINT_NOTE}</p>
        <p><strong>Vos écrans restent dans votre suite.</strong> Les modèles TV actuels sont inclus dans Service, Gestion et Boost. Création graphique, matériel et installation sont distincts.</p>
      </div>
      <aside className="ms-future"><span>{MENU_STUDIO_FUTURE.status}</span><div><h3>Demain, un Studio guidé pour vos menus papier et TV.</h3><p>Un éditeur pour faire évoluer vous-même vos supports, depuis votre back-office. Le Studio avancé est en préparation et n’est pas disponible à la souscription. Les fonctions TV actuelles restent incluses dans votre offre.</p></div><a href="/offres#studio-a-venir">Découvrir le projet <span aria-hidden="true">↗</span></a></aside>
    </section>
  );
}
