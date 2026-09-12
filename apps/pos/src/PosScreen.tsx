/**
 * Composition visuelle de la caisse et orchestration des surcouches.
 *
 * Invariants tenus ici :
 *  - ventes sans créneau : file offline persistée, UUID idempotent ;
 *  - téléphone : journal durable puis admission réseau AVANT confirmation
 *    du créneau et encaissement d'une commande existante ;
 *  - les montants sont en CENTIMES partout, jamais en flottants.
 */
import { usePrefs } from './usePrefs';
import { SettingsModal } from './SettingsModal';
import { DiningRoomPanel } from './DiningRoomPanel';
import { useDining } from './useDining';
import { diningOwner, type DiningOperation } from './dining-operation';
import { appendDiningEntry, diningJournalEntry } from './dining-journal';
import { DiningAddOrderSchema } from '@sm/contracts';
import { useTheme } from './theme';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import type { CollectOrderPayment, OrderLoyaltyEarnStatus } from '@sm/contracts';
import {
  POLL_POS_MS,
  SmApiError,
  cartTotal,
  creerDebounce,
  euros,
  missingRequired,
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
  type CartLine,
  type Product,
} from '@sm/client-core';
import { API_URL } from './config';
import { DEMO, KEYS, client, TENANT_SLUG, type Session } from './client';
import { S, makeBrand, withAlpha } from './theme';
import { Btn, Drawer, Loading, useToasts } from './ui';
import { useLayout } from './useLayout';
import { siteConfigure } from './demo-retour';
import { TopBar, type Vue } from './TopBar';
import { ServicePanel } from './ServicePanel';
import { applyConfirmedHandover, confirmCounterHandover, isCounterHandoverRole } from './service-handover';
import { CollectPaymentModal } from './CollectPaymentModal';
import { collectExistingOrder, collectionRecovery, pendingCollectionIds, reconcileCollectedJournal, withCollectionDeadline } from './service-payment';
import { createJournalPaymentLookup } from './journal-payment-reconciliation';
import {
  commandesEnCours,
  type ServerOrderRow,
} from './service-state';
import {
  ACTIVE_ORDER_STATUSES,
  activeOrdersPath,
  createSerialTaskQueue,
  deriveServiceProjection,
  ordersSincePath,
  serviceBadgeLabel,
  serviceBadgeTone,
  type ServiceProjection,
  type StatusWindows,
} from './service-reconciliation';
import { CategoryRail, ProductArea } from './Catalog';
import { TicketDock, TicketPanel } from './TicketPanel';
import { usePhoneOrder, type PhoneTicketControls } from './usePhoneOrder';
import { PhoneOrderConfirmed, PhoneOrderNotice } from './PhoneOrderNotice';
import type { ReceivedPhoneOrderAttempt } from './phone-order-attempt';
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
  journalResetBlockReason,
  journalResetStatus,
  type SaleInFlightGate,
  type JournalResetSafety,
} from './pos-safety';
import {
  buildOrderBody,
  createDayLogWriter,
  customerFieldsForMode,
  DayLogChangedError,
  loadJson,
  minimizeDayEntry,
  minimizeParkedTicket,
  normalizeDayLogFile,
  parkCode,
  saveJson,
  serviceDay,
  startOfDayIso,
  zFromJournal,
  type DayEntry,
  type DayLogSnapshot,
  type Mode,
  type ParkedTicket,
  type PayMethod,
} from './pos-state';

/**
 * Photo opérationnelle des statuts actifs. Elle est volontairement séparée du
 * journal local du poste : ce dernier n'alimente que son récapitulatif local.
 */
interface FenetreServeur {
  service: ServiceProjection;
  /** Horodatage de la lecture RÉUSSIE — l'horloge de fraîcheur de l'écran. */
  at: number;
}

export function PosScreen({
  session,
  onLock,
  saleInFlight,
  startupComplete,
  logoUrl,
  deviceName,
}: {
  session: Session;
  onLock: (reason?: string) => void;
  saleInFlight: SaleInFlightGate;
  startupComplete: boolean;
  logoUrl?: string | null;
  deviceName?: string;
}) {
  const { palette } = useTheme();
  const brand = useMemo(
    () => makeBrand(session.tenantName, session.brandColor, logoUrl),
    [session.brandColor, session.tenantName, logoUrl],
  );

  /**
   * Toutes les dimensions du poste descendent d'ici : rail, ticket, colonnes,
   * échelle typographique et bascule compacte. Aucun écran ne décide seul.
   */
  const layout = useLayout();
  const { prefs } = usePrefs();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const ticketSide = prefs.layout === 'B' ? 'left' : 'right';
  const inlineConfig = layout.configInlineFor(prefs.layout);

  const { menu, error: menuError, offline, reload } = useMenu(client, TENANT_SLUG);
  const sync = useSyncState(client);
  useAutoSync(client);
  const now = useNow(1000);
  const { push, host } = useToasts();

  // ─── Ticket en cours ───
  const [mode, setMode] = useState<Mode>('surplace');
  const [cartDiningId, setCartDiningId] = useState<string | null>(null);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [note, setNote] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [slotIso, setSlotIso] = useState<string | null>(null);
  // Identité du brouillon, pas hash de PII sur disque. Une autre fenêtre ou
  // un ticket édité/reconstruit identique ne possède jamais l'ancienne vente.
  const draftSignature = JSON.stringify([mode, cartDiningId, lines.map((line) => [line.lineId, line.productId, line.variantKey,
    line.qty, line.options, line.removed, line.note]), note, customerName, customerPhone, slotIso]);
  const draftIdentity = useRef({ signature: '', id: '' });
  if (draftIdentity.current.signature !== draftSignature) draftIdentity.current = { signature: draftSignature, id: uuid() };
  const [query, setQuery] = useState('');
  const [catId, setCatId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Mode compact seulement : tiroir du ticket ouvert. */
  const [ticketOpen, setTicketOpen] = useState(false);
  /**
   * VENDRE, OU REGARDER LE SERVICE.
   *
   * Le poste s'ouvre toujours sur la vente : c'est son métier, et une caisse
   * qui démarre sur un écran de consultation coûte un geste à chaque service.
   */
  const [vue, setVue] = useState<Vue>('vente');
  const diningStaff = useMemo(() => diningOwner(session.token), [session.token]);
  const dining = useDining(vue === 'salle', offline, diningStaff, draftIdentity.current.id);
  const mutateTicket = useCallback((action: () => void) => {
    if (!dining.ready || dining.pending || dining.storageError || dining.busy) {
      push(dining.storageError ?? 'Vérifiez l’opération de salle avant de modifier le ticket.', 'warn');
      return;
    }
    saleInFlight.runWhenIdle(action);
  }, [dining.ready, dining.pending, dining.storageError, dining.busy, push, saleInFlight]);

  // ─── Surcouches ───
  const [config, setConfig] = useState<{
    product: Product;
    categoryName: string;
    initial?: ConfigDraft;
    /** Référence immuable de la ligne au début de l’édition. */
    sourceLine?: CartLine;
  } | null>(null);
  const [cashOpen, setCashOpen] = useState(false);
  useEffect(() => {
    setTicketOpen(false);
  }, [prefs.layout]);
  useEffect(() => {
    const editing = config?.initial;
    if (editing?.lineId && lines.find((line) => line.lineId === editing.lineId) !== config?.sourceLine) {
      setConfig(null);
      push('La ligne a changé dans le ticket. Rouvrez-la pour poursuivre la modification.', 'warn');
    }
  }, [config, lines, push]);
  const configurationCommitted = useCallback(() => {
    if (!config) return true;
    push('Validez ou fermez la configuration du produit avant de confirmer le ticket.', 'warn');
    return false;
  }, [config, push]);
  const [collectionTarget, setCollectionTarget] = useState<{ id: string; number: number } | null>(null);
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
  /** Au moins une vente en mémoire n'a pas encore de snapshot local durable. */
  const [journalDegraded, setJournalDegradedState] = useState(false);
  const journalDegradedRef = useRef(false);
  const setJournalDegraded = useCallback((degraded: boolean) => {
    journalDegradedRef.current = degraded;
    setJournalDegradedState(degraded);
  }, []);
  const [parked, setParked] = useState<ParkedTicket[]>([]);
  const [ready, setReady] = useState(false);
  /**
   * Dernière photo serveur : projection active non bornée, tous canaux
   * confondus (vente en ligne comprise).
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
  /** Seul chemin autorisé pour écrire `KEYS.dayLog`. */
  const dayLogWriter = useMemo(() => createDayLogWriter(client.tenantStore), []);
  /** Version durable correspondant aux totaux présentés dans la modale. */
  const recapSnapshotRef = useRef<DayLogSnapshot | null>(null);
  const busyRef = useRef(busy);
  const offlineRef = useRef(offline);
  /** Toutes les lectures `/orders` du poste passent par cette file FIFO. */
  const orderReadQueue = useMemo(() => createSerialTaskQueue(), []);
  const journalPaymentLookup = useMemo(() => createJournalPaymentLookup(), []);
  const handoverAlive = useRef(true);
  const handoversInFlight = useRef(new Set<string>());
  useEffect(() => {
    handoverAlive.current = true;
    return () => { handoverAlive.current = false; };
  }, []);
  /** Verrou synchrone : aucune vente ne démarre pendant un reset du journal. */
  const journalResetGate = useRef(false);
  /** Empêche deux confirmations concurrentes du même reset local. */
  const journalResetCommitGate = useRef(false);
  const applyDayLog = useCallback((entries: DayEntry[]) => {
    dayLogRef.current = entries;
    setDayLog(entries);
  }, []);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);
  useEffect(() => {
    offlineRef.current = offline;
  }, [offline]);
  // Restauration locale (le poste redémarre sans rien perdre).
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [rawLog, park] = await Promise.all([
        loadJson<unknown>(client.tenantStore, KEYS.dayLog, null),
        loadJson<ParkedTicket[]>(client.tenantStore, KEYS.parked, []),
      ]);
      if (!alive) return;
      const log = normalizeDayLogFile(rawLog, serviceDay());
      dayLogWriter.hydrate(log);
      const sameDay = log.day === serviceDay();
      const restoredLog = sameDay ? log.entries.map(minimizeDayEntry) : [];
      dayLogRef.current = restoredLog;
      setDayLog(restoredLog);
      setParked(park.map(minimizeParkedTicket));
      // L'ancienne borne n'est plus lue. Elle reste dans `KEYS` uniquement
      // pour être purgée au désappairage ; on la retire aussi à la migration
      // quand le stockage le permet.
      try {
        await client.tenantStore.removeItem(KEYS.serviceStart);
      } catch {
        // Une préférence obsolète ne doit pas empêcher l'ouverture du poste.
      }
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [dayLogWriter]);

  useEffect(() => {
    if (ready) void saveJson(client.tenantStore, KEYS.parked, parked);
  }, [parked, ready]);

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
  /** Une tentative ratée sera rejouée au prochain rafraîchissement forcé. */
  const dailyNumberSeeded = useRef(false);

  const loyaltyStatusInFlight = useRef(new Set<string>());
  const reconcileLoyaltyStatuses = useCallback(
    async (
      entries: readonly DayEntry[],
      journalRevision = dayLogWriter.revision(),
    ) => {
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
      const persisted = await dayLogWriter.commit(
        () => dayLogRef.current,
        (current) =>
          current.map((entry) => {
            const state = byClient.get(entry.clientId);
            return state && entry.loyalty
              ? { ...entry, loyalty: { ...entry.loyalty, state } }
              : entry;
          }),
        applyDayLog,
        journalRevision,
      );
      if (persisted) setJournalDegraded(false);
    },
    [applyDayLog, dayLogWriter, onLock],
  );

  const reconcile = useCallback(
    (force = false): Promise<FenetreServeur | null> => {
      if (!force && !dayLogRef.current.some((e) => !e.serverId || !e.paid || e.loyalty)) {
        return Promise.resolve(null);
      }

      // Poll, socket et retour de veille empruntent tous cette même
      // file. Une photo N+1 ne peut donc plus être publiée avant la photo N,
      // puis être écrasée par sa réponse tardive (composition et totaux inclus).
      return orderReadQueue.run(async () => {
        try {
          const journalRevision = dayLogWriter.revision();
          let all = normalizeOrdersWindow<ServerOrderRow>([]);
          const needsDayRead =
            !dailyNumberSeeded.current ||
            dayLogRef.current.some((entry) => !entry.serverId || !entry.paid);
          if (needsDayRead) {
            try {
              all = normalizeOrdersWindow<ServerOrderRow>(
                await client.get(ordersSincePath(Date.parse(startOfDayIso()))),
              );
              const dailyMax = all.rows.reduce(
                (max, row) => Math.max(max, row.number ?? 0),
                0,
              );
              setServerMax((current) => Math.max(current, dailyMax));
              dailyNumberSeeded.current = true;
            } catch (error) {
              // Une panne transitoire ne consomme pas l'amorce : le prochain
              // poll/socket/wake la retentera avant sa lecture de service.
              if (error instanceof SmApiError && error.status === 401) {
                onLock('Session expirée — reconnectez-vous.');
              }
            }
          }

          // Les actifs ne sont PAS bornés au journal : un ticket encore en
          // cuisine doit rester visible après un reset du journal local. Les
          // trois lectures sont systématiques et indépendantes de ce journal.
          const statusWindows: StatusWindows = {};
          const reads = await Promise.all(
            ACTIVE_ORDER_STATUSES.map(async (status) => {
              try {
                return {
                  status,
                  window: normalizeOrdersWindow<ServerOrderRow>(
                    await client.get(activeOrdersPath(status)),
                  ),
                  error: null,
                };
              } catch (error) {
                return { status, window: null, error };
              }
            }),
          );
          for (const read of reads) {
            statusWindows[read.status] = read.window;
            if (read.error instanceof SmApiError && read.error.status === 401) {
              onLock('Session expirée — reconnectez-vous.');
            }
          }

          const service = deriveServiceProjection(all, statusWindows);
          const observedRows = [...all.rows, ...service.rows];
          const byClient = new Map(observedRows.map((row) => [row.clientId, row]));
          const nextWindow: FenetreServeur = {
            service,
            at: Date.now(),
          };
          setFenetre(nextWindow);

          // Une vente déjà remise peut dater d'hier ou être hors de la page
          // des 200 commandes. Réparer uniquement les dettes de CE journal,
          // par identité exacte : cinq lectures maximum, reprises espacées.
          const recoveredPayments = await journalPaymentLookup.readMissing(
            dayLogRef.current,
            observedRows,
            (clientId) => withCollectionDeadline(client.get<ServerOrderRow>(`/orders/by-client/${encodeURIComponent(clientId)}`)),
          );
          for (const row of recoveredPayments) byClient.set(row.clientId, row);

          void reconcileLoyaltyStatuses(
            dayLogRef.current,
            journalRevision,
          ).catch(() => undefined);
          try {
            const persisted = await dayLogWriter.commit(
              () => dayLogRef.current,
              (current) =>
                current.map((entry) => {
                  const hit = byClient.get(entry.clientId);
                  if (!hit) return entry;
                  // Le jeton de suivi peut manquer sur une entrée déjà
                  // réconciliée ; la photo journalière le rattrape.
                  const synced = {
                    ...entry,
                    serverId: String(hit._id),
                    serverNumber: hit.number,
                    trackingToken:
                      hit.trackingToken ?? entry.trackingToken ?? null,
                  };
                  // Répare aussi un encaissement confirmé dont la copie locale
                  // n'a pas atteint le disque avant un crash. Jamais d'ajout web.
                  return reconcileCollectedJournal([synced], hit)[0];
                }),
              applyDayLog,
              journalRevision,
            );
            if (persisted) setJournalDegraded(false);
          } catch {
            // Le journal reste inchangé en mémoire et sera retenté au prochain
            // tour ; la photo active, indépendante, reste néanmoins fraîche.
          }
          return nextWindow;
        } catch (err) {
          if (err instanceof SmApiError && err.status === 401) {
            onLock('Session expirée — reconnectez-vous.');
          }
          return null;
        }
      });
    },
    [
      applyDayLog,
      dayLogWriter,
      journalPaymentLookup,
      onLock,
      orderReadQueue,
      reconcileLoyaltyStatuses,
    ],
  );

  // ─── Temps réel : la socket anticipe, le sondage garantit ───

  const confirmServiceHandover = useCallback(async (row: ServerOrderRow): Promise<void> => {
    if (!isCounterHandoverRole(session.staffRole)) throw new Error('Votre rôle ne permet pas la remise au client.');
    if (offlineRef.current) throw new Error('Reconnectez la caisse pour confirmer la remise.');
    if (handoversInFlight.current.has(row._id)) throw new Error('La confirmation de cette remise est déjà en cours.');
    handoversInFlight.current.add(row._id);
    try {
      // Même file que les lectures : une ancienne photo ne peut pas
      // ressusciter la commande après la confirmation de remise.
      await orderReadQueue.run(async () => {
        if (!handoverAlive.current) throw new Error('Session fermée. Reconnectez-vous avant de confirmer la remise.');
        const confirmed = await confirmCounterHandover(row,
          (id, status) => client.direct<ServerOrderRow>('PATCH', `/orders/${id}/status`, { status }));
        if (!handoverAlive.current) return;
        setFenetre((current) => current ? { ...current, service: applyConfirmedHandover(current.service, confirmed) } : current);
      });
      if (handoverAlive.current) {
        push(`Commande n° ${row.number} remise au client`, 'good');
        void reconcile(true);
      }
    } catch (error) {
      if (error instanceof SmApiError && error.status === 401) onLock('Session expirée — reconnectez-vous.');
      throw error;
    } finally {
      handoversInFlight.current.delete(row._id);
    }
  }, [session.staffRole, orderReadQueue, reconcile, push, onLock]);

  /** Server payment is authoritative even if this poste's optional local journal fails to persist. */
  const applyServicePayment = useCallback(async (row: ServerOrderRow) => {
    if (!handoverAlive.current) return;
    setFenetre((current) => current ? {
      ...current,
      service: { ...current.service, rows: current.service.rows.map((entry) => entry._id === row._id ? row : entry) },
    } : current);
    if (row.payment?.status !== 'paid' || !dayLogRef.current.some((entry) => entry.serverId === row._id || entry.clientId === row.clientId)) return;
    try {
      const persisted = await dayLogWriter.commit(() => dayLogRef.current, (entries) => reconcileCollectedJournal(entries, row), applyDayLog);
      if (!persisted) throw new Error('Le journal local a changé pendant la confirmation.');
    } catch {
      applyDayLog(reconcileCollectedJournal(dayLogRef.current, row));
      setJournalDegraded(true);
      push('Paiement confirmé sur le serveur. Journal local à resynchroniser ; ne réencaissez pas.', 'warn');
    }
  }, [applyDayLog, dayLogWriter, push, setJournalDegraded]);

  const readServicePayment = useCallback(async (id: string): Promise<ServerOrderRow> => {
    try {
      return await orderReadQueue.run(async () => {
        if (!isCounterHandoverRole(session.staffRole)) throw new Error('Votre rôle ne permet pas l’encaissement.');
        if (!handoverAlive.current || offlineRef.current || globalThis.navigator?.onLine === false) throw new Error('Connexion et session active requises pour vérifier le paiement.');
        const current = await withCollectionDeadline(client.get<ServerOrderRow>(`/orders/${id}`));
        if (!current || current._id !== id) throw new Error('Impossible de vérifier cette commande.');
        await applyServicePayment(current);
        return current;
      });
    } catch (error) {
      if (error instanceof SmApiError && error.status === 401) onLock('Session expirée — reconnectez-vous.');
      throw error;
    }
  }, [applyServicePayment, onLock, orderReadQueue, session.staffRole]);

  const collectServicePayment = useCallback(async (row: ServerOrderRow, operation: CollectOrderPayment): Promise<ServerOrderRow> => {
    if (!isCounterHandoverRole(session.staffRole)) throw new Error('Votre rôle ne permet pas l’encaissement.');
    if (offlineRef.current || globalThis.navigator?.onLine === false) throw new Error('Reconnectez la caisse pour confirmer le paiement.');
    if (!saleInFlight.tryStart()) throw new Error('Une opération de caisse est déjà en cours.');
    try {
      return await orderReadQueue.run(async () => {
        if (!handoverAlive.current || offlineRef.current || globalThis.navigator?.onLine === false) throw new Error('Connexion et session active requises pour encaisser.');
        const fresh = await withCollectionDeadline(client.get<ServerOrderRow>(`/orders/${row._id}`));
        if (!fresh || fresh._id !== row._id) throw new Error('Impossible de vérifier cette commande.');
        const durable = await collectionRecovery(client.tenantStore, row._id);
        if (!durable || JSON.stringify(durable) !== JSON.stringify(operation)) throw new Error('Référence d’encaissement non vérifiée. Aucun nouveau règlement autorisé.');
        const confirmed = await collectExistingOrder(fresh, operation,
          (id, body) => withCollectionDeadline(client.direct<ServerOrderRow>('POST', `/orders/${id}/collect`, body)), { resume: true });
        await applyServicePayment(confirmed);
        return confirmed;
      });
    } catch (error) {
      if (error instanceof SmApiError && error.status === 401) onLock('Session expirée — reconnectez-vous.');
      throw error;
    } finally {
      saleInFlight.finish();
    }
  }, [applyServicePayment, onLock, orderReadQueue, saleInFlight, session.staffRole]);

  const servicePaymentActions = useMemo(() => ({ read: readServicePayment, collect: collectServicePayment, store: client.tenantStore }), [readServicePayment, collectServicePayment]);

  useEffect(() => {
    // Une reprise ne doit pas ouvrir de portail modal sous l'écran de démarrage.
    // Le menu, la session et la file continuent à se restaurer indépendamment.
    if (!startupComplete || !ready || offline || collectionTarget || !isCounterHandoverRole(session.staffRole)) return;
    let cancelled = false;
    void pendingCollectionIds(client.tenantStore).then(async (ids) => {
      const id = ids[0];
      if (!id || cancelled) return;
      const row = await readServicePayment(id);
      if (!cancelled) setCollectionTarget({ id, number: row.number });
    }).catch(() => {
      if (!cancelled) push('Un encaissement interrompu peut nécessiter une vérification. Ouvrez la commande avant de percevoir un règlement.', 'warn');
    });
    return () => { cancelled = true; };
  }, [collectionTarget, offline, push, readServicePayment, ready, session.staffRole, startupComplete]);

  /**
   * Rafraîchissement demandé par un événement `order.*` du restaurant.
   * Débouncé : une commande génère volontiers une rafale (créée, payée,
   * avancée) et chaque tour coûte quatre GET plus le rendu de la vue du service.
   */
  const rafale = useMemo(() => creerDebounce(() => void reconcile(true)), [reconcile]);
  useEffect(() => () => rafale.annuler(), [rafale]);

  /**
   * LA SOCKET DE LA CAISSE — la même que celle de la cuisine.
   *
   * La passerelle vérifie la session et le rôle avant l'admission, puis avant
   * chaque émission. Le jeton de session par code porte le rôle `caisse`, donc
   * ce poste est accepté exactement comme le KDS avec son rôle `cuisine`.
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
    // Premier passage forcé : il charge les trois files actives.
    // La séquence journalière est amorcée par la lecture distincte au début de
    // la même tâche, puis retentée aux tours suivants seulement si elle échoue.
    void reconcile(true);
    // TOUJOURS forcé. La sortie anticipée de `reconcile` — « rien du poste
    // n'attend son identifiant serveur » — est juste pour économiser un appel
    // après une salve de caisse, mais elle arrêtait aussi le rafraîchissement
    // périodique : une fois la dernière commande du poste réconciliée, la photo
    // serveur ne bougeait plus. Les commandes EN LIGNE, qui ne passent jamais
    // par le journal local, disparaissaient donc du suivi de cette caisse.
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
    const journalRevision = dayLogWriter.revision();
    const rejectedLoyaltyOrders = new Set(rejectedLoyaltyKey.split('|'));
    const changed = dayLogRef.current.some(
      (entry) =>
        entry.loyalty &&
        entry.loyalty.state !== 'failed' &&
        rejectedLoyaltyOrders.has(entry.clientId),
    );
    void dayLogWriter
      .commit(
        () => dayLogRef.current,
        (current) =>
          current.map((entry) => {
            if (!entry.loyalty || !rejectedLoyaltyOrders.has(entry.clientId)) {
              return entry;
            }
            if (entry.loyalty.state === 'failed') return entry;
            return {
              ...entry,
              loyalty: { ...entry.loyalty, state: 'failed' as const },
            };
          }),
        applyDayLog,
        journalRevision,
      )
      .then((persisted) => {
        if (persisted) setJournalDegraded(false);
      })
      .catch(() => undefined);
    if (changed) push('Fidélité annulée : la vente a été refusée', 'bad');
  }, [applyDayLog, dayLogWriter, push, ready, rejectedLoyaltyKey]);

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
    setCartDiningId(null);
    setConfig(null);
    setLines([]);
    setNote('');
    setCustomerName('');
    setCustomerPhone('');
    setSlotIso(null);
    setLoyaltyMember(null);
  }, []);

  const repairPhoneOrder = useCallback(async (attempt: ReceivedPhoneOrderAttempt) => {
    const receipt = attempt.receipt;
    const methods: Record<string, PayMethod> = { cash: 'especes', card: 'cb', meal_voucher: 'tr' };
    const entry: DayEntry = { clientId: receipt.clientId, localNumber: receipt.number,
      serverId: receipt.orderId, serverNumber: receipt.number, trackingToken: receipt.trackingToken,
      mode: 'tel', method: receipt.payment.status === 'paid' ? (methods[receipt.payment.tender ?? ''] ?? 'retrait') : 'retrait',
      paid: receipt.payment.status === 'paid', total: receipt.totalCents, items: receipt.items,
      customerName: attempt.body.pickup.customerName, at: attempt.createdAt,
      ...(receipt.payment.cashReceived === undefined ? {} : { received: receipt.payment.cashReceived }),
      ...(receipt.payment.changeGiven === undefined ? {} : { change: receipt.payment.changeGiven }) };
    const revision = dayLogWriter.revision();
    const persisted = await dayLogWriter.commit(() => dayLogRef.current,
      (current) => current.some((candidate) => candidate.clientId === entry.clientId) ? [...current] : [...current, entry],
      applyDayLog, revision);
    if (!persisted) throw new Error('La commande est confirmée, mais le journal local a changé. Finalisez sa vérification sans la ressaisir.');
    setJournalDegraded(false);
    if (attempt.draftId === draftIdentity.current.id) resetTicket();
    setTicketOpen(false);
  }, [applyDayLog, dayLogWriter, resetTicket, setJournalDegraded]);

  const phone = usePhoneOrder({ client, enabled: mode === 'tel' && !DEMO, ready, slug: session.tenantSlug,
    isCurrentPairing: () => TENANT_SLUG === session.tenantSlug,
    gate: saleInFlight, onBusy: setBusy, onUnauthorized: () => onLock('Session expirée — reconnectez-vous.'), repair: repairPhoneOrder,
    onArchivedDraft: (draftId) => {
      if (!draftId) return;
      saleInFlight.deferUntilIdle(() => {
        if (draftId === draftIdentity.current.id) resetTicket();
      });
    } });

  const phoneCanSubmit = !DEMO && ready && phone.loaded && !phone.attempt && !phone.unavailable && !phone.slotsBusy && !phone.slotsError
    && lines.length > 0 && customerName.trim().length > 0 && customerPhone.replace(/\D/g, '').length >= 8
    && phone.slots?.slots.some((slot) => slot.iso === slotIso && !slot.full) === true;
  const submitPhone = () => {
    if (!phoneCanSubmit || mode !== 'tel' || !slotIso || busy || journalResetGate.current) return;
    if (!configurationCommitted()) return;
    const { clientId: _unused, ...body } = buildOrderBody({ clientId: '00000000-0000-4000-8000-000000000000',
      mode: 'tel', lines, note, customerName, customerPhone, slotIso, method: 'retrait' });
    setTicketOpen(false);
    phone.submit(body, draftIdentity.current.id);
  };
  const phoneControls: PhoneTicketControls = { date: phone.date, slots: phone.slots, slotsBusy: phone.slotsBusy,
    slotsError: phone.slotsError, unavailable: DEMO
      ? 'La démonstration ne réserve aucun créneau. Les commandes téléphone sont disponibles sur une caisse appairée.'
      : phone.unavailable, canSubmit: phoneCanSubmit,
    onDate: (date) => { if (!saleInFlight.active) { changeSlot(''); phone.setDate(date); } },
    onRefresh: phone.refreshSlots, onSubmit: submitPhone };

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
          push('La fidélité n’est pas encore rattachable aux commandes téléphone.', 'warn');
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
        if (cartDiningId && next !== 'surplace') {
          push('Quittez la table avant de changer de mode de service.', 'warn');
          return;
        }
        if (next === 'tel' && loyaltyMember) {
          setLoyaltyMember(null);
          setLoyaltyOpen(false);
          push('Carte détachée : la fidélité n’est pas encore disponible pour les commandes téléphone.', 'warn');
        }
        if (mode === 'tel' && next !== 'tel') {
          setCustomerName('');
          setCustomerPhone('');
          setSlotIso(null);
        }
        setMode(next);
      });
    },
    [cartDiningId, loyaltyMember, mode, mutateTicket, push],
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
              sourceLine: line,
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
        if (draft.lineId && lines.find((line) => line.lineId === draft.lineId) !== config.sourceLine) {
          setConfig(null);
          push('La ligne a changé dans le ticket. Rouvrez-la pour poursuivre la modification.', 'warn');
          return;
        }
        const line = draftToLine(config.product, draft, draft.lineId ?? uuid());
        if (draft.lineId) {
          // Le contrôle reste aussi dans l’updater : une mutation déjà en file
          // ne doit jamais être écrasée par un brouillon issu de l’ancien rendu.
          setLines((cur) => cur.map((l) => (l.lineId === draft.lineId && l === config.sourceLine ? line : l)));
        } else {
          addLine(line);
        }
        setConfig(null);
      });
    },
    [addLine, config, lines, mutateTicket, push],
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
        ...(cartDiningId ? { diningSessionId: cartDiningId } : {}),
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
  }, [cartDiningId, customerName, customerPhone, lines, loyaltyMember, mode, mutateTicket, note, push, resetTicket, slotIso]);

  const recall = useCallback(
    (ticket: ParkedTicket) => {
      mutateTicket(() => {
        if (lines.length > 0) {
          push('Terminez ou mettez en attente le ticket en cours', 'bad');
          return;
        }
        setLines(ticket.lines);
        dining.selectSession(ticket.diningSessionId ?? null);
        setCartDiningId(ticket.diningSessionId ?? null);
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
    [dining.selectSession, lines.length, mutateTicket, push],
  );

  // ─── Envoi en cuisine ───
  const nextLocalNumber = useMemo(
    () => dayLog.reduce((max, e) => Math.max(max, e.serverNumber ?? e.localNumber), serverMax) + 1,
    [dayLog, serverMax],
  );

  const send = useCallback(
    async (method: PayMethod, cash?: { received: number; change: number }) => {
      if (lines.length === 0 || busy || !dining.ready || dining.pending || dining.storageError || dining.busy || cartDiningId) return;
      if (!configurationCommitted()) return;
      if (mode === 'tel') {
        push('Confirmez d’abord le créneau téléphone. L’encaissement se fait ensuite sur la commande confirmée.', 'warn');
        return;
      }
      if (journalResetGate.current) {
        push('Terminez ou fermez le récapitulatif avant d’encaisser', 'warn');
        return;
      }
      if (!saleInFlight.tryStart()) return;
      setBusy(true);
      try {
        const clientId = uuid();
        const loyaltyIntent =
          loyaltyMember?.status === 'active'
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
          slotIso: null,
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
          customerName: null,
          ...(loyaltyState ? { loyalty: loyaltyState } : null),
          ...(cash ? { received: cash.received, change: cash.change } : null),
          at: Date.now(),
        };
        // Le setState seul n'est pas une frontière durable : un lock différé
        // peut démonter l'écran avant l'effet React de persistance. On écrit
        // donc le snapshot critique AVANT de libérer `saleInFlight`.
        const journalRevision = dayLogWriter.revision();
        try {
          const persisted = await dayLogWriter.commit(
            () => dayLogRef.current,
            (current) => [...current, entry],
            applyDayLog,
            journalRevision,
          );
          if (persisted) setJournalDegraded(false);
        } catch {
          // L'enqueue a déjà committé la vente. La présenter comme échouée
          // laisserait le ticket intact et un second clic créerait un nouvel
          // UUID — donc un doublon réel. On confirme la vente, garde sa copie
          // en mémoire et bloque son récapitulatif tant qu'une écriture
          // ultérieure n'a pas rendu le snapshot durable.
          applyDayLog([...dayLogRef.current, entry]);
          setJournalDegraded(true);
          push(
            'Vente bien enregistrée — journal local non durable. Ne la ressaisissez pas ; le récapitulatif du poste reste bloqué.',
            'warn',
          );
        }
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
      applyDayLog,
      customerName,
      customerPhone,
      configurationCommitted,
      dayLogWriter,
      lines,
      loyaltyMember,
      mode,
      nextLocalNumber,
      cartDiningId, dining.ready, dining.pending, dining.storageError, dining.busy,
      note,
      push,
      resetTicket,
      saleInFlight,
      slotIso,
    ],
  );

  const sendDiningOrder = useCallback(async (recovery?: Extract<DiningOperation, { action: 'order' }>) => {
    if (busy || journalResetGate.current || !isCounterHandoverRole(session.staffRole)) return;
    if (!recovery && (!cartDiningId || !lines.length || !configurationCommitted())) return;
    if (!recovery && (dining.stale || dining.session?.id !== cartDiningId || dining.session.state !== 'open')) {
      push('Actualisez cette tablée avant d’envoyer les plats.', 'warn'); return;
    }
    if (!saleInFlight.tryStart()) return;
    setBusy(true);
    try {
      let operation = recovery;
      if (!operation) {
        const operationId = uuid();
        const loyaltyIntent = loyaltyMember?.status === 'active' ? { memberId: loyaltyMember.id, operationId: uuid() } : null;
        if (!diningStaff) throw new Error('Reconnectez-vous pour confirmer l’identité de l’équipier.');
        operation = { action: 'order', ownerId: diningStaff, sessionId: cartDiningId!, draftId: draftIdentity.current.id, body: DiningAddOrderSchema.parse({
          operationId, expectedRevision: dining.session!.revision,
          order: buildOrderBody({ clientId: operationId, loyaltyMemberId: loyaltyIntent?.memberId ?? null,
            loyaltyEarnOperationId: loyaltyIntent?.operationId ?? null, mode: 'surplace', lines, note,
            customerName: '', customerPhone: '', slotIso: null, method: 'retrait' }),
        }) };
      }
      const result = await dining.execute(operation);
      if (!result.order) throw new Error('L’envoi reste à vérifier avec la même référence.');
      const entry = diningJournalEntry(operation, result.order);
      try {
        const persisted = await dayLogWriter.commit(() => dayLogRef.current,
          (current) => appendDiningEntry(current, entry), applyDayLog, dayLogWriter.revision());
        if (!persisted) throw new Error('Journal modifié pendant la confirmation.');
        setJournalDegraded(false);
      } catch {
        setJournalDegraded(true);
        throw new Error('Plats enregistrés en cuisine. Le journal local reste à confirmer : vérifiez cet envoi, sans ressaisir la commande.');
      }
      await dining.acknowledge(operation.body.operationId);
      // Une reprise depuis un autre onglet ne possède pas le brouillon courant.
      if (draftIdentity.current.id === operation.draftId || lines.length === 0) resetTicket();
      setTicketOpen(false); setVue('salle');
      dining.selectSession(result.session.id);
      push(`Commande #${entry.serverNumber} envoyée · ${result.session.tableLabel}`, 'good');
      void dining.refresh(); void reconcile(true);
    } catch (e) {
      if (e instanceof SmApiError && e.status === 401) onLock('Session expirée — reconnectez l’équipier pour reprendre l’envoi.');
      push(e instanceof Error ? e.message : 'Envoi de table non confirmé.', 'bad');
    }
    finally { saleInFlight.finish(); setBusy(false); }
  }, [applyDayLog, busy, cartDiningId, configurationCommitted, dayLogWriter, dining, diningStaff, lines, loyaltyMember, note, onLock, push, reconcile, resetTicket, saleInFlight, session.staffRole]);

  const resumeDining = async () => {
    if (!dining.pending || busy || journalResetGate.current) return;
    if (dining.pending.action === 'order') { await sendDiningOrder(dining.pending); return; }
    if (!saleInFlight.tryStart()) return;
    try { await dining.execute(dining.pending); setVue('salle'); }
    catch (e) {
      if (e instanceof SmApiError && e.status === 401) onLock('Session expirée — reconnectez l’équipier pour reprendre l’opération.');
      push(e instanceof Error ? e.message : 'Opération de salle non confirmée.', 'bad');
    }
    finally { saleInFlight.finish(); }
  };

  const composeDining = (id: string) => {
    mutateTicket(() => {
      if (phone.attempt || phone.busy || (lines.length > 0 && cartDiningId !== id)) {
        push('Terminez ou mettez en attente le ticket actuel avant de changer de table.', 'warn'); return;
      }
      if (!configurationCommitted()) return;
      setCartDiningId(id); dining.selectSession(id); setMode('surplace'); setVue('vente');
    });
  };

  const roomDining = { ...dining, execute: async (operation: Parameters<typeof dining.execute>[0]) => {
    if (!saleInFlight.tryStart()) throw new Error('Une autre opération du poste est en cours. Patientez avant de modifier la salle.');
    try { return await dining.execute(operation); }
    catch (e) { if (e instanceof SmApiError && e.status === 401) onLock('Session expirée — reconnectez l’équipier pour reprendre l’opération.'); throw e; }
    finally { saleInFlight.finish(); }
  } };

  const onPay = useCallback(
    (method: PayMethod) => {
      if (saleInFlight.active || cartDiningId || !dining.ready || dining.pending || dining.storageError || dining.busy) return;
      if (mode === 'tel') return;
      if (!configurationCommitted()) return;
      // En compact, l'encaissement se déclenche depuis la barre d'accès comme
      // depuis le tiroir : on referme le tiroir pour rendre la main à la vue.
      setTicketOpen(false);
      if (method === 'especes') setCashOpen(true);
      else void send(method);
    },
    [cartDiningId, dining.ready, dining.pending, dining.storageError, dining.busy, configurationCommitted, mode, saleInFlight, send],
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
        const revision = dayLogWriter.revision();
        try {
          const persisted = await dayLogWriter.commit(
            () => dayLogRef.current,
            (current) =>
              current.map((candidate) =>
                candidate.clientId === entry.clientId
                  ? { ...candidate, discount: applied }
                  : candidate,
              ),
            applyDayLog,
            revision,
          );
          if (persisted) setJournalDegraded(false);
        } catch {
          applyDayLog(
            dayLogRef.current.map((candidate) =>
              candidate.clientId === entry.clientId
                ? { ...candidate, discount: applied }
                : candidate,
            ),
          );
          setJournalDegraded(true);
          push(
            'Remise appliquée — journal local non durable, récapitulatif bloqué.',
            'warn',
          );
        }
        push(`Remise de ${euros(applied)} appliquée`, 'good');
        return null;
      } catch (e) {
        if (e instanceof SmApiError && e.status === 401) return 'PIN incorrect';
        return e instanceof Error ? e.message : 'Remise refusée';
      }
    },
    [applyDayLog, dayLogWriter, push],
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

  /** Récapitulatif strictement local : uniquement les ventes saisies ici. */
  const z = useMemo(() => zFromJournal(dayLog), [dayLog]);

  // ─── La vue du service ───

  /**
   * LES COMMANDES RÉELLEMENT EN COURS — ni remises, ni annulées.
   *
   * Calculées UNE fois sur la projection active de la dernière lecture. Cette
   * projection vient toujours des trois requêtes de statut, sans borne de
   * reset local, et non du journal de ce poste.
   */
  const serviceCommandes = useMemo(
    // L'horloge de secours est celle de la LECTURE (`fenetre.at`), pas celle du
    // rendu : elle ne sert qu'à une commande dont le serveur n'aurait pas rendu
    // la date, et la faire dépendre de `now` recalculerait toute la liste
    // chaque seconde. Les minuteurs, eux, reçoivent `now` carte par carte.
    () =>
      commandesEnCours(
        fenetre?.service.rows ?? [],
        fenetre?.at ?? 0,
      ),
    [fenetre],
  );

  /**
   * La pastille dit aussi l'absence de première photo et sa péremption. Le
   * signe « ≈ » dépend de l'exactitude DU COMPTE ACTIF :
   * une liste de statut plafonnée ne permet pas de vérifier le paiement des
   * livraisons non reçues et ne fournit donc pas de total opérationnel exact.
   */
  /** Depuis quand cet écran n'a-t-il pas été rafraîchi — jamais un chiffre figé. */
  const fraicheurService = useMemo(
    () => fraicheur(fenetre?.at ?? null, now),
    [fenetre?.at, now],
  );
  const serviceBadge = serviceBadgeLabel({
    loaded: fenetre !== null,
    stale: !fraicheurService.jamais && fraicheurService.perimee,
    count: fenetre?.service.activeCount ?? 0,
    exact: fenetre?.service.activeCountExact ?? false,
  });
  const servicePretes = (fenetre?.service.readyCount ?? 0) > 0;

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
    const pretes = fenetre.service.rows.filter((row) => row.status === 'ready');
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
  const currentResetSafety = useCallback(
    (): JournalResetSafety => {
      const queue = client.queue.getState();
      return {
        saleInFlight: busyRef.current || saleInFlight.active || !dining.ready || !!dining.pending || !!dining.storageError || dining.busy,
        offline: offlineRef.current,
        pendingSync: queue.pending,
        rejectedSync: queue.rejected.length,
        pendingLoyalty: pendingLoyaltyCount(dayLogRef.current),
        journalDegraded: journalDegradedRef.current,
      };
    },
    [saleInFlight, dining.ready, dining.pending, dining.storageError, dining.busy],
  );

  const dismissRecap = useCallback(() => {
    if (journalResetCommitGate.current) return;
    journalResetGate.current = false;
    recapSnapshotRef.current = null;
    setCloseOpen(false);
  }, []);

  const openRecap = useCallback(async () => {
    if (busy || saleInFlight.active || journalResetGate.current || !dining.ready || dining.pending || dining.storageError || dining.busy) {
      push('Une vente est encore en cours d’enregistrement', 'warn');
      return;
    }
    journalResetGate.current = true;
    setSentClientId(null);
    setLoyaltyOpen(false);
    try {
      recapSnapshotRef.current = await dayLogWriter.refresh(
        (entries) => applyDayLog(entries.map(minimizeDayEntry)),
        serviceDay(),
      );
    } catch {
      // Le brut reste intact. Le récapitulatif peut être consulté, mais sa
      // remise à zéro est interdite tant qu'une lecture/écriture n'a pas réussi.
      recapSnapshotRef.current = null;
      setJournalDegraded(true);
    }
    setCloseOpen(true);
  }, [applyDayLog, busy, dayLogWriter, dining.ready, dining.pending, dining.storageError, dining.busy, push, saleInFlight]);

  const resetJournal = useCallback(async () => {
    if (journalResetCommitGate.current) return;
    const shownSnapshot = recapSnapshotRef.current;
    if (!shownSnapshot) {
      push('Journal local illisible — conservez-le et réessayez après vérification du stockage.', 'warn');
      return;
    }
    const safety = currentResetSafety();
    if (journalResetBlockReason(safety)) {
      push(journalResetStatus(safety), 'warn');
      return;
    }

    journalResetCommitGate.current = true;
    let lateBlockStatus: string | null = null;
    try {
      const count = dayLogRef.current.length;
      // Une seule écriture brute, sérialisée avec toutes les mutations du
      // journal. `reset` ne touche la mémoire qu'après le setItem réussi et
      // invalide les réponses réseau qui portaient l'ancienne révision.
      await dayLogWriter.reset((entries) => {
        applyDayLog(entries);
        setJournalDegraded(false);
      }, serviceDay(), () => {
        const latestSafety = currentResetSafety();
        if (!journalResetBlockReason(latestSafety)) return;
        lateBlockStatus = journalResetStatus(latestSafety);
        throw new Error(lateBlockStatus);
      }, shownSnapshot);
      setCloseOpen(false);
      journalResetGate.current = false;
      recapSnapshotRef.current = null;
      push(
        `Journal du poste réinitialisé · ${count} commande${count > 1 ? 's' : ''}`,
        'good',
      );
    } catch (error) {
      if (error instanceof DayLogChangedError) {
        try {
          recapSnapshotRef.current = await dayLogWriter.refresh(
            (entries) => applyDayLog(entries.map(minimizeDayEntry)),
            serviceDay(),
          );
          push(
            'Journal modifié sur un autre onglet — vérifiez les nouveaux totaux puis confirmez à nouveau.',
            'warn',
          );
        } catch {
          recapSnapshotRef.current = null;
          setJournalDegraded(true);
          push(
            'Journal local illisible — aucune réinitialisation effectuée.',
            'warn',
          );
        }
        return;
      }
      push(
        lateBlockStatus ??
          'Stockage local indisponible — journal conservé, aucune réinitialisation effectuée.',
        'warn',
      );
    } finally {
      journalResetCommitGate.current = false;
    }
  }, [applyDayLog, currentResetSafety, dayLogWriter, push]);

  const sentEntry = sentClientId ? (dayLog.find((e) => e.clientId === sentClientId) ?? null) : null;

  /** Le ticket, identique en colonne ancrée et en tiroir : un seul composant. */
  const ticket = (collapse?: () => void) => (
    <TicketPanel
      side={ticketSide}
      powered={prefs.layout === 'B'}
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
      busy={busy || !dining.ready || dining.busy || !!dining.pending || !!dining.storageError}
      dining={cartDiningId ? { label: dining.room?.sessions.find((item) => item.id === cartDiningId)?.tableLabel ?? 'Table à vérifier',
        blocked: dining.stale || dining.session?.id !== cartDiningId || dining.session?.state !== 'open', onSend: () => void sendDiningOrder() } : undefined}
      phone={phoneControls}
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
        deviceName={deviceName}
        vue={vue}
        onVue={(next) => { if (next === 'vente' && cartDiningId) dining.selectSession(cartDiningId); setVue(next); }}
        onDining={() => setVue('salle')}
        serviceBadge={serviceBadge}
        serviceTone={serviceBadgeTone({
          stale: fraicheurService.perimee,
          partial: fenetre?.service.partial === true,
          ready: servicePretes,
        })}
        mode={mode}
        onMode={changeMode}
        pending={sync.pending}
        syncing={sync.syncing}
        offline={offline}
        rejets={sync.rejected.length}
        onRejets={() => setRejetsOpen(true)}
        now={now}
        onRecap={() => void openRecap()}
        onLock={() => onLock()}
        onSettings={() => setSettingsOpen(true)}
      />

      <PhoneOrderNotice key={phone.attempt?.clientId ?? 'none'} attempt={phone.attempt} error={phone.error}
        busy={phone.busy} brand={brand} onResume={phone.resume} onAbandon={phone.abandon} onRelease={phone.release} onFinish={phone.finish} />
      {dining.pending || dining.storageError ? <View style={{ padding: S.md, gap: S.sm, backgroundColor: palette.surface2 }}>
        <Text accessibilityRole="alert" style={{ color: palette.text }}>{dining.storageError ?? `Opération de salle à vérifier · ${dining.pending!.body.operationId}. Reprenez cette référence avant un nouvel envoi.`}</Text>
        {dining.ownerMismatch ? <Text accessibilityRole="alert" style={{ color: palette.text }}>Reconnectez l’équipier ayant commencé cette opération pour la reprendre.</Text> : null}
        {dining.pending ? <Btn label="Vérifier l’opération de salle" icon="refresh" disabled={offline || dining.busy || busy || dining.ownerMismatch} onPress={() => void resumeDining()} /> : null}
      </View> : null}
      {cartDiningId && vue === 'vente' ? <View style={{ padding: S.sm, gap: S.sm, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', backgroundColor: palette.surface2 }}>
        <Text style={{ color: palette.text }}>Table · {dining.room?.sessions.find((item) => item.id === cartDiningId)?.tableLabel ?? 'Lecture en cours'}</Text>
        <Btn label="Voir la tablée" icon="table" onPress={() => { dining.selectSession(cartDiningId); setVue('salle'); }} />
        <Btn label="Revenir au comptoir" disabled={lines.length > 0 || dining.busy || !!dining.pending || busy}
          onPress={() => mutateTicket(() => setCartDiningId(null))} />
      </View> : null}
      <View style={{ flex: 1, flexDirection: 'row', overflow: 'hidden' }}>
        {/*
          LA VUE DU SERVICE REMPLACE LE PLAN DE VENTE, elle ne s'y superpose
          pas : rail, grille et ticket disparaissent ensemble. Un panneau posé
          par-dessus laisserait des boutons d'encaissement actifs derrière, et
          le caissier finirait par toucher un produit en croyant toucher une
          commande. Le ticket en cours n'est pas perdu pour autant — il est en
          mémoire et revient intact d'un appui sur « Vendre ».
        */}
        {vue === 'salle' ? <DiningRoomPanel dining={roomDining} brand={brand} role={session.staffRole} onCompose={composeDining}
          onCollect={(row) => setCollectionTarget({ id: row._id, number: row.number })} onHandover={confirmServiceHandover} /> : vue === 'service' ? (
          <ServicePanel
            commandes={serviceCommandes}
            now={now}
            brand={brand}
            fraicheurLabel={fraicheurService.libelle}
            fraicheurPerimee={fraicheurService.perimee}
            loaded={fenetre !== null}
            activeCount={fenetre?.service.activeCount ?? 0}
            activeCountExact={fenetre?.service.activeCountExact ?? false}
            statusCounts={fenetre?.service.statusCounts ?? null}
            servicePartial={fenetre?.service.partial === true}
            failedStatuses={fenetre?.service.failedStatuses ?? []}
            truncatedStatuses={fenetre?.service.truncatedStatuses ?? []}
            onConfirmHandover={isCounterHandoverRole(session.staffRole) ? confirmServiceHandover : undefined}
            onCollectPayment={isCounterHandoverRole(session.staffRole) ? (row) => setCollectionTarget({ id: row._id, number: row.number }) : undefined}
            offline={offline}
          />
        ) : (
          <>
            {!layout.compact && prefs.layout === 'B' ? ticket() : null}
            {prefs.layout === 'A' || (prefs.layout === 'C' && !layout.compact) ? <CategoryRail dense={prefs.layout === 'C'} categories={menu.categories} activeId={catId} onSelect={setCatId} brand={brand} /> : null}

            <View style={{ flex: 1, minWidth: 0 }}>
              {offline ? (
                <View
                  style={{
                    paddingHorizontal: S.lg,
                    paddingVertical: 7,
                    backgroundColor: withAlpha(palette.amber, 0.1),
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
                layoutId={prefs.layout}
                onSelectCategory={setCatId}
                onQuickAdd={(product, categoryName) => mutateTicket(() => {
                  if (product.outOfStock) return;
                  const variantKey = product.variants?.[0]?.key ?? null;
                  if (missingRequired(product, variantKey, []).length > 0) {
                    setConfig({ product, categoryName });
                    return;
                  }
                  addLine(draftToLine(product, { variantKey, options: [], removed: [], note: '', qty: 1 }, uuid()));
                })}
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

          </>
        )}

        {/* Instance unique : une rotation panneau/modale conserve le brouillon. */}
        {config ? <QuickConfig
          key={`${config.product._id}:${config.initial?.lineId ?? 'new'}`}
          inline={inlineConfig} visible={vue === 'vente' && !settingsOpen} product={config.product} categoryName={config.categoryName} brand={brand}
          initial={config.initial} onClose={() => setConfig(null)} onSubmit={submitConfig}
        /> : null}
        {vue === 'vente' && !layout.compact && prefs.layout !== 'B' ? ticket() : null}

        {/* Ticket escamoté : tiroir depuis la droite, SOUS les modales pour
            qu'une configuration ouverte depuis une ligne passe devant. */}
        {layout.compact && ticketOpen && vue === 'vente' ? (
          <Drawer side={ticketSide} onClose={() => setTicketOpen(false)} width={layout.ticketW}>
            {ticket(() => setTicketOpen(false))}
          </Drawer>
        ) : null}

        {/* Surcouches — sous la barre haute, qui reste lisible */}
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
            journalDegraded={journalDegraded}
            busy={busy}
            offline={offline}
            brand={brand}
            staffName={session.staffName}
            onClose={dismissRecap}
            onResetJournal={resetJournal}
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
          busy={busy || !dining.ready || dining.busy || !!dining.pending || !!dining.storageError}
          dining={cartDiningId ? { label: 'Table', blocked: dining.stale || dining.session?.id !== cartDiningId || dining.session?.state !== 'open', onSend: () => void sendDiningOrder() } : undefined}
          phone={phoneControls}
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

      {collectionTarget ? <CollectPaymentModal key={collectionTarget.id} orderId={collectionTarget.id} number={collectionTarget.number} brand={brand} actions={servicePaymentActions} offline={offline} onClose={() => setCollectionTarget(null)} /> : null}
      {phone.confirmed ? <PhoneOrderConfirmed receipt={phone.confirmed} brand={brand} onClose={phone.clearConfirmed}
        onCollect={() => {
          const receipt = phone.confirmed;
          if (!receipt) return;
          phone.clearConfirmed(); setCollectionTarget({ id: receipt.orderId, number: receipt.number });
        }} /> : null}

      {settingsOpen ? <SettingsModal brand={brand} restaurant={session.tenantName} deviceName={deviceName} pending={sync.pending} onClose={() => setSettingsOpen(false)} /> : null}
      {host}
    </View>
  );
}
