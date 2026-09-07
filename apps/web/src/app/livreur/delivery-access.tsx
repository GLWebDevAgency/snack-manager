"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Btn } from "@/components/ui/Btn";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/icons";
import { createDeliveryAccessClient, type AccessState } from "./access-client";

const MESSAGES: Record<NonNullable<AccessState["reason"]>, string> = {
  invalid: "Ce lien d’invitation est incomplet. Demandez au restaurant de vous le renvoyer.",
  browser: "Ce navigateur ne permet pas de sécuriser l’association. Ouvrez le lien dans un navigateur à jour, en connexion sécurisée.",
  offline: "Vous êtes hors connexion. L’accès ne peut pas être vérifié pour le moment.",
  network: "Le restaurant n’a pas pu confirmer votre accès. Vérifiez votre connexion puis réessayez.",
  revoked: "Votre accès a expiré ou a été retiré par le restaurant. Demandez un nouveau lien pour vous reconnecter.",
  exchange: "L’association reste à vérifier. Réessayez ici avec le même lien ; gardez cette page ouverte et autorisez ses cookies.",
  logout: "La déconnexion n’est pas confirmée. Gardez cette page ouverte et réessayez dès que la connexion revient.",
  "expired-link": "Ce lien a expiré, a été remplacé ou est déjà utilisé. Demandez un nouveau lien au restaurant.",
  rate: "Trop de tentatives. Patientez un instant avant de vérifier à nouveau l’association.",
};

function expiryLabel(iso: string) {
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).format(new Date(iso));
}

export function DeliveryAccess() {
  const [access] = useState(() => createDeliveryAccessClient());
  const state = useSyncExternalStore(access.subscribe, access.getSnapshot, access.getServerSnapshot);

  useEffect(() => {
    void access.start();
    const checkVisible = () => { if (document.visibilityState === "visible") void access.refresh(); };
    window.addEventListener("online", access.connectivityChanged);
    window.addEventListener("offline", access.connectivityChanged);
    window.addEventListener("focus", checkVisible);
    document.addEventListener("visibilitychange", checkVisible);
    const timer = window.setInterval(checkVisible, 60_000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", access.connectivityChanged);
      window.removeEventListener("offline", access.connectivityChanged);
      window.removeEventListener("focus", checkVisible);
      document.removeEventListener("visibilitychange", checkVisible);
    };
  }, [access]);

  const busy = ["checking", "associating", "disconnecting"].includes(state.phase);
  const connected = state.phase === "connected" && state.online;
  const title = connected ? "Accès associé."
    : state.phase === "associating" ? "Association en cours."
      : state.phase === "disconnecting" ? "Déconnexion en cours."
        : state.phase === "checking" ? "Vérifions votre accès."
          : state.reason ? "Un instant avant de continuer."
            : state.hasInvitation ? "Associez ce téléphone."
              : state.signedOut ? "Vous êtes déconnecté."
                : "Votre accès livreur.";

  return (
    <main className="min-h-dvh bg-bg px-5 pb-[max(28px,env(safe-area-inset-bottom))] pt-[max(28px,env(safe-area-inset-top))] text-ink sm:px-8">
      <div className="mx-auto flex min-h-[calc(100dvh-64px)] w-full max-w-[460px] flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-line pb-5">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-card border border-accent/25 bg-accentwash text-accentink"><Icon name="truck" size={21} /></span>
            <div><p className="text-[14px] font-bold tracking-[-0.025em]">Snack Manager</p><p className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-mut">Accès livreur</p></div>
          </div>
          <span className="flex items-center gap-1.5 text-xs text-mut"><span aria-hidden className={`size-1.5 rounded-full ${state.online ? "bg-accent" : "bg-prep"}`} />{state.online ? "Vérification en ligne" : "Hors connexion"}</span>
        </header>

        <section className="pb-8 pt-11 sm:pt-16" aria-labelledby="delivery-access-title" aria-busy={busy}>
          <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-accentink">Votre téléphone · votre accès</p>
          <h1 id="delivery-access-title" className="max-w-[390px] text-[clamp(30px,8.7vw,42px)] font-semibold leading-[1.08] tracking-[-0.055em]">{title}</h1>
          {!state.reason && <p className="mt-5 text-[15px] leading-7 text-mut">
            {connected ? "Votre restaurant vous reconnaît sur ce téléphone."
              : state.phase === "associating" ? "Attendez la confirmation du restaurant."
                : state.phase === "disconnecting" ? "Le restaurant retire la session de ce téléphone."
                  : state.phase === "checking" ? "Nous vérifions la connexion avec votre restaurant."
                    : state.hasInvitation ? "Le restaurant vous a confié un accès personnel. Confirmez l’association sur le téléphone que vous utiliserez."
                      : state.signedOut ? "L’accès de ce téléphone a bien été retiré. Un nouveau lien sera nécessaire pour vous reconnecter."
                        : "Pour commencer, ouvrez sur ce téléphone le lien d’invitation transmis par votre restaurant."}
          </p>}

          <div role={state.reason ? "alert" : "status"} aria-live={state.reason ? "assertive" : "polite"} aria-atomic="true">
            {state.reason && <div className="mt-6 flex items-start gap-3 rounded-card border border-prep/30 bg-prep/8 p-4 text-[14px] leading-6 text-prept"><Icon name="alert" className="mt-1 shrink-0" /><p>{MESSAGES[state.reason]}</p></div>}
            {!state.reason && <span className="sr-only">{title}</span>}
          </div>

          {state.session && <Card className="mt-7 p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-mut">{connected ? "Votre identité livreur" : "Dernier accès vérifié"}</span>
              {connected && <span className="flex items-center gap-1.5 text-xs font-semibold text-okt"><Icon name="check" size={15} />Associé</span>}
            </div>
            <p className="mt-5 break-words text-[26px] font-semibold tracking-[-0.04em]">{state.session.name}</p>
            <p className="mt-1 break-words text-[15px] text-mut">{state.session.restaurantName}</p>
            <div className="mt-6 flex items-start gap-2.5 border-t border-line pt-4 text-xs leading-5 text-mut"><Icon name="clock" size={16} className="mt-0.5 shrink-0" /><p>Accès valable jusqu’au {expiryLabel(state.session.expiresAt)}, sauf retrait par le restaurant.</p></div>
          </Card>}

          {connected && <p className="mt-5 text-[13px] leading-6 text-mut">Cet écran confirme votre accès. Les missions de livraison ne sont pas encore disponibles.</p>}
          {state.session && state.hasInvitation && <p className="mt-5 text-[13px] leading-6 text-prept">Vous avez ouvert une nouvelle invitation. Déconnectez cet accès avant d’associer le nouveau lien.</p>}

          <div className="mt-8 space-y-3">
            {state.hasInvitation && !state.session && <Btn block className="min-h-12 whitespace-normal" iconRight="arrow" disabled={busy || !state.online} onClick={() => void access.associate()}>
              {state.phase === "associating" ? "Association en cours…" : state.exchangePending ? "Vérifier l’association" : "Associer ce téléphone"}
            </Btn>}
            {!state.hasInvitation && !state.session && !busy && <Btn block variant="ghost" className="min-h-12 whitespace-normal" disabled={!state.online || state.reason === "invalid" || state.reason === "browser" || state.reason === "expired-link"} onClick={() => void access.refresh()}>Vérifier mon accès</Btn>}
            {state.session && <>
              <Btn block variant="ghost" className="min-h-12 whitespace-normal" disabled={busy || !state.online || state.logoutPending} onClick={() => void access.refresh()}>Vérifier mon accès</Btn>
              <Btn block variant="ghost" className="min-h-12 whitespace-normal border-transparent text-mut" icon="logout" disabled={busy || !state.online} onClick={() => void access.logout()}>{state.phase === "disconnecting" ? "Déconnexion en cours…" : state.logoutPending ? "Confirmer la déconnexion" : "Déconnecter cet accès"}</Btn>
            </>}
          </div>

          {!state.session && !busy && <div className="mt-7 flex items-start gap-2.5 text-xs leading-5 text-mut"><Icon name="clock" size={16} className="mt-0.5 shrink-0" /><p>{state.hasInvitation ? "Le lien est valable 10 minutes. Gardez cette page ouverte jusqu’à la confirmation." : "Une invitation est personnelle et valable 10 minutes. Votre restaurant peut vous en fournir une nouvelle."}</p></div>}
        </section>

        <footer className="mt-auto border-t border-line pt-5 text-[11px] leading-5 text-mut">Un téléphone personnel. Un accès confié par votre restaurant.</footer>
      </div>
    </main>
  );
}
