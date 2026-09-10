"use client";

import { useEffect, useRef, useState } from "react";
import { Btn, Modal } from "@/components/ui";

/** Couvre aussi les liens du shell admin, pas uniquement les onglets locaux. */
export function useDraftNavigation(dirty: boolean, busy: boolean) {
  const [destination, setDestination] = useState<string | null>(null);
  const allowExit = useRef(false);
  useEffect(() => {
    if (!dirty && !busy) return;
    const unload = (event: BeforeUnloadEvent) => { if (allowExit.current) return; event.preventDefault(); event.returnValue = ""; };
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(link instanceof HTMLAnchorElement) || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
      const target = new URL(link.href, location.href);
      if (target.protocol !== 'http:' && target.protocol !== 'https:') return;
      if (target.origin === location.origin && target.pathname === location.pathname && target.search === location.search) return;
      event.preventDefault(); event.stopPropagation(); allowExit.current = false; setDestination(target.href);
    };
    window.addEventListener('beforeunload', unload); document.addEventListener('click', click, true);
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', click, true); };
  }, [dirty, busy]);
  return <Modal open={destination !== null} onClose={() => setDestination(null)} title={busy ? "Enregistrement en cours" : "Modifications non enregistrées"}
    footer={<><Btn variant="ghost" onClick={() => setDestination(null)}>Continuer l’édition</Btn>{!busy && <Btn onClick={() => { if (destination) { allowExit.current = true; location.assign(destination); } }}>Quitter cette page</Btn>}</>}>
    <p className="text-sm leading-relaxed text-mut">{busy ? "Attendez la confirmation avant de quitter cette page." : "Vos changements ne sont pas encore publiés. Quitter cette page ne les enregistre pas."}</p>
  </Modal>;
}
