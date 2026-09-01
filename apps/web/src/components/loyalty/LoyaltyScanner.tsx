"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import type { IScannerControls } from "@zxing/browser";
import { loyaltyTokenFromQrPayload } from "@sm/contracts";
import { Btn, Icon } from "@/components/ui";
import { useDialogLayer } from "@/components/ui/useDialogLayer";

export function LoyaltyScanner({
  expectedSlug,
  onToken,
  onClose,
}: {
  expectedSlug: string;
  onToken: (token: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const dialogRef = useDialogLayer({ open: true, onClose });
  const controlsRef = useRef<IScannerControls | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [fileBusy, setFileBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        if (cancelled || !videoRef.current) return;
        const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 250 });
        const controls = await reader.decodeFromConstraints(
          { audio: false, video: { facingMode: { ideal: "environment" } } },
          videoRef.current,
          (result) => {
            if (!result) return;
            const token = loyaltyTokenFromQrPayload(result.getText(), expectedSlug);
            if (!token) {
              setCameraError("Ce QR ne correspond pas à une carte fidélité Snack Manager.");
              return;
            }
            controlsRef.current?.stop();
            onToken(token);
          },
        );
        if (cancelled) controls.stop();
        else controlsRef.current = controls;
      } catch {
        if (!cancelled) {
          setCameraError(
            "La caméra n’est pas disponible. Autorisez-la, choisissez une photo du QR ou saisissez le code de secours.",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [expectedSlug, onToken]);

  async function scanFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || fileBusy) return;
    setFileBusy(true);
    setCameraError(null);
    const url = URL.createObjectURL(file);
    try {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      const result = await new BrowserQRCodeReader().decodeFromImageUrl(url);
      const token = loyaltyTokenFromQrPayload(result.getText(), expectedSlug);
      if (!token) throw new Error("invalid-card");
      controlsRef.current?.stop();
      onToken(token);
    } catch {
      setCameraError("Aucune carte fidélité valide n’a été reconnue sur cette image.");
    } finally {
      URL.revokeObjectURL(url);
      setFileBusy(false);
    }
  }

  function submitManual(event: FormEvent) {
    event.preventDefault();
    const token = loyaltyTokenFromQrPayload(manual, expectedSlug);
    if (!token) {
      setCameraError("Le code ou le lien ne correspond pas à une carte de ce restaurant.");
      return;
    }
    controlsRef.current?.stop();
    onToken(token);
  }

  return (
    <div ref={dialogRef} inert tabIndex={-1} className="fixed inset-0 z-[80] flex flex-col bg-black outline-none" role="dialog" aria-modal="true" aria-label="Scanner ma carte fidélité">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div><p className="text-sm font-extrabold text-white">Scanner ma carte</p><p className="mt-0.5 text-xs text-white/55">Cadrez le QR dans le viseur</p></div>
        <button type="button" onClick={onClose} aria-label="Fermer le scanner" className="grid size-10 place-items-center rounded-full border border-white/15 bg-white/8 text-white"><Icon name="close" size={18} /></button>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-[#080808]">
        <video ref={videoRef} muted playsInline className="size-full object-cover" />
        <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden>
          <div className="relative aspect-square w-[min(72vw,320px)] rounded-[28px] border-2 border-white/90 shadow-[0_0_0_999px_rgba(0,0,0,.45)]">
            <span className="absolute -left-0.5 -top-0.5 size-12 rounded-tl-[28px] border-l-4 border-t-4 border-accent" />
            <span className="absolute -right-0.5 -top-0.5 size-12 rounded-tr-[28px] border-r-4 border-t-4 border-accent" />
            <span className="absolute -bottom-0.5 -left-0.5 size-12 rounded-bl-[28px] border-b-4 border-l-4 border-accent" />
            <span className="absolute -bottom-0.5 -right-0.5 size-12 rounded-br-[28px] border-b-4 border-r-4 border-accent" />
          </div>
        </div>
      </div>

      <div className="cf-scroll max-h-[44dvh] overflow-y-auto border-t border-white/10 bg-[#0d0d0d] p-4 pb-[max(18px,env(safe-area-inset-bottom))]">
        {cameraError && <p className="mb-3 rounded-card border border-prep/35 bg-prep/10 p-3 text-xs leading-5 text-prept" role="alert">{cameraError}</p>}
        <label className="cf-press flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-pill border border-white/15 bg-white/8 px-4 text-sm font-extrabold text-white">
          <Icon name="grid" size={17} />
          {fileBusy ? "Lecture de l’image…" : "Choisir une photo du QR"}
          <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={fileBusy} onChange={(event) => void scanFile(event)} />
        </label>
        <details className="mt-3 rounded-card border border-white/10 bg-white/[0.035] p-3">
          <summary className="cursor-pointer text-xs font-bold text-white/70">Utiliser le code de secours</summary>
          <form onSubmit={submitManual} className="mt-3 space-y-2">
            <input type="password" autoComplete="off" spellCheck={false} aria-label="Code ou lien de secours" value={manual} maxLength={2048} onChange={(event) => setManual(event.target.value)} className="w-full rounded-ctrl border border-white/12 bg-black/35 px-3.5 py-3 font-mono text-base text-white outline-none focus:border-accent" />
            <Btn type="submit" block size="sm" disabled={!manual.trim()}>Afficher ma carte</Btn>
          </form>
        </details>
      </div>
    </div>
  );
}
