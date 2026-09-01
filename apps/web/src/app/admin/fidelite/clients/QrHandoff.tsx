"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import QRCode from "qrcode";
import { Btn, Card, Skeleton, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { isDemoActive } from "@/lib/demo";
import { SITE_URL } from "@/lib/site";
import {
  loyaltyQrDownloadFilename,
  qrHandoffPresentation,
} from "./qr-handoff-policy";

const emptySubscribe = () => () => {};

export function QrHandoff({ token, alias }: { token: string; alias: string }) {
  const toast = useToast();
  const [qrRender, setQrRender] = useState<{
    payload: string;
    dataUrl: string | null;
    failed: boolean;
  } | null>(null);
  const [tenantSlug, setTenantSlug] = useState<string | null | undefined>(undefined);
  const demo = useSyncExternalStore(emptySubscribe, isDemoActive, () => false);

  useEffect(() => {
    let cancelled = false;
    void api
      .get<{ slug?: unknown }>("/tenants/me")
      .then((tenant) => {
        if (!cancelled) {
          setTenantSlug(
            typeof tenant.slug === "string" && /^[a-z0-9-]+$/.test(tenant.slug)
              ? tenant.slug
              : null,
          );
        }
      })
      .catch(() => {
        if (!cancelled) setTenantSlug(null);
      });
    return () => { cancelled = true; };
  }, []);

  const handoff = qrHandoffPresentation({
    demo,
    siteUrl: SITE_URL,
    tenantSlug,
    token,
  });
  const qrPayload = handoff.payload;

  useEffect(() => {
    if (!qrPayload) return;
    let cancelled = false;
    void QRCode.toDataURL(qrPayload, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 512,
      color: { dark: "#111111", light: "#ffffff" },
      })
      .then((url) => {
        if (!cancelled) setQrRender({ payload: qrPayload, dataUrl: url, failed: false });
      })
      .catch(() => {
        if (!cancelled) setQrRender({ payload: qrPayload, dataUrl: null, failed: true });
      });
    return () => { cancelled = true; };
  }, [qrPayload]);

  const dataUrl = qrRender?.payload === qrPayload ? qrRender.dataUrl : null;
  const failed = qrRender?.payload === qrPayload && qrRender.failed;

  function download() {
    if (!dataUrl) return;
    const link = document.createElement("a");
    link.href = dataUrl;
    // Le nom de fichier reste volontairement générique : un export posé sur
    // le bureau ne doit pas révéler l'alias du client.
    link.download = loyaltyQrDownloadFilename(demo);
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function copyFallback() {
    try {
      const value = demo && handoff.kind === "demo-link" ? handoff.payload : token;
      await navigator.clipboard.writeText(value);
      toast(demo ? "Lien de démonstration copié" : "Code de secours copié", {
        icon: "check",
      });
    } catch {
      toast("Copie impossible sur ce navigateur");
    }
  }

  async function copyLink() {
    if (handoff.kind !== "activation-link") return;
    try {
      await navigator.clipboard.writeText(handoff.payload);
      toast("Lien d’activation copié", { icon: "check" });
    } catch {
      toast("Copie impossible sur ce navigateur");
    }
  }

  return (
    <Card flat className={demo ? "border-prep/30 bg-prep/5 p-4" : "border-ok/25 bg-ok/5 p-4"}>
      <div className="flex flex-col items-center text-center">
        {demo && (
          <span className="mb-2 rounded-pill border border-prep/30 bg-prep/10 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.08em] text-prept">
            Démonstration cross-device
          </span>
        )}
        <p className="text-sm font-extrabold text-ink">Carte créée pour {alias}</p>
        <p className="mt-1 max-w-sm text-xs leading-5 text-mut">
          {demo
            ? "Ce QR ouvre sur n’importe quel téléphone une carte fictive dédiée. Elle démontre l’expérience client sans publier les données créées dans cet onglet."
            : tenantSlug
            ? "Un scan ouvre directement l’application du restaurant et y enregistre la carte. Le secret reste dans le fragment du lien : il n’entre ni dans les journaux HTTP ni dans l’adresse finale."
            : "Ce QR opaque est remis une seule fois. Il ne contient ni nom ni téléphone et n’est jamais conservé en clair côté serveur."}
        </p>
        {failed ? (
          <p className="mt-4 rounded-card border border-alert/35 bg-alert/10 p-3 text-xs text-alertt" role="alert">Le QR n’a pas pu être généré. Copiez le code de secours avant de fermer.</p>
        ) : dataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- data URL éphémère générée localement, incompatible avec l'optimisation distante de next/image.
          <img src={dataUrl} alt={demo ? `QR fictif de démonstration pour ${alias}` : `QR de la carte fidélité de ${alias}`} className="mt-4 size-[220px] rounded-card bg-white p-2 shadow-soft" />
        ) : (
          <Skeleton className="mt-4 size-[220px] bg-white/10" />
        )}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Btn size="sm" variant="ghost" icon="arrow" disabled={!dataUrl} onClick={download}>{demo ? "Télécharger le QR démo" : "Télécharger le QR"}</Btn>
          {handoff.kind === "activation-link" && <Btn size="sm" variant="ghost" onClick={() => void copyLink()}>Copier le lien d’activation</Btn>}
          {demo && handoff.kind === "demo-link" && <Btn size="sm" variant="ghost" onClick={() => window.open(handoff.payload, "_blank", "noopener,noreferrer")}>Ouvrir la carte démo</Btn>}
          <Btn size="sm" variant="ghost" onClick={() => void copyFallback()}>{demo ? "Copier le lien démo" : "Copier le code de secours"}</Btn>
        </div>
        <p className="mt-3 text-[11px] text-prept">{demo ? "La page ouverte est marquée démonstration et ne représente aucun client réel. Sur un compte pilote, le QR ouvrira la vraie carte du restaurant." : "L’impression réseau et sticker sera branchée lors du choix du matériel du pilote."}</p>
      </div>
    </Card>
  );
}
