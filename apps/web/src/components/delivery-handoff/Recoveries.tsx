"use client";

import { useEffect, useRef, useState } from "react";
import { Btn } from "@/components/ui/Btn";
import { Modal } from "@/components/ui/Modal";
import { DeliveryHandoffPanel } from "./Panel";
import { HANDOFF_JOURNAL_EVENT, readHandoffOperations, type HandoffOperation } from "./journal";

/** Remains reachable when a delivered mission has left the active list.
 * IDs only: a revoked/removed assignment must not restore customer details.
 */
export function DeliveryHandoffRecoveries({ scope, available, selectedMission, onRevoked }: {
  scope: string; available: boolean; selectedMission: string | null; onRevoked: () => void;
}) {
  const [operations, setOperations] = useState<HandoffOperation[]>([]);
  const [error, setError] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);
  const busy = useRef(false);
  useEffect(() => {
    const read = () => {
      try { setOperations(readHandoffOperations(sessionStorage, scope)); setError(false); }
      catch { setError(true); }
    };
    read();
    window.addEventListener(HANDOFF_JOURNAL_EVENT, read); window.addEventListener("focus", read);
    return () => { window.removeEventListener(HANDOFF_JOURNAL_EVENT, read); window.removeEventListener("focus", read); };
  }, [scope]);
  return <>
    {error && <p role="alert" className="mt-4 text-sm text-prept">Les actions de remise sauvegardées ne peuvent pas être relues. Ne recommencez pas une remise déjà tentée ; contactez le restaurant.</p>}
    {operations.filter(item => item.missionId !== selectedMission).map((item, index) => <div key={item.missionId} className="mt-4 rounded-card border border-prep/30 bg-prep/5 p-4">
      <h3 className="font-semibold">Une action de remise reste à vérifier</h3>
      <p className="mt-2 text-sm leading-6 text-mut">Même si la mission n’apparaît plus, sa réponse doit être rapprochée. Aucune coordonnée client n’est restaurée ici.</p>
      <Btn block className="mt-3 min-h-12" disabled={!available} onClick={() => setOpened(item.missionId)}>Vérifier la remise en attente {index + 1}</Btn>
    </div>)}
    <Modal open={Boolean(opened)} title="Vérifier une remise" onClose={() => { if (!busy.current) setOpened(null); }}>
      {opened && <DeliveryHandoffPanel key={`${scope}:${opened}`} missionId={opened} scope={scope} path={`/livreur/missions/${opened}/handoff`} available={available}
        onRevoked={onRevoked} onBusyChange={value => { busy.current = value; }} onComplete={() => setOpened(null)} />}
    </Modal>
  </>;
}
