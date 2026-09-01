"use client";

import { useCallback, useEffect, useState } from "react";
import type { LoyaltyProgramView } from "@sm/contracts";
import { Btn, Skeleton } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { loyaltyApi } from "../data";
import { ProgrammeForm } from "./ProgrammeForm";

export default function LoyaltyProgramPage() {
  const [program, setProgram] = useState<LoyaltyProgramView | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setProgram(await loyaltyApi.getProgram());
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Chargement du programme impossible.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lecture API initiale, relançable par le bouton de réessai.
    void load();
  }, [load]);

  if (error && program === undefined) {
    return (
      <div className="p-4 md:p-[26px]">
        <div className="rounded-card border border-alert/40 bg-alert/10 p-4">
          <p className="text-sm text-alertt" role="alert">{error}</p>
          <Btn variant="ghost" size="sm" className="mt-3" onClick={() => void load()}>Réessayer</Btn>
        </div>
      </div>
    );
  }

  if (program === undefined) {
    return (
      <div className="p-4 md:p-[26px]">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,.7fr)]">
          <div className="space-y-4"><Skeleton className="h-[180px]" /><Skeleton className="h-[390px]" /></div>
          <Skeleton className="h-[320px]" />
        </div>
      </div>
    );
  }

  return <div className="p-4 md:p-[26px]"><ProgrammeForm initial={program} /></div>;
}
