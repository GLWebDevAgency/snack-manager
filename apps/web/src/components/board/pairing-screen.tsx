"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_LENGTH,
  SCREEN_ORIENTATION_LABELS,
  type ScreenPaired,
} from "@sm/contracts";
import { BOARD_API_URL, BoardApiError, fetchScreenContent, pairScreen } from "./board-api";
import { marqueDeRepli } from "@sm/contracts";
import { cx } from "@/lib/cx";
import { classesPolices } from "@/components/masque/polices";
import { styleDuMasque } from "@/components/masque/styleDuMasque";
import { readDeviceToken, savePairing, writeCachedContent } from "./board-store";
import { useStage } from "./use-stage";

/**
 * ÉCRAN D'APPAIRAGE — le seul moment où un humain touche la télévision.
 *
 * Le gérant crée un écran dans le back-office, qui lui donne six caractères ;
 * il les recopie ici, une fois, et c'est fini. Le jeton obtenu est persistant :
 * après une coupure de courant, un débranchement de la clé HDMI ou un
 * redémarrage de la TV, l'écran repart seul sur la carte. Personne ne remontera
 * sur un escabeau pour reconfigurer un écran accroché au-dessus du comptoir.
 *
 * Trois détails de terrain :
 *
 *  - l'alphabet vient du contrat (`I`, `O`, `0` et `1` en sont exclus) : le
 *    code se lit sur un téléviseur à trois mètres, et un `O` pris pour un `0`
 *    coûte un appel au support ;
 *  - le pavé à l'écran est indispensable — une télécommande Fire TV n'a pas de
 *    clavier, mais sa croix directionnelle déplace le focus d'un bouton à
 *    l'autre. Un clavier USB, lui, tape directement ;
 *  - dès que les six caractères sont saisis, on tente l'appairage TOUTES LES
 *    TROIS SECONDES jusqu'à ce qu'il aboutisse. Le gérant peut donc taper le
 *    code avant même d'avoir fini côté back-office : l'écran bascule tout seul.
 */

const RETRY_MS = 3_000;
/** Après deux échecs « code inconnu », on soupçonne une faute de frappe. */
const HINT_AFTER_ATTEMPTS = 2;
const PAIRED_DWELL_MS = 2_400;

type Phase = "entry" | "pairing" | "paired" | "stopped";

interface Status {
  tone: "mut" | "error" | "ok";
  text: string;
}

/** `?code=ABC234` : l'URL configurée sur la clé HDMI appaire sans rien taper. */
function codeFromUrl(): string | null {
  try {
    const raw = new URLSearchParams(window.location.search).get("code");
    if (!raw) return null;
    const cleaned = raw
      .toUpperCase()
      .split("")
      .filter((c) => PAIRING_CODE_ALPHABET.includes(c))
      .join("");
    return cleaned.length === PAIRING_CODE_LENGTH ? cleaned : null;
  } catch {
    return null;
  }
}

export function PairingScreen() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [code, setCode] = useState("");
  const [phaseState, setPhaseState] = useState<Phase>("entry");
  // La bascule « code complet → tentative d'appairage » ne dépend que de la
  // longueur du code et de la phase enregistrée, toutes deux connues au rendu :
  // la calculer ici supprime le rendu pendant lequel un code pourtant complet
  // paraissait encore en cours de saisie devant le client.
  // Sûr parce que tout retour à « entry » (reprise de saisie, effacement)
  // réécrit `code` dans la même passe : un code complet ne peut jamais rester
  // bloqué en phase de saisie, ni relancer la boucle de tentatives.
  const phase: Phase =
    phaseState === "entry" && code.length === PAIRING_CODE_LENGTH
      ? "pairing"
      : phaseState;
  const [status, setStatus] = useState<Status | null>(null);
  const [paired, setPaired] = useState<ScreenPaired | null>(null);
  const [brandName, setBrandName] = useState<string | null>(null);

  const stage = useStage(null);
  // Aucun restaurant n'est encore connu : la peau de repli (Nuit), la même que
  // pour un tenant non repris — l'écran d'appairage ne surprend pas la salle.
  const palette = styleDuMasque(marqueDeRepli(null, null));

  // Déjà appairé : on ne montre même pas cet écran, on repart sur la carte.
  useEffect(() => {
    if (readDeviceToken()) {
      router.replace("/board/display");
      return;
    }
    const fromUrl = codeFromUrl();
    if (fromUrl) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- le code pré-rempli vient de l'URL et le jeton du stockage local : ni l'un ni l'autre n'existe au rendu serveur, les lire au rendu provoquerait une divergence d'hydratation sur la télévision de la salle.
      setCode(fromUrl);
      setPhaseState("pairing");
    }
    setReady(true);
  }, [router]);

  const pushChar = useCallback(
    (char: string) => {
      if (phase === "paired") return;
      setStatus(null);
      // On retape par-dessus une tentative en cours ou un refus : le gérant
      // corrige sa saisie, il ne doit pas avoir à chercher un bouton « annuler ».
      if (phase === "pairing" || phase === "stopped") {
        setPhaseState("entry");
        setCode(char);
        return;
      }
      setCode((value) => (value.length >= PAIRING_CODE_LENGTH ? value : value + char));
    },
    [phase],
  );

  const eraseChar = useCallback(() => {
    if (phase === "paired") return;
    setStatus(null);
    setPhaseState("entry");
    setCode((value) => value.slice(0, -1));
  }, [phase]);

  const eraseAll = useCallback(() => {
    if (phase === "paired") return;
    setStatus(null);
    setPhaseState("entry");
    setCode("");
  }, [phase]);

  // Clavier physique (USB, Bluetooth, ou la saisie déportée d'une box) —
  // beaucoup plus rapide que le pavé à l'écran quand il y en a un sous la main.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Backspace") {
        event.preventDefault();
        eraseChar();
        return;
      }
      if (event.key === "Escape") {
        eraseAll();
        return;
      }
      if (event.key.length !== 1) return;
      const char = event.key.toUpperCase();
      if (PAIRING_CODE_ALPHABET.includes(char)) {
        event.preventDefault();
        pushChar(char);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pushChar, eraseChar, eraseAll]);

  // Six caractères : on lance les tentatives (bascule calculée au rendu
  // plus haut, `phase`).
  useEffect(() => {
    if (phase !== "pairing" || code.length !== PAIRING_CODE_LENGTH) return;

    let alive = true;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const attempt = async () => {
      if (!alive) return;
      attempts += 1;
      setStatus({ tone: "mut", text: "Appairage en cours…" });

      try {
        const result = await pairScreen(code);
        if (!alive) return;
        savePairing(result);
        setPaired(result);
        setPhaseState("paired");

        // On profite du jeton tout neuf pour remplir le cache : l'affichage
        // s'ouvrira sur la carte, pas sur un écran d'attente.
        try {
          const content = await fetchScreenContent(result.deviceToken);
          if (!alive) return;
          writeCachedContent(content);
          setBrandName(content.brand.name);
        } catch {
          /* le cache se remplira à l'affichage */
        }
        return;
      } catch (error) {
        if (!alive) return;

        if (error instanceof BoardApiError) {
          // Expiré, déjà utilisé, mal formé : réessayer n'y changerait rien,
          // et le message de l'API dit exactement quoi faire.
          if (error.status === 400 || error.status === 409 || error.status === 410) {
            setPhaseState("stopped");
            setStatus({ tone: "error", text: error.message });
            return;
          }
          if (error.status === 404) {
            setStatus({
              tone: attempts > HINT_AFTER_ATTEMPTS ? "error" : "mut",
              text:
                attempts > HINT_AFTER_ATTEMPTS
                  ? "Code inconnu — vérifiez la saisie, ou créez l'écran dans le back-office."
                  : "Appairage en cours…",
            });
          } else {
            setStatus({ tone: "mut", text: "Connexion au serveur…" });
          }
        }
        timer = setTimeout(() => void attempt(), RETRY_MS);
      }
    };

    void attempt();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [phase, code]);

  // Un temps d'arrêt sur « appairé », le nom du restaurant à l'écran, puis la
  // carte. C'est la seule confirmation que le gérant verra de sa vie.
  useEffect(() => {
    if (phase !== "paired") return;
    const timer = setTimeout(() => router.replace("/board/display"), PAIRED_DWELL_MS);
    return () => clearTimeout(timer);
  }, [phase, router]);

  const cells = Array.from({ length: PAIRING_CODE_LENGTH }, (_, i) => code[i] ?? null);
  const apiHost = BOARD_API_URL.replace(/^https?:\/\//, "");

  const missing = PAIRING_CODE_LENGTH - code.length;
  const line: Status =
    status ??
    (code.length === 0
      ? { tone: "mut", text: "Saisissez le code affiché dans le back-office." }
      : {
          tone: "mut",
          text: missing === 1 ? "Encore un caractère" : `Encore ${missing} caractères`,
        });

  return (
    <div className={cx("bd-root", classesPolices)} style={palette}>
      <div
        className="bd-stage"
        data-orientation={stage.orientation}
        data-ready={stage.ready && ready ? "1" : "0"}
        style={stage.style}
      >
        {phase === "paired" && paired ? (
          <div className="bd-paired">
            <div className="bd-check">✓</div>
            <div className="bd-plate-kicker">Écran appairé</div>
            <div className="bd-plate-title">{brandName ?? paired.name}</div>
            <div className="bd-plate-line">
              {brandName ? `${paired.name} · ` : ""}
              {SCREEN_ORIENTATION_LABELS[paired.orientation]}
            </div>
          </div>
        ) : (
          <div className="bd-pair">
            <div className="bd-pair-side">
              <div className="bd-pair-kicker">Menu Board</div>
              <div className="bd-pair-title">Appairez cet écran</div>
              <ol className="bd-pair-steps">
                <li className="bd-pair-step">
                  <span className="bd-pair-num">1</span>
                  <span>
                    Ouvrez le back-office, onglet <b>Écrans</b>
                  </span>
                </li>
                <li className="bd-pair-step">
                  <span className="bd-pair-num">2</span>
                  <span>
                    Créez un écran : un code de <b>{PAIRING_CODE_LENGTH} caractères</b> s’affiche
                  </span>
                </li>
                <li className="bd-pair-step">
                  <span className="bd-pair-num">3</span>
                  <span>
                    Saisissez-le ici — l’écran bascule <b>tout seul</b> sur la carte
                  </span>
                </li>
              </ol>
              <div className="bd-pair-status" data-tone={line.tone}>
                {line.text}
              </div>
            </div>

            <div className="bd-pair-side">
              <div className="bd-code">
                {cells.map((char, index) => (
                  <div
                    key={index}
                    className="bd-code-cell"
                    data-state={char ? "filled" : index === code.length ? "active" : "empty"}
                  >
                    {char ?? (index === code.length ? <span className="bd-caret" /> : null)}
                  </div>
                ))}
              </div>

              <div className="bd-keys">
                {PAIRING_CODE_ALPHABET.split("").map((char, index) => (
                  <button
                    key={char}
                    type="button"
                    className="bd-key"
                    autoFocus={index === 0}
                    onClick={() => pushChar(char)}
                  >
                    {char}
                  </button>
                ))}
                <button
                  type="button"
                  className="bd-key"
                  data-wide="1"
                  onClick={eraseChar}
                >
                  ← Effacer
                </button>
                <button
                  type="button"
                  className="bd-key"
                  data-wide="1"
                  data-tone={code.length > 0 ? "accent" : undefined}
                  onClick={eraseAll}
                >
                  Tout effacer
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="bd-pair-foot">Serveur : {apiHost}</div>
      </div>
    </div>
  );
}
