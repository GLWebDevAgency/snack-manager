"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  logoPour,
  loyaltyTokenFromQrPayload,
  type LoyaltyCustomerCard,
  type LoyaltyPublicProgram,
} from "@sm/contracts";
import { Btn, Card, Icon, Modal, Pill, verrouPour } from "@/components/ui";
import { classesPolices } from "@/components/masque/polices";
import { FeuilleDuMasque } from "@/components/masque/FeuilleDuMasque";
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
import {
  loyaltyScanSuccessAnnouncement,
  messageDEchecQr,
  messageDeMiseAJour,
} from "./scan-feedback";
import {
  ActionCommander,
  EnTeteFidelite,
  SoldeCarte,
  SqueletteCarte,
  TitreSection,
  TuileRecompense,
} from "./carte-visuelle";
import {
  chiffre,
  paliersFranchis,
  phraseDeProgression,
  prochainPalier,
  progressionVers,
  unitePour,
} from "./paliers";
import {
  dureeEnMs,
  useCompteAnime,
  useDrapeauTemporaire,
  useGesteBref,
} from "./mouvement";
import {
  ecrireInstantane,
  fraicheur,
  lireInstantane,
  oublierInstantane,
  type InstantaneCarte,
} from "./carte-locale";
import {
  scanAutorise,
  supprimerCarteJusquAuVerdict,
} from "./session-guards";
import {
  contexteInstallation,
  modeInstallation,
  type ContexteInstallation,
} from "./installation";
import { VIBRATION_PALIER, VIBRATION_SCAN, vibrer } from "./haptique";
import { SignatureSnackManager } from "./SignatureSnackManager";
import { CustomerAccountPage } from "../customer-account/CustomerAccountPage";
import { CustomerServiceNotice, type CustomerUnavailableService } from "../customer-account/CustomerServiceNotice";
import { navigateOrderView, useOrderNavigationLock } from "../order/order-navigation";
import { OrderTabBar } from "../order/OrderTabBar";
import { SMTabBarSpacer } from "../ui/SMTabBar";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** Repli de la durée « fête » quand le masque n'a rien posé (jamais en prod). */
const FETE_PAR_DEFAUT_MS = 900;

/** Le message de mise à jour reste lisible le temps d'être lu, pas plus. */
const DUREE_ANNONCE_MS = 3_600;

/**
 * QUAND ANNONCER — trois règles, et la nuance est celle de l'INITIATIVE.
 *
 *   `toujours`      — le client a demandé quelque chose (scan, actualisation) :
 *                     le silence serait perçu comme une panne, même quand rien
 *                     n'a bougé. « Solde à jour » EST la réponse.
 *   `si-changement` — l'application s'ouvre et vérifie d'elle-même : on ne
 *                     félicite personne pour un solde inchangé, sinon la
 *                     pastille apparaît à chaque lancement et cesse d'être lue.
 *   `jamais`        — première peinture d'une carte que personne n'a demandée.
 */
type RegleDAnnonce = "toujours" | "si-changement" | "jamais";

function benefit(reward: LoyaltyPublicProgram["rewards"][number]): string {
  if (reward.kind === "fixed_discount") return fmtEuro(reward.valueCents);
  if (reward.kind === "product") return reward.productRef ?? "Produit offert";
  return reward.description || "Avantage à retirer au comptoir";
}

/*
 * ── CE QUE LE NAVIGATEUR PERMET, LU COMME UN STORE ────────────────────────
 *
 * `navigator.userAgent`, `navigator.standalone` et `display-mode` doivent être
 * connus AU RENDU pour décider quoi proposer. Les lire directement dans le
 * corps du composant serait une impureté (`react-hooks/purity`) et un
 * désaccord d'hydratation garanti — le serveur ne connaît aucun des trois.
 * `useSyncExternalStore` est le patron déjà en place dans ce dépôt pour cette
 * exacte situation (`masque/masqueDeCapture.ts`), et il rend ici une CHAÎNE :
 * une valeur primitive, donc stable d'un appel à l'autre.
 *
 * L'abonnement n'est pas décoratif : quelqu'un qui installe l'application
 * pendant sa visite passe en `display-mode: standalone` sans recharger, et
 * l'invitation doit disparaître d'elle-même.
 */
function abonnerAffichageAutonome(rejouer: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const liste = window.matchMedia("(display-mode: standalone)");
  liste.addEventListener("change", rejouer);
  return () => liste.removeEventListener("change", rejouer);
}

function lireContexteInstallation(): ContexteInstallation {
  if (typeof window === "undefined") return "rien";
  const autonome = window.matchMedia?.("(display-mode: standalone)").matches ?? false;
  const nav = window.navigator as Navigator & { standalone?: unknown };
  return contexteInstallation({
    ua: nav.userAgent,
    tactile: "ontouchend" in window.document,
    affichageAutonome: autonome,
    standaloneIOS: nav.standalone,
  });
}

const rienAuServeur = (): ContexteInstallation => "rien";

export function LoyaltyCardApp({ catalog, embedded = false, legacyOnly = false, orderingAvailable = true, initialView = "loyalty", onNavigationLockedChange, unavailableService }: {
  catalog: LoyaltyPublicProgram; embedded?: boolean; legacyOnly?: boolean; orderingAvailable?: boolean;
  initialView?: "loyalty" | "account"; onNavigationLockedChange?: (locked: boolean) => void;
  unavailableService?: CustomerUnavailableService;
}) {
  const panelId = useId();
  const slug = catalog.restaurant.slug;
  const pathname = usePathname();
  const activeView = !embedded && (pathname?.endsWith("/compte") || (!pathname && initialView === "account")) ? "account" : "loyalty";
  const [accountLocked, setAccountLocked] = useState(false);
  const cheminVitrine = orderingAvailable ? `/r/${encodeURIComponent(slug)}` : null;
  const loyaltyHref = `/r/${encodeURIComponent(slug)}/fidelite`;

  const abortRef = useRef<AbortController | null>(null);
  const suppressionRef = useRef(false);
  const focusApresScanRef = useRef(false);
  /*
   * L'état PRÉCÉDENT de la carte, tenu hors de React.
   *
   * Il ne sert qu'à répondre à une question — « qu'est-ce qui vient de
   * changer ? » — au moment précis où une réponse arrive. En faire un état
   * déclencherait un rendu de plus pour une valeur que rien n'affiche, et
   * `paliersFranchis` la lirait alors avec une image de retard.
   */
  const carteAvantRef = useRef<LoyaltyCustomerCard | null>(null);
  /*
   * LE JETON DU LIEN PROFOND EST À USAGE UNIQUE — et il était DÉTRUIT AVANT
   * D'ÊTRE CONSOMMÉ.
   *
   * L'effet retire le fragment de la barre d'adresse (`replaceState`) dès sa
   * première passe, puis lance la requête. Si cet effet est rejoué avant que
   * la réponse soit là — c'est exactement ce que fait React en développement,
   * et ce que fera n'importe quel remontage — la seconde passe ne trouve plus
   * de fragment et retombe sur une lecture de cookie qui n'existe pas encore :
   * le client voit l'écran « scannez votre QR » alors qu'il vient de le
   * scanner.
   *
   * Le jeton est donc mémorisé ici, hors de React, avant d'être effacé de
   * l'adresse. Le rejouer est sans conséquence : la route de session est
   * idempotente.
   */
  const lienProfondRef = useRef<{ jeton: string | null; avaitUnFragment: boolean } | null>(
    null,
  );
  const titreRef = useRef<HTMLHeadingElement>(null);
  const compteurRef = useRef(0);

  const [carte, setCarte] = useState<LoyaltyCustomerCard | null>(null);
  const [instantaneLocal, setInstantaneLocal] = useState<InstantaneCarte | null>(null);
  const [vuA, setVuA] = useState<string | null>(null);
  const [horsLigne, setHorsLigne] = useState(false);
  const [echecActualisationLocale, setEchecActualisationLocale] = useState(false);
  const [scannerOuvert, setScannerOuvert] = useState(false);
  const [qrOuvert, setQrOuvert] = useState(false);
  const [retraitOuvert, setRetraitOuvert] = useState(false);
  const [restauration, setRestauration] = useState(true);
  const [occupe, setOccupe] = useState(false);
  const [suppressionEnCours, setSuppressionEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [invitePrompt, setInvitePrompt] = useState<InstallPromptEvent | null>(null);
  const [installEcartee, setInstallEcartee] = useState(false);
  const [annonceLue, setAnnonceLue] = useState("");
  const [annonce, setAnnonce] = useState<{ cle: number; texte: string } | null>(null);
  const [fete, setFete] = useState<{ cle: number; ids: string[] } | null>(null);
  const navigationLocked = accountLocked || suppressionEnCours || scannerOuvert || qrOuvert || retraitOuvert;
  useOrderNavigationLock(!embedded && navigationLocked);
  useEffect(() => { onNavigationLockedChange?.(navigationLocked); return () => onNavigationLockedChange?.(false); }, [navigationLocked, onNavigationLockedChange]);
  function selectTab(key: string) {
    if (navigationLocked) return;
    if (key === "account" || key === "loyalty") navigateOrderView(slug, key, false);
  }

  /*
   * MÉMORISÉ — `resoudreMarque()` recalcule une trentaine de mélanges et
   * jusqu'à quatre recherches d'AA par pas de 1/200 (~0,5 ms). Sans ce
   * `useMemo`, la facture était payée à CHAQUE rendu de la racine — donc à
   * chaque image de la montée du solde — pour un objet identique. Sa référence
   * sert aussi de `style` : la recréer forçait React à repeindre tout le
   * sous-arbre.
   */
  const masque = useMemo(
    () => styleDuMasque(catalog.restaurant.brand),
    [catalog.restaurant.brand],
  );
  /*
   * LA DURÉE DE FÊTE VIENT DU MASQUE — 900 ms « posé », 600 ms « vif ».
   *
   * Le CSS la lit tout seul (`animate-eclat`, `animate-fete`) ; la montée du
   * solde, elle, est une boucle JavaScript et a besoin du nombre. On le prend
   * dans le masque DÉJÀ résolu au-dessus plutôt que de rappeler le résolveur
   * ou — pire — de recopier une constante qui figerait le choix du
   * restaurateur.
   */
  const dureeFete = useMemo(
    () => dureeEnMs((masque as Record<string, unknown>)["--sm-t-slow"], FETE_PAR_DEFAUT_MS),
    [masque],
  );

  /*
   * LE LOGO VIENT DU MASQUE, PAS DU CHAMP PLAT — `restaurant.logoUrl` est le
   * dérivé de compatibilité (`logoUrlDe`), qui préfère toujours la déclinaison
   * SOMBRE : sur une carte de fidélité peinte en clair, le logo du restaurant
   * s'effaçait sur son propre fond. `logoPour()` suit le mode.
   */
  const logoMarque = logoPour(catalog.restaurant.brand, "mark");
  /*
   * LE VERROU — « logo avec le nom », s'il est posé. `verrouPour` et non
   * `logoPour(brand, "lockup")` : ce dernier retomberait sur la MARQUE, et un
   * pictogramme carré servi comme verrou effacerait le nom du restaurant de
   * son propre en-tête. Rien de posé, l'en-tête ne bouge pas.
   */
  const verrouMarque = verrouPour(catalog.restaurant.brand);
  const unitePlurielle = catalog.program.unitLabelPlural;
  const uniteSinguliere = catalog.program.unitLabelSingular;

  const contexte = useSyncExternalStore(
    abonnerAffichageAutonome,
    lireContexteInstallation,
    rienAuServeur,
  );
  const invitation = modeInstallation({
    contexte,
    inviteNative: invitePrompt !== null,
    ecartee: installEcartee,
  });

  // ── Le service worker : la coquille hors ligne et l'installabilité ──
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const base = `/r/${encodeURIComponent(slug)}/fidelite`;
    void navigator.serviceWorker.register(`${base}/sw.js`, { scope: base }).catch(() => {
      // L'application reste entièrement utilisable dans le navigateur ; le
      // bouton d'installation ne sera simplement pas proposé sur cet appareil.
    });
  }, [slug]);

  useEffect(() => {
    const capture = (event: Event) => {
      event.preventDefault();
      setInvitePrompt(event as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", capture);
    return () => window.removeEventListener("beforeinstallprompt", capture);
  }, []);

  /**
   * L'ARRIVÉE D'UNE CARTE — et tout ce qu'elle déclenche.
   *
   * Un seul endroit décide de ce qui se passe quand une carte fraîche arrive :
   * l'instantané local est réécrit, la fraîcheur redevient « à l'instant », le
   * delta et les paliers franchis sont mesurés CONTRE l'état précédent, puis
   * la fête, l'annonce visible, l'annonce vocale et le retour haptique partent
   * ensemble. Éparpiller cette suite sur trois appelants (scan, actualisation,
   * restauration) l'aurait fait diverger à la première correction.
   */
  const accueillir = useCallback(
    (fraiche: LoyaltyCustomerCard, annonce: RegleDAnnonce) => {
      const avant = carteAvantRef.current;
      const franchis = paliersFranchis(avant, fraiche);
      const delta = avant ? fraiche.member.balanceUnits - avant.member.balanceUnits : 0;

      carteAvantRef.current = fraiche;
      setCarte(fraiche);
      setInstantaneLocal(null);
      setEchecActualisationLocale(false);
      const instantane = ecrireInstantane(slug, fraiche.member.balanceUnits);
      setVuA(instantane.vuA);
      setHorsLigne(false);

      const changement = delta !== 0 || franchis.length > 0;
      if (annonce === "jamais") return;
      if (annonce === "si-changement" && !changement) return;

      compteurRef.current += 1;
      const cle = compteurRef.current;
      if (franchis.length > 0) {
        setFete({ cle, ids: franchis.map((recompense) => recompense.id) });
        vibrer(VIBRATION_PALIER);
      } else if (changement || annonce === "toujours") {
        vibrer(VIBRATION_SCAN);
      }
      setAnnonce({
        cle,
        texte: avant
          ? messageDeMiseAJour(delta, franchis, uniteSinguliere, unitePlurielle)
          : "Carte chargée",
      });
    },
    [slug, uniteSinguliere, unitePlurielle],
  );

  /**
   * L'ÉCHEC, TRIÉ EN DEUX — et c'est toute la différence hors ligne.
   *
   * `LoyaltyCustomerSessionError` signifie que le SERVEUR a répondu : la carte
   * est révoquée, le quota est atteint, le service est en panne. Tout autre
   * échec de `fetch` est un problème de RÉSEAU, et il ne dit rien du solde.
   *
   * Dans ce second cas, si un instantané est affiché, on ne le remplace pas
   * par un bandeau rouge : on garde le solde à l'écran et on annonce
   * honnêtement qu'il date. C'est le scénario le plus courant de tous — une
   * application installée, ouverte dans un sous-sol ou dans le métro.
   */
  const echouer = useCallback((cause: unknown, repli: string, aDejaUneCarte: boolean) => {
    if (cause instanceof LoyaltyCustomerSessionError) {
      setErreur(cause.message);
      return;
    }
    if (aDejaUneCarte) {
      setHorsLigne(true);
      return;
    }
    setErreur(repli);
  }, []);

  // ── Restauration : l'instantané local d'abord, le réseau ensuite ──
  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;
    if (!lienProfondRef.current) {
      const avait = window.location.hash.length > 0;
      lienProfondRef.current = {
        jeton: loyaltyTokenFromQrPayload(window.location.href, slug),
        avaitUnFragment: avait,
      };
      /*
       * Le secret quitte la barre d'adresse aussitôt lu : un fragment n'est
       * jamais envoyé au serveur, mais il reste dans l'historique, dans les
       * captures d'écran et dans ce qu'on partage.
       */
      if (avait) {
        window.history.replaceState(
          window.history.state,
          "",
          `${window.location.pathname}${window.location.search}`,
        );
      }
    }
    const { jeton: fragmentToken, avaitUnFragment } = lienProfondRef.current;
    const erreurDeFragment =
      avaitUnFragment && !fragmentToken
        ? "Ce lien ne correspond pas à une carte de ce restaurant."
        : null;

    void (async () => {
      /*
       * L'INSTANTANÉ EST PEINT AVANT LE RÉSEAU, TOUJOURS.
       *
       * Il n'attend pas l'échec : même en ligne, il supprime l'écran de
       * chargement pour quelqu'un qui rouvre son application — le seul solde
       * conservé est là, daté, et clairement séparé de la carte membre.
       * Un scan en cours (`fragmentToken`) passe outre : le client vient de
       * présenter un NOUVEAU QR, lui montrer l'ancienne carte serait faux.
       */
      const instantane = fragmentToken ? null : lireInstantane(slug);
      if (instantane && !controller.signal.aborted) {
        // Seul le solde est restauré. Le catalogue public courant vient de la
        // page, mais aucun alias, historique, palier ou statut « acquis » n'est
        // synthétisé avant la réponse membre du réseau.
        setInstantaneLocal(instantane);
        setEchecActualisationLocale(false);
        setVuA(instantane.vuA);
        setRestauration(false);
      }

      try {
        const fraiche = fragmentToken
          ? await rememberCustomerLoyaltyCard(slug, fragmentToken, controller.signal)
          : await loadRememberedCustomerLoyaltyCard(slug, controller.signal);
        if (controller.signal.aborted) return;
        if (erreurDeFragment) setErreur(erreurDeFragment);
        if (fraiche) {
          /*
           * Un lien profond EST un scan : c'est le geste par lequel la carte
           * arrive le plus souvent. Il mérite la même confirmation qu'un scan
           * fait à la caméra — sans quoi la seule chose qui distingue « ma
           * carte vient d'être chargée » de « ma carte était déjà là » serait
           * l'absence de squelette.
           */
          accueillir(
            fraiche,
            fragmentToken ? "toujours" : instantane ? "si-changement" : "jamais",
          );
        } else if (instantane) {
          /*
           * LE SERVEUR DIT « PLUS DE CARTE » : l'instantané doit suivre.
           *
           * Un 204 signifie que le cookie a expiré ou a été effacé ailleurs.
           * Garder l'instantané ferait afficher indéfiniment un solde que plus
           * rien ne peut rafraîchir — un chiffre mort dans une application
           * installée.
           */
          oublierInstantane(slug);
          carteAvantRef.current = null;
          setCarte(null);
          setInstantaneLocal(null);
          setVuA(null);
        }
      } catch (cause) {
        if (controller.signal.aborted) return;
        if (instantane) setEchecActualisationLocale(true);
        echouer(cause, "La carte enregistrée n’a pas pu être chargée.", instantane !== null);
      } finally {
        if (!controller.signal.aborted) setRestauration(false);
      }
    })();

    return () => controller.abort();
  }, [slug, accueillir, echouer]);

  const chargerDepuisScan = useCallback(
    async (token: string) => {
      // Le ref est lu avant tout `await` : même le clic qui précède le rendu
      // « retrait en cours » ne peut lancer un POST face au DELETE.
      if (!scanAutorise(suppressionRef)) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      focusApresScanRef.current = true;
      setAnnonceLue("");
      setOccupe(true);
      setErreur(null);
      try {
        const fraiche = await rememberCustomerLoyaltyCard(slug, token, controller.signal);
        accueillir(fraiche, "toujours");
        setAnnonceLue(
          loyaltyScanSuccessAnnouncement(fraiche, uniteSinguliere, unitePlurielle),
        );
      } catch (cause) {
        if (controller.signal.aborted) return;
        focusApresScanRef.current = false;
        setErreur(
          cause instanceof LoyaltyCustomerSessionError
            ? cause.message
            : "La carte n’a pas pu être chargée. Vérifiez le QR et réessayez.",
        );
      } finally {
        if (!controller.signal.aborted) {
          /*
           * LE SCANNER NE SE FERME QU'UNE FOIS LA RÉPONSE ARRIVÉE.
           *
           * Il se démontait dès la LECTURE du QR : la seule confirmation d'un
           * scan réussi était donc sa disparition, suivie d'un squelette
           * pleine page. En le gardant monté, sa coche verte et son « Carte
           * reconnue · chargement… » couvrent toute l'attente réseau, et
           * l'écran ne change qu'une fois — quand la carte est là.
           */
          setScannerOuvert(false);
          setOccupe(false);
        }
      }
    },
    [slug, accueillir, uniteSinguliere, unitePlurielle],
  );

  /*
   * STABLE, et ce n'est pas de la coquetterie : cette référence entre dans les
   * dépendances de l'effet qui monte la caméra du scanner. Une fonction
   * anonyme recréée à chaque rendu du parent — ce qui était le cas — arrêtait
   * et redémarrait le flux vidéo à chaque battement d'état, pendant que
   * l'utilisateur cadrait son QR.
   */
  const surJeton = useCallback(
    (token: string) => {
      void chargerDepuisScan(token);
    },
    [chargerDepuisScan],
  );

  const ouvrirScanner = useCallback(() => {
    if (!scanAutorise(suppressionRef)) return;
    setScannerOuvert(true);
  }, []);

  useEffect(() => {
    if (occupe || !carte || !focusApresScanRef.current) return;
    focusApresScanRef.current = false;
    titreRef.current?.focus({ preventScroll: true });
  }, [carte, occupe]);

  /**
   * ACTUALISER NE VIDE PLUS L'ÉCRAN.
   *
   * Le bouton remplaçait toute la page par un squelette : la carte
   * disparaissait, les récompenses aussi, et tout clignotait pour revenir
   * identique une seconde plus tard. La carte RESTE montée ; seul le bouton
   * dit qu'il travaille (`aria-busy`, libellé, curseur), et le solde se
   * contente de monter — ou de ne pas bouger, ce que l'annonce dira.
   */
  async function actualiser() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setOccupe(true);
    setErreur(null);
    if (instantaneLocal) setEchecActualisationLocale(false);
    try {
      const fraiche = await loadRememberedCustomerLoyaltyCard(slug, controller.signal);
      if (controller.signal.aborted) return;
      if (!fraiche) {
        oublierInstantane(slug);
        carteAvantRef.current = null;
        setCarte(null);
        setInstantaneLocal(null);
        setVuA(null);
        setErreur("Cette carte n’est plus disponible. Scannez un nouveau QR.");
        return;
      }
      accueillir(fraiche, "toujours");
    } catch (cause) {
      if (controller.signal.aborted) return;
      echouer(
        cause,
        "La carte n’a pas pu être actualisée.",
        carte !== null || instantaneLocal !== null,
      );
      if (instantaneLocal) setEchecActualisationLocale(true);
    } finally {
      if (!controller.signal.aborted) setOccupe(false);
    }
  }

  async function retirer() {
    if (!scanAutorise(suppressionRef)) return;

    const verdict = await supprimerCarteJusquAuVerdict(
      suppressionRef,
      () => forgetCustomerLoyaltyCard(slug),
      () => {
        /*
         * Le verrou est déjà pris ici. L'instantané part avant le premier
         * `await`, puis l'interface reste non scannable jusqu'au verdict
         * terminal de DELETE — y compris quand ce verdict est un échec.
         */
        abortRef.current?.abort();
        oublierInstantane(slug);
        carteAvantRef.current = null;
        setCarte(null);
        setInstantaneLocal(null);
        setVuA(null);
        setHorsLigne(false);
        setEchecActualisationLocale(false);
        setErreur(null);
        setAnnonce(null);
        setQrOuvert(false);
        setScannerOuvert(false);
        setOccupe(false);
        setSuppressionEnCours(true);
      },
    );

    setSuppressionEnCours(false);
    setRetraitOuvert(false);
    if (!verdict.ok) {
      setErreur(
        "La carte a été masquée, mais son retrait de cet appareil devra être réessayé.",
      );
    }
  }

  async function installer() {
    if (!invitePrompt) return;
    await invitePrompt.prompt();
    await invitePrompt.userChoice;
    setInvitePrompt(null);
  }

  // ── Ce qui bouge ──
  const soldeReel = carte?.member.balanceUnits ?? 0;
  const soldeAffiche = useCompteAnime(soldeReel, dureeFete);
  const palier = useMemo(
    () => (carte ? prochainPalier(carte.rewards, soldeReel) : null),
    [carte, soldeReel],
  );
  const progression = progressionVers(soldeAffiche, palier);
  const enFete = useGesteBref(fete?.cle ?? null, dureeFete);
  const annonceVisible = useDrapeauTemporaire(annonce?.cle ?? null, DUREE_ANNONCE_MS);
  const idsEnFete = enFete && fete ? fete.ids : [];

  const squelette = restauration && !carte && !instantaneLocal;
  const Content = embedded ? "div" : "main";

  return (
    <div
      style={embedded ? undefined : masque}
      className={cx(
        classesPolices,
        // `clip` et non `hidden` : l'en-tête de cette page est collante.
        embedded ? "font-body text-ink" : "font-body min-h-dvh overflow-x-clip bg-bg pb-[max(28px,env(safe-area-inset-bottom))] text-ink",
      )}
    >
      {/* Le masque remonte au document : canevas, rebond iOS, ascenseur
          et contrôles natifs — voir `FeuilleDuMasque`. */}
      {!embedded && <FeuilleDuMasque brand={catalog.restaurant.brand} />}
      <p
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-dialog-allow
      >
        {annonceLue}
      </p>

      {!embedded && <EnTeteFidelite
        nom={catalog.restaurant.name}
        programme={catalog.program.name}
        logoUrl={logoMarque}
        verrouUrl={verrouMarque}
        aside={
          horsLigne ? (
            <Pill className="border-prep/30 bg-prep/10 text-prept">Hors ligne</Pill>
          ) : null
        }
      />}

      {/* 1080 px et non 720 : sur un ordinateur, la page s'arrêtait aux deux
          tiers de l'écran et la colonne unique laissait deux tiers de vide.
          La largeur est celle de la vitrine du même restaurant — les deux
          surfaces se répondent. */}
      <Content className={embedded ? "pb-8" : "mx-auto w-full max-w-[1080px] px-4 pt-6"}>
        {unavailableService && <CustomerServiceNotice service={unavailableService} disabled={navigationLocked} />}
        <div id={embedded ? undefined : panelId} role={embedded ? undefined : "tabpanel"} aria-label={embedded ? undefined : activeView === "account" ? "Compte" : "Fidélité"} tabIndex={embedded ? undefined : 0}>
        {!legacyOnly && slug !== 'demo' && <CustomerAccountPage slug={slug} restaurantName={catalog.restaurant.name} mode={catalog.restaurant.brand.mode}
          section={activeView === "account" ? "profile" : "loyalty"} loyaltyHref={loyaltyHref}
          onBack={() => selectTab(activeView === "loyalty" ? "account" : "loyalty")}
          onLoyalty={() => selectTab("loyalty")} onNavigationLockedChange={setAccountLocked} />}
        <details className="mx-auto my-6 w-full max-w-[736px] rounded-panel border border-line2 bg-surface p-4" open={slug === "demo" ? true : undefined} hidden={activeView === "account"}>
          <summary className="cf-press min-h-11 cursor-pointer py-3 font-bold text-ink">Carte remise par le restaurant</summary>
          <p className="mb-5 text-sm leading-6 text-mut">Votre ancienne carte et son solde hors ligne restent accessibles avec son QR. Ils ne sont pas rattachés automatiquement à un compte.</p>
        {erreur && (
          <div className="mb-6 rounded-card border border-alert/35 bg-alert/10 p-4">
            <p className="text-sm leading-6 text-alertt" role="alert">
              {erreur}
            </p>
            {!carte && !instantaneLocal && (
              <Btn variant="ghost" className="mt-3" disabled={suppressionEnCours} onClick={ouvrirScanner}>
                {suppressionEnCours ? "Retrait en cours…" : "Scanner un autre QR"}
              </Btn>
            )}
          </div>
        )}

        {squelette && (
          <div aria-live="polite">
            <SqueletteCarte />
            <p className="sr-only">Chargement de votre carte fidélité</p>
          </div>
        )}

        {!squelette && !carte && !instantaneLocal && (
          <EtatSansCarte
            catalog={catalog}
            cheminVitrine={cheminVitrine}
            scannerDesactive={suppressionEnCours}
            onScanner={ouvrirScanner}
          />
        )}

        {!carte && instantaneLocal && (
          <CarteLocaleHorsLigne
            catalog={catalog}
            instantane={instantaneLocal}
            cheminVitrine={cheminVitrine}
            actualisationEchouee={echecActualisationLocale}
            occupe={occupe}
            onActualiser={() => void actualiser()}
            onRetirer={() => setRetraitOuvert(true)}
          />
        )}

        {carte && (
          /*
           * DEUX COLONNES DÈS 1 024 px — et la carte de solde reste à l'œil.
           *
           * Sur un ordinateur, tout était bridé à 720 px centrés : le solde
           * partait vers le haut dès qu'on descendait lire les récompenses, et
           * la page mourait au tiers de l'écran. La carte est `sticky` dans sa
           * colonne : le chiffre et « Commander » restent visibles pendant
           * qu'on parcourt le catalogue, ce qui est exactement l'ordre dans
           * lequel on décide de commander.
           */
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-8">
            <div className="lg:sticky lg:top-24">
              <SoldeCarte
                alias={carte.member.alias}
                soldeAffiche={soldeAffiche}
                soldeReel={soldeReel}
                uniteSingulier={uniteSinguliere}
                unitePluriel={unitePlurielle}
                palier={palier}
                progression={progression}
                phrase={phraseDeProgression(
                  soldeReel,
                  palier,
                  uniteSinguliere,
                  unitePlurielle,
                )}
                fete={enFete}
                titreRef={titreRef}
                action={
                  cheminVitrine ? <ActionCommander
                    href={cheminVitrine}
                    nomRestaurant={catalog.restaurant.name}
                  /> : null
                }
                secondaire={
                  <Btn block variant="ghost" icon="grid" onClick={() => setQrOuvert(true)}>
                    Présenter ma carte
                  </Btn>
                }
                pied={
                  <PiedDeCarte
                    vuA={vuA}
                    horsLigne={horsLigne}
                    occupe={occupe}
                    onActualiser={() => void actualiser()}
                    onRetirer={() => setRetraitOuvert(true)}
                  />
                }
              />
            </div>

            <div>
              <section>
                <TitreSection
                  sur="Catalogue informatif"
                  note="Pendant le pilote, votre QR sert à rattacher vos achats. Aucun point n’est encore débité pour une récompense."
                >
                  Vos récompenses
                </TitreSection>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  {carte.rewards.map((recompense) => (
                    <TuileRecompense
                      key={recompense.id}
                      nom={recompense.name}
                      detail={recompense.description || benefit(recompense)}
                      cout={recompense.costUnits}
                      uniteSingulier={uniteSinguliere}
                      unitePluriel={unitePlurielle}
                      acquise={recompense.affordable}
                      fete={idsEnFete.includes(recompense.id)}
                    />
                  ))}
                </div>
              </section>

              {carte.activity.length > 0 && (
                <section className="mt-10">
                  <TitreSection sur="Traçabilité">Activité récente</TitreSection>
                  <Card className="overflow-hidden p-0 shadow-card">
                    <ol className="divide-y divide-line2">
                      {carte.activity.map((entree, index) => (
                        <li
                          key={`${entree.recordedAt}-${index}`}
                          className="flex items-center gap-3 px-4 py-3.5"
                        >
                          {/* Même gabarit de 40 px que les tuiles de
                              récompense : trois listes voisines portaient
                              trois tailles (40, 44, 36) sans qu'aucune ne soit
                              cliquable. */}
                          <span
                            className={cx(
                              "grid size-10 shrink-0 place-items-center rounded-card",
                              entree.deltaUnits > 0
                                ? "bg-ok/10 text-okt"
                                : "bg-alert/10 text-alertt",
                            )}
                          >
                            <Icon
                              name={
                                entree.kind === "redeem"
                                  ? "gift"
                                  : entree.deltaUnits > 0
                                    ? "plus"
                                    : "minus"
                              }
                              size={16}
                            />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-bold text-ink">
                              {entree.label}
                            </p>
                            <p className="mt-1 text-[11px] text-mut">
                              {timeAgo(entree.recordedAt)} · solde{" "}
                              {chiffre(entree.balanceAfter)}
                            </p>
                          </div>
                          <p
                            className={cx(
                              "cf-fig text-sm font-black",
                              entree.deltaUnits > 0 ? "text-okt" : "text-alertt",
                            )}
                          >
                            {entree.deltaUnits > 0 ? "+" : ""}
                            {chiffre(entree.deltaUnits)}
                          </p>
                        </li>
                      ))}
                    </ol>
                  </Card>
                </section>
              )}

              {invitation !== "aucune" && (
                <InviteInstallation
                  mode={invitation}
                  nom={catalog.restaurant.name}
                  onInstaller={() => void installer()}
                  onEcarter={() => setInstallEcartee(true)}
                />
              )}

              <section className="mt-10 rounded-card border border-ink/8 bg-ink/[0.025] p-4">
                <h2 className="font-display text-sm font-extrabold text-ink">
                  Conditions du programme
                </h2>
                <p className="mt-3 text-xs leading-5 text-mut">
                  {carte.program.termsSummary ||
                    "Renseignez-vous auprès du restaurant pour connaître les conditions applicables."}
                </p>
                <p className="mt-3 text-[11px] leading-5 text-mut">
                  Le secret de votre QR est conservé dans un cookie sécurisé,
                  inaccessible au JavaScript et limité à cette carte. Une copie de
                  votre solde reste sur cet appareil pour l’afficher hors ligne.
                  « Retirer » efface les deux.
                </p>
              </section>
            </div>
          </div>
        )}
        </details>
        </div>
      </Content>

      {/*
        LA SIGNATURE, APRÈS LE CONTENU ET AVANT LES ANNONCES.

        Elle est en pied parce que c'est là qu'une signature se lit : vue par
        quelqu'un qui est déjà chez le restaurateur, une fois son solde
        consulté. Le laiton reste le nôtre — une marque qui change de couleur
        selon le client n'est plus une marque — mais il est ajusté jusqu'au
        seuil AA contre le fond de CE restaurant.
      */}
      {!embedded && <><SignatureSnackManager brand={catalog.restaurant.brand} /><SMTabBarSpacer />
      <OrderTabBar slug={slug} activeKey={activeView} panelId={panelId} theme={catalog.restaurant.brand.mode}
        orderingAvailable={orderingAvailable} disabled={navigationLocked} onSelect={!orderingAvailable ? selectTab : undefined}
        loyaltyHref={`${loyaltyHref}${slug === "demo" ? "?demo=1" : ""}`} demo={slug === "demo"} /></>}

      {/*
        L'ANNONCE VISIBLE — dans le masque, jamais à côté.

        Elle est rendue à l'intérieur de la racine qui porte `style={masque}` :
        posée en dehors, une pastille `fixed` lirait les variables de la marque
        grise de Snack Manager et s'afficherait aux couleurs de l'éditeur au
        milieu de l'application d'un restaurant.

        `role="status"` et non `alert` : ce n'est pas une erreur, et un
        lecteur d'écran ne doit pas interrompre sa lecture pour un « +6 ».
      */}
      {annonce && annonceVisible && (
        <div
          className="pointer-events-none fixed inset-x-0 bottom-0 z-[70] flex justify-center px-4 pb-[max(16px,env(safe-area-inset-bottom))]"
          role="status"
          aria-live="polite"
        >
          <p className="animate-pop rounded-pill border border-accent/25 bg-surface px-5 py-3 text-sm font-extrabold text-ink shadow-soft motion-reduce:animate-none">
            {annonce.texte}
          </p>
        </div>
      )}

      {scannerOuvert && (
        <LoyaltyScanner
          expectedSlug={slug}
          onClose={() => setScannerOuvert(false)}
          onToken={surJeton}
        />
      )}

      <Modal
        open={qrOuvert}
        onClose={() => setQrOuvert(false)}
        title="Ma carte fidélité"
        width={390}
        footer={<Btn block onClick={() => setQrOuvert(false)}>Terminer</Btn>}
      >
        <VueQr slug={slug} alias={carte?.member.alias ?? null} />
      </Modal>

      <Modal
        open={retraitOuvert}
        onClose={() => {
          if (!suppressionRef.current) setRetraitOuvert(false);
        }}
        title="Retirer la carte de cet appareil ?"
        destructive
        footer={
          <>
            <Btn variant="ghost" disabled={suppressionEnCours} onClick={() => setRetraitOuvert(false)}>
              Annuler
            </Btn>
            {/* `variant="danger"` et non un `className` qui repeint un ghost :
                deux utilitaires de même propriété ont la même spécificité, et
                c'est l'ordre de la FEUILLE compilée qui tranche — pas l'ordre
                d'écriture. Le variant porte déjà le couple `alert`/`on-alert`
                dont `contraste()` prouve l'AA sur les six directions. */}
            <Btn variant="danger" disabled={suppressionEnCours} onClick={() => void retirer()}>
              {suppressionEnCours ? "Retrait…" : "Retirer la carte"}
            </Btn>
          </>
        }
      >
        <p className="leading-6 text-mut">
          Votre solde reste intact chez le restaurant. Le solde gardé sur cet
          appareil pour l’affichage hors ligne est effacé, et il faudra rescanner
          le QR pour afficher la carte ici.
        </p>
      </Modal>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Repli local minimal : un solde daté, jamais une fausse carte membre
// ─────────────────────────────────────────────────────────────

function CarteLocaleHorsLigne({
  catalog,
  instantane,
  cheminVitrine,
  actualisationEchouee,
  occupe,
  onActualiser,
  onRetirer,
}: {
  catalog: LoyaltyPublicProgram;
  instantane: InstantaneCarte;
  cheminVitrine: string | null;
  actualisationEchouee: boolean;
  occupe: boolean;
  onActualiser: () => void;
  onRetirer: () => void;
}) {
  const age = fraicheur(instantane.vuA);
  const unite = unitePour(
    instantane.solde,
    catalog.program.unitLabelSingular,
    catalog.program.unitLabelPlural,
  );

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-8">
      <section className="relative overflow-hidden rounded-wide border border-prep/30 bg-surface p-5 shadow-card sm:p-7">
        <Pill className="border-prep/30 bg-prep/10 text-prept">
          Solde enregistré hors ligne
        </Pill>
        <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.09em] text-mut">
          Dernier solde connu
        </p>
        <h1 className="cf-fig mt-2 text-[clamp(2.75rem,2.3rem+1.8vw,3.5rem)] font-black leading-none tracking-[-0.055em] text-ink">
          <span className="sr-only">Dernier solde connu : </span>
          {chiffre(instantane.solde)}{" "}
          <span className="text-xl tracking-normal text-mut">{unite}</span>
        </h1>
        <p className="mt-4 text-xs leading-5 text-prept" role="status">
          Source : copie locale · solde vu {age} · {actualisationEchouee
            ? "échec du rafraîchissement"
            : "vérification en cours"}
        </p>
        <p className="mt-3 text-xs leading-5 text-mut">
          L’identité, l’historique et l’avancement des récompenses ne sont pas
          conservés sur cet appareil. Ils réapparaîtront après vérification du réseau.
        </p>
        <div className="mt-6 grid gap-2">
          {cheminVitrine && <ActionCommander
            href={cheminVitrine}
            nomRestaurant={catalog.restaurant.name}
          />}
          <div className="flex flex-wrap gap-2">
            <Btn variant="ghost" disabled={occupe} onClick={onActualiser}>
              {occupe ? "Actualisation…" : "Actualiser"}
            </Btn>
            <Btn variant="ghost" onClick={onRetirer}>Retirer</Btn>
          </div>
        </div>
      </section>

      <section>
        <TitreSection
          sur="Catalogue public actuel"
          note="Ces récompenses viennent du catalogue public de cette page. Leur état acquis n’est pas déduit du solde enregistré."
        >
          Vos récompenses
        </TitreSection>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          {catalog.rewards.map((recompense) => (
            <TuileRecompense
              key={recompense.id}
              nom={recompense.name}
              detail={recompense.description || benefit(recompense)}
              cout={recompense.costUnits}
              uniteSingulier={catalog.program.unitLabelSingular}
              unitePluriel={catalog.program.unitLabelPlural}
              acquise={false}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Pied de la carte : fraîcheur et entretien
// ─────────────────────────────────────────────────────────────

/**
 * LA FRAÎCHEUR EST UNE PHRASE, PAS UNE HEURE.
 *
 * « Actualisée à 14 h 32 » s'affichait même quand la valeur venait d'un cache,
 * et ne disait jamais si elle datait de dix secondes ou de trois jours. Hors
 * ligne, la mention est explicite : c'est la seule chose qui distingue une
 * application honnête d'une application qui ment sur un solde.
 */
function PiedDeCarte({
  vuA,
  horsLigne,
  occupe,
  onActualiser,
  onRetirer,
}: {
  vuA: string | null;
  horsLigne: boolean;
  occupe: boolean;
  onActualiser: () => void;
  onRetirer: () => void;
}) {
  const age = vuA ? fraicheur(vuA) : null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className={cx("text-[11px] leading-4", horsLigne ? "text-prept" : "text-mut")}>
        {horsLigne
          ? `Hors ligne · solde vu ${age ?? "récemment"}`
          : age
            ? `Solde vérifié ${age}`
            : "Solde vérifié à l’instant"}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onActualiser}
          disabled={occupe}
          aria-busy={occupe}
          className="cf-press min-h-11 rounded-pill px-3 py-2 text-xs font-bold text-accentink disabled:opacity-50"
        >
          {occupe ? "Actualisation…" : "Actualiser"}
        </button>
        <button
          type="button"
          onClick={onRetirer}
          className="cf-press min-h-11 rounded-pill px-3 py-2 text-xs font-bold text-mut hover:text-ink"
        >
          Retirer
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Sans carte : la promesse, le scan, et la porte vers la vitrine
// ─────────────────────────────────────────────────────────────

function EtatSansCarte({
  catalog,
  cheminVitrine,
  scannerDesactive,
  onScanner,
}: {
  catalog: LoyaltyPublicProgram;
  cheminVitrine: string | null;
  scannerDesactive: boolean;
  onScanner: () => void;
}) {
  const unitePlurielle = catalog.program.unitLabelPlural;
  const uniteSinguliere = catalog.program.unitLabelSingular;
  return (
    <>
      <section className="relative overflow-hidden rounded-wide border border-accent/20 bg-surface p-5 shadow-card sm:p-7">
        <div className="relative">
          <Pill className="border-accent/30 bg-accentwash text-accentink">
            Carte digitale · gratuite
          </Pill>
          <h1 className="font-display mt-3 max-w-[560px] text-[clamp(1.875rem,1.4rem+2vw,2.5rem)] font-black leading-[1.05] tracking-[-0.05em] text-ink">
            Vos avantages {catalog.restaurant.name}, toujours à portée de main.
          </h1>
          <p className="mt-3 max-w-[520px] text-sm leading-6 text-mut">
            Scannez le QR remis par le restaurant pour afficher cette carte. Son accès reste utilisable sans créer de compte.
          </p>
          {/* Pas de `size="sm"` sur une surface CLIENT : 34 px de haut, sous la
              cible de 44 px (WCAG 2.2 · 2.5.8). La taille `sm` reste celle des
              barres d'outils denses de l'admin, à la souris. */}
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Btn variant={catalog.restaurant.slug === "demo" ? "primary" : "ghost"} icon="grid" disabled={scannerDesactive} onClick={onScanner}>
              {scannerDesactive ? "Retrait en cours…" : "Scanner mon QR"}
            </Btn>
            {/* Le lien vers la vitrine existe AUSSI sans carte : quelqu'un qui
                découvre le programme doit pouvoir aller commander, c'est même
                le seul moyen de gagner ses premiers points. */}
            {cheminVitrine && <Link
              href={cheminVitrine}
              className="cf-press inline-flex min-h-11 items-center justify-center gap-2 rounded-pill border border-ink/12 px-5 text-sm font-bold text-ink hover:bg-ink/5"
            >
              Voir le menu du restaurant
              <Icon name="arrow" size={16} stroke={2.4} />
            </Link>}
          </div>
        </div>
      </section>

      <section className="mt-10">
        <TitreSection sur="À débloquer">Les récompenses du moment</TitreSection>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {catalog.rewards.map((recompense) => (
            <TuileRecompense
              key={recompense.id}
              nom={recompense.name}
              detail={benefit(recompense)}
              cout={recompense.costUnits}
              uniteSingulier={uniteSinguliere}
              unitePluriel={unitePlurielle}
              acquise={false}
            />
          ))}
        </div>
      </section>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Installation
// ─────────────────────────────────────────────────────────────

/**
 * L'INVITATION A QUITTÉ L'EN-TÊTE.
 *
 * Elle y était un bouton de 12 px, coincé entre le nom du restaurant et le
 * bord de l'écran, et n'apparaissait jamais sur iOS. Elle est devenue une
 * carte, en bas de page — après le solde, après les récompenses, à l'endroit
 * où quelqu'un qui a tout lu se demande comment revenir. Sur iOS, faute
 * d'API, on décrit le geste : c'est la seule chose que Safari laisse faire, et
 * c'est infiniment mieux que rien.
 */
function InviteInstallation({
  mode,
  nom,
  onInstaller,
  onEcarter,
}: {
  mode: "invite" | "ios";
  nom: string;
  onInstaller: () => void;
  onEcarter: () => void;
}) {
  return (
    <Card className="mt-10 border-accent/20 p-5 shadow-card">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-card bg-accentwash text-accentink">
          <Icon name="home" size={19} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-sm font-extrabold text-ink">
            Gardez {nom} sur votre écran d’accueil
          </h2>
          {mode === "invite" ? (
            <>
              <p className="mt-2 text-xs leading-5 text-mut">
                Votre carte s’ouvre alors en un geste, et votre solde reste
                consultable même sans réseau.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Btn onClick={onInstaller}>Installer la carte</Btn>
                <button
                  type="button"
                  onClick={onEcarter}
                  className="cf-press min-h-11 rounded-pill px-4 text-xs font-bold text-mut hover:text-ink"
                >
                  Pas maintenant
                </button>
              </div>
            </>
          ) : (
            <>
              {/*
                iOS n'expose AUCUNE API d'installation : `beforeinstallprompt`
                n'y existe pas, et aucun bouton ne peut déclencher l'ajout. Le
                seul chemin est le menu Partager de Safari — on le décrit donc,
                étape par étape, plutôt que de ne rien proposer du tout à la
                moitié du parc.
              */}
              <ol className="mt-2 space-y-2 text-xs leading-5 text-mut">
                <li>
                  1. Touchez <span className="font-bold text-ink">Partager</span> dans
                  la barre de Safari.
                </li>
                <li>
                  2. Choisissez{" "}
                  <span className="font-bold text-ink">Sur l’écran d’accueil</span>.
                </li>
                <li>3. Votre carte s’ouvrira comme une application.</li>
              </ol>
              <button
                type="button"
                onClick={onEcarter}
                className="cf-press mt-4 min-h-11 rounded-pill px-4 text-xs font-bold text-mut hover:text-ink"
              >
                Masquer ces instructions
              </button>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────
// Le QR
// ─────────────────────────────────────────────────────────────

type EtatQr =
  | { phase: "chargement" }
  | { phase: "pret"; url: string }
  | { phase: "echec"; message: string };

/**
 * LE QR A ENFIN UN ÉTAT DE CHARGEMENT ET UN ÉTAT D'ÉCHEC.
 *
 * La modale posait une balise `<img>` sur la route et s'en remettait au
 * navigateur : la route peut répondre 404 (carte révoquée), 429 (quota) ou 503
 * (vérification indisponible), et le client voyait alors l'icône d'image
 * cassée dans un cadre blanc — au comptoir, devant quelqu'un qui attend.
 *
 * ═══ POURQUOI `fetch` PLUTÔT QUE `<img src>` ═══
 *
 * Une balise `<img>` ne rend pas le STATUT : son `onError` dit « ça a raté »
 * et rien d'autre. Or les trois échecs demandent trois conduites différentes —
 * redemander un QR, patienter, réessayer. La réponse est donc lue, puis
 * affichée via une URL d'objet ; elle est révoquée à la fermeture, sinon la
 * mémoire du blob survivrait à la modale.
 */
function VueQr({ slug, alias }: { slug: string; alias: string | null }) {
  const [etat, setEtat] = useState<EtatQr>({ phase: "chargement" });
  const [essai, setEssai] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let urlObjet: string | null = null;
    void (async () => {
      try {
        const reponse = await fetch(
          `/r/${encodeURIComponent(slug)}/fidelite/card-qr`,
          { cache: "no-store", credentials: "same-origin", signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        if (!reponse.ok) {
          setEtat({ phase: "echec", message: messageDEchecQr(reponse.status) });
          return;
        }
        const image = await reponse.blob();
        if (controller.signal.aborted) return;
        urlObjet = URL.createObjectURL(image);
        setEtat({ phase: "pret", url: urlObjet });
      } catch {
        if (controller.signal.aborted) return;
        setEtat({ phase: "echec", message: messageDEchecQr(null) });
      }
    })();
    return () => {
      controller.abort();
      if (urlObjet) URL.revokeObjectURL(urlObjet);
    };
  }, [slug, essai]);

  return (
    <div className="text-center">
      {/*
        LE CADRE BLANC N'APPARAÎT QUE QUAND IL Y A UN QR À CADRER.

        `.sm-qr-frame` est l'une des deux seules surfaces BLANCHES fixes du
        produit (globals.css) : elle existe pour la zone de silence que lit une
        caméra, pas pour l'œil. Y poser un message d'attente ou d'erreur
        obligerait à choisir une encre en dur, puisque `--cf-text` suit le mode
        du restaurant et vire au clair sur quatre directions sur six — du texte
        blanc sur blanc. Les deux autres états sont donc rendus sur une surface
        NORMALE du masque, à la même taille : la modale ne change pas de
        hauteur d'un état à l'autre.
      */}
      {etat.phase === "pret" ? (
        <div className="sm-qr-frame mx-auto aspect-square w-full max-w-[320px] rounded-wide p-3 shadow-soft">
          {/* eslint-disable-next-line @next/next/no-img-element -- image privée dynamique, servie no-store depuis un blob. */}
          <img
            src={etat.url}
            alt={`QR de la carte fidélité de ${alias ?? "ce client"}`}
            className="size-full"
          />
        </div>
      ) : (
        <div className="mx-auto grid aspect-square w-full max-w-[320px] place-items-center rounded-wide border border-ink/10 bg-surface2 p-6 shadow-card">
          {etat.phase === "chargement" ? (
            <span className="animate-battement text-[11px] font-bold uppercase tracking-[0.09em] text-mut motion-reduce:animate-none">
              Génération du QR…
            </span>
          ) : (
            <span className="text-xs leading-5 text-alertt" role="alert">
              {etat.message}
            </span>
          )}
        </div>
      )}
      {etat.phase === "echec" ? (
        <Btn className="mt-4" variant="ghost" onClick={() => setEssai((n) => n + 1)}>
          Réessayer
        </Btn>
      ) : (
        <>
          <p className="mt-4 text-sm font-extrabold text-ink">
            Présentez ce QR à la caisse
          </p>
          <p className="mt-2 text-xs leading-5 text-mut">
            Le personnel voit uniquement votre carte et votre solde. Le QR n’est ni
            placé dans l’adresse ni mis en cache.
          </p>
        </>
      )}
    </div>
  );
}
