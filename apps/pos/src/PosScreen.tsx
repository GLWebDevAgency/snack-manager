/**
 * Écran principal de la caisse (V1) et orchestration des surcouches.
 *
 * Invariants tenus ici :
 *  - toute création de commande passe par `client.post` → file offline
 *    persistée, avec `clientId` comme clé d'idempotence : un rejeu ne crée
 *    jamais de doublon et une coupure réseau ne perd aucune commande ;
 *  - l'écran confirme IMMÉDIATEMENT avec un numéro de retrait local, remplacé
 *    par le numéro serveur dès que la file est vidée (réconciliation) ;
 *  - les montants sont en CENTIMES partout, jamais en flottants.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import type { OrderLoyaltyEarnStatus } from '@sm/contracts';
import {
  POLL_POS_MS,
  SmApiError,
  cartTotal,
  creerDebounce,
  euros,
  fraicheur,
  normalizeOrdersWindow,
  pollCadenceMs,
  sameConfiguration,
  useTenantSocket,
  uuid,
  useAutoSync,
  useMenu,
  useNow,
  useOncePerId,
  useSyncState,
  windowCountLabel,
  type CartLine,
  type Product,
} from '@sm/client-core';
import { API_URL } from './config';
import { DEMO, KEYS, client, TENANT_SLUG, type Session } from './client';
import { S, makeBrand, palette } from './theme';
import { Btn, Drawer, Loading, useToasts } from './ui';
import { useLayout } from './useLayout';
import { siteConfigure } from './demo-retour';
import { TopBar, type Vue } from './TopBar';
import { ServicePanel } from './ServicePanel';
import {
  commandesEnCours,
  fusionnerFenetre,
  type ServerOrderRow,
} from './service-state';
import { CategoryRail, ProductArea } from './Catalog';
import { TicketDock, TicketPanel } from './TicketPanel';
import { QuickConfig, draftToLine, type ConfigDraft } from './QuickConfig';
import { CashModal, CloseModal, DiscountModal, Notice, SentOverlay, TicketPreview, type OrderTicketDto, RejetsModal } from './modals';
import { LoyaltyPanel } from './LoyaltyPanel';
import {
  rejectedOrderIds,
  type LoyaltyEarnState,
  type LoyaltyTicketMember,
} from './loyalty-state';
import {
  pendingLoyaltyCount,
  serviceCloseBlockReason,
  serviceCloseStatus,
  type SaleInFlightGate,
} from './pos-safety';
import {
  buildOrderBody,
  commitQueuedSaleJournal,
  customerFieldsForMode,
  loadJson,
  minimizeDayEntry,
  minimizeParkedTicket,
  parkCode,
  pickupSlots,
  saveJson,
  serviceDay,
  startOfDayIso,
  zFromJournal,
  zFromServer,
  type DayEntry,
  type Mode,
  type ParkedTicket,
  type PayMethod,
} from './pos-state';

interface DayLogFile {
  day: string;
  entries: DayEntry[];
}

interface ServiceStartFile {
  day: string;
  /** Horodatage ms de l'ouverture du service courant. */
  at: number;
}

/** Minuit local — borne par défaut du premier service de la journée. */
function startOfDay(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Fenêtre serveur du jour — la SEULE lecture du poste qui voie aussi la vente
 * en ligne, et qui sert à quatre choses à la fois : réconciliation (numéro, id,
 * jeton de suivi), séquence des numéros de retrait, ventilation du Z, et
 * désormais la vue du service.
 *
 * `total` et `truncated` ne sont plus jetés : au-delà de 200 commandes dans la
 * journée, le serveur ne renvoie que les plus récentes et le DIT (voir
 * `normalizeOrdersWindow`). La forme de la ligne, elle, vit dans
 * `service-state.ts`, qui est pur et donc testable.
 */
interface FenetreServeur {
  rows: ServerOrderRow[];
  total: number;
  truncated: boolean;
  /** Horodatage de la lecture RÉUSSIE — l'horloge de fraîcheur de l'écran. */
  at: number;
}

export function PosScreen({
  session,
  onLock,
  saleInFlight,
}: {
  session: Session;
  onLock: (reason?: string) => void;
  saleInFlight: SaleInFlightGate;
}) {
  const brand = useMemo(
    () => makeBrand(session.tenantName, session.brandColor),
    [session.brandColor, session.tenantName],
  );

  /**
   * Toutes les dimensions du poste descendent d'ici : rail, ticket, colonnes,
   * échelle typographique et bascule compacte. Aucun écran ne décide seul.
   */
  const layout = useLayout();

  const { menu, error: menuError, offline, reload } = useMenu(client, TENANT_SLUG);
  const sync = useSyncState(client);
  useAutoSync(client);
  const now = useNow(1000);
  const { push, host } = useToasts();

  // ─── Ticket en cours ───
  const [mode, setMode] = useState<Mode>('surplace');
  const [lines, setLines] = useState<CartLine[]>([]);
  const [note, setNote] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [slotIso, setSlotIso] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [catId, setCatId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mutateTicket = useCallback(
    (action: () => void) => saleInFlight.runWhenIdle(action),
    [saleInFlight],
  );
  /** Mode compact seulement : tiroir du ticket ouvert. */
  const [ticketOpen, setTicketOpen] = useState(false);
  /**
   * VENDRE, OU REGARDER LE SERVICE.
   *
   * Le poste s'ouvre toujours sur la vente : c'est son métier, et une caisse
   * qui démarre sur un écran de consultation coûte un geste à chaque service.
   */
  const [vue, setVue] = useState<Vue>('vente');

  // ─── Surcouches ───
  const [config, setConfig] = useState<{ product: Product; categoryName: string; initial?: ConfigDraft } | null>(null);
  const [cashOpen, setCashOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  /**
   * Les ventes que le serveur a refusées définitivement.
   *
   * Elles étaient retirées de la file et JETÉES : sur une commande déjà
   * encaissée, l'argent est dans le tiroir, le client est parti, et la vente
   * n'existe nulle part. Rien à l'écran ne le disait.
   */
  const [rejetsOpen, setRejetsOpen] = useState(false);
  const [sentClientId, setSentClientId] = useState<string | null>(null);
  const [ticketFor, setTicketFor] = useState<DayEntry | null>(null);
  const [discountFor, setDiscountFor] = useState<DayEntry | null>(null);
  const [loyaltyOpen, setLoyaltyOpen] = useState(false);
  /** Profil de présentation en mémoire uniquement — jamais sérialisé. */
  const [loyaltyMember, setLoyaltyMember] = useState<LoyaltyTicketMember | null>(null);

  // ─── Journal du service + tickets en attente ───
  const [dayLog, setDayLog] = useState<DayEntry[]>([]);
  const [parked, setParked] = useState<ParkedTicket[]>([]);
  const [ready, setReady] = useState(false);
  /**
   * Début du service courant (ms). Une clôture à 15 h ne doit pas faire
   * ressortir le midi dans le Z du soir : c'est cette borne, et non minuit,
   * qui découpe les commandes serveur.
   */
  const [serviceStart, setServiceStart] = useState(() => startOfDay());
  /**
   * Dernière fenêtre serveur des commandes du jour — base du Z (vente en ligne
   * comprise) ET de la vue du service.
   *
   * EN MÉMOIRE SEULEMENT, jamais en cache disque. C'est la doctrine du KDS,
   * reprise telle quelle : « volontairement SANS cache de repli — on veut que
   * la panne réseau remonte comme une panne, pas comme une réponse fraîche mais
   * périmée ». Un poste qui redémarre hors ligne montre donc une vue vide et le
   * dit, plutôt que de ressortir le service d'hier avec un minuteur qui repart.
   * Tant qu'il tourne, il garde sa dernière photo — DATÉE par `at`, ce qui est
   * exactement la différence entre montrer et prétendre.
   */
  const [fenetre, setFenetre] = useState<FenetreServeur | null>(null);
  const dayLogRef = useRef<DayEntry[]>([]);
  /** Verrou synchrone : aucune vente ne peut démarrer pendant une clôture. */
  const serviceCloseGate = useRef(false);
  useEffect(() => {
    dayLogRef.current = dayLog;
  }, [dayLog]);

  // Restauration locale (le poste redémarre sans rien perdre).
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [log, park, start] = await Promise.all([
        loadJson<DayLogFile>(client.tenantStore, KEYS.dayLog, {
          day: serviceDay(),
          entries: [],
        }),
        loadJson<ParkedTicket[]>(client.tenantStore, KEYS.parked, []),
        loadJson<ServiceStartFile>(client.tenantStore, KEYS.serviceStart, {
          day: serviceDay(),
          at: startOfDay(),
        }),
      ]);
      if (!alive) return;
      const sameDay = log.day === serviceDay();
      setDayLog(sameDay ? log.entries.map(minimizeDayEntry) : []);
      setParked(park.map(minimizeParkedTicket));
      // Un service jamais clôturé la veille repart de minuit, pas de son heure.
      setServiceStart(start.day === serviceDay() ? start.at : startOfDay());
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (ready) {
      void saveJson(client.tenantStore, KEYS.dayLog, {
        day: serviceDay(),
        entries: dayLog,
      } satisfies DayLogFile);
    }
  }, [dayLog, ready]);

  useEffect(() => {
    if (ready) void saveJson(client.tenantStore, KEYS.parked, parked);
  }, [parked, ready]);

  useEffect(() => {
    if (ready) {
      void saveJson(client.tenantStore, KEYS.serviceStart, {
        day: serviceDay(),
        at: serviceStart,
      } satisfies ServiceStartFile);
    }
  }, [ready, serviceStart]);

  useEffect(() => {
    if (menu && catId === null && menu.categories.length > 0) setCatId(menu.categories[0]?._id ?? null);
  }, [catId, menu]);

  // Le poste repasse en large (rotation, écran branché, fenêtre agrandie) :
  // le ticket redevient une colonne ancrée, le tiroir n'a plus lieu d'être.
  useEffect(() => {
    if (!layout.compact) setTicketOpen(false);
  }, [layout.compact]);

  // ─── Réconciliation : numéro et identifiant serveur ───
  /**
   * Dernier numéro de retrait connu du serveur (tous canaux confondus, la
   * séquence est journalière et partagée avec la commande en ligne). Il sert à
   * proposer un numéro provisoire crédible avant confirmation.
   */
  const [serverMax, setServerMax] = useState(0);

  const loyaltyStatusInFlight = useRef(new Set<string>());
  const reconcileLoyaltyStatuses = useCallback(
    async (entries: readonly DayEntry[]) => {
      const candidates = entries.filter(
        (entry) =>
          entry.loyalty &&
          entry.loyalty.state !== 'credited' &&
          entry.loyalty.state !== 'failed' &&
          !loyaltyStatusInFlight.current.has(entry.clientId),
      );
      if (candidates.length === 0) return;

      const updates = await Promise.all(
        candidates.map(async (entry) => {
          loyaltyStatusInFlight.current.add(entry.clientId);
          try {
            const status = await client.get<OrderLoyaltyEarnStatus>(
              `/orders/by-client/${encodeURIComponent(entry.clientId)}/loyalty`,
            );
            const state: LoyaltyEarnState =
              status.state === 'completed'
                ? 'credited'
                : status.state === 'failed' ||
                    status.state === 'cancelled' ||
                    status.state === 'none'
                  ? 'failed'
                  : 'queued';
            return { clientId: entry.clientId, state };
          } catch (error) {
            if (error instanceof SmApiError && error.status === 401) {
              onLock('Session expirée — reconnectez-vous.');
            }
            // 404 = la commande attend encore dans la file locale. Toute
            // autre panne garde aussi l'état prudent jusqu'au prochain tour.
            return null;
          } finally {
            loyaltyStatusInFlight.current.delete(entry.clientId);
          }
        }),
      );
      const byClient = new Map(
        updates
          .filter((update): update is NonNullable<typeof update> => update !== null)
          .map((update) => [update.clientId, update.state]),
      );
      if (byClient.size === 0) return;
      setDayLog((current) =>
        current.map((entry) => {
          const state = byClient.get(entry.clientId);
          return state && entry.loyalty
            ? { ...entry, loyalty: { ...entry.loyalty, state } }
            : entry;
        }),
      );
    },
    [onLock],
  );

  const reconcile = useCallback(
    async (force = false) => {
      if (!force && !dayLogRef.current.some((e) => !e.serverId || e.loyalty)) {
        return;
      }
      try {
        const todaySince = startOfDayIso();
        // Le serveur annonce `total` et `truncated` en plus des lignes, et
        // c'est intentionnel de sa part : « pour que l'écran refuse de conclure
        // plutôt que de conclure faux ». Le poste les typait hors de la réponse
        // et les jetait — d'où un Z amputé en silence au-delà de 200 commandes.
        const vueServeur = normalizeOrdersWindow<ServerOrderRow>(
          await client.get(`/orders?since=${encodeURIComponent(todaySince)}`),
        );
        const byClient = new Map(vueServeur.rows.map((r) => [r.clientId, r]));
        setServerMax(vueServeur.rows.reduce((max, r) => Math.max(max, r.number ?? 0), 0));
        // Deux déclencheurs de lecture (horloge et socket) : deux réponses
        // peuvent se croiser. Le statut le plus avancé gagne, sinon une réponse
        // en retard ferait reculer une commande sous les yeux du caissier.
        setFenetre((precedente) => ({
          rows: fusionnerFenetre(precedente?.rows ?? [], vueServeur.rows),
          total: vueServeur.total,
          truncated: vueServeur.truncated,
          at: Date.now(),
        }));

        void reconcileLoyaltyStatuses(dayLogRef.current);
        setDayLog((cur) =>
          cur.map((e) => {
            const hit = byClient.get(e.clientId);
            if (!hit) return e;
            // Le jeton de suivi peut manquer sur une entrée déjà réconciliée
            // (poste mis à jour en cours de service) : on le rattrape ici.
            if (e.serverId && e.trackingToken) return e;
            return {
              ...e,
              serverId: String(hit._id),
              serverNumber: hit.number,
              trackingToken: hit.trackingToken ?? e.trackingToken ?? null,
            };
          }),
        );
      } catch (err) {
        if (err instanceof SmApiError && err.status === 401) onLock('Session expirée — reconnectez-vous.');
      }
    },
    [onLock, reconcileLoyaltyStatuses],
  );

  // ─── Temps réel : la socket anticipe, le sondage garantit ───

  /**
   * Rafraîchissement demandé par un événement `order.*` du restaurant.
   * Débouncé : une commande génère volontiers une rafale (créée, payée,
   * avancée) et chaque tour coûte un GET plus le rendu de la vue du service.
   */
  const rafale = useMemo(() => creerDebounce(() => void reconcile(true)), [reconcile]);
  useEffect(() => () => rafale.annuler(), [rafale]);

  /**
   * LA SOCKET DE LA CAISSE — la même que celle de la cuisine.
   *
   * La passerelle ne vérifie pas le rôle : elle exige un JWT portant un
   * `tenantId` et joint la room d'après le JETON. Le jeton de session par code
   * en porte un, donc la caisse est acceptée exactement comme le KDS.
   *
   * Note de capacité, assumée : la passerelle est mono-réplique et ne plafonne
   * pas le nombre de sockets. Brancher la caisse ajoute UNE socket PAR POSTE.
   * En contrepartie le sondage passe de 12 s à 60 s dès qu'elle tient.
   *
   * En démonstration il n'y a aucun serveur à écouter — pas de jeton, pas de
   * socket.
   */
  const socket = useTenantSocket({
    url: API_URL,
    token: ready && !DEMO ? session.token : null,
    onEvent: rafale.demander,
  });

  useEffect(() => {
    if (!ready) return;
    // Premier passage forcé : il amorce la séquence de numéros du jour.
    void reconcile(true);
    // TOUJOURS forcé. La sortie anticipée de `reconcile` — « rien du poste
    // n'attend son identifiant serveur » — est juste pour économiser un appel
    // après une salve de caisse, mais elle arrêtait aussi le rafraîchissement
    // périodique : une fois la dernière commande du poste réconciliée, la photo
    // serveur ne bougeait plus. Les commandes EN LIGNE, qui ne passent jamais
    // par le journal local, n'entraient donc plus jamais dans le Z — qui
    // annonce pourtant « vente en ligne comprise ».
    //
    // Le sondage ne disparaît JAMAIS : la socket ne fait qu'en étirer la
    // cadence (12 s → 60 s), et une socket morte sans bruit ramène le poste à
    // son comportement historique, à l'identique.
    const id = setInterval(() => void reconcile(true), pollCadenceMs(socket.connectee, POLL_POS_MS));
    return () => clearInterval(id);
  }, [ready, reconcile, socket.connectee]);

  // Une tablette qui sort de veille a peut-être dormi des heures : on relit
  // tout de suite et on réveille la socket sans attendre son prochain essai.
  const reveillerSocket = socket.reveiller;
  useEffect(() => {
    if (!ready) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void reconcile(true);
      reveillerSocket();
    });
    return () => sub.remove();
  }, [ready, reconcile, reveillerSocket]);

  useEffect(() => {
    if (sync.pending === 0) void reconcile();
  }, [reconcile, sync.pending]);

  const rejectedLoyaltyKey = useMemo(
    () => [...rejectedOrderIds(sync.rejected)].sort().join('|'),
    [sync.rejected],
  );
  useEffect(() => {
    if (!ready || !rejectedLoyaltyKey) return;
    const rejectedLoyaltyOrders = new Set(rejectedLoyaltyKey.split('|'));
    const changed = dayLogRef.current.some(
      (entry) =>
        entry.loyalty &&
        entry.loyalty.state !== 'failed' &&
        rejectedLoyaltyOrders.has(entry.clientId),
    );
    setDayLog((current) => {
      let modified = false;
      const next = current.map((entry) => {
        if (!entry.loyalty || !rejectedLoyaltyOrders.has(entry.clientId)) return entry;
        if (entry.loyalty.state === 'failed') return entry;
        modified = true;
        return {
          ...entry,
          loyalty: { ...entry.loyalty, state: 'failed' as const },
        };
      });
      return modified ? next : current;
    });
    if (changed) push('Fidélité annulée : la vente a été refusée', 'bad');
  }, [push, ready, rejectedLoyaltyKey]);

  // ─── Panier ───
  const addLine = useCallback(
    (line: CartLine) => {
      mutateTicket(() => {
        setLines((cur) => {
          const idx = cur.findIndex((l) => sameConfiguration(l, line));
          if (idx === -1) return [...cur, line];
          const next = [...cur];
          const current = next[idx];
          if (current) next[idx] = { ...current, qty: Math.min(99, current.qty + line.qty) };
          return next;
        });
      });
    },
    [mutateTicket],
  );

  const setQty = useCallback(
    (lineId: string, qty: number) => {
      mutateTicket(() => {
        setLines((cur) =>
          qty <= 0
            ? cur.filter((l) => l.lineId !== lineId)
            : cur.map((l) => (l.lineId === lineId ? { ...l, qty } : l)),
        );
      });
    },
    [mutateTicket],
  );

  const changeNote = useCallback(
    (value: string) => {
      mutateTicket(() => setNote(value));
    },
    [mutateTicket],
  );

  const changeCustomerName = useCallback(
    (value: string) => {
      mutateTicket(() => setCustomerName(value));
    },
    [mutateTicket],
  );

  const changeCustomerPhone = useCallback(
    (value: string) => {
      mutateTicket(() => setCustomerPhone(value));
    },
    [mutateTicket],
  );

  const changeSlot = useCallback(
    (value: string) => {
      mutateTicket(() => setSlotIso(value));
    },
    [mutateTicket],
  );

  const resetTicket = useCallback(() => {
    setLines([]);
    setNote('');
    setCustomerName('');
    setCustomerPhone('');
    setSlotIso(null);
    setLoyaltyMember(null);
  }, []);

  const clearTicket = useCallback(() => {
    mutateTicket(() => {
      resetTicket();
      push('Ticket vidé');
    });
  }, [mutateTicket, push, resetTicket]);

  const attachLoyalty = useCallback(
    (member: LoyaltyTicketMember) => {
      mutateTicket(() => {
        if (mode === 'tel') {
          push('La fidélité sera proposée au comptoir lors du retrait', 'warn');
          return;
        }
        setLoyaltyMember(member);
      });
    },
    [mode, mutateTicket, push],
  );

  const detachLoyalty = useCallback(() => {
    mutateTicket(() => setLoyaltyMember(null));
  }, [mutateTicket]);

  const changeMode = useCallback(
    (next: Mode) => {
      mutateTicket(() => {
        if (next === 'tel' && loyaltyMember) {
          setLoyaltyMember(null);
          setLoyaltyOpen(false);
          push('Carte détachée : fidélité disponible au retrait au comptoir', 'warn');
        }
        if (mode === 'tel' && next !== 'tel') {
          setCustomerName('');
          setCustomerPhone('');
          setSlotIso(null);
        }
        setMode(next);
      });
    },
    [loyaltyMember, mode, mutateTicket, push],
  );

  const closeLoyalty = useCallback(() => setLoyaltyOpen(false), []);
  const openLoyalty = useCallback(() => {
    mutateTicket(() => {
      setTicketOpen(false);
      setLoyaltyOpen(true);
    });
  }, [mutateTicket]);
  const loyaltyUnauthorized = useCallback(
    () => onLock('Session expirée — reconnectez-vous.'),
    [onLock],
  );

  const openEdit = useCallback(
    (line: CartLine) => {
      mutateTicket(() => {
        if (!menu) return;
        for (const cat of menu.categories) {
          const product = cat.products.find((p) => p._id === line.productId);
          if (product) {
            setConfig({
              product,
              categoryName: cat.name,
              initial: {
                lineId: line.lineId,
                variantKey: line.variantKey,
                options: line.options,
                removed: line.removed,
                note: line.note ?? '',
                qty: line.qty,
              },
            });
            return;
          }
        }
        push('Produit introuvable dans le menu courant', 'warn');
      });
    },
    [menu, mutateTicket, push],
  );

  const submitConfig = useCallback(
    (draft: ConfigDraft) => {
      mutateTicket(() => {
        if (!config) return;
        const line = draftToLine(config.product, draft, draft.lineId ?? uuid());
        if (draft.lineId) {
          setLines((cur) => cur.map((l) => (l.lineId === draft.lineId ? line : l)));
        } else {
          addLine(line);
        }
        setConfig(null);
      });
    },
    [addLine, config, mutateTicket],
  );

  // ─── Tickets en attente ───
  const park = useCallback(() => {
    mutateTicket(() => {
      if (lines.length === 0) return;
      const hadLoyalty = loyaltyMember !== null;
      const customer = customerFieldsForMode(mode, customerName, customerPhone, slotIso);
      const ticket = minimizeParkedTicket({
        code: parkCode(),
        lines,
        mode,
        ...customer,
        note,
        at: Date.now(),
      });
      setParked((cur) => [...cur, ticket]);
      resetTicket();
      push(
        hadLoyalty
          ? `Ticket ${ticket.code} mis en attente · carte à rescanner au rappel`
          : `Ticket ${ticket.code} mis en attente`,
        'warn',
      );
    });
  }, [customerName, customerPhone, lines, loyaltyMember, mode, mutateTicket, note, push, resetTicket, slotIso]);

  const recall = useCallback(
    (ticket: ParkedTicket) => {
      mutateTicket(() => {
        if (lines.length > 0) {
          push('Terminez ou mettez en attente le ticket en cours', 'bad');
          return;
        }
        setLines(ticket.lines);
        setMode(ticket.mode);
        const customer = customerFieldsForMode(
          ticket.mode,
          ticket.customerName,
          ticket.customerPhone,
          ticket.slot,
        );
        setCustomerName(customer.customerName);
        setCustomerPhone(customer.customerPhone);
        setSlotIso(customer.slot);
        setNote(ticket.note);
        setLoyaltyMember(null);
        setParked((cur) => cur.filter((t) => t.code !== ticket.code));
        push(`Ticket ${ticket.code} rappelé`);
      });
    },
    [lines.length, mutateTicket, push],
  );

  // ─── Envoi en cuisine ───
  const nextLocalNumber = useMemo(
    () => dayLog.reduce((max, e) => Math.max(max, e.serverNumber ?? e.localNumber), serverMax) + 1,
    [dayLog, serverMax],
  );

  const send = useCallback(
    async (method: PayMethod, cash?: { received: number; change: number }) => {
      if (lines.length === 0 || busy) return;
      if (serviceCloseGate.current) {
        push('Terminez ou fermez la clôture de service avant d’encaisser', 'warn');
        return;
      }
      if (!saleInFlight.tryStart()) return;
      setBusy(true);
      try {
        const clientId = uuid();
        const loyaltyIntent =
          mode !== 'tel' && loyaltyMember?.status === 'active'
            ? {
                operationId: uuid(),
                memberId: loyaltyMember.id,
              }
            : null;
        const total = cartTotal(lines);
        const items = lines.reduce((n, l) => n + l.qty, 0);
        const body = buildOrderBody({
          clientId,
          loyaltyMemberId: loyaltyIntent?.memberId ?? null,
          loyaltyEarnOperationId: loyaltyIntent?.operationId ?? null,
          mode,
          lines,
          note,
          customerName,
          customerPhone,
          slotIso: slotIso ?? pickupSlots()[0]?.iso ?? null,
          // Le moyen réellement encaissé part avec la commande : l'API la marque
          // « payée » sur-le-champ, au lieu d'attendre la remise du plat.
          method,
          cash,
        });

        // La vente, la carte et l'opération idempotente sont persistées dans
        // UNE SEULE entrée de file puis UNE SEULE écriture Mongo. Un crash ne
        // peut plus enregistrer la commande sans son futur gain.
        await client.post('/orders', body, `order:${clientId}`, {
          displayAmountCents: total,
        });
        const loyaltyState: DayEntry['loyalty'] | undefined = loyaltyIntent
          ? { state: 'awaiting_order' }
          : undefined;
        const entry: DayEntry = {
          clientId,
          localNumber: nextLocalNumber,
          serverId: null,
          serverNumber: null,
          // Renseigné à la réconciliation : la file offline ne rend pas la
          // réponse du serveur, seul `GET /orders` porte le jeton.
          trackingToken: null,
          mode,
          method,
          paid: method !== 'retrait',
          total,
          items,
          customerName: mode === 'tel' ? customerName.trim() : null,
          ...(loyaltyState ? { loyalty: loyaltyState } : null),
          ...(cash ? { received: cash.received, change: cash.change } : null),
          at: Date.now(),
        };
        // Le setState seul n'est pas une frontière durable : un lock différé
        // peut démonter l'écran avant l'effet React de persistance. On écrit
        // donc le snapshot critique AVANT de libérer `saleInFlight`.
        const journal = await commitQueuedSaleJournal(
          client.tenantStore,
          dayLogRef.current,
          entry,
        );
        if (!journal.durable) {
          // L'enqueue a déjà committé la vente. La présenter comme échouée
          // laisserait le ticket intact et un second clic créerait un nouvel
          // UUID — donc un doublon réel. On confirme la vente, garde sa copie
          // en mémoire et signale uniquement le journal local dégradé.
          push(
            'Vente bien enregistrée — journal local indisponible. Ne la ressaisissez pas.',
            'warn',
          );
        }
        dayLogRef.current = journal.entries;
        setDayLog(journal.entries);
        setSentClientId(clientId);
        setCashOpen(false);
        setTicketOpen(false);
        resetTicket();
      } catch (e) {
        push(e instanceof Error ? e.message : "Impossible d'enregistrer la commande", 'bad');
      } finally {
        saleInFlight.finish();
        setBusy(false);
      }
    },
    [
      busy,
      customerName,
      customerPhone,
      lines,
      loyaltyMember,
      mode,
      nextLocalNumber,
      note,
      push,
      resetTicket,
      saleInFlight,
      slotIso,
    ],
  );

  const onPay = useCallback(
    (method: PayMethod) => {
      if (saleInFlight.active) return;
      // En compact, l'encaissement se déclenche depuis la barre d'accès comme
      // depuis le tiroir : on referme le tiroir pour rendre la main à la vue.
      setTicketOpen(false);
      if (method === 'especes') setCashOpen(true);
      else void send(method);
    },
    [saleInFlight, send],
  );

  // ─── Remise (PIN) ───
  const applyDiscount = useCallback(
    async (entry: DayEntry, amount: number, reason: string, pin: string): Promise<string | null> => {
      if (!entry.serverId) return 'Commande pas encore synchronisée';
      try {
        // Écriture immédiate assumée : la vérification du PIN doit répondre
        // tout de suite (un PIN rejoué plus tard par la file serait refusé en
        // silence et bloquerait le sujet). Action explicitement en ligne.
        const res = await client.direct<{ totals?: { total?: number; discount?: { amount: number } } }>(
          'POST',
          `/orders/${entry.serverId}/discount`,
          { pin, amount, reason },
        );
        const applied = res.totals?.discount?.amount ?? amount;
        setDayLog((cur) => cur.map((e) => (e.clientId === entry.clientId ? { ...e, discount: applied } : e)));
        push(`Remise de ${euros(applied)} appliquée`, 'good');
        return null;
      } catch (e) {
        if (e instanceof SmApiError && e.status === 401) return 'PIN incorrect';
        return e instanceof Error ? e.message : 'Remise refusée';
      }
    },
    [push],
  );

  /**
   * Le ticket porte le nom et le téléphone du client : la route publique exige
   * désormais le jeton de suivi. Sans lui, on le dit plutôt que de laisser
   * remonter un 404 sec au comptoir.
   */
  const fetchTicket = useCallback((orderId: string, token: string | null | undefined) => {
    if (!token) {
      return Promise.reject(
        new Error('Jeton de suivi absent — la commande finit de se synchroniser.'),
      );
    }
    return client.get<OrderTicketDto>(
      `/public/orders/${orderId}/ticket?t=${encodeURIComponent(token)}`,
    );
  }, []);

  /** Z du service : commandes serveur si disponibles, journal local sinon. */
  const z = useMemo(
    () =>
      fenetre
        ? zFromServer(fenetre.rows, serviceStart, {
            total: fenetre.total,
            truncated: fenetre.truncated,
            received: fenetre.rows.length,
          })
        : zFromJournal(dayLog),
    [dayLog, fenetre, serviceStart],
  );

  // ─── La vue du service ───

  /**
   * LES COMMANDES RÉELLEMENT EN COURS — ni remises, ni annulées.
   *
   * Calculées UNE fois, sur la fenêtre serveur, avec la borne du service
   * courant. La pastille de la barre haute et la vue en descendent toutes les
   * deux : elles ne peuvent donc pas diverger. C'est exactement le défaut qu'on
   * vient de corriger dans le back-office, où une pastille comptait sans borne
   * de temps ce qu'un écran montrait depuis minuit — et deux requêtes séparées,
   * fût-ce vers `GET /orders/count`, l'auraient réintroduit ici.
   */
  const serviceCommandes = useMemo(
    // L'horloge de secours est celle de la LECTURE (`fenetre.at`), pas celle du
    // rendu : elle ne sert qu'à une commande dont le serveur n'aurait pas rendu
    // la date, et la faire dépendre de `now` recalculerait toute la liste
    // chaque seconde. Les minuteurs, eux, reçoivent `now` carte par carte.
    () => commandesEnCours(fenetre?.rows ?? [], serviceStart, fenetre?.at ?? serviceStart),
    [fenetre, serviceStart],
  );

  /**
   * La pastille est un MINIMUM quand la fenêtre serveur est plafonnée : elle
   * ne peut pas voir ce que le serveur n'a pas renvoyé, et « 200 » se lirait
   * comme un compte exact.
   */
  const serviceBadge = windowCountLabel(
    serviceCommandes.length,
    fenetre?.truncated === true,
  );
  const servicePretes = serviceCommandes.some((c) => c.status === 'ready');

  /** Depuis quand cet écran n'a-t-il pas été rafraîchi — jamais un chiffre figé. */
  const fraicheurService = useMemo(
    () => fraicheur(fenetre?.at ?? null, now),
    [fenetre?.at, now],
  );

  /**
   * « La 42 est prête » — annoncé UNE fois, jamais à chaque sondage.
   *
   * `useOncePerId` du noyau partagé sert précisément à ça. L'amorçage compte :
   * à la première lecture réussie, on MARQUE les commandes déjà prêtes sans
   * rien annoncer, faute de quoi un poste qui ouvre en plein service noierait
   * le caissier sous dix notifications d'un coup.
   */
  const annoncerUneFois = useOncePerId();
  const premiereLecture = useRef(true);
  useEffect(() => {
    if (!fenetre) return;
    const pretes = fenetre.rows.filter((row) => row.status === 'ready');
    if (premiereLecture.current) {
      premiereLecture.current = false;
      for (const row of pretes) annoncerUneFois(row._id, () => undefined);
      return;
    }
    for (const row of pretes) {
      annoncerUneFois(row._id, () => push(`Commande n° ${row.number} prête`, 'good'));
    }
  }, [annoncerUneFois, fenetre, push]);
  const pendingLoyalty = useMemo(() => pendingLoyaltyCount(dayLog), [dayLog]);

  const dismissServiceClose = useCallback(() => {
    serviceCloseGate.current = false;
    setCloseOpen(false);
  }, []);

  const openServiceClose = useCallback(async () => {
    if (busy || saleInFlight.active || serviceCloseGate.current) {
      push('Une vente est encore en cours d’enregistrement', 'warn');
      return;
    }
    serviceCloseGate.current = true;
    setSentClientId(null);
    setLoyaltyOpen(false);
    // La fenêtre ne s'ouvre qu'après la photo serveur. Le verrou empêche une
    // vente de se glisser entre cette photo et la décision de clôture.
    await reconcile(true);
    setCloseOpen(true);
  }, [busy, push, reconcile, saleInFlight]);

  const closeService = useCallback(() => {
    const safety = {
      saleInFlight: busy || saleInFlight.active,
      offline,
      pendingSync: sync.pending,
      rejectedSync: sync.rejected.length,
      pendingLoyalty,
    };
    if (serviceCloseBlockReason(safety)) {
      push(serviceCloseStatus(safety), 'warn');
      return;
    }
    const count = dayLog.length;
    setDayLog([]);
    // Le service suivant démarre ici : sans cette borne, le Z du soir
    // recompterait le service du midi depuis les commandes serveur.
    setServiceStart(Date.now());
    setFenetre(null);
    setCloseOpen(false);
    serviceCloseGate.current = false;
    push(`Service clôturé · ${count} commande${count > 1 ? 's' : ''}`, 'good');
  }, [busy, dayLog.length, offline, pendingLoyalty, push, saleInFlight, sync.pending, sync.rejected.length]);

  const sentEntry = sentClientId ? (dayLog.find((e) => e.clientId === sentClientId) ?? null) : null;

  /** Le ticket, identique en colonne ancrée et en tiroir : un seul composant. */
  const ticket = (collapse?: () => void) => (
    <TicketPanel
      lines={lines}
      mode={mode}
      brand={brand}
      note={note}
      onNote={changeNote}
      customerName={customerName}
      onCustomerName={changeCustomerName}
      customerPhone={customerPhone}
      onCustomerPhone={changeCustomerPhone}
      slotIso={slotIso}
      onSlot={changeSlot}
      onQty={setQty}
      onEdit={openEdit}
      onPark={park}
      onClear={clearTicket}
      onPay={onPay}
      busy={busy}
      loyalty={loyaltyMember}
      onLoyalty={openLoyalty}
      {...(collapse ? { onCollapse: collapse } : null)}
    />
  );

  // ─── Rendu ───
  if (!menu) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.bg }}>
        {menuError ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: S.lg }}>
            <View style={{ maxWidth: 460 }}>
              <Notice
                tone={palette.red}
                title="Menu indisponible"
                body={`${menuError}. Aucun menu n'est encore en cache sur ce poste : la caisse a besoin d'une première connexion pour fonctionner hors ligne.`}
              />
            </View>
            <Btn label="Réessayer" kind="primary" accent={brand.accent} onAccent={brand.onAccent} onPress={() => void reload()} />
          </View>
        ) : (
          <Loading label="Chargement du menu…" />
        )}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: palette.bg }}>
      <TopBar
        brand={brand}
        staffName={session.staffName}
        vue={vue}
        onVue={setVue}
        serviceBadge={serviceBadge}
        serviceUrgent={servicePretes}
        mode={mode}
        onMode={changeMode}
        pending={sync.pending}
        syncing={sync.syncing}
        offline={offline}
        rejets={sync.rejected.length}
        onRejets={() => setRejetsOpen(true)}
        now={now}
        onCloture={() => void openServiceClose()}
        onLock={() => onLock()}
      />

      <View style={{ flex: 1, flexDirection: 'row', overflow: 'hidden' }}>
        {/*
          LA VUE DU SERVICE REMPLACE LE PLAN DE VENTE, elle ne s'y superpose
          pas : rail, grille et ticket disparaissent ensemble. Un panneau posé
          par-dessus laisserait des boutons d'encaissement actifs derrière, et
          le caissier finirait par toucher un produit en croyant toucher une
          commande. Le ticket en cours n'est pas perdu pour autant — il est en
          mémoire et revient intact d'un appui sur « Vendre ».
        */}
        {vue === 'service' ? (
          <ServicePanel
            commandes={serviceCommandes}
            now={now}
            brand={brand}
            fraicheurLabel={fraicheurService.libelle}
            fraicheurPerimee={fraicheurService.perimee}
            truncated={fenetre?.truncated === true}
            total={fenetre?.total ?? 0}
          />
        ) : (
          <>
            <CategoryRail categories={menu.categories} activeId={catId} onSelect={setCatId} brand={brand} />

            <View style={{ flex: 1 }}>
              {offline ? (
                <View
                  style={{
                    paddingHorizontal: S.lg,
                    paddingVertical: 7,
                    backgroundColor: '#161104',
                    borderBottomWidth: 1,
                    borderBottomColor: palette.line2,
                  }}
                >
                  <Text style={{ color: palette.amber, fontSize: layout.fs(13), fontWeight: '600' }}>
                    Menu servi depuis le cache local — les prix peuvent dater. Le service continue normalement.
                  </Text>
                </View>
              ) : null}
              <ProductArea
                categories={menu.categories}
                // Les médias voyagent à plat, à côté des catégories : c'est là que
                // la grille trouve le point d'intérêt et les cotes d'une photo.
                medias={menu.medias}
                activeId={catId}
                brand={brand}
                parked={parked}
                query={query}
                onQuery={setQuery}
                onPick={(product, categoryName) => {
                  mutateTicket(() => setConfig({ product, categoryName }));
                }}
                onRecall={recall}
              />
            </View>

            {/* Ticket ancré — au-dessus de 900 px de large uniquement */}
            {layout.compact ? null : ticket()}
          </>
        )}

        {/* Ticket escamoté : tiroir depuis la droite, SOUS les modales pour
            qu'une configuration ouverte depuis une ligne passe devant. */}
        {layout.compact && ticketOpen && vue === 'vente' ? (
          <Drawer onClose={() => setTicketOpen(false)} width={layout.ticketW}>
            {ticket(() => setTicketOpen(false))}
          </Drawer>
        ) : null}

        {/* Surcouches — sous la barre haute, qui reste lisible */}
        {config ? (
          <QuickConfig
            product={config.product}
            categoryName={config.categoryName}
            brand={brand}
            initial={config.initial}
            onClose={() => setConfig(null)}
            onSubmit={submitConfig}
          />
        ) : null}

        {cashOpen ? (
          <CashModal
            total={cartTotal(lines)}
            brand={brand}
            onClose={() => setCashOpen(false)}
            onValidate={(received, change) => void send('especes', { received, change })}
          />
        ) : null}

        {sentEntry ? (
          <SentOverlay
            entry={sentEntry}
            brand={brand}
            synced={!!sentEntry.serverId}
            onClose={() => setSentClientId(null)}
            onPrint={() => setTicketFor(sentEntry)}
            onDiscount={() => setDiscountFor(sentEntry)}
          />
        ) : null}

        {closeOpen ? (
          <CloseModal
            entries={dayLog}
            z={z}
            pending={sync.pending}
            rejected={sync.rejected.length}
            pendingLoyalty={pendingLoyalty}
            busy={busy}
            offline={offline}
            brand={brand}
            staffName={session.staffName}
            onClose={dismissServiceClose}
            onCloseService={closeService}
            onOpenTicket={setTicketFor}
            onOpenDiscount={setDiscountFor}
          />
        ) : null}

        {rejetsOpen ? (
          <RejetsModal
            rejets={sync.rejected}
            entries={dayLog}
            brand={brand}
            onClose={() => setRejetsOpen(false)}
            onAcquitter={(ids) => {
              void client.queue.acquitterRejets(ids);
              setRejetsOpen(false);
            }}
          />
        ) : null}

        {ticketFor ? (
          <TicketPreview entry={ticketFor} fetchTicket={fetchTicket} onClose={() => setTicketFor(null)} />
        ) : null}

        {discountFor ? (
          <DiscountModal
            entry={discountFor}
            brand={brand}
            // Le plafond de remise du rôle vit dans `@sm/contracts` et n'était
            // lu par aucun client : la modale proposait 20 % sans savoir si le
            // code ouvert sur ce poste avait le droit de les accorder.
            staffRole={session.staffRole}
            onClose={() => setDiscountFor(null)}
            onApply={(amount, reason, pin) => applyDiscount(discountFor, amount, reason, pin)}
          />
        ) : null}
      </View>

      {/* Barre d'accès permanente du mode compact : état du ticket toujours
          lisible, encaissement à un geste. Elle disparaît dans la vue du
          service — un bouton « Encaisser » sous un écran de consultation
          encaisserait un ticket qu'on ne voit pas. */}
      {layout.compact && vue === 'vente' ? (
        <TicketDock
          lines={lines}
          mode={mode}
          brand={brand}
          busy={busy}
          customerName={customerName}
          customerPhone={customerPhone}
          loyalty={loyaltyMember}
          onLoyalty={openLoyalty}
          onOpen={() => setTicketOpen(true)}
          onPay={onPay}
        />
      ) : null}

      {/* Au niveau racine : le panneau bloque aussi le dock compact et la
          barre haute. Aucune action d'encaissement ne reste cliquable derrière
          le panneau fidélité. */}
      {loyaltyOpen && mode !== 'tel' ? (
        <LoyaltyPanel
          brand={brand}
          tenantSlug={session.tenantSlug}
          publicSiteOrigin={siteConfigure()}
          offline={offline}
          attached={loyaltyMember}
          pendingEarns={pendingLoyalty}
          onAttach={attachLoyalty}
          onDetach={detachLoyalty}
          onUnauthorized={loyaltyUnauthorized}
          onClose={closeLoyalty}
        />
      ) : null}

      {host}
    </View>
  );
}
