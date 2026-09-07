"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DeliveryCustomerProofSchema, parseDeliveryHandoffQr, type DeliveryCustomerProof } from "@sm/contracts";
import { API_URL } from "./api";
import { CheckoutAttemptStorageError, importVerifiedDeliveryReceipt, readDeliveryCheckoutReceipt } from "./checkout-attempt";
import { deliveryProofAccessForReceipt, readDeliveryProofAccessFragment, type DeliveryProofAccess } from "./delivery-proof-access";
import { PrimaryAction, Surface } from "./primitives";
class CustomerProofMessage extends Error {}
const canReveal = () => navigator.onLine !== false && document.visibilityState === "visible";

/** Separate customer capability: never use the printed/shared tracking token.
 * Only the successful private endpoint may authorize an imported fragment.
 */
export function CustomerDeliveryProof({ orderId, tenant, ready, finished }: {
  orderId: string; tenant: string | null; ready: boolean; finished: boolean;
}) {
  const access = useRef<DeliveryProofAccess | null>(null);
  const imported = useRef(false);
  const active = useRef(false);
  const generation = useRef(0);
  const busyRef = useRef(false);
  const [loaded, setLoaded] = useState(false);
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [proof, setProof] = useState<DeliveryCustomerProof | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    active.current = true;
    const load = async () => {
      const run = ++generation.current;
      setProof(null); setQr(null); setMessage(null); setLoaded(false);
      const fragment = readDeliveryProofAccessFragment(window.location.hash);
      if (fragment) { access.current = fragment; imported.current = true; setAvailable(true); setLoaded(true); return; }
      try {
        const receipt = tenant ? await readDeliveryCheckoutReceipt(tenant, orderId) : null;
        if (!active.current || run !== generation.current) return;
        access.current = deliveryProofAccessForReceipt(receipt, orderId, Date.now());
        setAvailable(Boolean(access.current));
      } catch { if (active.current && run === generation.current) setMessage("L’accès privé sauvegardé ne peut pas être relu. Contactez le restaurant sans recommander."); }
      finally { if (active.current && run === generation.current) setLoaded(true); }
    };
    void load();
    window.addEventListener("hashchange", load);
    return () => { active.current = false; access.current = null; window.removeEventListener("hashchange", load); };
  }, [orderId, tenant]);

  const show = useCallback(async () => {
    if (busyRef.current || !active.current || !ready || finished || !access.current || document.visibilityState !== "visible") return;
    if (navigator.onLine === false) { setProof(null); setQr(null); setMessage("Connexion requise pour vérifier le code de remise."); return; }
    busyRef.current = true; setBusy(true); setProof(null); setQr(null); setMessage(null);
    const run = ++generation.current;
    const request = { ...access.current };
    try {
      const response = await fetch(`${API_URL}/public/orders/${encodeURIComponent(orderId)}/delivery-proof`, {
        method: "POST", cache: "no-store", credentials: "omit", redirect: "error", referrerPolicy: "no-referrer",
        signal: AbortSignal.timeout(12_000), headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(request),
      });
      if (!response.ok) throw new CustomerProofMessage(response.status === 429 ? "Patientez un instant avant de vérifier de nouveau le code." : "Le code n’est pas disponible pour cette livraison. Actualisez le suivi ou contactez le restaurant.");
      const value = DeliveryCustomerProofSchema.parse(await response.json());
      const parsed = parseDeliveryHandoffQr(value.qr);
      if (value.missionId !== orderId || parsed?.orderId !== orderId || parsed.proofId !== value.proofId || Date.parse(value.expiresAt) <= Date.now()) throw new CustomerProofMessage("Le code reçu doit être vérifié avec le restaurant.");
      if (!active.current || run !== generation.current) return;
      if (imported.current) {
        if (!tenant) throw new CustomerProofMessage("Le restaurant n’a pas pu être vérifié. Conservez ce lien privé et contactez le restaurant.");
        await importVerifiedDeliveryReceipt(tenant, orderId, request, value);
        if (!active.current || run !== generation.current) return;
        // Keep the fragment until durable import; reload before departure or a
        // blocked store must not silently destroy a transferred capability.
        if (readDeliveryProofAccessFragment(window.location.hash)?.recoveryProof === request.recoveryProof) {
          window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
        }
        imported.current = false;
      }
      const qrModule = await import("qrcode");
      const image = await qrModule.default.toDataURL(value.qr, { errorCorrectionLevel: "M", margin: 3, width: 400 });
      if (!active.current || run !== generation.current || !canReveal()) return;
      setProof(value); setQr(image);
    } catch (cause) {
      if (active.current && run === generation.current) setMessage(cause instanceof CustomerProofMessage ? cause.message
        : cause instanceof CheckoutAttemptStorageError ? "Cet accès privé n’a pas pu être sauvegardé. Conservez le lien complet de cette page et contactez le restaurant ; aucune commande n’a été créée."
          : "Le code n’a pas pu être vérifié. Réessayez ou contactez le restaurant.");
    } finally {
      busyRef.current = false;
      if (active.current) setBusy(false);
    }
  }, [finished, orderId, ready, tenant]);

  useEffect(() => {
    const hide = () => { generation.current++; setProof(null); setQr(null); };
    const visible = () => { if (document.visibilityState !== "visible") hide(); };
    window.addEventListener("offline", hide); document.addEventListener("visibilitychange", visible);
    return () => { window.removeEventListener("offline", hide); document.removeEventListener("visibilitychange", visible); };
  }, []);
  useEffect(() => {
    if (!proof) return;
    const expires = window.setTimeout(() => { setProof(null); setQr(null); }, Math.max(0, Date.parse(proof.expiresAt) - Date.now()));
    return () => window.clearTimeout(expires);
  }, [proof]);

  if (finished) return null;
  return <Surface className="p-5" aria-label="Code privé de remise">
    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-mut">À l’arrivée du livreur</p>
    <h2 className="mt-2 text-xl font-extrabold tracking-[-0.03em]">Votre code de remise</h2>
    <p className="mt-3 text-sm leading-6 text-mut">Présentez ce code uniquement lorsque vous recevez votre commande. Votre carte fidélité et le lien de suivi partagé ne le remplacent pas.</p>
    {!ready ? <p className="mt-4 text-sm leading-6 text-mut">Le code devient disponible après confirmation du paiement et du départ du livreur.</p>
      : !loaded ? <p role="status" className="mt-4 text-sm text-mut">Recherche de votre accès privé…</p>
        : !available ? <p role="status" className="mt-4 text-sm leading-6 text-mut">Ce navigateur ne possède pas l’accès privé de cette commande. Ouvrez son suivi depuis l’appareil utilisé pour commander ou contactez le restaurant ; aucun code ne sera déduit de votre téléphone.</p>
          : <div className="mt-4">
            {proof && qr ? <div className="text-center">
              <p className="font-mono text-[clamp(28px,9vw,42px)] font-bold tracking-[0.18em]" aria-label={`Code de remise : ${proof.pin.split("").join(" ")}`}>{proof.pin}</p>
              {/* Local QR, no secret in an image request or external generator. */}
              {/* eslint-disable-next-line @next/next/no-img-element -- ephemeral local QR, never a remote image. */}
              <img src={qr} alt="QR privé à présenter au livreur" className="mx-auto mt-4 aspect-square w-full max-w-[220px] rounded-card" />
              <p className="mt-3 text-xs leading-5 text-mut">Si le restaurant renouvelle votre code, actualisez-le ici. Aucun enregistrement hors ligne n’est proposé.</p>
            </div> : null}
            <div className="mt-4"><PrimaryAction disabled={busy} loading={busy} onClick={() => void show()}>{proof ? "Actualiser mon code" : "Afficher mon code de remise"}</PrimaryAction></div>
          </div>}
    {message && <p role="alert" className="mt-4 text-sm leading-6 text-prept">{message}</p>}
    <p className="mt-4 text-xs leading-5 text-mut">L’accès privé est conservé jusqu’à sept jours sur cet appareil. Il ne constitue pas un compte client ni un historique de commandes.</p>
  </Surface>;
}
