"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Btn } from "@/components/ui/Btn";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/icons";
import { dejaInstallee, estIOS } from "@/components/loyalty/installation";

type InstallChoice = { outcome: "accepted" | "dismissed" };
type InstallEvent = Event & { prompt: () => Promise<unknown>; userChoice: Promise<InstallChoice> };
type Outcome = "idle" | "accepted" | "dismissed" | "error" | "installed";

// One registration per document, including StrictMode/remounts. No access,
// invitation, mission or installation flag is persisted here.
let worker: Promise<boolean> | undefined;
function prepareWorker(): Promise<boolean> {
  if (!worker) {
    worker = Promise.resolve().then(() => {
      if (!("serviceWorker" in navigator)) return false;
      return navigator.serviceWorker.register("/livreur/sw.js", { scope: "/livreur", updateViaCache: "none" }).then(() => true);
    }).catch(() => false);
  }
  return worker;
}

const OUTCOMES: Record<Exclude<Outcome, "idle">, string> = {
  accepted: "Installation demandée. Terminez les étapes proposées par votre navigateur.",
  dismissed: "Installation reportée. Vous pouvez continuer ici et utiliser le menu du navigateur plus tard.",
  error: "L’installation n’a pas été confirmée. Vous pouvez continuer ici ou consulter l’aide.",
  installed: "Le navigateur a signalé l’installation. Retrouvez SM Livreur depuis votre écran d’accueil ou vos applications.",
};
const WORKER_UNAVAILABLE = "Le mode hors connexion n’a pas pu être préparé. L’accès en ligne reste disponible.";

/** Progressive enhancement only: neither install nor worker success authorizes
 * access, and neither is required for association or online missions. */
export function DeliveryInstall({ associated }: { associated: boolean }) {
  const [environment, setEnvironment] = useState({ ready: false, standalone: false, ios: false, android: false });
  const [canPrompt, setCanPrompt] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>("idle");
  const [workerFailed, setWorkerFailed] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const promptRef = useRef<InstallEvent | null>(null);
  const alive = useRef(false);
  const sequence = useRef(0);
  const helpButton = useRef<HTMLButtonElement | null>(null);
  const helpId = useId();

  useEffect(() => {
    if (!["/livreur", "/livreur/"].includes(window.location.pathname)) return;
    sequence.current++;
    alive.current = true;
    const media = window.matchMedia("(display-mode: standalone)");
    const sync = () => {
      const standalone = dejaInstallee(media.matches, (navigator as Navigator & { standalone?: boolean }).standalone);
      setEnvironment({ ready: true, standalone, ios: estIOS(navigator.userAgent, navigator.maxTouchPoints > 1), android: /android/i.test(navigator.userAgent) });
      if (standalone) {
        sequence.current++; promptRef.current = null; setCanPrompt(false); setBusy(false); setHelpOpen(false);
      }
    };
    const onPrompt = (event: Event) => {
      const candidate = event as Partial<InstallEvent>;
      if (typeof candidate.prompt !== "function" || typeof candidate.userChoice?.then !== "function") return;
      event.preventDefault();
      if (dejaInstallee(media.matches, (navigator as Navigator & { standalone?: boolean }).standalone)) return;
      const current = candidate as InstallEvent;
      promptRef.current = current; setCanPrompt(true); setOutcome("idle");
      // The browser/another native surface may consume it without our button.
      void current.userChoice.then(choice => {
        if (!alive.current || promptRef.current !== current) return;
        promptRef.current = null; setCanPrompt(false);
        setOutcome(choice?.outcome === "accepted" ? "accepted" : choice?.outcome === "dismissed" ? "dismissed" : "error");
      }, () => {
        if (!alive.current || promptRef.current !== current) return;
        promptRef.current = null; setCanPrompt(false); setOutcome("error");
      });
    };
    const installed = () => {
      sequence.current++; promptRef.current = null; setCanPrompt(false); setBusy(false); setOutcome("installed"); sync();
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", installed);
    window.addEventListener("focus", sync);
    window.addEventListener("pageshow", sync);
    media.addEventListener("change", sync);
    // Synchronize display mode after hydration; never infer it from storage.
    sync();
    void prepareWorker().then(ok => { if (alive.current) setWorkerFailed(!ok); });
    return () => {
      alive.current = false; promptRef.current = null;
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", installed);
      window.removeEventListener("focus", sync);
      window.removeEventListener("pageshow", sync);
      media.removeEventListener("change", sync);
    };
  }, []);

  async function install() {
    const current = promptRef.current;
    if (!current || busy || environment.standalone) return;
    const run = ++sequence.current;
    // Consume before calling the browser: double clicks and rejected promises
    // cannot prompt twice. Only a new beforeinstallprompt can offer it again.
    promptRef.current = null; setCanPrompt(false); setBusy(true); setOutcome("idle");
    try {
      const [, choice] = await Promise.all([current.prompt(), current.userChoice]);
      if (alive.current && sequence.current === run) setOutcome(choice?.outcome === "accepted" ? "accepted" : choice?.outcome === "dismissed" ? "dismissed" : "error");
    } catch {
      if (alive.current && sequence.current === run) setOutcome("error");
    } finally { if (alive.current && sequence.current === run) setBusy(false); }
  }

  function closeHelp() { setHelpOpen(false); helpButton.current?.focus(); }
  if (!environment.ready) return null;
  if (environment.standalone) return workerFailed ? <p role="status" className="mb-7 text-xs leading-5 text-mut">{WORKER_UNAVAILABLE}</p> : null;
  return (
    <Card flat className="lv-install mb-7 p-4" aria-label="Installer SM Livreur" onKeyDown={event => { if (helpOpen && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeHelp(); } }}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-card bg-accentwash text-accentink"><Icon name="home" size={17} /></span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-[-0.02em]">SM Livreur sur l’écran d’accueil</h2>
          <p className="mt-1 text-[13px] leading-5 text-mut">{associated ? "Retrouvez vos missions depuis l’écran d’accueil." : "Ajoutez un raccourci, puis associez votre téléphone avec le lien du restaurant."} L’installation est facultative.</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        {canPrompt && <Btn variant="ghost" size="sm" className="min-h-11 whitespace-normal" disabled={busy} onClick={() => void install()}>Installer SM Livreur</Btn>}
        <button ref={helpButton} type="button" className="min-h-11 rounded-ctrl px-1 text-left text-[13px] font-semibold text-mut underline underline-offset-4 hover:text-ink" aria-expanded={helpOpen} aria-controls={helpId} onClick={() => setHelpOpen(value => !value)}>Comment l’installer ?</button>
      </div>
      <div role="status" aria-live="polite" className="text-[13px] leading-5 text-mut">
        {busy ? <p className="mt-2">Choisissez dans la fenêtre du navigateur. Vos missions restent accessibles ici.</p> : outcome !== "idle" ? <p className="mt-2">{OUTCOMES[outcome]}</p> : null}
      </div>
      {workerFailed && <p className="mt-2 text-xs leading-5 text-mut">{WORKER_UNAVAILABLE}</p>}
      {helpOpen && <section id={helpId} role="region" aria-label="Installer depuis le navigateur" className="mt-3 border-t border-line pt-3 text-[13px] leading-6 text-mut">
        {environment.ios ? <p>Dans Safari, ouvrez le menu <strong className="font-semibold text-ink">Partager</strong>, puis <strong className="font-semibold text-ink">Sur l’écran d’accueil</strong>. Si cette option manque, ouvrez cette page directement dans Safari.</p>
          : environment.android ? <p>Dans le menu de votre navigateur Android, cherchez <strong className="font-semibold text-ink">Installer l’application</strong> ou <strong className="font-semibold text-ink">Ajouter à l’écran d’accueil</strong>.</p>
            : <p>Ouvrez le menu de votre navigateur et cherchez <strong className="font-semibold text-ink">Installer SM Livreur</strong> ou <strong className="font-semibold text-ink">Ajouter à l’écran d’accueil</strong>. Le nom de l’option dépend du navigateur.</p>}
        <p className="mt-2">Si l’option n’est pas proposée, continuez depuis cette page. L’installation ne remplace pas l’association au restaurant ; une connexion reste nécessaire pour consulter et mettre à jour les missions.</p>
        <Btn variant="ghost" size="sm" className="mt-3 min-h-11" onClick={closeHelp}>Fermer l’aide</Btn>
      </section>}
    </Card>
  );
}
