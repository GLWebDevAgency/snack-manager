"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  DiningRoomSchema, DiningTableCreateSchema, DiningTableSchema, DiningTableUpdateSchema,
  orderAccessScope, type AuthMe, type Capacite, type DiningRoom, type DiningTable,
} from "@sm/contracts";
import { api, ApiError, getToken } from "@/lib/api";
import { Btn, Field, Icon, Input, Modal, Panel, Skeleton } from "@/components/ui";
import {
  auteurSalle, cheminOperationSalle, cleSalle, delaiSalle, lireOperationSalle,
  peutGererSalle, peutLireSalle, preparerOperationSalle, terminerOperationSalle, type OperationSalle,
} from "./salle-operation";

const message = (error: unknown) => error instanceof Error ? error.message : "La salle n’a pas répondu. Réessayez.";
const storageEvent = "sm:admin-salle-operation";
const subscribeStorage = (notify: () => void) => {
  window.addEventListener("storage", notify); window.addEventListener(storageEvent, notify);
  return () => { window.removeEventListener("storage", notify); window.removeEventListener(storageEvent, notify); };
};
const readPending = () => window.dispatchEvent(new Event(storageEvent));

/** Les droits affichés suivent AuthMe ; l'API reste l'autorité de chaque geste. */
export function Salle({ identite, capacites }: { identite: AuthMe | null; capacites: readonly Capacite[] | null }) {
  if (!identite || capacites === null) return <Panel title="Salle"><Skeleton className="h-24" /></Panel>;
  if (!peutLireSalle(identite.role)) return null;
  if (orderAccessScope(capacites) !== "all") return <Panel title="Salle" sub="Les tables et leur occupation pendant le service.">
    <p className="text-sm text-mut">Le service à table nécessite la caisse de cet établissement.</p>
  </Panel>;
  if (!identite.tenantId) return null;
  return <SalleConnectee key={`${identite.tenantId}:${auteurSalle(identite)}`} identite={identite} tenantId={identite.tenantId} />;
}

function SalleConnectee({ identite, tenantId }: { identite: AuthMe; tenantId: string }) {
  const [room, setRoom] = useState<DiningRoom | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<DiningTable | "new" | null>(null);
  const [label, setLabel] = useState("");
  const [seats, setSeats] = useState("2");
  const [active, setActive] = useState(true);
  const [formError, setFormError] = useState("");
  const mounted = useRef(false);
  const sending = useRef(false);
  const reads = useRef(0);
  const sessionToken = useRef(getToken());
  const raw = useSyncExternalStore(subscribeStorage, () => {
    try { return localStorage.getItem(cleSalle(tenantId)); }
    catch { return "!storage-unavailable"; }
  }, () => null);
  const { pending, storageError } = useMemo(() => {
    try { return { pending: lireOperationSalle(raw, tenantId), storageError: "" }; }
    catch (cause) { return { pending: null, storageError: message(cause) }; }
  }, [raw, tenantId]);
  const manage = peutGererSalle(identite.role);
  const sameOwner = pending?.auteur === auteurSalle(identite);
  const locked = busy || Boolean(pending) || Boolean(storageError);

  const load = useCallback((resetError = true) => {
    const request = ++reads.current;
    return api.get("/dining/room")
    .then(result => {
      const next = DiningRoomSchema.parse(result);
      if (mounted.current && request === reads.current) { setRoom(next); if (resetError) setError(""); }
    })
    .catch(cause => { if (mounted.current && request === reads.current) setError(message(cause)); })
    .finally(() => { if (mounted.current && request === reads.current) setLoading(false); });
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; };
  }, [load]);

  function open(table: DiningTable | "new") {
    setLabel(table === "new" ? "" : table.label);
    setSeats(String(table === "new" ? 2 : table.seats));
    setActive(table === "new" ? true : table.active);
    setFormError(""); setEditor(table);
  }

  async function send(proposed: OperationSalle) {
    if (!manage || sending.current) return;
    sending.current = true; setBusy(true); setError(""); setNotice("");
    try {
      // Same origin tabs cannot overwrite each other's durable intention.
      if (!navigator.locks) throw Error("Ce navigateur ne permet pas de protéger les changements entre onglets. Ouvrez les réglages dans un navigateur récent.");
      await navigator.locks.request(cleSalle(tenantId), { ifAvailable: true }, async (lock) => {
        if (!lock) throw Error("Une autre fenêtre enregistre la salle. Attendez sa réponse, puis actualisez.");
        if (getToken() !== sessionToken.current || proposed.auteur !== auteurSalle(identite) || proposed.tenantId !== tenantId) {
          throw Error("La session a changé. Rechargez les réglages avant de poursuivre.");
        }
        const op = preparerOperationSalle(localStorage, proposed);
        if (mounted.current) { readPending(); setEditor(null); }
        try {
          const result = await delaiSalle(op.action === "create"
            ? api.post(cheminOperationSalle(op), op.body)
            : api.patch(cheminOperationSalle(op), op.body));
          const table = DiningTableSchema.parse(result);
          if (table.id !== (op.action === "create" ? op.body.operationId : op.tableId)) throw Error("La réponse ne confirme pas la table attendue.");
          terminerOperationSalle(localStorage, op);
          if (mounted.current) {
            readPending();
            setRoom(current => current ? { ...current, tables: [...current.tables.filter(value => value.id !== table.id), table].sort((a, b) => a.label.localeCompare(b.label, "fr", { numeric: true })) } : current);
            setNotice(`Table « ${table.label} » enregistrée.`);
          }
        } catch (cause) {
          // Only an immutable server rejection carrying this reference permits forgetting it.
          if (cause instanceof ApiError && typeof cause.body === "object" && cause.body !== null
            && "code" in cause.body && cause.body.code === "DINING_OPERATION_REJECTED"
            && "operationId" in cause.body && cause.body.operationId === op.body.operationId) {
            terminerOperationSalle(localStorage, op);
            if (mounted.current) readPending();
          }
          throw cause;
        }
      });
    } catch (cause) { if (mounted.current) { setError(message(cause)); setFormError(message(cause)); } }
    finally {
      sending.current = false;
      if (mounted.current) { setBusy(false); readPending(); setLoading(true); void load(false); }
    }
  }

  function save() {
    if (!editor || locked) return;
    const operationId = crypto.randomUUID();
    const details = { label: label.trim(), seats: Number(seats) };
    const base = { version: 1 as const, auteur: auteurSalle(identite), tenantId, libelle: details.label };
    if (editor === "new") {
      const result = DiningTableCreateSchema.safeParse({ operationId, ...details });
      if (!result.success) { setFormError("Indiquez un nom de 1 à 40 caractères et un nombre entier de 1 à 100 couverts."); return; }
      void send({ ...base, action: "create", body: result.data });
    } else {
      const result = DiningTableUpdateSchema.safeParse({ operationId, expectedRevision: editor.revision, ...details, active });
      if (!result.success) { setFormError("Indiquez un nom de 1 à 40 caractères et un nombre entier de 1 à 100 couverts."); return; }
      void send({ ...base, action: "update", tableId: editor.id, body: result.data });
    }
  }

  const occupied = room?.sessions.filter(session => session.state === "open") ?? [];
  const activeCount = room?.tables.filter(table => table.active).length ?? 0;
  const editingSession = editor && editor !== "new" ? occupied.find(session => session.tableId === editor.id) : undefined;
  return <section id="salle" aria-label="Configuration de la salle" className="max-w-[1040px] scroll-mt-6">
    <Panel title={<span className="inline-flex items-center gap-2"><Icon name="table" size={21} /> Salle</span>}
      sub="Nommez vos tables, indiquez leurs couverts et retrouvez leur occupation."
      actions={<Btn variant="ghost" size="sm" disabled={loading || busy} onClick={() => { setLoading(true); void load(); }}>Actualiser</Btn>}
      bodyClassName="flex flex-col gap-4">
      {storageError && <p role="alert" className="text-sm text-alert">{storageError}</p>}
      {error && <p role="alert" className="text-sm text-alert">{error}</p>}
      {notice && <p role="status" className="text-sm text-ok">{notice}</p>}
      {pending && <div role="status" className="rounded-card border border-line bg-elev p-4">
        <p className="font-semibold text-ink">Enregistrement à vérifier — {pending.libelle}</p>
        <p className="mt-1 text-sm text-mut">{sameOwner
          ? "Cette demande est conservée. Vérifiez son résultat avant de modifier une autre table."
          : "Cette demande a été préparée par une autre personne. Elle doit reprendre sa session sur ce navigateur pour la vérifier."}</p>
        {manage && sameOwner && <Btn className="mt-3" variant="ink" disabled={busy || Boolean(storageError)} onClick={() => void send(pending)}>
          {busy ? "Vérification…" : "Vérifier l’enregistrement"}
        </Btn>}
      </div>}
      {room === null ? (loading ? <Skeleton className="h-32" /> : <p className="text-sm text-mut">Les tables ne sont pas disponibles pour le moment.</p>) : <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-mut"><b className="text-ink">{activeCount}</b> table{activeCount === 1 ? " active" : "s actives"} · <b className="text-ink">{occupied.length}</b> occupée{occupied.length === 1 ? "" : "s"}</p>
          {manage && <Btn variant="ink" icon="plus" disabled={locked || room.tables.length >= 200} onClick={() => open("new")}>Ajouter une table</Btn>}
        </div>
        {!manage && <p className="text-sm text-mut">Le propriétaire, le gérant ou le cogérant configurent les tables. Votre accès permet de consulter la salle.</p>}
        {room.tables.length === 0 ? <div className="rounded-card border border-dashed border-line py-9 text-center">
          <Icon name="table" size={30} className="mx-auto text-mut" />
          <p className="mt-3 font-semibold text-ink">Votre salle attend sa première table</p>
          <p className="mt-1 text-sm text-mut">Les tables enregistrées seront disponibles sur la caisse.</p>
        </div> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {room.tables.map(table => {
            const session = occupied.find(value => value.tableId === table.id);
            return <article key={table.id} aria-label={`Table ${table.label}`} className="flex min-w-0 flex-col gap-3 rounded-card border border-line2 bg-elev p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="min-w-0 break-words font-semibold text-ink">{table.label}</h3>
                <span className={`shrink-0 rounded-pill px-2 py-1 text-xs font-semibold ${session ? "bg-accent/10 text-accent" : "bg-ink/5 text-mut"}`}>{session ? "Occupée" : table.active ? "Libre" : "Inactive"}</span>
              </div>
              <p className="text-sm text-mut">{table.seats} couverts{!table.active && session ? " · Inactive pour les prochaines tablées" : ""}</p>
              {session && <div className="text-sm text-ink">
                <p>{session.guestCount} convives · {session.orderIds.length} commande{session.orderIds.length > 1 ? "s" : ""}</p>
                <p className="mt-1 text-xs text-mut">Depuis {new Date(session.openedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</p>
                {session.pendingOperationCount > 0 && <p className="mt-1 text-xs text-alert">{session.pendingOperationCount} enregistrement{session.pendingOperationCount > 1 ? "s" : ""} à vérifier en caisse</p>}
              </div>}
              {manage && <Btn variant="ghost" size="sm" className="mt-auto self-start" disabled={locked} aria-label={`Modifier la table ${table.label}`} onClick={() => open(table)}>Modifier</Btn>}
            </article>;
          })}
        </div>}
      </>}
    </Panel>
    <Modal open={editor !== null} onClose={() => { if (!busy) setEditor(null); }} title={editor === "new" ? "Ajouter une table" : "Modifier la table"}
      footer={<><Btn variant="ghost" disabled={busy} onClick={() => setEditor(null)}>Annuler</Btn><Btn variant="ink" disabled={locked} onClick={save}>Enregistrer la table</Btn></>}>
      <form onSubmit={event => { event.preventDefault(); save(); }} className="flex flex-col gap-4">
        {pending && <p role="status" className="text-sm text-mut">Une opération de salle est en cours dans ce navigateur. Fermez ce formulaire pour consulter sa reprise.</p>}
        <Field label="Nom de la table" htmlFor="table-label" hint="Un nom unique dans le restaurant, par exemple Terrasse 3.">
          <Input id="table-label" value={label} maxLength={40} required disabled={busy} onChange={event => setLabel(event.target.value)} />
        </Field>
        <Field label="Nombre de couverts" htmlFor="table-seats">
          <Input id="table-seats" type="number" min={1} max={100} step={1} required value={seats} disabled={busy} onChange={event => setSeats(event.target.value)} />
        </Field>
        {editor !== "new" && <><label className="flex items-center gap-3 text-sm text-ink"><input type="checkbox" checked={active} disabled={busy} onChange={event => setActive(event.target.checked)} /> Table active pour les nouvelles tablées</label>
          <p className="text-sm text-mut">Désactiver empêche de nouvelles attributions. Les tablées déjà ouvertes et les attributions déjà acceptées restent reprenables.</p></>}
        {editingSession && <p className="rounded-card bg-ink/5 p-3 text-sm text-mut">Cette table accueille actuellement {editingSession.guestCount} convives. La désactiver conserve la tablée en cours.</p>}
        {formError && <p role="alert" className="text-sm text-alert">{formError}</p>}
      </form>
    </Modal>
  </section>;
}
