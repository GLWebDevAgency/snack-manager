"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  loyaltyTokenFromQrPayload,
  type LoyaltyCustomerCard,
  type LoyaltyPublicProgram,
} from "@sm/contracts";
import { Btn, Card, Icon, Modal, Pill, Skeleton } from "@/components/ui";
import { classesPolices } from "@/components/masque/polices";
import { styleDuMasque } from "@/components/masque/styleDuMasque";
import { cx } from "@/lib/cx";
import { fmtEuro, timeAgo } from "@/lib/format";
import {
  LoyaltyCustomerSessionError,
  forgetCustomerLoyaltyCard,
  loadRememberedCustomerLoyaltyCard,
  rememberCustomerLoyaltyCard,
} from "./customer-api";
import { LoyaltyScanner } from "./LoyaltyScanner";
import { loyaltyScanSuccessAnnouncement } from "./scan-feedback";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function benefit(reward: LoyaltyPublicProgram["rewards"][number]): string {
  if (reward.kind === "fixed_discount") return fmtEuro(reward.valueCents);
  if (reward.kind === "product") return reward.productRef ?? "Produit offert";
  return reward.description || "Avantage à retirer au comptoir";
}

export function LoyaltyCardApp({ catalog }: { catalog: LoyaltyPublicProgram }) {
  const abortRef = useRef<AbortController | null>(null);
  const focusAfterScanRef = useRef(false);
  const cardHeadingRef = useRef<HTMLHeadingElement>(null);
  const [card, setCard] = useState<LoyaltyCustomerCard | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [forgetOpen, setForgetOpen] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [scanAnnouncement, setScanAnnouncement] = useState("");

  useEffect(() => {
    const capture = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", capture);
    return () => window.removeEventListener("beforeinstallprompt", capture);
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const base = `/r/${encodeURIComponent(catalog.restaurant.slug)}/fidelite`;
    void navigator.serviceWorker.register(`${base}/sw.js`, { scope: base }).catch(() => {
      // L'application reste entièrement utilisable dans le navigateur ; le
      // bouton d'installation ne sera simplement pas proposé sur cet appareil.
    });
  }, [catalog.restaurant.slug]);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    const fragmentToken = loyaltyTokenFromQrPayload(
      window.location.href,
      catalog.restaurant.slug,
    );
    const hadFragment = window.location.hash.length > 0;
    if (hadFragment) {
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
    }
    const request = fragmentToken
      ? rememberCustomerLoyaltyCard(
          catalog.restaurant.slug,
          fragmentToken,
          controller.signal,
        )
      : loadRememberedCustomerLoyaltyCard(
          catalog.restaurant.slug,
          controller.signal,
        );
    const fragmentError = hadFragment && !fragmentToken
      ? "Ce lien ne correspond pas à une carte de ce restaurant."
      : null;
    void request
      .then((remembered) => {
        if (controller.signal.aborted) return;
        if (fragmentError) setError(fragmentError);
        if (remembered) {
          setCard(remembered);
          setUpdatedAt(new Date());
        }
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          cause instanceof LoyaltyCustomerSessionError
            ? cause.message
            : "La carte enregistrée n’a pas pu être chargée.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setRestoring(false);
      });
    return () => controller.abort();
  }, [catalog.restaurant.slug]);

  const loadCard = useCallback(async (token: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    focusAfterScanRef.current = true;
    setScanAnnouncement("");
    setScannerOpen(false);
    setLoading(true);
    setError(null);
    try {
      const next = await rememberCustomerLoyaltyCard(
        catalog.restaurant.slug,
        token,
        controller.signal,
      );
      setCard(next);
      setUpdatedAt(new Date());
      setScanAnnouncement(
        loyaltyScanSuccessAnnouncement(
          next,
          catalog.program.unitLabelSingular,
          catalog.program.unitLabelPlural,
        ),
      );
    } catch (cause) {
      if (controller.signal.aborted) return;
      focusAfterScanRef.current = false;
      setCard(null);
      setError(
        cause instanceof LoyaltyCustomerSessionError
          ? cause.message
          : "La carte n’a pas pu être chargée. Vérifiez le QR et réessayez.",
      );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [
    catalog.program.unitLabelPlural,
    catalog.program.unitLabelSingular,
    catalog.restaurant.slug,
  ]);

  useEffect(() => {
    if (loading || !card || !focusAfterScanRef.current) return;
    focusAfterScanRef.current = false;
    cardHeadingRef.current?.focus({ preventScroll: true });
  }, [card, loading]);

  const nextReward = useMemo(() => {
    if (!card) return null;
    return [...card.rewards]
      .sort((left, right) => left.costUnits - right.costUnits)
      .find((reward) => reward.costUnits > card.member.balanceUnits) ?? null;
  }, [card]);
  const progress = card
    ? nextReward
      ? Math.min(100, Math.round((card.member.balanceUnits / nextReward.costUnits) * 100))
      : 100
    : 0;

  async function refresh() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const next = await loadRememberedCustomerLoyaltyCard(
        catalog.restaurant.slug,
        controller.signal,
      );
      if (!next) {
        setCard(null);
        setError("Cette carte n’est plus disponible. Scannez un nouveau QR.");
        return;
      }
      setCard(next);
      setUpdatedAt(new Date());
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(
        cause instanceof LoyaltyCustomerSessionError
          ? cause.message
          : "La carte n’a pas pu être actualisée.",
      );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  function forget() {
    abortRef.current?.abort();
    setCard(null);
    setError(null);
    setUpdatedAt(null);
    setForgetOpen(false);
    setQrOpen(false);
    void forgetCustomerLoyaltyCard(catalog.restaurant.slug).catch(() => {
      setError("La carte a été masquée, mais son retrait de cet appareil devra être réessayé.");
    });
  }

  async function install() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  const masque = styleDuMasque(catalog.restaurant.brand);
  const unitPlural = catalog.program.unitLabelPlural;
  const unitSingular = catalog.program.unitLabelSingular;

  return (
    <div
      style={masque}
      className={cx(
        classesPolices,
        // `clip` et non `hidden` : l'en-tête de cette page est collante.
        "font-body min-h-dvh overflow-x-clip bg-bg pb-[max(28px,env(safe-area-inset-bottom))] text-ink",
      )}
    >
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-dialog-allow>
        {scanAnnouncement}
      </p>
      <header className="sticky top-0 z-30 border-b border-ink/8 bg-bg/85 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[720px] items-center gap-3">
          <Link href={`/r/${encodeURIComponent(catalog.restaurant.slug)}`} aria-label={`Retour à ${catalog.restaurant.name}`} className="grid size-11 shrink-0 place-items-center rounded-pill border border-ink/10 bg-ink/5 text-ink"><Icon name="back" size={18} /></Link>
          {catalog.restaurant.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- URL de marque tenant dynamique, déjà filtrée par l'API publique.
            <img src={catalog.restaurant.logoUrl} alt="" className="size-9 rounded-card object-cover" />
          ) : (
            <span className="grid size-9 rounded-card bg-accent text-sm font-black text-onaccent place-items-center" aria-hidden>{catalog.restaurant.name.charAt(0).toUpperCase()}</span>
          )}
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-extrabold">{catalog.restaurant.name}</p><p className="font-display truncate text-[11px] text-mut">{catalog.program.name}</p></div>
          {installPrompt && <button type="button" onClick={() => void install()} className="cf-press min-h-11 rounded-pill border border-accent/30 bg-accent/10 px-3 py-2 text-xs font-bold text-accent">Installer</button>}
        </div>
      </header>

      <main className="mx-auto w-full max-w-[720px] px-4 pt-6">
        {error && card && !loading && (
          <div className="mb-4 rounded-card border border-alert/35 bg-alert/10 p-4">
            <p className="text-sm text-alertt" role="alert">{error}</p>
          </div>
        )}
        {!card && !loading && !restoring && (
          <>
            <section className="relative overflow-hidden rounded-wide border border-accent/20 bg-[image:var(--cf-card-gradient)] p-5 shadow-deep sm:p-7">
              <div className="absolute -right-20 -top-24 size-64 rounded-full bg-accent/12 blur-3xl" aria-hidden />
              <div className="relative">
                <Pill className="border-accent/30 bg-accent/10 text-accent">Carte digitale · gratuite</Pill>
                <h1 className="font-display mt-4 max-w-[560px] text-[clamp(1.875rem,1.4rem+2vw,2.5rem)] font-black leading-[1.05] tracking-[-0.05em] text-ink">
                  Vos avantages {catalog.restaurant.name}, toujours à portée de main.
                </h1>
                <p className="mt-3 max-w-[520px] text-sm leading-6 text-mut">
                  Scannez une fois le QR remis par le restaurant. Aucun compte, aucun mot de passe et aucune donnée personnelle dans l’adresse.
                </p>
                <Btn className="mt-6" icon="grid" onClick={() => setScannerOpen(true)}>Afficher ma carte</Btn>
              </div>
            </section>

            {error && <div className="mt-4 rounded-card border border-alert/35 bg-alert/10 p-4"><p className="text-sm text-alertt" role="alert">{error}</p><Btn variant="ghost" size="sm" className="mt-3" onClick={() => setScannerOpen(true)}>Scanner un autre QR</Btn></div>}

            <section className="mt-6">
              <div className="mb-3"><p className="text-[11px] font-bold uppercase tracking-[0.09em] text-accent">À débloquer</p><h2 className="font-display mt-1 text-xl font-extrabold tracking-[-0.035em]">Les récompenses du moment</h2></div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {catalog.rewards.map((reward) => (
                  <Card key={reward.id} className="p-4"><div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-card bg-accent/12 text-accent"><Icon name="gift" size={19} /></span><div className="min-w-0"><p className="text-sm font-extrabold text-ink">{reward.name}</p><p className="mt-1 text-xs leading-5 text-mut">{benefit(reward)}</p><p className="cf-fig mt-3 text-sm font-black text-accent">{reward.costUnits.toLocaleString("fr-FR")} {reward.costUnits === 1 ? unitSingular : unitPlural}</p></div></div></Card>
                ))}
              </div>
            </section>
          </>
        )}

        {(loading || restoring) && (
          <div aria-live="polite"><Skeleton className="h-[320px] rounded-wide" /><div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2"><Skeleton className="h-[150px]" /><Skeleton className="h-[150px]" /></div><p className="sr-only">Chargement de votre carte fidélité</p></div>
        )}

        {card && !loading && (
          <>
            <section className="relative overflow-hidden rounded-wide border border-accent/30 bg-[image:var(--cf-card-gradient)] p-5 shadow-deep sm:p-7">
              <div className="absolute -right-16 -top-16 size-56 rounded-full bg-accent/15 blur-3xl" aria-hidden />
              <div className="relative flex items-start justify-between gap-4"><div><Pill className="border-ok/30 bg-ok/10 text-okt">Carte active</Pill><h1 ref={cardHeadingRef} tabIndex={-1} className="font-display mt-3 rounded-xs text-xl font-extrabold tracking-[-0.035em] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent">Bonjour {card.member.alias}</h1></div><Icon name="gift" size={28} className="text-accent" /></div>
              <div className="relative mt-8"><p className="text-[11px] font-bold uppercase tracking-[0.09em] text-mut">Votre solde</p><p className="cf-fig font-display mt-1 text-[clamp(2.75rem,2.3rem+1.8vw,3.25rem)] font-black leading-none tracking-[-0.055em] text-ink">{card.member.balanceUnits.toLocaleString("fr-FR")}</p><p className="mt-1 text-sm font-bold text-accent">{card.member.balanceUnits === 1 ? unitSingular : unitPlural}</p></div>
              <div className="relative mt-7"><div className="h-2 overflow-hidden rounded-pill bg-ink/10"><div className="h-full rounded-pill bg-accent transition-transform duration-500 ease-sm motion-reduce:transition-none" style={{ transform: `scaleX(${progress / 100})`, transformOrigin: "left" }} /></div><p className="mt-2 text-xs text-mut">{nextReward ? `Encore ${(nextReward.costUnits - card.member.balanceUnits).toLocaleString("fr-FR")} ${unitPlural} pour « ${nextReward.name} »` : "Votre solde atteint tous les paliers publiés."}</p></div>
              <Btn block icon="grid" className="relative mt-5" onClick={() => setQrOpen(true)}>
                Présenter ma carte
              </Btn>
              <div className="relative mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-line2 pt-4"><p className="text-[11px] text-mut">{updatedAt ? `Actualisée à ${updatedAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : "Actualisée maintenant"}</p><div className="flex gap-2"><button type="button" onClick={() => void refresh()} className="cf-press min-h-11 rounded-pill px-3 py-2 text-xs font-bold text-accent">Actualiser</button><button type="button" onClick={() => setForgetOpen(true)} className="cf-press min-h-11 rounded-pill px-3 py-2 text-xs font-bold text-mut hover:text-ink">Retirer</button></div></div>
            </section>

            <section className="mt-6"><div className="mb-3"><p className="text-[11px] font-bold uppercase tracking-[0.09em] text-accent">Catalogue informatif</p><h2 className="font-display mt-1 text-xl font-extrabold tracking-[-0.035em]">Récompenses à venir</h2><p className="mt-2 text-xs leading-5 text-mut">Pendant le pilote, votre QR sert à rattacher vos achats. Aucun point n’est encore débité pour une récompense.</p></div><div className="space-y-3">{card.rewards.map((reward) => <Card key={reward.id} className={reward.affordable ? "border-ok/25 p-4" : "p-4 opacity-70"}><div className="flex items-center gap-3"><span className={reward.affordable ? "grid size-11 shrink-0 place-items-center rounded-card bg-ok/12 text-okt" : "grid size-11 shrink-0 place-items-center rounded-card bg-ink/6 text-mut"}><Icon name={reward.affordable ? "check" : "gift"} size={19} /></span><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-3"><p className="text-sm font-extrabold text-ink">{reward.name}</p><Pill className={reward.affordable ? "border-ok/30 bg-ok/10 text-okt" : ""}>{reward.affordable ? "Palier atteint" : `${reward.costUnits} ${unitPlural}`}</Pill></div><p className="mt-1 text-xs leading-5 text-mut">{reward.description || benefit(reward)}</p></div></div></Card>)}</div></section>

            {card.activity.length > 0 && (
              <section className="mt-6">
                <div className="mb-3">
                  <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-accent">Traçabilité</p>
                  <h2 className="font-display mt-1 text-xl font-extrabold tracking-[-0.035em]">Activité récente</h2>
                </div>
                <Card className="overflow-hidden p-0">
                  <ol className="divide-y divide-line2">
                    {card.activity.map((entry, index) => (
                      <li key={`${entry.recordedAt}-${index}`} className="flex items-center gap-3 px-4 py-3.5">
                        <span className={entry.deltaUnits > 0 ? "grid size-9 shrink-0 place-items-center rounded-card bg-ok/10 text-okt" : "grid size-9 shrink-0 place-items-center rounded-card bg-alert/10 text-alertt"}>
                          <Icon name={entry.kind === "redeem" ? "gift" : entry.deltaUnits > 0 ? "plus" : "minus"} size={16} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold text-ink">{entry.label}</p>
                          <p className="mt-0.5 text-[11px] text-mut">{timeAgo(entry.recordedAt)} · solde {entry.balanceAfter.toLocaleString("fr-FR")}</p>
                        </div>
                        <p className={entry.deltaUnits > 0 ? "cf-fig text-sm font-black text-okt" : "cf-fig text-sm font-black text-alertt"}>
                          {entry.deltaUnits > 0 ? "+" : ""}{entry.deltaUnits.toLocaleString("fr-FR")}
                        </p>
                      </li>
                    ))}
                  </ol>
                </Card>
              </section>
            )}

            <section className="mt-6 rounded-card border border-ink/8 bg-ink/[0.025] p-4"><h2 className="font-display text-sm font-extrabold">Conditions du programme</h2><p className="mt-2 text-xs leading-5 text-mut">{card.program.termsSummary || "Renseignez-vous auprès du restaurant pour connaître les conditions applicables."}</p><p className="mt-3 text-[11px] leading-5 text-mut">Le secret de votre QR est conservé dans un cookie sécurisé, inaccessible au JavaScript et limité à cette carte. « Retirer » l’efface de cet appareil.</p></section>
          </>
        )}
      </main>

      {scannerOpen && <LoyaltyScanner expectedSlug={catalog.restaurant.slug} onClose={() => setScannerOpen(false)} onToken={(token) => void loadCard(token)} />}
      <Modal
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        title="Ma carte fidélité"
        width={390}
        footer={<Btn block onClick={() => setQrOpen(false)}>Terminer</Btn>}
      >
        <div className="text-center">
          {/* `sm-qr-frame` : zone de silence CLAIRE, quelle que soit la peau
              du restaurant — c'est une caméra qui lit, pas un œil. */}
          <div className="sm-qr-frame mx-auto max-w-[320px] rounded-wide p-3 shadow-deep">
            {/* Le SVG est généré côté serveur depuis le cookie HttpOnly puis servi no-store. */}
            {/* eslint-disable-next-line @next/next/no-img-element -- image privée dynamique, non optimisable et jamais mise en cache. */}
            <img
              src={`/r/${encodeURIComponent(catalog.restaurant.slug)}/fidelite/card-qr`}
              alt={`QR de la carte fidélité de ${card?.member.alias ?? "ce client"}`}
              className="aspect-square w-full"
            />
          </div>
          <p className="mt-4 text-sm font-extrabold text-ink">
            Présentez ce QR à la caisse
          </p>
          <p className="mt-1 text-xs leading-5 text-mut">
            Le personnel voit uniquement votre carte et votre solde. Le QR n’est ni placé dans l’adresse ni mis en cache.
          </p>
        </div>
      </Modal>
      <Modal
        open={forgetOpen}
        onClose={() => setForgetOpen(false)}
        title="Retirer la carte de cet appareil ?"
        destructive
        footer={
          <>
            <Btn variant="ghost" onClick={() => setForgetOpen(false)}>Annuler</Btn>
            <Btn
              variant="ghost"
              className="border-alert/40 bg-alert/10 text-alertt hover:bg-alert/15"
              onClick={forget}
            >
              Retirer la carte
            </Btn>
          </>
        }
      >
        <p className="leading-6 text-mut">
          Votre solde reste intact chez le restaurant. Il faudra simplement rescanner le QR pour afficher la carte ici.
        </p>
      </Modal>
    </div>
  );
}
