"use client";

import { useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";
import { ajusterJusquaAA, logoUrlDe } from "@sm/contracts";
import { LogoMark } from "@/components/brand/Logo";
import { DeliveryPowered, deliveryInitials } from "./delivery-presentation";
import { useDeliveryPreferences } from "./delivery-preferences";
import { Btn } from "@/components/ui/Btn";
import { Icon } from "@/components/ui/icons";
import { createDeliveryAccessClient, type AccessState } from "./access-client";
import { DeliveryMissions } from "./delivery-missions";
import { DeliveryInstall } from "./DeliveryInstall";
import { DeliveryInvitation } from "./DeliveryInvitation";

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
  const appearance = useDeliveryPreferences();
  const [tab, setTab] = useState("tour");
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
  const hasSession = Boolean(state.session);
  const title = connected ? "Accès associé."
    : state.phase === "associating" ? "Association en cours."
      : state.phase === "disconnecting" ? "Déconnexion en cours."
        : state.phase === "checking" ? hasSession ? "Accès à vérifier." : "Vérifions votre accès."
          : state.reason ? "Un instant avant de continuer."
            : state.hasInvitation ? "Associez ce téléphone."
              : state.signedOut ? "Vous êtes déconnecté."
                : "Votre accès livreur.";

  const brand = state.session?.brand;
  const accent = brand?.palette.accent ?? "#c9a15a";
  const surfaceColors = appearance.theme === "light" ? ["#ececea", "#fff", "#f2f1ee", "#e6e4df"] : ["#000", "#111", "#1a1a1a", "#242424"];
  const style = {
    "--lv-accent": accent,
    "--lv-accent-text": ajusterJusquaAA(accent, surfaceColors).couleur,
    "--lv-on-accent": ajusterJusquaAA(brand?.palette.onAccent ?? "#12100d", [accent]).couleur,
    "--cf-accent-hover": accent,
    "--lv-tint": `color-mix(in srgb, ${accent} 12%, transparent)`,
  } as CSSProperties;
  const logo = brand ? logoUrlDe(brand) : null;
  const identity = state.session && <section className="lv-idcard" aria-label="Votre identité livreur">
    <div className="lv-idcard-top"><span className="lv-label">{connected ? "Identité livreur" : "Dernier accès vérifié"}</span>{connected && <span className="lv-associated"><Icon name="check" size={15} />Associé</span>}</div>
    <h2>{state.session.name}</h2>
    <div className="lv-id-restaurant"><BrandTile name={state.session.restaurantName} logo={logo} /><span>{state.session.restaurantName}</span></div>
    <p className="lv-expiry">Accès valable jusqu’au {expiryLabel(state.session.expiresAt)}, sauf retrait par le restaurant.</p>
  </section>;
  const accessActions = <div className="lv-access-actions">
    {state.hasInvitation && !state.session && <Btn block iconRight="arrow" disabled={busy || !state.online} onClick={() => void access.associate()}>
      {state.phase === "associating" ? "Association en cours…" : state.exchangePending ? "Vérifier l’association" : "Associer ce téléphone"}
    </Btn>}
    {!state.hasInvitation && !state.session && !busy && <Btn block variant="ghost" disabled={!state.online || state.reason === "invalid" || state.reason === "browser" || state.reason === "expired-link"} onClick={() => void access.refresh()}>Vérifier mon accès</Btn>}
    {state.session && <>
      <Btn block variant="ghost" disabled={busy || !state.online || state.logoutPending} onClick={() => void access.refresh()}>Vérifier mon accès</Btn>
      <Btn block variant="ghost" className="lv-logout" icon="logout" disabled={busy || !state.online} onClick={() => void access.logout()}>{state.phase === "disconnecting" ? "Déconnexion en cours…" : state.logoutPending ? "Confirmer la déconnexion" : "Déconnecter cet accès"}</Btn>
      <p className="lv-copy">Un nouveau lien d’invitation sera nécessaire pour vous reconnecter.</p>
    </>}
  </div>;
  return <main className="lv-app" data-theme={appearance.theme} style={style}>
    <div className="lv-shell">
      <header className="lv-top">
        <div className="lv-brand"><BrandTile name={state.session?.restaurantName} logo={logo} /><div className="lv-brand-copy"><b>{state.session?.restaurantName ?? "SM Livreur"}</b><small>{state.session ? "Livraison" : "Votre accès restaurant"}</small></div></div>
        {hasSession ? <button type="button" className="lv-who" onClick={() => setTab("account")} aria-label="Mon accès et paramètres"><span className="lv-who-copy"><b>{state.session!.name}</b><span className="lv-online"><span className={`lv-dot${!connected ? " off" : ""}`} />{connected ? "Accès vérifié" : state.online ? "À vérifier" : "Hors connexion"}</span></span><span className="lv-avatar">{deliveryInitials(state.session!.name)}</span></button>
          : <span className="lv-online"><span className={`lv-dot${!state.online ? " off" : ""}`} />{state.online ? "En ligne" : "Hors connexion"}</span>}
      </header>
      {!state.online && hasSession && <p role="status" className="lv-banner off"><Icon name="alert" size={16} />Hors connexion — aucun départ ni remise ne peut être confirmé.</p>}
      <div className={hasSession ? "lv-access-state" : "lv-access"} aria-busy={busy}>
        {!hasSession && <p className="lv-eyebrow">{state.reason === "revoked" ? "Accès retiré" : "Votre téléphone · votre accès"}</p>}
        <h1 id="delivery-access-title" className={hasSession ? "sr-only" : undefined}>{title}</h1>
        {!hasSession && !state.reason && <p className="lv-copy">{state.phase === "associating" ? "Attendez la confirmation du restaurant." : state.phase === "checking" ? "Nous vérifions la connexion avec votre restaurant." : state.hasInvitation ? "Le restaurant vous a confié un accès personnel. Confirmez l’association sur le téléphone que vous utiliserez en tournée." : state.signedOut ? "L’accès de ce téléphone a bien été retiré. Un nouveau lien sera nécessaire pour vous reconnecter." : "Pour commencer, ouvrez sur ce téléphone le lien d’invitation transmis par votre restaurant."}</p>}
        {state.reason && <div role="alert" aria-live="assertive" className={`lv-msg ${state.reason === "revoked" ? "bad" : "warn"}`}><Icon name="alert" size={17} /><p>{MESSAGES[state.reason]}</p></div>}
        {!hasSession && <>
          {state.hasInvitation && <div className="lv-idcard"><div className="lv-idcard-top"><span className="lv-label">Invitation</span><span className="lv-label">Valable 10 min</span></div><p className="lv-copy">Un téléphone personnel. Un accès confié par votre restaurant — révocable à tout moment.</p></div>}
          {accessActions}
          <DeliveryInvitation state={state} canImport={access.canImportInvitation()} onImport={access.importInvitation} />
          {!busy && <p className="lv-expiry">{state.hasInvitation ? "Le lien est valable 10 minutes. Gardez cette page ouverte jusqu’à la confirmation." : "Une invitation est personnelle et valable 10 minutes. Votre restaurant peut vous en fournir une nouvelle."}</p>}
          <DeliveryInstall associated={false} />
        </>}
      </div>
      {state.session && <DeliveryMissions key={`${state.session.restaurantSlug}:${state.session.operatorId}`} session={state.session} available={connected && !state.logoutPending} onRevoked={access.accessRejected}
        tab={tab} onTab={setTab} appearance={appearance} accountIdentity={identity} account={<>
          {state.hasInvitation && <p className="lv-msg warn">Vous avez ouvert une nouvelle invitation. Déconnectez cet accès avant d’associer le nouveau lien.</p>}
          {accessActions}<DeliveryInstall associated />
        </>} />}
      {!hasSession && <DeliveryPowered />}
    </div>
  </main>;
}

function BrandTile({ name, logo }: { name?: string; logo: string | null }) {
  const [failed, setFailed] = useState<string | null>(null);
  return <span className="lv-brand-tile">{logo && logo !== failed ? (
    // Tenant media hosts are validated by the API; Next image hosts cannot be fixed at build time.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={logo} alt="" onError={() => setFailed(logo)} style={{ width: "75%", height: "75%", objectFit: "contain" }} />
  ) : name ? name.trim().charAt(0).toUpperCase() : <LogoMark size={25} />}</span>;
}
