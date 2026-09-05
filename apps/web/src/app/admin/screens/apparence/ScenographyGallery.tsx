"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SCENOGRAPHIES, SCENOGRAPHY_DESCRIPTIONS, SCENOGRAPHY_FAMILIES, SCENOGRAPHY_LABELS, type Scenography, type ScreenContent } from "@sm/contracts";
import { Icon } from "@/components/ui";
import { cx } from "@/lib/cx";
import { StillStage } from "./StillStage";
import { galleryPreviewScene } from "./gallery-preview";

/** Ne monte un vrai renderer que lorsque sa tuile approche de la zone visible. */
function Thumbnail({ content, scenography }: {
  content: ScreenContent | null;
  scenography: Scenography;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const scene = useMemo(() => galleryPreviewScene(content, scenography), [content, scenography]);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      setVisible(true);
      observer.disconnect();
    }, { rootMargin: "160px" });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-ctrl bg-surface2" aria-hidden="true">
      {visible && content && scene ? <div className="w-full"><StillStage content={content} scene={scene} scenography={scenography} /></div> : null}
    </div>
  );
}

export function ScenographyGallery({ value, content, onChange, disabled = false }: {
  value: Scenography;
  content: ScreenContent | null;
  onChange: (value: Scenography) => void;
  disabled?: boolean;
}) {
  const [family, setFamily] = useState("all");
  const groups = SCENOGRAPHY_FAMILIES.filter((group) => family === "all" || family === group.id);
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="mb-2 text-sm font-bold text-ink">Style du menu · {SCENOGRAPHIES.length} modèles</legend>
      <p className="mb-3 text-xs leading-relaxed text-mut">{SCENOGRAPHY_LABELS[value]} sélectionné. Chaque modèle reprend votre carte et votre identité.</p>
      <p className="mb-3 text-xs leading-relaxed text-mut">Miniatures sur une sélection de votre carte. L’aperçu principal joue votre vraie boucle.</p>
      <div className="mb-5 flex flex-wrap gap-1.5" role="group" aria-label="Familles de modèles">
        {[{ id: "all", label: "Tous" }, ...SCENOGRAPHY_FAMILIES].map((group) => (
          <button key={group.id} type="button" aria-pressed={family === group.id} onClick={() => setFamily(group.id)}
            className={cx("cf-press min-h-10 rounded-ctrl border px-3 py-2 text-xs font-semibold", family === group.id ? "border-accent bg-accentwash text-ink" : "border-line2 text-mut hover:text-ink")}>
            {group.label}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-5">
        {groups.map((group) => <section key={group.id} aria-label={group.label}>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-mut">{group.label}</h4>
          <div className="grid grid-cols-2 gap-3">
            {group.scenographies.map((scenography) => <button key={scenography} type="button"
              aria-pressed={value === scenography} aria-label={SCENOGRAPHY_LABELS[scenography]}
              onClick={() => onChange(scenography)}
              className={cx("cf-press flex min-w-0 flex-col gap-2 rounded-card border p-2 text-left disabled:cursor-wait", value === scenography ? "border-accent bg-accentwash" : "border-line2 hover:border-ink/25")}>
              <Thumbnail content={content} scenography={scenography} />
              <span className="px-1 pb-1">
                <span className="mb-1 flex items-center justify-between gap-2 text-sm font-bold text-ink">
                  {SCENOGRAPHY_LABELS[scenography]}{value === scenography ? <Icon name="check" size={14} /> : null}
                </span>
                <span className="block text-xs leading-snug text-mut">{SCENOGRAPHY_DESCRIPTIONS[scenography]}</span>
              </span>
            </button>)}
          </div>
        </section>)}
      </div>
    </fieldset>
  );
}
