"use client";

/**
 * Briques de la vue « Écrans TV » : copie, horloge locale, état vivant,
 * code d'appairage géant, marche à suivre, note sur le dayparting.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { PAIRING_CODE_TTL_MS, SCENE_MAX_LINES } from "@sm/contracts";
import { cx } from "@/lib/cx";
import { timeAgo } from "@/lib/format";
import { Btn, Icon, Pill, useToast } from "@/components/ui";
import {
  allProducts,
  daypartOf,
  fmtCountdown,
  screenTone,
  TONE_DOT,
  TONE_TEXT,
  type MenuData,
  type ScreenView,
} from "./types";

// ─────────────────────────────────────────────────────────────
// Horloge locale
// ─────────────────────────────────────────────────────────────

/**
 * Horodatage courant, réévalué toutes les `tickMs`.
 *
 * L'horloge est un système EXTERNE : on s'y abonne plutôt que de la lire
 * pendant le rendu (`Date.now()` y est impur) ou de la recopier dans un état
 * depuis un effet. `null` tant que l'abonnement n'a pas eu lieu — donc au
 * rendu serveur, ce qui évite au passage tout écart d'hydratation.
 */
export function useNow(tickMs: number): number | null {
  const value = useRef<number | null>(null);
  const subscribe = useCallback(
    (onChange: () => void) => {
      // Renseigné AVANT que React ne relise l'instantané après l'abonnement :
      // la première valeur apparaît donc sans attendre un tour d'horloge.
      value.current = Date.now();
      const id = window.setInterval(() => {
        value.current = Date.now();
        onChange();
      }, tickMs);
      return () => window.clearInterval(id);
    },
    [tickMs],
  );
  return useSyncExternalStore(
    subscribe,
    () => value.current,
    () => null,
  );
}

// ─────────────────────────────────────────────────────────────
// Copie
// ─────────────────────────────────────────────────────────────

/**
 * Bouton « Copier ». Le gérant est debout devant sa télévision, téléphone en
 * main : tout ce qu'il aurait à recopier à la main (l'adresse surtout) doit
 * pouvoir partir dans le presse-papiers d'un geste.
 */
export function CopyBtn({
  value,
  what,
  variant = "ghost",
  className,
}: {
  value: string;
  /** Ce qui est copié, pour le toast et le lecteur d'écran : « L'adresse ». */
  what: string;
  variant?: "ghost" | "ink";
  className?: string;
}) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setDone(false), 1600);
      toast(`${what} copiée`, { icon: "check" });
    } catch {
      // Presse-papiers refusé (contexte non sécurisé, permission) : on le dit
      // plutôt que de laisser croire à une copie réussie.
      toast("Copie impossible — sélectionnez le texte à la main");
    }
  }

  return (
    <Btn
      variant={variant}
      size="sm"
      icon={done ? "check" : "grid"}
      aria-label={`Copier ${what.toLowerCase()}`}
      onClick={() => void copy()}
      className={cx(done && "text-okt", className)}
    >
      {done ? "Copié" : "Copier"}
    </Btn>
  );
}

// ─────────────────────────────────────────────────────────────
// État vivant
// ─────────────────────────────────────────────────────────────

/**
 * Pastille + phrase d'état. Le libellé vient de l'API (« Hors ligne depuis
 * 22 min ») ; seule la TEINTE est calculée ici, parce qu'elle dépend de
 * l'heure du navigateur et doit vieillir entre deux rafraîchissements.
 */
export function StatusLine({
  screen,
  now,
  size = "md",
}: {
  screen: ScreenView;
  now: number | null;
  size?: "md" | "sm";
}) {
  const tone = screenTone(screen, now);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="relative grid size-[10px] shrink-0 place-items-center" aria-hidden>
        {tone === "online" && (
          <span className="absolute inset-0 animate-ping rounded-full bg-ok/60" />
        )}
        <span className={cx("relative size-[9px] rounded-full", TONE_DOT[tone])} />
      </span>
      <span
        className={cx(
          "min-w-0 truncate font-bold",
          size === "sm" ? "text-[13px]" : "text-sm",
          TONE_TEXT[tone],
        )}
      >
        {screen.statusLabel}
      </span>
    </div>
  );
}

/** Complément gris sous l'état : « dernier contact il y a 2 min ». */
export function LastSeenLine({ screen }: { screen: ScreenView }) {
  if (!screen.paired) return null;
  return (
    <p className="mt-1 text-[13px] text-mut">
      {screen.lastSeenAt
        ? `Dernier contact ${timeAgo(screen.lastSeenAt)}`
        : "Aucun contact depuis l'appairage"}
    </p>
  );
}

// ─────────────────────────────────────────────────────────────
// Code d'appairage
// ─────────────────────────────────────────────────────────────

/**
 * Les six caractères, un par tuile.
 *
 * Ils sont lus sur un téléphone à bout de bras puis retapés sur un pavé de
 * télévision, souvent à la télécommande. Les espacer en tuiles évite la seule
 * erreur qui reste possible une fois `I`, `O`, `0` et `1` exclus de
 * l'alphabet : perdre sa place au milieu du code.
 */
export function PairingCode({
  code,
  size = "lg",
  dimmed = false,
}: {
  code: string;
  size?: "lg" | "sm";
  dimmed?: boolean;
}) {
  return (
    <div
      className={cx("flex flex-wrap", size === "lg" ? "gap-2" : "gap-1.5")}
      aria-label={`Code d'appairage : ${code.split("").join(" ")}`}
    >
      {code.split("").map((char, i) => (
        <span
          key={`${char}-${i}`}
          aria-hidden
          className={cx(
            "cf-fig grid place-items-center rounded-card border border-white/10 bg-[image:var(--cf-elev-gradient)] font-extrabold",
            size === "lg"
              ? "h-[76px] w-[58px] text-[42px]"
              : "h-[38px] w-[30px] text-[20px]",
            dimmed ? "text-mut line-through decoration-alert/70" : "text-ink",
          )}
        >
          {char}
        </span>
      ))}
    </div>
  );
}

/**
 * Validité restante du code. Le compte à rebours tourne pendant que le gérant
 * monte sur son escabeau : lui montrer « expire dans 15 min » figé serait un
 * mensonge à la minute près.
 */
export function CodeCountdown({
  expiresAt,
  expired,
}: {
  expiresAt: string;
  expired: boolean;
}) {
  const now = useNow(1_000);
  const remaining = now === null ? null : Date.parse(expiresAt) - now;
  const dead = expired || (remaining !== null && remaining <= 0);

  if (dead)
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] font-bold text-alertt">
        <Icon name="clock" size={14} />
        Code expiré
      </span>
    );

  if (remaining === null)
    return <span className="text-[13px] text-mut">Vérification de la validité…</span>;

  // Sous deux minutes, le gérant n'aura pas le temps de finir : on le prévient
  // avant qu'il ne tape le sixième caractère pour rien.
  const urgent = remaining < 2 * 60_000;
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 text-[13px] font-bold",
        urgent ? "text-prept" : "text-mut",
      )}
    >
      <Icon name="clock" size={14} />
      <span className="cf-fig">Valable encore {fmtCountdown(remaining)}</span>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// Marche à suivre
// ─────────────────────────────────────────────────────────────

function Step({
  index,
  title,
  children,
}: {
  index: number;
  title: string;
  children?: ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span
        className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-pill bg-accent text-xs font-extrabold text-onaccent"
        aria-hidden
      >
        {index}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold text-ink">{title}</div>
        {children}
      </div>
    </li>
  );
}

/**
 * Les trois gestes de l'installation, dans l'ordre où on les fait devant la
 * télévision. L'adresse à ouvrir est donnée en entier avec son bouton de
 * copie : c'est la seule information que le restaurateur ne peut pas deviner,
 * et il n'a aucune raison d'aller la chercher dans une documentation.
 */
export function InstallSteps({
  boardUrl,
  code,
}: {
  boardUrl: string;
  /** Code courant — active le raccourci d'adresse pré-remplie. */
  code?: string;
}) {
  return (
    <ol className="flex flex-col gap-3.5">
      <Step index={1} title="Branchez la clé sur le téléviseur">
        <p className="mt-0.5 text-[13px] text-mut">
          Clé HDMI (Fire TV, Chromecast, Mi Box…) ou navigateur intégré du
          téléviseur. Allumez l&apos;écran et connectez-le au wifi du
          restaurant.
        </p>
      </Step>

      <Step index={2} title="Ouvrez cette adresse sur l'écran">
        {/*
          Adresse EMPILÉE au-dessus de son bouton plutôt qu'à côté : le panneau
          d'aide est étroit, et une adresse posée sur la même ligne qu'un bouton
          finit coupée en plein mot (« …/boa | rd »), ce qui est exactement ce
          qu'on ne peut pas se permettre sur la seule valeur à recopier.
        */}
        <div className="mt-1.5 rounded-ctrl border border-line2 bg-surface2 p-3">
          <div className="break-all font-mono text-[15px] font-bold leading-snug text-ink">
            {boardUrl}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-line2 pt-2.5">
            <span className="text-xs text-mut">
              Dans le navigateur du téléviseur
            </span>
            <CopyBtn value={boardUrl} what="L'adresse" variant="ink" />
          </div>
        </div>
        {code && (
          <div className="mt-2">
            <p className="text-[13px] text-mut">
              Raccourci&nbsp;: si votre clé permet d&apos;enregistrer une adresse
              de démarrage, utilisez celle-ci — l&apos;écran s&apos;appaire alors
              sans rien taper.
            </p>
            <p className="mt-1 break-all font-mono text-[13px] font-semibold leading-snug text-ink">
              {boardUrl}?code={code}
            </p>
          </div>
        )}
      </Step>

      <Step index={3} title="Saisissez le code à six caractères">
        <p className="mt-0.5 text-[13px] text-mut">
          Au clavier USB, ou avec la croix directionnelle de la télécommande sur
          le pavé affiché. Dès le sixième caractère, l&apos;écran bascule seul
          sur votre carte — et il y repartira tout seul après chaque coupure de
          courant.
        </p>
      </Step>
    </ol>
  );
}

// ─────────────────────────────────────────────────────────────
// Dayparting
// ─────────────────────────────────────────────────────────────

/**
 * La convention que PERSONNE ne devine.
 *
 * Le dayparting ne se règle nulle part : il est déduit des étiquettes déjà
 * posées sur les produits. Autant l'écrire noir sur blanc et, surtout, montrer
 * ce que la carte du restaurant contient RÉELLEMENT aujourd'hui — une règle
 * expliquée dans l'abstrait ne se vérifie jamais.
 */
export function DaypartNote({ menu }: { menu: MenuData | null }) {
  const products = allProducts(menu);
  const lunch = products.filter((p) => daypartOf(p.tags) === "lunch");
  const dinner = products.filter((p) => daypartOf(p.tags) === "dinner");
  const tagged = lunch.length + dinner.length;

  return (
    <>
      <p className="text-[13px] leading-relaxed text-mut">
        Un produit dont les étiquettes contiennent{" "}
        <TagChip>midi</TagChip> n&apos;apparaît sur vos écrans{" "}
        <span className="font-semibold text-ink">qu&apos;au service du midi</span>{" "}
        ; avec <TagChip>soir</TagChip>, seulement{" "}
        <span className="font-semibold text-ink">au service du soir</span>. Le
        basculement suit vos horaires réels&nbsp;: vous n&apos;avez rien à
        programmer.
      </p>
      <p className="mt-2.5 text-[13px] leading-relaxed text-mut">
        <span className="font-semibold text-ink">
          Sans étiquette de service, un produit reste affiché toute la journée
        </span>{" "}
        — c&apos;est le cas de l&apos;immense majorité d&apos;une carte. Les
        variantes <TagChip>lunch</TagChip>
        <TagChip>déjeuner</TagChip> et <TagChip>dinner</TagChip>
        <TagChip>dîner</TagChip> sont reconnues de la même façon.
      </p>

      <div className="mt-3.5 rounded-card border border-line2 bg-surface2 px-3.5 py-3">
        {menu === null ? (
          <p className="text-[13px] text-mut">
            Carte indisponible&nbsp;: impossible de vérifier vos étiquettes pour
            l&apos;instant.
          </p>
        ) : tagged === 0 ? (
          <p className="text-[13px] text-mut">
            <span className="font-semibold text-ink">
              Aucun produit n&apos;est limité à un service
            </span>{" "}
            aujourd&apos;hui&nbsp;: toute votre carte s&apos;affiche du matin au
            soir.
          </p>
        ) : (
          <>
            <div className="mb-2 text-[11px] font-extrabold uppercase tracking-[0.06em] text-mut">
              Dans votre carte aujourd&apos;hui
            </div>
            <DaypartRow label="Midi seulement" items={lunch} />
            <DaypartRow label="Soir seulement" items={dinner} />
          </>
        )}
      </div>
    </>
  );
}

function TagChip({ children }: { children: ReactNode }) {
  return (
    <span className="mr-1 inline-block rounded-xs border border-white/12 bg-fill px-1.5 py-px font-mono text-xs font-bold text-ink">
      {children}
    </span>
  );
}

function DaypartRow({ label, items }: { label: string; items: { _id: string; name: string }[] }) {
  if (items.length === 0) return null;
  const shown = items.slice(0, 4);
  const rest = items.length - shown.length;
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-line2 py-2 first:border-t-0 first:pt-0">
      <span className="text-[13px] font-bold text-ink">{label}</span>
      <span className="min-w-0 flex-1 text-[13px] text-mut">
        {shown.map((p) => p.name).join(", ")}
        {rest > 0 && ` et ${rest} autre${rest > 1 ? "s" : ""}`}
      </span>
      <Pill variant="out" className="cf-fig">
        {items.length}
      </Pill>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Divers
// ─────────────────────────────────────────────────────────────

/** Rappel du découpage automatique — évite la question « où est la suite ? ». */
export function MaxLinesNote() {
  return (
    <p className="text-[13px] leading-relaxed text-mut">
      Une catégorie de plus de {SCENE_MAX_LINES} produits est découpée
      automatiquement en pages successives&nbsp;: au-delà, la typographie
      passerait sous le seuil de lecture à trois mètres.
    </p>
  );
}

/** Durée de vie d'un code, écrite en toutes lettres là où on la subit. */
export const PAIRING_TTL_LABEL = `${Math.round(PAIRING_CODE_TTL_MS / 60_000)} minutes`;
