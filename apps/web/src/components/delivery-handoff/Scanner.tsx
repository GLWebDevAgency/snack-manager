"use client";

import { useEffect, useRef, useState } from "react";
import type { IScannerControls } from "@zxing/browser";
import { parseDeliveryHandoffQr } from "@sm/contracts";
import { Btn } from "@/components/ui/Btn";

/** Camera pixels stay on the device. Reading a QR is never confirmation of delivery. */
export function DeliveryHandoffScanner({ missionId, proofId, onRead, onClose }: {
  missionId: string; proofId: string | null; onRead: (qr: string) => void; onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const seen = useRef(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stopped = false; let controls: IScannerControls | undefined, stream: MediaStream | undefined;
    const preview = video.current;
    const release = () => {
      stream?.getTracks().forEach(track => track.stop());
      if (preview) { preview.pause(); preview.srcObject = null; }
    };
    void (async () => {
      try {
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        if (stopped || !preview) return;
        const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 250 });
        const acquired = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" } } });
        // Une permission tardive ne doit jamais attacher une caméra à une
        // remise déjà refermée. Nous possédons aussi le flux pendant play().
        if (stopped || !preview.isConnected) { acquired.getTracks().forEach(track => track.stop()); return; }
        stream = acquired; preview.srcObject = stream;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([preview.play(), new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error("Camera playback unavailable")), 5000);
          })]);
        } finally { if (timer) clearTimeout(timer); }
        if (stopped || !preview.isConnected) { release(); return; }
        controls = reader.scan(preview, result => {
          if (!result || stopped || seen.current) return;
          const parsed = parseDeliveryHandoffQr(result.getText());
          if (!parsed || parsed.orderId !== missionId || (proofId && parsed.proofId !== proofId)) {
            setError("Ce QR ne correspond pas au code de remise actuel de cette commande. Utilisez le QR affiché sur son suivi client."); return;
          }
          seen.current = true;
          controls?.stop();
          onRead(result.getText());
        }, release);
        if (stopped || seen.current) controls.stop();
      } catch { release(); if (!stopped) setError("La caméra n’est pas disponible. Vous pouvez saisir le code à six chiffres présenté par le client."); }
    })();
    return () => { stopped = true; controls?.stop(); release(); };
  }, [missionId, proofId, onRead]);
  return <div className="lv-scanner space-y-3">
    <div className="relative overflow-hidden rounded-card border border-line bg-bg">
      <video ref={video} muted playsInline className="aspect-square max-h-[260px] w-full object-cover" aria-label="Caméra de lecture du QR de remise" />
      <div aria-hidden className="pointer-events-none absolute inset-8 rounded-card border-2 border-accent" />
    </div>
    {error && <p role="alert" className="text-sm leading-6 text-prept">{error}</p>}
    <Btn block variant="ghost" className="min-h-12" onClick={onClose}>Revenir au code à six chiffres</Btn>
  </div>;
}
