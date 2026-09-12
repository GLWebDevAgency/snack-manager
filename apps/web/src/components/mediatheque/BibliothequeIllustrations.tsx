"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Btn, EmptyState, Icon } from "@/components/ui";
import { cx } from "@/lib/cx";
import { apercuIllustration, creerFichierIllustration, FAMILLES_ILLUSTRATIONS, filtrerIllustrations, illustrations } from "./illustrations";

/** Catalogue fourni avec Snack Manager, proposé dans les hôtes de média existants. */
export function BibliothequeIllustrations({
  envoi,
  onFichier,
  canAct,
}: {
  envoi: boolean;
  onFichier: (fichier: File) => Promise<void>;
  canAct?: () => boolean;
}) {
  const [recherche, setRecherche] = useState("");
  const [famille, setFamille] = useState("toutes");
  const [preparation, setPreparation] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const actif = useRef(false), verrou = useRef(false), canActRef = useRef(canAct);
  const rechercheId = useId();
  useLayoutEffect(() => { canActRef.current = canAct; }, [canAct]);
  useEffect(() => { actif.current = true; return () => { actif.current = false; }; }, []);
  const resultat = filtrerIllustrations(recherche, famille);
  const bloque = envoi || preparation !== null;

  async function choisir(id: string) {
    if (envoi || verrou.current || !(canActRef.current?.() ?? true)) return;
    verrou.current = true;
    setPreparation(id);
    setErreur(null);
    try {
      const fichier = await creerFichierIllustration(id);
      if (!actif.current || !(canActRef.current?.() ?? true)) return;
      await onFichier(fichier);
    } catch (e) {
      if (actif.current) setErreur(e instanceof Error ? e.message : "L'illustration n'a pas pu être ajoutée.");
    } finally {
      verrou.current = false;
      if (actif.current) setPreparation(null);
    }
  }

  return (
    <details className="rounded-card border border-line bg-surface">
      <summary className="flex min-h-12 cursor-pointer items-center gap-2 px-4 py-3 text-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-accent">
        <Icon name="grid" size={18} />
        Illustrations Snack Manager
        <span className="cf-fig ml-auto rounded-pill bg-surface2 px-2 py-0.5 text-xs text-mut">{illustrations.length}</span>
      </summary>
      <div className="flex flex-col gap-3 border-t border-line2 p-4">
        <p className="text-xs leading-relaxed text-mut">
          Choisissez une illustration pour l&apos;ajouter à votre médiathèque. Vos photos restent disponibles.
          Le choix d&apos;une image ne modifie ni la recette, ni les mentions de votre produit.
        </p>
        <div className="flex flex-col gap-1">
          <label htmlFor={rechercheId} className="text-xs font-medium text-ink">Rechercher une illustration</label>
          <input id={rechercheId} type="search" value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Burger, pizza, tiramisu…" className="min-h-11 rounded-ctrl border border-line bg-surface2 px-3 text-sm text-ink outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent" />
        </div>
        <div role="group" aria-label="Familles d'illustrations" className="flex flex-wrap gap-2">
          <button type="button" aria-pressed={famille === "toutes"} onClick={() => setFamille("toutes")} className={cx("min-h-11 rounded-ctrl border px-3 text-xs font-semibold", famille === "toutes" ? "border-accent bg-accent/10 text-ink" : "border-line text-mut")}>Toutes</button>
          {FAMILLES_ILLUSTRATIONS.map((f) => (
            <button key={f.id} type="button" aria-pressed={famille === f.id} onClick={() => setFamille(f.id)} className={cx("flex min-h-11 items-center gap-1.5 rounded-ctrl border px-3 text-xs font-semibold", famille === f.id ? "border-accent bg-accent/10 text-ink" : "border-line text-mut")}>
              <Icon name={f.icone} size={16} />
              {f.nom}
            </button>
          ))}
        </div>
        <p role="status" className="cf-fig text-xs text-mut">{resultat.length} illustration{resultat.length > 1 ? "s" : ""}</p>
        {resultat.length === 0 ? <EmptyState icon="search" title="Aucune illustration trouvée" hint="Essayez un autre nom ou une autre famille." /> : (
          <div role="region" aria-label="Illustrations disponibles" tabIndex={0} className="grid max-h-[360px] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
            {resultat.map((illustration) => (
              <div key={illustration.id} className="flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface2">
                <div className="aspect-[240/165] bg-[#f4eee2] p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element -- SVG local déterministe, sans requête ni optimiseur distant. */}
                  <img src={apercuIllustration(illustration.id)} width={240} height={165} alt="" className="size-full object-contain" />
                </div>
                <div className="flex flex-1 flex-col gap-2 p-3">
                  <span className="text-xs font-semibold leading-snug text-ink">{illustration.label}</span>
                  <Btn variant="ghost" size="sm" icon="plus" className="mt-auto" disabled={bloque} aria-label={`Ajouter l'illustration ${illustration.label}`} onClick={() => void choisir(illustration.id)}>
                    {preparation === illustration.id ? "Ajout…" : "Ajouter"}
                  </Btn>
                </div>
              </div>
            ))}
          </div>
        )}
        {erreur && <p role="alert" className="text-xs text-alertt">{erreur}</p>}
      </div>
    </details>
  );
}
