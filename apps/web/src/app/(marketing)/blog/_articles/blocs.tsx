import Link from "next/link";
import type { ReactNode } from "react";
import { ancre } from "@/components/marketing/content";

/** Résout les renvois vers la landing : une ancre nue viserait la page de l'article. */
export function Renvoi({ section, children }: { section: string; children: ReactNode }) {
  return <Link className="bl-renvoi" href={ancre(section).href}>{children}</Link>;
}

export function Ui({ children }: { children: ReactNode }) {
  return <span className="bl-ui">{children}</span>;
}

export function Note({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <aside className="bl-note">
      <p className="bl-notetitre">{titre}</p>
      <div className="bl-notecorps">{children}</div>
    </aside>
  );
}

export function Etapes({ children }: { children: ReactNode }) {
  return <ol className="bl-etapes">{children}</ol>;
}

export function Etape({ titre, children }: { titre: string; children: ReactNode }) {
  return <li className="bl-etape"><p className="bl-etapetitre">{titre}</p>{children}</li>;
}
