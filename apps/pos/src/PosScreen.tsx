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
import { Text, View } from 'react-native';
import {
  SmApiError,
  cartTotal,
  euros,
  sameConfiguration,
  uuid,
  useAutoSync,
  useMenu,
  useNow,
  useSyncState,
  type CartLine,
  type Product,
} from '@sm/client-core';
import { KEYS, client, TENANT_SLUG, type Session } from './client';
import { S, makeBrand, palette } from './theme';
import { Btn, Drawer, Loading, useToasts } from './ui';
import { useLayout } from './useLayout';
import { TopBar } from './TopBar';
import { CategoryRail, ProductArea } from './Catalog';
import { TicketDock, TicketPanel } from './TicketPanel';
import { QuickConfig, draftToLine, type ConfigDraft } from './QuickConfig';
import { CashModal, CloseModal, DiscountModal, Notice, SentOverlay, TicketPreview, type OrderTicketDto } from './modals';
import {
  buildOrderBody,
  loadJson,
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
  type ServiceOrderRow,
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
 * Ligne de `GET /orders` : réconciliation (numéro, id, jeton) ET ventilation
 * du Z. C'est la seule vue du poste qui voie aussi la vente en ligne.
 */
interface ServerOrderRow extends ServiceOrderRow {
  _id: string;
  number: number;
  clientId: string;
  trackingToken?: string | null;
}

export function PosScreen({ session, onLock }: { session: Session; onLock: (reason?: string) => void }) {
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
  /** Mode compact seulement : tiroir du ticket ouvert. */
  const [ticketOpen, setTicketOpen] = useState(false);

  // ─── Surcouches ───
  const [config, setConfig] = useState<{ product: Product; categoryName: string; initial?: ConfigDraft } | null>(null);
  const [cashOpen, setCashOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [sentClientId, setSentClientId] = useState<string | null>(null);
  const [ticketFor, setTicketFor] = useState<DayEntry | null>(null);
  const [discountFor, setDiscountFor] = useState<DayEntry | null>(null);

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
  /** Dernière vue serveur des commandes du jour — base du Z (vente en ligne comprise). */
  const [serverRows, setServerRows] = useState<ServerOrderRow[] | null>(null);

  const dayLogRef = useRef<DayEntry[]>([]);
  useEffect(() => {
    dayLogRef.current = dayLog;
  }, [dayLog]);

  // Restauration locale (le poste redémarre sans rien perdre).
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [log, park, start] = await Promise.all([
        loadJson<DayLogFile>(KEYS.dayLog, { day: serviceDay(), entries: [] }),
        loadJson<ParkedTicket[]>(KEYS.parked, []),
        loadJson<ServiceStartFile>(KEYS.serviceStart, { day: serviceDay(), at: startOfDay() }),
      ]);
      if (!alive) return;
      const sameDay = log.day === serviceDay();
      setDayLog(sameDay ? log.entries : []);
      setParked(park);
      // Un service jamais clôturé la veille repart de minuit, pas de son heure.
      setServiceStart(start.day === serviceDay() ? start.at : startOfDay());
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (ready) void saveJson(KEYS.dayLog, { day: serviceDay(), entries: dayLog } satisfies DayLogFile);
  }, [dayLog, ready]);

  useEffect(() => {
    if (ready) void saveJson(KEYS.parked, parked);
  }, [parked, ready]);

  useEffect(() => {
    if (ready) {
      void saveJson(KEYS.serviceStart, { day: serviceDay(), at: serviceStart } satisfies ServiceStartFile);
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

  const reconcile = useCallback(
    async (force = false) => {
      if (!force && !dayLogRef.current.some((e) => !e.serverId)) return;
      try {
        const res = await client.get<{ rows: ServerOrderRow[] }>(
          `/orders?since=${encodeURIComponent(startOfDayIso())}`,
        );
        const byClient = new Map(res.rows.map((r) => [r.clientId, r]));
        setServerMax(res.rows.reduce((max, r) => Math.max(max, r.number ?? 0), 0));
        setServerRows(res.rows);
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
    [onLock],
  );

  useEffect(() => {
    if (!ready) return;
    // Premier passage forcé : il amorce la séquence de numéros du jour.
    void reconcile(true);
    const id = setInterval(() => void reconcile(), 12_000);
    return () => clearInterval(id);
  }, [ready, reconcile]);

  useEffect(() => {
    if (sync.pending === 0) void reconcile();
  }, [reconcile, sync.pending]);

  // ─── Panier ───
  const addLine = useCallback((line: CartLine) => {
    setLines((cur) => {
      const idx = cur.findIndex((l) => sameConfiguration(l, line));
      if (idx === -1) return [...cur, line];
      const next = [...cur];
      const current = next[idx];
      if (current) next[idx] = { ...current, qty: Math.min(99, current.qty + line.qty) };
      return next;
    });
  }, []);

  const setQty = useCallback((lineId: string, qty: number) => {
    setLines((cur) => (qty <= 0 ? cur.filter((l) => l.lineId !== lineId) : cur.map((l) => (l.lineId === lineId ? { ...l, qty } : l))));
  }, []);

  const resetTicket = useCallback(() => {
    setLines([]);
    setNote('');
    setCustomerName('');
    setCustomerPhone('');
    setSlotIso(null);
  }, []);

  const openEdit = useCallback(
    (line: CartLine) => {
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
    },
    [menu, push],
  );

  const submitConfig = useCallback(
    (draft: ConfigDraft) => {
      if (!config) return;
      const line = draftToLine(config.product, draft, draft.lineId ?? uuid());
      if (draft.lineId) {
        setLines((cur) => cur.map((l) => (l.lineId === draft.lineId ? line : l)));
      } else {
        addLine(line);
      }
      setConfig(null);
    },
    [addLine, config],
  );

  // ─── Tickets en attente ───
  const park = useCallback(() => {
    if (lines.length === 0) return;
    const ticket: ParkedTicket = {
      code: parkCode(),
      lines,
      mode,
      customerName,
      customerPhone,
      slot: slotIso,
      note,
      at: Date.now(),
    };
    setParked((cur) => [...cur, ticket]);
    resetTicket();
    push(`Ticket ${ticket.code} mis en attente`, 'warn');
  }, [customerName, customerPhone, lines, mode, note, push, resetTicket, slotIso]);

  const recall = useCallback(
    (ticket: ParkedTicket) => {
      if (lines.length > 0) {
        push('Terminez ou mettez en attente le ticket en cours', 'bad');
        return;
      }
      setLines(ticket.lines);
      setMode(ticket.mode);
      setCustomerName(ticket.customerName);
      setCustomerPhone(ticket.customerPhone);
      setSlotIso(ticket.slot);
      setNote(ticket.note);
      setParked((cur) => cur.filter((t) => t.code !== ticket.code));
      push(`Ticket ${ticket.code} rappelé`);
    },
    [lines.length, push],
  );

  // ─── Envoi en cuisine ───
  const nextLocalNumber = useMemo(
    () => dayLog.reduce((max, e) => Math.max(max, e.serverNumber ?? e.localNumber), serverMax) + 1,
    [dayLog, serverMax],
  );

  const send = useCallback(
    async (method: PayMethod, cash?: { received: number; change: number }) => {
      if (lines.length === 0 || busy) return;
      setBusy(true);
      const clientId = uuid();
      const total = cartTotal(lines);
      const items = lines.reduce((n, l) => n + l.qty, 0);
      const body = buildOrderBody({
        clientId,
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

      try {
        // Persistée AVANT toute tentative réseau : rien ne se perd.
        await client.post('/orders', body, `order:${clientId}`);
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
          ...(cash ? { received: cash.received, change: cash.change } : null),
          at: Date.now(),
        };
        setDayLog((cur) => [...cur, entry]);
        setSentClientId(clientId);
        setCashOpen(false);
        setTicketOpen(false);
        resetTicket();
      } catch (e) {
        push(e instanceof Error ? e.message : "Impossible d'enregistrer la commande", 'bad');
      } finally {
        setBusy(false);
      }
    },
    [busy, customerName, customerPhone, lines, mode, nextLocalNumber, note, push, resetTicket, slotIso],
  );

  const onPay = useCallback(
    (method: PayMethod) => {
      // En compact, l'encaissement se déclenche depuis la barre d'accès comme
      // depuis le tiroir : on referme le tiroir pour rendre la main à la vue.
      setTicketOpen(false);
      if (method === 'especes') setCashOpen(true);
      else void send(method);
    },
    [send],
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
    () => (serverRows ? zFromServer(serverRows, serviceStart) : zFromJournal(dayLog)),
    [dayLog, serverRows, serviceStart],
  );

  const closeService = useCallback(() => {
    const count = dayLog.length;
    setDayLog([]);
    // Le service suivant démarre ici : sans cette borne, le Z du soir
    // recompterait le service du midi depuis les commandes serveur.
    setServiceStart(Date.now());
    setServerRows(null);
    setCloseOpen(false);
    push(`Service clôturé · ${count} commande${count > 1 ? 's' : ''}`, 'good');
  }, [dayLog.length, push]);

  const sentEntry = sentClientId ? (dayLog.find((e) => e.clientId === sentClientId) ?? null) : null;

  /** Le ticket, identique en colonne ancrée et en tiroir : un seul composant. */
  const ticket = (collapse?: () => void) => (
    <TicketPanel
      lines={lines}
      mode={mode}
      brand={brand}
      note={note}
      onNote={setNote}
      customerName={customerName}
      onCustomerName={setCustomerName}
      customerPhone={customerPhone}
      onCustomerPhone={setCustomerPhone}
      slotIso={slotIso}
      onSlot={setSlotIso}
      onQty={setQty}
      onEdit={openEdit}
      onPark={park}
      onClear={() => {
        resetTicket();
        push('Ticket vidé');
      }}
      onPay={onPay}
      busy={busy}
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
        mode={mode}
        onMode={setMode}
        pending={sync.pending}
        syncing={sync.syncing}
        offline={offline}
        now={now}
        serviceCount={dayLog.length}
        onService={() => {
          // La barre haute reste active sous les surcouches : on referme la
          // confirmation pour ne jamais empiler deux panneaux.
          setSentClientId(null);
          setCloseOpen(true);
        }}
        onLock={() => onLock()}
      />

      <View style={{ flex: 1, flexDirection: 'row', overflow: 'hidden' }}>
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
              <Text style={{ color: palette.amber, fontSize: 13, fontWeight: '600' }}>
                Menu servi depuis le cache local — les prix peuvent dater. Le service continue normalement.
              </Text>
            </View>
          ) : null}
          <ProductArea
            categories={menu.categories}
            activeId={catId}
            brand={brand}
            parked={parked}
            query={query}
            onQuery={setQuery}
            onPick={(product, categoryName) => setConfig({ product, categoryName })}
            onRecall={recall}
          />
        </View>

        {/* Ticket ancré — au-dessus de 900 px de large uniquement */}
        {layout.compact ? null : ticket()}

        {/* Ticket escamoté : tiroir depuis la droite, SOUS les modales pour
            qu'une configuration ouverte depuis une ligne passe devant. */}
        {layout.compact && ticketOpen ? (
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
            brand={brand}
            staffName={session.staffName}
            onClose={() => setCloseOpen(false)}
            onCloseService={closeService}
            onOpenTicket={setTicketFor}
            onOpenDiscount={setDiscountFor}
          />
        ) : null}

        {ticketFor ? (
          <TicketPreview entry={ticketFor} fetchTicket={fetchTicket} onClose={() => setTicketFor(null)} />
        ) : null}

        {discountFor ? (
          <DiscountModal
            entry={discountFor}
            brand={brand}
            onClose={() => setDiscountFor(null)}
            onApply={(amount, reason, pin) => applyDiscount(discountFor, amount, reason, pin)}
          />
        ) : null}
      </View>

      {/* Barre d'accès permanente du mode compact : état du ticket toujours
          lisible, encaissement à un geste. */}
      {layout.compact ? (
        <TicketDock
          lines={lines}
          mode={mode}
          brand={brand}
          busy={busy}
          customerName={customerName}
          customerPhone={customerPhone}
          onOpen={() => setTicketOpen(true)}
          onPay={onPay}
        />
      ) : null}

      {host}
    </View>
  );
}
