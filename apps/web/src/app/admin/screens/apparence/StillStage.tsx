"use client";

import { useMemo, useRef } from "react";
import type { Scenography, ScreenContent, ScreenScenePayload } from "@sm/contracts";
import { BoardStage } from "@/components/board/board-stage";
import { useEmbeddedStage } from "@/components/board/use-stage";

/**
 * LA TUILE VIVANTE — une scénographie candidate, rendue avec la scène du
 * moment, mouvement figé. Ce n'est pas une image : c'est le module lui-même,
 * si bien que la tuile et le téléviseur ne peuvent pas diverger.
 */
export function StillStage({
  content,
  scene,
  scenography,
}: {
  content: ScreenContent;
  scene: ScreenScenePayload;
  scenography: Scenography;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const stage = useEmbeddedStage(ref, content.orientation);
  const variante = useMemo(() => ({ ...content, scenography }), [content, scenography]);
  return (
    <div
      ref={ref}
      className="relative mx-auto overflow-hidden rounded-ctrl bg-black"
      style={
        content.orientation === "landscape"
          ? { width: "100%", aspectRatio: "16 / 9" }
          : { height: 180, aspectRatio: "9 / 16" }
      }
    >
      <BoardStage content={variante} current={scene} leaving={null} stage={stage} embed still />
    </div>
  );
}
