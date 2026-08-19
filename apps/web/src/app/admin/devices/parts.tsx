"use client";

/**
 * Briques de la vue « Caisses & cuisine » : horloge locale, copie, état vivant,
 * code d'appairage géant, marche à suivre.
 *
 * Les mêmes gestes que pour les écrans TV, parce que c'est le même geste : un
 * code à six caractères lu ici et recopié sur un appareil qui n'a pas de
 * compte. Un gérant qui a installé un téléviseur sait déjà installer sa caisse.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { PAIRING_CODE_TTL_MS } from "@sm/contracts";
import { cx } from "@/lib/cx";
import { timeAgo } from "@/lib/format";
import { Btn, Icon, useToast } from "@/components/ui";
import {
  deviceTone,
  fmtCountdown,
  KIND_APP_LABEL,
  TONE_DOT,
  TONE_TEXT,
  type DeviceKind,
  type DeviceView,
} from "./types";

// ─────────────────────────────────────────────────────────────
// Horloge locale
// ─────────────────────────────────────────────────────────────

/**
 * Horodatage courant, réévalué toutes les `tickMs`.
 *
 * L'horloge est un système EXTERNE : on s'y abonne plutôt que de la lire
 * pendant le rendu (`Date.now()` y est impur). `null` tant que l'abonnement n'a
 * pas eu lieu — donc au rendu serveur, ce qui évite tout écart d'hydratation.
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

/** Bouton « Copier » — le code part dans le presse-papiers d'un geste. */
export function CopyBtn({
  value,
  what,
  variant = "ghost",
  className,
}: {
  value: string;
  /** Ce qui est copié, pour le toast et le lecteur d'écran : « Le code ». */
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
      toast(`${what} copié`, { icon: "check" });
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
 * 12 min ») ; seule la TEINTE est calculée ici, parce qu'elle dépend de
 * l'heure du navigateur et doit vieillir entre deux rafraîchissements.
 */
export function StatusLine({
  device,
  now,
}: {
  device: DeviceView;
  now: number | null;
}) {
  const tone = deviceTone(device, now);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="relative grid size-[10px] shrink-0 place-items-center" aria-hidden>
        {tone === "online" && (
          <span className="absolute inset-0 animate-ping rounded-full bg-ok/60" />
        )}
        <span className={cx("relative size-[9px] rounded-full", TONE_DOT[tone])} />
      </span>
      <span className={cx("min-w-0 truncate text-sm font-bold", TONE_TEXT[tone])}>
        {device.statusLabel}
      </span>
    </div>
  );
}

/** Complément gris sous l'état : « dernier contact il y a 2 min ». */
export function LastSeenLine({ device }: { device: DeviceView }) {
  if (!device.paired) return null;
  return (
    <p className="mt-1 text-[13px] text-mut">
      {device.lastSeenAt
        ? `Dernier contact ${timeAgo(device.lastSeenAt)}`
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
 * Ils sont lus ici puis retapés sur un pavé tactile, à bout de bras. Les
 * espacer en tuiles évite la seule erreur qui reste possible une fois `I`, `O`,
 * `0` et `1` exclus de l'alphabet : perdre sa place au milieu du code.
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
 * traverse la salle jusqu'à la tablette : lui montrer « 15 min » figé serait un
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
 * tablette. Rien à configurer, rien à choisir : c'est le code qui apprend à
 * l'appareil de quel restaurant il est.
 */
export function InstallSteps({ kind }: { kind: DeviceKind }) {
  const app = KIND_APP_LABEL[kind];
  return (
    <ol className="flex flex-col gap-3.5">
      <Step index={1} title={`Ouvrez ${app} sur la tablette`}>
        <p className="mt-0.5 text-[13px] text-mut">
          Au premier lancement, elle affiche un pavé «&nbsp;Appairer cet
          appareil&nbsp;» à la place du code équipe. Connectez la tablette au
          wifi du restaurant.
        </p>
      </Step>

      <Step index={2} title="Saisissez le code à six caractères">
        <p className="mt-0.5 text-[13px] text-mut">
          Les touches sont larges&nbsp;: on tape avec le pouce, debout. Ni
          adresse, ni identifiant à choisir — ce code suffit, et il ne sera
          jamais redemandé.
        </p>
      </Step>

      <Step index={3} title="La tablette prend vos couleurs">
        <p className="mt-0.5 text-[13px] text-mut">
          Le nom et l&apos;accent de votre établissement apparaissent, puis
          l&apos;écran habituel du code équipe. L&apos;appareil repartira tout
          seul après une coupure de courant&nbsp;: le code n&apos;est demandé
          qu&apos;une fois, à l&apos;installation.
        </p>
      </Step>
    </ol>
  );
}

// ─────────────────────────────────────────────────────────────
// Divers
// ─────────────────────────────────────────────────────────────

/** Durée de vie d'un code, écrite en toutes lettres là où on la subit. */
export const PAIRING_TTL_LABEL = `${Math.round(PAIRING_CODE_TTL_MS / 60_000)} minutes`;
