"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import {
  DeliveryOperatorCreateSchema,
  DeliveryOperatorViewSchema,
  DeliveryOperatorsViewSchema,
  type DeliveryOperatorInvitation,
  type DeliveryOperatorView,
  type DeliveryOperatorsView,
} from "@sm/contracts";
import { ApiError, api, getToken } from "@/lib/api";
import { isDemoActive } from "@/lib/demo/mode";
import { SITE_URL } from "@/lib/site";
import { Btn } from "@/components/ui/Btn";
import { Panel } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Input, Select } from "@/components/ui/fields";
import { Modal } from "@/components/ui/Modal";
import { Pill } from "@/components/ui/Pill";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  deliveryApplicationUrl,
  deliveryInvitationLink,
  deliveryOperatorStatus,
  isDeliveryOperatorAttemptExpired,
  mergeDeliveryOperatorPages,
  parseDeliveryInvitation,
  readDeliveryOperatorAttempt,
  removeDeliveryOperatorAttempt,
  saveDeliveryOperatorAttempt,
  type DeliveryOperatorAttempt,
} from "./delivery-operators-data";

const subscribeDemo = () => () => {};
const PATH = "/delivery/operators";
const REQUEST_MS = 15_000;
type Directory = { tenantId: string; session: string | null; view: DeliveryOperatorsView };
type Action = { kind: "invite" | "activate" | "revoke"; operator: DeliveryOperatorView };
type Feedback = { error: boolean; message: string };

function failure(cause: unknown, fallback: string): string {
  if (cause instanceof ApiError) {
    const code = (cause.body as { code?: unknown } | null)?.code;
    if (code === "DELIVERY_OPERATOR_CHANGED") return "Cet accès a changé depuis son affichage. Vérifiez son état dans l’annuaire avant un nouvel essai.";
    if (code === "DELIVERY_OPERATOR_REQUEST_CONFLICT") return "Cette référence correspond à une autre demande. Ne créez pas un second accès : vérifiez l’annuaire ou contactez le support.";
    if (cause.status === 401) return "Votre session a expiré. Reconnectez-vous, puis vérifiez l’annuaire avant de reprendre.";
    if (cause.status === 403) return "Votre session ne permet pas de gérer les accès livreurs de ce restaurant.";
    if ([400, 404, 409, 429].includes(cause.status) && typeof (cause.body as { message?: unknown } | null)?.message === "string" && cause.message.length < 400) return cause.message;
  }
  return fallback;
}

/** The existing PATCH client has no signal; timeout does not mean server cancellation. */
async function bounded<T>(request: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([request, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("response_uncertain")), REQUEST_MS);
    })]);
  } finally { clearTimeout(timer); }
}

export function DeliveryOperatorsPanel() {
  const demo = useSyncExternalStore(subscribeDemo, isDemoActive, () => false);
  const [directory, setDirectory] = useState<Directory | null>(null);
  const directoryRef = useRef<Directory | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const pageCount = useRef(1);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [attempt, setAttempt] = useState<DeliveryOperatorAttempt | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [mode, setMode] = useState<"name" | "staff">("name");
  const [name, setName] = useState("");
  const [staffId, setStaffId] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [abandonOpen, setAbandonOpen] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [invitation, setInvitation] = useState<DeliveryOperatorInvitation | null>(null);
  const [busy, setBusy] = useState(false);
  const [observedAt, setObservedAt] = useState(() => Date.now());
  const busyRef = useRef(false);
  const sequence = useRef(0);
  const alive = useRef(false);
  const fieldsId = useId();

  const refresh = useCallback(async () => {
    if (isDemoActive()) return;
    const run = ++sequence.current;
    const session = getToken();
    if (directoryRef.current && directoryRef.current.session !== session) {
      setDirectory(null); setAttempt(null); setInvitation(null); setAction(null); setCreateOpen(false);
    }
    setLoading(true);
    setLoadError(null);
    try {
      const signal = AbortSignal.timeout(REQUEST_MS);
      const [raw, tenant] = await Promise.all([
        api.get<unknown>(PATH, { signal }), api.get<{ _id: string }>("/tenants/me", { signal }),
      ]);
      let view = DeliveryOperatorsViewSchema.parse(raw);
      if (!/^[a-f0-9]{24}$/.test(tenant._id)) throw new Error("invalid_tenant");
      const wantedPages = directoryRef.current?.tenantId === tenant._id ? pageCount.current : 1;
      let loaded = 1;
      while (loaded < wantedPages && view.nextCursor) {
        view = mergeDeliveryOperatorPages(view, DeliveryOperatorsViewSchema.parse(await api.get<unknown>(`${PATH}?after=${encodeURIComponent(view.nextCursor)}`, { signal })));
        loaded++;
      }
      if (!alive.current || sequence.current !== run || getToken() !== session) return;
      const next = { tenantId: tenant._id, session, view };
      if (directoryRef.current && directoryRef.current.tenantId !== next.tenantId) {
        try {
          const previous = readDeliveryOperatorAttempt(sessionStorage, directoryRef.current.tenantId);
          if (previous) removeDeliveryOperatorAttempt(sessionStorage, previous.tenantId, previous.request.requestId);
        } catch { /* A foreign tenant's request is never displayed or replayed. */ }
        setCreateOpen(false); setAction(null); setInvitation(null); setCreateError(null);
        setName(""); setStaffId(""); setFeedback(null);
      }
      directoryRef.current = next;
      pageCount.current = loaded;
      setDirectory(next);
      setMoreError(null);
      setObservedAt(Date.now());
      try {
        setAttempt(readDeliveryOperatorAttempt(sessionStorage, next.tenantId));
        setStorageError(null);
      } catch {
        setAttempt(null);
        setStorageError("La sauvegarde de votre demande n’est pas accessible. Aucun nouvel ajout n’est envoyé. Réessayez après avoir vérifié le stockage de ce navigateur.");
      }
    } catch (cause) {
      if (alive.current && sequence.current === run) setLoadError(failure(cause, "L’annuaire n’a pas pu être actualisé. Vos accès restent inchangés à l’écran ; vérifiez votre connexion puis réessayez."));
    } finally { if (alive.current && sequence.current === run) setLoading(false); }
  }, []);

  useEffect(() => {
    alive.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads authenticated directory and the tenant-bound browser request after hydration.
    void refresh();
    const check = () => { if (!busyRef.current) void refresh(); };
    const sessionChanged = (event: StorageEvent) => {
      if (event.key === "sm.token.resto" || event.key === null) {
        setInvitation(null); setCreateOpen(false); setAction(null);
        if (event.newValue === null && directoryRef.current) {
          try {
            const previous = readDeliveryOperatorAttempt(sessionStorage, directoryRef.current.tenantId);
            if (previous) removeDeliveryOperatorAttempt(sessionStorage, previous.tenantId, previous.request.requestId);
          } catch { /* No request is replayed following logout. */ }
          setDirectory(null); setAttempt(null);
        }
        check();
      }
    };
    window.addEventListener("focus", check);
    window.addEventListener("storage", sessionChanged);
    const visible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", visible);
    return () => {
      alive.current = false;
      // eslint-disable-next-line react-hooks/exhaustive-deps -- this is an async generation counter, not a DOM ref snapshot.
      sequence.current++;
      window.removeEventListener("focus", check);
      window.removeEventListener("storage", sessionChanged);
      document.removeEventListener("visibilitychange", visible);
      if (!getToken() && directoryRef.current) {
        try {
          const previous = readDeliveryOperatorAttempt(sessionStorage, directoryRef.current.tenantId);
          if (previous) removeDeliveryOperatorAttempt(sessionStorage, previous.tenantId, previous.request.requestId);
        } catch { /* Logout never requires a successful storage write. */ }
      }
    };
  }, [refresh]);

  const expireInvitation = useCallback(() => {
    setInvitation(null);
    setFeedback({ error: false, message: "Le lien d’association a expiré. Générez un nouveau lien si le téléphone n’a pas encore été associé." });
    void refresh();
  }, [refresh]);

  function canAct() {
    if (demo || busyRef.current || loading || loadError || moreError || !directory) return false;
    if (getToken() !== directory.session) {
      setInvitation(null);
      setFeedback({ error: true, message: "Votre session a changé. Actualisez l’annuaire avant de continuer." });
      void refresh();
      return false;
    }
    return true;
  }
  function begin() { busyRef.current = true; setBusy(true); sequence.current++; }
  function end() { busyRef.current = false; if (alive.current) setBusy(false); }
  function showOperator(operator: DeliveryOperatorView) {
    setDirectory(current => current ? { ...current, view: { ...current.view,
      operators: current.view.operators.some(row => row.id === operator.id)
        ? current.view.operators.map(row => row.id === operator.id ? operator : row)
        : [...current.view.operators, operator],
    } } : current);
  }

  async function loadMore() {
    if (demo || busyRef.current || loading || loadError || !directory?.view.nextCursor) return;
    if (getToken() !== directory.session) { void refresh(); return; }
    begin(); setLoadingMore(true); setMoreError(null);
    try {
      const page = DeliveryOperatorsViewSchema.parse(await api.get<unknown>(`${PATH}?after=${encodeURIComponent(directory.view.nextCursor)}`, { signal: AbortSignal.timeout(REQUEST_MS) }));
      if (!alive.current || getToken() !== directory.session) return;
      const next = { ...directory, view: mergeDeliveryOperatorPages(directory.view, page) };
      directoryRef.current = next; pageCount.current++;
      setDirectory(next);
    } catch (cause) {
      if (alive.current) setMoreError(failure(cause, "Les livreurs suivants n’ont pas pu être chargés. La liste déjà affichée est conservée. Réessayez ou actualisez l’annuaire."));
    } finally { setLoadingMore(false); end(); }
  }

  async function create() {
    if (!canAct() || !directory || storageError) return;
    setCreateError(null);
    const now = Date.now();
    let pending: DeliveryOperatorAttempt;
    try {
      const stored = readDeliveryOperatorAttempt(sessionStorage, directory.tenantId);
      if (stored) pending = stored;
      else {
        const parsed = DeliveryOperatorCreateSchema.safeParse({ requestId: crypto.randomUUID(), ...(mode === "staff" ? { staffId } : { name }) });
        if (!parsed.success) { setCreateError(mode === "staff" ? "Choisissez un équipier dans la liste." : "Indiquez un nom entre 2 et 80 caractères."); return; }
        pending = saveDeliveryOperatorAttempt(sessionStorage, directory.tenantId, parsed.data, now);
      }
      setObservedAt(now);
      setAttempt(pending);
    } catch {
      setCreateError("La demande n’a pas pu être sauvegardée sur ce navigateur. Aucun ajout n’a été envoyé.");
      return;
    }
    begin();
    try {
      const raw = await api.post<unknown>(PATH, pending.request, { signal: AbortSignal.timeout(REQUEST_MS) });
      const operator = DeliveryOperatorViewSchema.parse(raw);
      if ((pending.request.staffId && operator.staffId !== pending.request.staffId) || (pending.request.name && (operator.staffId !== null || operator.name !== pending.request.name))) throw new Error("unexpected_operator");
      if (!alive.current || getToken() !== directory.session) return;
      showOperator(operator);
      removeDeliveryOperatorAttempt(sessionStorage, directory.tenantId, pending.request.requestId);
      setAttempt(null); setCreateOpen(false); setName(""); setStaffId("");
      setFeedback({ error: false, message: operator.effectiveActive ? `${operator.name} figure dans l’annuaire. Vous pouvez maintenant associer son téléphone.` : `${operator.name} figure déjà dans l’annuaire. Son accès n’a pas été réactivé automatiquement.` });
      // Keep the authoritative new entry visible even when it lies beyond the loaded pages.
    } catch (cause) {
      if (!alive.current) return;
      setCreateError(failure(cause, "La réponse n’est pas confirmée. La même demande est conservée : vérifiez l’annuaire ou réessayez, sans ajouter un deuxième livreur."));
      await refresh();
    } finally { end(); }
  }

  async function confirmAction() {
    if (!canAct() || !action || !directory) return;
    const selected = action;
    begin(); setFeedback(null);
    try {
      if (selected.kind === "invite") {
        // Validate the configured platform origin before creating a secret.
        deliveryApplicationUrl(SITE_URL);
        const raw = await api.post<unknown>(`${PATH}/${selected.operator.id}/invitation`, { expectedRevision: selected.operator.revision }, { signal: AbortSignal.timeout(REQUEST_MS) });
        const next = parseDeliveryInvitation(raw, selected.operator.id);
        if (!alive.current || getToken() !== directory.session) return;
        showOperator(next.operator); setAction(null); setInvitation(next);
      } else {
        const raw = await bounded(api.patch<unknown>(`${PATH}/${selected.operator.id}`, { expectedRevision: selected.operator.revision, active: selected.kind === "activate" }));
        const next = DeliveryOperatorViewSchema.parse(raw);
        if (next.id !== selected.operator.id || next.active !== (selected.kind === "activate")) throw new Error("unexpected_operator");
        if (!alive.current || getToken() !== directory.session) return;
        showOperator(next); setAction(null); setInvitation(null);
        setFeedback({ error: false, message: selected.kind === "revoke" ? `L’accès de ${next.name} est révoqué.` : next.effectiveActive ? `L’accès de ${next.name} est autorisé. Associez son téléphone pour l’utiliser.` : `L’accès de ${next.name} reste bloqué : vérifiez sa fiche équipier.` });
        await refresh();
      }
    } catch (cause) {
      if (!alive.current) return;
      setAction(null); setInvitation(null);
      setFeedback({ error: true, message: failure(cause, selected.kind === "invite"
        ? "Le lien n’a pas pu être récupéré. Vérifiez l’accès dans l’annuaire puis générez explicitement un nouveau lien. Aucun ancien lien n’est récupérable ici."
        : "Le résultat n’est pas confirmé. Vérifiez l’état de cet accès dans l’annuaire avant de confirmer à nouveau votre choix.") });
      await refresh();
    } finally { end(); }
  }

  function abandon() {
    if (!directory || !attempt || !canAct()) return;
    try {
      removeDeliveryOperatorAttempt(sessionStorage, directory.tenantId, attempt.request.requestId);
      setAttempt(null); setAbandonOpen(false); setCreateOpen(false); setCreateError(null);
      setFeedback({ error: false, message: "La reprise locale est fermée. Aucun accès livreur n’a été supprimé." });
    } catch { setCreateError("La demande n’a pas pu être retirée du stockage. Aucun autre ajout n’est autorisé pour le moment."); }
  }

  if (demo) return <Panel title="Vos livreurs"><p className="text-sm leading-relaxed text-mut">L’association d’un téléphone et les accès livreurs ne sont pas disponibles dans la démonstration. Aucun accès réel ni faux lien n’est généré.</p></Panel>;
  const rows = directory?.view.operators ?? [];
  const candidates = directory?.view.candidates ?? [];
  const unavailable = busy || loading || Boolean(loadError) || Boolean(moreError);
  const currentInvitationOperator = invitation && rows.find(row => row.id === invitation.operator.id);
  const invitationCurrent = Boolean(invitation && currentInvitationOperator?.effectiveActive && currentInvitationOperator.revision === invitation.operator.revision && currentInvitationOperator.inviteExpiresAt === invitation.expiresAt && !loadError && !loading);
  const pendingName = attempt?.request.name ?? candidates.find(row => row.id === attempt?.request.staffId)?.name ?? "l’équipier sélectionné";

  return <>
    <Panel title="Vos livreurs" sub="Un accès dédié à la livraison, sans abonnement RH ni accès à la caisse.">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[620px] text-[13px] leading-relaxed text-mut">Ajoutez un livreur ou habilitez un équipier polyvalent. Chaque accès peut être révoqué indépendamment de sa fiche équipe.</p>
        <div className="flex flex-wrap gap-2">
          <Btn variant="ghost" className="min-h-11" disabled={busy || loading} onClick={() => void refresh()}>{loading ? "Actualisation…" : "Actualiser"}</Btn>
          <Btn variant="ghost" icon="plus" className="min-h-11" disabled={unavailable || !directory || Boolean(storageError)} onClick={() => { setCreateError(null); setCreateOpen(true); }}>{attempt ? "Reprendre l’ajout" : "Ajouter un livreur"}</Btn>
        </div>
      </div>
      {feedback && <p role={feedback.error ? "alert" : "status"} className={`mb-4 rounded-card border p-3 text-sm leading-relaxed ${feedback.error ? "border-alert/30 bg-alert/5 text-alertt" : "border-ok/25 bg-ok/5 text-okt"}`}>{feedback.message}</p>}
      {loadError && <p role="alert" className="mb-4 text-sm text-alertt">{loadError}</p>}
      {moreError && <p role="alert" className="mb-4 text-sm text-alertt">{moreError}</p>}
      {storageError && <p role="alert" className="mb-4 text-sm text-alertt">{storageError}</p>}
      {attempt && <div className="mb-4 rounded-card border border-prep/30 bg-prep/5 p-4 text-sm text-prept">
        <p className="font-semibold">Un ajout reste à vérifier : {pendingName}.</p>
        <p className="mt-1">{isDeliveryOperatorAttemptExpired(attempt, observedAt) ? "Cette demande date de plus de 30 minutes. Vérifiez d’abord l’annuaire ; aucune nouvelle référence n’a été créée." : "La demande est conservée dans cet onglet. Reprenez le même ajout pour retrouver sa réponse, sans doublon."}</p>
        <Btn variant="ghost" className="mt-3 min-h-11" disabled={unavailable} onClick={() => setAbandonOpen(true)}>J’ai vérifié l’annuaire</Btn>
      </div>}
      {!directory && loading ? <div aria-label="Chargement des livreurs" className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-24" /></div> : directory && rows.length === 0 ? <EmptyState icon="user" title="Votre première équipe de livraison" hint="Ajoutez une personne, puis associez son téléphone avec un lien éphémère." className="px-2 py-8" /> : <ul className="divide-y divide-line" aria-label="Livreurs du restaurant">
        {rows.map(operator => <DeliveryOperatorRow key={operator.id} operator={operator} disabled={unavailable} onAction={kind => { setFeedback(null); setAction({ kind, operator }); }} />)}
      </ul>}
      {directory?.view.nextCursor && <div className="mt-4 flex justify-center"><Btn variant="ghost" className="min-h-11" disabled={busy || loading || Boolean(loadError)} aria-busy={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Chargement…" : "Charger plus de livreurs"}</Btn></div>}
      {directory?.view.truncated && <p role="status" className="mt-4 text-sm text-prept">La sélection des équipiers est limitée aux premiers résultats. Si une personne manque, contactez le support plutôt que de lui créer un accès dédié en double.</p>}
      <p className="mt-4 border-t border-line pt-4 text-xs leading-relaxed text-mut">« Téléphone associé » ne signifie pas que le livreur est en ligne ou géolocalisé. Consultez et affectez les missions depuis Commandes. Le livreur peut consulter ses missions et confirmer son départ sur son téléphone associé. La remise se confirme avec le code du client, depuis Commandes ou le téléphone du livreur. Les exceptions motivées restent réservées au responsable depuis Commandes.</p>
    </Panel>

    <Modal open={createOpen} onClose={() => { if (!busy) setCreateOpen(false); }} title={attempt ? "Reprendre l’ajout du livreur" : "Ajouter un livreur"} footer={<><Btn variant="ghost" disabled={busy} onClick={() => setCreateOpen(false)}>Fermer</Btn><Btn type="submit" form={`${fieldsId}-create`} disabled={unavailable || Boolean(storageError)} aria-busy={busy}>{busy ? "Vérification…" : attempt ? "Reprendre le même ajout" : "Ajouter l’accès"}</Btn></>}>
      <form id={`${fieldsId}-create`} onSubmit={event => { event.preventDefault(); void create(); }} className="flex flex-col gap-4">
        {attempt ? <div className="rounded-card border border-prep/30 bg-prep/5 p-4 text-prept"><p className="font-semibold">{pendingName}</p><p className="mt-2 leading-relaxed">La même référence et les mêmes informations seront renvoyées. Vous pouvez fermer cette fenêtre sans perdre la reprise dans cet onglet.</p></div> : <>
          <fieldset className="grid gap-2 sm:grid-cols-2" disabled={busy}>
            <legend className="mb-2 text-xs font-bold uppercase tracking-wide text-mut">Choisir le type d’accès</legend>
            {([{ value: "name", label: "Livreur dédié", detail: "Un nom suffit. Aucun compte RH à créer." }, { value: "staff", label: "Équipier existant", detail: "Une habilitation en plus, sans changer son rôle." }] as const).map(choice => <label key={choice.value} className={`flex cursor-pointer items-start gap-3 rounded-card border p-3.5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus ${mode === choice.value ? "border-accent bg-accent/5" : "border-linefirm bg-surface2"}`}><input type="radio" name={`${fieldsId}-mode`} value={choice.value} checked={mode === choice.value} onChange={() => setMode(choice.value)} className="mt-1 accent-accent" /><span><span className="block font-semibold">{choice.label}</span><span className="mt-1 block text-xs leading-relaxed text-mut">{choice.detail}</span></span></label>)}
          </fieldset>
          {mode === "name" ? <Field label="Nom du livreur" htmlFor={`${fieldsId}-name`}><Input id={`${fieldsId}-name`} value={name} onChange={event => setName(event.target.value)} autoComplete="off" minLength={2} maxLength={80} placeholder="Ex. Samir" /></Field> : <Field label="Équipier à habiliter" htmlFor={`${fieldsId}-staff`} hint="Seul l’accès livraison est ajouté. Un accès existant n’est jamais réactivé automatiquement."><Select id={`${fieldsId}-staff`} value={staffId} onChange={event => setStaffId(event.target.value)}><option value="">Choisir un équipier</option>{candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</Select>{candidates.length === 0 && <p className="text-xs text-mut">Aucun équipier éligible dans la liste. Vous pouvez créer un accès livreur dédié.</p>}</Field>}
        </>}
        {createError && <p role="alert" className="text-sm leading-relaxed text-alertt">{createError}</p>}
        <p className="text-xs leading-relaxed text-mut">L’ajout autorise la livraison uniquement. L’association du téléphone se fait ensuite, avec votre confirmation.</p>
      </form>
    </Modal>

    <Modal open={Boolean(action)} onClose={() => { if (!busy) setAction(null); }} destructive={action?.kind !== "activate"} title={action?.kind === "invite" ? "Associer un téléphone" : action?.kind === "revoke" ? "Révoquer cet accès ?" : "Autoriser cet accès ?"} footer={<><Btn variant="ghost" disabled={busy} onClick={() => setAction(null)}>Annuler</Btn><Btn variant={action?.kind === "revoke" ? "danger" : "primary"} disabled={unavailable} aria-busy={busy} onClick={() => void confirmAction()}>{busy ? "Vérification…" : action?.kind === "invite" ? "Générer le lien" : action?.kind === "revoke" ? "Révoquer l’accès" : "Autoriser l’accès"}</Btn></>}>
      <p className="font-semibold text-ink">{action?.operator.name}</p>
      <p className="mt-3 leading-relaxed text-mut">{action?.kind === "invite" ? "Ce lien est personnel, à usage unique, valable 10 minutes. Remettez-le uniquement au livreur pour l’ouvrir sur son téléphone." : action?.kind === "revoke" ? "Son téléphone perdra l’accès à l’application livreur. Aucun accès caisse ni fiche équipe ne sera supprimé." : "Vous autorisez cette personne à utiliser l’application livreur. Ses autres droits ne changent pas. Un nouveau lien sera nécessaire pour associer son téléphone."}</p>
      {action?.kind === "invite" && <p className="mt-3 rounded-card border border-prep/30 bg-prep/5 p-3 text-prept">Générer ce lien annule l’invitation précédente et révoque l’accès du téléphone déjà associé. Ne l’ouvrez pas sur votre appareil de gestion.</p>}
    </Modal>

    <Modal open={abandonOpen} onClose={() => setAbandonOpen(false)} destructive title="Terminer la vérification de cet ajout ?" footer={<><Btn variant="ghost" onClick={() => setAbandonOpen(false)}>Garder la reprise</Btn><Btn disabled={unavailable} onClick={abandon}>Fermer la reprise locale</Btn></>}>
      <p className="leading-relaxed text-mut">Vérifiez dans l’annuaire si {pendingName} existe déjà. Fermer cette reprise n’annule pas un ajout transmis au serveur et ne supprime aucun accès. Ne créez pas un second livreur si le résultat reste incertain.</p>
    </Modal>
    {invitation && <DeliveryInvitationDialog invitation={invitation} current={invitationCurrent} onClose={() => setInvitation(null)} onExpire={expireInvitation} />}
  </>;
}

export function DeliveryOperatorRow({ operator, disabled, onAction }: { operator: DeliveryOperatorView; disabled: boolean; onAction: (kind: Action["kind"]) => void }) {
  const status = deliveryOperatorStatus(operator);
  return <li className="flex flex-col gap-4 py-5 first:pt-2 sm:flex-row sm:items-center sm:justify-between">
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2"><h3 className="break-words text-base font-semibold tracking-tight text-ink">{operator.name}</h3><Pill variant="out">{operator.staffId ? "Équipier polyvalent" : "Livreur dédié"}</Pill></div>
      <p className={`mt-2 text-[13px] font-semibold ${status.tone === "ok" ? "text-okt" : status.tone === "waiting" ? "text-prept" : "text-mut"}`}>{status.label}</p>
      <p className="mt-1 max-w-[580px] text-xs leading-relaxed text-mut">{status.detail}</p>
    </div>
    <div className="flex shrink-0 flex-wrap gap-2">
      {operator.effectiveActive && <Btn variant="ghost" className="min-h-11" disabled={disabled} aria-label={`Associer le téléphone de ${operator.name}`} onClick={() => onAction("invite")}>Associer un téléphone</Btn>}
      {(!operator.active || operator.blockedReason === "staff_changed") && <Btn variant="ghost" className="min-h-11" disabled={disabled || operator.blockedReason === "staff_inactive"} aria-label={`Autoriser l’accès de ${operator.name}`} onClick={() => onAction("activate")}>{operator.blockedReason === "staff_changed" ? "Renouveler l’habilitation" : "Autoriser l’accès"}</Btn>}
      {operator.active && <Btn variant="ghost" className="min-h-11" disabled={disabled} aria-label={`Révoquer l’accès de ${operator.name}`} onClick={() => onAction("revoke")}>Révoquer</Btn>}
    </div>
  </li>;
}

function DeliveryInvitationDialog({ invitation, current, onClose, onExpire }: { invitation: DeliveryOperatorInvitation; current: boolean; onClose: () => void; onExpire: () => void }) {
  const link = deliveryInvitationLink(SITE_URL, invitation.token);
  const [qr, setQr] = useState<string | null>(null);
  const [qrError, setQrError] = useState(false);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [copyBusy, setCopyBusy] = useState(false);
  const copyRef = useRef(false);
  const [observedAt, setObservedAt] = useState(() => Date.now());
  const usable = current && Date.parse(invitation.expiresAt) > observedAt;
  useEffect(() => {
    let cancelled = false;
    void import("qrcode").then(module => module.default.toDataURL(link, { errorCorrectionLevel: "M", margin: 3, width: 512 }))
      .then(url => { if (!cancelled) setQr(url); }).catch(() => { if (!cancelled) setQrError(true); });
    return () => { cancelled = true; };
  }, [link]);
  useEffect(() => {
    const expires = Date.parse(invitation.expiresAt);
    const check = () => { const now = Date.now(); setObservedAt(now); if (now >= expires) onExpire(); };
    const timer = window.setTimeout(onExpire, Math.max(0, expires - Date.now()));
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => { clearTimeout(timer); window.removeEventListener("focus", check); document.removeEventListener("visibilitychange", check); };
  }, [invitation.expiresAt, onExpire]);
  async function copy() {
    if (copyRef.current || !current) return;
    if (Date.parse(invitation.expiresAt) <= Date.now()) { onExpire(); return; }
    copyRef.current = true; setCopyBusy(true); setCopyMessage(null);
    try { await navigator.clipboard.writeText(link); setCopyMessage("Lien copié. Envoyez-le uniquement à ce livreur."); }
    catch { setCopyMessage("Copie impossible. Faites scanner le QR directement depuis cet écran."); }
    finally { copyRef.current = false; setCopyBusy(false); }
  }
  return <Modal open onClose={onClose} title={`Téléphone de ${invitation.operator.name}`} footer={<Btn onClick={onClose}>Terminer</Btn>}>
    <div className="flex flex-col items-center text-center">
      {usable ? <>
        <p className="text-sm leading-relaxed text-mut">Faites scanner ce QR avec le téléphone du livreur. Il ouvre son association sécurisée, sans donner accès à votre back-office.</p>
        {/* Data URL generated locally; never sent to an image optimizer. */}
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element -- ephemeral local QR, not a remote image resource.
          <img src={qr} alt={`QR d’association éphémère pour ${invitation.operator.name}`} className="my-5 size-[224px] max-w-full rounded-card" />
        ) : qrError ? <p role="alert" className="my-5 text-sm text-alertt">Le QR n’a pas pu être généré. Vous pouvez copier le lien ci-dessous.</p> : <Skeleton className="my-5 size-[224px]" />}
        <p className="text-xs font-semibold text-prept">Valable jusqu’à {new Date(invitation.expiresAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" })} · heure de Paris</p>
        <Btn variant="ghost" className="mt-4 min-h-11" disabled={copyBusy} onClick={() => void copy()}>{copyBusy ? "Copie…" : "Copier le lien d’association"}</Btn>
      </> : <p role="status" className="rounded-card border border-prep/30 bg-prep/5 p-4 text-prept">Ce lien n’est plus affichable : l’accès a changé ou sa vérification est indisponible. Fermez cette fenêtre et vérifiez l’annuaire.</p>}
      {copyMessage && <p role="status" className="mt-3 text-xs text-mut">{copyMessage}</p>}
      <p className="mt-4 text-xs leading-relaxed text-mut">Ne partagez pas ce lien dans un groupe. Après fermeture, le secret ne pourra pas être réaffiché : générez un nouveau lien si nécessaire.</p>
    </div>
  </Modal>;
}
